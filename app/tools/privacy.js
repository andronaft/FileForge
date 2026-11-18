// Privacy check: what a file gives away beyond what you see in it (a location, names, software, history, hidden
// parts), and cleaned copies. The report never says "clean": it lists what was looked for and what was found.
import { el, checkbox, formatBytes, baseName, plural, t } from "../util.js";
import { exifRows, cleanImage } from "./metadata.js";
import { loadPdf, stripMetadata, sweepPdf, infoRows } from "./pdf.js";

// ---- pure:start ---- Everything down to pure:end works on bytes and parsed packages, and is tested in node.

const clip = (s, n = 300) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };
const uniq = (list) => [...new Set(list.map((s) => clip(s, 120)).filter(Boolean))];
const utf8 = (b) => new TextDecoder().decode(b);
const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, Math.min(to, from + 4096)));
const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const le32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function indexOf(b, word, from = 0) {
  const c = [...word].map((ch) => ch.charCodeAt(0));
  outer: for (let i = b.indexOf(c[0], from); i >= 0 && i + c.length <= b.length; i = b.indexOf(c[0], i + 1)) {
    for (let k = 1; k < c.length; k++) if (b[i + k] !== c[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * One finding. sev: "high" (a person, a place, or content the reader is not meant to see), "medium" (a device,
 * software, the file's history), "info". fix: "auto" (Clean copies removes it), the name of an option that does,
 * or "manual" (stays in the file). key: stable id, used to check a cleaned copy against the original report.
 */
const F = (sev, key, label, value = "", extra) => ({ sev, key, label, value: clip(value), fix: "auto", ...extra });
const MANUAL = { fix: "manual" };

function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (indexOf(b.subarray(0, 1024), "%PDF-") >= 0) return "pdf";
  return b[0] === 0x50 && b[1] === 0x4b ? "zip" : null;
}

// ---------- pictures ----------

function* jpegSegments(b) {
  for (let i = 2; i + 4 <= b.length && b[i] === 0xff && b[i + 1] !== 0xda;) {
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    yield [m, b.subarray(i + 4, i + 2 + len)];
    i += 2 + len;
  }
}

/** [width, height] from the frame header of a JPEG, or null. */
function jpegSize(b) {
  for (const [m, p] of jpegSegments(b)) if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(p[3] << 8) | p[4], (p[1] << 8) | p[2]];
  return null;
}

/** The thumbnail is the one finding that is shown: a stale one still has what was cropped out of the picture. */
function thumbFinding(key, thumb, size) {
  const ts = jpegSize(thumb), ratio = size && size[0] / size[1];
  const cut = ts && ratio && Math.abs(ts[0] / ts[1] - ratio) > 0.05 && Math.abs(ts[1] / ts[0] - ratio) > 0.05;
  return F(cut ? "high" : "medium", key, "Embedded thumbnail", ts ? `${ts[0]} × ${ts[1]} px` : formatBytes(thumb.length), {
    thumb, why: cut ? "A small copy of the picture kept inside the file. Its shape differs from the picture itself, so it may still show the photo as it was before cropping."
      : "A small copy of the picture kept inside the file. It can still show the photo as it was before cropping or editing.",
  });
}

/** What exifRows() does not read from a TIFF block: who made the picture, the camera's serial number, and IFD1's thumbnail. */
function tiffExtras(tf) {
  const le = tf[0] === 0x49;
  const r16 = (i) => (le ? tf[i] | (tf[i + 1] << 8) : (tf[i] << 8) | tf[i + 1]), r32 = (i) => (le ? le32(tf, i) : be32(tf, i));
  const ifd = (off) => {
    const m = new Map();
    if (!off || off + 2 > tf.length) return m;
    const n = r16(off);
    for (let k = 0, e = off + 2; k < n && e + 12 <= tf.length; k++, e += 12) m.set(r16(e), { type: r16(e + 2), count: r32(e + 4), at: e + 8 });
    m.next = off + 6 + n * 12 <= tf.length ? r32(off + 2 + n * 12) : 0;
    return m;
  };
  const num = (m, tag) => { const e = m.get(tag); return e ? (e.type === 3 ? r16(e.at) : r32(e.at)) : 0; };
  const str = (m, tag) => {
    const e = m.get(tag);
    if (!e || e.type !== 2) return "";
    const at = e.count <= 4 ? e.at : r32(e.at);
    return utf8(tf.subarray(at, at + Math.min(e.count, 400))).replace(/\0[\s\S]*$/, "").trim();
  };
  const ifd0 = ifd(r32(4)), sub = ifd(num(ifd0, 0x8769)), ifd1 = ifd(ifd0.next);
  const at = num(ifd1, 0x0201), len = num(ifd1, 0x0202);
  return {
    author: uniq([str(ifd0, 0x013b), str(sub, 0xa430), str(ifd0, 0x8298)]).join(", "), serial: str(sub, 0xa431), description: str(ifd0, 0x010e),
    thumb: at && len > 16 && at + len <= tf.length && tf[at] === 0xff && tf[at + 1] === 0xd8 ? tf.slice(at, at + len) : null,
  };
}

const EXIF_SEV = { "GPS location": "high", Camera: "medium", "Date taken": "medium", Software: "medium" };
function exifFindings(b, tiff, size, hasGps) {
  // Orientation is the one tag a cleaned copy keeps on purpose, so it is not a finding.
  const out = exifRows(b).filter(([k]) => k !== "Orientation").map(([k, v]) => F(EXIF_SEV[k] || "info", `exif:${k}`, k, v.startsWith("present") ? t(v) : v));
  if (hasGps && !out.some((f) => f.key === "exif:GPS location")) out.push(F("medium", "exif:gps-block", "GPS data", t("present, without coordinates")));
  if (!tiff || tiff.length < 8) return out;
  try {
    const x = tiffExtras(tiff);
    if (x.author) out.push(F("high", "exif:author", "Author", x.author));
    if (x.serial) out.push(F("medium", "exif:serial", "Camera serial number", x.serial));
    if (x.description) out.push(F("info", "exif:description", "Description", x.description));
    if (x.thumb) out.push(thumbFinding("exif:thumb", x.thumb, size));
  } catch (_) { /* a damaged block: exifRows already says it is there */ }
  return out;
}

/** The fields worth showing from an XMP packet, read from its text: a full RDF parse is not needed to see who and with what. */
function xmpFindings(text, pre = "xmp") {
  const plain = (s) => s.replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e]);
  const pick = (re) => clip(plain(text.match(re)?.[1] || ""));
  const out = [F("info", `${pre}:packet`, "XMP metadata", formatBytes(text.length))];
  const add = (sev, key, label, value) => { if (value) out.push(F(sev, `${pre}:${key}`, label, value)); };
  add("high", "creator", "Author", pick(/<dc:creator>([\s\S]*?)<\/dc:creator>/));
  add("high", "gps", "GPS location", [pick(/exif:GPSLatitude(?:>|=")([^<"]*)/), pick(/exif:GPSLongitude(?:>|=")([^<"]*)/)].filter(Boolean).join(", "));
  add("medium", "tool", "Created with", pick(/xmp:CreatorTool(?:>|=")([^<"]*)/));
  const steps = (text.match(/<stEvt:action>|stEvt:action="/g) || []).length;
  add("medium", "history", "Editing history", steps ? plural(steps, "step") : pick(/<photoshop:History>([\s\S]*?)<\/photoshop:History>/));
  return out;
}

/** IPTC records and the Photoshop thumbnail from an APP13 segment: "8BIM" blocks of id, padded name, size, padded data. */
function iptcFindings(p, size) {
  const out = [], got = {};
  let i = ascii(p, 0, 13) === "Photoshop 3.0" ? 14 : 0;
  while (i + 12 <= p.length && ascii(p, i, i + 4) === "8BIM") {
    const id = (p[i + 4] << 8) | p[i + 5], at = i + 6 + ((p[i + 6] + 2) & ~1), len = be32(p, at), data = p.subarray(at + 4, at + 4 + len);
    if (id === 0x0404) for (let j = 0; j + 5 <= data.length && data[j] === 0x1c;) {
      const n = (data[j + 3] << 8) | data[j + 4];
      if (n & 0x8000) break;
      if (data[j + 1] === 2) (got[data[j + 2]] ??= []).push(utf8(data.subarray(j + 5, j + 5 + n)));
      j += 5 + n;
    }
    if (id === 0x040c && data[28] === 0xff && data[29] === 0xd8) out.push(thumbFinding("iptc:thumb", data.slice(28), size));
    i = at + 4 + len + (len & 1);
  }
  const add = (sev, key, label, ...tags) => { const v = uniq(tags.flatMap((n) => got[n] || [])).join(", "); if (v) out.push(F(sev, `iptc:${key}`, label, v)); };
  add("high", "author", "Author", 80, 110, 116);
  add("high", "place", "Place", 92, 90, 95, 101);
  add("info", "caption", "Description", 5, 105, 120, 25);
  return out.length ? out : [F("info", "iptc:data", "IPTC data", t("present"))];
}

function tailFinding(b, end) {
  if (b.length - end <= 16) return [];
  const video = indexOf(b, "ftyp", end) >= 0;
  return [F(video ? "high" : "medium", "tail", "Data after the end of the picture", formatBytes(b.length - end), {
    why: video ? "This looks like the video of a motion photo: a few seconds of picture and sound around the shot."
      : "Something is stored after the picture: usually a preview, a depth map or a second photo.",
  })];
}

function inspectJpeg(b) {
  const out = [], size = jpegSize(b), c = cleanImage(b), last = c.parts[c.parts.length - 1];
  let tiff = null;
  for (const [m, p] of jpegSegments(b)) {
    const head = ascii(p, 0, 29);
    if (m === 0xe1 && head.startsWith("Exif")) tiff ??= p.subarray(6);
    else if (m === 0xe1 && head.startsWith("http://ns.adobe.com/xap/")) out.push(...xmpFindings(utf8(p.subarray(29))));
    else if (m === 0xed) out.push(...iptcFindings(p, size));
    else if (m === 0xfe) out.push(F("info", "comment", "Comment", utf8(p)));
  }
  if (c.kinds.has("app data")) out.push(F("info", "appdata", "Other embedded data", t("app data")));
  return [...exifFindings(b, tiff, size, c.gps), ...out, ...tailFinding(b, last.byteOffset - b.byteOffset + last.length)];
}

function inspectPng(b) {
  const out = [], two = (n) => String(n).padStart(2, "0");
  let i = 8, tiff = null, ended = false;
  while (i + 12 <= b.length && !ended) {
    const len = be32(b, i), type = ascii(b, i + 4, i + 8), d = b.subarray(i + 8, i + 8 + len);
    i += 12 + len;
    if (type === "IEND") ended = true;
    else if (type === "eXIf") tiff = d;
    else if (type === "tIME") out.push(F("medium", "png:time", "Modified", `${(d[0] << 8) | d[1]}-${two(d[2])}-${two(d[3])} ${two(d[4])}:${two(d[5])}`));
    else if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const z = Math.max(0, d.indexOf(0)), key = ascii(d, 0, z);
      let text = t("compressed text");
      if (type === "tEXt") text = ascii(d, z + 1, d.length);
      else if (type === "iTXt" && d[z + 1] === 0) text = utf8(d.subarray(d.indexOf(0, d.indexOf(0, z + 3) + 1) + 1));
      if (key === "XML:com.adobe.xmp") out.push(...xmpFindings(text));
      else out.push(F(/author|artist|creator|copyright|owner|by-?line/i.test(key) ? "high" : "medium", `png:${key}`, "Text note", `${key}: ${text}`));
    }
  }
  return [...exifFindings(b, tiff, null, false), ...out, ...(ended ? tailFinding(b, i) : [])];
}

