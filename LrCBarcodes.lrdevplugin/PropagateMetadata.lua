local LrApplication = import 'LrApplication'
local LrBinding = import 'LrBinding'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'
local LrView = import 'LrView'

local Prefs = require 'Prefs'
local Propagation = require 'Propagation'
local ReaderOutput = require 'ReaderOutput'
local SubjectList = require 'SubjectList'

local KEYWORD = "keyword"

-- Built-in fields: read as formatted metadata, written with setRawMetadata.
local builtInFields = { 'title', 'caption', 'headline', 'copyName', 'jobIdentifier' }

local sourceItems = {
    { title = "Barcode Value (all)",  value = "barcodeValue" },
    { title = "QR / 2D Code Value",   value = "matrixValue" },
    { title = "Linear Barcode Value", value = "linearValue" },
    { title = "Barcode Type",         value = "barcodeType" },
    { title = "Subject Name",         value = "subjectName" },
    { title = "Subject Group",        value = "subjectGroup" },
    { title = "Access Code",          value = "accessCode" },
    { title = "Title",          value = "title" },
    { title = "Caption",        value = "caption" },
    { title = "Headline",       value = "headline" },
    { title = "Copy Name",      value = "copyName" },
    { title = "Job Identifier", value = "jobIdentifier" },
}

local destinationItems = {
    { title = "Title",          value = "title" },
    { title = "Caption",        value = "caption" },
    { title = "Headline",       value = "headline" },
    { title = "Copy Name",      value = "copyName" },
    { title = "Job Identifier", value = "jobIdentifier" },
    { title = "Keyword",        value = KEYWORD },
}

local orderItems = {
    { title = "Capture time", value = "captureTime" },
    { title = "File name",    value = "fileName" },
}

local paddingItems = {
    { title = "1, 2, 3",       value = 1 },
    { title = "01, 02, 03",    value = 2 },
    { title = "001, 002, 003", value = 3 },
}

local function plural(n, word)
    return n .. " " .. word .. (n == 1 and "" or "s")
end

-- Reads everything the dialog could need up front, so the live preview never
-- has to touch the catalog.
local function loadPhotoData(catalog, photos)
    local raw = catalog:batchGetRawMetadata(photos, { 'dateTimeOriginal', 'dateTime' })
    local formattedKeys = { 'fileName' }
    for _, key in ipairs(builtInFields) do
        table.insert(formattedKeys, key)
    end
    local formatted = catalog:batchGetFormattedMetadata(photos, formattedKeys)
    local pluginKeys = { 'barcodeStatus' }
    for _, key in ipairs(ReaderOutput.FIELDS) do
        table.insert(pluginKeys, key)
    end
    for _, key in ipairs(SubjectList.FIELDS) do
        table.insert(pluginKeys, key)
    end
    local plugin = catalog:batchGetPropertyForPlugin(photos, _PLUGIN, pluginKeys)

    local data = {}
    for index, photo in ipairs(photos) do
        local r = raw[photo] or {}
        local values = {}
        for key, value in pairs(formatted[photo] or {}) do
            values[key] = value
        end
        for key, value in pairs(plugin[photo] or {}) do
            values[key] = value
        end
        data[index] = {
            photo = photo,
            index = index,
            time = r.dateTimeOriginal or r.dateTime or 0,
            displayName = values.fileName or "",
            fileName = (values.fileName or ""):lower(),
            values = values,
        }
    end
    return data
end

local function sortPhotoData(data, order)
    table.sort(data, function(a, b)
        if order == "captureTime" and a.time ~= b.time then
            return a.time < b.time
        end
        if a.fileName ~= b.fileName then
            return a.fileName < b.fileName
        end
        return a.index < b.index
    end)
end

local function optionsFrom(props)
    return {
        includeSource = props.includeSource,
        onlyEmpty = props.onlyEmpty and props.destination ~= KEYWORD,
        limit = props.limitEnabled and math.max(0, math.floor(tonumber(props.limit) or 0)) or nil,
        sequence = props.sequence,
        separator = props.separator,
        padding = props.padding,
    }
end

local function makePlan(data, props)
    sortPhotoData(data, props.order)
    -- Fields filled in by Detect Barcodes / Load Subject List, where a card
    -- without a value means "unreadable" or "not in the list", not "no card".
    local fromBarcode = props.source == 'barcodeValue' or props.source == 'matrixValue'
                        or props.source == 'linearValue' or props.source == 'subjectName'
                        or props.source == 'subjectGroup' or props.source == 'accessCode'
    local items = {}
    for i, d in ipairs(data) do
        local source = Propagation.trim(d.values[props.source])
        local status = d.values.barcodeStatus
        local subject = nil
        for _, id in ipairs(SubjectList.FIELDS) do
            if d.values[id] and d.values[id] ~= "" then
                subject = subject or {}
                subject[id] = d.values[id]
            end
        end
        items[i] = {
            subject = subject,
            photo = d.photo,
            name = d.displayName,
            source = source,
            destination = props.destination ~= KEYWORD and d.values[props.destination] or nil,
            -- A card whose code couldn't be read (or that only has the other kind
            -- of code) must not inherit the previous subject's value.
            breaks = fromBarcode and not source
                     and (status == "Read Error" or (status == "Found" and d.values.barcodeValue ~= nil)),
        }
    end
    return Propagation.plan(items, optionsFrom(props))
