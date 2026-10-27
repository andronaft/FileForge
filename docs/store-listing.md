# Chrome Web Store listing

Text to paste into the Developer Dashboard when publishing.

## Name

FileForge: image, PDF & file tools

## Summary (max 132 characters)

Crop, resize, compress, convert images (incl. HEIC), merge/split PDFs, Markdown → PDF, CSV/JSON tools. 100% on your device.

## Category

Productivity → Tools

## Description

FileForge is a toolbox for everyday file jobs that works entirely inside your browser. Nothing is uploaded anywhere: your photos and documents never leave your computer.

IMAGES
• Crop with drag handles or exact numbers, with aspect-ratio presets
• Resize by pixels or percent, with quality-preserving downscaling
• Rotate and flip
• Compress JPG, PNG and WebP, with a size preview before you download
• Convert between JPG, PNG and WebP
• HEIC (iPhone photos) → JPG or PNG
• Text watermark with live preview (corners, centre or tiled)
• Favicon and app-icon generator: favicon.ico, every PNG size, HTML snippet and web manifest
• Right-click any image on a web page → "Edit image in FileForge"

PDF
• Merge PDFs in the order you choose
• Split by page ranges, one file per page, or into chunks
• Rotate or delete pages
• Add page numbers and a diagonal text watermark (DRAFT, CONFIDENTIAL…)
• Compress scanned PDFs
• Images → PDF and PDF → images (PNG or JPG, 72–300 dpi)

TEXT & DATA
• Markdown → PDF with a live preview and three themes
• CSV ⇄ JSON
• Format and validate JSON, with the exact position of an error
• Base64 encode and decode, for text and files

PRIVACY AND PERMISSIONS
Everything runs locally: there is no server, no account, no analytics and no network requests. The extension needs only the contextMenus permission for the right-click entry. When you use "Edit image in FileForge" on a page, it asks for access to that one site so it can read the image, and only then.

Open source: https://github.com/andronaft/FileForge
Web version: https://andronaft.github.io/FileForge/

## Single purpose

Edit and convert the user's own image, PDF and text files locally in the browser.

## Permission justifications

- **contextMenus**: the "Edit image in FileForge" entry in the right-click menu of images.
- **Optional host permissions (`<all_urls>`)**: requested for a single site, only when the user chooses "Edit image in FileForge" on an image there, so the extension can fetch that image. Never requested up front.
- **Sandbox page** (`app/heic-sandbox.html`): runs the HEIC decoder (heic2any / libheif), which needs `new Function`; it is isolated from the extension's privileges and only exchanges image bytes with the app page.

## Data usage

Does not collect or transmit any user data.

## Privacy policy URL

https://andronaft.github.io/FileForge/privacy.html

## Assets

- Icon: `icons/icon128.png`
- Screenshots: 1280×800 JPEG or PNG without transparency, at least one, up to five (`docs/store/`)
- Small promo tile: 440×280 (`docs/store/promo-small-440x280.jpg`)
- Marquee (optional): 1400×560
