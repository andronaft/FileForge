# Changelog

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
