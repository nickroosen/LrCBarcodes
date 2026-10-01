--[[
The loaded subject list. A copy of the CSV is kept in Lightroom's app data
folder so lookups keep working if the original file is moved, and so Detect
Barcodes can match new scans automatically.
]]

local LrDate = import 'LrDate'
local LrFileUtils = import 'LrFileUtils'
local LrPathUtils = import 'LrPathUtils'

local Prefs = require 'Prefs'
local SubjectList = require 'SubjectList'

local SubjectStore = {}

local function storePath()
    return LrPathUtils.child(LrPathUtils.getStandardFilePath('appData'), 'LrCBarcodes Subject List.csv')
end

local cached = nil  -- parsed list, built on first use

-- Parses a CSV file. Returns list, or nil and an error message.
function SubjectStore.read(path)
    local text = LrFileUtils.readFile(path)
    if not text then
        return nil, "Could not read " .. path
    end
    return SubjectList.build(text)
end

-- Makes `path` the current subject list.
function SubjectStore.save(path, list)
    local dest = storePath()
    if LrFileUtils.exists(dest) then
        LrFileUtils.delete(dest)
    end
    local ok = LrFileUtils.copy(path, dest)
    Prefs.subjectListName = LrPathUtils.leafName(path)
    Prefs.subjectListCount = #list.subjects
    Prefs.subjectListLoaded = LrDate.timeToUserFormat(LrDate.currentTime(), "%Y-%m-%d %H:%M")
    cached = list
    return ok
end

-- The current list, or nil if none is loaded.
function SubjectStore.current()
    if cached then
        return cached
    end
    local path = storePath()
    if not Prefs.subjectListName or not LrFileUtils.exists(path) then
        return nil
    end
    cached = SubjectStore.read(path)
    return cached
end

function SubjectStore.describe()
    if not Prefs.subjectListName then
        return nil
    end
    return string.format("%s (%d subjects, loaded %s)", Prefs.subjectListName,
                         Prefs.subjectListCount or 0, Prefs.subjectListLoaded or "?")
end

function SubjectStore.forget()
    local path = storePath()
    if LrFileUtils.exists(path) then
        LrFileUtils.delete(path)
    end
    Prefs.subjectListName = nil
    Prefs.subjectListCount = 0
    Prefs.subjectListLoaded = nil
    cached = nil
end

-- Writes subject fields for one photo from its scanned codes. Must be called
-- inside a catalog write gate. Returns true if the photo matched a subject.
function SubjectStore.apply(list, photo, codes)
    local fields = codes and SubjectList.lookup(list, codes) or nil
    for _, id in ipairs(SubjectList.FIELDS) do
        photo:setPropertyForPlugin(_PLUGIN, id, fields and fields[id] or nil)
    end
    return fields ~= nil
end

return SubjectStore
