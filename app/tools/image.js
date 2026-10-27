import { el, baseName, field, select, number, checkbox, formatBytes, toast } from "../util.js";

// ---------- image engine ----------

async function loadImage(file) {
  try {
    return await createImageBitmap(file);
  } catch (_) {
    // Fallback (e.g. SVG): decode through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(`Cannot decode ${file.name}`)); img.src = url; });
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function dims(src) {
  return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
}

function cropStage(src, crop) {
  const c = makeCanvas(crop.w, crop.h);
  c.getContext("2d").drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  return c;
}

function transformStage(src, rotate = 0, flipH = false, flipV = false) {
  if (!rotate && !flipH && !flipV) return src;
  const { w, h } = dims(src);
  const swap = rotate % 180 !== 0;
  const c = makeCanvas(swap ? h : w, swap ? w : h);
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(src, -w / 2, -h / 2);
  return c;
}

function resizeStage(src, targetW, targetH) {
  let { w, h } = dims(src);
  if (Math.round(targetW) === w && Math.round(targetH) === h) return src;
  let cur = src;
  // Progressive halving gives much better quality on big downscales.
  while (w / 2 >= targetW && h / 2 >= targetH) {
    const c = makeCanvas(w / 2, h / 2);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; w = c.width; h = c.height;
  }
  const c = makeCanvas(targetW, targetH);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, c.width, c.height);
  return c;
}

/** Draw text onto a copy of the image. wm: {text, position, sizePct, opacity, color} */
function watermarkStage(src, wm) {
  const { w, h } = dims(src);
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const size = Math.max(10, Math.round((w * (wm.sizePct || 5)) / 100));
  ctx.font = `bold ${size}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.globalAlpha = wm.opacity ?? 0.5;
  ctx.fillStyle = wm.color || "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = size / 8;
  const pad = Math.round(size * 0.6);
  if (wm.position === "tile") {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.translate(w / 2, h / 2); ctx.rotate(-Math.PI / 6);
    const step = size * 4, tw = ctx.measureText(wm.text).width + size * 2;
    for (let yy = -h; yy < h; yy += step) for (let xx = -w - tw; xx < w + tw; xx += tw) ctx.fillText(wm.text, xx, yy);
    return c;
  }
  const [vert, horiz] = (wm.position || "bottom-right").split("-");
  ctx.textBaseline = vert === "top" ? "top" : vert === "middle" ? "middle" : "bottom";
  ctx.textAlign = horiz === "left" ? "left" : horiz === "center" ? "center" : "right";
  const x = horiz === "left" ? pad : horiz === "center" ? w / 2 : w - pad;
  const y = vert === "top" ? pad : vert === "middle" ? h / 2 : h - pad;
  ctx.fillText(wm.text, x, y);
  return c;
}

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function formatOf(file) {
  if (file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/png") return file.type;
  return null; // gif, bmp, svg, avif… are re-encoded as PNG when "keep" is chosen
}

async function encode(canvas, mime, quality) {
  let source = canvas;
  if (mime === "image/jpeg") {
    // JPEG has no alpha: flatten onto white so transparent areas don't turn black.
    const c = makeCanvas(canvas.width, canvas.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
    source = c;
  } else if (!(source instanceof HTMLCanvasElement)) {
    const c = makeCanvas(dims(source).w, dims(source).h);
    c.getContext("2d").drawImage(source, 0, 0);
    source = c;
  }
  const blob = await new Promise((res) => source.toBlob(res, mime, mime === "image/png" ? undefined : quality));
  if (!blob) throw new Error("Encoding failed");
  return blob;
}

/** Run the full pipeline on one file. ops: {crop, rotate, flipH, flipV, width, height, format, quality} */
export async function processImage(file, ops) {
  const img = await loadImage(file);
  let cur = img;
  if (ops.crop) cur = cropStage(cur, ops.crop);
  cur = transformStage(cur, ops.rotate || 0, ops.flipH, ops.flipV);
  if (ops.width && ops.height) cur = resizeStage(cur, ops.width, ops.height);
  if (ops.watermark) cur = watermarkStage(cur, ops.watermark);
  const mime = ops.format === "keep" || !ops.format ? (formatOf(file) || "image/png") : MIME[ops.format];
  const out = dims(cur);
  const blob = await encode(cur, mime, (ops.quality ?? 90) / 100);
  if (img.close) img.close();
  return { blob, mime, width: out.w, height: out.h };
}

function outName(file, mime, suffix) {
  return `${baseName(file.name)}${suffix ? "-" + suffix : ""}.${EXT[mime]}`;
}

async function sizeOf(file) {
  const img = await loadImage(file);
  const d = dims(img);
  if (img.close) img.close();
  return d;
}

// ---------- shared option widgets ----------

function formatQualityRow(defaultFormat = "keep") {
  const format = select([["keep", "Same as input"], ["jpeg", "JPEG"], ["png", "PNG"], ["webp", "WebP"]], defaultFormat);
  const quality = el("input", { type: "range", min: 10, max: 100, value: 90 });
  const qLabel = el("span", { class: "stat", text: "90" });
  quality.addEventListener("input", () => { qLabel.textContent = quality.value; });
  const row = el("div", { class: "row" }, [
    field("Output format", format),
    field("Quality (JPEG/WebP)", el("div", { class: "row" }, [quality, qLabel])),
  ]);
  return { row, get format() { return format.value; }, get quality() { return Number(quality.value); } };
}

async function previewOf(file, maxW = 360) {
  const img = await loadImage(file);
  const d = dims(img);
  const scale = Math.min(1, maxW / d.w, 240 / d.h);
  const c = makeCanvas(d.w * scale, d.h * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  c.className = "preview";
  return { canvas: c, ...d };
}

// ---------- crop ----------

const cropTool = {
  id: "crop",
  title: "Crop image",
  description: "Drag a rectangle over the image, or type exact pixel values. Supports aspect ratio presets.",
  accept: "image/*",
  multiple: false,
  hint: "JPG, PNG, WebP, GIF, BMP, SVG — one image at a time",
  runLabel: "Crop & download",
  state: null,
  renderOptions(root, files) {
    const file = files[0];
    const st = { sel: null, scale: 1, img: null, w: 0, h: 0 };
    this.state = st;
    const canvas = el("canvas");
    const stage = el("div", { class: "crop-stage" }, [canvas]);
    const aspect = select([["free", "Free"], ["1", "1:1 square"], [String(4 / 3), "4:3"], [String(3 / 2), "3:2"], [String(16 / 9), "16:9"], [String(9 / 16), "9:16 portrait"]], "free");
    const inX = number(0, { min: 0 }), inY = number(0, { min: 0 }), inW = number(0, { min: 1 }), inH = number(0, { min: 1 });
    const fq = formatQualityRow();
    const info = el("div", { class: "stat" });
    root.append(
      el("div", { class: "row" }, [field("Aspect ratio", aspect), field("X", inX), field("Y", inY), field("Width", inW), field("Height", inH)]),
      stage, info, fq.row,
    );
    this.fq = fq;

    const syncInputs = () => {
      const s = st.sel;
      inX.value = s ? Math.round(s.x) : 0; inY.value = s ? Math.round(s.y) : 0;
      inW.value = s ? Math.round(s.w) : 0; inH.value = s ? Math.round(s.h) : 0;
      info.textContent = s ? `Selection ${Math.round(s.w)} × ${Math.round(s.h)} px of ${st.w} × ${st.h}` : `Image ${st.w} × ${st.h} px — drag to select`;
    };
    const clampSel = () => {
      const s = st.sel; if (!s) return;
      s.w = Math.max(1, Math.min(s.w, st.w)); s.h = Math.max(1, Math.min(s.h, st.h));
      s.x = Math.max(0, Math.min(s.x, st.w - s.w)); s.y = Math.max(0, Math.min(s.y, st.h - s.h));
    };
    const draw = () => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
      const s = st.sel;
      if (!s) return;
      const k = st.scale;
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.beginPath();
      ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.rect(s.x * k, s.y * k, s.w * k, s.h * k);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#ff8c28"; ctx.lineWidth = 2;
      ctx.strokeRect(s.x * k, s.y * k, s.w * k, s.h * k);
      ctx.fillStyle = "#ff8c28";
      for (const [hx, hy] of handles(s)) ctx.fillRect(hx * k - 5, hy * k - 5, 10, 10);
    };
    const handles = (s) => [[s.x, s.y], [s.x + s.w, s.y], [s.x, s.y + s.h], [s.x + s.w, s.y + s.h]];
    const applyAspect = (s, anchorRight, anchorBottom) => {
      const r = aspect.value === "free" ? 0 : Number(aspect.value);
      if (!r) return;
      const w = s.w, h = s.h;
      if (w / h > r) { const nw = h * r; if (anchorRight) s.x += w - nw; s.w = nw; }
      else { const nh = w / r; if (anchorBottom) s.y += h - nh; s.h = nh; }
    };

    (async () => {
      st.img = await loadImage(file);
      const d = dims(st.img); st.w = d.w; st.h = d.h;
      const maxW = Math.min(860, root.clientWidth - 32 || 860);
      st.scale = Math.min(1, maxW / d.w, 540 / d.h);
      canvas.width = Math.round(d.w * st.scale); canvas.height = Math.round(d.h * st.scale);
      inX.max = d.w; inY.max = d.h; inW.max = d.w; inH.max = d.h;
      st.sel = { x: Math.round(d.w * 0.1), y: Math.round(d.h * 0.1), w: Math.round(d.w * 0.8), h: Math.round(d.h * 0.8) };
      applyAspect(st.sel);
      syncInputs(); draw();
    })().catch((err) => toast(err.message, "error"));

    let mode = null, start = null, orig = null, corner = null;
    const toSrc = (e) => {
      const r = canvas.getBoundingClientRect();
      const k = canvas.width / r.width / st.scale;
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (!st.img) return;
      canvas.setPointerCapture(e.pointerId);
      const p = toSrc(e);
      const tol = 12 / st.scale;
      start = p;
      if (st.sel) {
        const hs = handles(st.sel);
        corner = hs.findIndex(([hx, hy]) => Math.abs(hx - p.x) < tol && Math.abs(hy - p.y) < tol);
        if (corner >= 0) { mode = "resize"; orig = { ...st.sel }; return; }
        const s = st.sel;
        if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) { mode = "move"; orig = { ...s }; return; }
      }
      mode = "create";
      st.sel = { x: p.x, y: p.y, w: 1, h: 1 };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!mode) return;
      const p = toSrc(e);
      const s = st.sel;
      if (mode === "move") {
        s.x = orig.x + (p.x - start.x); s.y = orig.y + (p.y - start.y);
      } else if (mode === "create") {
        const x0 = Math.min(start.x, p.x), y0 = Math.min(start.y, p.y);
        s.x = x0; s.y = y0; s.w = Math.max(1, Math.abs(p.x - start.x)); s.h = Math.max(1, Math.abs(p.y - start.y));
        applyAspect(s, p.x < start.x, p.y < start.y);
      } else if (mode === "resize") {
        const right = orig.x + orig.w, bottom = orig.y + orig.h;
        const movesLeft = corner === 0 || corner === 2, movesTop = corner === 0 || corner === 1;
        const nx = movesLeft ? Math.min(p.x, right - 1) : orig.x;
        const ny = movesTop ? Math.min(p.y, bottom - 1) : orig.y;
        s.x = nx; s.y = ny;
        s.w = movesLeft ? right - nx : Math.max(1, p.x - orig.x);
        s.h = movesTop ? bottom - ny : Math.max(1, p.y - orig.y);
        applyAspect(s, movesLeft, movesTop);
      }
      clampSel(); syncInputs(); draw();
    });
    const end = () => { mode = null; if (st.sel) { st.sel.x = Math.round(st.sel.x); st.sel.y = Math.round(st.sel.y); st.sel.w = Math.round(st.sel.w); st.sel.h = Math.round(st.sel.h); clampSel(); syncInputs(); draw(); } };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    for (const [input, key] of [[inX, "x"], [inY, "y"], [inW, "w"], [inH, "h"]]) {
      input.addEventListener("change", () => {
        if (!st.sel) return;
        st.sel[key] = Number(input.value) || (key === "w" || key === "h" ? 1 : 0);
        clampSel(); syncInputs(); draw();
      });
    }
    aspect.addEventListener("change", () => { if (st.sel) { applyAspect(st.sel); clampSel(); syncInputs(); draw(); } });
  },
  async run(files) {
    const st = this.state;
    if (!st?.sel) throw new Error("Select an area first");
    const r = await processImage(files[0], { crop: st.sel, format: this.fq.format, quality: this.fq.quality });
    return [{ name: outName(files[0], r.mime, "cropped"), blob: r.blob, note: `${r.width} × ${r.height}` }];
  },
};

// ---------- resize ----------

const resizeTool = {
  id: "resize",
  title: "Resize image",
  description: "Scale images to exact pixel dimensions or by percentage. Works on many files at once.",
  accept: "image/*",
  hint: "JPG, PNG, WebP, GIF, BMP, SVG — multiple files allowed",
  runLabel: "Resize",
  renderOptions(root, files) {
    const mode = select([["pixels", "By pixels"], ["percent", "By percentage"]], "pixels");
    const width = number("", { min: 1, placeholder: "auto" }), height = number("", { min: 1, placeholder: "auto" });
    const percent = number(50, { min: 1, max: 1000 });
    const lock = checkbox("Keep aspect ratio", true);
    const noEnlarge = checkbox("Don't enlarge smaller images", true);
    const fq = formatQualityRow();
    const pixelsRow = el("div", { class: "row" }, [field("Width (px)", width), field("Height (px)", height), lock.label]);
    const percentRow = el("div", { class: "row", hidden: true }, [field("Scale (%)", percent)]);
    mode.addEventListener("change", () => { pixelsRow.hidden = mode.value !== "pixels"; percentRow.hidden = mode.value !== "percent"; });
    const info = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [field("Mode", mode)]), pixelsRow, percentRow, noEnlarge.label, info, fq.row);
    sizeOf(files[0]).then((d) => { info.textContent = `${files[0].name}: ${d.w} × ${d.h} px${files.length > 1 ? ` (+${files.length - 1} more)` : ""}`; }).catch(() => {});
    this.opts = { mode, width, height, percent, lock, noEnlarge, fq };
  },
  async run(files) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      const d = await sizeOf(file);
      let w, h;
      if (o.mode.value === "percent") {
        const k = Number(o.percent.value) / 100;
        if (!(k > 0)) throw new Error("Enter a percentage above 0");
        w = d.w * k; h = d.h * k;
      } else {
        const tw = Number(o.width.value) || 0, th = Number(o.height.value) || 0;
        if (!tw && !th) throw new Error("Enter a width or a height");
        if (o.lock.input.checked || !tw || !th) {
          const k = tw && th ? Math.min(tw / d.w, th / d.h) : tw ? tw / d.w : th / d.h;
          w = d.w * k; h = d.h * k;
        } else { w = tw; h = th; }
      }
      if (o.noEnlarge.input.checked && (w > d.w || h > d.h)) { w = d.w; h = d.h; }
      const r = await processImage(file, { width: Math.round(w), height: Math.round(h), format: o.fq.format, quality: o.fq.quality });
      out.push({ name: outName(file, r.mime, `${r.width}x${r.height}`), blob: r.blob, note: `${r.width} × ${r.height}` });
    }
    return out;
  },
};

// ---------- rotate & flip ----------

const rotateTool = {
  id: "rotate",
  title: "Rotate & flip",
  description: "Rotate by 90°, 180° or 270° and mirror horizontally or vertically. Applies to every file you add.",
  accept: "image/*",
  hint: "JPG, PNG, WebP, GIF, BMP, SVG — multiple files allowed",
  runLabel: "Apply",
  renderOptions(root, files) {
    const st = { rotate: 0, flipH: false, flipV: false };
    this.opts = st;
    const fq = formatQualityRow();
    this.fq = fq;
    const wrap = el("div", { class: "preview-wrap" });
    const status = el("div", { class: "stat" });
    let base = null;
    const redraw = () => {
      if (!base) return;
      const c = transformStage(base.canvas, st.rotate, st.flipH, st.flipV);
      c.className = "preview";
      wrap.replaceChildren(c, status);
      status.textContent = `Rotation ${st.rotate}°${st.flipH ? ", flipped horizontally" : ""}${st.flipV ? ", flipped vertically" : ""}`;
    };
    const btn = (label, fn) => el("button", { type: "button", text: label, onclick: () => { fn(); redraw(); } });
    root.append(
      el("div", { class: "actions" }, [
        btn("↻ Rotate 90° right", () => { st.rotate = (st.rotate + 90) % 360; }),
        btn("↺ Rotate 90° left", () => { st.rotate = (st.rotate + 270) % 360; }),
        btn("Rotate 180°", () => { st.rotate = (st.rotate + 180) % 360; }),
        btn("⇔ Flip horizontal", () => { st.flipH = !st.flipH; }),
        btn("⇕ Flip vertical", () => { st.flipV = !st.flipV; }),
        btn("Reset", () => { st.rotate = 0; st.flipH = false; st.flipV = false; }),
      ]),
      wrap, fq.row,
    );
    previewOf(files[0]).then((p) => { base = p; redraw(); }).catch((err) => toast(err.message, "error"));
  },
  async run(files) {
    const st = this.opts;
    if (!st.rotate && !st.flipH && !st.flipV) throw new Error("Choose a rotation or flip first");
    const out = [];
    for (const file of files) {
      const r = await processImage(file, { rotate: st.rotate, flipH: st.flipH, flipV: st.flipV, format: this.fq.format, quality: this.fq.quality });
      out.push({ name: outName(file, r.mime, "rotated"), blob: r.blob, note: `${r.width} × ${r.height}` });
    }
    return out;
  },
};

// ---------- compress ----------

const compressTool = {
  id: "compress",
  title: "Compress image",
  description: "Shrink file size with a quality slider and an optional maximum dimension. PNG is converted to WebP by default because PNG has no lossy mode.",
  accept: "image/*",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Compress",
  renderOptions(root, files) {
    const quality = el("input", { type: "range", min: 10, max: 100, value: 75 });
    const qLabel = el("span", { class: "stat", text: "75" });
    quality.addEventListener("input", () => { qLabel.textContent = quality.value; });
    const maxDim = number("", { min: 1, placeholder: "no limit" });
    const format = select([["auto", "Auto (JPEG→JPEG, WebP→WebP, PNG→WebP)"], ["jpeg", "JPEG"], ["webp", "WebP"], ["png", "PNG (lossless, only resizes)"]], "auto");
    root.append(
      el("div", { class: "row" }, [
        field("Quality", el("div", { class: "row" }, [quality, qLabel]), "75 is a good balance; 60 is noticeably smaller"),
        field("Max width/height (px)", maxDim, "Longest side is limited to this"),
        field("Output format", format),
      ]),
      el("div", { class: "stat", text: `${files.length} file${files.length === 1 ? "" : "s"}, ${formatBytes(files.reduce((s, f) => s + f.size, 0))} total` }),
    );
    this.opts = { quality, maxDim, format };
  },
  async run(files) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      let fmt = o.format.value;
      if (fmt === "auto") fmt = file.type === "image/jpeg" ? "jpeg" : file.type === "image/webp" ? "webp" : "webp";
      const d = await sizeOf(file);
      const limit = Number(o.maxDim.value) || 0;
      let w = d.w, h = d.h;
      if (limit && Math.max(w, h) > limit) { const k = limit / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const r = await processImage(file, { width: w, height: h, format: fmt, quality: Number(o.quality.value) });
      const saved = 1 - r.blob.size / file.size;
      out.push({
        name: outName(file, r.mime, "compressed"), blob: r.blob,
        note: saved > 0 ? `−${Math.round(saved * 100)}% (was ${formatBytes(file.size)})` : `no gain (was ${formatBytes(file.size)})`,
      });
    }
    return out;
  },
};

// ---------- convert ----------

const convertTool = {
  id: "convert",
  title: "Convert image",
  description: "Convert between JPEG, PNG and WebP. GIF, BMP, SVG and AVIF can be used as input.",
  accept: "image/*",
  hint: "Any browser-readable image — multiple files allowed",
  runLabel: "Convert",
  renderOptions(root) {
    const fq = formatQualityRow("webp");
    root.append(fq.row);
    this.fq = fq;
  },
  async run(files) {
    if (this.fq.format === "keep") throw new Error("Choose a target format");
    const out = [];
    for (const file of files) {
      const r = await processImage(file, { format: this.fq.format, quality: this.fq.quality });
      out.push({ name: outName(file, r.mime, ""), blob: r.blob, note: `${r.width} × ${r.height}` });
    }
    return out;
  },
};

// ---------- watermark ----------

const watermarkTool = {
  id: "watermark",
  title: "Watermark image",
  description: "Stamp text onto one or many images: a corner, the centre, or a repeated diagonal tile.",
  accept: "image/*",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Add watermark",
  renderOptions(root, files) {
    const text = el("input", { type: "text", value: this.last?.text || "© FileForge", placeholder: "Your text" });
    const position = select([["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["bottom-center", "Bottom centre"], ["top-right", "Top right"], ["top-left", "Top left"], ["middle-center", "Centre"], ["tile", "Tiled diagonal"]], this.last?.position || "bottom-right");
    const sizePct = number(this.last?.sizePct || 5, { min: 1, max: 50 });
    const opacity = el("input", { type: "range", min: 5, max: 100, value: Math.round((this.last?.opacity || 0.5) * 100) });
    const oLabel = el("span", { class: "stat", text: `${opacity.value}%` });
    opacity.addEventListener("input", () => { oLabel.textContent = `${opacity.value}%`; });
    const color = el("input", { type: "color", value: this.last?.color || "#ffffff" });
    const fq = formatQualityRow();
    const wrap = el("div", { class: "preview-wrap" });
    let base = null;
    const opts = () => ({ text: text.value, position: position.value, sizePct: Number(sizePct.value), opacity: Number(opacity.value) / 100, color: color.value });
    const redraw = () => {
      if (!base) return;
      this.last = opts();
      const c = watermarkStage(base.canvas, this.last);
      c.className = "preview";
      wrap.replaceChildren(c);
    };
    for (const i of [text, position, sizePct, opacity, color]) i.addEventListener("input", redraw);
    root.append(
      el("div", { class: "row" }, [field("Text", text), field("Position", position), field("Size (% of width)", sizePct), field("Opacity", el("div", { class: "row" }, [opacity, oLabel])), field("Colour", color)]),
      wrap, fq.row,
    );
    previewOf(files[0], 420).then((p) => { base = p; redraw(); }).catch((err) => toast(err.message, "error"));
    this.opts = opts; this.fq = fq;
  },
  async run(files) {
    const wm = this.opts();
    if (!wm.text.trim()) throw new Error("Enter the watermark text");
    const out = [];
    for (const file of files) {
      const r = await processImage(file, { watermark: wm, format: this.fq.format, quality: this.fq.quality });
      out.push({ name: outName(file, r.mime, "watermarked"), blob: r.blob, note: `${r.width} × ${r.height}` });
    }
    return out;
  },
};

// ---------- favicons / app icons ----------

function buildIco(pngs) {
  // ICO container with PNG-compressed entries (supported by every modern browser and Windows Vista+).
  const header = new Uint8Array(6 + 16 * pngs.length);
  const dv = new DataView(header.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, pngs.length, true);
  let offset = header.length;
  const parts = [header];
  pngs.forEach((p, i) => {
    const o = 6 + i * 16;
    header[o] = p.size >= 256 ? 0 : p.size; header[o + 1] = p.size >= 256 ? 0 : p.size;
    dv.setUint16(o + 4, 1, true); dv.setUint16(o + 6, 32, true);
    dv.setUint32(o + 8, p.bytes.length, true); dv.setUint32(o + 12, offset, true);
    offset += p.bytes.length;
    parts.push(p.bytes);
  });
  return new Blob(parts, { type: "image/x-icon" });
}

const faviconTool = {
  id: "favicons",
  title: "Favicon & app icons",
  description: "Turn one square-ish image into the full icon set: favicon.ico, PNGs for browsers, Apple touch icon and PWA icons, plus a ready-made HTML snippet.",
  accept: "image/*",
  multiple: false,
  hint: "One image, ideally square and at least 512 × 512",
  runLabel: "Generate icons",
  renderOptions(root, files) {
    const sizes = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512];
    const boxes = sizes.map((s) => checkbox(`${s}`, true));
    const ico = checkbox("favicon.ico (16 + 32 + 48)", true);
    const pad = checkbox("Pad non-square images to a square (transparent)", true);
    const info = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [el("span", { class: "field-label", text: "PNG sizes" }), ...boxes.map((b) => b.label)]), el("div", { class: "row" }, [ico.label, pad.label]), info);
    sizeOf(files[0]).then((d) => { info.textContent = `${files[0].name}: ${d.w} × ${d.h} px${d.w !== d.h ? " (not square)" : ""}`; }).catch(() => {});
    this.opts = { sizes, boxes, ico, pad };
  },
  async run(files) {
    const o = this.opts;
    const img = await loadImage(files[0]);
    const d = dims(img);
    let square = img;
    if (d.w !== d.h && o.pad.input.checked) {
      const s = Math.max(d.w, d.h);
      const c = makeCanvas(s, s);
      c.getContext("2d").drawImage(img, (s - d.w) / 2, (s - d.h) / 2);
      square = c;
    } else if (d.w !== d.h) {
      const s = Math.min(d.w, d.h);
      square = cropStage(img, { x: (d.w - s) / 2, y: (d.h - s) / 2, w: s, h: s });
    }
    const chosen = o.sizes.filter((_, i) => o.boxes[i].input.checked);
    if (!chosen.length && !o.ico.input.checked) throw new Error("Pick at least one size");
    const out = [];
    const pngAt = async (s) => encode(resizeStage(square, s, s), "image/png");
    const byName = (s) => s === 180 ? "apple-touch-icon.png" : s === 192 ? "android-chrome-192x192.png" : s === 512 ? "android-chrome-512x512.png" : `favicon-${s}x${s}.png`;
    for (const s of chosen) out.push({ name: byName(s), blob: await pngAt(s), note: `${s} × ${s}` });
    if (o.ico.input.checked) {
      const entries = [];
      for (const s of [16, 32, 48]) entries.push({ size: s, bytes: new Uint8Array(await (await pngAt(s)).arrayBuffer()) });
      out.push({ name: "favicon.ico", blob: buildIco(entries), note: "16 + 32 + 48" });
    }
    const snippet = [
      o.ico.input.checked ? '<link rel="icon" href="/favicon.ico" sizes="any">' : null,
      chosen.includes(32) ? '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">' : null,
      chosen.includes(16) ? '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">' : null,
      chosen.includes(180) ? '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">' : null,
      chosen.includes(192) || chosen.includes(512) ? '<link rel="manifest" href="/site.webmanifest">' : null,
    ].filter(Boolean).join("\n");
    out.push({ name: "favicon-snippet.html", blob: new Blob([snippet + "\n"], { type: "text/html" }), note: "paste into <head>" });
    if (chosen.includes(192) || chosen.includes(512)) {
      const manifest = { name: "", short_name: "", icons: [192, 512].filter((s) => chosen.includes(s)).map((s) => ({ src: `/android-chrome-${s}x${s}.png`, sizes: `${s}x${s}`, type: "image/png" })), theme_color: "#ffffff", background_color: "#ffffff", display: "standalone" };
      out.push({ name: "site.webmanifest", blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/manifest+json" }), note: "PWA manifest" });
    }
    if (img.close) img.close();
    return out;
  },
};

// ---------- HEIC ----------
// heic2any (libheif) needs eval, which extension pages forbid, so it runs inside a sandboxed iframe.

let heicFrame = null;
let heicSeq = 0;
const heicPending = new Map();

function heicSandbox() {
  if (heicFrame) return heicFrame.ready;
  const frame = el("iframe", { src: "heic-sandbox.html", hidden: true, title: "HEIC decoder" });
  frame.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("HEIC decoder did not start. In the Firefox extension HEIC is unavailable; use the web version instead.")), 15000);
    window.addEventListener("message", (e) => {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === "heic-ready") { clearTimeout(timer); resolve(frame); return; }
      const p = heicPending.get(e.data.id);
      if (!p) return;
      heicPending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.buffers);
    });
  });
  document.body.append(frame);
  heicFrame = frame;
  return frame.ready;
}

async function decodeHeic(file, toType, quality) {
  const frame = await heicSandbox();
  const id = ++heicSeq;
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    heicPending.set(id, { resolve, reject });
    frame.contentWindow.postMessage({ id, buffer, toType, quality }, "*", [buffer]);
  });
}

const heicTool = {
  id: "heic",
  title: "HEIC to JPG",
  description: "Convert iPhone HEIC/HEIF photos to JPEG, PNG or WebP. Multi-image HEIC files produce one output per frame.",
  accept: ".heic,.heif,image/heic,image/heif",
  hint: "HEIC or HEIF files from an iPhone or iPad — multiple files allowed",
  runLabel: "Convert",
  renderOptions(root) {
    const fq = formatQualityRow("jpeg");
    root.append(fq.row);
    this.fq = fq;
    heicSandbox().catch(() => {});
  },
  async run(files) {
    const fmt = this.fq.format === "keep" ? "jpeg" : this.fq.format;
    const mime = MIME[fmt];
    const out = [];
    for (const file of files) {
      const buffers = await decodeHeic(file, mime, this.fq.quality / 100);
      buffers.forEach((buf, i) => {
        const blob = new Blob([buf], { type: mime });
        out.push({ name: `${baseName(file.name)}${buffers.length > 1 ? `-${i + 1}` : ""}.${EXT[mime]}`, blob, note: formatBytes(blob.size) });
      });
    }
    return out;
  },
};

export const imageTools = [cropTool, resizeTool, rotateTool, compressTool, convertTool, heicTool, watermarkTool, faviconTool];
