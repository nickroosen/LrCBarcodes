--[[
Metadata propagation planning (pure Lua, no Lightroom imports).

Given photos in shooting order, every photo with a non-empty source value starts a
new group; that value is copied to the photos that follow until the next one.
Typical use (volume photography): shoot a subject's barcode/QR card, then the
subject; repeat for each subject.
]]

local Propagation = {}

local function trim(s)
    if type(s) ~= 'string' then
        return nil
    end
    s = s:match("^%s*(.-)%s*$")
    if s == "" then
        return nil
    end
    return s
end
Propagation.trim = trim

--[[
items: ordered list of { photo =, source =, destination =, breaks = <bool> }
    breaks marks a photo that looks like a barcode card but has no usable source
    value (e.g. its QR code could not be read). It ends the current group, so the
    photos after it are left alone rather than given the previous group's value.
options:
    includeSource       also write the value to the photo that carries it
    onlyEmpty           skip photos whose destination already has a value
    limit               max photos per group after the source photo (nil = unlimited)
    sequence            append a per-group sequence number
    separator           text between value and sequence number
    padding             minimum digits for the sequence number

Returns:
    assignments  list of { photo =, value = }
    groups       list of { value =, count =, item =, members = }
                 count: photos whose destination will be written
                 item: the source item that started the group
                 members: photos after it that belong to the group (within the
                          limit), whether or not their destination is written
    ungrouped    number of photos not in any group
    breaks       list of items that ended a group without starting a new one
]]
function Propagation.plan(items, options)
    local assignments, groups, breaks = {}, {}, {}
    local ungrouped = 0
    local current, group, sequence = nil, nil, 0
    local format = "%s%s%0" .. math.max(1, tonumber(options.padding) or 1) .. "d"

    for _, item in ipairs(items) do
        local source = trim(item.source)
        local value

        if source then
            current = source
            sequence = 0
            group = { value = source, count = 0, item = item, members = {} }
            table.insert(groups, group)
            if options.includeSource then
                value = source
            end
        elseif item.breaks then
            current = nil
            table.insert(breaks, item)
            ungrouped = ungrouped + 1
        elseif current then
            if not options.limit or sequence < options.limit then
                sequence = sequence + 1
                table.insert(group.members, item.photo)
                if options.sequence then
                    value = string.format(format, current, options.separator or "", sequence)
                else
                    value = current
                end
            end
        else
            ungrouped = ungrouped + 1
        end

        if value and options.onlyEmpty and trim(item.destination) then
            value = nil
        end
        if value then
            group.count = group.count + 1
            table.insert(assignments, { photo = item.photo, value = value })
        end
    end

    return assignments, groups, ungrouped, breaks
end

return Propagation
