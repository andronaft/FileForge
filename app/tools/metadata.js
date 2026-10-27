// Remove metadata (EXIF, GPS, XMP, IPTC, comments) from JPEG, PNG and WebP without re-encoding the pixels.
import { el, formatBytes, baseName } from "../util.js";

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function hasGps(exif) {
  // Exif APP1 payload: "Exif\0\0" + TIFF. Look for the GPS IFD pointer tag (0x8825) in IFD0.
  try {
    const t = exif.subarray(6);
    const le = t[0] === 0x49;
    const r16 = (i) => (le ? t[i] | (t[i + 1] << 8) : (t[i] << 8) | t[i + 1]);
    const r32 = (i) => (le ? u32le(t, i) : ((t[i] << 24) | (t[i + 1] << 16) | (t[i + 2] << 8) | t[i + 3]) >>> 0);
    const ifd = r32(4);
    const n = r16(ifd);
    for (let k = 0; k < n; k++) if (r16(ifd + 2 + k * 12) === 0x8825) return true;
  } catch (_) { /* malformed EXIF: just strip it */ }
  return false;
}

function cleanJpeg(b) {
  const parts = [b.subarray(0, 2)];
  const kinds = new Set();
  let gps = false;
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (marker === 0xda) break; // start of scan: the rest is image data
    const len = u16(b, i + 2);
    const seg = b.subarray(i, i + 2 + len);
    const payload = b.subarray(i + 4, i + 2 + len);
    const ascii = (n) => String.fromCharCode(...payload.subarray(0, n));
    let drop = false;
    if (marker === 0xe1) {
      if (ascii(4) === "Exif") { kinds.add("EXIF"); if (hasGps(payload)) { gps = true; kinds.add("GPS"); } drop = true; }
      else if (ascii(5) === "http:") { kinds.add("XMP"); drop = true; }
    } else if (marker === 0xed) { kinds.add("IPTC"); drop = true; }
    else if (marker === 0xfe) { kinds.add("comment"); drop = true; }
    else if (marker >= 0xe0 && marker <= 0xef && marker !== 0xe0 && marker !== 0xe2 && marker !== 0xee) { kinds.add("app data"); drop = true; }
    // kept: APP0 JFIF, APP2 ICC colour profile, APP14 Adobe (needed for correct colours), and everything else
    if (!drop) parts.push(seg);
    i += 2 + len;
  }
  parts.push(b.subarray(i));
  return { parts, kinds, gps };
}

function cleanPng(b) {
  const DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const parts = [b.subarray(0, 8)];
  const kinds = new Set();
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const chunk = b.subarray(i, i + 12 + len);
    if (DROP.has(type)) kinds.add(type === "eXIf" ? "EXIF" : type === "tIME" ? "timestamp" : "text");
    else parts.push(chunk);
    i += 12 + len;
    if (type === "IEND") break;
  }
  return { parts, kinds, gps: false };
}

function cleanWebp(b) {
  const DROP = new Set(["EXIF", "XMP "]);
  const body = [];
  const kinds = new Set();
  let i = 12;
  let vp8x = null;
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    const len = u32le(b, i + 4);
    const chunk = b.slice(i, i + 8 + len + (len & 1));
    if (DROP.has(type)) kinds.add(type.trim());
    else { if (type === "VP8X") vp8x = chunk; body.push(chunk); }
    i += 8 + len + (len & 1);
  }
  if (vp8x && kinds.size) vp8x[8] &= ~0x0c; // clear the EXIF (0x08) and XMP (0x04) flags
  const size = body.reduce((s, c) => s + c.length, 0) + 4;
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  head[4] = size & 255; head[5] = (size >> 8) & 255; head[6] = (size >> 16) & 255; head[7] = (size >> 24) & 255;
  head.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return { parts: [head, ...body], kinds, gps: false };
}

export const metadataTool = {
  id: "metadata",
  title: "Remove metadata",
  description: "Strip EXIF, GPS location, XMP, IPTC and comments from JPEG, PNG and WebP files. The pixels are copied as they are, so nothing is re-compressed.",
  accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Remove metadata",
  renderOptions(root, files) {
    root.append(el("div", { class: "stat", text: `${files.length} file${files.length === 1 ? "" : "s"}. Colour profiles are kept so the colours stay the same.` }));
  },
  async run(files) {
    const out = [];
    for (const file of files) {
      const b = new Uint8Array(await file.arrayBuffer());
      let r;
      if (b[0] === 0xff && b[1] === 0xd8) r = cleanJpeg(b);
      else if (b[0] === 0x89 && b[1] === 0x50) r = cleanPng(b);
      else if (b[0] === 0x52 && b[8] === 0x57) r = cleanWebp(b);
      else throw new Error(`${file.name}: not a JPEG, PNG or WebP file`);
      const blob = new Blob(r.parts, { type: file.type });
      const removed = file.size - blob.size;
      const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
      out.push({
        name: `${baseName(file.name)}-clean${ext}`, blob,
        note: r.kinds.size ? `removed ${[...r.kinds].join(", ")} (${formatBytes(removed)})` : "no metadata found",
      });
    }
    return out;
  },
};
