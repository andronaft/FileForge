// Paperwork helpers built on the PDF engine: one upload-ready PDF out of whatever you have, and a copy of a document
// that says who it was made for.
import { el, baseName, field, select, number, checkbox, formatBytes, plural, t } from "../util.js";
import { loadPdf, pdfBlob, embedPicture, fitPdf, rasterisePdf, pdfThumbnail, sweepPdf, canvasBlob } from "./pdf.js";
import { loadImage, dims, makeCanvas } from "./image.js";
import { slugify } from "./files.js";
import { getLang } from "../i18n.js";

const { PDFDocument, PageSizes } = PDFLib;
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

// ---------- document pack ----------

const packTool = {
  id: "pdf-pack",
  title: "Document pack",
  description: "Photos, scans and PDFs become one PDF that fits an upload form: set the size limit, such as 2 MB, and the file name. Order the files with the arrows.",
  keywords: ["one pdf", "combine", "merge photos and pdf", "upload", "portal", "application", "visa", "up to 2 mb", "scan", "passport", "documents", "пакет документів", "один pdf", "для подачі", "дія", "до 2 мб", "заява", "скан"],
  accept: "image/*,application/pdf,.pdf,.heic,.heif",
  orderable: true,
  hint: "Photos (JPG, PNG, HEIC…) and PDF files, in any mix",
  runLabel: "Make one PDF",
  renderOptions(root, files) {
    const limit = select([["0", "No limit"], ["1", "1 MB"], ["2", "2 MB"], ["5", "5 MB"], ["10", "10 MB"], ["20", "20 MB"], ["custom", "Other…"]], "2");
    const custom = number(3, { min: 0.1, step: "0.1" });
    const customField = field("MB", custom); customField.hidden = true;
    limit.addEventListener("change", () => { customField.hidden = limit.value !== "custom"; });
    const page = select([["a4", "A4 sheet"], ["fit", "Same shape as the photo"]], "a4");
    const look = select([["colour", "Colour"], ["gray", "Black and white"]], "colour");
    const name = el("input", { type: "text", value: "documents", placeholder: "documents" });
    const latin = checkbox("Latin letters only in the file name", true);
    root.append(
      el("div", { class: "row" }, [field("Fit into", limit, "Pictures are made lighter step by step until the file fits; text in your PDFs stays text"), customField, field("Photo pages", page), field("Look", look)]),
      el("div", { class: "row" }, [field("File name", name), latin.label]),
      el("div", { class: "stat", text: t("{files}, {size} total", { files: plural(files.length, "file"), size: formatBytes(files.reduce((s, f) => s + f.size, 0)) }) }),
    );
    this.opts = { limit, custom, page, look, name, latin };
    setTimeout(() => { customField.hidden = limit.value !== "custom"; }, 0); // after the remembered options are restored
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const limit = (o.limit.value === "custom" ? Number(o.custom.value) || 0 : Number(o.limit.value)) * 1024 * 1024;
    const doc = await PDFDocument.create();
    progress?.start(files.length + 1);
    for (const file of files) {
      await progress?.tick(file.name);
      if (isPdf(file)) {
        const src = await loadPdf(file);
        (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p));
        continue;
      }
      // Photos always go in as JPEG: that is what the size limit can work on later.
      const image = await embedPicture(doc, file, { jpeg: true });
      const { width: iw, height: ih } = image;
      if (o.page.value === "fit") { const k = 72 / 150; doc.addPage([iw * k, ih * k]).drawImage(image, { x: 0, y: 0, width: iw * k, height: ih * k }); continue; }
      const [pw, ph] = iw > ih ? [PageSizes.A4[1], PageSizes.A4[0]] : PageSizes.A4;
      const k = Math.min(pw / iw, ph / ih), w = iw * k, h = ih * k;
      doc.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    if (!doc.getPageCount()) throw new Error("Add at least one photo or PDF");
    sweepPdf(doc);
    const pages = doc.getPageCount(), gray = o.look.value === "gray";
    let blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    let note = plural(pages, "page");
    if (limit || gray) {
      await progress?.tick(t("fitting the size"));
      const built = new File([blob], "pack.pdf", { type: "application/pdf" });
      // No limit: one gentle pass (only for the black-and-white look). With a limit: start gentle, go down as needed.
      const r = (limit && blob.size <= limit && !gray) ? { blob, level: "", fits: true } : await fitPdf(built, { level: "high", limit, gray }, (step) => progress?.note?.(step));
      if (r.blob.size < blob.size || gray) blob = r.blob;
      if (r.level === "render") note += ` · ${t("pages turned into pictures to fit")}`;
      if (limit) note += blob.size <= limit ? ` · ${t("fits into {limit}", { limit: formatBytes(limit) })}` : ` · ${t("still over {limit}", { limit: formatBytes(limit) })}`;
    }
    const wanted = (o.name.value.trim() || "documents").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]+/g, " ").trim() || "documents";
    return [{ name: `${o.latin.input.checked ? slugify(wanted) || "documents" : wanted}.pdf`, blob, note }];
  },
};

// ---------- safe copy ----------

/** Black and white in place. Done by hand: the canvas `filter` shortcut is missing in Safari. */
function toGray(canvas) {
  const g = canvas.getContext("2d"), img = g.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; }
  g.putImageData(img, 0, 0);
}

