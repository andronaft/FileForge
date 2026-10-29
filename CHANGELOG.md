# Changelog

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
