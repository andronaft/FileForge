import { metadataTool } from "./metadata.js";
import { el, baseName, field, select, number, checkbox, formatBytes, plural, toast, t } from "../util.js";

// ---------- image engine ----------

/** SVG files without width/height would decode at the browser's 300 × 150 default; give them a real size from the viewBox. */
async function sizedSvg(file) {
  const text = await file.text();
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) return file;
  const attrs = open[0];
  const has = (name) => new RegExp(`\\s${name}\\s*=\\s*["'][^"']*\\d`, "i").test(attrs);
  if (has("width") && has("height")) return file;
  const vb = attrs.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (!vb) return file;
  const k = SVG_LONG_SIDE / Math.max(Number(vb[1]), Number(vb[2]));
  const w = Math.round(Number(vb[1]) * k), h = Math.round(Number(vb[2]) * k);
  const fixed = text.replace(open[0], attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "").replace(/<svg\b/i, `<svg width="${w}" height="${h}"`));
  return new File([fixed], file.name, { type: "image/svg+xml" });
}
const SVG_LONG_SIDE = 1024;

async function loadImage(file) {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) file = await sizedSvg(file);
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" }); // honour the EXIF rotation of phone photos
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
    const inX = number(0, { min: 0, "data-noremember": "" }), inY = number(0, { min: 0, "data-noremember": "" }), inW = number(0, { min: 1, "data-noremember": "" }), inH = number(0, { min: 1, "data-noremember": "" });
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
      info.textContent = s ? t("Selection {w} × {h} px of {W} × {H}", { w: Math.round(s.w), h: Math.round(s.h), W: st.w, H: st.h }) : t("Image {W} × {H} px — drag to select", { W: st.w, H: st.h });
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
    const preset = select([["", "Custom"], ["3840", "4K · 3840 px wide"], ["1920", "Full HD · 1920 px wide"], ["1280", "HD · 1280 px wide"], ["800", "Web · 800 px wide"], ["256", "Thumbnail · 256 px wide"],
      ["1080x1080", "Instagram post · 1080 × 1080"], ["1080x1350", "Instagram portrait · 1080 × 1350"], ["1080x1920", "Story / Reels · 1080 × 1920"], ["1280x720", "YouTube thumbnail · 1280 × 720"], ["1200x630", "Link preview (Open Graph) · 1200 × 630"],
      ["1500x500", "X / Twitter header · 1500 × 500"], ["1584x396", "LinkedIn banner · 1584 × 396"], ["820x312", "Facebook cover · 820 × 312"], ["2480x3508", "A4 at 300 dpi · 2480 × 3508"]], "");
    const fit = select([["cover", "Cover: crop to the exact size"], ["inside", "Fit inside (keeps the whole image)"]], "cover");
    const fitField = field("When both are set", fit); fitField.hidden = true;
    const syncFit = () => { fitField.hidden = !(Number(width.value) && Number(height.value)); };
    preset.addEventListener("change", () => {
      if (!preset.value) return;
      const [w, h] = preset.value.split("x");
      width.value = w; height.value = h || "";
      lock.input.checked = !h;
      syncFit();
    });
    width.addEventListener("input", () => { preset.value = ""; syncFit(); });
    height.addEventListener("input", () => { preset.value = ""; syncFit(); });
    const pixelsRow = el("div", { class: "row" }, [field("Preset", preset), field("Width (px)", width), field("Height (px)", height), lock.label, fitField]);
    const percentRow = el("div", { class: "row", hidden: true }, [field("Scale (%)", percent)]);
    mode.addEventListener("change", () => { pixelsRow.hidden = mode.value !== "pixels"; percentRow.hidden = mode.value !== "percent"; });
    const info = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [field("Mode", mode)]), pixelsRow, percentRow, noEnlarge.label, info, fq.row);
    sizeOf(files[0]).then((d) => { info.textContent = `${files[0].name}: ${d.w} × ${d.h} px${files.length > 1 ? ` ${t("(+{n} more)", { n: files.length - 1 })}` : ""}`; }).catch(() => {});
    this.opts = { mode, width, height, percent, lock, noEnlarge, fq, fit };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const d = await sizeOf(file);
      let w, h, crop = null;
      if (o.mode.value === "percent") {
        const k = Number(o.percent.value) / 100;
        if (!(k > 0)) throw new Error(t("Enter a percentage above 0"));
        w = d.w * k; h = d.h * k;
      } else {
        const tw = Number(o.width.value) || 0, th = Number(o.height.value) || 0;
        if (!tw && !th) throw new Error(t("Enter a width or a height"));
        if (tw && th && o.fit.value === "cover") {
          // Crop the centre to the target aspect, then scale to exactly tw × th.
          const target = tw / th, src = d.w / d.h;
          const cw = src > target ? Math.round(d.h * target) : d.w, ch = src > target ? d.h : Math.round(d.w / target);
          crop = { x: Math.round((d.w - cw) / 2), y: Math.round((d.h - ch) / 2), w: cw, h: ch };
          w = tw; h = th;
          if (o.noEnlarge.input.checked && (tw > cw || th > ch)) { const k = Math.min(cw / tw, ch / th); w = tw * k; h = th * k; }
        } else if (o.lock.input.checked || !tw || !th) {
          const k = tw && th ? Math.min(tw / d.w, th / d.h) : tw ? tw / d.w : th / d.h;
          w = d.w * k; h = d.h * k;
        } else { w = tw; h = th; }
      }
      if (!crop && o.noEnlarge.input.checked && (w > d.w || h > d.h)) { w = d.w; h = d.h; }
      const r = await processImage(file, { crop, width: Math.round(w), height: Math.round(h), format: o.fq.format, quality: o.fq.quality });
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
      status.textContent = `${t("Rotation")} ${st.rotate}°${st.flipH ? t(", flipped horizontally") : ""}${st.flipV ? t(", flipped vertically") : ""}`;
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
  async run(files, _root, progress) {
    const st = this.opts;
    if (!st.rotate && !st.flipH && !st.flipV) throw new Error("Choose a rotation or flip first");
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
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
    const target = number("", { min: 1, placeholder: "no target" });
    const format = select([["auto", "Auto (JPEG→JPEG, WebP→WebP, PNG→WebP)"], ["jpeg", "JPEG"], ["webp", "WebP"], ["png", "PNG (lossless, only resizes)"]], "auto");
    const estimate = el("div", { class: "stat", text: "" });
    root.append(
      el("div", { class: "row" }, [
        field("Quality", el("div", { class: "row" }, [quality, qLabel]), "75 is a good balance; 60 is noticeably smaller"),
        field("Target size (KB)", target, "Lowers the quality until the file fits, e.g. 200 for an e-mail attachment"),
        field("Max width/height (px)", maxDim, "Longest side is limited to this"),
        field("Output format", format),
      ]),
      el("div", { class: "stat", text: t("{files}, {size} total", { files: plural(files.length, "file"), size: formatBytes(files.reduce((s, f) => s + f.size, 0)) }) }),
      estimate,
    );
    this.opts = { quality, maxDim, target, format };
    this.preview(root, files[0], estimate);
  },
  /** Before/after view of the first file with a live size estimate for the current settings. */
  preview(root, file, estimate) {
    const o = this.opts;
    const before = el("canvas"), after = el("canvas");
    const afterWrap = el("div", { class: "after" }, [after]);
    const divider = el("div", { class: "divider" });
    const slider = el("input", { type: "range", min: 0, max: 100, value: 50, "aria-label": "Compare before and after", "data-noremember": "" });
    slider.addEventListener("input", () => { afterWrap.style.clipPath = `inset(0 0 0 ${slider.value}%)`; divider.style.left = `${slider.value}%`; });
    const box = el("div", { class: "compare", hidden: true }, [before, afterWrap, divider, el("span", { class: "tag l", text: "Original" }), el("span", { class: "tag r", text: "Compressed" }), slider]);
    root.append(box);
    let img = null, token = 0, timer = null;
    const fmtOf = () => { const f = o.format.value; return f === "auto" ? (file.type === "image/jpeg" ? "jpeg" : "webp") : f; };
    const update = async () => {
      const my = ++token;
      if (!img) {
        try { img = await loadImage(file); } catch (_) { estimate.textContent = ""; return; }
        const d = dims(img), k = Math.min(1, 480 / d.w, 360 / d.h);
        before.width = after.width = Math.round(d.w * k); before.height = after.height = Math.round(d.h * k);
        before.getContext("2d").drawImage(img, 0, 0, before.width, before.height);
        box.hidden = false;
      }
      const fmt = fmtOf(), d = dims(img), limit = Number(o.maxDim.value) || 0;
      let w = d.w, h = d.h;
      if (limit && Math.max(w, h) > limit) { const k = limit / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      estimate.textContent = "Estimating…";
      const blob = await encode(resizeStage(img, w, h), MIME[fmt], fmt === "png" ? undefined : Number(o.quality.value) / 100);
      if (my !== token) return;
      const saved = 1 - blob.size / file.size;
      const targetKb = Number(o.target.value);
      estimate.textContent = `${file.name}: ${formatBytes(file.size)} → ${formatBytes(blob.size)} ${t("at quality {q}", { q: o.quality.value })} (${saved > 0 ? `−${Math.round(saved * 100)}%` : t("no gain, the original will be kept")})${targetKb > 0 && fmt !== "png" ? ` · ${t("the {kb} KB target is applied when you click Compress", { kb: targetKb })}` : ""}${w !== d.w ? ` · ${w} × ${h}` : ""}`;
      try {
        const bmp = await createImageBitmap(blob);
        if (my !== token) { bmp.close(); return; }
        after.getContext("2d").drawImage(bmp, 0, 0, after.width, after.height);
        bmp.close();
      } catch (_) { /* preview only */ }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => update().catch(() => {}), 300); };
    for (const i of [o.quality, o.maxDim, o.target, o.format]) { i.addEventListener("input", schedule); i.addEventListener("change", schedule); }
    schedule();
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      let fmt = o.format.value;
      if (fmt === "auto") fmt = file.type === "image/jpeg" ? "jpeg" : file.type === "image/webp" ? "webp" : "webp";
      const mime = MIME[fmt];
      const img = await loadImage(file);
      const d = dims(img);
      const limit = Number(o.maxDim.value) || 0;
      let w = d.w, h = d.h;
      if (limit && Math.max(w, h) > limit) { const k = limit / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      // Decode and resize once; the quality search below only re-encodes the same canvas.
      let canvas = resizeStage(img, w, h);
      let blob = await encode(canvas, mime, Number(o.quality.value) / 100);
      const targetBytes = Number(o.target.value) * 1024;
      if (targetBytes > 0 && fmt !== "png" && blob.size > targetBytes) {
        // binary search the quality, then shrink the image if even the lowest quality is too big
        let lo = 5, hi = Number(o.quality.value) - 1, best = null;
        while (lo <= hi) {
          const q = Math.floor((lo + hi) / 2);
          const t = await encode(canvas, mime, q / 100);
          if (t.size <= targetBytes) { best = t; lo = q + 1; } else hi = q - 1;
        }
        while (!best && Math.max(w, h) > 64) {
          w = Math.round(w * 0.8); h = Math.round(h * 0.8);
          canvas = resizeStage(canvas, w, h);
          const t = await encode(canvas, mime, 0.5);
          if (t.size <= targetBytes) best = t;
        }
        if (!best) throw new Error(t("{name}: cannot get below {size}", { name: file.name, size: formatBytes(targetBytes) }));
        blob = best;
      }
      if (img.close) img.close();
      if (blob.size >= file.size) {
        // Re-encoding cannot beat the original: hand it back untouched instead of a bigger "compressed" file.
        out.push({ name: file.name, blob: file, note: t("already as small as it gets (re-encoding gave {size})", { size: formatBytes(blob.size) }) });
        continue;
      }
      out.push({
        name: outName(file, mime, "compressed"), blob,
        note: `−${Math.round((1 - blob.size / file.size) * 100)}% ${t("(was {size})", { size: formatBytes(file.size) })}`,
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
  async run(files, _root, progress) {
    if (this.fq.format === "keep") throw new Error("Choose a target format");
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
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
    const text = el("input", { type: "text", value: this.last?.text || "© FileForge", placeholder: "Your text", "data-remember": "" });
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
  async run(files, _root, progress) {
    const wm = this.opts();
    if (!wm.text.trim()) throw new Error("Enter the watermark text");
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const r = await processImage(file, { watermark: wm, format: this.fq.format, quality: this.fq.quality });
      out.push({ name: outName(file, r.mime, "watermarked"), blob: r.blob, note: `${r.width} × ${r.height}` });
    }
    return out;
  },
};

// ---------- redact ----------

/** Paints the redaction boxes onto `canvas` in place. boxes: [{x, y, w, h}] in canvas pixels. */
function applyRedactions(canvas, boxes, mode, strengthPct) {
  const ctx = canvas.getContext("2d");
  for (const b of boxes) {
    const x = Math.max(0, Math.round(b.x)), y = Math.max(0, Math.round(b.y));
    const w = Math.min(canvas.width - x, Math.round(b.w)), h = Math.min(canvas.height - y, Math.round(b.h));
    if (w < 1 || h < 1) continue;
    if (mode === "black") { ctx.fillStyle = "#000"; ctx.fillRect(x, y, w, h); continue; }
    const px = Math.max(4, Math.round((canvas.width * (strengthPct || 3)) / 100));
    if (mode === "pixelate") {
      const t = makeCanvas(Math.ceil(w / px), Math.ceil(h / px));
      t.getContext("2d").drawImage(canvas, x, y, w, h, 0, 0, t.width, t.height);
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(t, 0, 0, t.width, t.height, x, y, w, h);
      ctx.restore();
    } else {
      // blur: draw the region into a temp canvas with a blur filter, then paint it back
      const t = makeCanvas(w, h);
      const tc = t.getContext("2d");
      tc.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      tc.filter = `blur(${px / 2}px)`;
      tc.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      tc.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      ctx.drawImage(t, x, y);
    }
  }
}

const redactTool = {
  id: "redact",
  title: "Redact image",
  description: "Black out, pixelate or blur parts of a screenshot or photo: names, faces, addresses, card numbers. Draw as many boxes as you need.",
  accept: "image/*",
  multiple: false,
  hint: "JPG, PNG, WebP, GIF, BMP — one image at a time",
  runLabel: "Redact & download",
  renderOptions(root, files) {
    const st = { img: null, w: 0, h: 0, scale: 1, boxes: [] };
    this.state = st;
    const mode = select([["black", "Solid black (safest)"], ["pixelate", "Pixelate"], ["blur", "Blur"]], "black");
    const strength = number(3, { min: 1, max: 20 });
    const canvas = el("canvas");
    const stage = el("div", { class: "crop-stage" }, [canvas]);
    const info = el("div", { class: "stat", text: "Loading…" });
    const fq = formatQualityRow();
    this.fq = fq; this.opts = { mode, strength };
    root.append(
      el("div", { class: "row" }, [
        field("Style", mode, "Blur and pixelation can sometimes be undone for text; use solid black for anything that must stay secret."),
        field("Block size (% of width)", strength),
        el("div", { class: "actions" }, [
          el("button", { type: "button", text: "Undo last box", onclick: () => { st.boxes.pop(); draw(); } }),
          el("button", { type: "button", text: "Clear all", onclick: () => { st.boxes = []; draw(); } }),
        ]),
      ]),
      stage, info, fq.row,
    );
    const draw = (live) => {
      if (!st.img) return;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
      const k = st.scale;
      const boxes = [...st.boxes, ...(live ? [live] : [])];
      applyRedactions(canvas, boxes.map((b) => ({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k })), mode.value, Number(strength.value));
      ctx.strokeStyle = "#ff8c28"; ctx.lineWidth = 1.5;
      for (const b of boxes) ctx.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
      info.textContent = st.boxes.length ? t("{boxes} · click a box to remove it, drag to add another", { boxes: plural(st.boxes.length, "box", "boxes") }) : t("{w} × {h} px · drag over the parts to hide", { w: st.w, h: st.h });
    };
    mode.addEventListener("change", () => draw());
    strength.addEventListener("input", () => draw());
    (async () => {
      st.img = await loadImage(files[0]);
      const d = dims(st.img); st.w = d.w; st.h = d.h;
      const maxW = Math.min(860, root.clientWidth - 32 || 860);
      st.scale = Math.min(1, maxW / d.w, 540 / d.h);
      canvas.width = Math.round(d.w * st.scale); canvas.height = Math.round(d.h * st.scale);
      draw();
    })().catch((err) => toast(err.message, "error"));
    let start = null;
    const toSrc = (e) => { const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width / st.scale; return { x: Math.max(0, Math.min(st.w, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(st.h, (e.clientY - r.top) * k)) }; };
    const boxFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    canvas.addEventListener("pointerdown", (e) => { if (!st.img) return; canvas.setPointerCapture(e.pointerId); start = toSrc(e); });
    canvas.addEventListener("pointermove", (e) => { if (!start) return; draw(boxFrom(start, toSrc(e))); });
    const end = (e) => {
      if (!start) return;
      const b = boxFrom(start, toSrc(e)); start = null;
      if (b.w < 3 || b.h < 3) {
        // a click: remove the box under the pointer
        const p = toSrc(e);
        const hit = st.boxes.findLastIndex((x) => p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + x.h);
        if (hit >= 0) st.boxes.splice(hit, 1);
      } else st.boxes.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
      draw();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", () => { start = null; draw(); });
  },
  async run(files) {
    const st = this.state;
    if (!st?.boxes.length) throw new Error("Draw at least one box over the part to hide");
    const img = await loadImage(files[0]);
    const d = dims(img);
    const c = makeCanvas(d.w, d.h);
    c.getContext("2d").drawImage(img, 0, 0);
    if (img.close) img.close();
    applyRedactions(c, st.boxes, this.opts.mode.value, Number(this.opts.strength.value));
    const mime = this.fq.format === "keep" ? (formatOf(files[0]) || "image/png") : MIME[this.fq.format];
    const blob = await encode(c, mime, this.fq.quality / 100);
    return [{ name: outName(files[0], mime, "redacted"), blob, note: t("{areas} hidden", { areas: plural(st.boxes.length, "area") }) }];
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
    sizeOf(files[0]).then((d) => { info.textContent = `${files[0].name}: ${d.w} × ${d.h} px${d.w !== d.h ? ` ${t("(not square)")}` : ""}`; }).catch(() => {});
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

// Firefox has no sandboxed extension pages, so the Firefox package ships without the decoder.
const HEIC_UNAVAILABLE = location.protocol === "moz-extension:";
const WEB_APP = "https://andronaft.github.io/FileForge/app/";

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
    if (HEIC_UNAVAILABLE) {
      root.append(el("p", { class: "field-hint" }, [
        "HEIC decoding needs a sandboxed page, which Firefox extensions do not have. Use the web version: ",
        el("a", { href: WEB_APP + "#heic", target: "_blank", rel: "noopener" }, WEB_APP),
      ]));
      return;
    }
    const fq = formatQualityRow("jpeg");
    root.append(fq.row);
    this.fq = fq;
    heicSandbox().catch(() => {});
  },
  async run(files, _root, progress) {
    if (HEIC_UNAVAILABLE) throw new Error("HEIC is unavailable in the Firefox extension; use the web version at " + WEB_APP);
    const fmt = this.fq.format === "keep" ? "jpeg" : this.fq.format;
    const mime = MIME[fmt];
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const buffers = await decodeHeic(file, mime, this.fq.quality / 100);
      buffers.forEach((buf, i) => {
        const blob = new Blob([buf], { type: mime });
        out.push({ name: `${baseName(file.name)}${buffers.length > 1 ? `-${i + 1}` : ""}.${EXT[mime]}`, blob, note: formatBytes(blob.size) });
      });
    }
    return out;
  },
};

// ---------- adjust (filters) ----------

const PRESETS = {
  none: {}, vivid: { contrast: 115, saturation: 140 }, bw: { saturation: 0, contrast: 110 }, vintage: { sepia: 45, contrast: 90, brightness: 105 },
  fade: { contrast: 85, brightness: 110, saturation: 85 }, cool: { hue: 15, saturation: 110 }, warm: { hue: -12, saturation: 110, brightness: 103 }, dramatic: { contrast: 140, saturation: 90, brightness: 95 },
};
const ADJ_DEFAULTS = { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0, sharpen: 0, grayscale: 0, sepia: 0 };

function filterString(v) {
  return `brightness(${v.brightness}%) contrast(${v.contrast}%) saturate(${v.saturation}%) hue-rotate(${v.hue}deg) grayscale(${v.grayscale}%) sepia(${v.sepia}%)${v.blur > 0 ? ` blur(${v.blur}px)` : ""}${v.invert ? " invert(100%)" : ""}`;
}

/** Unsharp-mask style sharpening with a 3 × 3 kernel; amount 0–1. */
function sharpen(canvas, amount) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h), out = ctx.createImageData(w, h);
  const s = src.data, o = out.data, a = amount * 0.8, c = 1 + 4 * a;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const up = y ? i - w * 4 : i, down = y < h - 1 ? i + w * 4 : i, left = x ? i - 4 : i, right = x < w - 1 ? i + 4 : i;
    for (let k = 0; k < 3; k++) o[i + k] = Math.max(0, Math.min(255, c * s[i + k] - a * (s[up + k] + s[down + k] + s[left + k] + s[right + k])));
    o[i + 3] = s[i + 3];
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function applyAdjust(src, v) {
  const { w, h } = dims(src);
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.filter = filterString(v);
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";
  return v.sharpen > 0 ? sharpen(c, v.sharpen / 100) : c;
}

const adjustTool = {
  id: "adjust",
  title: "Adjust image",
  description: "Brightness, contrast, saturation, warmth, blur, sharpen, grayscale and sepia with a live preview and one-click looks. Applies the same settings to every file.",
  keywords: ["filter", "brightness", "contrast", "saturation", "black and white", "sepia", "sharpen", "blur", "photo", "exposure"],
  accept: "image/*",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Apply",
  renderOptions(root, files) {
    const preset = select(Object.keys(PRESETS).map((k) => [k, { none: "Custom", vivid: "Vivid", bw: "Black & white", vintage: "Vintage", fade: "Faded", cool: "Cool", warm: "Warm", dramatic: "Dramatic" }[k]]), "none");
    const sliders = {};
    let applying = false; // a look sets the sliders; that must not flip the select back to "Custom"
    const mk = (key, label, min, max, unit = "%") => {
      const input = el("input", { type: "range", min, max, value: ADJ_DEFAULTS[key] });
      const lab = el("span", { class: "stat", text: `${input.value}${unit}` });
      input.addEventListener("input", () => { lab.textContent = `${input.value}${unit}`; if (!applying) preset.value = "none"; });
      sliders[key] = input;
      return field(label, el("div", { class: "row" }, [input, lab]));
    };
    const invert = checkbox("Invert colours", false);
    const fq = formatQualityRow();
    const preview = el("canvas", { class: "preview" });
    const resetBtn = el("button", { type: "button", class: "small", text: "Reset", onclick: () => { applying = true; for (const [k, v] of Object.entries(ADJ_DEFAULTS)) { sliders[k].value = v; sliders[k].dispatchEvent(new Event("input", { bubbles: true })); } applying = false; invert.input.checked = false; preset.value = "none"; paint(); } });
    root.append(
      el("div", { class: "row" }, [field("Look", preset), invert.label, resetBtn]),
      el("div", { class: "row" }, [mk("brightness", "Brightness", 0, 200), mk("contrast", "Contrast", 0, 200), mk("saturation", "Saturation", 0, 200), mk("hue", "Hue shift", -180, 180, "°")]),
      el("div", { class: "row" }, [mk("blur", "Blur", 0, 20, " px"), mk("sharpen", "Sharpen", 0, 100), mk("grayscale", "Grayscale", 0, 100), mk("sepia", "Sepia", 0, 100)]),
      el("div", { class: "preview-wrap" }, [el("span", { class: "stat", text: files.length > 1 ? t("Preview of {name}; the same settings apply to all {n} files", { name: files[0].name, n: files.length }) : files[0].name }), preview]),
      fq.row,
    );
    const values = () => ({ ...Object.fromEntries(Object.entries(sliders).map(([k, i]) => [k, Number(i.value)])), invert: invert.input.checked });
    this.values = values; this.fq = fq;
    let small = null, timer = null;
    const paint = () => {
      if (!small) return;
      const v = values();
      const c = applyAdjust(small, { ...v, blur: v.blur * (small.width / this.srcW) });
      preview.width = c.width; preview.height = c.height;
      preview.getContext("2d").drawImage(c, 0, 0);
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 60); };
    for (const i of Object.values(sliders)) i.addEventListener("input", schedule);
    invert.input.addEventListener("change", paint);
    preset.addEventListener("change", () => {
      const p = PRESETS[preset.value] || {};
      applying = true;
      for (const [k, v] of Object.entries(ADJ_DEFAULTS)) { sliders[k].value = p[k] ?? v; sliders[k].dispatchEvent(new Event("input", { bubbles: true })); }
      applying = false;
      paint();
    });
    previewOf(files[0], 520).then((pv) => { small = pv.canvas; this.srcW = pv.w; paint(); }).catch((err) => toast(err.message, "error"));
  },
  async run(files, _root, progress) {
    const v = this.values(), out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const img = await loadImage(file);
      const c = applyAdjust(img, v);
      if (img.close) img.close();
      const mime = this.fq.format === "keep" ? (formatOf(file) || "image/png") : MIME[this.fq.format];
      out.push({ name: outName(file, mime, "adjusted"), blob: await encode(c, mime, this.fq.quality / 100), note: `${c.width} × ${c.height}` });
    }
    return out;
  },
};

// ---------- frame & corners ----------

function framed(src, o) {
  const { w, h } = dims(src);
  const pad = o.padUnit === "%" ? Math.round((Math.max(w, h) * o.pad) / 100) : o.pad;
  const border = o.border, r = Math.min(o.radius, Math.min(w, h) / 2);
  const c = makeCanvas(w + 2 * (pad + border), h + 2 * (pad + border));
  const ctx = c.getContext("2d");
  if (!o.transparent) { ctx.fillStyle = o.bg; ctx.fillRect(0, 0, c.width, c.height); }
  const x = pad + border, y = pad + border;
  const rounded = (px, py, pw, ph, rr) => { ctx.beginPath(); ctx.roundRect(px, py, pw, ph, rr); };
  if (o.shadow) {
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = Math.max(8, pad / 2); ctx.shadowOffsetY = Math.max(2, pad / 6);
    rounded(x - border, y - border, w + 2 * border, h + 2 * border, r + border); ctx.fillStyle = border ? o.borderColor : "#000"; ctx.fill(); ctx.restore();
  }
  if (border) { rounded(x - border, y - border, w + 2 * border, h + 2 * border, r + border); ctx.fillStyle = o.borderColor; ctx.fill(); }
  ctx.save(); rounded(x, y, w, h, r); ctx.clip(); ctx.drawImage(src, x, y); ctx.restore();
  return c;
}

const frameTool = {
  id: "frame",
  title: "Frame, padding & corners",
  description: "Add a coloured or transparent margin, a border, rounded corners and a soft shadow: screenshots ready for a post, a doc or an app store.",
  keywords: ["border", "rounded", "padding", "margin", "shadow", "screenshot", "background", "mockup"],
  accept: "image/*",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Apply",
  renderOptions(root, files) {
    const pad = number(40, { min: 0, max: 2000 }), padUnit = select([["px", "px"], ["%", "% of the long side"]], "px");
    const bg = el("input", { type: "color", value: "#ffffff" }), transparent = checkbox("Transparent background", false);
    const border = number(0, { min: 0, max: 200 }), borderColor = el("input", { type: "color", value: "#1b1f27" });
    const radius = number(16, { min: 0, max: 500 }), shadow = checkbox("Soft shadow", true);
    const fq = formatQualityRow("png");
    const preview = el("canvas", { class: "preview" });
    root.append(
      el("div", { class: "row" }, [field("Padding", el("div", { class: "row" }, [pad, padUnit])), field("Background", bg), transparent.label]),
      el("div", { class: "row" }, [field("Border width (px)", border), field("Border colour", borderColor), field("Corner radius (px)", radius), shadow.label]),
      el("div", { class: "preview-wrap" }, [preview]), fq.row,
    );
    const o = () => ({ pad: Number(pad.value) || 0, padUnit: padUnit.value, bg: bg.value, transparent: transparent.input.checked, border: Number(border.value) || 0, borderColor: borderColor.value, radius: Number(radius.value) || 0, shadow: shadow.input.checked });
    this.opts = o; this.fq = fq;
    let small = null, k = 1, timer = null;
    const paint = () => { if (!small) return; const v = o(); const c = framed(small, { ...v, pad: v.padUnit === "px" ? Math.round(v.pad * k) : v.pad, border: Math.round(v.border * k), radius: Math.round(v.radius * k) }); preview.width = c.width; preview.height = c.height; preview.getContext("2d").drawImage(c, 0, 0); };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 60); };
    for (const i of [pad, padUnit, bg, transparent.input, border, borderColor, radius, shadow.input]) { i.addEventListener("input", schedule); i.addEventListener("change", schedule); }
    previewOf(files[0], 480).then((pv) => { small = pv.canvas; k = pv.canvas.width / pv.w; paint(); }).catch((err) => toast(err.message, "error"));
  },
  async run(files, _root, progress) {
    const v = this.opts(), out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const img = await loadImage(file);
      const c = framed(img, v);
      if (img.close) img.close();
      let fmt = this.fq.format === "keep" ? (formatOf(file) === "image/jpeg" ? "jpeg" : "png") : this.fq.format;
      if ((v.transparent || v.radius > 0) && fmt === "jpeg") fmt = "png"; // keep the transparent corners
      out.push({ name: outName(file, MIME[fmt], "framed"), blob: await encode(c, MIME[fmt], this.fq.quality / 100), note: `${c.width} × ${c.height}` });
    }
    return out;
  },
};

