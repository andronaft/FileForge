// Background removal model (ISNet, ONNX Runtime Web) in a module worker, so the page stays responsive.
// Messages in:  { id, type: "load" }                              → { id, ok, backend }
//               { id, type: "run", rgba: ArrayBuffer (1024×1024×4) } → { id, ok, mask: ArrayBuffer (1024×1024 bytes), ms }
// Messages out also include { type: "progress", loaded, total } while the model file is read.
import * as ort from "../vendor/rembg/ort.webgpu.min.mjs";

const DIR = new URL("../vendor/rembg/", import.meta.url).href;
const MODEL = DIR + "isnet-general-use-w8.onnx";
const SIZE = 1024;

ort.env.wasm.wasmPaths = DIR;
// Several threads need SharedArrayBuffer, which only a cross-origin isolated page has.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = "error";

let session = null, backend = "", loading = null;

async function readModel() {
  const res = await fetch(MODEL);
  if (!res.ok) throw new Error("Could not read the model");
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const buf = new Uint8Array(total);
  const reader = res.body.getReader();
  let loaded = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf.set(value, loaded);
    loaded += value.length;
    if (loaded - last > total / 50) { last = loaded; postMessage({ type: "progress", loaded, total }); }
  }
  return loaded === total ? buf : buf.subarray(0, loaded);
}

async function gpuUsable() {
  try {
    if (!self.navigator?.gpu) return false;
    return !!(await navigator.gpu.requestAdapter());
  } catch (_) { return false; }
}

function load(force) {
  loading ??= (async () => {
    const model = await readModel();
    postMessage({ type: "stage", stage: "model-read" });
    if (force !== "wasm" && (await gpuUsable())) {
      try {
        session = await ort.InferenceSession.create(model, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
        backend = "webgpu";
        postMessage({ type: "stage", stage: "ready" });
        return;
      } catch (err) { console.warn("WebGPU unavailable for the model, using the processor", err); }
    }
    session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    backend = "wasm";
    postMessage({ type: "stage", stage: "ready" });
  })().catch((err) => { loading = null; throw err; });
  return loading;
}

/** RGBA bytes of a SIZE×SIZE image → planar float32, scaled like rembg does for ISNet: x / max − 0.5. */
function toInput(rgba) {
  const n = SIZE * SIZE, px = new Uint8ClampedArray(rgba), out = new Float32Array(3 * n);
  let max = 1;
  for (let i = 0; i < n; i++) { const j = i * 4; if (px[j] > max) max = px[j]; if (px[j + 1] > max) max = px[j + 1]; if (px[j + 2] > max) max = px[j + 2]; }
  const k = 1 / max;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[i] = px[j] * k - 0.5;
    out[n + i] = px[j + 1] * k - 0.5;
    out[2 * n + i] = px[j + 2] * k - 0.5;
  }
  return out;
}

// One run at a time: a session is not meant to run twice at once, and the graphics card has no use for it either.
let queue = Promise.resolve();
function run(rgba) {
  const job = queue.then(() => runNow(rgba));
  queue = job.catch(() => {});
  return job;
}

async function runNow(rgba) {
  await load();
  postMessage({ type: "stage", stage: "run" });
  const t0 = performance.now();
  const input = new ort.Tensor("float32", toInput(rgba), [1, 3, SIZE, SIZE]);
  const out = await session.run({ [session.inputNames[0]]: input });
  const data = out[session.outputNames[0]].data;
  input.dispose?.();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1, mask = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) mask[i] = Math.round(((data[i] - lo) / span) * 255);
  for (const t of Object.values(out)) t.dispose?.();
  return { mask, ms: Math.round(performance.now() - t0) };
}

self.onmessage = async (e) => {
  const { id, type } = e.data || {};
  try {
    if (type === "load") { await load(e.data.backend); postMessage({ id, ok: true, backend }); }
    else if (type === "run") {
      const { mask, ms } = await run(e.data.rgba);
      postMessage({ id, ok: true, mask: mask.buffer, ms, backend }, [mask.buffer]);
    }
  } catch (err) {
    postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
