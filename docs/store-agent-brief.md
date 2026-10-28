# Brief for a browser agent: publish FileForge 0.3.0 to the Chrome Web Store and addons.mozilla.org

You are filling in two store listings on behalf of the signed-in developer (Andrii, GitHub `andronaft`).
You do **everything** except choosing files in the OS file picker: every step marked **[ANDRII uploads]** is a
file upload that only he can do. When you reach one, stop, tell him exactly which file(s) to pick and which
button opens the picker, wait until the upload is done, then continue.

Never enter passwords, payment details or API keys. If a page asks to sign in or pay the $5 developer fee, hand
it to Andrii and continue once he is through. Never click "Delete", "Unpublish" or "Cancel review". Do not
change any already-saved field without telling him. Copy every text below **verbatim**, including the bullet
characters and line breaks.

Files (all inside the repository folder `/Users/andrii/Desktop/FileForge`):

| What                               | Path                                     |
| ---------------------------------- | ---------------------------------------- |
| Chrome package                     | `dist/fileforge-chrome-0.3.0.zip`        |
| Firefox package                    | `dist/fileforge-firefox-0.3.0.zip`       |
| Store icon 128×128                 | `icons/icon128.png`                      |
| Screenshots 1280×800 (in order)    | `docs/store/1-crop.jpg` `2-pdf-merge.jpg` `3-compress.jpg` `4-md-to-pdf.jpg` `5-pdf-to-images.jpg` `6-watermark.jpg` `7-json-format.jpg` `8-favicons.jpg` |
| Small promo tile 440×280           | `docs/store/promo-small-440x280.jpg`     |
| Marquee promo tile 1400×560        | `docs/store/promo-marquee-1400x560.jpg`  |

Links used in both stores:

- Homepage / web version: `https://andronaft.github.io/FileForge/`
- Privacy policy: `https://andronaft.github.io/FileForge/privacy.html`
- Support / issues: `https://github.com/andronaft/FileForge/issues`
- Source: `https://github.com/andronaft/FileForge`

---

## Part 1 · Chrome Web Store

Open `https://chrome.google.com/webstore/devconsole`. If it shows a registration page or the $5 fee, stop and
let Andrii finish it; also make sure the publisher email is verified (Account page) and the "Trader / non-trader"
choice is made, otherwise submitting is blocked.

### 1.1 Create the item **[ANDRII uploads]**

Click **New item**. In the dialog Andrii must choose `dist/fileforge-chrome-0.3.0.zip`. After the upload the
dashboard opens the item's edit page. The URL looks like
`https://chrome.google.com/webstore/devconsole/<publisher>/<ITEM_ID>/edit`; the 32-letter `ITEM_ID` is needed at
the end, write it down.

### 1.2 Tab "Store listing"

Fill the fields exactly like this.

**Description** (the textarea; the name and summary are read from the manifest and are not editable here):

```
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
```

**Category**: `Productivity`, subcategory `Tools`.

**Language**: `English`. If the language selector at the top of the Store listing tab also offers
**Ukrainian** (the package ships `_locales/uk`), switch to it and paste this description there, then switch back:

```
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
```

**Graphic assets** **[ANDRII uploads]**:

- Store icon: `icons/icon128.png`
- Screenshots (click "Add" for each, in this order): `docs/store/1-crop.jpg`, `2-pdf-merge.jpg`,
  `3-compress.jpg`, `4-md-to-pdf.jpg`, `5-pdf-to-images.jpg`. The store allows up to 5, so stop there.
- Small promo tile: `docs/store/promo-small-440x280.jpg`
- Marquee promo tile: `docs/store/promo-marquee-1400x560.jpg`
- Global promo video: leave empty.

**Additional fields**:

- Official URL: leave as is (it needs a verified site in Search Console; skip).
- Homepage URL: `https://andronaft.github.io/FileForge/`
- Support URL: `https://github.com/andronaft/FileForge/issues`
- Mature content: `No`.

Click **Save draft**.

### 1.3 Tab "Privacy"

**Single purpose description**:

```
Edit and convert the user's own image, PDF and text files locally in the browser.
```

**Permission justification** — one box per permission the dashboard lists:

- `contextMenus`:

  ```
  Adds "Edit image in FileForge" to the right-click menu of images and "Open PDF in FileForge" to PDF links and pages. That is the only way the extension touches a web page.
  ```

- Host permission (`<all_urls>`, listed under optional host permissions):

  ```
  Declared as an optional host permission only. It is requested for a single site, and only when the user picks "Edit image in FileForge" or "Open PDF in FileForge" on that site, so the extension can fetch that one image or PDF. Nothing is requested at install time and no page is read otherwise.
  ```

- If the form also asks about the sandbox page or `sandbox` entry:

  ```
  app/heic-sandbox.html runs the HEIC decoder (heic2any / libheif), which needs new Function. It is isolated from extension privileges and only exchanges image bytes with the app page via postMessage.
  ```

**Are you using remote code?**: `No, I am not using remote code`.

**Data usage**: tick **nothing** in the list of data types (the extension collects no data at all). Then tick all
three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**: `https://andronaft.github.io/FileForge/privacy.html`

Click **Save draft**.

### 1.4 Tab "Distribution"

- Payments: `Free of charge`
- Visibility: `Public`
- Distribution: `All regions`

Save draft.

### 1.5 Submit

Click **Submit for review** at the top right. In the confirmation dialog leave **"Publish automatically after it
has passed review"** ticked and confirm. If the dialog lists missing fields, fix them from the texts above and
submit again. The item then shows status *Pending review*.

Report back the `ITEM_ID` from the URL.

### 1.6 Save the item ID in GitHub (only if signed in to GitHub as andronaft)

