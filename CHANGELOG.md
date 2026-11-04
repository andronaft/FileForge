# Changelog

## 1.1.0

### Added

- **Collage & contact sheet**: many photos on one image in a grid with a gap, background colour, rounded cells
  and optional file names.
- **Split into tiles**: cut an image into rows × columns (Instagram grids, banners) or tiles of a fixed size.
- **Compare images**: pixel diff of two screenshots or renders with a tolerance slider, highlighted changes,
  a percentage and a side-by-side export; different sizes are scaled to match.
- **SVG to PNG**: render SVG at an exact width, height or scale as PNG, JPEG or WebP, with 1×/2×/3× sets and
  a transparent or solid background.
- **Rename files** (new *Files* group): batch rename with `{name}`, `{n}`, `{date}`, `{time}` and `{ext}`
  patterns, a padded counter, find and replace (plain or regex), letter case and Latin-only transliteration
  (Ukrainian and Russian Cyrillic) for uploads; download one by one or as a zip.
- **Booklet**: saddle-stitch imposition for double-sided printing, A4 / Letter / A3 or the page size doubled,
  left or right binding, gutter and fold line.
- **Fill PDF form**: the text fields, checkboxes, radio groups, dropdowns and lists of a fillable PDF become
  a form in the app; save filled or flattened. Cyrillic answers use the bundled font.
- **Colour converter & contrast**: HEX / RGB / HSL / HSV, tints, shades and the complement as swatches and
  CSS variables, WCAG contrast ratio with AA / AAA verdicts for normal and large text.
- **Table converter**: CSV, TSV, Markdown, HTML or JSON in; Markdown table, CSV, TSV, HTML, JSON (objects or
  rows) or SQL INSERTs out, with numeric columns right-aligned in Markdown.
- **Favourites**: a star on every tool card and tool page pins it to a Favourites section on the home page
  and at the top of the sidebar.

### Changed

- 51 tools in total (was 42). Collage and Split into tiles can be steps of a Pipeline.

## 1.0.0

### Added

