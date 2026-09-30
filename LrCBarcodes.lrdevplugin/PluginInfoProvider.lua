local LrView = import 'LrView'

local Prefs = require 'Prefs'

local previewSizes = {
    { title = "1024 px (fastest)", value = 1024 },
    { title = "1600 px",           value = 1600 },
    { title = "2048 px (default)", value = 2048 },
    { title = "3000 px",           value = 3000 },
    { title = "4096 px (slowest)", value = 4096 },
}

return {
    sectionsForTopOfDialog = function(f, _)
        return {
            {
                title = "Barcode Detection",
                bind_to_object = Prefs,

                f:row {
                    f:static_text { title = "Scan preview size:" },
                    f:popup_menu {
                        value = LrView.bind 'previewSize',
                        items = previewSizes,
                    },
                },
                f:static_text {
                    title = "Photos are scanned from Lightroom-rendered previews, so RAW files are supported."
                        .. " Increase the size if small barcodes are missed. Sizes above your"
                        .. " standard preview size may need 1:1 previews to take effect.",
                    width_in_chars = 70,
                    height_in_lines = 3,
                },
            },
            {
                title = "Credits",
                f:static_text {
                    title = "Inspired by LR Barcodes by Capture Monkey, and based on the open-source"
                        .. " LrCBarcodes by Lee Whittaker (Okomikeruko).\n"
                        .. "Barcode decoding by ZXing-C++ (Apache License 2.0).",
                    width_in_chars = 70,
                    height_in_lines = 3,
                },
            },
        }
    end,
}
