// Face detector (YuNet, ONNX Runtime Web on the processor) in a module worker, so the page stays responsive.
// Messages in:  { id, type: "run", rgba: ArrayBuffer (640×640×4) } → { id, ok, faces: [{ x, y, w, h, score }] in 640 px }
// The model is 230 KB and runs in ~20–60 ms a tile on the processor, so WebGPU is not worth its start-up time here.
import * as ort from "../vendor/rembg/ort.webgpu.min.mjs";

const MODEL = new URL("../vendor/faces/face_detection_yunet_2023mar.onnx", import.meta.url).href;
const SIZE = 640;

ort.env.wasm.wasmPaths = new URL("../vendor/rembg/", import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = "error";

let session = null;
async function load() {
  session ??= (async () => {
    const res = await fetch(MODEL);
    if (!res.ok) throw new Error("Could not read the face model");
    return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  })().catch((err) => { session = null; throw err; });
  return session;
}

/** RGBA → planar BGR float32 in 0…255: what OpenCV's blobFromImage gives YuNet. */
function toInput(rgba) {
  const n = SIZE * SIZE, px = new Uint8ClampedArray(rgba), out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = px[j + 2];
    out[n + i] = px[j + 1];
    out[2 * n + i] = px[j];
  }
  return out;
}

/** YuNet's three heads (strides 8, 16, 32) → boxes, decoded the way OpenCV's FaceDetectorYN does. */
function decode(out, threshold) {
  const faces = [];
  for (const s of [8, 16, 32]) {
    const cls = out[`cls_${s}`].data, obj = out[`obj_${s}`].data, box = out[`bbox_${s}`].data;
    const cols = SIZE / s;
    for (let i = 0; i < cls.length; i++) {
      const c = Math.min(1, Math.max(0, cls[i])), o = Math.min(1, Math.max(0, obj[i]));
      const score = Math.sqrt(c * o);
      if (score < threshold) continue;
      const r = Math.floor(i / cols), col = i % cols;
      const cx = (col + box[i * 4]) * s, cy = (r + box[i * 4 + 1]) * s;
      const w = Math.exp(box[i * 4 + 2]) * s, h = Math.exp(box[i * 4 + 3]) * s;
      faces.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  return faces;
}

let queue = Promise.resolve();
self.onmessage = (e) => {
  const { id, type, rgba, threshold = 0.6 } = e.data || {};
  if (type !== "run") return;
  const job = queue.then(async () => {
    const s = await load();
    const input = new ort.Tensor("float32", toInput(rgba), [1, 3, SIZE, SIZE]);
    const out = await s.run({ [s.inputNames[0]]: input });
    const faces = decode(out, threshold);
    input.dispose?.();
    for (const t of Object.values(out)) t.dispose?.();
    return faces;
  });
  queue = job.catch(() => {});
  job.then((faces) => postMessage({ id, ok: true, faces }), (err) => postMessage({ id, ok: false, error: err?.message || String(err) }));
};