Open `https://github.com/andronaft/FileForge/settings/variables/actions`, click **New repository variable**,
Name `CWS_EXTENSION_ID`, Value = the `ITEM_ID`, **Add variable**. Do not touch the Secrets tab; Andrii adds the
secrets himself.

---

## Part 2 · addons.mozilla.org (Firefox)

Open `https://addons.mozilla.org/developers/addon/submit/distribution`. If it asks to sign in or to accept the
Developer Agreement, let Andrii do it.

### 2.1 Distribution and upload **[ANDRII uploads]**

- Choose **On this site** (listed), Continue.
- Select **Firefox** as the application (leave Firefox for Android unticked unless it is pre-ticked; either is
  fine).
- **Select a file…** → Andrii picks `dist/fileforge-firefox-0.3.0.zip`. Wait for the validator; it must say the
  add-on passed (warnings are fine, errors are not). Continue.

### 2.2 Source code

"Do You Need to Submit Source Code?" → **No**. The package is unminified source already; the notes to the
reviewer explain it. Continue.

### 2.3 Describe the add-on

- **Name**: leave `FileForge: image, PDF & file tools` (taken from the manifest).
- **Add-on URL** (slug): `fileforge`.
- **Summary**:

  ```
  Crop, resize, compress and convert images, merge/split/compress PDFs, Markdown to PDF, CSV/JSON tools. 100% on your device.
  ```

- **Description**:

  ```
  FileForge is a toolbox for everyday file jobs that works entirely inside your browser. Nothing is uploaded anywhere: your photos and documents never leave your computer.

  IMAGES
  • Crop with drag handles or exact numbers, with aspect-ratio presets
  • Resize by pixels or percent, with quality-preserving downscaling
  • Rotate and flip
  • Compress JPG, PNG and WebP, with a size preview before you download
  • Convert between JPG, PNG and WebP
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
  Everything runs locally: there is no server, no account, no analytics and no network requests. The add-on needs only the contextMenus permission for the right-click entries. When you use one of them on a page, it asks for access to that one site so it can read the image or PDF, and only then.

  HEIC (iPhone photos) → JPG is available in the web version at https://andronaft.github.io/FileForge/ because the decoder needs a sandboxed page, which Firefox add-ons do not have.

  Open source: https://github.com/andronaft/FileForge
  ```

  (Remove the two leading spaces of each line when pasting; they are only Markdown indentation here.)

- **This add-on is experimental**: unticked.
- **This add-on requires payment…**: unticked.
- **Select up to 2 categories**: `Photos, Music & Videos` and `Other`.
- **Support email**: leave empty. **Support website**: `https://github.com/andronaft/FileForge/issues`.
- **License**: `MIT License` (under "Other" / open-source licenses if a list is shown).
- **This add-on has a Privacy Policy**: tick, and paste:

  ```
  FileForge processes files entirely on your device, inside your browser.

  No uploads. Images, PDFs, text and any other files you open in FileForge never leave your computer. There is no FileForge server.

  No accounts, no tracking. FileForge does not collect, store or transmit personal data, usage statistics or crash reports. It contains no analytics and no third-party scripts that load from the network.

  Permissions. The add-on asks only for contextMenus (to add "Edit image in FileForge" and "Open PDF in FileForge" to the right-click menu). When you use one of those menu items on a website, the browser asks you for permission to read files from that one site so the image or PDF can be opened in FileForge. You can decline; FileForge then opens empty and you can drop the file manually.

  Storage. Nothing is written to disk except the files you choose to download.

  Full text: https://andronaft.github.io/FileForge/privacy.html
  Questions: https://github.com/andronaft/FileForge/issues
  ```

- **Notes to Reviewer**:

  ```
  The add-on is plain JavaScript (ES modules) with no build step; the uploaded files are the sources, also at https://github.com/andronaft/FileForge. The Firefox package is produced by scripts/package.py, which only rewrites manifest.json.

  vendor/ contains unmodified official builds of pdf-lib 1.17.1, pdf.js 4.10.38, marked 12.0.2 and JSZip 3.10.1. No remote code is loaded and the add-on makes no network requests.
  ```

Click **Submit Version**. The page then says the version is queued for review.

### 2.4 Finish the listing (Manage page)

Open `https://addons.mozilla.org/developers/addon/fileforge/edit` (or click **Manage Listing**).

**Edit Product Page → Basic Information**: set **Homepage** to `https://andronaft.github.io/FileForge/`. Save.

**Images** **[ANDRII uploads]**:

- Add-on icon: `icons/icon128.png`
- Screenshots, in this order: `docs/store/1-crop.jpg` … `8-favicons.jpg` (all eight). Save Changes.

**Ukrainian translation**: in the Basic Information section each text field has a language switcher (a row of
language tabs or an "Add a new localization" link above the field). Add **Українська (uk)** and fill in:

- Summary:

  ```
  Обрізка, стиснення й конвертація фото, злиття та розділення PDF, Markdown → PDF, CSV/JSON. Усе на вашому пристрої.
  ```

- Description: the Ukrainian text from section 1.2 above, plus this last paragraph:

  ```
  HEIC → JPG доступний у веб-версії https://andronaft.github.io/FileForge/, бо декодеру потрібна ізольована сторінка, якої немає у Firefox.
  ```

Save Changes.

**Technical details / Additional details**: Default locale `English (US)`; leave the rest.

### 2.5 Report

Tell Andrii: the AMO listing URL (`https://addons.mozilla.org/firefox/addon/fileforge/`), the Chrome `ITEM_ID`,
and anything you could not fill in. Reviews take a day to a few days on AMO and a few days on the Chrome Web
Store; nothing else is needed from the dashboards until then.
