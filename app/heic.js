// HEIC/HEIF decoding shared by every image tool: libheif (WebAssembly) in a worker, so the page stays responsive.

export function isHeic(file) {
  return file.type === "image/heic" || file.type === "image/heif" || /\.hei[cf]$/i.test(file.name);
}

const TIMEOUT_MS = 120000; // a 48 MP photo takes a few seconds; anything this long means the decoder is stuck

let worker = null;
let seq = 0;
const pending = new Map();

function failAll(message) {
  const waiting = [...pending.values()];
  pending.clear();
  for (const p of waiting) { clearTimeout(p.timer); p.reject(new Error(message)); }
  worker?.terminate();
  worker = null;
}

function heicWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./heic-worker.js", import.meta.url));
  worker.onmessage = (e) => {
    const p = pending.get(e.data?.id);
    if (!p) return;
    pending.delete(e.data.id);
    clearTimeout(p.timer);
    if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.images);
  };
  worker.onerror = (e) => { e.preventDefault?.(); failAll("The HEIC decoder failed to start" + (e.message ? `: ${e.message}` : "")); };
  return worker;
}

/** Start loading the decoder ahead of time (it is ~2 MB). */
export function warmHeic() {
  try { heicWorker(); } catch (_) { /* reported on first use */ }
}

// Low-priority jobs (thumbnails) reach the worker one at a time and only while nothing else is in flight,
// so a conversion the user started waits behind at most one thumbnail.
const lowQueue = [];
let lowBusy = false;
function pumpLow() {
  if (lowBusy || pending.size || !lowQueue.length) return;
  lowBusy = true;
  lowQueue.shift()().finally(() => { lowBusy = false; setTimeout(pumpLow, 0); });
}

function send(file, all) {
  return file.arrayBuffer().then((buffer) => new Promise((resolve, reject) => {
    const w = heicWorker();
    const id = ++seq;
    const done = (fn) => (v) => { fn(v); setTimeout(pumpLow, 0); };
    const timer = setTimeout(() => { pending.delete(id); failAll(`Decoding ${file.name} took too long`); }, TIMEOUT_MS);
    pending.set(id, { resolve: done(resolve), reject: done(reject), timer });
    w.postMessage({ id, buffer, all }, [buffer]);
  }));
}

/** Decode a HEIC/HEIF file into canvases: the primary image, or every top-level image when `all` is set.
 *  `priority: "low"` queues the job behind everything else (used for thumbnails). */
export async function decodeHeic(file, { all = false, priority = "high" } = {}) {
  const images = priority === "low"
    ? await new Promise((resolve, reject) => { lowQueue.push(() => send(file, all).then(resolve, reject)); setTimeout(pumpLow, 0); })
    : await send(file, all);
  return images.map(({ width, height, data }) => {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    c.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
    return c;
  });
}

export function canvasToBlob(canvas, type, quality) {
  if (type === "image/jpeg") { // JPEG has no alpha: flatten onto white rather than black
    const flat = document.createElement("canvas");
    flat.width = canvas.width; flat.height = canvas.height;
    const g = flat.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, flat.width, flat.height); g.drawImage(canvas, 0, 0);
    canvas = flat;
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image"))), type, quality));
}

/** `file` as a browser-readable image: HEIC/HEIF becomes a JPEG File (primary image), anything else is returned as is. */
export async function toBrowserImage(file) {
  if (!isHeic(file)) return file;
  const [canvas] = await decodeHeic(file);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.95);
  return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
}
