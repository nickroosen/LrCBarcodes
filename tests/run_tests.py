"""
Tests for the pieces of the plug-in that can run outside Lightroom.

    pip install lupa segno
    python tests/run_tests.py

1. Every plug-in .lua file compiles under Lua 5.1 (Lightroom's Lua version).
2. ReaderOutput.lua and Propagation.lua unit tests.
3. End to end: generated QR codes -> the bundled reader for this OS -> ReaderOutput.parse.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from lupa import lua51

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "LrCBarcodes.lrdevplugin"
READERS = {"win32": "bin/win/ZXingReader.exe", "darwin": "bin/mac/ZXingReader"}
READER = PLUGIN / READERS[sys.platform] if sys.platform in READERS else None

failures = 0


def check(name, actual, expected):
    global failures
    if actual == expected:
        print(f"  ok    {name}")
    else:
        failures += 1
        print(f"  FAIL  {name}\n        expected {expected!r}\n        got      {actual!r}")


def new_lua():
    lua = lua51.LuaRuntime(encoding=None, unpack_returned_tuples=True)  # keep Lua strings as bytes
    lua.execute(f"package.path = [[{PLUGIN.as_posix()}/?.lua;]] .. package.path".encode())
    return lua


def to_py(value):
    """Convert Lua tables (recursively) to dicts/lists and bytes to str."""
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if lua51.lua_type(value) == "table":
        keys = list(value.keys())
        if keys and all(isinstance(k, int) for k in keys) and sorted(keys) == list(range(1, len(keys) + 1)):
            return [to_py(value[k]) for k in sorted(keys)]
        return {to_py(k): to_py(value[k]) for k in keys}
    return value


def test_compile():
    print("Compile (Lua 5.1)")
    lua = new_lua()
    compile_error = lua.eval("function(src, name) local _, err = loadstring(src, name); return err end")
    for path in sorted(PLUGIN.glob("*.lua")):
        err = compile_error(path.read_bytes(), ("@" + path.name).encode())
        check(path.name, err and err.decode(), None)


def test_reader_output():
    print("ReaderOutput")
    lua = new_lua()
    ro = lua.eval("require 'ReaderOutput'")
    parse = lambda s: to_py(ro.parse(s.encode("utf-8")))

    out = parse(
        'p001.jpg QR Code "hello world"\n'
        "p002.jpg None\n"
        'p003.jpg EAN-13 "4006381333931"\r\n'
        'p003.jpg Code 128 "ABC "quoted" 123"\n'
        "p004.jpg QR Code ChecksumError\n"
        'p005.jpg QR Code "line1<LF>line2<HT>caf<U+E9> <GS> <FOO> <U+1F600>"\n'
        'p005.jpg QR Code "line1<LF>line2<HT>caf<U+E9> <GS> <FOO> <U+1F600>"\n'
    )
    check("decoded QR", out["p001.jpg"]["barcodes"], [{"format": "QR Code", "text": "hello world"}])
    check("none found", out["p002.jpg"], {"barcodes": {}, "errors": {}})
    check("multiple barcodes, spaces in format, inner quotes", out["p003.jpg"]["barcodes"], [
        {"format": "EAN-13", "text": "4006381333931"},
        {"format": "Code 128", "text": 'ABC "quoted" 123'},
    ])
    check("undecodable barcode", out["p004.jpg"], {"barcodes": {}, "errors": ["QR Code ChecksumError"]})
    check("unescape + dedupe", out["p005.jpg"]["barcodes"],
          [{"format": "QR Code", "text": "line1\nline2\tcafé \x1d <FOO> \U0001F600"}])
    check("unreadable file absent", "p006.jpg" in out, False)
    check("empty output", parse(""), {})

    to_fields = lambda barcodes: to_py(ro.toFields(lua.table_from(
        [lua.table_from({b"format": f.encode(), b"text": t.encode()}) for f, t in barcodes])))
    # A GotPhoto-style subject card: gallery QR plus a Code 128 subject number.
    check("QR + Code 128 split", to_fields([("QR Code", "https://x.gotphoto.com/gc/abc/"),
                                            ("Code 128", "193007209493883")]), {
        "barcodeType": "QR Code; Code 128",
        "barcodeValue": "https://x.gotphoto.com/gc/abc/; 193007209493883",
        "matrixValue": "https://x.gotphoto.com/gc/abc/",
        "linearValue": "193007209493883",
    })
    check("linear only", to_fields([("EAN-13", "4006381333931")]),
          {"barcodeType": "EAN-13", "barcodeValue": "4006381333931", "linearValue": "4006381333931"})
    check("2D kinds", [ro.isMatrix(f.encode()) for f in
                       ("Micro QR Code", "rMQR Code", "Data Matrix", "Aztec", "Compact PDF417", "MaxiCode",
                        "Code 128", "ITF-14", "DataBar Expanded")],
          [True] * 6 + [False] * 3)
    check("no barcodes", to_fields([]), {})


def test_propagation():
    print("Propagation")
    lua = new_lua()
    lua.execute(b"Propagation = require 'Propagation'")

    BREAK = object()  # marks an unreadable barcode card

    def plan(sources, dests=None, **options):
        dests = dests or [None] * len(sources)
        items = ",".join(
            "{photo=%d, source=%s, destination=%s, breaks=%s}" % (
                i + 1,
                "nil" if s is None or s is BREAK else "[[%s]]" % s,
                "nil" if d is None else "[[%s]]" % d,
                "true" if s is BREAK else "false")
            for i, (s, d) in enumerate(zip(sources, dests)))
        opts = ",".join("%s=%s" % (k, ("[[%s]]" % v) if isinstance(v, str) else str(v).lower())
                        for k, v in options.items())
        res = lua.execute(("local a, g, u, b = Propagation.plan({%s}, {%s}); return a, g, u, b" % (items, opts)).encode())
        assignments = {a["photo"]: a["value"] for a in to_py(res[0]) or []}
        groups = [(g["value"], g["count"]) for g in to_py(res[1]) or []]
        return assignments, groups, res[2], len(to_py(res[3]) or [])

    a, g, u, _ = plan([None, "A", None, None, " B ", None], includeSource=True)
    check("basic assignments", a, {2: "A", 3: "A", 4: "A", 5: "B", 6: "B"})
    check("basic groups", g, [("A", 3), ("B", 2)])
    check("ungrouped count", u, 1)

    a, _, _, _ = plan(["A", None, "", None], includeSource=False)
    check("exclude source; blank is not a source", a, {2: "A", 3: "A", 4: "A"})

    a, g, _, _ = plan(["A", None, None, None, "B", None], includeSource=True, limit=2)
    check("limit per group", a, {1: "A", 2: "A", 3: "A", 5: "B", 6: "B"})

    a, _, _, _ = plan(["A", None, None, "B", None], includeSource=True, sequence=True, separator="_", padding=2)
    check("sequence numbers", a, {1: "A", 2: "A_01", 3: "A_02", 4: "B", 5: "B_01"})

    a, g, _, _ = plan(["A", None, None], ["x", "keep", None], includeSource=True, onlyEmpty=True)
    check("only empty destinations", a, {3: "A"})
    check("only empty group count", g, [("A", 1)])

    a, g, u, b = plan(["A", None, BREAK, None, None, "B", None], includeSource=True)
    check("unreadable card stops the previous group", a, {1: "A", 2: "A", 6: "B", 7: "B"})
    check("break counted", (b, u), (1, 3))


def test_end_to_end():
    if READER is None:
        print("End to end: skipped (no bundled reader for %s)" % sys.platform)
        return
    print("End to end (%s)" % READER.relative_to(PLUGIN).as_posix())
    if not READER.exists():
        check("reader present", False, True)
        return
    import segno

    work = Path(tempfile.mkdtemp(prefix="lrcb test "))  # space in path on purpose
    try:
        texts = {
            "p001.jpg": "SKU-000123",
            "p002.jpg": 'Café "Déjà vu"\nline two',
            "p003.jpg": "https://example.com/?a=1&b=2",
        }
        for name, text in texts.items():
            png = work / (name + ".png")
            segno.make(text, error="m", micro=False).save(str(png), scale=8, border=4)
            # ZXingReader picks the loader by content, not extension; a PNG named .jpg is fine.
            png.rename(work / name)
        # Blank image with no barcode.
        segno.make("x").save(str(work / "blank.png"), scale=1, border=0, dark="white")
        (work / "blank.png").rename(work / "p004.jpg")
        # Corrupt file the reader cannot open.
        (work / "p005.jpg").write_bytes(b"not an image")

        names = ["p001.jpg", "p002.jpg", "p003.jpg", "p004.jpg", "p005.jpg"]
        out_path, err_path = work / "reader-output.txt", work / "reader-errors.txt"
        # Same shape of command line that Scanner.lua passes to LrTasks.execute.
        if os.name == "nt":
            command = 'cd /d "%s" && "%s" -1 %s >"%s" 2>"%s"' % (work, READER, " ".join(names), out_path, err_path)
            subprocess.run('cmd /s /c "' + command + '"', shell=False)
        else:
            import shlex
            q = lambda p: shlex.quote(str(p))
            command = "cd %s && %s -1 %s >%s 2>%s" % (q(work), q(READER), " ".join(names), q(out_path), q(err_path))
            subprocess.run(["/bin/sh", "-c", command])

        lua = new_lua()
        ro = lua.eval("require 'ReaderOutput'")
        out = to_py(ro.parse(out_path.read_bytes()))
        for name, text in texts.items():
            check(name, out.get(name, {}).get("barcodes"), [{"format": "QR Code", "text": text}])
        check("no barcode", out.get("p004.jpg"), {"barcodes": {}, "errors": {}})
        check("unreadable file", "p005.jpg" in out, False)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def test_propagation_members():
    print("Propagation groups (for copying subject details)")
    lua = new_lua()
    res = lua.execute(b"""
        local P = require 'Propagation'
        local items = {
            { photo = 1, source = 'A', subject = { subjectName = 'Ava' } },
            { photo = 2, destination = 'keep' }, { photo = 3 }, { photo = 4 },
            { photo = 5, breaks = true }, { photo = 6 },
            { photo = 7, source = 'B' }, { photo = 8 },
        }
        local _, groups = P.plan(items, { includeSource = true, onlyEmpty = true, limit = 2 })
        local out = {}
        for i, g in ipairs(groups) do
            out[i] = { value = g.value, source = g.item.photo, members = g.members,
                       name = g.item.subject and g.item.subject.subjectName or false }
        end
        return out
    """)
    check("members ignore 'only empty', respect the limit, stop at a break", to_py(res), [
        {"value": "A", "source": 1, "members": [2, 3], "name": "Ava"},
        {"value": "B", "source": 7, "members": [8], "name": False},
    ])


def test_subject_list():
    print("SubjectList")
    lua = new_lua()
    sl = lua.eval("require 'SubjectList'")

    # Shaped like the companion app's export (made-up data), with a BOM, CRLF,
    # quoted fields and a comma inside a name.
    csv = ("﻿Name,Class,Access Code,Card,Barcode,Gallery Link,QR Content,Status\r\n"
           "Ava Martínez,Room 4,QX7K2M9P,1.1,111122223333444,https://x.gotphoto.com/gc/Aaa111/,https://x.gotphoto.com/gc/Aaa111/,Photographed\r\n"
           "\"Johnson, Mia\",Room 5,WB2D8G5S,1.2,555566667777888,https://x.gotphoto.com/gc/Bbb222/,https://x.gotphoto.com/gc/Bbb222/,Photographed\r\n"
           "Ethan Johnson,Room 5,HN6T1Y4R,1.3,999900001111222,https://x.gotphoto.com/gc/Ccc333/,https://x.gotphoto.com/gc/Ccc333/,Absent\r\n"
           "Priya Shah,Room 5,,,,,WALKUP-001 Priya Shah,Photographed\r\n")
    res = lua.execute(b"local sl, text = ...; local list, err = sl.build(text); return list, err",
                      sl, csv.encode("utf-8"))
    lst, err = res if isinstance(res, tuple) else (res, None)
    check("builds", err, None)
    cols = to_py(lst[b"columns"])
    check("detects name/group/access code", (cols.get("name"), cols.get("group"), cols.get("accessCode")),
          ("Name", "Class", "Access Code"))
    check("key columns", cols["keys"], ["QR Content", "Gallery Link", "Access Code", "Barcode"])
    check("subject count", len(to_py(lst[b"subjects"])), 4)

    lookup = lambda codes: to_py(sl.lookup(lst, codes.encode("utf-8")))
    check("QR link (scheme case and trailing slash ignored)", lookup("HTTPS://x.gotphoto.com/gc/Aaa111"),
          {"subjectName": "Ava Martínez", "subjectGroup": "Room 4", "accessCode": "QX7K2M9P"})
    check("Code 128 number", lookup("999900001111222"),
          {"subjectName": "Ethan Johnson", "subjectGroup": "Room 5", "accessCode": "HN6T1Y4R"})
    check("siblings in one photo", lookup("https://x.gotphoto.com/gc/Bbb222/; https://x.gotphoto.com/gc/Ccc333/"),
          {"subjectName": "Johnson, Mia; Ethan Johnson", "subjectGroup": "Room 5", "accessCode": "WB2D8G5S; HN6T1Y4R"})
    check("QR and barcode of the same card count once", lookup("https://x.gotphoto.com/gc/Aaa111/; 111122223333444"),
          {"subjectName": "Ava Martínez", "subjectGroup": "Room 4", "accessCode": "QX7K2M9P"})
    check("walk-up QR content", lookup("WALKUP-001 Priya Shah"), {"subjectName": "Priya Shah", "subjectGroup": "Room 5"})
    check("no match", lookup("https://x.gotphoto.com/gc/Zzz999/"), None)

    # A plain roster: first/last name, semicolon-separated, link column with an unusual name.
    roster = "Vorname;Nachname;Team;Galerie\nLiam;Schröder;U12;https://x.gotphoto.com/gc/Ddd444/\n"
    res = lua.execute(b"local sl, text = ...; return sl.build(text)", sl, roster.encode("utf-8"))
    lst2 = res[0] if isinstance(res, tuple) else res
    check("first + last name, link column by content", to_py(sl.lookup(lst2, b"https://x.gotphoto.com/gc/Ddd444/")),
          {"subjectName": "Liam Schröder", "subjectGroup": "U12"})

    res = lua.execute(b"local sl = ...; return sl.build('Name,Team\\nA,B\\n')", sl)
    check("rejects lists without a code column", to_py(res[1]) if isinstance(res, tuple) else None,
          "No column with gallery links, access codes or barcode numbers was found.")


if __name__ == "__main__":
    test_compile()
    test_reader_output()
    test_propagation()
    test_propagation_members()
    test_subject_list()
    test_end_to_end()
    print("\nFAILED: %d" % failures if failures else "\nAll tests passed.")
    sys.exit(1 if failures else 0)
