# Background removal (vendored)

- `isnet-general-use-w8.onnx`: the ISNet general-use model from [DIS](https://github.com/xuebinqin/DIS)
  (Xuebin Qin et al., Apache-2.0, see `ISNet.LICENSE`), taken as `isnet-general-use.onnx` from the [rembg](https://github.com/danielgatis/rembg)
  release `v0.0.0` (SHA-256 `60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a`, 176 MB).
  **Modified** by `scripts/isnet_weights_int8.py`: every Conv weight is stored as int8 with one scale per output
  channel and restored to float32 by a `DequantizeLinear` node, so activations stay float32; only the main output
  `output_image` is kept. 46.5 MB; on eight test photos the masks match the original model with IoU ≥ 0.999.
  Input `input_image` [1, 3, 1024, 1024] = RGB / max − 0.5; output [1, 1, 1024, 1024], min-max normalised.
- `ort.webgpu.min.mjs`, `ort-wasm-simd-threaded.asyncify.mjs`, `ort-wasm-simd-threaded.asyncify.wasm`:
  [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) 1.31.1 (npm `onnxruntime-web`), MIT, see
  `onnxruntime-web.LICENSE`. WebGPU and WebAssembly (SIMD) in one build. **Modified**: in
  `ort-wasm-simd-threaded.asyncify.mjs` the embind `_emval_get_method_caller` built its caller with
  `new Function(...)`; it is replaced with an equivalent closure, so the files contain no dynamic code evaluation and
  run under the extension's `script-src 'self' 'wasm-unsafe-eval'`. The source-map comment in `ort.webgpu.min.mjs`
  is removed (the map is not shipped).
