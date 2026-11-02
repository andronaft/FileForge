// Small previews for the file list: images through createImageBitmap, PDFs through pdf.js (first page).
import { pdfThumbnail } from "./tools/pdf.js";

const cache = new WeakMap();
export const THUMB = 56;

/** A canvas of at most THUMB × THUMB px for `file`, or null when it cannot be previewed. Cached per File. */
export function thumbnail(file) {
  if (cache.has(file)) return cache.get(file);
  const p = (async () => {
    try {
      if (file.type === "application/pdf") return await pdfThumbnail(file, THUMB);
      if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif") return null;
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const k = Math.min(1, THUMB / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return c;
    } catch (_) {
      return null;
    }
  })();
  cache.set(file, p);
  return p;
}
