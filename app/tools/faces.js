// Blur faces: a small neural network (YuNet, MIT) finds the faces in a photo, then each one is blurred, pixelated or
// blacked out. Detection runs on this device (ONNX Runtime Web in a worker); the model is 230 KB and loads only when
// this tool is used. The user sees every box before saving: a click turns a found face off, a drag adds a box the
// network missed (a face in profile, a name badge, a number plate).
import { el, field, select, plural, toast, t } from "../util.js";
import { loadImage, makeCanvas, dims, encode, formatQualityRow, formatOf, outName, MIME, applyRedactions } from "./image.js";

const SIZE = 640; // the model's input size

// ---------- the detector, in a worker ----------

let worker = null, seq = 0, idle = 0;
const pending = new Map();

function facesWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../faces-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data || {}, p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.faces); else p.reject(new Error(m.error || "The face model failed"));
  };
  worker.onerror = (e) => { e.preventDefault?.(); stopWorker(new Error("The face model failed to start")); };
  return worker;
}

function stopWorker(err) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(err || new Error("The face model was stopped"));
  pending.clear();
}

function detectTile(rgba, threshold) {
  clearTimeout(idle);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    facesWorker().postMessage({ id, type: "run", rgba: rgba.buffer, threshold }, [rgba.buffer]);
  }).finally(() => {
    clearTimeout(idle);
    idle = setTimeout(() => { if (!pending.size) stopWorker(); }, 120_000);
  });
}

/** One face found twice (whole photo and a tile) at slightly different boxes: the centre of one lies in the other. */
const same = (a, b) => {
  const inside = (p, q) => p.x + p.w / 2 >= q.x && p.x + p.w / 2 <= q.x + q.w && p.y + p.h / 2 >= q.y && p.y + p.h / 2 <= q.y + q.h;
  return inside(a, b) || inside(b, a);
};
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};
/** Overlap of a with b as a share of the smaller box: one face found twice (whole photo and a tile) at two sizes. */
const cover = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return (Math.max(0, x2 - x1) * Math.max(0, y2 - y1)) / Math.min(a.w * a.h, b.w * b.h || 1);
};
function nms(faces) {
  const out = [];
  for (const f of [...faces].sort((a, b) => b.score - a.score)) if (!out.some((g) => iou(f, g) > 0.3 || cover(f, g) > 0.7 || same(f, g))) out.push(f);
  return out;
}

/**
 * Every face in `img`, in image pixels. The whole photo is looked at once (big faces), and a photo larger than the
 * model's input is also looked at in overlapping 640 px tiles of a bigger copy (small faces in a group photo).
 */
async function findFaces(img, threshold, check) {
  const thorough = threshold < 0.55;
  const { w, h } = dims(img);
  const found = [];
  const pass = async (scale, x0, y0, tile) => {
    // A SIZE×SIZE square of the photo scaled by `scale`, starting at (x0, y0) of the scaled photo; grey outside it.
    const c = makeCanvas(SIZE, SIZE), g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#808080"; g.fillRect(0, 0, SIZE, SIZE);
    g.drawImage(img, -x0, -y0, w * scale, h * scale);
    const rgba = new Uint8ClampedArray(g.getImageData(0, 0, SIZE, SIZE).data);
    const faces = await detectTile(rgba, threshold);
    for (const f of faces) {
      // A face cut by a tile's inner edge is only part of a face (a forehead, a chin): the neighbouring tile overlaps
      // by 128 px and sees the small ones whole, and the pass over the whole photo sees the big ones.
      if (tile && ((f.x < 2 && x0 > 0) || (f.y < 2 && y0 > 0) || (f.x + f.w > SIZE - 2 && x0 + SIZE < tile.w) || (f.y + f.h > SIZE - 2 && y0 + SIZE < tile.h))) continue;
      found.push({ x: (f.x + x0) / scale, y: (f.y + y0) / scale, w: f.w / scale, h: f.h / scale, score: f.score });
    }
    await check?.();
  };
  await pass(SIZE / Math.max(w, h), 0, 0);
  const big = Math.max(w, h);
  if (big > SIZE * 1.4) {
    // Normal: a copy up to 1280 px (4–6 tiles, faces from ~2% of the photo's width). High: up to 1920 px (9–12 tiles).
    const scale = Math.min(1, (thorough ? 1920 : 1280) / big), sw = w * scale, sh = h * scale, step = SIZE - 128;
    const tile = { w: sw, h: sh };
    for (let y = 0; y < sh; y += step) {
      for (let x = 0; x < sw; x += step) {
        await pass(scale, Math.min(x, Math.max(0, sw - SIZE)), Math.min(y, Math.max(0, sh - SIZE)), tile);
        if (x + SIZE >= sw) break;
      }
      if (y + SIZE >= sh) break;
    }
  }
  return nms(found).filter((f) => f.w >= 6 && f.h >= 6);
}

