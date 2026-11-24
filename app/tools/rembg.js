// Remove background: a neural network (ISNet, Apache-2.0) finds the subject of any photo, even on a busy background.
// It runs on this device through ONNX Runtime Web: on the graphics card (WebGPU) when the browser has one, otherwise
// on the processor (WebAssembly). The model ships with FileForge and is loaded only when this tool is used.
import { el, baseName, field, select, checkbox, plural, toast, t } from "../util.js";
import { loadImage, makeCanvas, dims, encode } from "./image.js";

const SIZE = 1024; // the model's input and output size
const MAX_PIXELS = 40e6; // larger photos are scaled down to this for the output

// ---------- the model, in a worker ----------

let worker = null, seq = 0, idle = 0, modelRead = false;
// "wasm" forces the processor (tests, or a graphics card that misbehaves): localStorage["fileforge.rembg.backend"]
let forced = (() => { try { return localStorage.getItem("fileforge.rembg.backend") || ""; } catch (_) { return ""; } })();
const pending = new Map();
const listeners = new Set(); // (msg) => void: model-loading progress and stages
let ready = null; // Promise<backend>
// A graphics card that stops answering (a driver hang, the GPU still busy with a page that was just reloaded) would
// leave the tool waiting forever: watchdog() below hands the work to the processor instead.

function rembgWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../rembg-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "progress" || m.type === "stage") {
      if (m.type === "stage") modelRead = true;
      for (const fn of [...listeners]) fn(m);
      return;
    }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m); else p.reject(new Error(m.error || "The background model failed"));
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    stopWorker(new Error("The background model failed to start" + (e.message ? `: ${e.message}` : "")));
  };
  return worker;
}

/** End the worker; whatever was waiting on it fails with `err` (and may retry on a new one). */
function stopWorker(err) {
  worker?.terminate();
  worker = null; ready = null; modelRead = false;
  for (const p of pending.values()) p.reject(err || new Error("The background model was stopped"));
  pending.clear();
}

function call(msg, transfer = []) {
  clearTimeout(idle);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    rembgWorker().postMessage({ ...msg, id }, transfer);
  }).finally(() => {
    // The model holds a few hundred MB of memory: give it back after a while without work.
    clearTimeout(idle);
    idle = setTimeout(() => { if (!pending.size) stopWorker(); }, 180_000);
  });
}

function loadModel(onProgress) {
  if (onProgress) listeners.add(onProgress);
  ready ??= call({ type: "load", backend: forced }).then((m) => m.backend).catch((err) => { ready = null; throw err; });
  return ready.finally(() => { if (onProgress) listeners.delete(onProgress); });
}

/**
 * `work`, failed when the graphics card goes quiet for too long: from the moment the model file is read (reading it
 * can be slow on a slow connection, and is not timed), `PREPARE_MS` for the model to get ready, then `RUN_MS` for
 * each photo. The processor is slow but never hangs, so it is not timed.
 */
const PREPARE_MS = 75_000, RUN_MS = 40_000;
function watchdog(work, onProcessor) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => (onProcessor() ? arm(ms) : reject(new Error("The graphics card did not answer"))), ms);
    };
    const onMsg = (m) => {
      if (m.stage === "model-read") arm(PREPARE_MS);
      else if (m.stage === "run") arm(RUN_MS);
    };
    listeners.add(onMsg);
    if (modelRead) arm(PREPARE_MS);
    work.then(resolve, reject).finally(() => { clearTimeout(timer); listeners.delete(onMsg); });
  });
}

// Masks are kept per file for this tab: the preview and the run use the same one, and changing an option is instant.
const masks = new WeakMap(); // File → Promise<{ mask: Uint8Array (SIZE²), ms, backend, w, h }>

