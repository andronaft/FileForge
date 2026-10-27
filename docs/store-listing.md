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
• Remove metadata: strip EXIF, GPS location, XMP and comments without re-encoding
• Compress to a target size, e.g. "under 200 KB"
• Favicon and app-icon generator: favicon.ico, every PNG size, HTML snippet and web manifest
• Right-click any image on a web page → "Edit image in FileForge"; right-click a PDF link → "Open PDF in FileForge"
• Alt+Shift+F opens FileForge from any tab

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

## Description (Ukrainian · українська)

FileForge — набір інструментів для щоденної роботи з файлами, який працює повністю у вашому браузері. Нічого нікуди не завантажується: фото й документи не залишають ваш комп'ютер.

ЗОБРАЖЕННЯ
• Обрізка перетягуванням або точними числами, пресети співвідношення сторін
• Зміна розміру в пікселях або відсотках, пресети 4K / Full HD / HD / Instagram
• Поворот і віддзеркалення
• Стиснення JPG, PNG і WebP, у тому числі до заданого розміру (наприклад, до 200 КБ)
• Конвертація між JPG, PNG і WebP
• HEIC (фото з iPhone) → JPG або PNG
• Текстовий водяний знак із живим попереднім переглядом
• Видалення метаданих: EXIF, GPS-локація, XMP і коментарі, без перекодування
• Генератор фавіконок і іконок застосунку: favicon.ico, усі PNG-розміри, HTML-сніпет і web manifest
• Права кнопка на будь-якому зображенні → «Редагувати зображення у FileForge»

PDF
• Злиття PDF у потрібному порядку
• Розділення за діапазонами сторінок, по одній сторінці або частинами
• Поворот і видалення сторінок
• Нумерація сторінок і діагональний водяний знак (ЧЕРНЕТКА, КОНФІДЕНЦІЙНО…)
• Стиснення сканованих PDF
• Зображення → PDF і PDF → зображення (PNG або JPG, 72–300 dpi)
• Права кнопка на посиланні на PDF → «Відкрити PDF у FileForge»

ТЕКСТ І ДАНІ
• Markdown → PDF із живим попереднім переглядом і трьома темами
• CSV ⇄ JSON
• Форматування й перевірка JSON із точною позицією помилки
• Base64 для тексту й файлів

ПРИВАТНІСТЬ І ДОЗВОЛИ
Усе виконується локально: немає сервера, облікових записів, аналітики й мережевих запитів. Розширенню потрібен лише дозвіл contextMenus для пункту в контекстному меню. Доступ до сайту запитується для одного сайту й лише тоді, коли ви обираєте пункт меню на ньому.

Відкритий код: https://github.com/andronaft/FileForge
Веб-версія: https://andronaft.github.io/FileForge/

## Single purpose

Edit and convert the user's own image, PDF and text files locally in the browser.

## Permission justifications

- **contextMenus**: the "Edit image in FileForge" entry in the right-click menu of images and "Open PDF in FileForge" on PDF links and pages.
- **Optional host permissions (`<all_urls>`)**: requested for a single site, only when the user chooses one of those menu items there, so the extension can fetch that image or PDF. Never requested up front.
- **Sandbox page** (`app/heic-sandbox.html`): runs the HEIC decoder (heic2any / libheif), which needs `new Function`; it is isolated from the extension's privileges and only exchanges image bytes with the app page.

## Data usage

Does not collect or transmit any user data.

## Privacy policy URL

https://andronaft.github.io/FileForge/privacy.html

## Assets

- Icon: `icons/icon128.png`
- Screenshots, 1280×800 JPEG: `docs/store/1-crop.jpg` … `5-pdf-to-images.jpg` (upload in order); addons.mozilla.org also
  takes `6-watermark.jpg` … `8-favicons.jpg`
- Small promo tile, 440×280: `docs/store/promo-small-440x280.jpg`
- Marquee, 1400×560: `docs/store/promo-marquee-1400x560.jpg`
- Regenerate all of them with `python3 scripts/store_assets.py` (uses the installed Chrome headless; the plain app
  screenshots land in `docs/screenshots/`)