/** A face box grown by `pad` (a share of its size) for hair and chin, clipped to the image. */
function grow(f, pad, w, h) {
  const dx = f.w * pad, dy = f.h * pad;
  const x = Math.max(0, f.x - dx), y = Math.max(0, f.y - dy * 1.3);
  return { x, y, w: Math.min(w, f.x + f.w + dx) - x, h: Math.min(h, f.y + f.h + dy) - y };
}

/** Hide every box on canvas `c` (image pixels × k); the blur and pixel size follow the size of each face. */
function paint(c, boxes, mode, strength, k = 1) {
  for (const b of boxes) {
    const box = { x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k };
    const block = Math.max(box.w, box.h) / ({ light: 12, medium: 8, strong: 5 }[strength] || 8);
    applyRedactions(c, [box], mode, (block / c.width) * 100);
  }
}

const facesTool = {
  id: "blur-faces",
  title: "Blur faces",
  description: "Find the faces in a photo automatically and blur, pixelate or black them out before you post it. Turn off any face you want to keep, or draw a box over a missed face or a number plate.",
  keywords: ["blur faces", "anonymize", "anonymise", "hide faces", "face blur", "censor", "privacy", "pixelate faces", "number plate", "розмити обличчя", "приховати обличчя", "анонімізувати", "заблюрити", "размыть лицо", "скрыть лица"],
  accept: "image/*",
  hint: "Photos: JPG, PNG, WebP, HEIC. Group photos work too",
  runLabel: "Hide faces & download",
  renderOptions(root, files) {
    const st = { i: 0, img: null, w: 0, h: 0, scale: 1, per: new Map() }; // per: File → { faces, off: Set, extra: [] }
    this.state = st;
    const mode = select([["blur", "Blur"], ["pixelate", "Pixelate"], ["black", "Solid black"]], "blur");
    const strength = select([["light", "Light"], ["medium", "Medium"], ["strong", "Strong"]], "strong");
    const sens = select([["0.6", "Normal"], ["0.45", "High: more faces, more false finds"]], "0.6");
    const pad = select([["0.15", "Face only"], ["0.35", "Face and hair"]], "0.35");
    const canvas = el("canvas");
    const stage = el("div", { class: "crop-stage" }, [canvas]);
    const info = el("div", { class: "stat", text: "Looking for faces…" });
    const prev = el("button", { type: "button", text: "‹ Previous", onclick: () => show(st.i - 1) });
    const next = el("button", { type: "button", text: "Next ›", onclick: () => show(st.i + 1) });
    const nav = el("div", { class: "actions", hidden: files.length < 2 }, [prev, next]);
    const fq = formatQualityRow();
    this.fq = fq; this.opts = { mode, strength, sens, pad };
    root.append(
      el("div", { class: "row" }, [
        field("Style", mode, "Blur and pixelation look natural; solid black is the only one nobody can try to undo."),
        field("Strength", strength),
        field("Find faces", sens),
        field("Area", pad),
      ]),
      el("div", { class: "row" }, [
        el("div", { class: "actions" }, [
          el("button", { type: "button", text: "Undo last box", onclick: () => { const p = st.per.get(files[st.i]); if (p?.extra.length) { p.extra.pop(); draw(); } } }),
          el("button", { type: "button", text: "Turn all faces on", onclick: () => { const p = st.per.get(files[st.i]); if (p) { p.off.clear(); draw(); } } }),
        ]),
        nav,
      ]),
      stage, info, fq.row,
    );
    const boxesOf = (p, w, h) => [
      ...p.faces.map((f, n) => ({ ...grow(f, Number(pad.value), w, h), n, on: !p.off.has(n) })),
      ...p.extra.map((b) => ({ ...b, on: true, manual: true })),
    ];
    const draw = (live) => {
      const p = st.per.get(files[st.i]);
      if (!st.img) return;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
      if (!p) return;
      const all = boxesOf(p, st.w, st.h);
      paint(canvas, [...all.filter((b) => b.on), ...(live ? [live] : [])], mode.value, strength.value, st.scale);
      const k = st.scale;
      ctx.lineWidth = 2;
      for (const b of [...all, ...(live ? [live] : [])]) {
        ctx.setLineDash(b.on === false ? [6, 4] : []);
        ctx.strokeStyle = b.on === false ? "#9ba3b3" : "#ff8c28";
        ctx.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
      }
      ctx.setLineDash([]);
      const on = all.filter((b) => b.on).length;
      const where = files.length > 1 ? `${st.i + 1} / ${files.length} · ` : "";
      info.textContent = where + (p.faces.length || p.extra.length
        ? t("{found} found, {hidden} hidden · click a box to keep that face, drag to hide more", { found: plural(p.faces.length, "face"), hidden: on })
        : t("No faces found · drag over anything you want to hide"));
    };
    const detect = async (file) => {
      if (st.per.has(file)) return st.per.get(file);
      const img = await loadImage(file);
      try {
        const faces = await findFaces(img, Number(sens.value));
        const p = { faces, off: new Set(), extra: [] };
        st.per.set(file, p);
        return p;
      } finally { if (img.close) img.close(); }
    };
    let warm = false; // the detector's engine loads once (the first photo takes a few seconds longer)
    const show = async (i) => {
      st.i = Math.max(0, Math.min(files.length - 1, i));
      prev.disabled = st.i === 0; next.disabled = st.i === files.length - 1;
      info.textContent = t(warm ? "Looking for faces…" : "Loading the face detector (once), then looking for faces…");
      const file = files[st.i];
      const img = await loadImage(file);
      if (st.img?.close) st.img.close();
      st.img = img;
      const d = dims(img); st.w = d.w; st.h = d.h;
      const maxW = Math.min(860, root.clientWidth - 32 || 860);
      st.scale = Math.min(1, maxW / d.w, 560 / d.h);
      canvas.width = Math.round(d.w * st.scale); canvas.height = Math.round(d.h * st.scale);
      draw();
      await detect(file);
      warm = true;
      if (files[st.i] === file) draw();
    };
    this.detect = detect;
    this.boxesOf = boxesOf;
    mode.addEventListener("change", () => draw());
    strength.addEventListener("change", () => draw());
    pad.addEventListener("change", () => draw());
    sens.addEventListener("change", () => { st.per.clear(); show(st.i).catch((err) => toast(err.message, "error")); });
    show(0).catch((err) => { info.textContent = ""; toast(err.message, "error"); });

    let start = null;
    const toSrc = (e) => { const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width / st.scale; return { x: Math.max(0, Math.min(st.w, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(st.h, (e.clientY - r.top) * k)) }; };
    const boxFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    canvas.addEventListener("pointerdown", (e) => { if (!st.img) return; canvas.setPointerCapture(e.pointerId); start = toSrc(e); });
    canvas.addEventListener("pointermove", (e) => { if (start) draw({ ...boxFrom(start, toSrc(e)), on: true }); });
    canvas.addEventListener("pointerup", (e) => {
      if (!start) return;
      const p = st.per.get(files[st.i]);
      const b = boxFrom(start, toSrc(e)); start = null;
      if (!p) return;
      if (b.w < 4 || b.h < 4) {
        // A click: a drawn box is removed, a found face is switched off or back on.
        const at = toSrc(e), inside = (x) => at.x >= x.x && at.x <= x.x + x.w && at.y >= x.y && at.y <= x.y + x.h;
        const all = boxesOf(p, st.w, st.h);
        const hit = all.findLast(inside);
        if (hit?.manual) p.extra.splice(p.extra.findIndex((x) => x.x === hit.x && x.y === hit.y), 1);
        else if (hit) { if (p.off.has(hit.n)) p.off.delete(hit.n); else p.off.add(hit.n); }
      } else p.extra.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
      draw();
    });
    canvas.addEventListener("pointercancel", () => { start = null; draw(); });
  },
  async run(files, _root, progress) {
    const o = this.opts, out = [];
    let total = 0;
    progress?.start?.(files.length);
    for (const file of files) {
      await progress?.tick(file.name);
      const p = await this.detect(file);
      const img = await loadImage(file);
      const d = dims(img);
      const boxes = this.boxesOf(p, d.w, d.h).filter((b) => b.on);
      const c = makeCanvas(d.w, d.h);
      c.getContext("2d").drawImage(img, 0, 0);
      if (img.close) img.close();
      paint(c, boxes, o.mode.value, o.strength.value);
      total += boxes.length;
      const mime = this.fq.format === "keep" ? (formatOf(file) || "image/jpeg") : MIME[this.fq.format];
      // Re-encoding through a canvas also drops the EXIF block (GPS, camera), which suits a photo meant to be posted.
      const blob = await encode(c, mime, this.fq.quality / 100);
      out.push({ name: outName(file, mime, "blurred"), blob, note: boxes.length ? t("{areas} hidden", { areas: plural(boxes.length, "area") }) : t("No faces found") });
    }
    if (!total) toast("No faces were found or chosen: the photos were saved unchanged apart from the format", "error");
    return out;
  },
};

export const faceTools = [facesTool];