// ---------- colour palette ----------

/** Median-cut quantisation of sampled pixels into `count` colours, sorted by how much of the image they cover. */
function extractPalette(src, count, skipExtremes) {
  const c = makeCanvas(96, 96);
  c.getContext("2d").drawImage(src, 0, 0, 96, 96);
  const d = c.getContext("2d").getImageData(0, 0, 96, 96).data;
  let px = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (skipExtremes && ((r > 240 && g > 240 && b > 240) || (r < 15 && g < 15 && b < 15))) continue;
    px.push([r, g, b]);
  }
  if (!px.length) return [];
  let boxes = [px];
  while (boxes.length < count) {
    boxes.sort((a, b) => spread(b) - spread(a));
    const box = boxes.shift();
    if (box.length < 2) { boxes.push(box); break; }
    const ch = widestChannel(box);
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.map((box) => {
    const avg = [0, 1, 2].map((k) => Math.round(box.reduce((s, p) => s + p[k], 0) / box.length));
    return { rgb: avg, hex: "#" + avg.map((v) => v.toString(16).padStart(2, "0")).join(""), share: box.length / px.length };
  }).sort((a, b) => b.share - a.share);
}
function widestChannel(box) { const r = [0, 1, 2].map((k) => Math.max(...box.map((p) => p[k])) - Math.min(...box.map((p) => p[k]))); return r.indexOf(Math.max(...r)); }
function spread(box) { return Math.max(...[0, 1, 2].map((k) => Math.max(...box.map((p) => p[k])) - Math.min(...box.map((p) => p[k])))); }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const dd = max - min, s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
  const h = max === r ? (g - b) / dd + (g < b ? 6 : 0) : max === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

