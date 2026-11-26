# Changelog

## 1.9.0

### Added

- **PDF to Word**: an editable .docx from a PDF's text: paragraphs joined back together, headings, bold and italic,
  two-column pages read in order, pictures in place, page headers, footers and page numbers left out. Scanned PDFs
  need Image to text (OCR) first, and the tool says so.
- **PDF to Excel**: the tables in a PDF (statements, price lists, reports) as .xlsx or CSV, one sheet per page, per
  table or all on one. Numbers, percentages, amounts in any currency and dates become real cells; codes with leading
  zeros and phone numbers stay text.
- **Edit PDF text**: click any text in a PDF to fix a typo, a date, a name or an amount, delete it, or add new text
  anywhere, in the closest matching font and colour (Cyrillic too). The old text is covered, not removed from the
  file: the tool says so and points to Redact PDF for anything secret.
- **Blur faces**: a small neural network (YuNet, MIT, 230 KB) finds the faces in a photo, group photos included, and
  blurs, pixelates or blacks them out, each scaled to its face. Every face can be turned off, and a missed face or a
  number plate drawn by hand. Several photos at once.
- **Trim & convert audio**: cut a song or a recording with handles on its waveform, fade in and out, change the volume
  or even out the loudness, and save as MP3, WAV, M4A or Opus, mono or stereo, or split it into parts.
- **Compress GIF**: make an animated GIF fit a size limit (10, 8, 5, 2, 1 MB or your own) by trying fewer colours,
  lossy frames, fewer frames and a smaller width, or set them yourself. Speed, transparency and looping stay.
- Under every tool: "On your device · nothing is uploaded".
- After a result, one-click buttons for the usual next step (HEIC to JPG → compress, remove metadata, images to PDF).
- The installed web app is in the phone's Share menu: share photos, PDFs or videos to FileForge from the gallery or
  any app.