const webpEnd = (b) => Math.min(b.length, 8 + le32(b, 4) + (le32(b, 4) & 1));
function inspectWebp(b) {
  const out = [], end = webpEnd(b);
  let tiff = null;
  for (let i = 12; i + 8 <= end;) {
    const type = ascii(b, i, i + 4), len = le32(b, i + 4), d = b.subarray(i + 8, i + 8 + len);
    if (type === "EXIF") tiff = ascii(d, 0, 4) === "Exif" ? d.subarray(6) : d;
    else if (type === "XMP ") out.push(...xmpFindings(utf8(d)));
    i += 8 + len + (len & 1);
  }
  return [...exifFindings(b, tiff, null, false), ...out, ...tailFinding(b, end)];
}

// ---------- PDF ----------

const PDF_SEV = { Author: "high", "Created with": "medium", Producer: "medium", Created: "medium", Modified: "medium" };
const PDF_INFO = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate", "Trapped"];
// Annotations that are part of the page rather than somebody's remark on it; attachments have their own option.
const NOT_COMMENTS = new Set(["Link", "Widget", "FileAttachment", "Screen", "Movie", "3D", "RichMedia", "PrinterMark", "TrapNet", "Watermark"]);

/** Low-level reading of a pdf-lib document: typed lookups, name trees, the annotations of every page, every dictionary. */
function pdfAccess(doc) {
  const { PDFName, PDFDict, PDFArray, PDFStream } = PDFLib, ctx = doc.context, N = (k) => PDFName.of(k);
  const dict = (o) => { o = ctx.lookup(o); return o instanceof PDFDict ? o : null; };
  const list = (o) => { o = ctx.lookup(o); return o instanceof PDFArray ? o.asArray() : []; };
  const text = (o) => { try { return ctx.lookup(o)?.decodeText?.() ?? ""; } catch (_) { return ""; } };
  const kind = (d, key = "Subtype") => { const v = d && ctx.lookup(d.get(N(key))); return v instanceof PDFName ? v.decodeText() : ""; };
  const tree = (node, out = [], depth = 0) => {
    const d = dict(node), names = list(d?.get(N("Names")));
    if (!d || depth > 16) return out;
    for (let i = 0; i + 1 < names.length; i += 2) out.push([text(names[i]), dict(names[i + 1])]);
    for (const k of list(d.get(N("Kids")))) tree(k, out, depth + 1);
    return out;
  };
  const annots = () => doc.getPages().flatMap((page) => list(page.node.get(N("Annots"))).map(dict).filter(Boolean));
  const each = (fn) => {
    const visit = (o, depth) => {
      if (o instanceof PDFStream) o = o.dict;
      if (o instanceof PDFDict) { fn(o); if (depth < 12) for (const [, v] of o.entries()) visit(v, depth + 1); }
      else if (o instanceof PDFArray && depth < 12) for (const v of o.asArray()) visit(v, depth + 1);
    };
    for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj, 0);
  };
  const fileName = (spec, fallback) => text(spec?.get(N("UF"))) || text(spec?.get(N("F"))) || fallback;
  return { N, dict, list, text, kind, tree, annots, each, fileName, names: dict(doc.catalog.get(N("Names"))) };
}