- **Ukrainian interface.** The app follows the browser language and can be switched in Settings. (#15)
- **Pipeline**: chain tools (resize → adjust → watermark → compress, merge → page numbers → compress) and run
  them on every file in one go; each step keeps its usual options and the chain is remembered. (#27)
- **New image tools**: Adjust (brightness, contrast, saturation, hue, blur, sharpen, grayscale, sepia, one-click
  looks, live preview), Frame, padding & corners, Colour palette (HEX/RGB/HSL, CSS variables, JSON, swatch PNG),
  QR code (link, text, Wi-Fi, e-mail, phone, SMS, vCard; PNG or SVG). Resize gained social-media presets with
  cover-crop.
- **New PDF tools**: Crop pages (by millimetres or auto-trim of white margins), Pages per sheet (2/4/6/9/16-up
  and 1-up re-flow to A4/Letter/A3), Stamp image or signature, Extract images.
- **New text tools**: Text diff, Checksums & hashes (SHA-256/1/512, MD5, CRC32, verify), Word count & case,
  JWT decoder (with optional HMAC verification), URL encode/decode/parse, Regex tester, Markdown to HTML.
- **New interface**: a home page with every tool, recent tools and a drop zone that picks the right tool;
  searchable sidebar with icons; command palette (⌘K / Ctrl+K); keyboard shortcuts (`?`); result previews
  (images, PDFs and text open in a lightbox); file-type icons; a Settings dialog (language, theme, automatic
  download of single results, forget remembered options); a drag-over overlay; refreshed colours, buttons and
  cards in both themes.

### Changed

- The toolbar button and the web app open the home page instead of Crop. `#tool-id` links and `?tool=` keep
  working.
- 42 tools in total (was 26).


## 0.6.0

### Added

- **Side panel mode**: the ◨ button in the top bar or "Open in side panel" in the toolbar icon's right-click menu
  moves FileForge into Chrome's side panel (Edge, Brave and Opera too) or Firefox's sidebar, next to the page you
  are working on. While it is open there, "Edit image in FileForge" and "Open PDF in FileForge" load the file into
  the panel instead of a new tab; Chrome also remembers the choice for the toolbar icon. ⧉ returns to a full tab.
  The web version opens a small pop-up window instead.
- A compact layout for narrow panels: the tool picker becomes a dropdown, page thumbnails shrink, and file rows,
  selects and previews fit the panel width without horizontal scrolling.

## 0.5.0

### Added

- **Redact image**: draw boxes over names, faces, addresses or card numbers and black them out, pixelate or
  blur them. Solid black is the default because blur and pixelation can sometimes be undone for text.
- **Reorder pages** (PDF): drag page thumbnails into a new order, drop pages, reverse the document. (#19)
- **Page picker**: Split, Delete pages, Rotate PDF and PDF to images show clickable page thumbnails kept in
  sync with the "1-3, 5" field; shift-click selects a range. (#19)
- **Compress image** shows a before/after view of the first image with a draggable divider and the resulting
  size for the current settings, updated as you move the slider. (#20)
- Thumbnails in the file list; orderable lists (Merge PDF, Images to PDF) can be dragged, sorted by name or
  date, or reversed. (#18)
- **Continue with**: send the results of one tool straight into another (crop → compress → watermark) without
  downloading and re-dropping them.
- Light/dark theme toggle in the top bar (follows the system until you pick one).

## 0.4.0

### Added

- **PDF to text**: the text layer as .txt or Markdown with a heading per page; wrapped lines are joined back into
  paragraphs. (#25)
- **Remove PDF metadata**: shows title, author, software, dates, keywords and XMP, then strips them. Other PDF
  tools no longer stamp pdf-lib's producer and dates into the files they save. (#23)
- **Compress PDF** has a lossless mode (default): compact structure, metadata dropped, text stays selectable. (#23)
- **Remove metadata** (images) shows what it will remove first: camera, lens, date, exposure, software,
  orientation and the GPS location with a map link. (#24)
- Progress bar with the current file name and a **Cancel** button for batches; page-by-page progress for
  PDF rendering. (#17)
- Every tool remembers the options you used last time (dropdowns, sliders, checkboxes, colours, numbers; not
  page ranges), with a "Reset options to defaults" link. (#16)
- **Copy** button on text and image results and on the text tools' output; **Ctrl/⌘+Enter** runs the tool. (#21)
- Files can be dropped anywhere on the page. On phones the tool list is a dropdown in the top bar instead of a
  screen-high sidebar. (#22)
- The installed web app is an "Open with" target for images, PDFs, Markdown, CSV and JSON files. (#26)

## 0.3.1

### Fixed

- Watermark PDF and Add page numbers accept Cyrillic, Greek and extended Latin text: a bundled Noto Sans subset
  is embedded (through fontkit) whenever the text goes beyond what the standard PDF fonts cover. (#1)
- JSON format & validate reports the line and column of an error again, in every browser; the broken
  character is selected in the editor. (#2)
- CSV → JSON keeps leading zeros ("01234", "0501234567") and non-canonical numbers as strings. (#3)
- Images to PDF rotates phone photos upright (EXIF orientation) and sizes "fit" pages at a chosen resolution
  (150 dpi by default) instead of 1 px = 1 pt. (#4, #5)
- Compress image and Compress PDF return the original file, with a note, when re-encoding would only make it
  bigger. (#6, #7)
- Files that arrive with an empty MIME type are accepted by their extension. (#8)
- The Markdown preview is sandboxed and the app page carries a Content-Security-Policy, so HTML inside a
  Markdown file can no longer run scripts. (#9)
- SVG files without width/height render at 1024 px on the long side from their viewBox instead of 300 × 150. (#10)
- Target-size compression decodes the image once and only re-encodes, about 5× faster on large photos. (#11)
- Toasts are announced to screen readers, the results list is a live region, the dropzone is a labelled button
  and there is a "Skip to the tool" link. (#12)
- "Edit image in FileForge" works on data: and blob: images (the extension reads the bytes in the page and
  hands them to the app; needs the new `scripting` permission). (#13)
- Plural forms ("1 page", "2 records") and row counts in the result notes. (#14)

## 0.3.0

### Added

- **Remove metadata**: strips EXIF, GPS location, XMP, IPTC and comments from JPEG, PNG and WebP without
  re-encoding the pixels.
- **Compress to a target size**: give a size in KB and the quality (and, if needed, the dimensions) are lowered
  until the file fits.
- **Resize presets**: 4K, Full HD, HD, Instagram, web, thumbnail.
- Files stay loaded when you switch to another tool that takes them, so crop → compress → watermark is one flow.
- Right-click a PDF link or a PDF page → "Open PDF in FileForge"; keyboard shortcut Alt+Shift+F opens the app.
- Store-ready manifest: English and Ukrainian name and description, padded 128 px icon, 256 and 512 px icons.
- The web version installs as an app and works offline (web manifest + service worker).

### Fixed

- Phone photos keep their EXIF rotation instead of coming out sideways.
- The description in the manifest was longer than the 132 characters the Chrome Web Store allows.


## 0.2.0

### Added

- **Images**: HEIC → JPG/PNG (iPhone photos), text watermark with live preview, favicon and PWA icon
  generator (favicon.ico, all PNG sizes, HTML snippet, web manifest).
- **PDF**: PDF → images, compress, delete pages, page numbers, diagonal text watermark.
- **Text & data**: CSV ⇄ JSON, JSON format/validate with the error position, Base64 for text and files.
- Firefox package (`scripts/package.py` builds a Chrome and a Firefox zip) and a privacy policy.

## 0.1.0

- First version: crop, resize, rotate/flip, compress, convert images; merge, split, rotate PDFs;
  images → PDF; Markdown → PDF. Works as a Chrome extension and as a plain web page.