- `?lang=uk` or `?lang=en` in the address picks the language (the site's Ukrainian pages use it) and is remembered.

### Changed

- The page has a real title and a first screen before the app starts, and a list of the tools for browsers without
  JavaScript.
- Compress video size presets follow today's limits: 20 MB Discord, 25 MB e-mail, 100 MB WhatsApp (was 8 and 16 MB).
- Audio files open in Trim & convert audio, GIFs in Compress GIF.
- 85 tools in total (was 79).

### Fixed

- Extract images from PDF skipped pictures shared between pages.

## 1.8.0

### Added

- **Remove background**: cut out people, pets, products and cars from any photo, even on a busy background, like
  remove.bg but on your device. Save the cut-out transparent (PNG or WebP), on white or any colour, in front of a
  blurred copy of the photo or on another picture; JPEG too. Soft edges for hair and fur or sharp ones for products,
  crop to the subject with a margin, a square picture for marketplaces and profile photos, and a brush to restore
  or erase parts by hand (undo, reset, compare with the original). Several photos at once.
  The neural network is ISNet (general use, Apache-2.0), stored with 8-bit weights (46 MB, masks practically identical
  to the full 176 MB model) and run by ONNX Runtime Web 1.31.1 (MIT): on the graphics card through WebGPU, otherwise
  on the processor. A graphics card that stops answering hands the work to the processor after 75 seconds. The model
  loads only when the tool is opened; the web version caches it after the first use instead of with the app.
- A "Made by Dre Dev" link on the home screen and in Settings, to the author's site with more free tools and apps.
- After HEIC to JPG, Images to PDF, Scan document photo and Sign & fill PDF, one line about the author's phone app
  for the same job (RoofCalc, SiteLog, PaintBid). English interface only; plain links, nothing loads until clicked.

### Changed

- The web version moved to https://zhukovskyi.space/tools/fileforge/app/; the old GitHub Pages address forwards there.

## 1.7.0

### Added

- **Compress video**: a quality preset, or a size limit (8 MB Discord, 16 MB WhatsApp, 25 MB e-mail or your own).
  The bitrate goes down first and the resolution only when the limit needs it; a video too long for the limit is
  refused with the smallest size that would work. MP4 or WebM, sound kept, mono or removed.
- **Convert video**: iPhone MOV, MKV and WebM to MP4, MP4 to WebM, MOV or MKV. When the video inside already fits the
  new format it is copied as it is, in seconds and with no quality lost; "play everywhere" re-encodes HEVC to H.264.
- **Trim & edit video**: cut a part, turn it, mirror it, crop it to 9:16 (Reels, TikTok, Shorts), 1:1, 4:5 or 16:9,
  shrink it to 1080p, 720p or 480p, or take the sound out.
- Dropping a big video or a MOV / MKV on the home page suggests compressing or converting it; a video opens in
  Compress video by default.

The three tools use the browser's own video encoders (WebCodecs) and the Mediabunny library (MPL-2.0, 707 KB), which
is loaded only when one of them is opened. Nothing is uploaded.

### Fixed

- The preview of Video to GIF and Video to images no longer stretches across the whole width of the page.
- 78 tools in total (was 75).

## 1.6.0

### Added

- **Document pack**: photos, scans and PDFs in any mix become one PDF that fits an upload form. Pick the limit
  (1, 2, 5, 10 MB or your own) and the file name, in Latin letters if the portal insists.
- **Safe copy of a document**: writes who the copy is for ("Copy for the bank · 18.11.2026") across the whole page
  of a passport or ID scan. Pages are flattened into pictures, so the note cannot be deleted, and metadata is dropped.
- **Privacy check**: what a file gives away before you send it: where a photo was taken and the hidden thumbnail of
  the uncropped shot, the author and edit history of a PDF, comments and tracked changes in Word, hidden sheets in
  Excel. One button makes cleaned copies.
- **Images to GIF**: a set of pictures as an animated GIF (slideshow, steps, before and after).
- **Split PDF** has a new mode: parts no larger than a size limit.
- **ID & passport photo** can save for an online application: exact pixels and a size limit in KB.
- **A look inside dropped files**: drop anything on the home page and FileForge says what it is and offers the tool
  for it ("A scan: 12 pages with no text to select" → make it searchable; "3 of 10 photos say where they were
  taken" → remove the location; photos and PDFs together → one PDF).
- Extension: the right-click menu on an image can also convert it, read its text or read its QR code; on a page or
  a link, "QR code for this address" opens it on your phone.
- Search: when nothing matches every word, similar tools are offered; an empty search shows recent and popular tools.

### Changed

- Results: "Download all" and "Save all to a folder" sit in the heading, above the list; a single result gets one
  big Download button and a note that it is already in your downloads folder.
- File rows show the size and dimensions under the name and keep their buttons together; a long list scrolls in its
  own box. The web app is usable at phone width.
- Cancel is always there while a job runs. Leaving a tool, or pressing Clear, stops its job.
- Clearer colours for links and buttons in the light theme, a visible keyboard focus ring, a toast that no longer
  covers the Run button.
- Text files saved as Windows-1251 (Excel "CSV", bank and 1C exports) are read correctly, and the tool says so.
- 75 tools in total (was 71).

### Fixed

Privacy first:

- **Redact PDF**: the text of a redacted page could survive inside the file when another page linked to it, or
  through a filled form. Redacted pages are now emptied before anything is copied.
- **Delete PDF pages**, **Split PDF** and **Organise pages**: removed pages stayed in the file, unlinked but
  readable. They are now really gone, together with the form fields that lived on them.
- **Remove PDF metadata** (and Compress PDF) left the XMP packet with author, software and dates in the file.
- **Images to PDF** and **Stamp** embedded the camera's EXIF block (GPS position, device, thumbnail) in the PDF.
- **Remove metadata** left embedded previews and motion-photo video after the picture untouched, with their own
  copy of the metadata, and made portrait phone photos open sideways. Both fixed.
- **Redact image**, Blur: the original no longer shows through at the edges of the box.

PDF:

- Page numbers, Watermark, Stamp, Crop, Pages per sheet and Booklet work on the page as it is seen: turned
  (rotated scans) and already cropped pages get the number in the right corner, upright. Blank pages no longer
  stop Pages per sheet.
- Smart compression turned pictures sideways when they carried a phone's rotation tag, and gave up on the size
  limit too early, turning the whole document into pictures when a stronger picture setting would have done.
- Redact PDF and searchable PDFs from OCR stored shared fonts and pictures once per page: a 300-page file could
  grow to hundreds of megabytes.
- Redact PDF "Find & mark" finds a phrase that is split into several pieces of text, and covers its first and
  last letters fully.
- Fill PDF form failed on forms with Cyrillic dropdown choices.

Data and text:

- CSV with ";" and decimal commas (the Excel default in Ukraine) was split on the commas. An inch mark or a quote
  in the middle of a cell no longer swallows the following rows.
- Excel to CSV wrote dates the US way and lost the time; CSV to Excel shifted dates by the time zone.
- CSV to Excel failed on files over about 120,000 rows and on long file names.
- JSON format warns when a 64-bit number would be rounded or a key is repeated.
- Text diff could run out of memory on two very different texts.
- Title Case no longer capitalises after an apostrophe (Don't, П'ять); camelCase and snake_case really split words.
- ZIP archives with Cyrillic names made on Windows show the names correctly; Create ZIP keeps the folder structure
  of a dropped folder, and its Cancel works.
- Video to images sampled only the first 5 seconds by default.
- Word to Markdown: table cells with several paragraphs, and bold text followed by a space.

App and extension:

- The web app did not start offline.
- A job kept running after you left its tool, and its results appeared under the next one.
- The "Skip to the tool" link cleared the files.
- Whole-page screenshots were mis-stitched on sites with smooth scrolling.
- "Open PDF in FileForge" did not appear on PDF links of ordinary pages.
- Dropping a ZIP on Checksums, Base64 or Rename unpacked it instead of taking the archive itself.
- A HEIC file that the decoder could not handle left the tool on "Working…" forever.
- Dragging a result and letting go inside the page wiped the results.
- Two results with the same name (photo.jpg and photo.png both to WebP) are now told apart.

## 1.5.0

### Added

- **Smart PDF compression**: the default mode of Compress PDF now shrinks the pictures inside the file and keeps
  the text selectable. An optional size limit ("Fit into 5 MB") lowers the quality step by step until the file
  fits, and turns pages into pictures only as a last resort.
- **Organise pages** (was Reorder pages): the pages of several PDFs on one board. Drag to reorder across files,
  rotate or drop single pages, save one PDF.
- **Read QR code**: what a QR code or barcode in a screenshot or photo says: link (shown with its site, never
  opened for you), Wi-Fi password, contact or text.
- **Video to MP3**: the sound of a video, or an audio file (M4A, OGG, WAV, FLAC), as MP3 or WAV, with trim and mono.
- **Drag a result out** of FileForge straight into a folder, a mail or a chat (Chromium browsers).
- Home page: a *Popular* row for new users and links that jump to each tool group.

### Changed

- Tool cards on the home page use their full width for the text; the favourite star sits in the corner.
- Sidebar groups fold away with a click and show how many tools they hold; the choice is remembered.
- The drop area shrinks to a slim "add more" bar once files are in, so the options come up the screen.
- 71 tools in total (was 69).

### Fixed

- Every PDF used to start its own pdf.js worker and load 1.4 MB of code again; twenty files meant twenty workers.
  All PDF tools, thumbnails and previews now share one worker.
- Pressing Run before a video, a page board or a preview had finished loading failed with "Preview is not ready
  yet" or "Keep at least one page". Run now waits for it.
- The search placeholder said "50+ tools"; it shows the real number. `xlsx to csv`, `docx to pdf` and
  `mp4 to mp3` queries put the right converter first.
- A few strings were still English in the Ukrainian interface.

## 1.4.0

### Added

- **Word to PDF**: open a .docx and save it as PDF (through the print dialog), a web page, Markdown or plain text.
  Headings, lists, tables, links, bold and italic and pictures come across; the exact page layout does not.
- **Excel to CSV / JSON**: .xlsx, .xls, .ods and Numbers exports to CSV, TSV, JSON, Markdown, HTML or SQL, every
  sheet or the one you pick; dates come out as ISO dates.
- **CSV / JSON to Excel**: tables to an .xlsx or .ods workbook, one sheet per file, numbers and dates kept as
  numbers and dates, column widths set.
- **Video to GIF**: pick the part of a clip, frame rate, width, speed (0.5× to 4×) and colours; loops.
- **Video to images**: one frame every N seconds, N frames spread over the clip, or the frame you stop at.
- **Page screenshots** in the extension: right-click a page (or the toolbar icon) → "Screenshot the visible
  part" or "Screenshot the whole page". The whole page is scrolled and stitched, fixed headers appear once, and
  the picture opens in Annotate screenshot. Needs the new `activeTab` permission, which shows no warning.
- New sidebar groups *Video* and *Word & Excel*; dropping a video, .docx or spreadsheet suggests the right tool.

### Changed

- 69 tools in total (was 64). Word and Excel libraries (about 1.3 MB) load only when one of their tools opens.

## 1.3.0

### Added

- **Image to text (OCR)**: read the text in photos, screenshots and scanned PDFs with Tesseract, on your device.
  English and Ukrainian are built in; any other language works from a `.traineddata` file. Save `.txt` or a
  searchable PDF: for a scanned PDF the original pages stay exactly as they are and get an invisible text
  layer, so the text can be selected and found.
- **Protect PDF**: a password to open (AES-256) and permissions for printing, copying text and editing.
- **Unlock PDF**: remove a password you know and lift print / copy / edit restrictions.
- **Repair PDF**: rebuild a damaged or cut-off PDF and keep every page that can still be read; optional web
  optimisation.
- **Redact PDF**: drag boxes over what to hide or find a word to mark every place it appears. Marked pages are
  rebuilt as images, so the text underneath is really gone.
- **Compare PDFs**: the text of two versions line by line, with the pages that changed and a `.diff` report.
- **Transparent background**: make a plain background transparent (logos, signatures, stamps, product shots);
  pick the colour by clicking, remove only what surrounds the subject or the colour everywhere, smooth edges,
  trim the margins.
- **Create ZIP** and **Extract ZIP** in the Files group.
- **Save all to a folder**: write a whole batch of results into a folder you pick, no archive to unpack
  (Chrome, Edge and other Chromium browsers).

### Changed

- Restricted PDFs (printing or copying switched off, but no password to open) now just work in every PDF tool.
  A PDF that needs a password says so and points to Unlock PDF, instead of failing with a parse error.
- 64 tools in total (was 55).
- The web version caches the OCR engine and its language models (about 8 MB) only after the OCR tool is first
  used, not on the first visit.

## 1.2.0

### Added

- **Sign & fill PDF**: sign any PDF and fill it in where there are no form fields. Draw, type or upload a
  signature (a photo of a signature on paper gets a transparent background), then place it with text, today's
  date, ticks and crosses anywhere; drag to move, resize from the corner. Works on rotated pages; Cyrillic text
  uses the bundled font; the signature can be remembered in this browser.
- **Scan document photo**: phone photos of paper become a clean scan. The sheet's corners are found
  automatically and can be dragged, the perspective is straightened, uneven light is evened out so the paper
  turns white (colour, greyscale or black & white), and all pages go into one A4 / Letter PDF.
- **ID & passport photo**: 35 × 45, 3 × 4, 2 × 2 in, 33 × 48, 40 × 60, 50 × 70 or a custom size, with crown and
  chin guides; save one photo, a 10 × 15 print sheet (JPEG) or an A4 sheet (PDF) with cut lines, at 300 or 600 dpi.
- **Annotate screenshot**: arrows, boxes, circles, highlighter, pen, text and numbered steps in any colour,
  undo and redo, Shift for squares and circles; paste a screenshot with Ctrl+V and copy the result back.
- **Drop a folder or a ZIP** into any tool: folders are walked, archives unpacked, hidden files and macOS
  `__MACOSX` entries skipped. A "choose a folder" link sits next to "choose files".
- **Bigger file previews**: thumbnails in the file list are larger and sharp on HiDPI screens; each row also
  shows the image size in pixels or the PDF's page count.
- **Click a thumbnail to open the file**: images (HEIC too) open full size, and PDFs show every page, rendered
  by pdf.js so it works without the browser's own PDF viewer (side panel, Firefox). Works for results too.
- **Search that understands how people type**: `пдф`, `джпг` and other Cyrillic spellings of formats, everyday
  and Russian words (`сжать`, `объединить`, `кроп`), "X to Y" queries (`png в jpg`, `jpg to pdf` put the right
  converter first), apostrophes (`об'єднати`), typos (`mrege`) and the wrong keyboard layout (`зва` → `pdf`,
  `cnbcyenb` → `стиснути`). Works in the search palette and the sidebar filter, in either interface language.
- **Pick the tool for a dropped file**: files dropped on the home page (or opened with FileForge) no longer go
  straight to Crop or Split. A list shows every tool that takes them, with the suggested one, favourites and
  recent tools first; Enter opens the suggestion, typing filters the list.
- **HEIC thumbnails**: decoded in the background at low priority, so a conversion never waits behind them.

### Fixed

- **HEIC to JPG** no longer hangs on "Working…" in the Chrome extension. The old decoder (heic2any) started a
  blob worker that the extension sandbox blocks, and then waited for it forever. It is replaced by libheif 1.23
  compiled to WebAssembly, running in a worker: newer iPhone photos decode, a 12 MP photo takes about a second,
  and a stuck decode now fails with a message after two minutes instead of spinning.
- **HEIC photos work in every image tool**, not only HEIC to JPG: Images to PDF, crop, resize, rotate, compress,
  convert, watermark and the rest decode them first. Before, they failed with "The source image could not be
  decoded".
- HEIC now works in the **Firefox** add-on too; it no longer needs the sandboxed page Firefox does not have.

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
