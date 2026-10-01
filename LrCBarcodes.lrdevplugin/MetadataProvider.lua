return {
    metadataFieldsForPhotos = {
        {
            -- "Found", "Not Found" or "Read Error"; handy for Library filters
            -- (e.g. hide the barcode card shots after propagating).
            id = "barcodeStatus",
            title = "Barcode Status",
            dataType = "string",
            readOnly = true,
            searchable = true,
            browsable = true,
        },
        {
            id = "barcodeType",
            title = "Barcode Type",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
        {
            id = "barcodeValue",
            title = "Barcode Value",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
        {
            -- QR Code, Data Matrix, Aztec, PDF417, MaxiCode
            id = "matrixValue",
            title = "QR / 2D Code Value",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
        {
            -- Code 128, EAN/UPC, Code 39, ITF, etc.
            id = "linearValue",
            title = "Linear Barcode Value",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
        -- Filled in from a subject list (Load Subject List...) by matching the
        -- scanned codes, and copied to each subject's photos by Propagate.
        {
            id = "subjectName",
            title = "Subject Name",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
        {
            id = "subjectGroup",
            title = "Subject Group",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
        {
            id = "accessCode",
            title = "Access Code",
            dataType = "string",
            searchable = true,
            browsable = true,
        },
    },
    schemaVersion = 3,
}
