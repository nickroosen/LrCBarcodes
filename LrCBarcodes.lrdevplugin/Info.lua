local menuItems = {
    {
        title = "Detect Barcodes...",
        file = "DetectBarcodes.lua",
        enabledWhen = "photosAvailable",
    },
    {
        title = "Propagate Barcode Metadata...",
        file = "PropagateMetadata.lua",
        enabledWhen = "photosAvailable",
    },
    {
        title = "Load Subject List...",
        file = "LoadSubjectList.lua",
        enabledWhen = "photosAvailable",
    },
    {
        title = "Clear Barcode Data...",
        file = "ClearBarcodes.lua",
        enabledWhen = "photosAvailable",
    },
}

return {
    LrSdkVersion = 10.0,
    LrSdkMinimumVersion = 6.0,
    LrToolkitIdentifier = 'com.github.nickroosen.lrcbarcodes',
    LrPluginName = "LrC Barcodes",
    LrPluginInfoUrl = "https://github.com/nickroosen/LrCBarcodes",
    LrPluginInfoProvider = 'PluginInfoProvider.lua',

    LrMetadataProvider = 'MetadataProvider.lua',
    LrMetadataTagsetFactory = 'MetadataTagsetFactory.lua',

    -- File > Plug-in Extras
    LrExportMenuItems = menuItems,
    -- Library > Plug-in Extras
    LrLibraryMenuItems = menuItems,

    VERSION = { major = 2, minor = 1, revision = 0, build = 0 },
}
