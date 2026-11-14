// OCR: text out of photos, screenshots and scanned PDFs with Tesseract (WebAssembly, in a worker). The engine and
// the language models ship with FileForge, so nothing is downloaded and nothing leaves the device.
import { el, baseName, field, select, checkbox, plural, toast, t } from "../util.js";
import { getLang } from "../i18n.js";
import { loadImage, dims, makeCanvas } from "./image.js";
import { pdfjsLib, loadPdf, pdfBlob, canvasBlob, fontFor } from "./pdf.js";
import { copyButton } from "./data.js";

const { PDFDocument, degrees } = PDFLib;
const OCR_DIR = new URL("../../vendor/ocr/", import.meta.url).href;
const BUNDLED = [["ukr", "Ukrainian"], ["eng", "English"]];
const extraLangs = new Map(); // code → Uint8Array of a .traineddata file the user added (this session only)

let libLoading = null;
function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  libLoading ??= new Promise((resolve, reject) => {
    const s = el("script", { src: OCR_DIR + "tesseract.min.js" });
    s.onload = () => resolve(globalThis.Tesseract);
    s.onerror = () => { libLoading = null; reject(new Error("Could not load the OCR engine")); };
    document.head.append(s);
  });
  return libLoading;
}

let engine = null; // { key, worker }
/** A Tesseract worker for these language codes, reused while the selection stays the same. */
async function ocrEngine(codes) {
  const key = codes.join("+");
  if (engine?.key === key) return engine.worker;
  if (engine) { await engine.worker.terminate().catch(() => {}); engine = null; }
  const Tesseract = await loadTesseract();
  const langs = codes.map((c) => (extraLangs.has(c) ? { code: c, data: extraLangs.get(c) } : c));
  const worker = await Tesseract.createWorker(langs, 1, {
    workerPath: OCR_DIR + "worker.min.js",
    corePath: OCR_DIR + "tesseract-core-simd-lstm.js",
    langPath: OCR_DIR,
    workerBlobURL: false, // a blob worker cannot importScripts under the extension's CSP
    gzip: true,
    cacheMethod: "none",
    errorHandler: () => {},
  });
  engine = { key, worker };
  return worker;
}

/** Words with their boxes from Tesseract's TSV output (level 5 rows). */
function wordsFromTsv(tsv) {
  const out = [];
  for (const row of (tsv || "").split("\n")) {
    const c = row.split("\t");
    if (c[0] !== "5" || !c[11]?.trim()) continue;
    out.push({ x: Number(c[6]), y: Number(c[7]), w: Number(c[8]), h: Number(c[9]), conf: Number(c[10]), text: c[11], line: `${c[2]}.${c[3]}.${c[4]}` });
  }
  return out;
}

/**
 * Invisible, selectable text over a page. `words` are in pixels of an image `pxW` wide that covers the page;
 * `toPdf(x, y)` maps a point in page-view units (the image scaled to `viewW`) to PDF coordinates.
 */
async function textLayer(doc, page, words, pxW, viewW, toPdf, rotation, fonts) {
  const k = viewW / pxW;
  // one baseline per text line: the lowest word bottom, so words of a line sit level
  const baseline = new Map();
  for (const w of words) baseline.set(w.line, Math.max(baseline.get(w.line) ?? 0, w.y + w.h));
  for (const w of words) {
    const text = w.text.replace(/[\u0000-\u001f]/g, "");
    if (!text) continue;
    const latin = /^[\x20-\x7e]*$/.test(text);
    const font = latin ? (fonts.latin ??= await fontFor(doc, "a", false)) : (fonts.wide ??= await fontFor(doc, "я", false));
    let width1;
    try { width1 = font.widthOfTextAtSize(text, 1); } catch (_) { continue; }
    if (!width1) continue;
    const size = Math.max(1, Math.min(200, (w.w * k) / width1));
    const [x, y] = toPdf(w.x * k, (baseline.get(w.line) - w.h * 0.18) * k);
    try { page.drawText(text + " ", { x, y, size, font, opacity: 0, rotate: degrees(rotation) }); } catch (_) { /* a glyph the font lacks */ }
  }
}

