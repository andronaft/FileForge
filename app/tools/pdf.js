import { el, baseName, field, select, number, checkbox, parseRanges, formatBytes, plural, toast } from "../util.js";
import * as pdfjsLib from "../../vendor/pdf.min.mjs";
import { copyButton } from "./data.js";

const { PDFDocument, PDFDict, PDFName, degrees, PageSizes, StandardFonts, rgb } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdf.worker.min.mjs", import.meta.url).href;

/** Render pages of a PDF file with pdf.js. Calls onPage(canvas, pageNumber, widthPt, heightPt). */
async function renderPages(file, scale, indices, onPage, progress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const pages = indices || Array.from({ length: doc.numPages }, (_, i) => i);
    progress?.start(pages.length);
    for (const i of pages) {
      await progress?.tick(`page ${i + 1}`);
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      // "print" intent renders through promises rather than requestAnimationFrame, so it also works in background tabs.
      await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
      await onPage(canvas, i + 1, base.width, base.height);
      page.cleanup();
    }
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

// ---------- page thumbnails ----------

let openDocs = [];
async function openDoc(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  openDocs.push(doc);
  return doc;
}
/** Frees the pdf.js documents behind thumbnails of a previous render. */
function closeDocs() {
  for (const d of openDocs) d.destroy().catch(() => {});
  openDocs = [];
}

async function renderThumb(doc, pageIndex, width) {
  const page = await doc.getPage(pageIndex + 1);
  const scale = width / page.getViewport({ scale: 1 }).width;
  const vp = page.getViewport({ scale });
  const c = document.createElement("canvas");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
  page.cleanup();
  return c;
}

/** First page of a PDF as a canvas no larger than `size` px (for the file list). */
export async function pdfThumbnail(file, size) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const c = await renderThumb(doc, 0, Math.round(size * Math.min(1, vp1.width / vp1.height)));
    return c;
  } finally { await doc.destroy(); }
}

/** Page tiles for `indices`: the first screenful renders right away, the rest as they scroll into view. */
function pageTiles(doc, grid, indices, width = 104) {
  const EAGER = 24;
  const paint = (t) => { const i = Number(t.dataset.page); renderThumb(doc, i, width).then((c) => { t.querySelector(".ph")?.replaceWith(c); }).catch(() => {}); };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) { if (!e.isIntersecting) continue; io.unobserve(e.target); paint(e.target); }
  }, { root: grid, rootMargin: "240px" });
  const tiles = indices.map((i, k) => {
    const t = el("button", { type: "button", class: "page", "data-page": String(i), title: `Page ${i + 1}` }, [el("div", { class: "ph" }), el("span", { class: "page-n", text: String(i + 1) })]);
    if (k < EAGER) paint(t); else io.observe(t);
    return t;
  });
  grid.append(...tiles);
  return tiles;
}

/** "1-3, 5" for a set of 0-based page indices. */
function rangesText(set, total) {
  const idx = [...set].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
  const parts = [];
  for (let k = 0; k < idx.length; k++) {
    let end = k;
    while (end + 1 < idx.length && idx[end + 1] === idx[end] + 1) end++;
    parts.push(end > k ? `${idx[k] + 1}-${idx[end] + 1}` : String(idx[k] + 1));
    k = end;
  }
  return parts.join(", ");
}

/**
 * Clickable page thumbnails kept in sync with a "1-3, 5" text input: click toggles a page, shift-click selects a
 * range, typing in the input updates the tiles.
 */
async function pagePicker(root, file, input) {
  const grid = el("div", { class: "pages", role: "group", "aria-label": "Pages" });
  const hint = el("div", { class: "stat", text: "Loading pages…" });
  root.append(hint, grid);
  let doc;
  try { doc = await openDoc(file); } catch (err) { hint.textContent = err.message; return; }
  const total = doc.numPages;
  const tiles = pageTiles(doc, grid, Array.from({ length: total }, (_, i) => i));
  let selected = new Set();
  let last = null;
  const paint = () => { tiles.forEach((t, i) => { t.classList.toggle("on", selected.has(i)); t.setAttribute("aria-pressed", selected.has(i) ? "true" : "false"); }); hint.textContent = selected.size ? `${plural(selected.size, "page")} selected · click to toggle, shift-click for a range` : "Click pages to select them, or type ranges above"; };
  const fromInput = () => { try { selected = new Set(input.value.trim() ? parseRanges(input.value, total) : []); } catch (_) { selected = new Set(); } paint(); };
  input.addEventListener("input", fromInput);
  tiles.forEach((t, i) => t.addEventListener("click", (e) => {
    if (e.shiftKey && last !== null) { const [a, b] = last < i ? [last, i] : [i, last]; for (let k = a; k <= b; k++) selected.add(k); }
    else if (selected.has(i)) selected.delete(i); else selected.add(i);
    last = i;
    input.value = rangesText(selected, total);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    paint();
  }));
  fromInput();
}

