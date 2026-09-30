--[[
Parses the output of `ZXingReader -1 <file>...`.

Each barcode produces one line:
    <file> <format> "<text>"     decoded barcode
    <file> <format> <error>      barcode located but not decodable
    <file> None                  nothing found in the image
Images the reader cannot open produce no stdout line at all.

<format> may contain spaces ("QR Code", "Code 128"), so file names passed to the
reader must not. <text> is escaped: control characters appear as "<LF>", "<GS>",
etc. and non-graphical code points as "<U+XXXX>". Quotes are not escaped.

This module is pure Lua (no Lightroom imports) so it can be tested standalone.
]]

local ReaderOutput = {}

local controlNames = {
    "NUL", "SOH", "STX", "ETX", "EOT", "ENQ", "ACK", "BEL",
    "BS",  "HT",  "LF",  "VT",  "FF",  "CR",  "SO",  "SI",
    "DLE", "DC1", "DC2", "DC3", "DC4", "NAK", "SYN", "ETB",
    "CAN", "EM",  "SUB", "ESC", "FS",  "GS",  "RS",  "US",
}
local controlCodes = { DEL = 127 }
for i, name in ipairs(controlNames) do
    controlCodes[name] = i - 1
end

local function utf8Char(cp)
    if cp < 0x80 then
        return string.char(cp)
    elseif cp < 0x800 then
        return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40)
    elseif cp < 0x10000 then
        return string.char(0xE0 + math.floor(cp / 0x1000),
                           0x80 + math.floor(cp / 0x40) % 0x40,
                           0x80 + cp % 0x40)
    else
        return string.char(0xF0 + math.floor(cp / 0x40000),
                           0x80 + math.floor(cp / 0x1000) % 0x40,
                           0x80 + math.floor(cp / 0x40) % 0x40,
                           0x80 + cp % 0x40)
    end
end

function ReaderOutput.unescape(text)
    text = text:gsub("<U%+(%x+)>", function(hex)
        local cp = tonumber(hex, 16)
        if cp and cp <= 0x10FFFF then
            return utf8Char(cp)
        end
    end)
    text = text:gsub("<(%u%u%u?%d?)>", function(name)
        local code = controlCodes[name]
        if code then
            return string.char(code)
        end
    end)
    return text
end

-- Returns a table keyed by file name:
--   { barcodes = { { format = "QR Code", text = "..." }, ... }, errors = { "..." } }
-- Files with no entry were not readable by ZXingReader.
function ReaderOutput.parse(output)
    local results = {}
    for line in (output or ""):gmatch("[^\r\n]+") do
        local file, rest = line:match("^(%S+) (.*)$")
        if file then
            local entry = results[file]
            if not entry then
                entry = { barcodes = {}, errors = {} }
                results[file] = entry
            end
            if rest ~= "None" then
                local format, text = rest:match('^(.-) "(.*)"$')
                if format then
                    text = ReaderOutput.unescape(text)
                    -- Structured-append merges can repeat a barcode; keep each once.
                    local duplicate = false
                    for _, b in ipairs(entry.barcodes) do
                        if b.format == format and b.text == text then
                            duplicate = true
                            break
                        end
                    end
                    if not duplicate then
                        table.insert(entry.barcodes, { format = format, text = text })
                    end
                else
                    table.insert(entry.errors, rest)
                end
            end
        end
    end
    return results
end

-- Plug-in metadata fields that hold decoded barcode data (besides barcodeStatus).
ReaderOutput.FIELDS = { 'barcodeType', 'barcodeValue', 'matrixValue', 'linearValue' }

-- 2D symbologies; everything else ZXing reads is a linear (1D) barcode.
local matrixPatterns = { "QR", "Data Matrix", "Aztec", "PDF417", "MaxiCode" }

function ReaderOutput.isMatrix(format)
    for _, pattern in ipairs(matrixPatterns) do
        if format:find(pattern, 1, true) then
            return true
        end
    end
    return false
end

-- Maps a photo's barcodes to plug-in field values. barcodeType/barcodeValue hold
-- every barcode; matrixValue/linearValue split them by kind so, for example, the
-- QR code and the Code 128 on the same card can be propagated separately.
-- Fields with no barcodes are nil.
function ReaderOutput.toFields(barcodes)
    local lists = { barcodeType = {}, barcodeValue = {}, matrixValue = {}, linearValue = {} }
    for _, barcode in ipairs(barcodes) do
        table.insert(lists.barcodeType, barcode.format)
        table.insert(lists.barcodeValue, barcode.text)
        local kind = ReaderOutput.isMatrix(barcode.format) and 'matrixValue' or 'linearValue'
        table.insert(lists[kind], barcode.text)
    end
    local fields = {}
    for key, list in pairs(lists) do
        if #list > 0 then
            fields[key] = table.concat(list, "; ")
        end
    end
    return fields
end

return ReaderOutput
