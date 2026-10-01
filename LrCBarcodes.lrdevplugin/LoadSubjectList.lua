local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrPathUtils = import 'LrPathUtils'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local SubjectStore = require 'SubjectStore'

local function plural(n, word)
    return n .. " " .. word .. (n == 1 and "" or "s")
end

local function loadSubjectList(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local current = SubjectStore.describe()
    local files = LrDialogs.runOpenPanel {
        title = "Choose a subject list (CSV)",
        prompt = "Load",
        canChooseFiles = true,
        canChooseDirectories = false,
        allowsMultipleSelection = false,
        fileTypes = { "csv", "txt" },
    }
    if not files or not files[1] then
        return
    end
    local path = files[1]

    local list, err = SubjectStore.read(path)
    if not list then
        LrDialogs.message("Load Subject List", err, "critical")
        return
    end

    local c = list.columns
    local nameParts = {}
    if c.first then nameParts[#nameParts + 1] = c.first end
    if c.last then nameParts[#nameParts + 1] = c.last end
    local nameFrom = c.name or table.concat(nameParts, " + ")
    local lines = {
        plural(#list.subjects, "subject") .. " in " .. LrPathUtils.leafName(path) .. ".",
        "",
        "Matched by: " .. table.concat(c.keys, ", "),
        "Subject Name from: " .. (nameFrom ~= "" and nameFrom or "(no name column)"),
        "Subject Group from: " .. (c.group or "(no group column)"),
        "Access Code from: " .. (c.accessCode or "(no access code column)"),
    }
    if list.duplicates > 0 then
        lines[#lines + 1] = ""
        lines[#lines + 1] = plural(list.duplicates, "code") .. " appear on more than one row; the first row wins."
    end
    if current then
        lines[#lines + 1] = ""
        lines[#lines + 1] = "This replaces the current list: " .. current
    end
    lines[#lines + 1] = ""
    lines[#lines + 1] = "The selected photos with scanned barcodes will be matched now, and later scans will be matched automatically."

    local f = LrView.osFactory()
    local result = LrDialogs.presentModalDialog {
        title = "Load Subject List",
        contents = f:static_text { title = table.concat(lines, "\n"), width_in_chars = 70 },
        actionVerb = "Load",
    }
    if result ~= 'ok' then
        return
    end

    SubjectStore.save(path, list)

    -- Match the selected photos that have scanned codes (the card shots).
    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    local values = catalog:batchGetPropertyForPlugin(photos, _PLUGIN, { 'barcodeValue' })
    local withCodes, matched = {}, 0
    for _, photo in ipairs(photos) do
        local v = values[photo] and values[photo].barcodeValue
        if v and v ~= "" then
            withCodes[#withCodes + 1] = { photo = photo, codes = v }
        end
    end
    if #withCodes > 0 then
        catalog:withPrivateWriteAccessDo(function()
            for _, item in ipairs(withCodes) do
                if SubjectStore.apply(list, item.photo, item.codes) then
                    matched = matched + 1
                end
            end
        end, { timeout = 60 })
    end

    local summary
    if #withCodes == 0 then
        summary = "Subject list loaded. None of the selected photos have scanned barcodes yet; "
            .. "Detect Barcodes will match them as it scans."
    else
        summary = string.format("Subject list loaded. %d of %s matched a subject.",
                                matched, plural(#withCodes, "photo with barcodes"))
        if matched < #withCodes then
            summary = summary .. "\n\nUnmatched photos keep their barcode values; check that the list is for this job."
        end
        summary = summary .. "\n\nRun Propagate Barcode Metadata to copy each subject's details to their photos."
    end
    LrDialogs.message("Load Subject List", summary, matched < #withCodes and "warning" or "info")
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("loadSubjectList", loadSubjectList)
end)