function toBlob(canvas, mime, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), mime, quality));
}

async function loadPdf(file) {
  const bytes = await file.arrayBuffer();
  try {
    // updateMetadata: false keeps the file's own Info dictionary; pdf-lib would otherwise stamp its Producer and dates.
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (err) {
    throw new Error(`${file.name} is not a readable PDF (${err.message || err})`);
  }
}

async function pageCount(file) {
  return (await loadPdf(file)).getPageCount();
}

function pdfBlob(bytes) {
  return new Blob([bytes], { type: "application/pdf" });
}

// ---------- fonts ----------
// The 14 standard PDF fonts only cover WinAnsi (Latin-1 plus a few symbols). Anything else (Cyrillic, Greek,
// extended Latin) is drawn with a bundled Noto Sans subset through fontkit, both loaded only when first needed.

const WINANSI = /^[\x20-\x7e\xa0-\xff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]*$/;
let fontkitLoading = null;
const fontCache = {};

function loadFontkit() {
  if (globalThis.fontkit) return Promise.resolve(globalThis.fontkit);
  fontkitLoading ??= new Promise((resolve, reject) => {
    const s = el("script", { src: new URL("../../vendor/fontkit.umd.min.js", import.meta.url).href });
    s.onload = () => resolve(globalThis.fontkit);
    s.onerror = () => reject(new Error("Could not load the font engine for non-Latin text"));
    document.head.append(s);
  });
  return fontkitLoading;
}

/** A font that can draw `text`: Helvetica for WinAnsi text, otherwise an embedded Noto Sans subset. */
async function fontFor(doc, text, bold) {
  if (WINANSI.test(text)) return doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const fontkit = await loadFontkit();
  const name = bold ? "NotoSans-Bold" : "NotoSans-Regular";
  fontCache[name] ??= await (await fetch(new URL(`../../vendor/fonts/${name}.ttf`, import.meta.url))).arrayBuffer();
  doc.registerFontkit(fontkit);
  return doc.embedFont(fontCache[name], { subset: true });
}

// ---------- merge ----------

const mergeTool = {
  id: "pdf-merge",
  title: "Merge PDF",
  description: "Combine several PDFs into one. Use the arrows in the file list to set the order.",
  accept: "application/pdf,.pdf",
  orderable: true,
  hint: "Add two or more PDF files",
  runLabel: "Merge",
  renderOptions(root, files) {
    const info = el("div", { class: "stat", text: "Counting pages…" });
    root.append(info);
    Promise.all(files.map(pageCount))
      .then((counts) => { info.textContent = `${plural(files.length, "file")}, ${plural(counts.reduce((a, b) => a + b, 0), "page")} in total`; })
      .catch((err) => { info.textContent = err.message; });
  },
  async run(files, _root, progress) {
    if (files.length < 2) throw new Error("Add at least two PDF files");
    const out = await PDFDocument.create();
    for (const file of files) {
      await progress?.tick(file.name);
      const src = await loadPdf(file);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    return [{ name: "merged.pdf", blob: pdfBlob(await out.save()), note: plural(out.getPageCount(), "page") }];
  },
};

// ---------- split ----------

const splitTool = {
  id: "pdf-split",
  title: "Split PDF",
  description: "Extract chosen pages into a new PDF, save every page as its own file, or cut the document into equal chunks.",
  accept: "application/pdf,.pdf",
  multiple: false,
  hint: "One PDF file",
  runLabel: "Split",
  renderOptions(root, files) {
    const mode = select([["ranges", "Extract pages (e.g. 1-3, 7)"], ["each", "Every page as a separate PDF"], ["chunks", "Split every N pages"]], "ranges");
    const ranges = el("input", { type: "text", placeholder: "1-3, 7, 10-12" });
    const chunk = number(1, { min: 1 });
    const rangesRow = el("div", { class: "row" }, [field("Pages", ranges)]);
    const chunkRow = el("div", { class: "row", hidden: true }, [field("Pages per file", chunk)]);
    mode.addEventListener("change", () => { rangesRow.hidden = mode.value !== "ranges"; chunkRow.hidden = mode.value !== "chunks"; });
    const info = el("div", { class: "stat", text: "Counting pages…" });
    const picker = el("div");
    mode.addEventListener("change", () => { picker.hidden = mode.value !== "ranges"; });
    root.append(el("div", { class: "row" }, [field("Mode", mode)]), rangesRow, chunkRow, info, picker);
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${plural(n, "page")}`; this.total = n; }).catch((err) => { info.textContent = err.message; });
    closeDocs(); pagePicker(picker, files[0], ranges);
    this.opts = { mode, ranges, chunk };
  },
  async run(files) {
    const file = files[0];
    const src = await loadPdf(file);
    const total = src.getPageCount();
    const base = baseName(file.name);
    const o = this.opts;
    const extract = async (indices, name) => {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, indices);
      pages.forEach((p) => doc.addPage(p));
      return { name, blob: pdfBlob(await doc.save()), note: plural(indices.length, "page") };
    };
    if (o.mode.value === "ranges") {
      const indices = parseRanges(o.ranges.value, total);
      return [await extract(indices, `${base}-pages.pdf`)];
    }
    if (o.mode.value === "each") {
      const out = [];
      const pad = String(total).length;
      for (let i = 0; i < total; i++) out.push(await extract([i], `${base}-${String(i + 1).padStart(pad, "0")}.pdf`));
      return out;
    }
    const n = Math.max(1, Number(o.chunk.value) || 1);
    const out = [];
    for (let start = 0, part = 1; start < total; start += n, part++) {
      const indices = [];
      for (let i = start; i < Math.min(start + n, total); i++) indices.push(i);
      out.push(await extract(indices, `${base}-part${part}.pdf`));
    }
    return out;
  },
};

// ---------- rotate ----------

const rotatePdfTool = {
  id: "pdf-rotate",
  title: "Rotate PDF",
  description: "Rotate all pages or just some of them. Works on several PDFs at once.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Rotate",
  renderOptions(root, files) {
    const angle = select([["90", "90° right"], ["270", "90° left"], ["180", "180°"]], "90");
    const which = select([["all", "All pages"], ["ranges", "Only these pages"]], "all");
    const ranges = el("input", { type: "text", placeholder: "1, 3-5" });
    const rangesField = field("Pages", ranges);
    rangesField.hidden = true;
    const picker = el("div", { hidden: true });
    which.addEventListener("change", () => { rangesField.hidden = which.value !== "ranges"; picker.hidden = which.value !== "ranges"; });
    root.append(el("div", { class: "row" }, [field("Rotation", angle), field("Apply to", which), rangesField]), picker);
    if (files.length > 1) picker.append(el("div", { class: "stat", text: `Pages of ${files[0].name}; the same page numbers are rotated in every file.` }));
    closeDocs(); pagePicker(picker, files[0], ranges);
    this.opts = { angle, which, ranges };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const doc = await loadPdf(file);
      const total = doc.getPageCount();
      const indices = o.which.value === "all" ? doc.getPageIndices() : parseRanges(o.ranges.value, total);
      for (const i of indices) {
        const page = doc.getPage(i);
        page.setRotation(degrees((page.getRotation().angle + Number(o.angle.value)) % 360));
      }
      out.push({ name: `${baseName(file.name)}-rotated.pdf`, blob: pdfBlob(await doc.save()), note: `${indices.length} of ${total} pages` });
    }
    return out;
  },
};

// ---------- images to pdf ----------

async function reencode(file, mime, quality) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); // apply the EXIF rotation of phone photos
  const c = document.createElement("canvas");
  c.width = bitmap.width; c.height = bitmap.height;
  const ctx = c.getContext("2d");
  if (mime === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((res) => c.toBlob(res, mime, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** EXIF Orientation (1-8) of a JPEG, or 1 when there is none. */
function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78) { // "Ex" of Exif
      const t = i + 10; // TIFF header
      const le = b[t] === 0x49;
      const r16 = (k) => (le ? b[k] | (b[k + 1] << 8) : (b[k] << 8) | b[k + 1]);
      const r32 = (k) => (le ? (b[k] | (b[k + 1] << 8) | (b[k + 2] << 16) | (b[k + 3] << 24)) >>> 0 : ((b[k] << 24) | (b[k + 1] << 16) | (b[k + 2] << 8) | b[k + 3]) >>> 0);
      const ifd = t + r32(t + 4);
      const n = r16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (r16(e) === 0x0112) return r16(e + 8) || 1;
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

const imagesToPdfTool = {
  id: "images-to-pdf",
  title: "Images to PDF",
  description: "Put one image per page into a single PDF. Order them with the arrows in the file list.",
  accept: "image/*",
  orderable: true,
  hint: "JPG, PNG, WebP, GIF, BMP — multiple files allowed",
  runLabel: "Create PDF",
  renderOptions(root) {
    const size = select([["fit", "Page fits each image"], ["a4p", "A4 portrait"], ["a4l", "A4 landscape"], ["letterp", "Letter portrait"], ["letterl", "Letter landscape"]], "fit");
    const margin = number(20, { min: 0, max: 200 });
    const marginField = field("Margin (pt)", margin);
    marginField.hidden = true;
    const dpi = select([["72", "72 dpi (1 px = 1 pt, huge pages)"], ["96", "96 dpi (screen)"], ["150", "150 dpi"], ["300", "300 dpi (print)"]], "150");
    const dpiField = field("Image resolution", dpi, "Sets the page size: a 3000 px wide photo is 20 in at 150 dpi");
    size.addEventListener("change", () => { marginField.hidden = size.value === "fit"; dpiField.hidden = size.value !== "fit"; });
    root.append(el("div", { class: "row" }, [field("Page size", size), dpiField, marginField]));
    this.opts = { size, margin, dpi };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const doc = await PDFDocument.create();
    for (const file of files) {
      await progress?.tick(file.name);
      let image;
      if (file.type === "image/jpeg") {
        const bytes = await file.arrayBuffer();
        // pdf-lib embeds the raw JPEG, so a rotated phone photo has to be re-encoded upright first.
        image = await doc.embedJpg(jpegOrientation(new Uint8Array(bytes)) === 1 ? bytes : await reencode(file, "image/jpeg", 0.92));
      } else if (file.type === "image/png") image = await doc.embedPng(await file.arrayBuffer());
      else image = await doc.embedPng(await reencode(file, "image/png"));
      const { width: iw, height: ih } = image;
      if (o.size.value === "fit") {
        const k = 72 / (Number(o.dpi.value) || 150);
        const page = doc.addPage([iw * k, ih * k]);
        page.drawImage(image, { x: 0, y: 0, width: iw * k, height: ih * k });
        continue;
      }
      const base = o.size.value.startsWith("a4") ? PageSizes.A4 : PageSizes.Letter;
      const landscape = o.size.value.endsWith("l");
      const [pw, ph] = landscape ? [base[1], base[0]] : base;
      const m = Number(o.margin.value) || 0;
      const k = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih);
      const w = iw * k, h = ih * k;
      const page = doc.addPage([pw, ph]);
      page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    return [{ name: files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf", blob: pdfBlob(await doc.save()), note: plural(files.length, "page") }];
  },
};

// ---------- pdf to images ----------

const pdfToImagesTool = {
  id: "pdf-to-images",
  title: "PDF to images",
  description: "Render pages as PNG or JPEG at the resolution you choose.",
  accept: "application/pdf,.pdf",
  multiple: false,
  hint: "One PDF file",
  runLabel: "Render pages",
  renderOptions(root, files) {
    const format = select([["png", "PNG"], ["jpeg", "JPEG"]], "png");
    const dpi = select([["72", "72 dpi (screen)"], ["150", "150 dpi (good)"], ["300", "300 dpi (print)"]], "150");
    const which = select([["all", "All pages"], ["ranges", "Only these pages"]], "all");
    const ranges = el("input", { type: "text", placeholder: "1, 3-5" });
    const rangesField = field("Pages", ranges); rangesField.hidden = true;
    which.addEventListener("change", () => { rangesField.hidden = which.value !== "ranges"; });
    const info = el("div", { class: "stat", text: "Counting pages…" });
    const picker = el("div", { hidden: true });
    which.addEventListener("change", () => { picker.hidden = which.value !== "ranges"; });
    root.append(el("div", { class: "row" }, [field("Format", format), field("Resolution", dpi), field("Apply to", which), rangesField]), info, picker);
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${plural(n, "page")}`; }).catch((err) => { info.textContent = err.message; });
    closeDocs(); pagePicker(picker, files[0], ranges);
    this.opts = { format, dpi, which, ranges };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const file = files[0];
    const total = await pageCount(file);
    const indices = o.which.value === "all" ? null : parseRanges(o.ranges.value, total);
    const mime = o.format.value === "png" ? "image/png" : "image/jpeg";
    const pad = String(total).length;
    const out = [];
    await renderPages(file, Number(o.dpi.value) / 72, indices, async (canvas, n) => {
      out.push({ name: `${baseName(file.name)}-${String(n).padStart(pad, "0")}.${o.format.value === "png" ? "png" : "jpg"}`, blob: await toBlob(canvas, mime, 0.9), note: `${canvas.width} × ${canvas.height}` });
    }, progress);
    return out;
  },
};

