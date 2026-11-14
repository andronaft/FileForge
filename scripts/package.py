#!/usr/bin/env python3
"""Build store-ready packages into dist/:

  dist/chrome/                      unpacked Chrome build (also loads in Edge, Opera, Brave)
  dist/firefox/                     unpacked Firefox build (web-ext lint / sign use this)
  dist/fileforge-chrome-<v>.zip     upload to the Chrome Web Store
  dist/fileforge-firefox-<v>.zip    upload to addons.mozilla.org

Firefox differences applied automatically:
  - background.scripts instead of background.service_worker
  - optional_permissions instead of optional_host_permissions
  - browser_specific_settings.gecko (add-on id, min version, data collection = none)
  - sidebar_action instead of Chrome's side_panel key and sidePanel permission
"""
import json, pathlib, shutil, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
INCLUDE = ["background.js", "_locales", "app", "icons", "vendor", "LICENSE", "PRIVACY.md"]
SKIP_SUFFIX = (".DS_Store",)

AMO_ID = "fileforge@andronaft.github.io"


def files(exclude=frozenset()):
    for item in INCLUDE:
        p = ROOT / item
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not f.name.endswith(SKIP_SUFFIX) and f.relative_to(ROOT).as_posix() not in exclude:
                    yield f


def build(name, manifest, exclude=frozenset()):
    DIST.mkdir(exist_ok=True)
    folder = DIST / name
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir()
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for f in files(exclude):
        target = folder / f.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)

    out = DIST / f"fileforge-{name}-{manifest['version']}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(folder).as_posix())
    print(f"wrote {folder.relative_to(ROOT)}/ and {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


base = json.loads((ROOT / "manifest.json").read_text())

chrome = dict(base)
build("chrome", chrome)

firefox = dict(base)
firefox["background"] = {"scripts": ["background.js"]}
firefox.pop("optional_host_permissions", None)
firefox.pop("side_panel", None)
firefox["permissions"] = [p for p in base["permissions"] if p != "sidePanel"]
firefox["sidebar_action"] = {
    "default_panel": "app/index.html?view=side",
    "default_title": "__MSG_shortName__",
    "default_icon": "icons/icon32.png",
    "open_at_install": False,
}
firefox["optional_permissions"] = ["<all_urls>"]
firefox["browser_specific_settings"] = {
    "gecko": {
        "id": AMO_ID,
        "strict_min_version": "142.0",
        "data_collection_permissions": {"required": ["none"]},
    }
}
build("firefox", firefox)