function inspectPdfDoc(doc) {
  const p = pdfAccess(doc), { N } = p, out = [];
  let rows;
  try { rows = infoRows(doc); } catch (_) { rows = [["Document properties", "present but unreadable"]]; }
  for (const [k, v] of rows) out.push(F(PDF_SEV[k] || "info", `pdf:${k}`, k, /^present/.test(v) ? t(v) : v));
  const info = p.dict(doc.context.trailerInfo.Info);
  const other = (info ? info.keys().map((k) => k.decodeText()) : []).filter((k) => !PDF_INFO.includes(k));
  if (other.length) out.push(F("medium", "pdf:other", "Other document properties", other.map((k) => `${k}: ${p.text(info.get(N(k)))}`).join("; ")));
  try {
    const meta = doc.context.lookup(doc.catalog.get(N("Metadata")));
    if (meta) for (const f of xmpFindings(utf8(PDFLib.decodePDFRawStream(meta).decode()), "pdfxmp").slice(1)) if (!out.some((o) => o.label === f.label && o.value === f.value)) out.push(f);
  } catch (_) { /* a packet that cannot be decoded is still listed as present */ }
  const notes = p.annots().filter((d) => !NOT_COMMENTS.has(p.kind(d)) && p.kind(d) !== "Popup");
  const who = uniq(notes.map((d) => p.text(d.get(N("T"))))).join(", ");
  if (notes.length) out.push(F(who ? "high" : "medium", "pdf:comments", "Comments and highlights", plural(notes.length, "mark") + (who ? ` · ${who}` : ""), { fix: "comments" }));
  const files = [...p.tree(p.names?.get(N("EmbeddedFiles"))).map(([name, spec]) => p.fileName(spec, name)),
    ...p.annots().filter((d) => p.kind(d) === "FileAttachment").map((d) => p.fileName(p.dict(d.get(N("FS"))), "?"))];
  if (files.length) out.push(F("medium", "pdf:attachments", "Attached files", uniq(files).join(", "), { fix: "attachments" }));
  let scripts = 0;
  p.each((d) => { if (p.kind(d, "S") === "JavaScript") scripts++; });
  if (scripts) out.push(F("medium", "pdf:scripts", "Scripts", plural(scripts, "script"), { fix: "scripts" }));
  const filled = [];
  const walk = (ref, path = [], depth = 0) => {
    const d = p.dict(ref), v = doc.context.lookup(d?.get(N("V")));
    if (!d || depth > 16) return;
    const name = [...path, p.text(d.get(N("T")))].filter(Boolean);
    if (v && v !== N("Off") && !(v.decodeText && !p.text(v))) filled.push(name.join("."));
    for (const k of p.list(d.get(N("Kids")))) walk(k, name, depth + 1);
  };
  for (const f of p.list(p.dict(doc.catalog.get(N("AcroForm")))?.get(N("Fields")))) walk(f);
  if (filled.length) out.push(F("info", "pdf:form", "Filled form fields", uniq(filled).join(", ") || plural(filled.length, "field"), MANUAL));
  const off = p.list(p.dict(p.dict(doc.catalog.get(N("OCProperties")))?.get(N("D")))?.get(N("OFF")));
  if (off.length) out.push(F("high", "pdf:layers", "Hidden layers", uniq(off.map((r) => p.text(p.dict(r)?.get(N("Name"))))).join(", ") || plural(off.length, "layer"), MANUAL));
  return out;
}

