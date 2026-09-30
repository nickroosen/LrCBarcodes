local LrApplication = import 'LrApplication'
local LrDialogs = import 'LrDialogs'
local LrFunctionContext = import 'LrFunctionContext'
local LrTasks = import 'LrTasks'

local ReaderOutput = require 'ReaderOutput'

local function clearBarcodes(context)
    LrDialogs.attachErrorDialogToFunctionContext(context)

    local catalog = LrApplication.activeCatalog()
    local photos = catalog:getTargetPhotos()
    if #photos == 0 then
        return
    end

    local confirm = LrDialogs.confirm(
        "Clear barcode data from " .. #photos .. " photo" .. (#photos == 1 and "" or "s") .. "?",
        "All barcode fields will be removed. Fields and keywords written by"
            .. " Propagate Barcode Metadata are not affected.",
        "Clear")
    if confirm ~= 'ok' then
        return
    end

    catalog:withPrivateWriteAccessDo(function()
        for _, photo in ipairs(photos) do
            photo:setPropertyForPlugin(_PLUGIN, 'barcodeStatus', nil)
            for _, id in ipairs(ReaderOutput.FIELDS) do
                photo:setPropertyForPlugin(_PLUGIN, id, nil)
            end
        end
    end, { timeout = 60 })
end

LrTasks.startAsyncTask(function()
    LrFunctionContext.callWithContext("clearBarcodes", clearBarcodes)
end)
