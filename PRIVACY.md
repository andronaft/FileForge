# FileForge privacy policy

Last updated: 2026-11-02

FileForge processes files entirely on your device, inside your browser.

- **No uploads.** Images, PDFs, text and any other files you open in FileForge never leave your computer. There is no FileForge server.
- **No accounts, no tracking.** FileForge does not collect, store or transmit personal data, usage statistics or crash reports. It contains no analytics and no third-party scripts that load from the network.
- **Permissions.** The extension asks only for `contextMenus` (to add "Edit image in FileForge" and "Open PDF in FileForge" to the right-click menu) and `scripting` (to read an image that exists only inside the page, a `blob:` URL, when you choose the menu item on it). When you use one of those menu items on a website, the browser asks you for permission to read files from that one site so the image or PDF can be opened in FileForge. You can decline; FileForge then opens empty and you can drop the file manually. The extension never reads a page you did not use the menu on.
- **Storage.** Nothing is written to disk except the files you choose to download. Each tool remembers the options you used last time (format, quality, page size and the like), and the theme you picked, in the browser's local storage on your device; that is settings only, never file contents or names. The web version at andronaft.github.io keeps a copy of its own code in the browser cache so it works offline; it stores none of your files.

Questions: open an issue at https://github.com/andronaft/FileForge/issues