const paletteTool = {
  id: "palette",
  title: "Colour palette",
  description: "Pull the dominant colours out of a photo, logo or screenshot as HEX, RGB and HSL, ready to paste as CSS variables, JSON or a swatch image.",
  keywords: ["colors", "colours", "dominant", "swatch", "hex", "css variables", "brand", "theme"],
  accept: "image/*",
  multiple: false,
  noAutoDownload: true,
  hint: "One image",
  runLabel: "Save palette",
  renderOptions(root, files) {
    const count = select([["4", "4"], ["6", "6"], ["8", "8"], ["12", "12"]], "6");
    const skip = checkbox("Ignore pure white and black", true);
    const naming = select([["hex", "HEX"], ["rgb", "RGB"], ["hsl", "HSL"]], "hex");
    const swatches = el("div", { class: "swatches" });
    const css = el("textarea", { readonly: true, spellcheck: "false", style: "min-height: 120px" });
    const cf = field("CSS variables", css); cf.append(copyButtonLocal(() => css.value));
    root.append(el("div", { class: "row" }, [field("Colours", count), field("Show as", naming), skip.label]), el("div", { class: "stat", text: "Click a swatch to copy its value" }), swatches, cf);
    let img = null;
    const update = () => {
      if (!img) return;
      const pal = extractPalette(img, Number(count.value), skip.input.checked);
      this.palette = pal;
      const label = (p) => naming.value === "hex" ? p.hex : naming.value === "rgb" ? `rgb(${p.rgb.join(", ")})` : `hsl(${rgbToHsl(p.rgb).map((v, i) => (i ? `${v}%` : v)).join(", ")})`;
      swatches.replaceChildren(...pal.map((p) => el("button", { type: "button", class: "swatch", title: t("Copy {value}", { value: label(p) }), onclick: () => navigator.clipboard?.writeText(label(p)).then(() => toast(t("Copied {name}", { name: label(p) }))) }, [
        el("i", { style: `background: ${p.hex}` }), el("code", { text: label(p) }), el("span", { class: "stat", text: `${Math.round(p.share * 100)}%` }),
      ])));
      css.value = `:root {\n${pal.map((p, i) => `  --color-${i + 1}: ${label(p)};`).join("\n")}\n}\n`;
    };
    for (const i of [count, naming, skip.input]) i.addEventListener("change", update);
    loadImage(files[0]).then((im) => { img = im; update(); }).catch((err) => toast(err.message, "error"));
  },
  async run(files) {
    const pal = this.palette;
    if (!pal?.length) throw new Error(t("No colours found"));
    const base = baseName(files[0].name);
    const json = pal.map((p) => ({ hex: p.hex, rgb: p.rgb, hsl: rgbToHsl(p.rgb), share: Math.round(p.share * 1000) / 1000 }));
    const strip = makeCanvas(pal.length * 120, 160);
    const ctx = strip.getContext("2d");
    pal.forEach((p, i) => { ctx.fillStyle = p.hex; ctx.fillRect(i * 120, 0, 120, 120); ctx.fillStyle = "#fff"; ctx.fillRect(i * 120, 120, 120, 40); ctx.fillStyle = "#111"; ctx.font = "14px ui-monospace, Menlo, monospace"; ctx.textAlign = "center"; ctx.fillText(p.hex, i * 120 + 60, 145); });
    return [
      { name: `${base}-palette.png`, blob: await encode(strip, "image/png"), note: plural(pal.length, "colour") },
      { name: `${base}-palette.json`, blob: new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }) },
      { name: `${base}-palette.css`, blob: new Blob([`:root {\n${pal.map((p, i) => `  --color-${i + 1}: ${p.hex};`).join("\n")}\n}\n`], { type: "text/css" }) },
    ];
  },
};
function copyButtonLocal(getText) {
  return el("button", { type: "button", class: "copy", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(getText()); toast("Copied to the clipboard"); } catch (err) { toast(`Could not copy: ${err.message}`, "error"); } } });
}