/** Each save on top of an existing PDF appends a new "%%EOF" and leaves the older state of the document in front of it. */
function inspectPdfBytes(b, doc) {
  const count = (bytes) => { let n = 0; for (let i = indexOf(bytes, "%%EOF"); i >= 0; i = indexOf(bytes, "%%EOF", i + 5)) n++; return n; };
  let n = count(b) - (indexOf(b.subarray(0, 1024), "/Linearized") >= 0 ? 1 : 0); // a web-optimised file has two by design
  // The marker also occurs inside a stream that holds another PDF as it is (an attachment): that is not a save of this file.
  if (n > 1 && doc) for (const [, obj] of doc.context.enumerateIndirectObjects()) if (obj.contents instanceof Uint8Array) n -= count(obj.contents);
  return n > 1 ? [F("medium", "pdf:history", "Earlier versions inside the file", t("saved {n} times", { n }), {
    why: "The file was saved several times on top of itself, so text and pictures that were later changed or deleted may still be inside.",
  })] : [];
}

async function cleanPdf(doc, opt = {}) {
  const p = pdfAccess(doc), { N } = p;
  stripMetadata(doc);
  // A pop-up window goes with the annotation it belongs to, not on its own.
  const goes = (d, depth = 0) => {
    const sub = p.kind(d), parent = sub === "Popup" && depth < 2 ? p.dict(d.get(N("Parent"))) : null;
    return parent ? goes(parent, depth + 1) : sub === "FileAttachment" ? !!opt.attachments : !!opt.comments && !NOT_COMMENTS.has(sub);
  };
  if (opt.comments || opt.attachments) for (const page of doc.getPages()) {
    const refs = p.list(page.node.get(N("Annots"))), gone = refs.filter((ref) => goes(p.dict(ref))), keep = refs.filter((ref) => !gone.includes(ref));
    // Emptied as well as unlisted: the structure tree of a tagged PDF may still point at the object.
    for (const ref of gone) { const d = p.dict(ref); if (d) for (const k of d.keys()) d.delete(k); }
    if (!keep.length) page.node.delete(N("Annots")); else if (keep.length < refs.length) page.node.set(N("Annots"), doc.context.obj(keep));
  }
  if (opt.attachments) {
    p.names?.delete(N("EmbeddedFiles"));
    doc.catalog.delete(N("Collection"));
    p.each((d) => d.delete(N("AF")));
  }
  if (opt.scripts) {
    const js = (o, depth = 0) => { const d = p.dict(o); return depth > 8 ? false : d ? p.kind(d, "S") === "JavaScript" || js(d.get(N("Next")), depth + 1) : p.list(o).some((x) => js(x, depth + 1)); };
    p.names?.delete(N("JavaScript"));
    p.each((d) => { d.delete(N("AA")); for (const k of ["A", "OpenAction", "Next"]) if (d.has(N(k)) && js(d.get(N(k)))) d.delete(N(k)); });
  }
  sweepPdf(doc);
  return doc.save({ useObjectStreams: true, updateMetadata: false });
}

