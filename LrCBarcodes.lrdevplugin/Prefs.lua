local LrPrefs = import 'LrPrefs'

local defaults = {
    -- Long edge (px) of the preview rendered for scanning. Larger finds smaller
    -- barcodes but is slower, and is capped by the size of Lightroom's previews.
    previewSize = 2048,
    skipAlreadyScanned = false,
    fullSizeRescan = true,
    createSmartCollections = true,

    propagateSource = "barcodeValue",
    propagateDestination = "title",
    propagateOrder = "captureTime",
    propagateOnlyEmpty = false,
    propagateIncludeSource = true,
    propagateLimitEnabled = false,
    propagateLimit = 10,
    propagateSequence = false,
    propagateSequenceSeparator = "_",
    propagatePadding = 1,
    keywordParent = "LrCBarcodes",
    propagateSubject = true,
    -- Last subject list loaded (the file itself is copied to the app data folder).
    subjectListName = nil,
    subjectListCount = 0,
    subjectListLoaded = nil,
}

local prefs = LrPrefs.prefsForPlugin()
for key, value in pairs(defaults) do
    if prefs[key] == nil then
        prefs[key] = value
    end
end

return prefs
