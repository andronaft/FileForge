// Photo tools built on the image engine: annotate a screenshot, ID / passport photos, and document photo → scan.
import { el, baseName, field, select, number, checkbox, formatBytes, plural, toast, t } from "../util.js";
import { loadImage, makeCanvas, dims, encode, formatQualityRow, formatOf, outName, MIME } from "./image.js";

const { PDFDocument } = PDFLib;

/** Fit a w × h image into the editor: at most 860 px wide (or the panel width) and 560 px tall. */
function stageScale(root, w, h, maxH = 560) {
  const avail = root.clientWidth > 200 ? root.clientWidth - 32 : 860; // 0 while the page is laid out off-screen
  return Math.max(0.01, Math.min(1, Math.min(860, avail) / w, maxH / h));
}

/** Pointer position on `canvas` in source-image pixels. */
function pointerToSrc(canvas, e, scale) {
  const r = canvas.getBoundingClientRect();
  const k = canvas.width / r.width / scale;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
}

const toBlob = (canvas, mime, quality) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), mime, quality));

// ---------- annotate ----------

const ANNOT_COLOURS = ["#e53935", "#ff8c28", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#111111", "#ffffff"];
const ANNOT_TOOLS = [
  ["arrow", "Arrow", "→"], ["rect", "Box", "▭"], ["ellipse", "Circle", "◯"], ["highlight", "Highlight", "▮"],
  ["pen", "Pen", "✎"], ["text", "Text", "T"], ["step", "Numbers", "①"],
];

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** Draw annotation items (in source pixels) onto ctx, scaled by k. */
function drawAnnotations(ctx, items, k) {
  for (const it of items) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = it.color;
    ctx.lineWidth = it.width * k;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const halo = luminance(it.color) > 0.6 ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.85)";
    if (it.type === "arrow") {
      const x1 = it.x1 * k, y1 = it.y1 * k, x2 = it.x2 * k, y2 = it.y2 * k;
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) { ctx.restore(); continue; }
      const head = Math.min(len * 0.6, Math.max(10 * k, it.width * k * 4.5));
      const a = Math.atan2(y2 - y1, x2 - x1);
      const bx = x2 - Math.cos(a) * head * 0.8, by = y2 - Math.sin(a) * head * 0.8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(bx, by); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(a - 0.45) * head, y2 - Math.sin(a - 0.45) * head);
      ctx.lineTo(x2 - Math.cos(a + 0.45) * head, y2 - Math.sin(a + 0.45) * head);
      ctx.closePath(); ctx.fill();
    } else if (it.type === "rect") {
      ctx.strokeRect(it.x * k, it.y * k, it.w * k, it.h * k);
    } else if (it.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse((it.x + it.w / 2) * k, (it.y + it.h / 2) * k, Math.max(1, (it.w / 2) * k), Math.max(1, (it.h / 2) * k), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (it.type === "highlight") {
      ctx.globalAlpha = 0.38;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillRect(it.x * k, it.y * k, it.w * k, it.h * k);
    } else if (it.type === "pen") {
      ctx.beginPath();
      it.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
      if (it.pts.length === 1) ctx.lineTo(it.pts[0].x * k + 0.1, it.pts[0].y * k);
      ctx.stroke();
    } else if (it.type === "text") {
      const size = it.size * k;
      ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(1, size * 0.16);
      ctx.strokeStyle = halo;
      it.text.split("\n").forEach((line, i) => {
        ctx.strokeText(line, it.x * k, it.y * k + i * size * 1.2);
        ctx.fillText(line, it.x * k, it.y * k + i * size * 1.2);
      });
    } else if (it.type === "step") {
      const r = it.r * k;
      ctx.beginPath(); ctx.arc(it.x * k, it.y * k, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.14); ctx.strokeStyle = halo; ctx.stroke();
      ctx.fillStyle = luminance(it.color) > 0.6 ? "#111" : "#fff";
      ctx.font = `700 ${r * 1.15}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(it.n), it.x * k, it.y * k + r * 0.06);
    }
    ctx.restore();
  }
}

const annotateTool = {
  id: "annotate",
  title: "Annotate screenshot",
  description: "Arrows, boxes, circles, highlighter, pen, text and numbered steps on a screenshot or photo, for bug reports, instructions and support replies. Paste a screenshot with Ctrl+V.",
  keywords: ["markup", "arrow", "draw", "screenshot", "highlight", "callout", "label", "number", "annotate", "pen"],
  accept: "image/*",
  multiple: false,
  hint: "A screenshot or photo; paste one from the clipboard with Ctrl+V",
  runLabel: "Save image",
  renderOptions(root, files) {
    const file = files[0];
    const st = this.state?.file === file ? this.state : { file, items: [], redo: [], img: null, w: 0, h: 0, scale: 1 };
    this.state = st;
    let tool = this.lastTool || "arrow", colour = this.lastColour || ANNOT_COLOURS[0];
    const size = select([["s", "Thin"], ["m", "Medium"], ["l", "Thick"]], "m");
    const toolBtns = ANNOT_TOOLS.map(([id, label, glyph]) => el("button", { type: "button", class: `chip-btn${id === tool ? " on" : ""}`, title: label, "aria-pressed": id === tool ? "true" : "false", onclick: () => { tool = id; this.lastTool = id; paintButtons(); } }, [el("span", { class: "glyph", text: glyph }), label]));
    const custom = el("input", { type: "color", value: colour, title: "Custom colour", oninput: () => { colour = custom.value; this.lastColour = colour; paintButtons(); } });
    const swatches = ANNOT_COLOURS.map((c) => el("button", { type: "button", class: "dot", title: c, "aria-label": c, style: `background:${c}`, onclick: () => { colour = c; this.lastColour = c; custom.value = c; paintButtons(); } }));
    const paintButtons = () => {
      toolBtns.forEach((b, i) => { const on = ANNOT_TOOLS[i][0] === tool; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
      swatches.forEach((b, i) => b.classList.toggle("on", ANNOT_COLOURS[i] === colour));
      canvas.style.cursor = tool === "text" ? "text" : "crosshair";
    };
    const undoBtn = el("button", { type: "button", text: "Undo", title: "Undo (Ctrl+Z)", onclick: () => undo() });
    const redoBtn = el("button", { type: "button", text: "Redo", title: "Redo (Ctrl+Shift+Z)", onclick: () => redo() });
    const clearBtn = el("button", { type: "button", text: "Clear all", onclick: () => { if (!st.items.length) return; st.redo = [...st.items].reverse(); st.items = []; draw(); } });
    const canvas = el("canvas");
    const stage = el("div", { class: "crop-stage annot-stage" }, [canvas]);
    const info = el("div", { class: "stat", text: "Loading…" });
    const fq = formatQualityRow("keep");
    this.fq = fq;
    root.append(
      el("div", { class: "annot-bar" }, [el("div", { class: "chip-row" }, toolBtns), el("div", { class: "chip-row" }, [...swatches, custom, field("Line", size)])]),
      stage,
      el("div", { class: "actions" }, [undoBtn, redoBtn, clearBtn, info]),
      fq.row,
    );
    paintButtons();

    const unit = () => Math.max(3, Math.round(Math.max(st.w, st.h) / 280));
    const width = () => unit() * ({ s: 0.6, m: 1, l: 1.8 }[size.value] || 1);
    const draw = (live) => {
      if (!st.img) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
      drawAnnotations(ctx, live ? [...st.items, live] : st.items, st.scale);
      undoBtn.disabled = !st.items.length; redoBtn.disabled = !st.redo.length; clearBtn.disabled = !st.items.length;
      info.textContent = st.items.length ? plural(st.items.length, "mark") : t("{w} × {h} px · pick a tool and draw on the image", { w: st.w, h: st.h });
    };
    const push = (item) => { st.items.push(item); st.redo = []; draw(); };
    const undo = () => { if (st.items.length) { st.redo.push(st.items.pop()); draw(); } };
    const redo = () => { if (st.redo.length) { st.items.push(st.redo.pop()); draw(); } };
    size.addEventListener("change", () => draw());

    (async () => {
      st.img ??= await loadImage(file);
      const d = dims(st.img); st.w = d.w; st.h = d.h;
      st.scale = stageScale(root, d.w, d.h, 620);
      canvas.width = Math.round(d.w * st.scale); canvas.height = Math.round(d.h * st.scale);
      draw();
    })().catch((err) => toast(err.message, "error"));

    // Text: an input floats over the image where you clicked; Enter or clicking elsewhere places it.
    let editor = null;
    const openText = (p) => {
      closeText(true);
      const r = canvas.getBoundingClientRect(), css = r.width / canvas.width * st.scale;
      const fontPx = width() * 7;
      editor = el("input", { type: "text", class: "annot-input", placeholder: "Type, then Enter", style: `left:${p.x * css}px;top:${p.y * css}px;font-size:${Math.max(12, fontPx * css)}px;color:${colour}` });
      editor.dataset.x = p.x; editor.dataset.y = p.y; editor.dataset.size = fontPx; editor.dataset.colour = colour;
      editor.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); closeText(true); }
        if (e.key === "Escape") { e.preventDefault(); closeText(false); }
      });
      editor.addEventListener("blur", () => closeText(true));
      stage.append(editor);
      setTimeout(() => editor?.focus(), 0);
    };
    const closeText = (commit) => {
      const ed = editor; if (!ed) return;
      editor = null;
      const text = ed.value.trim();
      ed.remove();
      if (commit && text) push({ type: "text", text, x: Number(ed.dataset.x), y: Number(ed.dataset.y), size: Number(ed.dataset.size), color: ed.dataset.colour, width: 1 });
    };

    let live = null, start = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (!st.img) return;
      const p = pointerToSrc(canvas, e, st.scale);
      if (tool === "text") { e.preventDefault(); openText(p); return; }
      if (tool === "step") {
        const n = st.items.filter((x) => x.type === "step").length + 1;
        push({ type: "step", x: p.x, y: p.y, n, r: width() * 4.2, color: colour, width: 1 });
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      start = p;
      live = tool === "pen" ? { type: "pen", pts: [p], color: colour, width: width() }
        : tool === "arrow" ? { type: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: colour, width: width() }
        : { type: tool, x: p.x, y: p.y, w: 0, h: 0, color: colour, width: width() };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!live) return;
      const p = pointerToSrc(canvas, e, st.scale);
      if (live.type === "pen") live.pts.push(p);
      else if (live.type === "arrow") { live.x2 = p.x; live.y2 = p.y; }
      else {
        let w = p.x - start.x, h = p.y - start.y;
        if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        live.x = Math.min(start.x, start.x + w); live.y = Math.min(start.y, start.y + h); live.w = Math.abs(w); live.h = Math.abs(h);
      }
      draw(live);
    });
    const end = () => {
      if (!live) return;
      const it = live; live = null;
      const big = it.type === "pen" ? it.pts.length > 1 : it.type === "arrow" ? Math.hypot(it.x2 - it.x1, it.y2 - it.y1) > 4 / st.scale : it.w > 3 / st.scale && it.h > 3 / st.scale;
      if (big) push(it); else draw();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", () => { live = null; draw(); });
    const onKey = (e) => {
      if (!root.isConnected) { document.removeEventListener("keydown", onKey); return; }
      if (editor || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    document.addEventListener("keydown", onKey);
  },
  async run(files) {
    const st = this.state;
    if (!st?.items.length) throw new Error("Draw at least one mark on the image");
    const img = await loadImage(files[0]);
    const d = dims(img);
    const c = makeCanvas(d.w, d.h);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (img.close) img.close();
    drawAnnotations(ctx, st.items, 1);
    const mime = this.fq.format === "keep" ? (formatOf(files[0]) || "image/png") : MIME[this.fq.format];
    const blob = await encode(c, mime, this.fq.quality / 100);
    return [{ name: outName(files[0], mime, "annotated"), blob, note: plural(st.items.length, "mark") }];
  },
};

// ---------- ID / passport photo ----------

const MM_PER_IN = 25.4;
// Head guides as a share of the photo height: where the top of the head (crown) and the chin should sit.
const ID_PRESETS = [
  { id: "35x45", label: "35 × 45 mm: passport, Schengen and UK visa, most of Europe", w: 35, h: 45, crown: 0.09, chin: 0.85 },
  { id: "30x40", label: "30 × 40 mm (3 × 4): Ukrainian documents, student and work IDs", w: 30, h: 40, crown: 0.1, chin: 0.82 },
  { id: "us", label: "2 × 2 in (51 × 51 mm): US passport and visa, India", tag: "2x2in", shown: "2 × 2 in", w: 50.8, h: 50.8, crown: 0.12, chin: 0.74 },
  { id: "33x48", label: "33 × 48 mm: China visa", w: 33, h: 48, crown: 0.08, chin: 0.8 },
  { id: "40x60", label: "40 × 60 mm", w: 40, h: 60, crown: 0.12, chin: 0.72 },
  { id: "50x70", label: "50 × 70 mm: Canada passport", w: 50, h: 70, crown: 0.16, chin: 0.66 },
  { id: "custom", label: "Custom size", w: 35, h: 45, crown: 0.1, chin: 0.82 },
];
const SHEETS = { single: null, "10x15": { w: 102, h: 152, label: "10 × 15" }, a4: { w: 210, h: 297, label: "A4" } };

/** How many w × h photos fit on a sheet (either orientation), with a margin and a gap, in mm. */
function sheetLayout(sheet, w, h, margin = 4, gap = 2) {
  const fit = (W, H) => ({ W, H, cols: Math.max(0, Math.floor((W - 2 * margin + gap) / (w + gap))), rows: Math.max(0, Math.floor((H - 2 * margin + gap) / (h + gap))) });
  const a = fit(sheet.w, sheet.h), b = fit(sheet.h, sheet.w);
  return a.cols * a.rows >= b.cols * b.rows ? a : b;
}

const idPhotoTool = {
  id: "id-photo",
  title: "ID & passport photo",
  description: "Crop a portrait to an exact document size (35 × 45, 3 × 4, 2 × 2 in and more) with head-position guides, then save one photo or a print sheet for 10 × 15 photo paper or A4.",
  keywords: ["passport", "visa", "id photo", "3x4", "35x45", "2x2", "document photo", "print sheet", "фото на документи"],
  accept: "image/*",
  multiple: false,
  hint: "A portrait photo against a plain light background",
  runLabel: "Make photo",
  renderOptions(root, files) {
    const file = files[0];
    const st = this.state?.file === file ? this.state : { file, img: null, w: 0, h: 0, scale: 1, frame: null };
    this.state = st;
    const preset = select(ID_PRESETS.map((p) => [p.id, p.label]), "35x45");
    const cw = number(35, { min: 10, max: 200, step: "0.5" }), ch = number(45, { min: 10, max: 200, step: "0.5" });
    const customRow = el("div", { class: "row" }, [field("Width (mm)", cw), field("Height (mm)", ch)]);
    const sheet = select([["10x15", "Print sheet 10 × 15 cm (photo paper, JPEG)"], ["a4", "Print sheet A4 (PDF)"], ["single", "One photo (JPEG)"]], "10x15");
    const dpi = select([["300", "300 dpi"], ["600", "600 dpi"]], "300");
    const cut = checkbox("Thin cut lines", true);
    const canvas = el("canvas");
    const stage = el("div", { class: "crop-stage" }, [canvas]);
    const info = el("div", { class: "stat" });
    root.append(
      el("div", { class: "row" }, [field("Photo size", preset)]), customRow,
      stage,
      el("div", { class: "stat", text: "Drag the frame to move it, drag a corner to resize. Fit the top of the head and the chin between the two dashed lines." }),
      el("div", { class: "row" }, [field("Output", sheet), field("Resolution", dpi), cut.label]),
      info,
    );
    this.opts = { preset, cw, ch, sheet, dpi, cut };

    const spec = () => {
      const p = ID_PRESETS.find((x) => x.id === preset.value) || ID_PRESETS[0];
      return p.id === "custom" ? { ...p, w: Math.max(10, Number(cw.value) || 35), h: Math.max(10, Number(ch.value) || 45) } : p;
    };
    this.spec = spec;
    const ratio = () => spec().w / spec().h;
    const fitFrame = (keepCentre) => {
      const r = ratio();
      const f = st.frame;
      let h = keepCentre && f ? f.h : st.h * 0.85, w = h * r;
      if (w > st.w) { w = st.w; h = w / r; }
      if (h > st.h) { h = st.h; w = h * r; }
      const cx = keepCentre && f ? f.x + f.w / 2 : st.w / 2, cy = keepCentre && f ? f.y + f.h / 2 : st.h / 2;
      st.frame = clamp({ x: cx - w / 2, y: cy - h / 2, w, h });
    };
    const clamp = (f) => ({ ...f, x: Math.max(0, Math.min(f.x, st.w - f.w)), y: Math.max(0, Math.min(f.y, st.h - f.h)) });
    const describe = () => {
      const s = spec(), out = sheet.value;
      const px = Math.round(s.w / MM_PER_IN * Number(dpi.value));
      const srcPx = st.frame ? Math.round(st.frame.w) : 0;
      let text = s.shown || t("{w} × {h} mm", { w: s.w, h: s.h });
      if (out !== "single") { const l = sheetLayout(SHEETS[out], s.w, s.h); text += " · " + t("{n} per {sheet} sheet", { n: l.cols * l.rows, sheet: SHEETS[out].label }); }
      if (srcPx && srcPx < px * 0.6) text += " · " + t("the photo is low resolution for this size, prints may look soft");
      info.textContent = text;
    };
    const draw = () => {
      if (!st.img) return;
      const k = st.scale, ctx = canvas.getContext("2d"), f = st.frame, s = spec();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(f.x * k, f.y * k, f.w * k, f.h * k); ctx.fill("evenodd");
      ctx.strokeStyle = "#ff8c28"; ctx.lineWidth = 2; ctx.strokeRect(f.x * k, f.y * k, f.w * k, f.h * k);
      // head guides: crown and chin lines, a face oval and the vertical centre line
      const top = (f.y + f.h * s.crown) * k, chin = (f.y + f.h * s.chin) * k, cx = (f.x + f.w / 2) * k;
      // each guide twice: a dark line under white dashes, so it shows on light and dark backgrounds alike
      const guides = () => {
        ctx.beginPath(); ctx.moveTo(f.x * k, top); ctx.lineTo((f.x + f.w) * k, top); ctx.moveTo(f.x * k, chin); ctx.lineTo((f.x + f.w) * k, chin);
        ctx.moveTo(cx, f.y * k); ctx.lineTo(cx, (f.y + f.h) * k);
        ctx.moveTo(cx + (chin - top) * 0.36, (top + chin) / 2);
        ctx.ellipse(cx, (top + chin) / 2, (chin - top) * 0.36, (chin - top) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      };
      ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(0,0,0,.45)"; guides();
      ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; guides();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff8c28";
      for (const [hx, hy] of corners(f)) ctx.fillRect(hx * k - 5, hy * k - 5, 10, 10);
      describe();
    };
    const corners = (f) => [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]];
    const sync = () => { customRow.hidden = preset.value !== "custom"; if (st.img) { fitFrame(true); draw(); } };
    preset.addEventListener("change", sync); cw.addEventListener("input", sync); ch.addEventListener("input", sync);
    sheet.addEventListener("change", () => draw()); dpi.addEventListener("change", () => draw());
    customRow.hidden = true;

    (async () => {
      st.img ??= await loadImage(file);
      const d = dims(st.img); st.w = d.w; st.h = d.h;
      st.scale = stageScale(root, d.w, d.h);
      canvas.width = Math.round(d.w * st.scale); canvas.height = Math.round(d.h * st.scale);
      customRow.hidden = preset.value !== "custom";
      if (!st.frame) fitFrame(false); else fitFrame(true);
      draw();
    })().catch((err) => toast(err.message, "error"));

    let mode = null, start = null, orig = null, corner = -1;
    canvas.addEventListener("pointerdown", (e) => {
      if (!st.img) return;
      canvas.setPointerCapture(e.pointerId);
      const p = pointerToSrc(canvas, e, st.scale), tol = 14 / st.scale, f = st.frame;
      start = p; orig = { ...f };
      corner = corners(f).findIndex(([hx, hy]) => Math.abs(hx - p.x) < tol && Math.abs(hy - p.y) < tol);
      mode = corner >= 0 ? "resize" : "move";
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!mode) return;
      const p = pointerToSrc(canvas, e, st.scale), r = ratio();
      if (mode === "move") st.frame = clamp({ ...orig, x: orig.x + p.x - start.x, y: orig.y + p.y - start.y });
      else {
        // resize around the opposite corner, keeping the document's aspect ratio
        const ax = corner % 2 === 0 ? orig.x + orig.w : orig.x, ay = corner < 2 ? orig.y + orig.h : orig.y;
        let h = Math.max(20, Math.abs(p.y - ay), Math.abs(p.x - ax) / r), w = h * r;
        const maxW = corner % 2 === 0 ? ax : st.w - ax, maxH = corner < 2 ? ay : st.h - ay;
        if (w > maxW) { w = maxW; h = w / r; }
        if (h > maxH) { h = maxH; w = h * r; }
        st.frame = { x: corner % 2 === 0 ? ax - w : ax, y: corner < 2 ? ay - h : ay, w, h };
      }
      draw();
    });
    const end = () => { mode = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  },
  async run(files) {
    const st = this.state, o = this.opts;
    if (!st?.frame) throw new Error("Preview is not ready yet");
    const s = this.spec(), dpi = Number(o.dpi.value) || 300;
    const pxW = Math.round(s.w / MM_PER_IN * dpi), pxH = Math.round(s.h / MM_PER_IN * dpi);
    const img = await loadImage(files[0]);
    const photo = makeCanvas(pxW, pxH);
    const g = photo.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.fillStyle = "#fff"; g.fillRect(0, 0, pxW, pxH);
    g.drawImage(img, st.frame.x, st.frame.y, st.frame.w, st.frame.h, 0, 0, pxW, pxH);
    if (img.close) img.close();
    const size = s.tag || `${String(s.w).replace(".", "_")}x${String(s.h).replace(".", "_")}mm`;
    const base = baseName(files[0].name);
    if (o.sheet.value === "single") {
      const blob = await toBlob(photo, "image/jpeg", 0.95);
      return [{ name: `${base}-${size}.jpg`, blob, note: `${pxW} × ${pxH} px · ${dpi} dpi` }];
    }
    const sheetSpec = SHEETS[o.sheet.value], l = sheetLayout(sheetSpec, s.w, s.h);
    const n = l.cols * l.rows;
    if (!n) throw new Error("This photo size does not fit on that sheet");
    const gap = 2, gridW = l.cols * s.w + (l.cols - 1) * gap, gridH = l.rows * s.h + (l.rows - 1) * gap;
    const ox = (l.W - gridW) / 2, oy = (l.H - gridH) / 2;
    const cells = [];
    for (let r = 0; r < l.rows; r++) for (let c = 0; c < l.cols; c++) cells.push({ x: ox + c * (s.w + gap), y: oy + r * (s.h + gap) });
    const note = t("{n} photos · {w} × {h} mm · {dpi} dpi", { n, w: s.w, h: s.h, dpi });
    if (o.sheet.value === "a4") {
      const pt = (mm) => mm / MM_PER_IN * 72;
      const doc = await PDFDocument.create();
      const page = doc.addPage([pt(l.W), pt(l.H)]);
      const jpg = await doc.embedJpg(await (await toBlob(photo, "image/jpeg", 0.95)).arrayBuffer());
      for (const cell of cells) {
        page.drawImage(jpg, { x: pt(cell.x), y: pt(l.H - cell.y - s.h), width: pt(s.w), height: pt(s.h) });
        if (o.cut.input.checked) page.drawRectangle({ x: pt(cell.x), y: pt(l.H - cell.y - s.h), width: pt(s.w), height: pt(s.h), borderColor: PDFLib.rgb(0.75, 0.75, 0.75), borderWidth: 0.3 });
      }
      return [{ name: `${base}-${size}-A4.pdf`, blob: new Blob([await doc.save()], { type: "application/pdf" }), note }];
    }
    const px = (mm) => Math.round(mm / MM_PER_IN * dpi);
    const out = makeCanvas(px(l.W), px(l.H));
    const og = out.getContext("2d");
    og.fillStyle = "#fff"; og.fillRect(0, 0, out.width, out.height);
    for (const cell of cells) {
      og.drawImage(photo, px(cell.x), px(cell.y), pxW, pxH);
      if (o.cut.input.checked) { og.strokeStyle = "#c0c0c0"; og.lineWidth = Math.max(1, dpi / 300); og.strokeRect(px(cell.x) - 0.5, px(cell.y) - 0.5, pxW + 1, pxH + 1); }
    }
    const blob = await toBlob(out, "image/jpeg", 0.95);
    return [{ name: `${base}-${size}-10x15.jpg`, blob, note }];
  },
};

// ---------- document photo → scan ----------

/** 3 × 3 homography (row-major, h33 = 1) that maps the four points `from` onto `to`. */
function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) throw new Error("The four corners must not be in a line");
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const h = new Array(8);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * h[k];
    h[r] = s / A[r][r];
  }
  return [...h, 1];
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Find the sheet of paper in a photo: the largest bright region, its corners taken as the extreme points. */
function detectCorners(src, w, h) {
  const k = Math.min(1, 360 / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * k)), sh = Math.max(8, Math.round(h * k));
  const c = makeCanvas(sw, sh);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.filter = "blur(2px)";
  g.drawImage(src, 0, 0, sw, sh);
  const px = g.getImageData(0, 0, sw, sh).data;
  const L = new Uint8Array(sw * sh), hist = new Array(256).fill(0);
  for (let i = 0; i < L.length; i++) { const v = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8; L[i] = v; hist[v]++; }
  // Otsu threshold
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = L.length - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  // largest 4-connected bright component
  const seen = new Uint8Array(L.length);
  let bestComp = null;
  const stack = new Int32Array(L.length);
  for (let i = 0; i < L.length; i++) {
    if (seen[i] || L[i] <= thr) continue;
    let top = 0, n = 0;
    const ext = { tl: [i, Infinity], tr: [i, -Infinity], bl: [i, Infinity], br: [i, -Infinity] };
    stack[top++] = i; seen[i] = 1;
    while (top) {
      const j = stack[--top]; n++;
      const x = j % sw, y = (j - x) / sw;
      if (x + y < ext.tl[1]) ext.tl = [j, x + y];
      if (x + y > ext.br[1]) ext.br = [j, x + y];
      if (x - y > ext.tr[1]) ext.tr = [j, x - y];
      if (x - y < ext.bl[1]) ext.bl = [j, x - y];
      if (x > 0 && !seen[j - 1] && L[j - 1] > thr) { seen[j - 1] = 1; stack[top++] = j - 1; }
      if (x < sw - 1 && !seen[j + 1] && L[j + 1] > thr) { seen[j + 1] = 1; stack[top++] = j + 1; }
      if (y > 0 && !seen[j - sw] && L[j - sw] > thr) { seen[j - sw] = 1; stack[top++] = j - sw; }
      if (y < sh - 1 && !seen[j + sw] && L[j + sw] > thr) { seen[j + sw] = 1; stack[top++] = j + sw; }
    }
    if (!bestComp || n > bestComp.n) bestComp = { n, ext };
  }
  const frac = bestComp ? bestComp.n / L.length : 0;
  if (!bestComp || frac < 0.12 || frac > 0.97) return null;
  const pt = ([j]) => ({ x: ((j % sw) + 0.5) / k, y: (Math.floor(j / sw) + 0.5) / k });
  const q = [pt(bestComp.ext.tl), pt(bestComp.ext.tr), pt(bestComp.ext.br), pt(bestComp.ext.bl)];
  // reject degenerate shapes (two corners on top of each other)
  for (let a = 0; a < 4; a++) for (let b2 = a + 1; b2 < 4; b2++) if (dist(q[a], q[b2]) < Math.max(w, h) * 0.08) return null;
  return q;
}

const insetCorners = (w, h, m = 0.04) => [{ x: w * m, y: h * m }, { x: w * (1 - m), y: h * m }, { x: w * (1 - m), y: h * (1 - m) }, { x: w * m, y: h * (1 - m) }];

/** Straighten the quad `q` (TL, TR, BR, BL in source px) of `src` into an outW × outH canvas, bilinear. */
function warp(srcData, sw, sh, q, outW, outH) {
  const H = homography([{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }], q);
  const out = new ImageData(outW, outH), o = out.data, s = srcData;
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = H[6] * u + H[7] * v + 1;
      let x = (H[0] * u + H[1] * v + H[2]) / den, y = (H[3] * u + H[4] * v + H[5]) / den;
      x = Math.max(0, Math.min(sw - 1.001, x)); y = Math.max(0, Math.min(sh - 1.001, y));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const oi = (v * outW + u) * 4;
      o[oi] = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
      o[oi + 1] = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
      o[oi + 2] = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
      o[oi + 3] = 255;
    }
  }
  return out;
}

/**
 * Even out lighting so the paper turns white: estimate the paper brightness on a coarse grid (a high percentile
 * per cell, smoothed) and divide it out. mode: colour | grey | bw.
 */
function enhance(img, mode) {
  const { width: W, height: H, data: d } = img;
  const cell = Math.max(16, Math.round(Math.max(W, H) / 60));
  const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
  const hist = new Uint32Array(gw * gh * 32), count = new Uint32Array(gw * gh);
  const Y = new Uint8Array(W * H);
  const colCell = new Int32Array(W);
  for (let x = 0; x < W; x++) colCell[x] = (x / cell) | 0;
  for (let y = 0; y < H; y++) {
    const rowCell = ((y / cell) | 0) * gw;
    for (let x = 0, i = y * W, p = i * 4; x < W; x++, i++, p += 4) {
      const v = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
      Y[i] = v;
      const g = rowCell + colCell[x];
      hist[(g << 5) + (v >> 3)]++; count[g]++;
    }
  }
  let bg = new Float32Array(gw * gh);
  for (let g = 0; g < bg.length; g++) {
    const target = count[g] * 0.9;
    let acc = 0, b = 0;
    for (; b < 32; b++) { acc += hist[g * 32 + b]; if (acc >= target) break; }
    bg[g] = Math.max(40, b * 8 + 4);
  }
  for (let pass = 0; pass < 2; pass++) {
    const nb = new Float32Array(bg.length);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x >= 0 && y >= 0 && x < gw && y < gh) { s += bg[y * gw + x]; n++; }
      }
      nb[gy * gw + gx] = s / n;
    }
    bg = nb;
  }
  // Per-column interpolation weights once; per row, the background is a blend of two grid rows.
  const cx0 = new Int32Array(W), cx1 = new Int32Array(W), cax = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const fx = Math.max(0, Math.min(gw - 1, x / cell - 0.5));
    cx0[x] = fx | 0; cx1[x] = Math.min(gw - 1, cx0[x] + 1); cax[x] = fx - cx0[x];
  }
  // Tone curve as a lookup table over the gained value (0..1023): a gentle S-curve, clamped to 255.
  const LUT = new Uint8ClampedArray(1024);
  for (let i = 0; i < 1024; i++) {
    const n = Math.min(1, i / 255);
    LUT[i] = 255 * (n < 0.5 ? 2 * n * n : 1 - 2 * (1 - n) * (1 - n)) * 0.35 + i * 0.65;
  }
  const rowBg = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const fy = Math.max(0, Math.min(gh - 1, y / cell - 0.5)), y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ay = fy - y0;
    const r0 = y0 * gw, r1 = y1 * gw;
    for (let x = 0; x < W; x++) {
      const a = cax[x];
      rowBg[x] = (bg[r0 + cx0[x]] * (1 - a) + bg[r0 + cx1[x]] * a) * (1 - ay) + (bg[r1 + cx0[x]] * (1 - a) + bg[r1 + cx1[x]] * a) * ay;
    }
    let i = y * W, p = i * 4;
    if (mode === "bw") {
      for (let x = 0; x < W; x++, i++, p += 4) { const v = Y[i] < rowBg[x] * 0.78 ? 0 : 255; d[p] = d[p + 1] = d[p + 2] = v; }
    } else if (mode === "grey") {
      for (let x = 0; x < W; x++, i++, p += 4) { const gain = Math.min(3, 245 / rowBg[x]); const v = LUT[Math.min(1023, (Y[i] * gain) | 0)]; d[p] = d[p + 1] = d[p + 2] = v; }
    } else {
      for (let x = 0; x < W; x++, p += 4) {
        const gain = Math.min(3, 245 / rowBg[x]);
        d[p] = LUT[Math.min(1023, (d[p] * gain) | 0)]; d[p + 1] = LUT[Math.min(1023, (d[p + 1] * gain) | 0)]; d[p + 2] = LUT[Math.min(1023, (d[p + 2] * gain) | 0)];
      }
    }
  }
  return img;
}

const PAGE_SIZES = { a4: [210, 297], letter: [215.9, 279.4] };

const docScanTool = {
  id: "doc-scan",
  title: "Scan document photo",
  description: "Turn phone photos of paper into a clean scan: find the sheet's corners, straighten the perspective, make the paper white and the text sharp, and save all pages as one PDF.",
  keywords: ["scan", "scanner", "document", "receipt", "perspective", "deskew", "camscanner", "photo to pdf", "paper", "скан"],
  accept: "image/*",
  orderable: true,
  hint: "Photos of documents or receipts, one page per photo (HEIC from an iPhone works)",
  runLabel: "Make scan",
  pages: new WeakMap(),
  renderOptions(root, files) {
    this.files = files;
    let cur = Math.min(this.cur || 0, files.length - 1);
    const mode = select([["colour", "Colour, paper made white"], ["grey", "Greyscale"], ["bw", "Black & white (text, smallest file)"], ["original", "Original colours"]], "colour");
    const size = select([["a4", "A4"], ["letter", "Letter"], ["auto", "Same shape as the sheet"]], "a4");
    const output = select([["pdf", "One PDF with all pages"], ["jpeg", "JPEG per page"], ["png", "PNG per page"]], "pdf");
    const canvas = el("canvas");
    const stage = el("div", { class: "crop-stage" }, [canvas]);
    const pageLabel = el("span", { class: "stat" });
    const prev = el("button", { type: "button", class: "icon", text: "‹", title: "Previous page", onclick: () => show(cur - 1) });
    const next = el("button", { type: "button", class: "icon", text: "›", title: "Next page", onclick: () => show(cur + 1) });
    const auto = el("button", { type: "button", text: "Find edges", onclick: () => { const pg = page(files[cur]); if (pg.img) { pg.q = detectCorners(pg.img, pg.w, pg.h) || insetCorners(pg.w, pg.h); draw(); } } });
    const whole = el("button", { type: "button", text: "Whole photo", onclick: () => { const pg = page(files[cur]); if (pg.img) { pg.q = insetCorners(pg.w, pg.h, 0); draw(); } } });
    const rot = el("button", { type: "button", text: "Rotate ↻", title: "Rotate the result a quarter turn", onclick: () => { const pg = page(files[cur]); pg.rot = ((pg.rot || 0) + 90) % 360; draw(); } });
    const info = el("div", { class: "stat" });
    const preview = el("canvas", { class: "scan-preview" });
    root.append(
      el("div", { class: "actions" }, [prev, pageLabel, next, auto, whole, rot]),
      el("div", { class: "scan-grid" }, [stage, el("div", { class: "scan-side" }, [el("span", { class: "field-label", text: "Result preview" }), preview])]),
      el("div", { class: "stat", text: "Drag the orange corners onto the corners of the sheet." }),
      el("div", { class: "row" }, [field("Look", mode), field("Page size", size), field("Save as", output)]),
      info,
    );
    this.opts = { mode, size, output };

    const page = (f) => { if (!this.pages.has(f)) this.pages.set(f, { img: null, q: null, rot: 0 }); return this.pages.get(f); };
    let scale = 1, previewTimer = 0;
    const draw = () => {
      const pg = page(files[cur]);
      if (!pg.img) return;
      const ctx = canvas.getContext("2d"), q = pg.q;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(pg.img, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height);
      ctx.moveTo(q[0].x * scale, q[0].y * scale); for (const p of [q[3], q[2], q[1]]) ctx.lineTo(p.x * scale, p.y * scale); ctx.closePath();
      ctx.fill("evenodd");
      ctx.strokeStyle = "#ff8c28"; ctx.lineWidth = 2;
      ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale))); ctx.closePath(); ctx.stroke();
      for (const p of q) { ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, 9, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,140,40,.35)"; ctx.fill(); ctx.lineWidth = 2.5; ctx.stroke(); }
      pageLabel.textContent = t("Page {n} of {total}", { n: cur + 1, total: files.length });
      prev.disabled = cur === 0; next.disabled = cur >= files.length - 1;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(paintPreview, 120);
    };
    const paintPreview = async () => {
      const pg = page(files[cur]);
      if (!pg.img) return;
      const small = await this.render(pg, { mode: mode.value, size: size.value, maxLong: 520 });
      preview.width = small.width; preview.height = small.height;
      preview.getContext("2d").drawImage(small, 0, 0);
    };
    const load = async (f) => {
      const pg = page(f);
      if (!pg.img) {
        pg.img = await loadImage(f);
        const d = dims(pg.img); pg.w = d.w; pg.h = d.h;
        pg.q ??= detectCorners(pg.img, pg.w, pg.h) || insetCorners(pg.w, pg.h);
      }
      return pg;
    };
    this.load = load;
    const show = (i) => {
      cur = Math.max(0, Math.min(files.length - 1, i)); this.cur = cur;
      load(files[cur]).then((pg) => {
        scale = stageScale(root, pg.w, pg.h, 520) * (root.clientWidth > 700 ? 0.72 : 1);
        canvas.width = Math.round(pg.w * scale); canvas.height = Math.round(pg.h * scale);
        draw();
        const detected = files.filter((f) => this.pages.get(f)?.img).length;
        info.textContent = plural(files.length, "page");
        if (detected < files.length) load(files[Math.min(files.length - 1, cur + 1)]).catch(() => {});
      }).catch((err) => toast(err.message, "error"));
    };
    for (const s of [mode, size]) s.addEventListener("change", () => draw());
    show(cur);

    let drag = -1;
    canvas.addEventListener("pointerdown", (e) => {
      const pg = page(files[cur]); if (!pg.img) return;
      const p = pointerToSrc(canvas, e, scale), tol = 24 / scale;
      let best = -1, bd = Infinity;
      pg.q.forEach((c, i) => { const dd = dist(c, p); if (dd < bd) { bd = dd; best = i; } });
      if (bd > tol * 2.5) return;
      drag = best; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (drag < 0) return;
      const pg = page(files[cur]), p = pointerToSrc(canvas, e, scale);
      pg.q[drag] = { x: Math.max(0, Math.min(pg.w, p.x)), y: Math.max(0, Math.min(pg.h, p.y)) };
      draw();
    });
    const end = () => { drag = -1; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  },
  /** The straightened, cleaned page as a canvas. maxLong caps the long side (A4 at 300 dpi by default). */
  async render(pg, { mode, size, maxLong = 3508 }) {
    const q = pg.q;
    const wEst = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, hEst = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    let aspect = wEst / hEst; // width / height of the sheet as photographed
    if (size !== "auto") {
      const [a, b] = PAGE_SIZES[size];
      aspect = aspect >= 1 ? b / a : a / b;
    }
    const long = Math.min(maxLong, Math.max(wEst, hEst) * 1.1);
    let outW = Math.round(aspect >= 1 ? long : long * aspect), outH = Math.round(aspect >= 1 ? long / aspect : long);
    outW = Math.max(16, outW); outH = Math.max(16, outH);
    // sample from a copy of the source no bigger than needed
    const k = Math.min(1, (Math.max(outW, outH) * 1.3) / Math.max(wEst, hEst));
    const sw = Math.max(1, Math.round(pg.w * k)), sh = Math.max(1, Math.round(pg.h * k));
    const src = makeCanvas(sw, sh);
    const sg = src.getContext("2d", { willReadFrequently: true });
    sg.drawImage(pg.img, 0, 0, sw, sh);
    const data = sg.getImageData(0, 0, sw, sh).data;
    let img = warp(data, sw, sh, q.map((p) => ({ x: p.x * k, y: p.y * k })), outW, outH);
    if (mode !== "original") img = enhance(img, mode);
    let c = makeCanvas(outW, outH);
    c.getContext("2d").putImageData(img, 0, 0);
    if (pg.rot) {
      const r = makeCanvas(pg.rot % 180 ? outH : outW, pg.rot % 180 ? outW : outH);
      const g = r.getContext("2d");
      g.translate(r.width / 2, r.height / 2); g.rotate((pg.rot * Math.PI) / 180); g.drawImage(c, -outW / 2, -outH / 2);
      c = r;
    }
    return c;
  },
  async run(files, _root, progress) {
    const o = this.opts, mode = o.mode.value, size = o.size.value, out = o.output.value;
    progress?.start(files.length);
    const pages = [];
    for (const f of files) {
      await progress?.tick(f.name);
      const pg = await this.load(f);
      pages.push({ f, canvas: await this.render(pg, { mode, size }) });
    }
    if (out !== "pdf") {
      const mime = out === "png" ? "image/png" : "image/jpeg";
      return Promise.all(pages.map(async ({ f, canvas }) => {
        const blob = await toBlob(canvas, mime, 0.88);
        return { name: `${baseName(f.name)}-scan.${out === "png" ? "png" : "jpg"}`, blob, note: `${canvas.width} × ${canvas.height}` };
      }));
    }
    const doc = await PDFDocument.create();
    for (const { canvas } of pages) {
      const [mmW, mmH] = size === "auto" ? [canvas.width / 300 * MM_PER_IN, canvas.height / 300 * MM_PER_IN] : canvas.width > canvas.height ? [...PAGE_SIZES[size]].reverse() : PAGE_SIZES[size];
      const pt = (mm) => mm / MM_PER_IN * 72;
      const pageObj = doc.addPage([pt(mmW), pt(mmH)]);
      // black & white compresses far better as PNG; photos and colour as JPEG
      const bytes = await (await toBlob(canvas, mode === "bw" ? "image/png" : "image/jpeg", 0.82)).arrayBuffer();
      const image = mode === "bw" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      pageObj.drawImage(image, { x: 0, y: 0, width: pt(mmW), height: pt(mmH) });
    }
    const blob = new Blob([await doc.save()], { type: "application/pdf" });
    const name = files.length === 1 ? `${baseName(files[0].name)}-scan.pdf` : "scan.pdf";
    return [{ name, blob, note: `${plural(files.length, "page")} · ${formatBytes(blob.size)}` }];
  },
};

// ---------- transparent background ----------

/** The background colour of an image: the most common of its four corner colours. */
function cornerColour(d, w, h) {
  const at = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
  const cs = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)];
  let best = cs[0], score = -1;
  for (const c of cs) {
    const n = cs.filter((o) => Math.abs(o[0] - c[0]) + Math.abs(o[1] - c[1]) + Math.abs(o[2] - c[2]) < 40).length;
    if (n > score) { score = n; best = c; }
  }
  return best;
}

/**
 * Make the colour `bg` transparent in place. tol 1-100; `connected` removes only what touches the image edges
 * (so a white shirt on a white backdrop survives); `soften` fades the fringe and takes the background tint out
 * of half-transparent edge pixels. Returns how many pixels were cleared.
 */
function removeBackground(img, bg, tol, connected, soften) {
  const { width: w, height: h, data: d } = img;
  const T = (tol / 100) * 200, T2 = T * T, n = w * h;
  const [br, bgG, bb] = bg;
  const dist2 = (i) => { const p = i * 4, r = d[p] - br, g = d[p + 1] - bgG, b = d[p + 2] - bb; return r * r + g * g + b * b; };
  const gone = new Uint8Array(n);
  if (connected) {
    const stack = new Int32Array(n);
    let top = 0;
    const seed = (i) => { if (!gone[i] && dist2(i) <= T2) { gone[i] = 1; stack[top++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (top) {
      const i = stack[--top], x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
  } else for (let i = 0; i < n; i++) if (dist2(i) <= T2) gone[i] = 1;
  let cleared = 0;
  const soft = Math.max(24, T * 0.9), softEnd2 = (T + soft) * (T + soft);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (gone[i]) { d[p + 3] = 0; cleared++; continue; }
    if (!soften) continue;
    const x = i % w;
    const near = (x > 0 && gone[i - 1]) || (x < w - 1 && gone[i + 1]) || (i >= w && gone[i - w]) || (i < n - w && gone[i + w]);
    if (!near) continue;
    const d2 = dist2(i);
    if (d2 >= softEnd2) continue;
    // an anti-aliased edge pixel is a mix of the subject and the background: estimate the mix and undo it
    const a = Math.max(0.08, Math.min(1, (Math.sqrt(d2) - T) / soft));
    d[p] = Math.max(0, Math.min(255, (d[p] - (1 - a) * br) / a));
    d[p + 1] = Math.max(0, Math.min(255, (d[p + 1] - (1 - a) * bgG) / a));
    d[p + 2] = Math.max(0, Math.min(255, (d[p + 2] - (1 - a) * bb) / a));
    d[p + 3] = Math.round(d[p + 3] * a);
  }
  return cleared;
}

/** Crop a canvas to its non-transparent pixels. */
function trimTransparent(canvas) {
  const { width: w, height: h } = canvas, d = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return canvas;
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const unhex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

const transparentTool = {
  id: "transparent-bg",
  title: "Transparent background",
  description: "Make a plain background transparent: logos, signatures, stamps, icons and product shots on white or any single colour. Click the image to pick the colour to remove.",
  keywords: ["remove background", "background remover", "transparent png", "cut out", "white background", "logo", "signature", "alpha", "прозорий фон", "прибрати фон", "видалити фон", "убрать фон"],
  accept: "image/*",
  hint: "Images with a plain, single-colour background; several at once use the same settings",
  runLabel: "Remove background",
  renderOptions(root, files) {
    const colour = el("input", { type: "color", value: "#ffffff", "data-noremember": "" });
    const auto = checkbox("Detect the background colour from the corners of each image", true);
    const tol = el("input", { type: "range", min: 1, max: 100, value: 18 }), tolLabel = el("span", { class: "stat", text: "18" });
    const connected = checkbox("Only the background around the subject (keep the same colour inside it)", true);
    const soften = checkbox("Smooth edges", true), trim = checkbox("Trim empty margins", false);
    const format = select([["png", "PNG"], ["webp", "WebP"]], "png");
    const canvas = el("canvas", { class: "checker" });
    const stage = el("div", { class: "crop-stage" }, [canvas]);
    const info = el("div", { class: "stat", text: "Loading…" });
    root.append(
      el("div", { class: "row" }, [field("Colour to remove", colour), auto.label, field("Tolerance", el("div", { class: "row" }, [tol, tolLabel]))]),
      el("div", { class: "row" }, [connected.label, soften.label, trim.label, field("Output format", format)]),
      stage, info,
    );
    this.opts = { colour, auto, tol, connected, soften, trim, format };
    let src = null; // ImageData of the preview, untouched
    const paint = () => {
      if (!src) return;
      const img = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
      const bg = auto.input.checked ? cornerColour(src.data, src.width, src.height) : unhex(colour.value);
      if (auto.input.checked) colour.value = hex(bg);
      const cleared = removeBackground(img, bg, Number(tol.value), connected.input.checked, soften.input.checked);
      canvas.getContext("2d").putImageData(img, 0, 0);
      const pct = Math.round((cleared / (src.width * src.height)) * 100);
      info.textContent = t("{pct}% of the image becomes transparent · click the image to pick another colour", { pct }) + (files.length > 1 ? ` · ${t("preview of {name}", { name: files[0].name })}` : "");
    };
    tol.addEventListener("input", () => { tolLabel.textContent = tol.value; paint(); });
    colour.addEventListener("input", () => { auto.input.checked = false; paint(); });
    for (const c of [auto, connected, soften]) c.input.addEventListener("change", paint);
    canvas.addEventListener("click", (e) => {
      if (!src) return;
      const r = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(src.width - 1, Math.floor((e.clientX - r.left) * src.width / r.width))), y = Math.max(0, Math.min(src.height - 1, Math.floor((e.clientY - r.top) * src.height / r.height)));
      const i = (y * src.width + x) * 4;
      colour.value = hex([src.data[i], src.data[i + 1], src.data[i + 2]]);
      auto.input.checked = false;
      paint();
    });
    (async () => {
      const img = await loadImage(files[0]);
      const d = dims(img), k = Math.min(1, stageScale(root, d.w, d.h, 460));
      canvas.width = Math.max(1, Math.round(d.w * k)); canvas.height = Math.max(1, Math.round(d.h * k));
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (img.close) img.close();
      src = g.getImageData(0, 0, canvas.width, canvas.height);
      paint();
    })().catch((err) => toast(err.message, "error"));
  },
  async run(files, _root, progress) {
    const o = this.opts, out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const img = await loadImage(file);
      const d = dims(img);
      let c = makeCanvas(d.w, d.h);
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      if (img.close) img.close();
      const data = g.getImageData(0, 0, c.width, c.height);
      const bg = o.auto.input.checked ? cornerColour(data.data, c.width, c.height) : unhex(o.colour.value);
      const cleared = removeBackground(data, bg, Number(o.tol.value), o.connected.input.checked, o.soften.input.checked);
      g.putImageData(data, 0, 0);
      if (o.trim.input.checked) c = trimTransparent(c);
      const mime = o.format.value === "webp" ? "image/webp" : "image/png";
      const blob = await toBlob(c, mime, 0.95);
      out.push({ name: `${baseName(file.name)}-transparent.${o.format.value}`, blob, note: `${c.width} × ${c.height} · ${t("{pct}% transparent", { pct: Math.round((cleared / (d.w * d.h)) * 100) })}` });
    }
    return out;
  },
};

export const photoTools = [annotateTool, idPhotoTool, docScanTool, transparentTool];
