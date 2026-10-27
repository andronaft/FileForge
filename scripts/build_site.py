#!/usr/bin/env python3
"""Build the web version for GitHub Pages into site/.

  site/index.html     redirects to app/
  site/app/, vendor/, icons/   the app, exactly as in the extension
  site/privacy.html   PRIVACY.md rendered in the browser (the store listings link to it)
"""
import pathlib, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"

shutil.rmtree(SITE, ignore_errors=True)
SITE.mkdir()
for name in ["app", "vendor", "icons"]:
    shutil.copytree(ROOT / name, SITE / name, ignore=shutil.ignore_patterns(".DS_Store"))
shutil.copy2(ROOT / "PRIVACY.md", SITE / "PRIVACY.md")

(SITE / "index.html").write_text("""<!doctype html>
<meta charset="utf-8">
<title>FileForge</title>
<meta http-equiv="refresh" content="0; url=app/">
<link rel="canonical" href="app/">
<p>Opening <a href="app/">FileForge</a>…</p>
""")

(SITE / "privacy.html").write_text("""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FileForge privacy policy</title>
<link rel="icon" href="icons/icon32.png">
<style>
  body { max-width: 720px; margin: 40px auto; padding: 0 16px; font: 16px/1.6 system-ui, sans-serif; color: #1f2328; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } a { color: #79b8ff; } }
  code { font-size: 0.9em; }
</style>
<main id="doc">Loading…</main>
<script src="vendor/marked.min.js"></script>
<script>
  fetch("PRIVACY.md").then(r => r.text()).then(md => { document.getElementById("doc").innerHTML = marked.parse(md); });
</script>
</html>
""")
(SITE / ".nojekyll").write_text("")
print(f"wrote {SITE.relative_to(ROOT)}/")
