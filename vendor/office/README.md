# Office formats (vendored)

- `mammoth.browser.min.js`: [mammoth](https://github.com/mwilliamson/mammoth.js) 1.13.0, BSD-2-Clause. Reads .docx
  into HTML, Markdown or plain text. **Modified**: two dead `Function(...)` calls of the bundled underscore.js
  (the global-object fallback and `_.template`, which mammoth never uses) are replaced, so the file has no dynamic
  code evaluation.
- `xlsx.full.min.js`: [SheetJS Community Edition](https://sheetjs.com) 0.20.3 from cdn.sheetjs.com (the npm
  package is stuck at 0.18.5, which has known security issues), Apache-2.0, see `xlsx.LICENSE`. Unmodified.

`../gifenc.esm.js`: [gifenc](https://github.com/mattdesl/gifenc) 1.0.3, MIT. Unmodified.