// ---------- QR code ----------

let qrLoading = null;
function loadQr() {
  if (globalThis.qrcode) return Promise.resolve(globalThis.qrcode);
  qrLoading ??= new Promise((resolve, reject) => {
    const s = el("script", { src: new URL("../../vendor/qrcode.js", import.meta.url).href });
    s.onload = () => { globalThis.qrcode.stringToBytes = globalThis.qrcode.stringToBytesFuncs["UTF-8"]; resolve(globalThis.qrcode); };
    s.onerror = () => reject(new Error("Could not load the QR encoder"));
    document.head.append(s);
  });
  return qrLoading;
}

function qrModules(text, level) {
  const q = globalThis.qrcode(0, level);
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount();
  return { n, dark: (r, c) => q.isDark(r, c) };
}

function qrCanvas(m, size, margin, dark, light) {
  const cell = Math.floor(size / (m.n + 2 * margin)) || 1;
  const px = cell * (m.n + 2 * margin);
  const c = makeCanvas(px, px);
  const ctx = c.getContext("2d");
  ctx.fillStyle = light; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = dark;
  for (let r = 0; r < m.n; r++) for (let col = 0; col < m.n; col++) if (m.dark(r, col)) ctx.fillRect((col + margin) * cell, (r + margin) * cell, cell, cell);
  return c;
}

