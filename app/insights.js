// What dropped files are beyond their type: the few facts that decide which tool the user needs.
// Each fact is { text (already translated), action (English, translated by el), tool, files }.
import { t, plural, formatBytes } from "./util.js";
import { pdfjsOpen } from "./tools/pdf.js";
import { exifRows } from "./tools/metadata.js";

const MB = 1024 * 1024;
const isPdf = (f) => f.type === "application/pdf";
const isImage = (f) => f.type.startsWith("image/");
const isVideo = (f) => f.type.startsWith("video/");

async function pdfFacts(file) {
  let doc;
  try { doc = await pdfjsOpen(new Uint8Array(await file.arrayBuffer())); }
  catch (err) {
    return err?.name === "PasswordException" ? [{ text: t("{name} opens only with a password", { name: file.name }), action: "Remove the password", tool: "pdf-unlock", files: [file] }] : [];
  }
  try {
    const out = [], n = doc.numPages;
    let chars = 0;
    for (let i = 1; i <= Math.min(3, n) && chars < 20; i++) chars += (await (await doc.getPage(i)).getTextContent()).items.reduce((s, it) => s + it.str.trim().length, 0);
    if (chars < 20) out.push({ text: t("A scan: {pages} with no text to select or search", { pages: plural(n, "page") }), action: "Make it searchable", tool: "ocr", files: [file] });
    const fields = await doc.getFieldObjects().catch(() => null), count = fields ? Object.keys(fields).length : 0;
    if (count) out.push({ text: t("A form with {n} fields", { n: count }), action: "Fill it in", tool: "pdf-form", files: [file] });
    if (file.size > 3 * MB) out.push({ text: t("{size}: large for e-mail and upload forms", { size: formatBytes(file.size) }), action: "Compress", tool: "pdf-compress", files: [file] });
    return out;
  } finally { await doc.destroy(); }
}

async function imageFacts(images) {
  const out = [], located = [];
  for (const f of images.slice(0, 40)) {
    if (f.type !== "image/jpeg") continue;
    // EXIF sits at the start of the file; a damaged or cut block is simply not counted
    try { if (exifRows(new Uint8Array(await f.slice(0, 256 * 1024).arrayBuffer())).some(([k]) => k === "GPS location")) located.push(f); } catch (_) { /* no readable EXIF */ }
  }
  if (located.length) {
    out.push({
      text: images.length === 1 ? t("This photo says where it was taken") : t("{n} of {total} photos say where they were taken", { n: located.length, total: images.length }),
      action: "Remove the location", tool: "metadata", files: images.filter((f) => /jpeg|png|webp/.test(f.type)),
    });
  }
  if (images.length === 1 && "BarcodeDetector" in window && images[0].size < 20 * MB && !/heic|heif|svg/.test(images[0].type)) {
    try {
      const bmp = await createImageBitmap(images[0]);
      const codes = await new window.BarcodeDetector().detect(bmp);
      bmp.close();
      if (codes.length) out.push({ text: t("There is a QR code or barcode in this picture"), action: "Read it", tool: "qr-read", files: images });
    } catch (_) { /* not decodable here: no hint */ }
  }
  const total = images.reduce((s, f) => s + f.size, 0);
  if (total > 5 * MB) out.push({ text: t("{size} in {files}: large for e-mail and upload forms", { size: formatBytes(total), files: plural(images.length, "file") }), action: "Compress", tool: "compress", files: images });
  return out;
}

/** Facts about the files, most useful first. Never throws; gives up after `budget` ms so the chooser is not held up. */
export async function insights(files, budget = 2500) {
  const work = (async () => {
    const out = [], pdfs = files.filter(isPdf), images = files.filter(isImage);
    if (pdfs.length && images.length) out.push({ text: t("Photos and PDFs together"), action: "Make one PDF", tool: "pdf-pack", files: files.filter((f) => isPdf(f) || isImage(f)) });
    if (pdfs.length === 1) out.push(...await pdfFacts(pdfs[0]).catch(() => []));
    if (images.length) out.push(...await imageFacts(images).catch(() => []));
    const videos = files.filter(isVideo), vsize = videos.reduce((s, f) => s + f.size, 0);
    if (videos.length && vsize > 16 * MB) out.push({ text: t("{size}: too big for most messengers and e-mail", { size: formatBytes(vsize) }), action: "Compress", tool: "video-compress", files: videos });
    if (videos.some((f) => /quicktime|matroska/.test(f.type) || /\.(mov|mkv)$/i.test(f.name))) out.push({ text: t("MOV and MKV do not play everywhere"), action: "Convert to MP4", tool: "video-convert", files: videos });
    return out.slice(0, 3);
  })();
  return Promise.race([work, new Promise((res) => setTimeout(() => res([]), budget))]).catch(() => []);
}
