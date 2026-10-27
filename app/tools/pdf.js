import { el, baseName, field, select, number, parseRanges, toast } from "../util.js";

const { PDFDocument, degrees, PageSizes } = PDFLib;

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
      .then((counts) => { info.textContent = `${files.length} file${files.length === 1 ? "" : "s"}, ${counts.reduce((a, b) => a + b, 0)} pages in total`; })
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
    return [{ name: "merged.pdf", blob: pdfBlob(await out.save()), note: `${out.getPageCount()} pages` }];
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
    pageCount(files[0]).then((n) => { info.textContent = `${files[0].name}: ${n} page${n === 1 ? "" : "s"}`; this.total = n; }).catch((err) => { info.textContent = err.message; });
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
      return { name, blob: pdfBlob(await doc.save()), note: `${indices.length} page${indices.length === 1 ? "" : "s"}` };
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

async function toPngBytes(file) {
  const bitmap = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
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
    size.addEventListener("change", () => { marginField.hidden = size.value === "fit"; });
    root.append(el("div", { class: "row" }, [field("Page size", size), marginField]));
    this.opts = { size, margin };
  },
  async run(files) {
    const o = this.opts;
    const doc = await PDFDocument.create();
    for (const file of files) {
      let image;
      if (file.type === "image/jpeg") image = await doc.embedJpg(await file.arrayBuffer());
      else if (file.type === "image/png") image = await doc.embedPng(await file.arrayBuffer());
      else image = await doc.embedPng(await toPngBytes(file));
      const { width: iw, height: ih } = image;
      if (o.size.value === "fit") {
        const page = doc.addPage([iw, ih]);
        page.drawImage(image, { x: 0, y: 0, width: iw, height: ih });
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
    return [{ name: files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf", blob: pdfBlob(await doc.save()), note: `${files.length} page${files.length === 1 ? "" : "s"}` }];
  },
};

export const pdfTools = [mergeTool, splitTool, rotatePdfTool, imagesToPdfTool];