function qrSvg(m, margin, dark, light) {
  const n = m.n + 2 * margin;
  let d = "";
  for (let r = 0; r < m.n; r++) for (let c = 0; c < m.n; c++) if (m.dark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>\n`;
}

const qrTool = {
  id: "qr",
  title: "QR code",
  description: "Make a QR code for a link, text, Wi-Fi network, e-mail, phone number or contact card, as PNG or SVG, in any colours. Nothing is sent anywhere.",
  keywords: ["qr", "barcode", "wifi", "vcard", "link", "share"],
  accept: ".txt,text/plain",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "",
  runLabel: "Download",
  renderOptions(root) {
    const kind = select([["text", "Link or text"], ["wifi", "Wi-Fi network"], ["email", "E-mail"], ["tel", "Phone number"], ["sms", "SMS"], ["vcard", "Contact card (vCard)"]], "text");
    const text = el("textarea", { placeholder: "https://example.com", "data-noremember": "", style: "min-height: 70px" });
    const ssid = el("input", { type: "text", placeholder: "Network name", "data-noremember": "" }), pass = el("input", { type: "text", placeholder: "Password", "data-noremember": "" }), enc = select([["WPA", "WPA/WPA2"], ["WEP", "WEP"], ["nopass", "Open network"]], "WPA"), hidden = checkbox("Hidden network", false);
    const email = el("input", { type: "text", placeholder: "name@example.com", "data-noremember": "" }), subject = el("input", { type: "text", placeholder: "Subject", "data-noremember": "" });
    const phone = el("input", { type: "text", placeholder: "+380 ...", "data-noremember": "" }), smsBody = el("input", { type: "text", placeholder: "Message", "data-noremember": "" });
    const vn = el("input", { type: "text", placeholder: "Full name", "data-noremember": "" }), vorg = el("input", { type: "text", placeholder: "Company", "data-noremember": "" }), vtel = el("input", { type: "text", placeholder: "Phone", "data-noremember": "" }), vmail = el("input", { type: "text", placeholder: "E-mail", "data-noremember": "" }), vurl = el("input", { type: "text", placeholder: "Website", "data-noremember": "" });
    const rows = {
      text: el("div", {}, [field("Content", text)]),
      wifi: el("div", { class: "row" }, [field("Network", ssid), field("Password", pass), field("Security", enc), hidden.label]),
      email: el("div", { class: "row" }, [field("To", email), field("Subject", subject)]),
      tel: el("div", { class: "row" }, [field("Number", phone)]),
      sms: el("div", { class: "row" }, [field("Number", phone), field("Message", smsBody)]),
      vcard: el("div", { class: "row" }, [field("Name", vn), field("Company", vorg), field("Phone", vtel), field("E-mail", vmail), field("Website", vurl)]),
    };
    const size = select([["256", "256 px"], ["512", "512 px"], ["1024", "1024 px"], ["2048", "2048 px"]], "512");
    const level = select([["L", "L · 7% (smallest)"], ["M", "M · 15%"], ["Q", "Q · 25%"], ["H", "H · 30% (sturdiest)"]], "M");
    const margin = number(4, { min: 0, max: 16 }), dark = el("input", { type: "color", value: "#000000" }), light = el("input", { type: "color", value: "#ffffff" });
    const format = select([["png", "PNG"], ["svg", "SVG"]], "png");
    const preview = el("div", { class: "qr-preview" });
    const info = el("div", { class: "stat" });
    root.append(
      el("div", { class: "row" }, [field("Type", kind)]), ...Object.values(rows),
      el("div", { class: "row" }, [field("Size", size), field("Error correction", level), field("Quiet zone (modules)", margin), field("Dark", dark), field("Light", light), field("Format", format)]),
      el("div", { class: "preview-wrap" }, [preview, info]),
    );
    const showRows = () => { for (const [k, r] of Object.entries(rows)) r.hidden = k !== kind.value; };
    const esc = (s) => s.replace(/([\;,:"])/g, "\\$1");
    const payload = () => {
      switch (kind.value) {
        case "wifi": return ssid.value ? `WIFI:T:${enc.value};S:${esc(ssid.value)};${enc.value !== "nopass" ? `P:${esc(pass.value)};` : ""}${hidden.input.checked ? "H:true;" : ""};` : "";
        case "email": return email.value ? `mailto:${email.value}${subject.value ? `?subject=${encodeURIComponent(subject.value)}` : ""}` : "";
        case "tel": return phone.value ? `tel:${phone.value.replace(/[\s()-]/g, "")}` : "";
        case "sms": return phone.value ? `SMSTO:${phone.value.replace(/[\s()-]/g, "")}:${smsBody.value}` : "";
        case "vcard": return vn.value ? `BEGIN:VCARD\nVERSION:3.0\nN:${vn.value}\nFN:${vn.value}\n${vorg.value ? `ORG:${vorg.value}\n` : ""}${vtel.value ? `TEL:${vtel.value}\n` : ""}${vmail.value ? `EMAIL:${vmail.value}\n` : ""}${vurl.value ? `URL:${vurl.value}\n` : ""}END:VCARD` : "";
        default: return text.value;
      }
    };
    this.get = () => ({ payload: payload(), size: Number(size.value), level: level.value, margin: Number(margin.value) || 0, dark: dark.value, light: light.value, format: format.value });
    let timer = null;
    const paint = async () => {
      const o = this.get();
      if (!o.payload) { preview.replaceChildren(); info.textContent = t("Type something to encode"); return; }
      try {
        await loadQr();
        const m = qrModules(o.payload, o.level);
        preview.replaceChildren(qrCanvas(m, 256, o.margin, o.dark, o.light));
        info.textContent = t("{n} × {n} modules · {bytes} bytes", { n: m.n, bytes: new TextEncoder().encode(o.payload).length });
      } catch (err) { preview.replaceChildren(); info.textContent = err.message.includes("overflow") ? t("Too much data for a QR code; shorten the text or lower the error correction") : err.message; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 150); };
    kind.addEventListener("change", () => { showRows(); paint(); });
    for (const i of root.querySelectorAll("input, select, textarea")) { i.addEventListener("input", schedule); i.addEventListener("change", schedule); }
    showRows(); paint();
  },
  async run() {
    const o = this.get();
    if (!o.payload) throw new Error(t("Type something to encode"));
    await loadQr();
    const m = qrModules(o.payload, o.level);
    if (o.format === "svg") return [{ name: "qr.svg", blob: new Blob([qrSvg(m, o.margin, o.dark, o.light)], { type: "image/svg+xml" }), note: `${m.n} × ${m.n}` }];
    const c = qrCanvas(m, o.size, o.margin, o.dark, o.light);
    return [{ name: "qr.png", blob: await encode(c, "image/png"), note: `${c.width} × ${c.height}` }];
  },
};

// ---------- collage / contact sheet ----------

function fitBox(sw, sh, cw, ch, mode) {
  const k = mode === "cover" ? Math.max(cw / sw, ch / sh) : Math.min(cw / sw, ch / sh);
  return { w: sw * k, h: sh * k };
}

const collageTool = {
  id: "collage",
  title: "Collage & contact sheet",
  description: "Put many photos on one image: a grid with equal cells, a gap, a background colour and optional file names, like a contact sheet or a before/after pair.",
  keywords: ["grid", "contact sheet", "montage", "combine", "join", "side by side", "before after", "mosaic"],
  accept: "image/*",
  hint: "Two or more images — the order of the list is the order in the grid",
  runLabel: "Build collage",
  renderOptions(root, files) {
    const cols = select([["auto", "Auto"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]], "auto");
    const cell = number(600, { min: 50, max: 4000 }), fit = select([["cover", "Fill the cell (crop)"], ["contain", "Fit inside (letterbox)"]], "cover");
    const gap = number(12, { min: 0, max: 500 }), bg = el("input", { type: "color", value: "#ffffff" });
    const labels = checkbox("Write file names under the images", false), radius = number(0, { min: 0, max: 200 });
    const fq = formatQualityRow("jpeg");
    const stat = el("div", { class: "stat" });
    root.append(
      el("div", { class: "row" }, [field("Columns", cols), field("Cell size (px)", cell), field("Images in the cell", fit)]),
      el("div", { class: "row" }, [field("Gap (px)", gap), field("Background", bg), field("Corner radius (px)", radius), labels.label]),
      stat, fq.row,
    );
    const o = () => ({ cols: cols.value, cell: Number(cell.value) || 600, fit: fit.value, gap: Number(gap.value) || 0, bg: bg.value, labels: labels.input.checked, radius: Number(radius.value) || 0 });
    const describe = () => { const n = files.length, c = o().cols === "auto" ? Math.ceil(Math.sqrt(n)) : Number(o().cols); const r = Math.ceil(n / c); stat.textContent = t("{n} images → {cols} × {rows} grid, about {w} × {h} px", { n, cols: c, rows: r, w: c * o().cell + (c + 1) * o().gap, h: r * o().cell + (r + 1) * o().gap + (o().labels ? r * Math.round(o().cell * 0.08) : 0) }); };
    for (const i of [cols, cell, gap, labels.input]) { i.addEventListener("input", describe); i.addEventListener("change", describe); }
    describe();
    this.opts = o; this.fq = fq;
  },
  async run(files, _root, progress) {
    if (files.length < 2) throw new Error("Add at least two images");
    const v = this.opts();
    const n = files.length, cols = v.cols === "auto" ? Math.ceil(Math.sqrt(n)) : Number(v.cols), rows = Math.ceil(n / cols);
    const label = v.labels ? Math.round(v.cell * 0.08) : 0;
    const c = makeCanvas(cols * v.cell + (cols + 1) * v.gap, rows * (v.cell + label) + (rows + 1) * v.gap);
    const ctx = c.getContext("2d");
    ctx.fillStyle = v.bg; ctx.fillRect(0, 0, c.width, c.height);
    progress?.start(n);
    for (const [i, file] of files.entries()) {
      await progress?.tick(file.name);
      const img = await loadImage(file);
      const d = dims(img);
      const x0 = v.gap + (i % cols) * (v.cell + v.gap), y0 = v.gap + Math.floor(i / cols) * (v.cell + label + v.gap);
      const { w, h } = fitBox(d.w, d.h, v.cell, v.cell, v.fit);
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, y0, v.cell, v.cell, v.radius); else ctx.rect(x0, y0, v.cell, v.cell);
      ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x0 + (v.cell - w) / 2, y0 + (v.cell - h) / 2, w, h);
      ctx.restore();
      if (label) {
        ctx.fillStyle = luminance(v.bg) > 0.5 ? "#222" : "#eee";
        ctx.font = `${Math.round(label * 0.55)}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(ellipsize(ctx, baseName(file.name), v.cell - 8), x0 + v.cell / 2, y0 + v.cell + label / 2);
      }
      if (img.close) img.close();
    }
    const mime = this.fq.format === "keep" ? "image/jpeg" : MIME[this.fq.format];
    return [{ name: `collage.${EXT[mime]}`, blob: await encode(c, mime, this.fq.quality / 100), note: t("{n} images · {w} × {h}", { n, w: c.width, h: c.height }) }];
  },
};
function luminance(hex) { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
function ellipsize(ctx, text, max) { if (ctx.measureText(text).width <= max) return text; while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1); return text + "…"; }

