// Remove metadata (EXIF, GPS, XMP, IPTC, comments) from JPEG, PNG and WebP without re-encoding the pixels.
import { el, formatBytes, baseName, plural } from "../util.js";

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

// ---------- EXIF viewer ----------

/** The TIFF block of the EXIF data in a JPEG (APP1), WebP (EXIF chunk) or PNG (eXIf chunk), or null. */
function findExif(b) {
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      if (marker === 0xda) break;
      const len = u16(b, i + 2);
      if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === "Exif") return b.subarray(i + 10, i + 2 + len);
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    let i = 8;
    while (i + 8 <= b.length) {
      const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
      if (String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]) === "eXIf") return b.subarray(i + 8, i + 8 + len);
      i += 12 + len;
    }
    return null;
  }
  if (b[0] === 0x52 && b[8] === 0x57) {
    let i = 12;
    while (i + 8 <= b.length) {
      const type = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
      const len = u32le(b, i + 4);
      if (type === "EXIF") { const p = b.subarray(i + 8, i + 8 + len); return String.fromCharCode(...p.subarray(0, 4)) === "Exif" ? p.subarray(6) : p; }
      i += 8 + len + (len & 1);
    }
  }
  return null;
}

/** Parses IFD0, the Exif sub-IFD and the GPS IFD into { tag: value } maps. */
function readTiff(t) {
  const le = t[0] === 0x49;
  const r16 = (i) => (le ? t[i] | (t[i + 1] << 8) : (t[i] << 8) | t[i + 1]);
  const r32 = (i) => (le ? u32le(t, i) : ((t[i] << 24) | (t[i + 1] << 16) | (t[i + 2] << 8) | t[i + 3]) >>> 0);
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const value = (type, count, at) => {
    if (type === 2) return String.fromCharCode(...t.subarray(at, at + count)).replace(/\0+$/, "").trim();
    const one = (k) => {
      if (type === 3) return r16(at + k * 2);
      if (type === 4) return r32(at + k * 4);
      if (type === 9) return r32(at + k * 4) | 0;
      if (type === 5) return r32(at + k * 8) / (r32(at + k * 8 + 4) || 1);
      if (type === 10) return (r32(at + k * 8) | 0) / ((r32(at + k * 8 + 4) | 0) || 1);
      return t[at + k];
    };
    return count === 1 ? one(0) : Array.from({ length: Math.min(count, 16) }, (_, k) => one(k));
  };
  const ifd = (offset) => {
    const out = {};
    if (!offset || offset + 2 > t.length) return out;
    const n = r16(offset);
    for (let k = 0; k < n; k++) {
      const e = offset + 2 + k * 12;
      if (e + 12 > t.length) break;
      const tag = r16(e), type = r16(e + 2), count = r32(e + 4);
      const size = (SIZE[type] || 1) * count;
      const at = size <= 4 ? e + 8 : r32(e + 8);
      if (at + size > t.length) continue;
      try { out[tag] = value(type, count, at); } catch (_) { /* skip a broken entry */ }
    }
    return out;
  };
  const ifd0 = ifd(r32(4));
  return { ifd0, exif: ifd0[0x8769] ? ifd(ifd0[0x8769]) : {}, gps: ifd0[0x8825] ? ifd(ifd0[0x8825]) : {} };
}

const ORIENTATION = { 1: "normal", 2: "mirrored", 3: "rotated 180°", 4: "flipped", 5: "transposed", 6: "rotated 90° CW", 7: "transversed", 8: "rotated 90° CCW" };

/** Human-readable rows [label, text, href?] for the EXIF of one file. */
export function exifRows(bytes) {
  const tiff = findExif(bytes);
  if (!tiff || tiff.length < 8) return [];
  let d;
  try { d = readTiff(tiff); } catch (_) { return [["EXIF", "present but unreadable"]]; }
  const { ifd0, exif, gps } = d;
  const rows = [];
  const camera = [ifd0[0x010f], ifd0[0x0110]].filter((v) => typeof v === "string" && v).join(" ");
  if (camera) rows.push(["Camera", camera]);
  if (typeof exif[0xa434] === "string" && exif[0xa434]) rows.push(["Lens", exif[0xa434]]);
  const date = exif[0x9003] || ifd0[0x0132];
  if (typeof date === "string" && date) rows.push(["Date taken", date.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")]);
  const parts = [];
  if (typeof exif[0x829a] === "number") parts.push(exif[0x829a] >= 1 ? `${exif[0x829a]} s` : `1/${Math.round(1 / exif[0x829a])} s`);
  if (typeof exif[0x829d] === "number") parts.push(`f/${exif[0x829d].toFixed(1).replace(/\.0$/, "")}`);
  if (exif[0x8827]) parts.push(`ISO ${Array.isArray(exif[0x8827]) ? exif[0x8827][0] : exif[0x8827]}`);
  if (typeof exif[0x920a] === "number") parts.push(`${Math.round(exif[0x920a])} mm`);
  if (parts.length) rows.push(["Exposure", parts.join(" · ")]);
  if (typeof ifd0[0x0131] === "string" && ifd0[0x0131]) rows.push(["Software", ifd0[0x0131]]);
  if (ifd0[0x0112] && ifd0[0x0112] !== 1) rows.push(["Orientation", ORIENTATION[ifd0[0x0112]] || String(ifd0[0x0112])]);
  const dms = (v, ref) => {
    if (!Array.isArray(v) || v.length < 2) return null;
    const deg = v[0] + (v[1] || 0) / 60 + (v[2] || 0) / 3600;
    return (ref === "S" || ref === "W" ? -deg : deg);
  };
  const lat = dms(gps[0x0002], gps[0x0001]), lon = dms(gps[0x0004], gps[0x0003]);
  if (lat != null && lon != null && (lat || lon)) {
    rows.push(["GPS location", `${lat.toFixed(5)}, ${lon.toFixed(5)}`, `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=15/${lat.toFixed(5)}/${lon.toFixed(5)}`]);
  }
  if (!rows.length) rows.push(["EXIF", "present (no camera, date or location fields)"]);
  return rows;
}

export const metadataTool = {
  id: "metadata",
  title: "Remove metadata",
  description: "Strip EXIF, GPS location, XMP, IPTC and comments from JPEG, PNG and WebP files. The pixels are copied as they are, so nothing is re-compressed.",
  accept: ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
  hint: "JPG, PNG, WebP — multiple files allowed",
  runLabel: "Remove metadata",
  renderOptions(root, files) {
    root.append(el("div", { class: "stat", text: `${plural(files.length, "file")}. Colour profiles are kept so the colours stay the same.` }));
    const box = el("div", { class: "options" });
    root.append(box);
    (async () => {
      for (const file of files.slice(0, 5)) {
        let rows = [];
        try { rows = exifRows(new Uint8Array(await file.arrayBuffer())); } catch (_) { rows = []; }
        const table = el("table", { class: "meta" }, rows.map(([k, v, href]) => el("tr", {}, [el("th", { text: k }), el("td", {}, [href ? el("a", { href, target: "_blank", rel: "noopener", text: v }) : v])])));
        box.append(el("div", {}, [el("div", { class: "stat", text: file.name }), rows.length ? table : el("div", { class: "stat", text: "No EXIF data." })]));
      }
      if (files.length > 5) box.append(el("div", { class: "stat", text: `… and ${files.length - 5} more` }));
    })();
  },
  async run(files, _root, progress) {
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
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