// ---------- compress pdf ----------

const compressPdfTool = {
  id: "pdf-compress",
  title: "Compress PDF",
  description: "Lossless mode compacts the file structure and drops metadata while the text stays selectable. Re-render mode turns every page into a JPEG at a lower resolution: great for scans and photo-heavy PDFs, wrong for text documents.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Compress",
  renderOptions(root, files) {
    const mode = select([["lossless", "Lossless: compact structure, drop metadata"], ["render", "Re-render pages as JPEG (for scans)"]], "lossless");
    const dpi = select([["72", "72 dpi (smallest)"], ["100", "100 dpi"], ["150", "150 dpi (balanced)"], ["200", "200 dpi"]], "100");
    const quality = el("input", { type: "range", min: 20, max: 95, value: 60 });
    const qLabel = el("span", { class: "stat", text: "60" });
    quality.addEventListener("input", () => { qLabel.textContent = quality.value; });
    const gray = checkbox("Convert to grayscale", false);
    const renderRow = el("div", { class: "row", hidden: true }, [field("Resolution", dpi), field("JPEG quality", el("div", { class: "row" }, [quality, qLabel])), gray.label]);
    mode.addEventListener("change", () => { renderRow.hidden = mode.value !== "render"; });
    root.append(
      el("div", { class: "row" }, [field("Mode", mode)]),
      renderRow,
      el("div", { class: "stat", text: `${plural(files.length, "file")}, ${formatBytes(files.reduce((s, f) => s + f.size, 0))} total` }),
    );
    this.opts = { mode, dpi, quality, gray };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      if (o.mode.value === "lossless") {
        await progress?.tick(file.name);
        const doc = await loadPdf(file);
        stripMetadata(doc);
        const blob = pdfBlob(await doc.save({ useObjectStreams: true, updateMetadata: false }));
        if (blob.size >= file.size) out.push({ name: file.name, blob: file, note: "already compact: kept as is" });
        else out.push({ name: `${baseName(file.name)}-compressed.pdf`, blob, note: `−${Math.round((1 - blob.size / file.size) * 100)}% (was ${formatBytes(file.size)}), text kept` });
        continue;
      }
      const doc = await PDFDocument.create();
      await renderPages(file, Number(o.dpi.value) / 72, null, async (canvas, _n, wPt, hPt) => {
        if (o.gray.input.checked) {
          const ctx = canvas.getContext("2d");
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; }
          ctx.putImageData(img, 0, 0);
        }
        const jpg = await doc.embedJpg(await (await toBlob(canvas, "image/jpeg", Number(o.quality.value) / 100)).arrayBuffer());
        const page = doc.addPage([wPt, hPt]);
        page.drawImage(jpg, { x: 0, y: 0, width: wPt, height: hPt });
      }, progress);
      const blob = pdfBlob(await doc.save());
      if (blob.size >= file.size) {
        // Text and vector PDFs are already compact; rasterising them only makes them bigger (and the text unselectable).
        out.push({ name: file.name, blob: file, note: `kept as is: re-rendering would make it ${(blob.size / file.size).toFixed(1)}× bigger` });
        continue;
      }
      out.push({ name: `${baseName(file.name)}-compressed.pdf`, blob, note: `−${Math.round((1 - blob.size / file.size) * 100)}% (was ${formatBytes(file.size)})` });
    }
    return out;
  },
};

