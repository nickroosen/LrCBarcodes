"""
Builds the installable plug-in zip:

    python scripts/package.py            -> dist/LrCBarcodes-<version>.zip

The zip contains a single LrCBarcodes.lrplugin folder (the release name for a
Lightroom plug-in; .lrdevplugin is the development name) with both the Windows
and macOS readers. The version comes from VERSION in Info.lua. Unix permissions
are stored so the macOS reader stays executable after unzipping.
"""
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "LrCBarcodes.lrdevplugin"
DIST = ROOT / "dist"
FOLDER = "LrCBarcodes.lrplugin"

EXCLUDE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
EXECUTABLES = {"bin/mac/ZXingReader"}
REQUIRED = ["Info.lua", "bin/win/ZXingReader.exe", "bin/mac/ZXingReader"]


def plugin_version():
    info = (PLUGIN / "Info.lua").read_text(encoding="utf-8")
    match = re.search(r"VERSION\s*=\s*\{\s*major\s*=\s*(\d+),\s*minor\s*=\s*(\d+),\s*revision\s*=\s*(\d+)", info)
    if not match:
        sys.exit("Could not find VERSION in Info.lua")
    return ".".join(match.groups())


def main():
    missing = [p for p in REQUIRED if not (PLUGIN / p).is_file()]
    if missing:
        sys.exit("Missing from the plug-in folder: " + ", ".join(missing))

    version = plugin_version()
    DIST.mkdir(exist_ok=True)
    out = DIST / f"LrCBarcodes-{version}.zip"

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(PLUGIN.rglob("*")):
            rel = path.relative_to(PLUGIN).as_posix()
            if path.is_dir() or path.name in EXCLUDE_NAMES or any(part.startswith(".") for part in rel.split("/")):
                continue
            info = zipfile.ZipInfo.from_file(path, f"{FOLDER}/{rel}")
            mode = 0o755 if rel in EXECUTABLES else 0o644
            info.external_attr = (0o100000 | mode) << 16  # regular file + permissions
            info.create_system = 3  # Unix, so the permissions are honored
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes())

    print(f"{out.relative_to(ROOT)}  ({out.stat().st_size / 1e6:.1f} MB, version {version})")
    return out


if __name__ == "__main__":
    main()
