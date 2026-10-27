#!/usr/bin/env python3
"""Build store-ready zips: dist/fileforge-chrome-<v>.zip and dist/fileforge-firefox-<v>.zip.

Firefox differences applied automatically:
  - background.scripts instead of background.service_worker
  - optional_permissions instead of optional_host_permissions
  - browser_specific_settings.gecko (add-on id, min version, data collection = none)
  - no "sandbox" key (Firefox does not support it; HEIC falls back to the web version)
"""
import json, pathlib, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
INCLUDE = ["background.js", "app", "icons", "vendor", "LICENSE", "PRIVACY.md"]
SKIP_SUFFIX = (".DS_Store",)

def files():
    for item in INCLUDE:
        p = ROOT / item
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not f.name.endswith(SKIP_SUFFIX):
                    yield f

def build(name, manifest):
    DIST.mkdir(exist_ok=True)
    out = DIST / f"fileforge-{name}-{manifest['version']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        for f in files():
            z.write(f, f.relative_to(ROOT).as_posix())
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")

base = json.loads((ROOT / "manifest.json").read_text())

chrome = dict(base)
build("chrome", chrome)

firefox = dict(base)
firefox["background"] = {"scripts": ["background.js"]}
firefox.pop("sandbox", None)
firefox.pop("optional_host_permissions", None)
firefox["optional_permissions"] = ["<all_urls>"]
firefox["browser_specific_settings"] = {
    "gecko": {
        "id": "fileforge@andronaft.github.io",
        "strict_min_version": "128.0",
        "data_collection_permissions": {"required": ["none"]},
    }
}
build("firefox", firefox)