// ---------- delete pages ----------

const deletePagesTool = {
  id: "pdf-delete-pages",
  title: "Delete PDF pages",
  description: "Remove the pages you list and keep everything else.",
  accept: "application/pdf,.pdf",
  multiple: false,
  hint: "One PDF file",
  runLabel: "Delete pages",
  renderOptions(root, files) {
    const ranges = el("input", { type: "text", placeholder: "2, 5-7" });
    const info = el("div", { class: "stat", text: "Counting pages…" });
    const picker = el("div");
    root.append(el("div", { class: "row" }, [field("Pages to delete", ranges)]), info, picker);
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${plural(n, "page")}`; }).catch((err) => { info.textContent = err.message; });
    closeDocs(); pagePicker(picker, files[0], ranges);
    this.opts = { ranges };
  },
  async run(files) {
    const doc = await loadPdf(files[0]);
    const total = doc.getPageCount();
    const indices = parseRanges(this.opts.ranges.value, total);
    if (indices.length >= total) throw new Error("You cannot delete every page");
    for (const i of [...indices].reverse()) doc.removePage(i);
    return [{ name: `${baseName(files[0].name)}-edited.pdf`, blob: pdfBlob(await doc.save()), note: `${doc.getPageCount()} of ${total} pages kept` }];
  },
};

// ---------- reorder pages ----------

const reorderTool = {
  id: "pdf-reorder",
  title: "Reorder pages",
  description: "Drag page thumbnails into a new order, drop the ones you do not need, or reverse the whole document.",
  accept: "application/pdf,.pdf",
  multiple: false,
  hint: "One PDF file",
  runLabel: "Save new order",
  renderOptions(root, files) {
    const st = { order: [], removed: new Set(), total: 0 };
    this.state = st;
    const info = el("div", { class: "stat", text: "Loading pages…" });
    const grid = el("div", { class: "pages", role: "list" });
    const bar = el("div", { class: "actions" }, [
      el("button", { type: "button", text: "Reverse", onclick: () => { st.order.reverse(); paint(); } }),
      el("button", { type: "button", text: "Reset", onclick: () => { st.order = Array.from({ length: st.total }, (_, i) => i); st.removed.clear(); paint(); } }),
      info,
    ]);
    root.append(bar, grid);
    let tiles = new Map();
    const paint = () => {
      grid.replaceChildren(...st.order.map((i) => tiles.get(i)));
      st.order.forEach((i, pos) => { const t = tiles.get(i); t.classList.toggle("removed", st.removed.has(i)); t.querySelector(".page-n").textContent = st.removed.has(i) ? `was ${i + 1}` : `${pos + 1} (was ${i + 1})`; });
      const kept = st.order.filter((i) => !st.removed.has(i)).length;
      info.textContent = `${plural(kept, "page")} kept of ${st.total}. Drag to reorder, ✕ to drop a page.`;
    };
    closeDocs();
    openDoc(files[0]).then((doc) => {
      st.total = doc.numPages;
      st.order = Array.from({ length: st.total }, (_, i) => i);
      const list = pageTiles(doc, grid, st.order);
      let from = null;
      list.forEach((t, i) => {
        tiles.set(i, t);
        t.setAttribute("draggable", "true");
        t.setAttribute("role", "listitem");
        t.append(el("button", { type: "button", class: "icon mini", text: "✕", title: "Drop this page", onclick: (e) => { e.stopPropagation(); if (st.removed.has(i)) st.removed.delete(i); else st.removed.add(i); paint(); } }));
        t.addEventListener("click", () => { if (st.removed.has(i)) { st.removed.delete(i); paint(); } });
        t.addEventListener("dragstart", (e) => { from = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); t.classList.add("dragging"); });
        t.addEventListener("dragend", () => { t.classList.remove("dragging"); grid.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after")); });
        t.addEventListener("dragover", (e) => {
          if (from === null || from === i) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move";
          const after = e.clientX > t.getBoundingClientRect().left + t.offsetWidth / 2;
          t.classList.toggle("drop-after", after); t.classList.toggle("drop-before", !after);
        });
        t.addEventListener("drop", (e) => {
          if (from === null) return;
          e.preventDefault(); e.stopPropagation();
          const after = e.clientX > t.getBoundingClientRect().left + t.offsetWidth / 2;
          const fromPos = st.order.indexOf(from), toPosBase = st.order.indexOf(i);
          st.order.splice(fromPos, 1);
          let to = toPosBase + (after ? 1 : 0);
          if (fromPos < to) to--;
          st.order.splice(to, 0, from);
          from = null; paint();
        });
      });
      paint();
    }).catch((err) => { info.textContent = err.message; });
  },
  async run(files) {
    const st = this.state;
    const keep = st.order.filter((i) => !st.removed.has(i));
    if (!keep.length) throw new Error("Keep at least one page");
    const src = await loadPdf(files[0]);
    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(src, keep);
    pages.forEach((p) => doc.addPage(p));
    const unchanged = keep.length === st.total && keep.every((v, k) => v === k);
    return [{ name: `${baseName(files[0].name)}-reordered.pdf`, blob: pdfBlob(await doc.save()), note: unchanged ? "same order as the original" : `${plural(keep.length, "page")}, new order` }];
  },
};

// ---------- page numbers ----------

const pageNumbersTool = {
  id: "pdf-page-numbers",
  title: "Add page numbers",
  description: "Stamp page numbers in the header or footer of every page.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Add numbers",
  renderOptions(root) {
    const position = select([["bottom-center", "Bottom centre"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-center", "Top centre"], ["top-right", "Top right"], ["top-left", "Top left"]], "bottom-center");
    const format = select([["{n}", "1, 2, 3"], ["{n} / {total}", "1 / 10"], ["Page {n}", "Page 1"], ["Page {n} of {total}", "Page 1 of 10"], ["- {n} -", "- 1 -"]], "{n}");
    const size = number(11, { min: 6, max: 48 });
    const start = number(1, { min: 0 });
    const margin = number(28, { min: 4, max: 200 });
    root.append(el("div", { class: "row" }, [field("Position", position), field("Format", format), field("Font size", size), field("Start at", start), field("Margin (pt)", margin)]));
    this.opts = { position, format, size, start, margin };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const doc = await loadPdf(file);
      const font = await fontFor(doc, o.format.value, false);
      const pages = doc.getPages();
      const sz = Number(o.size.value) || 11, m = Number(o.margin.value) || 28, startAt = Number(o.start.value) || 0;
      const [vert, horiz] = o.position.value.split("-");
      pages.forEach((page, i) => {
        const label = o.format.value.replace("{n}", String(i + startAt)).replace("{total}", String(pages.length));
        const { width, height } = page.getSize();
        const tw = font.widthOfTextAtSize(label, sz);
        const x = horiz === "left" ? m : horiz === "center" ? (width - tw) / 2 : width - m - tw;
        const y = vert === "top" ? height - m : m;
        page.drawText(label, { x, y, size: sz, font, color: rgb(0.2, 0.2, 0.2) });
      });
      out.push({ name: `${baseName(file.name)}-numbered.pdf`, blob: pdfBlob(await doc.save()), note: plural(pages.length, "page") });
    }
    return out;
  },
};

// ---------- watermark pdf ----------

const watermarkPdfTool = {
  id: "pdf-watermark",
  title: "Watermark PDF",
  description: "Put a diagonal text watermark such as DRAFT or CONFIDENTIAL across every page.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Add watermark",
  renderOptions(root) {
    const text = el("input", { type: "text", value: "CONFIDENTIAL" });
    const size = number(60, { min: 8, max: 300 });
    const opacity = el("input", { type: "range", min: 5, max: 100, value: 25 });
    const oLabel = el("span", { class: "stat", text: "25%" });
    opacity.addEventListener("input", () => { oLabel.textContent = `${opacity.value}%`; });
    const angle = select([["45", "Diagonal (45°)"], ["0", "Horizontal"], ["90", "Vertical"]], "45");
    const color = el("input", { type: "color", value: "#d33a3a" });
    root.append(el("div", { class: "row" }, [field("Text", text), field("Font size", size), field("Opacity", el("div", { class: "row" }, [opacity, oLabel])), field("Angle", angle), field("Colour", color)]));
    this.opts = { text, size, opacity, angle, color };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const label = o.text.value.trim();
    if (!label) throw new Error("Enter the watermark text");
    const hex = o.color.value;
    const color = rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const doc = await loadPdf(file);
      const font = await fontFor(doc, label, true);
      const sz = Number(o.size.value) || 60;
      const theta = (Number(o.angle.value) * Math.PI) / 180;
      const tw = font.widthOfTextAtSize(label, sz), th = sz * 0.72;
      for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        // Centre the rotated text box on the page: rotate the box centre about the text origin.
        const x = width / 2 - ((tw / 2) * Math.cos(theta) - (th / 2) * Math.sin(theta));
        const y = height / 2 - ((tw / 2) * Math.sin(theta) + (th / 2) * Math.cos(theta));
        page.drawText(label, { x, y, size: sz, font, color, opacity: Number(o.opacity.value) / 100, rotate: degrees(Number(o.angle.value)) });
      }
      out.push({ name: `${baseName(file.name)}-watermarked.pdf`, blob: pdfBlob(await doc.save()), note: plural(doc.getPageCount(), "page") });
    }
    return out;
  },
};

// ---------- metadata ----------

/** Deletes the Info dictionary entries (Title, Author, Producer, dates…) and the XMP stream. Returns what was removed. */
function stripMetadata(doc) {
  const removed = [];
  const ref = doc.context.trailerInfo.Info;
  const info = ref ? doc.context.lookup(ref) : null;
  if (info instanceof PDFDict) {
    for (const key of [...info.keys()]) { removed.push(key.decodeText()); info.delete(key); }
  }
  if (doc.catalog.has(PDFName.of("Metadata"))) { doc.catalog.delete(PDFName.of("Metadata")); removed.push("XMP"); }
  return removed;
}

function infoRows(doc) {
  const fmt = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 16).replace("T", " ") : "");
  const rows = [
    ["Title", doc.getTitle()], ["Author", doc.getAuthor()], ["Subject", doc.getSubject()], ["Keywords", doc.getKeywords()],
    ["Created with", doc.getCreator()], ["Producer", doc.getProducer()],
    ["Created", fmt(doc.getCreationDate())], ["Modified", fmt(doc.getModificationDate())],
    ["XMP metadata", doc.catalog.has(PDFName.of("Metadata")) ? "present" : ""],
  ];
  return rows.filter(([, v]) => v);
}

const pdfMetadataTool = {
  id: "pdf-metadata",
  title: "Remove PDF metadata",
  description: "See and strip the document properties a PDF carries: title, author, software, creation and modification dates, keywords and the XMP block. Pages are untouched.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Remove metadata",
  renderOptions(root, files) {
    const box = el("div", { class: "stat", text: "Reading…" });
    root.append(box);
    (async () => {
      const blocks = [];
      for (const file of files.slice(0, 5)) {
        let rows;
        try { rows = infoRows(await loadPdf(file)); } catch (err) { rows = [["Error", err.message]]; }
        const table = el("table", { class: "meta" }, rows.map(([k, v]) => el("tr", {}, [el("th", { text: k }), el("td", { text: v })])));
        blocks.push(el("div", {}, [el("div", { class: "stat", text: file.name }), rows.length ? table : el("div", { class: "stat", text: "No metadata found." })]));
      }
      if (files.length > 5) blocks.push(el("div", { class: "stat", text: `… and ${files.length - 5} more` }));
      box.replaceWith(el("div", { class: "options" }, blocks));
    })();
  },
  async run(files, _root, progress) {
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const doc = await loadPdf(file);
      const removed = stripMetadata(doc);
      const blob = pdfBlob(await doc.save({ useObjectStreams: true, updateMetadata: false }));
      out.push({ name: `${baseName(file.name)}-clean.pdf`, blob, note: removed.length ? `removed ${removed.join(", ")}` : "no metadata found" });
    }
    return out;
  },
};

// ---------- pdf to text ----------

const pdfToTextTool = {
  id: "pdf-to-text",
  title: "PDF to text",
  description: "Pull the text layer out of a PDF as plain text or Markdown. Scanned PDFs have no text layer; those need OCR, which FileForge does not do.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Extract text",
  noAutoDownload: true,
  renderOptions(root) {
    const format = select([["txt", "Plain text (.txt)"], ["md", "Markdown with a heading per page (.md)"]], "txt");
    const reflow = checkbox("Join wrapped lines into paragraphs", true);
    const output = el("textarea", { readonly: true, spellcheck: "false", placeholder: "Text appears here", rows: 14 });
    const outField = field("Text", output);
    outField.append(copyButton(() => output.value, "Copy text"));
    root.append(el("div", { class: "row" }, [field("Format", format), reflow.label]), outField);
    this.opts = { format, reflow, output };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const out = [];
    let preview = "";
    for (const file of files) {
      await progress?.tick(file.name);
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
      const pages = [];
      let chars = 0;
      try {
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const tc = await page.getTextContent();
          const lines = [];
          let line = "";
          for (const item of tc.items) {
            line += item.str;
            if (item.hasEOL) { lines.push(line.trimEnd()); line = ""; }
          }
          if (line.trim()) lines.push(line.trimEnd());
          let text;
          if (o.reflow.input.checked) {
            // A line ending in sentence punctuation, or one much shorter than the page's typical line, ends a
            // paragraph; the rest are wrapped lines and get joined.
            const lengths = lines.map((l) => l.trim().length).filter(Boolean).sort((a, b) => a - b);
            const median = lengths[Math.floor(lengths.length / 2)] || 0;
            const paras = [];
            let cur = "";
            for (const l of lines) {
              const t = l.trim();
              if (!t) { if (cur) paras.push(cur); cur = ""; continue; }
              cur = cur ? `${cur} ${t}` : t;
              if (/[.!?:;]["')\]]?$/.test(t) || t.length < median * 0.6) { paras.push(cur); cur = ""; }
            }
            if (cur) paras.push(cur);
            text = paras.join("\n\n");
          } else text = lines.join("\n");
          chars += text.length;
          pages.push(o.format.value === "md" ? `## Page ${n}\n\n${text}` : text);
          page.cleanup();
        }
      } finally { await doc.destroy(); }
      const text = pages.join(o.format.value === "md" ? "\n\n" : "\n\n----\n\n") + "\n";
      const ext = o.format.value === "md" ? "md" : "txt";
      out.push({ name: `${baseName(file.name)}.${ext}`, blob: new Blob([text], { type: ext === "md" ? "text/markdown" : "text/plain" }), note: chars ? `${plural(doc.numPages, "page")}, ${chars.toLocaleString()} characters` : "no text layer (scanned?)" });
      if (!preview) preview = text;
    }
    o.output.value = preview.length > 200_000 ? preview.slice(0, 200_000) + "\n…(preview cut, download for the full text)" : preview;
    return out;
  },
};

export const pdfTools = [mergeTool, splitTool, reorderTool, rotatePdfTool, deletePagesTool, pageNumbersTool, watermarkPdfTool, compressPdfTool, pdfMetadataTool, imagesToPdfTool, pdfToImagesTool, pdfToTextTool];