async function computeMask(file, status) {
  const img = await loadImage(file);
  const { w, h } = dims(img);
  const c = makeCanvas(SIZE, SIZE);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, SIZE, SIZE);
  if (img.close) img.close();
  const rgba = g.getImageData(0, 0, SIZE, SIZE).data.buffer;
  const mayUseGpu = forced !== "wasm";
  let chosen = "";
  const work = (async () => {
    const backend = (chosen = await loadModel((m) => {
      if (m.type === "progress") status?.(t("Loading the background model: {pct}%", { pct: Math.round((m.loaded / m.total) * 100) }));
      else if (m.stage === "model-read") status?.(t("Preparing the model, the first photo takes longer…"));
    }));
    status?.(backend === "webgpu" ? t("Finding the subject on the graphics card…") : t("Finding the subject on the processor, up to a minute…"));
    return call({ type: "run", rgba }, [rgba]);
  })();
  let m;
  try {
    m = mayUseGpu ? await watchdog(work, () => chosen === "wasm") : await work;
  } catch (err) {
    if (!mayUseGpu || forced === "wasm" && !/graphics card/.test(err.message) || /read the model/.test(err.message)) throw err;
    // The graphics card gave up (driver, memory, no answer): the processor always works.
    console.warn("WebGPU failed, using the processor", err);
    work.catch(() => {});
    if (forced !== "wasm") { forced = "wasm"; stopWorker(err); }
    return computeMask(file, status);
  }
  return { mask: new Uint8Array(m.mask), ms: m.ms, backend: m.backend, w, h };
}

// Status lines go to whoever asked for the file's mask last (the preview, then the run), and a late asker
// gets the current line at once.
const statusOf = new WeakMap(); // File → { fn, text }

export function maskFor(file, status) {
  const st = statusOf.get(file) || {};
  st.fn = status; statusOf.set(file, st);
  if (status && st.text) try { status(st.text); } catch (_) { /* cancelled */ }
  let p = masks.get(file);
  if (!p) {
    p = computeMask(file, (text) => {
      const cur = statusOf.get(file);
      if (!cur) return;
      cur.text = text;
      try { cur.fn?.(text); } catch (_) { /* a cancelled job's progress bar: the mask is still worth finishing */ }
    });
    masks.set(file, p);
    p.catch(() => masks.delete(file));
  }
  return p;
}

// ---------- compositing ----------