const ocrTool = {
  id: "ocr",
  title: "Image to text (OCR)",
  description: "Read the text in photos, screenshots and scanned PDFs. Copy it, save it as .txt, or make a searchable PDF where the text can be selected and found. The recognition runs on your device.",
  keywords: ["ocr", "recognise", "recognize", "text from image", "scan to text", "searchable pdf", "extract text", "tesseract", "розпізнати", "розпізнавання", "текст з фото", "распознать"],
  accept: "image/*,application/pdf,.pdf",
  orderable: true,
  noAutoDownload: true,
  hint: "Photos, screenshots or scanned PDFs. For phone photos of paper, run Scan document photo first: straight, evenly lit pages read much better",
  runLabel: "Recognise text",
  renderOptions(root) {
    const uk = getLang() === "uk";
    const boxes = new Map();
    const langRow = el("div", { class: "row" }, [el("span", { class: "field-label", text: "Languages in the document" })]);
    const addBox = (code, label, on) => { const c = checkbox(label, on); boxes.set(code, c); langRow.append(c.label); };
    for (const [code, label] of BUNDLED) addBox(code, label, code === "eng" || uk);
    for (const code of extraLangs.keys()) addBox(code, code, true);
    const more = el("input", { type: "file", accept: ".traineddata", hidden: true });
    more.addEventListener("change", async () => {
      const f = more.files[0]; more.value = "";
      if (!f) return;
      const code = f.name.replace(/\.traineddata$/i, "").replace(/[^a-z0-9_]/gi, "").toLowerCase();
      if (!code) return;
      extraLangs.set(code, new Uint8Array(await f.arrayBuffer()));
      if (!boxes.has(code)) addBox(code, code, true); else boxes.get(code).input.checked = true;
      toast(t("Added the language {code} until you close this tab", { code }));
    });
    langRow.append(el("button", { type: "button", class: "small", text: "Add a language file…", title: "A .traineddata file from Tesseract's tessdata", onclick: () => more.click() }), more);
    const output = select([["txt", "Text (.txt)"], ["pdf", "Searchable PDF"], ["both", "Text and searchable PDF"]], "txt");
    const one = checkbox("Put all files into one document", true);
    const text = el("textarea", { readonly: true, spellcheck: "false", placeholder: "Recognised text appears here", rows: 14 });
    const textField = field("Text", text);
    textField.append(copyButton(() => text.value, "Copy text"));
    root.append(langRow,
      el("div", { class: "stat", text: "Tick only the languages that are really in the document: fewer languages read more accurately. Other languages work with a .traineddata file from Tesseract's tessdata." }),
      el("div", { class: "row" }, [field("Save as", output), one.label]), textField);
    this.opts = { boxes, output, one, text };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const codes = [...o.boxes].filter(([, c]) => c.input.checked).map(([code]) => code);
    if (!codes.length) throw new Error("Tick at least one language");
    const wantPdf = o.output.value !== "txt", wantTxt = o.output.value !== "pdf";
    const worker = await ocrEngine(codes);

    // Unfold the inputs into pages first, so progress counts pages, not files.
    const jobs = [];
    for (const file of files) {
      if (file.type === "application/pdf") {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
        for (let n = 1; n <= pdf.numPages; n++) jobs.push({ file, pdf, n });
      } else jobs.push({ file });
    }
    progress?.start(jobs.length);

    const DPI = 200;
    const docs = []; // { name, texts: [], pdf: PDFDocument | null, fonts, words, conf: [] }
    const combined = o.one.input.checked && files.length > 1;
    const target = (file) => {
      if (combined && docs.length) return docs[0];
      let d = docs.find((x) => x.file === file);
      if (!d) { d = { file, name: combined ? "recognised" : baseName(file.name), texts: [], pdf: null, fonts: {}, words: 0, conf: [] }; docs.push(d); }
      return d;
    };
    const sources = new Map(); // original PDF file → { src: PDFDocument, copied }
    try {
      for (const job of jobs) {
        await progress?.tick(job.pdf ? `${job.file.name}, ${t("page {n}", { n: job.n })}` : job.file.name);
        const out = target(job.file);
        let canvas, viewport = null;
        if (job.pdf) {
          const page = await job.pdf.getPage(job.n);
          viewport = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: DPI / 72 });
          canvas = makeCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
          const g = canvas.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
          page.cleanup();
        } else {
          const img = await loadImage(job.file);
          const d = dims(img), k = Math.min(1, 4200 / Math.max(d.w, d.h));
          canvas = makeCanvas(d.w * k, d.h * k);
          const g = canvas.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
          g.drawImage(img, 0, 0, canvas.width, canvas.height);
          if (img.close) img.close();
        }
        const { data } = await worker.recognize(canvas, {}, { text: true, tsv: wantPdf });
        const text = (data.text || "").trim();
        out.texts.push(text);
        if (text) out.conf.push(data.confidence || 0);
        const words = wantPdf ? wordsFromTsv(data.tsv) : [];
        out.words += text ? text.split(/\s+/).length : 0;

        if (wantPdf) {
          out.pdf ??= await PDFDocument.create();
          if (job.pdf) {
            // keep the original page as it is and lay the text over it
            if (!sources.has(job.file)) sources.set(job.file, await loadPdf(job.file));
            const [copy] = await out.pdf.copyPages(sources.get(job.file), [job.n - 1]);
            const page = out.pdf.addPage(copy);
            await textLayer(out.pdf, page, words, canvas.width, viewport.width, (x, y) => viewport.convertToPdfPoint(x, y), viewport.rotation || 0, out.fonts);
          } else {
            const k = 842 / Math.max(canvas.width, canvas.height); // long side = A4's long side
            const pw = canvas.width * k, ph = canvas.height * k;
            const page = out.pdf.addPage([pw, ph]);
            const jpg = await out.pdf.embedJpg(await (await canvasBlob(canvas, "image/jpeg", 0.85)).arrayBuffer());
            page.drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
            await textLayer(out.pdf, page, words, canvas.width, pw, (x, y) => [x, ph - y], 0, out.fonts);
          }
        }
      }
    } finally {
      for (const pdf of new Set(jobs.map((j) => j.pdf).filter(Boolean))) pdf.destroy().catch(() => {});
    }

    const results = [];
    let preview = "";
    for (const d of docs) {
      const text = d.texts.join("\n\n----\n\n").trim() + "\n";
      const conf = d.conf.length ? Math.round(d.conf.reduce((a, b) => a + b, 0) / d.conf.length) : 0;
      const note = d.words ? t("{words}, confidence {conf}%", { words: plural(d.words, "word"), conf }) : t("no text found");
      if (wantTxt) results.push({ name: `${d.name}.txt`, blob: new Blob([text], { type: "text/plain" }), note });
      if (wantPdf && d.pdf) results.push({ name: `${d.name}-searchable.pdf`, blob: pdfBlob(await d.pdf.save()), note: `${plural(d.pdf.getPageCount(), "page")} · ${note}` });
      preview += (preview ? "\n\n" : "") + text;
    }
    o.text.value = preview.length > 200_000 ? preview.slice(0, 200_000) + "\n…" : preview;
    return results;
  },
};

export const ocrTools = [ocrTool];
