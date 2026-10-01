--[[
Subject lists: match scanned codes to subjects (pure Lua, no Lightroom imports).

A subject list is a CSV, typically the companion app's "Export results" file
(Name, Class, Access Code, Card, Barcode, Gallery Link, QR Content, ...) or
any roster with a column the barcodes on the cards contain: a gallery link, an
access code or a barcode number. Each such value becomes a lookup key, so a
photo whose QR code or 1D barcode matches gets the subject's name, group and
access code.
]]

local SubjectList = {}

local function trim(s)
    return (s or ""):match("^%s*(.-)%s*$")
end

-- Picks the delimiter that splits the header line into the most columns.
local function detectDelimiter(text)
    local firstLine = text:match("^[^\r\n]*") or ""
    local best, bestCount = ",", 0
    for _, d in ipairs { ",", ";", "\t" } do
        local count, inQuotes = 0, false
        for i = 1, #firstLine do
            local ch = firstLine:sub(i, i)
            if ch == '"' then
                inQuotes = not inQuotes
            elseif ch == d and not inQuotes then
                count = count + 1
            end
        end
        if count > bestCount then
            best, bestCount = d, count
        end
    end
    return best
end

-- RFC 4180 parser: quoted fields, escaped quotes, embedded newlines, BOM.
-- Returns headers, rows (each row a table keyed by header). Blank lines are skipped.
function SubjectList.parseCSV(text)
    text = (text or ""):gsub("^\239\187\191", "")
    local delimiter = detectDelimiter(text)
    local records, record, field = {}, {}, {}
    local inQuotes = false
    local i, n = 1, #text
    while i <= n do
        local ch = text:sub(i, i)
        if inQuotes then
            if ch == '"' then
                if text:sub(i + 1, i + 1) == '"' then
                    field[#field + 1] = '"'
                    i = i + 1
                else
                    inQuotes = false
                end
            else
                field[#field + 1] = ch
            end
        elseif ch == '"' and #field == 0 then
            inQuotes = true
        elseif ch == delimiter then
            record[#record + 1] = table.concat(field)
            field = {}
        elseif ch == "\r" or ch == "\n" then
            record[#record + 1] = table.concat(field)
            field = {}
            records[#records + 1] = record
            record = {}
            if ch == "\r" and text:sub(i + 1, i + 1) == "\n" then
                i = i + 1
            end
        else
            field[#field + 1] = ch
        end
        i = i + 1
    end
    if #field > 0 or #record > 0 then
        record[#record + 1] = table.concat(field)
        records[#records + 1] = record
    end

    local nonEmpty = {}
    for _, r in ipairs(records) do
        for _, v in ipairs(r) do
            if trim(v) ~= "" then
                nonEmpty[#nonEmpty + 1] = r
                break
            end
        end
    end
    if #nonEmpty == 0 then
        return {}, {}
    end

    local headers = {}
    for idx, h in ipairs(nonEmpty[1]) do
        h = trim(h)
        headers[idx] = h ~= "" and h or ("Column " .. idx)
    end
    local rows = {}
    for r = 2, #nonEmpty do
        local row = {}
        for idx, h in ipairs(headers) do
            row[h] = trim(nonEmpty[r][idx])
        end
        rows[#rows + 1] = row
    end
    return headers, rows
end

local function findHeader(headers, patterns)
    for _, pattern in ipairs(patterns) do
        for _, h in ipairs(headers) do
            if h:lower():match(pattern) then
                return h
            end
        end
    end
    return nil
end

-- Columns whose values identify a subject on a card. Order matters only for
-- reporting; every one becomes a lookup key.
local KEY_PATTERNS = {
    "^qr content$", "^gallery link$", "^link$", "^url$", "^access ?code$", "^code$",
    "^barcode$", "^barcode number$", "^identifier$", "^subject id$", "^student id$", "^id$",
}

local function urlShare(rows, column)
    local urls, total = 0, 0
    for _, row in ipairs(rows) do
        local v = row[column]
        if v and v ~= "" then
            total = total + 1
            if v:match("^[Hh][Tt][Tt][Pp][Ss]?://") then
                urls = urls + 1
            end
        end
    end
    return total > 0 and urls / total or 0
end

--[[
Detects which columns hold what. Returns:
    { name = header or nil, first = header, last = header, group = header,
      accessCode = header, keys = { header, ... } }
]]
function SubjectList.detectColumns(headers, rows)
    local columns = {
        first = findHeader(headers, { "^first ?name$", "^firstname$", "^given ?name$", "^vorname$", "^first$" }),
        last = findHeader(headers, { "^last ?name$", "^lastname$", "^surname$", "^family ?name$", "^nachname$", "^last$" }),
        name = findHeader(headers, { "^name$", "^full ?name$", "^subject$", "^student$", "^player$", "^subject name$" }),
        group = findHeader(headers, { "^class$", "^group$", "^team$", "^grade$", "^homeroom$", "^teacher$",
                                      "class", "group", "team", "grade" }),
        accessCode = findHeader(headers, { "^access ?code$", "^code$" }),
        keys = {},
    }
    local seen = {}
    for _, pattern in ipairs(KEY_PATTERNS) do
        for _, h in ipairs(headers) do
            if not seen[h] and h:lower():match(pattern) then
                seen[h] = true
                columns.keys[#columns.keys + 1] = h
            end
        end
    end
    -- Any other column that is mostly links (e.g. a renamed gallery link column).
    for _, h in ipairs(headers) do
        if not seen[h] and urlShare(rows, h) >= 0.8 then
            seen[h] = true
            columns.keys[#columns.keys + 1] = h
        end
    end
    return columns
end

local function normalizeKey(value)
    value = trim(value)
    if value == "" then
        return nil
    end
    -- Links compare without case in the scheme and host (the path stays
    -- case-sensitive: GotPhoto gallery codes are) or a trailing slash.
    if value:match("^[Hh][Tt][Tt][Pp][Ss]?://") then
        value = value:gsub("^([^/]*//[^/]*)", string.lower):gsub("/+$", "")
    end
    return value
end

--[[
Builds a subject list from CSV text. Returns list, or nil and an error message.
    list = { subjects = { { name, group, accessCode }, ... },
             index = { [key] = subject }, columns = ..., duplicates = n }
]]
function SubjectList.build(text)
    local headers, rows = SubjectList.parseCSV(text)
    if #headers == 0 or #rows == 0 then
        return nil, "The file has no rows. Is it a CSV with a header row?"
    end
    local columns = SubjectList.detectColumns(headers, rows)
    if #columns.keys == 0 then
        return nil, "No column with gallery links, access codes or barcode numbers was found."
    end

    local list = { subjects = {}, index = {}, columns = columns, duplicates = 0 }
    for _, row in ipairs(rows) do
        local name = columns.name and row[columns.name] or ""
        if name == "" then
            name = trim(((columns.first and row[columns.first]) or "") .. " " .. ((columns.last and row[columns.last]) or ""))
        end
        local subject = {
            name = name,
            group = columns.group and row[columns.group] or "",
            accessCode = columns.accessCode and row[columns.accessCode] or "",
        }
        local hasKey = false
        for _, h in ipairs(columns.keys) do
            local key = normalizeKey(row[h])
            if key then
                hasKey = true
                if list.index[key] and list.index[key] ~= subject then
                    list.duplicates = list.duplicates + 1
                else
                    list.index[key] = subject
                end
            end
        end
        if hasKey then
            list.subjects[#list.subjects + 1] = subject
        end
    end
    return list
end

local function split(values)
    local parts = {}
    for part in ((values or "") .. ";"):gmatch("(.-);") do
        local key = normalizeKey(part)
        if key then
            parts[#parts + 1] = key
        end
    end
    return parts
end

--[[
Looks up a photo's scanned codes (the plug-in's "; "-separated barcode values).
Returns the subject fields { subjectName, subjectGroup, accessCode } joined with
"; " when several subjects match (siblings), or nil when none match.
]]
function SubjectList.lookup(list, codes)
    local matched, seen = {}, {}
    for _, key in ipairs(split(codes)) do
        local subject = list.index[key]
        if subject and not seen[subject] then
            seen[subject] = true
            matched[#matched + 1] = subject
        end
    end
    if #matched == 0 then
        return nil
    end
    local names, groups, codesOut, seenGroup = {}, {}, {}, {}
    for _, s in ipairs(matched) do
        if s.name ~= "" then names[#names + 1] = s.name end
        if s.group ~= "" and not seenGroup[s.group] then
            seenGroup[s.group] = true
            groups[#groups + 1] = s.group
        end
        if s.accessCode ~= "" then codesOut[#codesOut + 1] = s.accessCode end
    end
    local function joined(t)
        return #t > 0 and table.concat(t, "; ") or nil
    end
    return { subjectName = joined(names), subjectGroup = joined(groups), accessCode = joined(codesOut) }
end

SubjectList.FIELDS = { "subjectName", "subjectGroup", "accessCode" }

return SubjectList