/** The purpose text, repeated across the whole picture at an angle, so it cannot be cropped away. */
function tileText(canvas, text, { opacity, colour, density }) {
  const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height;
  const size = Math.max(12, Math.round(Math.min(w, h) * 0.032));
  g.save();
  g.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  g.textBaseline = "middle";
  g.fillStyle = colour; g.strokeStyle = "#fff"; g.lineWidth = Math.max(1, size / 7); g.lineJoin = "round";
  const tw = g.measureText(text).width, stepX = tw + size * 2.5, stepY = size * (density === "dense" ? 3.2 : density === "sparse" ? 8 : 5);
  g.translate(w / 2, h / 2); g.rotate(-Math.PI / 6);
  const R = Math.hypot(w, h) / 2;
  for (let y = -R, row = 0; y <= R; y += stepY, row++) {
    for (let x = -R - (row % 2 ? stepX / 2 : 0); x <= R; x += stepX) {
      g.globalAlpha = opacity * 0.5; g.strokeText(text, x, y); // a light halo keeps it readable on dark areas
      g.globalAlpha = opacity; g.fillText(text, x, y);
    }
  }
  g.restore();
}

const safeCopyTool = {
  id: "safe-copy",
  title: "Safe copy of a document",
  description: "Before you send a passport or ID scan: write who the copy is for across the whole page, so it cannot be reused elsewhere. Pages are flattened into pictures and metadata is dropped.",
  keywords: ["copy for", "watermark", "passport", "id card", "scan", "protect", "bank", "landlord", "purpose", "копія для", "паспорт", "водяний знак", "захистити скан", "для банку", "документ"],
  accept: "image/*,application/pdf,.pdf,.heic,.heif",
  hint: "Scans or photos of documents: pictures or PDF",
  runLabel: "Make safe copies",
  renderOptions(root, files) {
    const who = el("input", { type: "text", placeholder: t("Copy for the bank, the landlord, a visa application…") });
    const date = checkbox("Add today's date", true);
    const opacity = el("input", { type: "range", min: 10, max: 70, value: 30 });
    const density = select([["sparse", "Sparse"], ["normal", "Normal"], ["dense", "Dense"]], "normal");
    const colour = select([["#404040", "Grey"], ["#c62828", "Red"], ["#1e4fa3", "Blue"]], "#404040");
    const gray = checkbox("Black and white", false);
    const preview = el("canvas", { class: "safe-preview" });
    const stat = el("div", { class: "stat", text: "Loading the preview…" });
    root.append(
      el("div", { class: "row" }, [field("Who is this copy for?", who), date.label]),
      el("div", { class: "row" }, [field("Visibility", opacity), field("How often", density), field("Colour", colour), gray.label]),
      preview, stat,
    );
    this.opts = { who, date, opacity, density, colour, gray };
    // The first page as it will look; redrawn as the options change.
    let base = null;
    const draw = () => {
      if (!base) return;
      preview.width = base.width; preview.height = base.height;
      preview.getContext("2d").drawImage(base, 0, 0);
      if (gray.input.checked) toGray(preview);
      tileText(preview, this.label(), this.look());
    };
    for (const input of [who, opacity, density, colour, date.input, gray.input]) input.addEventListener("input", draw);
    const file = files[0], token = (this.token = {});
    (async () => {
      const c = isPdf(file) ? (await pdfThumbnail(file, 560)).canvas : await this.canvasOf(file, 560);
      if (this.token !== token) return;
      base = c; stat.textContent = t("Preview of {name}", { name: file.name }); draw();
    })().catch((err) => { stat.textContent = err.message; });
    setTimeout(draw, 0); // after the remembered options are restored
  },
  label() {
    const o = this.opts, text = o.who.value.trim() || t("Copy");
    return o.date.input.checked ? `${text} · ${new Date().toLocaleDateString(getLang() === "uk" ? "uk-UA" : "en-GB")}` : text;
  },
  look() { const o = this.opts; return { opacity: Number(o.opacity.value) / 100, colour: o.colour.value, density: o.density.value }; },
  async canvasOf(file, maxSide) {
    const img = await loadImage(file), d = dims(img), k = Math.min(1, maxSide / Math.max(d.w, d.h));
    const c = makeCanvas(Math.round(d.w * k), Math.round(d.h * k)), g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    if (img.close) img.close();
    return c;
  },
  async run(files, _root, progress) {
    const o = this.opts;
    if (!o.who.value.trim()) throw new Error("Write who the copy is for");
    const label = this.label(), look = this.look(), gray = o.gray.input.checked, out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      if (isPdf(file)) {
        // Rasterised on purpose: the text is drawn into the page picture, there is no layer to delete.
        const blob = await rasterisePdf(file, 150, 0.82, gray, null, (canvas) => tileText(canvas, label, look));
        out.push({ name: `${baseName(file.name)}-copy.pdf`, blob, note: t("marked “{label}”", { label }) });
        continue;
      }
      const c = await this.canvasOf(file, 3000);
      if (gray) toGray(c);
      tileText(c, label, look);
      out.push({ name: `${baseName(file.name)}-copy.jpg`, blob: await canvasBlob(c, "image/jpeg", 0.88), note: t("marked “{label}”", { label }) });
    }
    return out;
  },
};

export const packTools = [packTool, safeCopyTool];
