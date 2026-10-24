#!/usr/bin/env python3
"""Vendor the Material Icon Theme (PKief, MIT) into this plugin.

Usage: python3 -I scripts/gen-material-icons.py <unpacked material-icon-theme package dir>

Reads the package's prebuilt manifest and SVGs as data — no package code runs —
and writes:
  lib/material-icons-manifest.json   name → icon lookup tables for the browser
  src/material-icons-svg.json        icon id → SVG markup, served by the server
  vendor/material-icon-theme/LICENSE the theme's licence
"""
import json
import os
import re
import sys

package = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
manifest = json.load(open(os.path.join(package, "dist", "material-icons.json"), encoding="utf-8"))
version = json.load(open(os.path.join(package, "package.json"), encoding="utf-8"))["version"]

icons = {}
for icon_id, definition in manifest["iconDefinitions"].items():
    path = os.path.normpath(os.path.join(package, "dist", definition["iconPath"]))
    if not path.startswith(os.path.join(package, "icons")):
        raise SystemExit(f"icon path escapes the package: {icon_id}")
    svg = open(path, encoding="utf-8").read().strip()
    if not svg.startswith("<svg") or re.search(r"<script|\son\w+=", svg, re.I):
        raise SystemExit(f"unexpected SVG content: {icon_id}")
    icons[icon_id] = svg


def tables(source):
    # Expanded folders are always "<icon>-open" in the dark set, so only the
    # light set, where that is not true, carries its own expanded table.
    out = {
        "fileExtensions": source.get("fileExtensions", {}),
        "fileNames": source.get("fileNames", {}),
        "folderNames": source.get("folderNames", {}),
    }
    expanded = source.get("folderNamesExpanded", {})
    irregular = {k: v for k, v in expanded.items() if out["folderNames"].get(k, "") + "-open" != v}
    if irregular:
        out["folderNamesExpanded"] = irregular
    return out


lookup = {
    "version": version,
    "file": manifest["file"],
    "folder": manifest["folder"],
    "folderExpanded": manifest["folderExpanded"],
    "rootFolder": manifest["rootFolder"],
    "rootFolderExpanded": manifest["rootFolderExpanded"],
    "languageIds": manifest.get("languageIds", {}),
    "dark": tables(manifest),
    "light": tables(manifest.get("light", {})),
}
missing = {v for table in (lookup["dark"], lookup["light"]) for t in table.values() for v in t.values() if v not in icons}
if missing:
    raise SystemExit(f"manifest names icons it does not ship: {sorted(missing)[:5]}")

with open(os.path.join(root, "lib", "material-icons-manifest.json"), "w", encoding="utf-8") as f:
    json.dump(lookup, f, separators=(",", ":"), sort_keys=True)
with open(os.path.join(root, "src", "material-icons-svg.json"), "w", encoding="utf-8") as f:
    json.dump(icons, f, separators=(",", ":"), sort_keys=True)
with open(os.path.join(root, "vendor", "material-icon-theme", "LICENSE"), "w", encoding="utf-8") as f:
    f.write(open(os.path.join(package, "LICENSE"), encoding="utf-8").read())
print(f"material-icon-theme {version}: {len(icons)} icons")
