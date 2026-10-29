import { el, baseName, field, select, number, checkbox, parseRanges, formatBytes, plural, toast } from "../util.js";
import * as pdfjsLib from "../../vendor/pdf.min.mjs";

const { PDFDocument, degrees, PageSizes, StandardFonts, rgb } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdf.worker.min.mjs", import.meta.url).href;

/** Render pages of a PDF file with pdf.js. Calls onPage(canvas, pageNumber, widthPt, heightPt). */
async function renderPages(file, scale, indices, onPage) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  try {
    const pages = indices || Array.from({ length: doc.numPages }, (_, i) => i);
    for (const i of pages) {
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

function toBlob(canvas, mime, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), mime, quality));
}

async function loadPdf(file) {
  const bytes = await file.arrayBuffer();
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
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
  async run(files) {
    if (files.length < 2) throw new Error("Add at least two PDF files");
    const out = await PDFDocument.create();
    for (const file of files) {
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
    root.append(el("div", { class: "row" }, [field("Mode", mode)]), rangesRow, chunkRow, info);
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${plural(n, "page")}`; this.total = n; }).catch((err) => { info.textContent = err.message; });
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
    which.addEventListener("change", () => { rangesField.hidden = which.value !== "ranges"; });
    root.append(el("div", { class: "row" }, [field("Rotation", angle), field("Apply to", which), rangesField]));
    this.opts = { angle, which, ranges };
  },
  async run(files) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
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
  async run(files) {
    const o = this.opts;
    const doc = await PDFDocument.create();
    for (const file of files) {
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
    root.append(el("div", { class: "row" }, [field("Format", format), field("Resolution", dpi), field("Apply to", which), rangesField]), info);
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${plural(n, "page")}`; }).catch((err) => { info.textContent = err.message; });
    this.opts = { format, dpi, which, ranges };
  },
  async run(files) {
    const o = this.opts;
    const file = files[0];
    const total = await pageCount(file);
    const indices = o.which.value === "all" ? null : parseRanges(o.ranges.value, total);
    const mime = o.format.value === "png" ? "image/png" : "image/jpeg";
    const pad = String(total).length;
    const out = [];
    await renderPages(file, Number(o.dpi.value) / 72, indices, async (canvas, n) => {
      out.push({ name: `${baseName(file.name)}-${String(n).padStart(pad, "0")}.${o.format.value === "png" ? "png" : "jpg"}`, blob: await toBlob(canvas, mime, 0.9), note: `${canvas.width} × ${canvas.height}` });
    });
    return out;
  },
};

// ---------- compress pdf ----------

const compressPdfTool = {
  id: "pdf-compress",
  title: "Compress PDF",
  description: "Re-renders every page as a JPEG at a lower resolution. Great for scans and photo-heavy PDFs; text becomes non-selectable, so skip it for text documents you still want to search.",
  accept: "application/pdf,.pdf",
  hint: "One or more PDF files",
  runLabel: "Compress",
  renderOptions(root, files) {
    const dpi = select([["72", "72 dpi (smallest)"], ["100", "100 dpi"], ["150", "150 dpi (balanced)"], ["200", "200 dpi"]], "100");
    const quality = el("input", { type: "range", min: 20, max: 95, value: 60 });
    const qLabel = el("span", { class: "stat", text: "60" });
    quality.addEventListener("input", () => { qLabel.textContent = quality.value; });
    const gray = checkbox("Convert to grayscale", false);
    root.append(
      el("div", { class: "row" }, [field("Resolution", dpi), field("JPEG quality", el("div", { class: "row" }, [quality, qLabel])), gray.label]),
      el("div", { class: "stat", text: `${plural(files.length, "file")}, ${formatBytes(files.reduce((s, f) => s + f.size, 0))} total` }),
    );
    this.opts = { dpi, quality, gray };
  },
  async run(files) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
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
      });
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
    root.append(el("div", { class: "row" }, [field("Pages to delete", ranges)]), info);
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${plural(n, "page")}`; }).catch((err) => { info.textContent = err.message; });
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
  async run(files) {
    const o = this.opts;
    const out = [];
    for (const file of files) {
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
  async run(files) {
    const o = this.opts;
    const label = o.text.value.trim();
    if (!label) throw new Error("Enter the watermark text");
    const hex = o.color.value;
    const color = rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
    const out = [];
    for (const file of files) {
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

export const pdfTools = [mergeTool, splitTool, rotatePdfTool, deletePagesTool, pageNumbersTool, watermarkPdfTool, compressPdfTool, imagesToPdfTool, pdfToImagesTool];