// ---------- split into tiles ----------

const splitImageTool = {
  id: "split-image",
  title: "Split into tiles",
  description: "Cut an image into a grid of equal tiles (3 × 3 for an Instagram grid, 2 × 1 for a wide banner) or into tiles of a fixed pixel size.",
  keywords: ["tiles", "grid", "instagram", "slice", "cut", "pieces", "puzzle", "sprite"],
  accept: "image/*",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Split image",
  renderOptions(root, files) {
    const mode = select([["grid", "Rows × columns"], ["size", "Tile size in pixels"]], "grid");
    const rows = number(3, { min: 1, max: 50 }), cols = number(3, { min: 1, max: 50 });
    const tw = number(512, { min: 16, max: 8000 }), th = number(512, { min: 16, max: 8000 });
    const order = select([["rows", "Row by row (1-1, 1-2, 2-1…)"], ["cols", "Column by column"]], "rows");
    const fq = formatQualityRow("keep");
    const gridRow = el("div", { class: "row" }, [field("Rows", rows), field("Columns", cols)]);
    const sizeRow = el("div", { class: "row", hidden: true }, [field("Tile width (px)", tw), field("Tile height (px)", th)]);
    const stat = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [field("Split by", mode), field("Numbering", order)]), gridRow, sizeRow, stat, fq.row);
    const describe = async () => {
      gridRow.hidden = mode.value !== "grid"; sizeRow.hidden = mode.value !== "size";
      try { const d = await sizeOf(files[0]); const g = gridFor(d, this.opts()); stat.textContent = t("{name}: {cols} × {rows} tiles of {w} × {h} px", { name: files[0].name, cols: g.cols, rows: g.rows, w: g.w, h: g.h }); } catch (_) { /* ignore */ }
    };
    this.opts = () => ({ mode: mode.value, rows: Number(rows.value) || 1, cols: Number(cols.value) || 1, tw: Number(tw.value) || 512, th: Number(th.value) || 512, order: order.value });
    this.fq = fq;
    for (const i of [mode, rows, cols, tw, th]) { i.addEventListener("input", describe); i.addEventListener("change", describe); }
    describe();
  },
  async run(files, _root, progress) {
    const v = this.opts(), out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const img = await loadImage(file);
      const g = gridFor(dims(img), v);
      const mime = this.fq.format === "keep" ? (formatOf(file) || "image/png") : MIME[this.fq.format];
      const cells = [];
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) cells.push([r, c]);
      if (v.order === "cols") cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const [r, c] of cells) {
        const w = Math.min(g.w, dims(img).w - c * g.w), h = Math.min(g.h, dims(img).h - r * g.h);
        const tile = cropStage(img, { x: c * g.w, y: r * g.h, w, h });
        out.push({ name: `${baseName(file.name)}-${r + 1}-${c + 1}.${EXT[mime]}`, blob: await encode(tile, mime, this.fq.quality / 100), note: `${w} × ${h}` });
      }
      if (img.close) img.close();
    }
    return out;
  },
};
function gridFor(d, v) {
  if (v.mode === "size") { const w = Math.min(v.tw, d.w), h = Math.min(v.th, d.h); return { cols: Math.ceil(d.w / w), rows: Math.ceil(d.h / h), w, h }; }
  return { cols: v.cols, rows: v.rows, w: Math.floor(d.w / v.cols), h: Math.floor(d.h / v.rows) };
}

