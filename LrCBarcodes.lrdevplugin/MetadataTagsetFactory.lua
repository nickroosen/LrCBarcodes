-- Field ids must be prefixed with the plug-in's LrToolkitIdentifier.
local prefix = 'com.github.nickroosen.lrcbarcodes.'

return {
    title = "LrC Barcodes",
    id = "lrcBarcodesTagset",
    items = {
        prefix .. 'barcodeStatus',
        prefix .. 'barcodeType',
        prefix .. 'barcodeValue',
        prefix .. 'matrixValue',
        prefix .. 'linearValue',

        'com.adobe.separator',

        prefix .. 'subjectName',
        prefix .. 'subjectGroup',
        prefix .. 'accessCode',

        'com.adobe.separator',

        'com.adobe.filename',
        'com.adobe.copyname',
        'com.adobe.title',
        'com.adobe.caption',
    },
}