end

local function describePlan(data, props)
    if props.source == props.destination then
        return "Source and destination are the same field."
    end
    local assignments, groups, ungrouped, breaks = makePlan(data, props)
    local lines = {
        plural(#data, "photo") .. " in " .. plural(#groups, "group")
            .. "; " .. plural(#assignments, "photo") .. " will be updated.",
    }
    if #groups == 0 then
        table.insert(lines, "No photos have a value in the source field."
                            .. " Run Detect Barcodes first if you haven't.")
    end
    if #breaks > 0 then
        local names = {}
        for i = 1, math.min(#breaks, 3) do
            table.insert(names, breaks[i].name)
        end
        table.insert(lines, "WARNING: " .. plural(#breaks, "barcode photo") .. " without a readable source"
                            .. " value (" .. table.concat(names, ", ") .. (#breaks > 3 and ", ..." or "")
                            .. "). Photos after them are left alone.")
    end
    if ungrouped > 0 then
        table.insert(lines, plural(ungrouped, "photo") .. " outside any group will be left alone.")
    end
    if props.copySubject then
        local copied, withSubject = 0, 0
        for _, g in ipairs(groups) do
            if g.item.subject then
                withSubject = withSubject + 1
                copied = copied + #g.members
            end
        end
        if withSubject > 0 then
            table.insert(lines, string.format("Subject details from %s will be copied to %s.",
                                              plural(withSubject, "card"), plural(copied, "photo")))
        end
    end
    table.insert(lines, "")
    local shown = math.min(#groups, 6)
    for i = 1, shown do
        local value = groups[i].value
        if #value > 40 then
            value = value:sub(1, 37) .. "..."
        end
        table.insert(lines, value .. "  \226\134\146  " .. plural(groups[i].count, "photo"))
    end
    if #groups > shown then
        table.insert(lines, "...and " .. plural(#groups - shown, "more group"))
    end
    return table.concat(lines, "\n")
end

local function showDialog(context, data)
    local f = LrView.osFactory()
    local bind = LrView.bind
    local props = LrBinding.makePropertyTable(context)

    props.source = Prefs.propagateSource
    props.destination = Prefs.propagateDestination
    props.order = Prefs.propagateOrder
    props.includeSource = Prefs.propagateIncludeSource
    props.onlyEmpty = Prefs.propagateOnlyEmpty
    props.limitEnabled = Prefs.propagateLimitEnabled
    props.limit = Prefs.propagateLimit
    props.sequence = Prefs.propagateSequence
    props.separator = Prefs.propagateSequenceSeparator
    props.padding = Prefs.propagatePadding
    props.keywordParent = Prefs.keywordParent
    props.copySubject = Prefs.propagateSubject

    local function refresh()
        props.isKeyword = props.destination == KEYWORD
        props.preview = describePlan(data, props)
    end
    for _, key in ipairs { 'source', 'destination', 'order', 'includeSource', 'onlyEmpty',
                           'limitEnabled', 'limit', 'sequence', 'separator', 'padding', 'copySubject' } do
        props:addObserver(key, refresh)
    end
    refresh()

    local labelWidth = LrView.share('labelWidth')

    local contents = f:column {
        bind_to_object = props,
        spacing = f:control_spacing(),

        f:row {
            f:static_text { title = "Source field:", alignment = 'right', width = labelWidth },
            f:popup_menu { value = bind 'source', items = sourceItems, width_in_chars = 16 },
        },
        f:row {
            f:static_text { title = "Destination field:", alignment = 'right', width = labelWidth },
            f:popup_menu { value = bind 'destination', items = destinationItems, width_in_chars = 16 },
        },
        f:row {
            f:static_text { title = "Photo order:", alignment = 'right', width = labelWidth },
            f:popup_menu { value = bind 'order', items = orderItems, width_in_chars = 16 },
        },
        f:row {
            f:static_text { title = "Parent keyword:", alignment = 'right', width = labelWidth,
                            enabled = bind 'isKeyword' },
            f:edit_field { value = bind 'keywordParent', width_in_chars = 20, enabled = bind 'isKeyword' },
        },

        f:separator { fill_horizontal = 1 },

        f:checkbox {
            title = "Also write the value to the photo containing the barcode",
            value = bind 'includeSource',
        },
        f:checkbox {
            title = "Only fill photos whose destination field is empty",
            value = bind 'onlyEmpty',
            enabled = LrView.bind {
                key = 'destination',
                transform = function(value) return value ~= KEYWORD end,
            },
        },
        f:row {
            f:checkbox {
                title = "Limit photos per group to",
                value = bind 'limitEnabled',
            },
            f:edit_field {
                value = bind 'limit',
                enabled = bind 'limitEnabled',
                width_in_digits = 4,
                min = 0,
                max = 9999,
                precision = 0,
            },
        },
        f:row {
            f:checkbox {
                title = "Append a sequence number within each group, separated by",
                value = bind 'sequence',
            },
            f:edit_field {
                value = bind 'separator',
                enabled = bind 'sequence',
                width_in_chars = 2,
            },
            f:popup_menu {
                value = bind 'padding',
                enabled = bind 'sequence',
                items = paddingItems,
            },
        },

        f:checkbox {
            title = "Also copy Subject Name, Subject Group and Access Code to each subject's photos",
            value = bind 'copySubject',
        },

        f:separator { fill_horizontal = 1 },

        f:static_text {
            title = bind 'preview',
            width_in_chars = 60,
            height_in_lines = 12,
        },
    }

    local result = LrDialogs.presentModalDialog {
        title = "Propagate Barcode Metadata",
        contents = contents,
        actionVerb = "Propagate",
    }
    if result ~= 'ok' then
        return nil
    end

    Prefs.propagateSource = props.source
    Prefs.propagateDestination = props.destination
    Prefs.propagateOrder = props.order
    Prefs.propagateIncludeSource = props.includeSource
    Prefs.propagateOnlyEmpty = props.onlyEmpty
    Prefs.propagateLimitEnabled = props.limitEnabled
    Prefs.propagateLimit = props.limit
    Prefs.propagateSequence = props.sequence
    Prefs.propagateSequenceSeparator = props.separator
    Prefs.propagatePadding = props.padding
    Prefs.keywordParent = props.keywordParent
    Prefs.propagateSubject = props.copySubject
    return props
end

local function applyPlan(catalog, assignments, groups, props)
    local failures = {}
    local copied = 0
    local isKeyword = props.destination == KEYWORD

    catalog:withWriteAccessDo("Propagate Barcode Metadata", function()
        local parent
        local parentName = Propagation.trim(props.keywordParent)
        if isKeyword and parentName then
            parent = catalog:createKeyword(parentName, {}, false, nil, true)
        end
        local keywords = {}

        for _, assignment in ipairs(assignments) do
            local ok, err = pcall(function()
                if isKeyword then
                    -- Commas separate keywords in Lightroom's UI, so avoid them in names.
                    local name = assignment.value:gsub(",", " ")
                    local keyword = keywords[name]
                    if not keyword then
                        keyword = catalog:createKeyword(name, {}, true, parent, true)
                        keywords[name] = keyword
                    end
                    assignment.photo:addKeyword(keyword)
                else
                    assignment.photo:setRawMetadata(props.destination, assignment.value)
                end
            end)
            if not ok then
                table.insert(failures, tostring(err))
            end
        end

        -- Each card's subject details go to every photo in its group, so they
        -- can be filtered, searched and exported per subject.
        if props.copySubject then
            for _, group in ipairs(groups) do
                local subject = group.item.subject
                if subject then
                    for _, photo in ipairs(group.members) do
                        for _, id in ipairs(SubjectList.FIELDS) do
                            photo:setPropertyForPlugin(_PLUGIN, id, subject[id])
                        end
                        copied = copied + 1
                    end
                end
            end
        end
    end, { timeout = 60 })

    return failures, copied
end

local function propagate(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    if #photos == 0 then
        LrDialogs.message("Propagate Barcode Metadata", "Select the photos to update first.", "info")
        return
    end

    local data = loadPhotoData(catalog, photos)
    local props = showDialog(context, data)
    if not props or props.source == props.destination then
        return
    end

    local assignments, groups = makePlan(data, props)
    local hasSubjects = false
    for _, g in ipairs(groups) do
        if g.item.subject and #g.members > 0 then hasSubjects = true end
    end
    if #assignments == 0 and not (props.copySubject and hasSubjects) then
        LrDialogs.message("Propagate Barcode Metadata", "There was nothing to update.", "info")
        return
    end

    local failures, copied = applyPlan(catalog, assignments, groups, props)
    local message = "Updated " .. plural(#assignments - #failures, "photo") .. "."
    if copied > 0 then
        message = message .. " Copied subject details to " .. plural(copied, "photo") .. "."
    end
    if #failures > 0 then
        message = message .. "\n\n" .. plural(#failures, "photo") .. " could not be updated:\n"
                  .. failures[1]
        LrDialogs.message("Propagate Barcode Metadata", message, "warning")
    else
        LrDialogs.message("Propagate Barcode Metadata", message, "info")
    end
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("propagateMetadata", propagate)
end)
