#!/usr/bin/env python3
"""Build what GitHub Pages serves into site/ (the pages workflow runs this): forwards to the web app's new home on zhukovskyi.space.

The web version moved from https://andronaft.github.io/FileForge/ to https://zhukovskyi.space/tools/fileforge/app/
(scripts/build_web_app.py builds it; ~/Desktop/my_space/tools/sync_fileforge.py publishes it).
GitHub Pages cannot send a 301, so every old address gets a small page with rel=canonical, a meta refresh and a
script redirect that keeps ?tool= and the #tool fragment:

  site/index.html, site/app/index.html     → the app
  site/privacy.html                        → the privacy policy (the store listings still link here)
  site/404.html                            → any other old address (a tool file, an icon) goes to the app
  site/app/sw.js                           → replaces the old offline worker: clears its caches, unregisters itself
                                             and reloads open tabs, so installed copies reach the redirect
"""
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site"
NEW = "https://zhukovskyi.space/tools/fileforge"


def stub(target, keep_query=False):
    tail = " + location.search + location.hash" if keep_query else " + location.hash"
    return f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>FileForge has moved</title>
<link rel="canonical" href="{target}">
<meta http-equiv="refresh" content="0; url={target}">
<script>location.replace("{target}"{tail});</script>
<p>FileForge has moved to <a href="{target}">{target}</a>.</p>
</html>
"""


shutil.rmtree(OUT, ignore_errors=True)
(OUT / "app").mkdir(parents=True)
(OUT / "index.html").write_text(stub(f"{NEW}/app/", keep_query=True))
(OUT / "app" / "index.html").write_text(stub(f"{NEW}/app/", keep_query=True))
(OUT / "privacy.html").write_text(stub(f"{NEW}/privacy.html"))
(OUT / "404.html").write_text(stub(f"{NEW}/app/"))
(OUT / "app" / "sw.js").write_text("""// The web app moved to https://zhukovskyi.space/tools/fileforge/app/. This worker replaces the old offline one:
// it deletes the old caches, unregisters itself and reloads open tabs, which then follow the redirect.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
""")
(OUT / ".nojekyll").write_text("")
print(f"wrote {OUT.relative_to(ROOT)}/")
