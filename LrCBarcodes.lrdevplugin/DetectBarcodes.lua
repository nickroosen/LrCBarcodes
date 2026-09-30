local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDialogs = import 'LrDialogs'
local LrFileUtils = import 'LrFileUtils'
local LrFunctionContext = import 'LrFunctionContext'
local LrProgressScope = import 'LrProgressScope'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local Prefs = require 'Prefs'
local ReaderOutput = require 'ReaderOutput'
local Scanner = require 'Scanner'
local SmartCollections = require 'SmartCollections'

local function plural(n, word)
    return n .. " " .. word .. (n == 1 and "" or "s")
end

local function showOptionsDialog(context, photoCount)
    local f = LrView.osFactory()
    local props = LrBinding.makePropertyTable(context)
    props.skipAlreadyScanned = Prefs.skipAlreadyScanned
    props.fullSizeRescan = Prefs.fullSizeRescan
    props.createSmartCollections = Prefs.createSmartCollections

    local contents = f:column {
        bind_to_object = props,
        spacing = f:control_spacing(),
        f:static_text {
            title = "Scan " .. plural(photoCount, "selected photo") .. " for barcodes and QR codes.",
        },
        f:static_text {
            title = "The results are written to the LrC Barcodes metadata fields.",
        },
        f:checkbox {
            title = "Skip photos that have already been scanned",
            value = LrView.bind('skipAlreadyScanned'),
        },
        f:checkbox {
            title = "Rescan photos with barcodes at full resolution (finds small 1D barcodes; slower)",
            value = LrView.bind('fullSizeRescan'),
        },
        f:checkbox {
            title = "Create \"Barcode Found\" and \"No Barcode\" smart collections",
            value = LrView.bind('createSmartCollections'),
        },
    }

    local result = LrDialogs.presentModalDialog {
        title = "Detect Barcodes",
        contents = contents,
        actionVerb = "Scan",
    }
    if result ~= 'ok' then
        return nil
    end
    Prefs.skipAlreadyScanned = props.skipAlreadyScanned
    Prefs.fullSizeRescan = props.fullSizeRescan
    Prefs.createSmartCollections = props.createSmartCollections
    return props
end

local function summarize(total, counts, skipped, failures, canceled)
    local lines = {
        "Scanned " .. plural(total, "photo") .. ":",
        "    " .. counts[Scanner.STATUS_FOUND] .. " with a barcode",
        "    " .. counts[Scanner.STATUS_NOT_FOUND] .. " without a barcode",
    }
    if counts[Scanner.STATUS_ERROR] > 0 then
        table.insert(lines, "    " .. counts[Scanner.STATUS_ERROR] .. " could not be read")
    end
    if skipped > 0 then
        table.insert(lines, plural(skipped, "photo") .. " skipped (videos or already scanned).")
    end
    if canceled then
        table.insert(lines, "Scan was canceled; results so far have been saved.")
    end
    if #failures > 0 then
        table.insert(lines, "")
        table.insert(lines, "Problems:")
        for i = 1, math.min(#failures, 10) do
            table.insert(lines, "    " .. failures[i])
        end
        if #failures > 10 then
            table.insert(lines, "    ...and " .. (#failures - 10) .. " more")
        end
    end
    return table.concat(lines, "\n")
end

local function detectBarcodes(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local problem = Scanner.checkAvailable()
    if problem then
        LrDialogs.message("Detect Barcodes", problem, "critical")
        return
    end

    local catalog = LrApplication.activeCatalog()
    local targets = catalog:getTargetPhotos()
    if #targets == 0 then
        LrDialogs.message("Detect Barcodes", "Select the photos to scan first.", "info")
        return
    end

    local options = showOptionsDialog(context, #targets)
    if not options then
        return
    end

    -- Decide which photos to scan.
    local rawMeta = catalog:batchGetRawMetadata(targets, { 'fileFormat' })
    local names = catalog:batchGetFormattedMetadata(targets, { 'fileName' })
    local statuses = catalog:batchGetPropertyForPlugin(targets, _PLUGIN, { 'barcodeStatus' })
    local photos, skipped = {}, 0
    for _, photo in ipairs(targets) do
        local isVideo = rawMeta[photo].fileFormat == 'VIDEO'
        local alreadyScanned = statuses[photo] and statuses[photo].barcodeStatus
        if isVideo or (options.skipAlreadyScanned and alreadyScanned) then
            skipped = skipped + 1
        else
            table.insert(photos, photo)
        end
    end

    local progress = LrProgressScope {
        title = "Detecting barcodes in " .. plural(#photos, "photo"),
        functionContext = context,
    }
    progress:setCancelable(true)

    local workDir = Scanner.createWorkDir()
    context:addCleanupHandler(function()
        LrFileUtils.delete(workDir)
    end)

    local counts = {
        [Scanner.STATUS_FOUND] = 0,
        [Scanner.STATUS_NOT_FOUND] = 0,
        [Scanner.STATUS_ERROR] = 0,
    }
    local failures = {}
    local scanned = 0
    local canceled = false

    for first = 1, #photos, Scanner.batchSize do
        if progress:isCanceled() then
            canceled = true
            break
        end

        local batch = {}
        for i = first, math.min(first + Scanner.batchSize - 1, #photos) do
            table.insert(batch, photos[i])
        end

        local results = Scanner.scanBatch(batch, workDir, Prefs.previewSize)

        -- Previews are enough to spot a barcode card, but small 1D barcodes on it
        -- often need full resolution. Rescan anything that wasn't a clear miss.
        if options.fullSizeRescan and not progress:isCanceled() then
            local rescan, indexes = {}, {}
            for i, result in ipairs(results) do
                if result.status ~= Scanner.STATUS_NOT_FOUND then
                    table.insert(rescan, batch[i])
                    table.insert(indexes, i)
                end
            end
            if #rescan > 0 then
                progress:setCaption("Rescanning " .. plural(#rescan, "photo") .. " at full resolution")
                local fullResults = Scanner.scanBatchFullSize(rescan, workDir)
                for j, i in ipairs(indexes) do
                    results[i] = Scanner.mergeResults(results[i], fullResults[j])
                end
            end
        end

        -- Scanning happens outside the write gate so the catalog stays usable;
        -- each batch is saved as it completes so a cancel keeps partial results.
        catalog:withPrivateWriteAccessDo(function()
            for i, photo in ipairs(batch) do
                local result = results[i]
                local fields = ReaderOutput.toFields(result.barcodes)
                photo:setPropertyForPlugin(_PLUGIN, 'barcodeStatus', result.status)
                for _, id in ipairs(ReaderOutput.FIELDS) do
                    photo:setPropertyForPlugin(_PLUGIN, id, fields[id])
                end
            end
        end, { timeout = 30 })

        for i, result in ipairs(results) do
            counts[result.status] = counts[result.status] + 1
            if result.message then
                table.insert(failures, names[batch[i]].fileName .. ": " .. result.message)
            end
        end

        scanned = scanned + #batch
        progress:setPortionComplete(scanned, #photos)
        progress:setCaption(plural(scanned, "photo") .. " scanned, "
                            .. counts[Scanner.STATUS_FOUND] .. " with barcodes")
    end

    progress:done()

    if options.createSmartCollections then
        SmartCollections.ensure(catalog)
    end

    LrDialogs.message("Barcode Detection Complete",
                      summarize(scanned, counts, skipped, failures, canceled),
                      #failures > 0 and "warning" or "info")
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("detectBarcodes", detectBarcodes)
end)