// ---------- Word, Excel, PowerPoint ----------

const CORE = [["creator", "high", "Author"], ["lastModifiedBy", "high", "Last edited by"], ["title", "info", "Title"], ["subject", "info", "Subject"], ["description", "info", "Description"],
  ["keywords", "info", "Keywords"], ["category", "info", "Category"], ["created", "medium", "Created"], ["modified", "medium", "Modified"], ["lastPrinted", "medium", "Last printed"], ["revision", "medium", "Number of saves"]];
const APP = [["Company", "high", "Company"], ["Manager", "high", "Manager"], ["HyperlinkBase", "medium", "Base address of links"], ["Template", "medium", "Template"], ["TotalTime", "medium", "Editing time (minutes)"]];
const BIG_XML = 8e6;
const xml = (s) => new DOMParser().parseFromString(s.replace(/^\uFEFF/, "") || "<none/>", "application/xml"); // a byte order mark before the declaration is a parse error
const all = (doc, name) => [...doc.getElementsByTagNameNS("*", name)];

/** The elements called `name` (any prefix) as attribute readers. A part too big to parse comfortably is scanned as text. */
function tags(text, name) {
  if (text.length > BIG_XML) {
    return [...text.matchAll(new RegExp(`<(?:[\\w.-]+:)?${name}(?=[\\s/>])([^>]*)>`, "g"))].map((m) => (a) => m[1].match(new RegExp(`(?:^|[\\s:])${a}="([^"]*)"`))?.[1] ?? null);
  }
  return all(xml(text), name).map((e) => (a) => [...e.attributes].find((x) => x.localName === a)?.value ?? null);
}

/** Where the package keeps its property parts, from the root relationships. */
async function ooxmlPaths(zip) {
  const rels = tags(await (zip.file("_rels/.rels")?.async("string") ?? ""), "Relationship");
  const of = (type, fallback) => rels.find((a) => (a("Type") || "").endsWith(type))?.("Target").replace(/^\//, "") ?? fallback;
  return { core: of("/core-properties", "docProps/core.xml"), app: of("/extended-properties", "docProps/app.xml"), custom: of("/custom-properties", "docProps/custom.xml"), thumb: of("/thumbnail", null) };
}

/** { kind, findings } for a DOCX, XLSX or PPTX package opened with JSZip; null for any other ZIP. */
async function inspectOoxml(zip) {
  const kind = zip.file("word/document.xml") ? "docx" : zip.file("xl/workbook.xml") ? "xlsx" : zip.file("ppt/presentation.xml") ? "pptx" : null;
  if (!kind) return null;
  const out = [], paths = await ooxmlPaths(zip);
  const read = async (path) => (path && zip.file(path) ? zip.file(path).async("string") : "");
  const parts = (re) => Promise.all(zip.file(re).map((f) => f.async("string")));
  const counted = (n, word, who) => plural(n, word) + (who ? ` · ${who}` : "");
  for (const [path, table] of [[paths.core, CORE], [paths.app, APP]]) {
    const doc = xml(await read(path)), val = (tag) => all(doc, tag)[0]?.textContent.trim() || "";
    for (const [tag, sev, label] of table) {
      const v = val(tag);
      if (v && !(tag === "revision" && Number(v) <= 1) && !(tag === "TotalTime" && !Number(v))) out.push(F(sev, `prop:${tag}`, label, v));
    }
    if (table === APP && val("Application")) out.push(F("info", "prop:Application", "Software", `${val("Application")} ${val("AppVersion")}`, MANUAL));
  }
  const custom = all(xml(await read(paths.custom)), "property").map((e) => `${e.getAttribute("name")} = ${e.textContent.trim()}`);
  if (custom.length) out.push(F("medium", "prop:custom", "Custom properties", custom.join("; ")));
  if (paths.thumb && zip.file(paths.thumb)) {
    const b = await zip.file(paths.thumb).async("uint8array");
    out.push(F("medium", "prop:thumb", "Embedded thumbnail", formatBytes(b.length), { thumb: (b[0] === 0xff && b[1] === 0xd8) || b[0] === 0x89 ? b : null, why: "A small picture of the first page saved with the file. It may show an older version of the document." }));
  }
  if (zip.file(/vbaProject\.bin$/i).length) out.push(F("medium", "ooxml:macros", "Macros", t("present"), MANUAL));
  if (kind === "docx") {
    const body = await parts(/^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/), of = (...names) => body.flatMap((x) => names.flatMap((n) => tags(x, n)));
    const ins = of("ins", "moveTo"), del = of("del", "moveFrom"), who = uniq([...ins, ...del].map((a) => a("author"))).join(", ");
    if (ins.length + del.length) out.push(F("high", "docx:changes", "Tracked changes", t("inserted: {ins}, deleted: {del}", { ins: ins.length, del: del.length }) + (who ? ` · ${who}` : ""), { ...MANUAL, why: "Deleted text is still in the file: anyone can read it by showing the tracked changes." }));
    const hidden = of("vanish").filter((a) => !/^(0|false|off)$/.test(a("val") || "")).length;
    if (hidden) out.push(F("high", "docx:hidden", "Hidden text", plural(hidden, "fragment"), MANUAL));
    const notes = tags(await read("word/comments.xml"), "comment");
    if (notes.length) out.push(F("high", "docx:comments", "Comments", counted(notes.length, "comment", uniq(notes.map((a) => a("author"))).join(", ")), MANUAL));
    const people = uniq(tags(await read("word/people.xml"), "person").map((a) => a("author"))).join(", ");
    if (people) out.push(F("high", "docx:people", "People named in the file", people, MANUAL));
  } else if (kind === "xlsx") {
    const book = xml(await read("xl/workbook.xml"));
    const hidden = all(book, "sheet").filter((e) => /hidden/i.test(e.getAttribute("state") || "")).map((e) => (e.getAttribute("state") === "veryHidden" ? t("{name} (very hidden)", { name: e.getAttribute("name") }) : e.getAttribute("name")));
    if (hidden.length) out.push(F("high", "xlsx:hidden", "Hidden sheets", hidden.join(", "), MANUAL));
    const links = (await parts(/^xl\/externalLinks\/_rels\/[^/]+\.rels$/)).flatMap((x) => tags(x, "Relationship").map((a) => a("Target")));
    if (links.length) out.push(F("high", "xlsx:links", "Links to other files", uniq(links).join(", "), MANUAL));
    // '[Budget.xlsx]Sheet1'!A1 or [1]Sheet1!A1 point outside the workbook; Table1[Column] does not.
    const names = all(book, "definedName").filter((e) => /\[[^\]]+\][^![\]]*!/.test(e.textContent)).map((e) => e.getAttribute("name"));
    if (names.length) out.push(F("medium", "xlsx:names", "Names that point to other files", uniq(names).join(", "), MANUAL));
    const notes = await parts(/^xl\/(comments\d*|threadedComments\/[^/]+)\.xml$/), count = notes.flatMap((x) => [...tags(x, "comment"), ...tags(x, "threadedComment")]).length;
    const who = uniq([...notes.flatMap((x) => all(xml(x), "author").map((e) => e.textContent)), ...tags(await read("xl/persons/person.xml"), "person").map((a) => a("displayName"))].filter((s) => s && !s.startsWith("tc="))).join(", ");
    if (count) out.push(F("high", "xlsx:comments", "Comments", counted(count, "comment", who), MANUAL));
  } else {
    const noted = (await parts(/^ppt\/notesSlides\/[^/]+\.xml$/)).filter((x) => all(xml(x), "t").some((e) => e.parentNode.localName !== "fld" && e.textContent.trim())).length;
    if (noted) out.push(F("high", "pptx:notes", "Speaker notes", plural(noted, "slide"), MANUAL));
    const hidden = (await parts(/^ppt\/slides\/[^/]+\.xml$/)).filter((x) => /<(?:\w+:)?sld\s[^>]*\bshow="(0|false)"/.test(x.slice(0, 4000))).length;
    if (hidden) out.push(F("high", "pptx:hidden", "Hidden slides", plural(hidden, "slide"), MANUAL));
    const count = (await parts(/^ppt\/comments\/[^/]+\.xml$/)).flatMap((x) => tags(x, "cm")).length;
    const who = uniq([...tags(await read("ppt/commentAuthors.xml"), "cmAuthor"), ...tags(await read("ppt/authors.xml"), "author")].map((a) => a("name"))).join(", ");
    if (count || who) out.push(F("high", "pptx:comments", "Comments", count ? counted(count, "comment", who) : who, MANUAL));
  }
  return { kind, findings: out };
}

