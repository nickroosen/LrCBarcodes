--[[
Smart collections that group photos by Barcode Status, in an "LrC Barcodes"
collection set. They are catalog-wide and update automatically as photos are
scanned; creating them again reuses the existing ones.
]]

local SmartCollections = {}

local SET_NAME = "LrC Barcodes"

-- "beginsWith" rather than an exact match: it's the most reliable text operator,
-- and no status is a prefix of another ("Found" vs "Not Found").
local collections = {
    { name = "Barcode Found", status = "Found" },
    { name = "No Barcode",    status = "Not Found" },
}

local function searchFor(status)
    return {
        {
            criteria = "sdktext:" .. _PLUGIN.id .. ".barcodeStatus",
            operation = "beginsWith",
            value = status,
        },
        combine = "intersect",
    }
end

function SmartCollections.ensure(catalog)
    catalog:withWriteAccessDo("Create Barcode Smart Collections", function()
        local set = catalog:createCollectionSet(SET_NAME, nil, true)
        for _, c in ipairs(collections) do
            catalog:createSmartCollection(c.name, searchFor(c.status), set, true)
        end
    end, { timeout = 10 })
end

return SmartCollections
