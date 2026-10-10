#!/usr/bin/env python3
"""Produce a deterministic Chrome Web Store ZIP using an explicit file allowlist."""
import argparse
import json
import struct
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"
FILES = (
    "manifest.json",
    "background.js",
    "bridge.js",
    "controller.js",
    "popup.html",
    "popup.css",
    "popup.js",
)
SIZES = (16, 32, 48, 128)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest = json.loads((EXTENSION / "manifest.json").read_text("utf-8"))
    assert manifest["manifest_version"] == 3
    assert manifest["permissions"] == ["activeTab", "scripting", "storage"]
    assert len(manifest["description"]) <= 132
    assert manifest["background"]["service_worker"] == "background.js"
    names = list(FILES)
    for size in SIZES:
        relative = f"icons/icon{size}.png"
        assert manifest["icons"][str(size)] == relative
        icon = (EXTENSION / relative).read_bytes()
        assert icon[:8] == b"\x89PNG\r\n\x1a\n"
        assert struct.unpack(">II", icon[16:24]) == (size, size)
        names.append(relative)
    output = args.output or ROOT / "dist" / f"hibiki-bridge-{manifest['version']}.zip"
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w") as archive:
        for relative in sorted(names):
            source = EXTENSION / relative
            assert source.is_file() and not source.is_symlink()
            info = ZipInfo(relative, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, source.read_bytes())
    with ZipFile(output) as archive:
        assert archive.testzip() is None
        assert sorted(archive.namelist()) == sorted(names)
    print(output)

if __name__ == "__main__":
    main()
