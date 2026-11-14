// Previews for the file list: images through createImageBitmap, HEIC through the libheif worker (at low
// priority, so a conversion never waits behind thumbnails), PDFs through pdf.js (first page and page count).
import { pdfThumbnail } from "./tools/pdf.js";
import { isHeic, decodeHeic } from "./heic.js";
import { plural } from "./util.js";

const cache = new WeakMap();
/** Rendered size in px; the list shows it at half that, so it stays sharp on HiDPI screens. */
export const THUMB = 128;

function shrink(src, w, h) {
  const k = Math.min(1, THUMB / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** { canvas, info } for `file`: a canvas of at most THUMB px (or null) and a short note such as
 *  "4032 × 3024" or "12 pages" (or ""). Never rejects. Cached per File. */
export function preview(file) {
  if (cache.has(file)) return cache.get(file);
  const p = (async () => {
    try {
      if (file.type === "application/pdf") {
        const { canvas, pages } = await pdfThumbnail(file, THUMB);
        return { canvas, info: plural(pages, "page") };
      }
      if (isHeic(file)) {
        const [full] = await decodeHeic(file, { priority: "low" });
        return { canvas: shrink(full, full.width, full.height), info: `${full.width} × ${full.height}` };
      }
      if (!file.type.startsWith("image/")) return { canvas: null, info: "" };
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const out = { canvas: shrink(bmp, bmp.width, bmp.height), info: `${bmp.width} × ${bmp.height}` };
      bmp.close();
      return out;
    } catch (_) {
      return { canvas: null, info: "" };
    }
  })();
  cache.set(file, p);
  return p;
}

/** Just the thumbnail canvas, or null. */
export function thumbnail(file) {
  return preview(file).then((p) => p.canvas);
}
