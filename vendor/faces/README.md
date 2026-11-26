# Face detection (vendored)

- `face_detection_yunet_2023mar.onnx`: YuNet, the face detector from [OpenCV Zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
  (Shiqi Yu et al., MIT, see `YuNet.LICENSE`), unmodified. 232 KB, SHA-256
  `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`.
  Input `input` [1, 3, 640, 640] = BGR in 0…255 (what OpenCV's `blobFromImage` gives); outputs `cls_*`, `obj_*`,
  `bbox_*`, `kps_*` for strides 8, 16 and 32, decoded in `app/faces-worker.js` the way OpenCV's `FaceDetectorYN` does.
- Runs on ONNX Runtime Web from `vendor/rembg/` (WebAssembly only: the model is small enough that WebGPU's start-up
  costs more than it saves).