// ---------- compare two images ----------

/** Pixel difference of two same-size canvases; returns {count, total, mask: ImageData of flagged pixels}. */
function diffPixels(a, b, tolerance) {
  const w = a.width, h = a.height;
  const da = a.getContext("2d").getImageData(0, 0, w, h).data, db = b.getContext("2d").getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let count = 0;
  const lim = tolerance * tolerance * 3;
  for (let i = 0, p = 0; i < da.length; i += 4, p++) {
    const dr = da[i] - db[i], dg = da[i + 1] - db[i + 1], dbb = da[i + 2] - db[i + 2], dA = da[i + 3] - db[i + 3];
    if (dr * dr + dg * dg + dbb * dbb + dA * dA > lim) { mask[p] = 1; count++; }
  }
  return { count, total: w * h, mask, w, h };
}
function toCanvasSized(img, w, h) { const c = makeCanvas(w, h); const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(img, 0, 0, w, h); return c; }
function paintDiff(a, b, d, o) {
  const { w, h } = d;
  const c = makeCanvas(o.layout === "side" ? w * 3 + 2 * o.gap : w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  const marks = makeCanvas(w, h), mctx = marks.getContext("2d");
  const [r, g, bl] = [1, 3, 5].map((i) => parseInt(o.color.slice(i, i + 2), 16));
  const id = mctx.createImageData(w, h);
  for (let p = 0; p < d.mask.length; p++) if (d.mask[p]) { id.data[p * 4] = r; id.data[p * 4 + 1] = g; id.data[p * 4 + 2] = bl; id.data[p * 4 + 3] = 255; }
  mctx.putImageData(id, 0, 0);
  if (o.layout === "side") {
    ctx.drawImage(a, 0, 0); ctx.drawImage(b, w + o.gap, 0);
    const x = 2 * (w + o.gap);
    ctx.globalAlpha = 0.25; ctx.drawImage(a, x, 0); ctx.globalAlpha = 1; ctx.drawImage(marks, x, 0);
  } else if (o.layout === "mask") {
    ctx.drawImage(marks, 0, 0);
  } else {
    ctx.globalAlpha = 0.3; ctx.drawImage(a, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(marks, 0, 0);
  }
  return c;
}

const compareTool = {
  id: "image-compare",
  title: "Compare images",
  description: "Spot the difference between two screenshots or renders: the changed pixels are highlighted, counted and shown as a percentage. Different sizes are scaled to match.",
  keywords: ["diff", "difference", "pixel", "screenshot", "visual regression", "spot", "changes", "overlay"],
  accept: "image/*",
  hint: "Exactly two images: before and after",
  runLabel: "Compare",
  renderOptions(root, files) {
    const tolerance = el("input", { type: "range", min: 0, max: 80, value: 16 }), tl = el("span", { class: "stat", text: "16" });
    tolerance.addEventListener("input", () => { tl.textContent = tolerance.value; });
    const layout = select([["highlight", "Highlight on the first image"], ["side", "Side by side: A, B, difference"], ["mask", "Changed pixels only"]], "highlight");
    const color = el("input", { type: "color", value: "#ff2d55" });
    const stat = el("div", { class: "stat" }), preview = el("canvas", { class: "preview" });
    root.append(el("div", { class: "row" }, [field("Tolerance", el("div", { class: "row" }, [tolerance, tl]), "0 flags the slightest change; 20–30 ignores JPEG noise"), field("Output", layout), field("Highlight colour", color)]), stat, el("div", { class: "preview-wrap" }, [preview]));
    this.opts = () => ({ tolerance: Number(tolerance.value), layout: layout.value, color: color.value, gap: 16 });
    let small = null, timer = null;
    const paint = () => { if (!small) return; const o = this.opts(); const d = diffPixels(small.a, small.b, o.tolerance); const c = paintDiff(small.a, small.b, d, { ...o, gap: 6 }); preview.width = c.width; preview.height = c.height; preview.getContext("2d").drawImage(c, 0, 0); stat.textContent = t("{pct}% of pixels differ ({n} of {total}) at preview size", { pct: ((100 * d.count) / d.total).toFixed(2), n: d.count.toLocaleString(), total: d.total.toLocaleString() }); };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(paint, 80); };
    for (const i of [tolerance, layout, color]) { i.addEventListener("input", schedule); i.addEventListener("change", schedule); }
    if (files.length >= 2) Promise.all([loadImage(files[0]), loadImage(files[1])]).then(([a, b]) => { const d = dims(a); const k = Math.min(1, 480 / d.w, 320 / d.h); small = { a: toCanvasSized(a, Math.round(d.w * k), Math.round(d.h * k)), b: toCanvasSized(b, Math.round(d.w * k), Math.round(d.h * k)) }; if (a.close) a.close(); if (b.close) b.close(); paint(); }).catch((err) => toast(err.message, "error"));
    else stat.textContent = t("Add a second image to compare");
  },
  async run(files, _root, progress) {
    if (files.length < 2) throw new Error("Add two images to compare");
    const o = this.opts();
    await progress?.tick(files[0].name);
    const [a, b] = await Promise.all([loadImage(files[0]), loadImage(files[1])]);
    const da = dims(a), db = dims(b);
    const ca = toCanvasSized(a, da.w, da.h), cb = toCanvasSized(b, da.w, da.h);
    if (a.close) a.close(); if (b.close) b.close();
    const d = diffPixels(ca, cb, o.tolerance);
    const c = paintDiff(ca, cb, d, o);
    const pct = ((100 * d.count) / d.total).toFixed(2);
    const scaled = da.w !== db.w || da.h !== db.h ? t(" · second image scaled from {w} × {h}", { w: db.w, h: db.h }) : "";
    return [{ name: `${baseName(files[0].name)}-vs-${baseName(files[1].name)}.png`, blob: await encode(c, "image/png"), note: t("{pct}% differ · {n} pixels", { pct, n: d.count.toLocaleString() }) + scaled }];
  },
};

// ---------- SVG to PNG / JPEG / WebP ----------

function svgSize(text) {
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error("Not an SVG file");
  const attrs = open[0];
  const num = (name) => { const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)`, "i")); return m ? Number(m[1]) : 0; };
  const vb = attrs.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  let w = num("width"), h = num("height");
  if ((!w || !h) && vb) { const vw = Number(vb[1]), vh = Number(vb[2]); if (w && !h) h = (w * vh) / vw; else if (h && !w) w = (h * vw) / vh; else { w = vw; h = vh; } }
  if (!w || !h) { w = 300; h = 150; }
  return { w, h, open: open[0], attrs };
}
async function rasterizeSvg(text, w, h) {
  const { open, attrs } = svgSize(text);
  const fixed = text.replace(open, attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "").replace(/<svg\b/i, `<svg width="${w}" height="${h}"`));
  const url = URL.createObjectURL(new Blob([fixed], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("The browser could not render this SVG")); img.src = url; });
    const c = makeCanvas(w, h);
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

const svgTool = {
  id: "svg-raster",
  title: "SVG to PNG",
  description: "Render an SVG at any size as PNG, JPEG or WebP — exact pixels, a scale factor, or 1×/2×/3× sets for app icons and the web, with a transparent or solid background.",
  keywords: ["svg", "vector", "rasterize", "render", "png", "export", "icon", "2x", "retina"],
  accept: ".svg,image/svg+xml",
  hint: "SVG files — multiple files allowed",
  runLabel: "Render",
  renderOptions(root, files) {
    const mode = select([["width", "Width in pixels"], ["height", "Height in pixels"], ["scale", "Scale factor"]], "width");
    const size = number(1024, { min: 1, max: 10000 }), scale = number(2, { min: 0.1, max: 20, step: 0.5 });
    const sets = checkbox("Also 2× and 3× (@2x, @3x)", false);
    const bgMode = select([["transparent", "Transparent"], ["colour", "Solid colour"]], "transparent"), bg = el("input", { type: "color", value: "#ffffff" });
    const fq = formatQualityRow("png");
    const sizeF = field("Size", size), scaleF = field("Scale", scale);
    const stat = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [field("Size by", mode), sizeF, scaleF, sets.label]), el("div", { class: "row" }, [field("Background", bgMode), field("Colour", bg)]), stat, fq.row);
    const describe = async () => {
      sizeF.hidden = mode.value === "scale"; scaleF.hidden = mode.value !== "scale";
      try { const s = svgSize(await files[0].text()); const t0 = targetSize(s, this.opts()); stat.textContent = t("{name}: {w} × {h} → {tw} × {th} px", { name: files[0].name, w: Math.round(s.w), h: Math.round(s.h), tw: t0.w, th: t0.h }); } catch (err) { stat.textContent = err.message; }
    };
    this.opts = () => ({ mode: mode.value, size: Number(size.value) || 1024, scale: Number(scale.value) || 1, sets: sets.input.checked, bg: bgMode.value === "colour" ? bg.value : null });
    this.fq = fq;
    for (const i of [mode, size, scale]) { i.addEventListener("input", describe); i.addEventListener("change", describe); }
    describe();
  },
  async run(files, _root, progress) {
    const v = this.opts(), out = [];
    const mime = this.fq.format === "keep" ? "image/png" : MIME[this.fq.format];
    for (const file of files) {
      await progress?.tick(file.name);
      const text = await file.text();
      const s = svgSize(text);
      const base = targetSize(s, v);
      for (const k of v.sets ? [1, 2, 3] : [1]) {
        const w = base.w * k, h = base.h * k;
        let c = await rasterizeSvg(text, w, h);
        if (v.bg) { const f = makeCanvas(w, h); const ctx = f.getContext("2d"); ctx.fillStyle = v.bg; ctx.fillRect(0, 0, w, h); ctx.drawImage(c, 0, 0); c = f; }
        out.push({ name: `${baseName(file.name)}${k > 1 ? `@${k}x` : ""}.${EXT[mime]}`, blob: await encode(c, mime, this.fq.quality / 100), note: `${w} × ${h}` });
      }
    }
    return out;
  },
};
function targetSize(s, v) {
  const ratio = s.w / s.h;
  if (v.mode === "height") return { w: Math.max(1, Math.round(v.size * ratio)), h: Math.max(1, Math.round(v.size)) };
  if (v.mode === "scale") return { w: Math.max(1, Math.round(s.w * v.scale)), h: Math.max(1, Math.round(s.h * v.scale)) };
  return { w: Math.max(1, Math.round(v.size)), h: Math.max(1, Math.round(v.size / ratio)) };
}

export const imageTools = [cropTool, resizeTool, rotateTool, compressTool, convertTool, svgTool, heicTool, adjustTool, frameTool, collageTool, splitImageTool, compareTool, watermarkTool, redactTool, metadataTool, paletteTool, faviconTool, qrTool];