/** Empties the property parts in place. Comments, tracked changes and hidden parts are document content and stay. */
async function cleanOoxml(zip) {
  const paths = await ooxmlPaths(zip);
  const edit = async (path, fn) => {
    if (!path || !zip.file(path)) return;
    const doc = xml(await zip.file(path).async("string"));
    if (all(doc, "parsererror").length) return;
    fn(doc);
    zip.file(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${new XMLSerializer().serializeToString(doc.documentElement)}`);
  };
  await edit(paths.core, (doc) => {
    for (const e of [...doc.documentElement.children]) {
      if (/^(created|modified|lastPrinted)$/.test(e.localName)) e.remove(); // an empty date is not valid, an absent one is
      else if (CORE.some(([tag]) => tag === e.localName)) e.textContent = e.localName === "revision" ? "1" : "";
    }
  });
  await edit(paths.app, (doc) => { for (const e of [...doc.documentElement.children]) if (APP.some(([tag]) => tag === e.localName)) e.textContent = e.localName === "TotalTime" ? "0" : ""; });
  for (const path of [paths.custom, paths.thumb]) {
    if (!path || !zip.file(path)) continue;
    zip.remove(path);
    await edit("[Content_Types].xml", (doc) => { for (const e of all(doc, "Override")) if (e.getAttribute("PartName") === `/${path}`) e.remove(); });
    await edit("_rels/.rels", (doc) => { for (const e of all(doc, "Relationship")) if ((e.getAttribute("Target") || "").replace(/^\//, "") === path) e.remove(); });
  }
}

// ---------- any file ----------

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

/** { kind, findings } for the bytes of a file; kind is null when this is not a kind of file the tool reads. `doc` is the pdf-lib document when the caller has one. */
async function inspect(bytes, doc) {
  const kind = sniff(bytes);
  if (kind === "pdf") {
    doc ||= await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    return { kind, findings: [...inspectPdfDoc(doc), ...inspectPdfBytes(bytes, doc)] };
  }
  if (kind === "zip") return (await inspectOoxml(await JSZip.loadAsync(bytes))) || { kind: null, findings: [] };
  return { kind, findings: kind === "jpeg" ? inspectJpeg(bytes) : kind === "png" ? inspectPng(bytes) : kind === "webp" ? inspectWebp(bytes) : [] };
}

/** The cleaned file as Blob parts. A PDF is cleaned through `doc`, which is changed in the process. */
async function clean(kind, bytes, doc, opt) {
  if (kind === "pdf") return [await cleanPdf(doc, opt)];
  if (kind === "jpeg" || kind === "png") return cleanImage(bytes).parts;
  if (kind === "webp") return cleanImage(bytes.subarray(0, webpEnd(bytes))).parts; // what follows the RIFF block is not part of the picture
  const zip = await JSZip.loadAsync(bytes);
  await cleanOoxml(zip);
  return [await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } })];
}

// ---- pure:end ----

const MAX_FILES = 20, MAX_BYTES = 300 * 1024 ** 2;
const KIND_NAME = { jpeg: "JPEG photo", png: "PNG image", webp: "WebP image", pdf: "PDF document", docx: "Word document", xlsx: "Excel workbook", pptx: "PowerPoint presentation" };
const CHECKED = {
  jpeg: "Location, date, camera, software and author in EXIF; the embedded thumbnail; XMP and IPTC notes; comments; data after the end of the picture (previews, the video of a motion photo).",
  png: "Text notes, EXIF, XMP, the time of the last change, data after the end of the picture.",
  webp: "Location, date, camera, software and author in EXIF; the embedded thumbnail; XMP; data after the end of the picture.",
  pdf: "Document properties and XMP, comments and highlights with their authors, filled form fields, attached files, scripts, hidden layers, earlier versions left by repeated saving.",
  docx: "Document properties (author, company, template, dates, editing time), custom properties, the preview picture, comments, tracked changes, hidden text, the list of people.",
  xlsx: "Document properties, custom properties, the preview picture, hidden and very hidden sheets, comments, links to other files.",
  pptx: "Document properties, custom properties, the preview picture, speaker notes, hidden slides, comments.",
};
const SEV_TITLE = { high: "Points to a person or a place, or is content the reader is not meant to see", medium: "Points to a device, a program or the history of the file", info: "For information" };
const SEV_ORDER = { high: 0, medium: 1, info: 2 }, OFFICE = ["docx", "xlsx", "pptx"];

const reports = new WeakMap();
/** The report for a file, computed once: { kind, findings }, or { kind: null, why } when it could not be read. */
function reportOf(file) {
  if (!reports.has(file)) reports.set(file, (async () => {
    if (file.size > MAX_BYTES) return { kind: null, why: t("too big to check in the browser (over {size})", { size: formatBytes(MAX_BYTES) }) };
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await inspect(bytes, sniff(bytes) === "pdf" ? await loadPdf(file) : null);
    } catch (err) { return { kind: null, why: err instanceof TypeError || err instanceof RangeError ? "the file is damaged or is not what its name says" : err.message || String(err) }; }
  })());
  return reports.get(file);
}

/** An element whose text is file data, which must not go through the translation lookup the way el() children do. */
function raw(tag, cls, text, title) {
  const node = el(tag, { class: cls });
  node.textContent = text;
  if (title) node.title = title;
  return node;
}

function card(file, rep, urls) {
  const head = el("header", { class: "leak-head" }, [raw("strong", "leak-name", file.name), el("span", { class: "leak-kind" }, [`${t(KIND_NAME[rep.kind] || "Not checked")} · ${formatBytes(file.size)}`])]);
  if (!rep.kind) {
    const text = rep.why ? t("Could not be checked: {reason}", { reason: t(rep.why) })
      : /\.hei[cf]$/i.test(file.name) ? "HEIC photos usually carry the location and the camera model, but this tool cannot read them. Convert the photo to JPG first: the conversion leaves that data out."
        : "This kind of file is not analysed here. That does not mean it carries nothing.";
    return el("section", { class: "leak-card" }, [head, el("p", { class: "leak-verdict unknown", text })]);
  }
  const list = [...rep.findings].sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]), worth = list.filter((f) => f.sev !== "info");
  const verdict = !list.length ? "Nothing found among the things this tool checks" : !worth.length ? "Only minor details found" : t("{things} worth removing", { things: plural(worth.length, "thing") });
  const rows = list.map((f) => {
    const row = el("li", { class: "leak-row" }, [
      el("span", { class: `leak-dot ${f.sev}`, role: "img", title: SEV_TITLE[f.sev], "aria-label": SEV_TITLE[f.sev] }),
      el("span", { class: "leak-label", text: f.label }),
      raw("span", "leak-value", clip(f.value, 90), f.value),
      f.fix === "auto" ? null : el("span", { class: "leak-tag", text: f.fix === "manual" ? "stays in the file" : "removed if you tick the box" }),
    ]);
    if (f.thumb) {
      const url = URL.createObjectURL(new Blob([f.thumb], { type: f.thumb[0] === 0x89 ? "image/png" : "image/jpeg" }));
      urls.push(url);
      row.append(el("img", { class: "leak-thumb", src: url, alt: t("Embedded thumbnail"), loading: "lazy" }));
    }
    if (f.why) row.append(el("span", { class: "leak-why", text: f.why }));
    return row;
  });
  return el("section", { class: "leak-card" }, [
    head,
    el("p", { class: `leak-verdict ${worth[0]?.sev || "none"}`, text: verdict }),
    rows.length ? el("ul", { class: "leak-rows" }, rows) : null,
    OFFICE.includes(rep.kind) && worth.some((f) => f.fix === "manual")
      ? el("p", { class: "leak-manual", text: "Clean copies leaves comments, tracked changes, notes and hidden parts alone, because removing them would change the document. Deal with them in Word, Excel or PowerPoint first (accept all changes, delete comments), then check the file again." }) : null,
    el("details", { class: "leak-checked" }, [el("summary", { text: "What was checked" }), el("p", { text: CHECKED[rep.kind] }), el("p", { text: "Not checked: what can be seen in the file itself, such as a face, a name in the text or a street sign in a photo." })]),
  ]);
}

const leakCheckTool = {
  id: "leak-check",
  title: "Privacy check",
  description: "See what a file gives away before you send or post it: where a photo was taken, who wrote a document, comments, tracked changes, hidden sheets, earlier versions. One button makes cleaned copies. The files are read in this tab and never uploaded.",
  keywords: ["privacy", "metadata", "leak", "exif", "gps", "location", "author", "hidden data", "tracked changes", "comments", "thumbnail", "inspect document", "anonymize", "before sending", "приватність", "метадані", "перевірити файл", "геолокація", "автор", "приховані дані", "виправлення", "коментарі", "мініатюра", "перед надсиланням", "конфіденційність", "приватность", "метаданные", "скрытые данные"],
  accept: "*/*",
  hint: "Photos, PDFs, Word, Excel and PowerPoint files you are about to send",
  runLabel: "Clean copies",
  renderOptions(root, files) {
    const token = (this.token = {});
    for (const url of this.urls || []) URL.revokeObjectURL(url);
    const urls = (this.urls = []);
    // The three options are off whenever a new set of files arrives, and survive a refresh of the same set.
    const was = this.files?.some((f) => files.includes(f)) ? this.opts : null;
    const box = (key, label) => checkbox(label, !!was?.[key].input.checked);
    this.opts = { comments: box("comments", "Also remove comments and highlights"), attachments: box("attachments", "Also remove attachments"), scripts: box("scripts", "Also remove scripts") };
    this.files = [...files];
    const status = el("p", { class: "stat leak-status", role: "status" }), list = el("div", { class: "leak-list" });
    root.append(el("p", { class: "stat", text: "Each card lists what the file carries besides what you see in it. Nothing here says a file is safe: only what was looked for and what was found." }));
    if (files.some((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name))) {
      root.append(el("fieldset", { class: "leak-options", "data-noremember": "" }, [el("legend", { text: "In PDF files" }), ...Object.values(this.opts).map((c) => c.label)]));
    }
    root.append(list, status);
    const shown = files.slice(0, MAX_FILES);
    (async () => {
      for (const [i, file] of shown.entries()) {
        status.textContent = t("Checking {name} ({i} of {n})…", { name: file.name, i: i + 1, n: shown.length });
        const rep = await reportOf(file);
        if (this.token !== token) return; // the file list was refreshed: this report belongs to a page that is gone
        list.append(card(file, rep, urls));
      }
      status.textContent = files.length > shown.length ? t("The first {n} files are shown. The rest are checked when you press the button.", { n: MAX_FILES }) : "";
      status.hidden = !status.textContent;
    })();
  },
  async run(files, _root, progress) {
    const opt = Object.fromEntries(Object.entries(this.opts || {}).map(([k, c]) => [k, c.input.checked]));
    const labels = (list) => clip([...new Set(list.map((f) => t(f.label)))].join(", "), 160);
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const rep = await reportOf(file);
      const going = (rep.findings || []).filter((f) => f.fix === "auto" || opt[f.fix]);
      if (!going.length) { out.push({ name: file.name, blob: file, note: rep.kind ? t("nothing this tool removes: kept as is") : t("not checked: kept as is") }); continue; }
      const parts = await clean(rep.kind, new Uint8Array(await file.arrayBuffer()), rep.kind === "pdf" ? await loadPdf(file) : null, opt);
      const blob = new Blob(parts, { type: OFFICE.includes(rep.kind) && /^application\/vnd\./.test(file.type) ? file.type : MIME[rep.kind] }); // .docm and the like keep their own type
      // The copy goes through the same detector as the original: a file that still has what was to be removed is not handed over.
      const after = await inspect(new Uint8Array(await blob.arrayBuffer()));
      const left = going.filter((f) => f.sev !== "info" && after.findings.some((a) => a.key === f.key));
      if (left.length) throw new Error(t("{name}: could not remove {what}, so no cleaned copy was made", { name: file.name, what: labels(left) }));
      const stays = rep.findings.filter((f) => f.sev !== "info" && !going.includes(f));
      const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
      out.push({ name: `${baseName(file.name)}-clean${ext}`, blob, note: t("removed: {what}", { what: labels(going) }) + (stays.length ? ` · ${t("still inside: {what}", { what: labels(stays) })}` : "") });
    }
    return out;
  },
};

export const privacyTools = [leakCheckTool];
