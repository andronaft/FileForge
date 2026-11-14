# OCR engine (vendored)

- `tesseract.min.js`, `worker.min.js`: [tesseract.js](https://github.com/naptha/tesseract.js) 7.0.0, Apache-2.0.
  **Modified**: the three default CDN URLs (worker, core and language data on cdn.jsdelivr.net) are replaced with
  local relative paths, so the code cannot load anything from the network. FileForge always passes explicit local
  `workerPath`, `corePath` and `langPath`. The two `Function(...)` fallbacks of the bundled polyfills (dead code in modern browsers) are replaced with
  plain `self` references, so the files contain no dynamic code evaluation at all.
- `tesseract-core-simd-lstm.js`, `tesseract-core-simd-lstm.wasm`: [tesseract.js-core](https://github.com/naptha/tesseract.js-core)
  6.1.2 (Tesseract compiled to WebAssembly, LSTM engine, SIMD), Apache-2.0. Unmodified.
- `eng.traineddata.gz`, `ukr.traineddata.gz`: Tesseract `tessdata_best` models converted to integer
  (`4.0.0_best_int`) from [@tesseract.js-data](https://github.com/naptha/tessdata), Apache-2.0. Unmodified.