/** The mask as a canvas of white pixels with the mask in alpha, at the model's size. `sharp` steepens the edge. */
function maskCanvas(mask, sharp) {
  const c = makeCanvas(SIZE, SIZE), g = c.getContext("2d");
  const img = g.createImageData(SIZE, SIZE), d = img.data;
  for (let i = 0; i < mask.length; i++) {
    let a = mask[i];
    if (sharp) { const x = Math.min(1, Math.max(0, (a / 255 - 0.3) / 0.4)); a = Math.round(x * x * (3 - 2 * x) * 255); }
    const j = i * 4;
    d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = a;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Brush strokes are stored in fractions of the image, so they apply at preview size and at full size alike. */
function paintStrokes(g, strokes, w, h) {
  const unit = Math.max(w, h);
  g.save();
  g.lineCap = g.lineJoin = "round";
  g.strokeStyle = g.fillStyle = "#fff";
  for (const s of strokes) {
    g.globalCompositeOperation = s.mode === "keep" ? "source-over" : "destination-out";
    g.lineWidth = s.r * 2 * unit;
    const [x0, y0] = s.pts[0];
    if (s.pts.length === 1) { g.beginPath(); g.arc(x0 * w, y0 * h, s.r * unit, 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath(); g.moveTo(x0 * w, y0 * h);
    for (let i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i][0] * w, s.pts[i][1] * h);
    g.stroke();
  }
  g.restore();
}

/** Alpha of the subject at w × h: the model's mask scaled up, plus the brush strokes. */
function alphaAt(maskC, strokes, w, h) {
  const a = makeCanvas(w, h), g = a.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(maskC, 0, 0, w, h);
  if (strokes.length) paintStrokes(g, strokes, w, h);
  return a;
}

/** Bounding box of the opaque part of an alpha canvas, measured on a small copy (fast at any size). */
function subjectBox(alpha) {
  const { width: w, height: h } = alpha, k = Math.min(1, 600 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
  const s = makeCanvas(sw, sh), g = s.getContext("2d", { willReadFrequently: true });
  g.drawImage(alpha, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (d[(y * sw + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const X0 = Math.max(0, Math.floor((x0 - 1) / k)), Y0 = Math.max(0, Math.floor((y0 - 1) / k));
  const X1 = Math.min(w, Math.ceil((x1 + 2) / k)), Y1 = Math.min(h, Math.ceil((y1 + 2) / k));
  return { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 };
}

/** A blurred copy of the photo for the "blur the background" option: scaled down and up again, works everywhere. */
function blurred(img, w, h, strength) {
  const k = Math.max(4, Math.round(Math.max(w, h) / (12 + (100 - strength) * 1.2)));
  let cur = img, cw = w, ch = h;
  // halve step by step down to the target, then draw it back up with smoothing: a soft, even blur
  const tw = Math.max(2, Math.round(w / k)), th = Math.max(2, Math.round(h / k));
  while (cw / 2 > tw) {
    cw = Math.round(cw / 2); ch = Math.round(ch / 2);
    const c = makeCanvas(cw, ch), g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, cw, ch);
    cur = c;
  }
  const small = makeCanvas(tw, th), sg = small.getContext("2d");
  sg.imageSmoothingQuality = "high";
  sg.drawImage(cur, 0, 0, tw, th);
  const out = makeCanvas(w, h), og = out.getContext("2d");
  og.imageSmoothingQuality = "high";
  og.drawImage(small, 0, 0, w, h);
  return out;
}

function cover(g, img, w, h) {
  const { w: iw, h: ih } = dims(img), k = Math.max(w / iw, h / ih);
  g.drawImage(img, (w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
}

/**
 * The finished picture at w × h. o: { bg: transparent|white|colour|blur|image, colour, blur, bgImage, crop, margin, square }.
 * `ghost` (preview only) shows the removed part faintly, so the brush can bring it back.
 */
function compose(img, maskC, strokes, w, h, o, ghost = false) {
  const alpha = alphaAt(maskC, strokes, w, h);
  const subject = makeCanvas(w, h), sg = subject.getContext("2d");
  sg.drawImage(img, 0, 0, w, h);
  sg.globalCompositeOperation = "destination-in";
  sg.drawImage(alpha, 0, 0);

  // the area to keep: the whole photo, or the subject plus a margin (optionally as a square)
  let box = { x: 0, y: 0, w, h };
  if (o.crop) {
    const b = subjectBox(alpha);
    if (b) {
      const m = Math.round(Math.max(b.w, b.h) * (o.margin / 100));
      box = { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
      if (o.square) { const s = Math.max(box.w, box.h); box = { x: box.x - (s - box.w) / 2, y: box.y - (s - box.h) / 2, w: s, h: s }; }
      box = { x: Math.round(box.x), y: Math.round(box.y), w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) };
    }
  } else if (o.square) {
    const s = Math.max(w, h);
    box = { x: Math.round((w - s) / 2), y: Math.round((h - s) / 2), w: s, h: s };
  }

  const out = makeCanvas(box.w, box.h), g = out.getContext("2d");
  g.imageSmoothingQuality = "high";
  if (o.bg === "white" || o.bg === "colour") { g.fillStyle = o.bg === "white" ? "#ffffff" : o.colour; g.fillRect(0, 0, box.w, box.h); }
  else if (o.bg === "blur") g.drawImage(blurred(img, w, h, o.blur), -box.x, -box.y);
  else if (o.bg === "image" && o.bgImage) cover(g, o.bgImage, box.w, box.h);
  if (ghost) { g.globalAlpha = 0.28; g.drawImage(img, -box.x, -box.y, w, h); g.globalAlpha = 1; }
  g.drawImage(subject, -box.x, -box.y);
  return out;
}

const edits = new WeakMap(); // File → { strokes: [], redo: [] }
const editsOf = (file) => { let e = edits.get(file); if (!e) edits.set(file, (e = { strokes: [], redo: [] })); return e; };

// ---------- the tool ----------

const removeBgTool = {
  id: "remove-bg",
  title: "Remove background",
  description: "Cut out people, pets, products and cars from any photo, even on a busy background, like remove.bg. Save it transparent, on white or any colour, with a blurred background or on another picture. A neural network runs on your device: the photo is never uploaded.",
  keywords: ["remove background", "background remover", "remove bg", "removebg", "cut out", "cutout", "transparent png", "erase background", "delete background", "change background", "white background", "product photo", "ai", "прибрати фон", "видалити фон", "вирізати", "прозорий фон", "змінити фон", "убрать фон", "удалить фон", "вырезать"],
  accept: "image/*",
  hint: "Photos of people, pets, products, cars… For a logo or signature on a plain colour, Transparent background is faster",
  runLabel: "Remove background",
  renderOptions(root, files) {
    const state = this.state && files.includes(this.state.file) ? this.state : { file: files[0] };
    this.state = state;

    const bg = select([["transparent", "Transparent"], ["white", "White"], ["colour", "Colour"], ["blur", "Blurred photo"], ["image", "Another picture"]], "transparent");
    const colour = el("input", { type: "color", value: "#2f6df6", title: "Background colour" });
    const blur = el("input", { type: "range", min: 10, max: 100, value: 60, title: "Blur strength" });
    const bgFile = el("input", { type: "file", accept: "image/*", hidden: true });
    const bgPick = el("button", { type: "button", class: "small", text: "Choose a picture…", onclick: () => bgFile.click() });
    const bgName = el("span", { class: "stat" });
    const edge = select([["soft", "Soft (hair, fur)"], ["sharp", "Sharp (products, objects)"]], "soft");
    const crop = checkbox("Crop to the subject", false);
    const margin = el("input", { type: "range", min: 0, max: 40, value: 8, title: "Margin around the subject" });
    const marginLabel = el("span", { class: "stat", text: "8%" });
    const square = checkbox("Square picture (marketplaces, profile photos)", false);
    const format = select([["png", "PNG"], ["webp", "WebP"], ["jpeg", "JPEG"]], "png");
    const formatHint = el("span", { class: "stat" });

    // preview and touch-up
    const modes = [["view", "No brush", "◎"], ["keep", "Restore", "+"], ["erase", "Erase", "−"]];
    let mode = "view";
    const modeBtns = modes.map(([id, label, glyph]) => el("button", { type: "button", class: `chip-btn${id === mode ? " on" : ""}`, "aria-pressed": id === mode ? "true" : "false", title: label, onclick: () => { mode = id; paintModes(); draw(); } }, [el("span", { class: "glyph", text: glyph }), label]));
    const brush = el("input", { type: "range", min: 1, max: 12, value: 4, title: "Brush size" });
    const undoBtn = el("button", { type: "button", class: "small", text: "Undo", onclick: () => { const e = editsOf(state.file); if (e.strokes.length) { e.redo.push(e.strokes.pop()); draw(); } } });
    const resetBtn = el("button", { type: "button", class: "small", text: "Reset touch-ups", onclick: () => { const e = editsOf(state.file); if (e.strokes.length) { e.redo = []; e.strokes = []; draw(); } } });
    const original = checkbox("Show the original", false, { "data-noremember": "" });
    const prevBtn = el("button", { type: "button", class: "icon", text: "‹", title: "Previous photo", onclick: () => show(files.indexOf(state.file) - 1) });
    const nextBtn = el("button", { type: "button", class: "icon", text: "›", title: "Next photo", onclick: () => show(files.indexOf(state.file) + 1) });
    const which = el("span", { class: "stat" });
    const canvas = el("canvas", { class: "checker" });
    const stage = el("div", { class: "crop-stage rembg-stage" }, [canvas]);
    const info = el("div", { class: "stat", role: "status", text: "Loading…" });

    root.append(...[
      el("div", { class: "row" }, [field("Background", bg), colour, field("Blur", blur), bgPick, bgFile, bgName, field("Edges", edge), field("Output format", format)]),
      el("div", { class: "row" }, [crop.label, field("Margin", el("div", { class: "row" }, [margin, marginLabel])), square.label, formatHint]),
      el("div", { class: "annot-bar" }, [el("div", { class: "chip-row" }, [...modeBtns, field("Brush", brush), undoBtn, resetBtn, original.label])]),
      files.length > 1 ? el("div", { class: "actions" }, [prevBtn, which, nextBtn]) : null,
      stage, info,
    ].filter(Boolean));
    this.opts = { bg, colour, blur, edge, crop, margin, square, format, bgImage: () => state.bgImage };

    const opts = () => ({ bg: bg.value, colour: colour.value, blur: Number(blur.value), bgImage: state.bgImage, crop: crop.input.checked, margin: Number(margin.value), square: square.input.checked });
    const syncControls = () => {
      colour.hidden = bg.value !== "colour";
      blur.closest("label").hidden = bg.value !== "blur";
      bgPick.hidden = bg.value !== "image"; bgName.hidden = bg.value !== "image";
      margin.closest("label").hidden = !crop.input.checked;
      marginLabel.textContent = `${margin.value}%`;
      const transparent = bg.value === "transparent" || (bg.value === "image" && !state.bgImage);
      formatHint.textContent = transparent && format.value === "jpeg" ? t("JPEG has no transparency: the background becomes white") : "";
      brush.closest("label").hidden = mode === "view";
    };
    const paintModes = () => {
      modeBtns.forEach((b, i) => { const on = modes[i][0] === mode; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
      canvas.style.cursor = mode === "view" ? "default" : "crosshair";
      syncControls();
    };

    // preview state for the file shown
    let view = null; // { file, img, maskC, edgeMode, w, h, scale, ms, backend }
    let token = 0;
    const draw = (live) => {
      const e = editsOf(state.file);
      undoBtn.disabled = !e.strokes.length; resetBtn.disabled = !e.strokes.length;
      if (!view || view.file !== state.file) return;
      const o = opts();
      if (original.input.checked) {
        canvas.width = view.pw; canvas.height = view.ph;
        canvas.getContext("2d").drawImage(view.img, 0, 0, view.pw, view.ph);
        return;
      }
      const strokes = live ? [...e.strokes, live] : e.strokes;
      // touching up shows the whole photo (no crop), so strokes land where the pointer is
      const touching = mode !== "view";
      const pic = compose(view.img, view.maskC, strokes, view.pw, view.ph, touching ? { ...o, crop: false, square: false } : o, touching);
      const k = Math.min(1, view.pw / pic.width, view.ph / pic.height, 1);
      canvas.width = Math.max(1, Math.round(pic.width * k)); canvas.height = Math.max(1, Math.round(pic.height * k));
      const g = canvas.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(pic, 0, 0, canvas.width, canvas.height);
      const where = view.backend === "webgpu" ? t("graphics card") : t("processor");
      info.textContent = [
        t("{w} × {h} px", { w: view.w, h: view.h }),
        t("subject found in {s} s on the {where}", { s: (view.ms / 1000).toFixed(1), where }),
        e.strokes.length ? plural(e.strokes.length, "touch-up") : (mode === "view" ? t("pick Restore or Erase to fix the edges by hand") : t("paint over the parts to bring back or remove")),
      ].join(" · ");
    };

    const show = async (i) => {
      if (i < 0 || i >= files.length) return;
      state.file = files[i];
      which.textContent = `${i + 1} / ${files.length} · ${state.file.name}`;
      prevBtn.disabled = i === 0; nextBtn.disabled = i === files.length - 1;
      const my = ++token;
      info.textContent = t("Loading…");
      try {
        const file = state.file;
        // the photo itself shows at once, faded, while the model looks for the subject
        const img = await loadImage(file);
        if (my !== token) { if (img.close) img.close(); return; }
        const d = dims(img);
        const k = Math.min(1, (root.clientWidth > 200 ? Math.min(860, root.clientWidth - 32) : 860) / d.w, 560 / d.h);
        const pw = Math.max(1, Math.round(d.w * k)), ph = Math.max(1, Math.round(d.h * k));
        if (!view || view.file !== file) {
          canvas.width = pw; canvas.height = ph;
          const g = canvas.getContext("2d");
          g.globalAlpha = 0.45; g.drawImage(img, 0, 0, pw, ph);
        }
        const res = await maskFor(file, (s) => { if (my === token) info.textContent = s; });
        if (my !== token) { if (img.close) img.close(); return; }
        if (view?.img?.close) view.img.close();
        view = { file, img, mask: res.mask, maskC: maskCanvas(res.mask, edge.value === "sharp"), edgeMode: edge.value, w: res.w, h: res.h, pw, ph, ms: res.ms, backend: res.backend };
        draw();
      } catch (err) {
        if (my !== token) return;
        info.textContent = err.message || String(err);
        toast(err.message || String(err), "error");
      }
    };

    // brush
    let live = null;
    const at = (e) => { const r = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
    canvas.addEventListener("pointerdown", (e) => {
      if (mode === "view" || !view || original.input.checked) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      live = { mode, r: Number(brush.value) / 200, pts: [at(e)] };
      draw(live);
    });
    canvas.addEventListener("pointermove", (e) => { if (!live) return; live.pts.push(at(e)); draw(live); });
    const end = () => {
      if (!live) return;
      const e = editsOf(state.file);
      e.strokes.push(live); e.redo = []; live = null;
      draw();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    bg.addEventListener("change", () => { syncControls(); if (bg.value === "image" && !state.bgImage) bgFile.click(); draw(); });
    bgFile.addEventListener("change", async () => {
      const f = bgFile.files[0]; bgFile.value = "";
      if (!f) return;
      try {
        state.bgImage?.close?.();
        state.bgImage = await loadImage(f);
        state.bgName = f.name;
        bgName.textContent = f.name;
        syncControls(); draw();
      } catch (err) { toast(err.message, "error"); }
    });
    if (state.bgName) bgName.textContent = state.bgName;
    edge.addEventListener("change", () => { if (view) { view.maskC = maskCanvas(view.mask, edge.value === "sharp"); view.edgeMode = edge.value; } draw(); });
    for (const c of [colour, blur, margin]) c.addEventListener("input", () => { syncControls(); draw(); });
    for (const c of [crop, square, original]) c.input.addEventListener("change", () => { syncControls(); draw(); });
    format.addEventListener("change", syncControls);
    paintModes();
    // remembered options are restored after renderOptions returns: catch up with them on the next frame
    setTimeout(() => { syncControls(); draw(); }, 0);
    show(Math.max(0, files.indexOf(state.file)));
  },

  async run(files, _root, progress) {
    const o = this.opts, out = [];
    const opts = { bg: o.bg.value, colour: o.colour.value, blur: Number(o.blur.value), bgImage: o.bgImage(), crop: o.crop.input.checked, margin: Number(o.margin.value), square: o.square.input.checked };
    if (opts.bg === "image" && !opts.bgImage) throw new Error("Choose the picture for the new background");
    const mime = { png: "image/png", webp: "image/webp", jpeg: "image/jpeg" }[o.format.value];
    const ext = { png: "png", webp: "webp", jpeg: "jpg" }[o.format.value];
    for (const file of files) {
      await progress?.tick(file.name);
      const res = await maskFor(file, (s) => progress?.note(`${file.name} · ${s}`));
      const img = await loadImage(file);
      let { w, h } = dims(img);
      if (w * h > MAX_PIXELS) { const k = Math.sqrt(MAX_PIXELS / (w * h)); w = Math.floor(w * k); h = Math.floor(h * k); }
      const pic = compose(img, maskCanvas(res.mask, o.edge.value === "sharp"), editsOf(file).strokes, w, h, opts);
      if (img.close) img.close();
      const blob = await encode(pic, mime, 0.92);
      const suffix = opts.bg === "transparent" ? "no-bg" : "new-bg";
      out.push({ name: `${baseName(file.name)}-${suffix}.${ext}`, blob, note: `${pic.width} × ${pic.height}` });
    }
    return out;
  },
};

export const rembgTools = [removeBgTool];
