// PDF to Word and PDF to Excel. Both read the PDF's text layer with pdf.js and rebuild what the page showed from
// the positions of its text runs: lines and paragraphs, headings and columns for Word, rows and columns of tables
// for Excel. A scan has no text layer, so there is nothing to rebuild: those go through OCR first.
import { el, baseName, field, select, checkbox, plural, toast, t } from "../util.js";
import { pdfjsLib, pdfjsOpen, canvasBlob } from "./pdf.js";
import { dateCell } from "./office.js";

const PDF_ACCEPT = "application/pdf,.pdf";
const VENDOR = new URL("../../vendor/office/", import.meta.url).href;
let loadingXlsx = null;
/** SheetJS, loaded the first time a workbook is written (the same file and global office.js uses). */
function loadXlsx() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  loadingXlsx ??= new Promise((resolve, reject) => {
    const s = el("script", { src: VENDOR + "xlsx.full.min.js" });
    s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error("xlsx.full.min.js did not load")));
    s.onerror = () => { loadingXlsx = null; reject(new Error(t("Could not load {name}", { name: "xlsx.full.min.js" }))); };
    document.head.append(s);
  });
  return loadingXlsx;
}

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
/** pdf.js's Util.transform: m1 applied after m2. */
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

// ---------- text runs → rows ----------

// Font families Word and Excel know by name; anything else falls back to the document's body font.
const FAMILIES = [[/times/i, "Times New Roman"], [/arial|helvetica|arimo|liberationsans/i, "Arial"], [/courier/i, "Courier New"], [/calibri|carlito/i, "Calibri"], [/cambria|caladea/i, "Cambria"], [/georgia/i, "Georgia"], [/verdana/i, "Verdana"], [/tahoma/i, "Tahoma"], [/garamond/i, "Garamond"], [/roboto/i, "Roboto"], [/segoe/i, "Segoe UI"], [/dejavusans(?!mono)/i, "DejaVu Sans"], [/consolas/i, "Consolas"]];

/** Bold, italic and a family Word knows, from a pdf.js font object; the PostScript name says it when the flags do not ("ABCDEF+Arial-BoldItalicMT"). */
export function fontFlags(font) {
  const name = String(font?.name || "").replace(/^[A-Z]{6}\+/, "");
  return {
    bold: !!(font?.bold || font?.black) || /bold|black|heavy|semibold|demi/i.test(name),
    italic: !!font?.italic || /italic|oblique|kursiv/i.test(name),
    family: FAMILIES.find(([re]) => re.test(name))?.[1] || familyName(name),
  };
}

/** "NotoSans-BoldItalic" → "Noto Sans": Word uses the font when it is installed and a close one when not. Made-up names ("F1", "T1_0") give null. */
function familyName(name) {
  const base = name.split(/[-,]/)[0].replace(/(MT|PS|Std|Pro)$/g, "").replace(/(Bold|Italic|Regular|Light|Medium)+$/i, "");
  if (!/^[A-Za-z]{4,}$/.test(base)) return null;
  return base.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// Symbol fonts put their bullets in the private use area, where every other font shows a box.
const PUA = { "": "•", "": "▪", "": "●", "": "➢", "": "✓", "": "–" };
const cleanText = (s) => s.replace(/[-]/g, (c) => PUA[c] ?? c);

/**
 * pdf.js text items in reading coordinates: points from the top left of the page as it is shown (its /Rotate
 * applied), y at the baseline and growing downwards. A page whose text runs sideways (a landscape table printed
 * on a portrait page) is turned so that its main direction reads left to right; text in other directions (a
 * diagonal "DRAFT", a margin label) is left out.
 */
export function normaliseItems(items, viewportTransform, fontOf = () => null) {
  const raw = [];
  const chars = new Map();
  for (const it of items) {
    // pdf.js fills gaps with " " items as wide as the gap; the gaps themselves say more, so whitespace goes
    if (typeof it.str !== "string" || !it.str.trim()) continue;
    const m = mul(viewportTransform, it.transform);
    const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]);
    if (!size) continue;
    const deg = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
    const q = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
    if (Math.abs(deg - Math.round(deg / 90) * 90) > 3) continue;
    raw.push({ it, m, size, q });
    chars.set(q, (chars.get(q) || 0) + it.str.length);
  }
  const q = [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const a = (q * Math.PI) / 180, cos = Math.round(Math.cos(a)), sin = Math.round(Math.sin(a));
  const turn = (x, y) => [x * cos + y * sin, -x * sin + y * cos];
  const out = [];
  for (const { it, m, size, q: iq } of raw) {
    if (iq !== q) continue;
    const [x, y] = turn(m[4], m[5]);
    const f = fontFlags(fontOf(it.fontName));
    out.push({ str: cleanText(it.str), x, y, x1: x + Math.abs(it.width), size, ...f });
  }
  return { items: out, turn };
}

/** The page box in reading coordinates, and a function that moves points into it. */
function frameOf(turn, w, h) {
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => turn(x, y));
  const minX = Math.min(...corners.map((c) => c[0])), minY = Math.min(...corners.map((c) => c[1]));
  return { width: Math.max(...corners.map((c) => c[0])) - minX, height: Math.max(...corners.map((c) => c[1])) - minY, minX, minY, at: (x, y) => { const [u, v] = turn(x, y); return [u - minX, v - minY]; } };
}

const sameStyle = (a, b) => a.bold === b.bold && a.italic === b.italic && a.family === b.family && Math.abs(a.size - b.size) < 0.5;

/**
 * Text items grouped into rows (shared baseline; a superscript rides along with its line) and, inside a row, into
 * segments wherever the gap is wider than `gapEm` font sizes: the cells of a table, the two halves of a two-column
 * page. Each segment keeps its runs of bold / italic / size.
 */
export function groupRows(items, gapEm = 1) {
  const rows = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = null;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 3; i--) {
      if (Math.abs(rows[i].y - it.y) <= 0.5 * Math.max(rows[i].size, it.size)) { row = rows[i]; break; }
    }
    if (!row) rows.push((row = { y: it.y, size: it.size, items: [] }));
    else if (it.size > row.size) { row.size = it.size; row.y = it.y; }
    row.items.push(it);
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.segs = [];
    let seg = null;
    for (const it of row.items) {
      const em = Math.max(it.size, seg?.size || 0);
      const gap = seg ? it.x - seg.x1 : 0;
      // the same text drawn twice a hair apart is a fake bold, not two words
      const last = seg?.runs.at(-1);
      if (seg && last && gap < 0 && last.text.endsWith(it.str) && Math.abs(seg.x1 - it.x1) < 0.2 * em) continue;
      if (!seg || gap > gapEm * em) {
        seg = { x0: it.x, x1: it.x1, y: row.y, size: it.size, runs: [] };
        row.segs.push(seg);
      } else if (gap > 0.15 * em && !/\s$/.test(last.text) && !/^\s/.test(it.str)) last.text += " ";
      const run = { text: it.str, bold: it.bold, italic: it.italic, family: it.family, size: it.size };
      const prev = seg.runs.at(-1);
      if (prev && sameStyle(prev, run)) prev.text += run.text;
      else seg.runs.push(run);
      seg.x1 = Math.max(seg.x1, it.x1);
      seg.size = Math.max(seg.size, it.size);
    }
    for (const s of row.segs) finishSeg(s);
    delete row.items;
  }
  return rows;
}

/** Text, the size most of its characters have, and whether it is all bold. */
function finishSeg(s) {
  s.text = s.runs.map((r) => r.text).join("");
  const by = new Map();
  let boldChars = 0, n = 0;
  for (const r of s.runs) { const k = Math.round(r.size * 2) / 2; by.set(k, (by.get(k) || 0) + r.text.length); n += r.text.length; if (r.bold) boldChars += r.text.length; }
  s.body = [...by].sort((a, b) => b[1] - a[1])[0]?.[0] || s.size;
  s.bold = n > 0 && boldChars >= n * 0.9;
  return s;
}

const PAGE_NUMBER = /^(page|p\.|стор(інка|\.)?|страница|стр\.|с\.)?\s*[-–—(]?\s*\d{1,4}\s*[-–—)]?\s*((of|из|із|з|\/)\s*\d{1,4})?$/i;

/**
 * Leaves out running headers and footers: a row in the top or bottom 12% of the page whose text (digits ignored)
 * comes back on at least half of the pages, and bare page numbers there.
 */
export function dropRunning(pages) {
  const key = (r) => r.segs.map((s) => s.text).join(" ").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const edge = (p) => p.rows.filter((r, i) => (i < 2 || i >= p.rows.length - 2) && (r.y < p.height * 0.12 || r.y > p.height * 0.88));
  const count = new Map();
  for (const p of pages) for (const k of new Set(edge(p).map(key))) count.set(k, (count.get(k) || 0) + 1);
  const need = Math.max(2, Math.ceil(pages.length / 2));
  let dropped = 0;
  for (const p of pages) {
    const gone = new Set(edge(p).filter((r) => PAGE_NUMBER.test(r.segs.map((s) => s.text).join(" ").trim()) || (pages.length > 1 && count.get(key(r)) >= need)));
    dropped += gone.size;
    p.rows = p.rows.filter((r) => !gone.has(r));
  }
  return dropped;
}

// ---------- rows → paragraphs (Word) ----------

/**
 * Reading order by recursive XY-cut: split at a column gutter (a vertical strip no text crosses, with real lines
 * of prose on both sides), else at gaps between blocks clearly taller than the line spacing, until neither is left.
 * A table's narrow cells are not prose, so its rows stay rows instead of being read column by column.
 */
export function xyCut(segs, depth = 0) {
  if (segs.length < 2 || depth > 24) return [segs];
  const em = median(segs.map((s) => s.size)) || 10;
  const prose = (list) => list.length >= 3 && median(list.map((s) => s.x1 - s.x0)) >= 8 * em;
  const byX = [...segs].sort((a, b) => a.x0 - b.x0);
  let reach = byX[0].x1, best = null;
  for (let i = 1; i < byX.length; i++) {
    const gap = byX[i].x0 - reach;
    if (gap >= 1.2 * em && (!best || gap > best.gap)) {
      const left = byX.slice(0, i), right = byX.slice(i);
      if (prose(left) && prose(right)) best = { gap, left, right };
    }
    reach = Math.max(reach, byX[i].x1);
  }
  if (best) return [...xyCut(best.left, depth + 1), ...xyCut(best.right, depth + 1)];
  const byY = [...segs].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const bands = [[byY[0]]];
  let bottom = byY[0].y + 0.25 * byY[0].size;
  for (const s of byY.slice(1)) {
    const top = s.y - 0.8 * s.size;
    if (top - bottom > 0.9 * Math.max(em, s.size)) bands.push([s]);
    else bands.at(-1).push(s);
    bottom = Math.max(bottom, s.y + 0.25 * s.size);
  }
  if (bands.length === 1) return [segs];
  return bands.flatMap((b) => xyCut(b, depth + 1));
}

/** The segments of one block back into lines; a wide gap inside a line (a tab stop, a table cell) becomes a tab. */
function blockLines(segs) {
  const lines = [];
  for (const s of [...segs].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const line = lines.find((l) => Math.abs(l.y - s.y) <= 0.5 * Math.max(l.size, s.size));
    if (line) line.segs.push(s);
    else lines.push({ y: s.y, size: s.size, segs: [s] });
  }
  return lines.map((l) => {
    l.segs.sort((a, b) => a.x0 - b.x0);
    const runs = [];
    let tab = false;
    l.segs.forEach((s, i) => {
      if (i) {
        const wide = s.x0 - l.segs[i - 1].x1 > 1.5 * Math.max(s.size, l.segs[i - 1].size);
        tab ||= wide;
        runs.push({ ...s.runs[0], text: wide ? "\t" : " " });
      }
      runs.push(...s.runs.map((r) => ({ ...r })));
    });
    return finishSeg({ y: l.y, x0: l.segs[0].x0, x1: l.segs.at(-1).x1, size: Math.max(...l.segs.map((s) => s.size)), runs, tab });
  });
}

const LIST_START = /^([•●○◦■□▪▫‣∙·➢✓*–—-]|\(?\d{1,3}[.)]|\(?[a-zа-яієї][.)])\s/iu;
const SENTENCE_END = /[.!?:;…]["'»”’)\]]?$/;

/**
 * Lines of one block into paragraphs. A new paragraph starts at a gap taller than the usual line spacing, a change
 * of size or of all-bold, a list marker, a tab, after a line that ends a sentence and falls short of the right edge
 * or is followed by an indent, and after any clearly short line. Wrapped lines are joined with a space, a word
 * split by a hyphen at the line end is put back together.
 */
export function blockParagraphs(lines, { pitch = 1.25, reflow = true } = {}) {
  if (!lines.length) return [];
  const left = Math.min(...lines.map((l) => l.x0)), right = Math.max(...lines.map((l) => l.x1)), width = right - left;
  const paras = [];
  let cur = null, prev = null;
  for (const L of lines) {
    let brk = !cur;
    if (!brk) {
      const em = Math.max(prev.body, L.body);
      const dy = L.y - prev.y;
      const ends = SENTENCE_END.test(prev.text.trim());
      // the line was ended on purpose when the next line's first word would have fitted after it
      const charW = (L.x1 - L.x0) / Math.max(1, L.text.length);
      const fits = right - prev.x1 > ((L.text.match(/^\S+/)?.[0].length || 0) + 1) * charW + 0.3 * em;
      const hyphen = /\p{L}[-­]$/u.test(prev.text);
      brk = prev.tab || L.tab || Math.abs(prev.body - L.body) > 0.12 * em || prev.bold !== L.bold
        || dy <= 0 || dy > em * (pitch + 0.5) || LIST_START.test(L.text)
        || (ends && L.x0 > prev.x0 + 0.8 * em) || (fits && !hyphen && lines.length > 1);
    }
    if (brk) {
      cur = { runs: L.runs.map((r) => ({ ...r })), lines: [L], y: L.y - L.size };
      paras.push(cur);
    } else {
      const last = cur.runs.at(-1);
      if (!reflow) cur.runs.push({ ...last, text: "\n" });
      else if (/\p{L}[-­]$/u.test(last.text) && /^\p{Ll}/u.test(L.text)) last.text = last.text.slice(0, -1);
      else if (!/\s$/.test(last.text)) last.text += " ";
      for (const r of L.runs) { const p = cur.runs.at(-1); if (sameStyle(p, r)) p.text += r.text; else cur.runs.push({ ...r }); }
      cur.lines.push(L);
    }
    prev = L;
  }
  for (const p of paras) {
    const s = finishSeg(p);
    s.x0 = Math.min(...p.lines.map((l) => l.x0));
    s.x1 = Math.max(...p.lines.map((l) => l.x1));
  }
  return paras;
}

/** The size most characters of the document have, and the usual baseline distance in font sizes. */
export function bodyMetrics(pages) {
  const by = new Map(), pitches = [];
  for (const p of pages) {
    let prev = null;
    for (const r of p.rows) {
      for (const s of r.segs) { const k = Math.round(s.body * 2) / 2; by.set(k, (by.get(k) || 0) + s.text.length); }
      if (prev) { const d = (r.y - prev.y) / r.size; if (Math.abs(r.size - prev.size) < 0.5 && d > 0.9 && d < 2.2) pitches.push(d); }
      prev = r;
    }
  }
  return { body: [...by].sort((a, b) => b[1] - a[1])[0]?.[0] || 11, pitch: median(pitches) || 1.25 };
}

/**
 * Word blocks for each page: paragraphs with a heading style where the text is clearly bigger than the body
 * (Heading 1 from 1.45 times, Heading 2 from 1.12 times, short ones only), centred where every line is, and the
 * page's pictures slotted in by their height on the page.
 */
export function wordModel(pages, { reflow = true, running = true } = {}) {
  if (running) dropRunning(pages);
  const { body, pitch } = bodyMetrics(pages);
  const out = [];
  let headings = 0, words = 0;
  for (const p of pages) {
    const segs = p.rows.flatMap((r) => r.segs);
    const blocks = [];
    if (segs.length) {
      const left = Math.min(...segs.map((s) => s.x0)), right = Math.max(...segs.map((s) => s.x1)), mid = (left + right) / 2;
      for (const leaf of xyCut(segs)) {
        for (const para of blockParagraphs(blockLines(leaf), { pitch, reflow })) {
          const ratio = para.body / body, text = para.text.trim();
          if (!text) continue;
          words += (text.match(/\S+/g) || []).length;
          const style = text.length <= 250 && para.lines.length <= 3 ? (ratio >= 1.45 ? "Heading1" : ratio >= 1.12 ? "Heading2" : null) : null;
          if (style) headings++;
          const em = para.body;
          const centred = right - left > 20 * em && para.lines.every((l) => Math.abs((l.x0 + l.x1) / 2 - mid) < 1.5 * em && l.x0 - left > 3 * em && right - l.x1 > 3 * em);
          blocks.push({ kind: "p", style, align: centred ? "center" : null, runs: para.runs, size: para.body, y: para.y });
        }
      }
    }
    for (const img of p.images || []) {
      const i = blocks.findIndex((b) => b.y > img.y);
      blocks.splice(i < 0 ? blocks.length : i, 0, { kind: "img", ...img });
    }
    out.push({ width: p.width, height: p.height, blocks, left: segs.length ? Math.min(...segs.map((s) => s.x0)) : null, right: segs.length ? Math.max(...segs.map((s) => s.x1)) : null });
  }
  return { pages: out, body, headings, words, font: dominantFamily(pages) };
}

function dominantFamily(pages) {
  const by = new Map();
  for (const p of pages) for (const r of p.rows) for (const s of r.segs) for (const run of s.runs) if (run.family) by.set(run.family, (by.get(run.family) || 0) + run.text.length);
  return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] || "Calibri";
}

// ---------- the .docx ----------

/** Text for an XML text node or attribute: escaped, and without the characters XML 1.0 does not allow (control codes, lone surrogates). */
export const xmlText = (s) => String(s).replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const EMU = 12700; // per point
const halfPoints = (pt) => Math.max(2, Math.round(pt * 2));
const H1 = 1.6, H2 = 1.25;

function runXml(run, ctx, heading, styleSize) {
  const pr = [];
  if (run.family && run.family !== ctx.font) { const f = xmlText(run.family); pr.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`); }
  if (run.bold) pr.push("<w:b/><w:bCs/>");
  else if (heading) pr.push('<w:b w:val="0"/><w:bCs w:val="0"/>'); // the heading style is bold, this text was not
  if (run.italic) pr.push("<w:i/><w:iCs/>");
  const hp = halfPoints(run.size);
  if (Math.abs(hp - styleSize) > 1) pr.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);
  const body = run.text.split(/(\t|\n)/).map((part) => (part === "\t" ? "<w:tab/>" : part === "\n" ? "<w:br/>" : part ? `<w:t xml:space="preserve">${xmlText(part)}</w:t>` : "")).join("");
  return body ? `<w:r>${pr.length ? `<w:rPr>${pr.join("")}</w:rPr>` : ""}${body}</w:r>` : "";
}

function pictureXml(img, ctx, id) {
  // shown at its size on the PDF page, shrunk to fit inside the margins
  const k = Math.min(1, ctx.textWidth / img.w, ctx.textHeight / img.h);
  const cx = Math.max(1, Math.round(img.w * k * EMU)), cy = Math.max(1, Math.round(img.h * k * EMU));
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlText(img.file)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${img.rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** word/document.xml for a wordModel(); pictures must already carry their relationship id (`rel`) and file name. */
export function documentXml(model, { pageBreaks = true } = {}) {
  const first = model.pages[0] || { width: 595, height: 842 };
  const twips = (pt) => Math.round(pt * 20);
  // the margins of the first page's text, within reason, so lines wrap about where they did in the PDF
  const clampM = (pt) => Math.min(108, Math.max(36, pt));
  const ml = first.left != null ? clampM(first.left) : 72, mr = first.right != null ? clampM(first.width - first.right) : 72;
  const ctx = { font: model.font, textWidth: Math.max(72, first.width - ml - mr), textHeight: Math.max(72, first.height - 144) };
  const bodyHp = halfPoints(model.body);
  const parts = [];
  let pic = 0;
  model.pages.forEach((p, i) => {
    if (i && pageBreaks) parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    for (const b of p.blocks) {
      if (b.kind === "img") { parts.push(pictureXml(b, ctx, ++pic)); continue; }
      const styleSize = b.style === "Heading1" ? halfPoints(model.body * H1) : b.style === "Heading2" ? halfPoints(model.body * H2) : bodyHp;
      const ppr = (b.style ? `<w:pStyle w:val="${b.style}"/>` : "") + (b.align ? `<w:jc w:val="${b.align}"/>` : "");
      const runs = b.runs.map((r) => runXml(r, ctx, !!b.style, styleSize)).join("");
      if (runs) parts.push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runs}</w:p>`);
    }
  });
  if (!parts.length) parts.push("<w:p/>");
  const sect = `<w:sectPr><w:pgSz w:w="${twips(first.width)}" w:h="${twips(first.height)}"${first.width > first.height ? ' w:orient="landscape"' : ""}/>`
    + `<w:pgMar w:top="1440" w:right="${twips(mr)}" w:bottom="1440" w:left="${twips(ml)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  return `${XML_HEAD}<w:document ${NS}><w:body>${parts.join("")}${sect}</w:body></w:document>`;
}

/** word/styles.xml: Normal in the document's body font and size, Heading 1 and 2 above it. */
export function stylesXml(model) {
  const f = xmlText(model.font || "Calibri"), hp = halfPoints(model.body || 11);
  const heading = (id, name, lvl, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${lvl}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/><w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + heading("Heading1", "heading 1", 0, halfPoints(model.body * H1), 360) + heading("Heading2", "heading 2", 1, halfPoints(model.body * H2), 240)
    + '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>'
    + "</w:styles>";
}

/** The .docx package: content types, relationships, document, styles and the pictures in word/media. */
export async function writeDocx(JSZip, model, opts) {
  const zip = new JSZip();
  const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'];
  const media = new Map(); // one file for a picture that repeats (a logo on every page)
  for (const p of model.pages) for (const b of p.blocks) {
    if (b.kind !== "img") continue;
    if (!media.has(b.key)) {
      const n = media.size + 1, file = `image${n}.${b.ext}`;
      media.set(b.key, { rel: `rId${n + 1}`, file });
      zip.file(`word/media/${file}`, await b.blob.arrayBuffer(), { compression: "STORE" }); // PNG and JPEG are compressed already
      rels.push(`<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
    }
    Object.assign(b, media.get(b.key));
  }
  zip.file("[Content_Types].xml", `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  zip.file("word/document.xml", documentXml(model, opts));
  zip.file("word/styles.xml", stylesXml(model));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ---------- reading a PDF ----------

/** Pixels of a pdf.js image object on a canvas (same decoding as Extract images). */
function imageCanvas(img) {
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d");
  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c; }
  const out = ctx.createImageData(img.width, img.height);
  const d = out.data, s = img.data, n = img.width * img.height;
  if (img.kind === 3) d.set(s.subarray(0, n * 4));
  else if (img.kind === 2) for (let i = 0; i < n; i++) { d[i * 4] = s[i * 3]; d[i * 4 + 1] = s[i * 3 + 1]; d[i * 4 + 2] = s[i * 3 + 2]; d[i * 4 + 3] = 255; }
  else { const rowBytes = Math.ceil(img.width / 8); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const bit = (s[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1; const i = (y * img.width + x) * 4; d[i] = d[i + 1] = d[i + 2] = bit ? 255 : 0; d[i + 3] = 255; } }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** True when some pixel is not fully opaque; sampled, a few thousand pixels say enough. */
function hasAlpha(canvas) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(1, Math.floor(d.length / 4 / 40000)) * 4;
  for (let i = 3; i < d.length; i += step) if (d[i] < 250) return true;
  return false;
}

/**
 * Where each picture is drawn: the operator list is walked with its graphics state, so the unit square an image
 * fills can be mapped onto the page. Tiny ones (bullets, rules) and one that covers most of a page with text
 * on it (a background, or the scan behind an OCR text layer) are left out.
 */
async function pageImages(page, ops, vp, frame, hasText, seen) {
  const OPS = pdfjsLib.OPS;
  const out = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args[0]) && args[0].length === 6) ctm = mul(ctm, args[0]); }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const m = mul(vp.transform, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => frame.at(m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]));
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
      const w = x1 - x0, h = y1 - y0;
      if (w < 12 || h < 12) continue;
      if (hasText && w * h > 0.8 * frame.width * frame.height) continue;
      const inline = fn === OPS.paintInlineImageXObject;
      const name = inline ? null : args[0];
      const key = name?.startsWith("g_") ? name : `${page.pageNumber}:${name ?? i}`;
      let file = seen.get(key);
      if (!file) {
        let img;
        try {
          img = inline ? args[0] : await new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error("timeout")), 10000); (name.startsWith("g_") ? page.commonObjs : page.objs).get(name, (v) => { clearTimeout(timer); res(v); }); });
        } catch (_) { continue; }
        if (!img || Math.max(img.width, img.height) < 16) continue;
        const c = imageCanvas(img);
        // photos as JPEG keep the .docx small; PNG where there is transparency to keep
        const png = img.kind === 3 || (img.bitmap && hasAlpha(c)) || c.width * c.height < 40000;
        file = { blob: await canvasBlob(c, png ? "image/png" : "image/jpeg", 0.9), ext: png ? "png" : "jpeg" };
        seen.set(key, file);
      }
      out.push({ key, ...file, x: x0, y: y0, w, h });
    }
  }
  return out;
}

/**
 * Every page of a PDF as rows of segments in reading coordinates. `fonts` walks the operator list too (that is when
 * pdf.js hands over the font objects that say bold and italic), `images` also collects the pictures.
 */
export async function readPdf(file, { fonts = false, images = false, gapEm = 1 } = {}, onPage) {
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try { doc = await pdfjsOpen(data); } catch (err) {
    if (err?.name === "PasswordException") throw new Error(t("{name} is password-protected. Remove the password with Unlock PDF first.", { name: file.name }));
    throw new Error(t("{name} is not a readable PDF ({error})", { name: file.name, error: err?.message || err }));
  }
  const pages = [], seen = new Map();
  let chars = 0;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      await onPage?.(n, doc.numPages);
      const page = await doc.getPage(n);
      try {
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const ops = fonts || images ? await page.getOperatorList() : null;
        const fontOf = (id) => { try { return ops && page.commonObjs.has(id) ? page.commonObjs.get(id) : null; } catch (_) { return null; } };
        const { items, turn } = normaliseItems(tc.items, vp.transform, fontOf);
        const frame = frameOf(turn, vp.width, vp.height);
        for (const it of items) { it.x -= frame.minX; it.x1 -= frame.minX; it.y -= frame.minY; } // already turned, only moved
        chars += items.reduce((s, it) => s + it.str.length, 0);
        const pics = images ? await pageImages(page, ops, vp, frame, items.length > 0, seen) : [];
        pages.push({ n, width: frame.width, height: frame.height, rows: groupRows(items, gapEm), images: pics });
      } finally { page.cleanup(); }
    }
  } finally { await doc.destroy(); }
  return { pages, chars };
}

// ---------- rows → tables (Excel) ----------

/**
 * Tables on one page: runs of rows that have two or more cells, with at most two single-cell rows inside (a wrapped
 * cell, a group label). Columns come from the rows with the most common cell count: the x ranges their cells cover,
 * merged where they overlap, so left-, right- and centre-aligned columns all work and a header cell spanning two
 * columns does not join them. Two columns of prose (a two-column page) are not a table.
 */
export function findTables(rows) {
  const tables = [];
  let block = [];
  const flush = () => {
    while (block.length && block.at(-1).segs.length < 2) block.pop();
    if (block.filter((r) => r.segs.length >= 2).length >= 2) { const tb = buildTable(block); if (tb) tables.push(tb); }
    block = [];
  };
  for (const r of rows) {
    const multi = r.segs.length >= 2;
    if (!block.length) { if (multi) block.push(r); continue; }
    const prev = block.at(-1);
    if (r.y - prev.y > 3.2 * Math.max(r.size, prev.size)) { flush(); if (multi) block.push(r); continue; }
    if (multi) { block.push(r); continue; }
    let singles = 0;
    for (let i = block.length - 1; i >= 0 && block[i].segs.length < 2; i--) singles++;
    if (singles >= 2) { flush(); continue; }
    block.push(r);
  }
  flush();
  return tables;
}

function buildTable(block) {
  const multi = block.filter((r) => r.segs.length >= 2);
  const counts = new Map();
  for (const r of multi) counts.set(r.segs.length, (counts.get(r.segs.length) || 0) + 1);
  const mode = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const ref = multi.filter((r) => r.segs.length === mode).length >= 2 ? multi.filter((r) => r.segs.length === mode) : multi;
  const cols = [];
  for (const s of ref.flatMap((r) => r.segs).sort((a, b) => a.x0 - b.x0)) {
    const c = cols.at(-1);
    if (c && s.x0 <= c.x1) c.x1 = Math.max(c.x1, s.x1);
    else cols.push({ x0: s.x0, x1: s.x1 });
  }
  if (cols.length < 2) return null;
  const em = median(block.map((r) => r.size)) || 10;
  if (median(multi.flatMap((r) => r.segs).map((s) => s.x1 - s.x0)) > 12 * em) return null;
  const colOf = (s) => {
    let best = 0, bestScore = -Infinity;
    cols.forEach((c, i) => {
      const overlap = Math.min(c.x1, s.x1) - Math.max(c.x0, s.x0);
      const score = overlap > 0 ? overlap : -Math.min(Math.abs(c.x0 - s.x1), Math.abs(s.x0 - c.x1));
      if (score > bestScore + 1e-6) { best = i; bestScore = score; }
    });
    return best;
  };
  const grid = [];
  let prev = null;
  for (const r of block) {
    const cells = Array(cols.length).fill("");
    for (const s of r.segs) { const i = colOf(s); cells[i] = cells[i] ? `${cells[i]} ${s.text}` : s.text; }
    const filled = cells.filter(Boolean).length;
    // a line set closer than the rows and with fewer cells than the row above is that row's text wrapping
    if (prev && grid.length > 1 && filled < prev.filled && r.y - prev.y <= 1.35 * Math.max(r.size, prev.size)) {
      const above = grid.at(-1);
      cells.forEach((c, i) => { if (c) above[i] = above[i] ? `${above[i]} ${c}` : c; });
      prev = { ...prev, y: r.y };
      continue;
    }
    grid.push(cells.map((c) => c.trim()));
    prev = { y: r.y, size: r.size, filled };
  }
  // columns that stayed empty (a gap inside a wide cell) go
  const keep = cols.map((_, i) => grid.some((row) => row[i]));
  const rows = grid.map((row) => row.filter((_, i) => keep[i]));
  return rows[0]?.length >= 2 ? { rows, first: block[0], last: block.at(-1), rowSet: new Set(block) } : null;
}

// ---------- numbers ----------

const CURRENCY = String.raw`US\$|[$€£¥₴₽₸₹₩₺₪]|грн\.?|руб\.?|zł|Kč|USD|EUR|UAH|GBP|PLN|CHF|RUB|JPY|CAD|AUD`;
const CUR_BEFORE = new RegExp(`^(${CURRENCY})\\s?`, "i"), CUR_AFTER = new RegExp(`\\s?(${CURRENCY})$`, "i");

/**
 * Which character a document uses for decimals, from the numbers that can only be read one way ("12,50" or
 * "1 234,5" against "12.50" or "1,234.5"). "" when the numbers do not say.
 */
export function decimalHint(cells) {
  let comma = 0, dot = 0;
  for (const c of cells) {
    const s = String(c).replace(/[\s  ]/g, "");
    if (/\d\.\d{3},\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s) || /^-?\d+,\d{4,}$/.test(s)) comma++;
    else if (/\d,\d{3}\.\d+$/.test(s) || /^-?\d+\.\d{1,2}$/.test(s) || /^-?\d+\.\d{4,}$/.test(s)) dot++;
  }
  return comma > dot ? "," : dot > comma ? "." : "";
}

/**
 * A cell's text as a number, or null: "1 234,56", "1,234.56", "1.234,56", "1'234", "-12", "−12", "(12.00)"
 * (accounting minus), "12%" (0.12), "$12", "12 грн", "€ 1.200,00". The format `z` keeps how it looked: thousands
 * separators, decimals, percent and the currency sign. Codes with leading zeros, phone numbers and dates stay text.
 */
export function parseNumber(raw, dec = "") {
  let s = String(raw).trim().replace(/[    ]/g, " ");
  if (!s || s.length > 40) return null;
  let neg = false, plus = false, pct = false, cur = "", curAfter = false;
  if (/^\(.+\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  const sign = () => { const m = s.match(/^[-−–]\s?/); if (m) { neg = !neg; s = s.slice(m[0].length); } else if (s.startsWith("+")) { plus = true; s = s.slice(1); } };
  sign();
  let m = s.match(CUR_BEFORE);
  if (m) { cur = m[1]; s = s.slice(m[0].length); sign(); }
  else if ((m = s.match(CUR_AFTER))) { cur = m[1]; curAfter = true; s = s.slice(0, -m[0].length); }
  if (/\s?%$/.test(s)) { pct = true; s = s.replace(/\s?%$/, ""); }
  if (/[-−]$/.test(s) && !neg) { neg = true; s = s.slice(0, -1); } // "12-": the minus some accounting exports put last
  s = s.trim();
  if (!/^\d/.test(s) || !/\d$/.test(s) || !/^[\d .,'’]+$/.test(s)) return null;
  let int, frac = "", grouped = false;
  const g3 = (x, sep) => new RegExp(`^\\d{1,3}(${sep}\\d{3})+$`).test(x);
  if (/^\d{1,3}([ '’]\d{3})+([.,]\d+)?$/.test(s)) { const [a, b = ""] = s.split(/[.,]/); int = a.replace(/[ '’]/g, ""); frac = b; grouped = true; }
  else if (/[ '’]/.test(s)) return null;
  else if (s.includes(",") && s.includes(".")) {
    const d = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".", g = d === "," ? "\\." : ",";
    const [a, b] = [s.slice(0, s.lastIndexOf(d)), s.slice(s.lastIndexOf(d) + 1)];
    if (!g3(a, g) || b.includes(",") || b.includes(".")) return null;
    int = a.replace(/[.,]/g, ""); frac = b; grouped = true;
  } else if (s.includes(",") || s.includes(".")) {
    const sep = s.includes(",") ? "," : ".", n = s.split(sep).length - 1;
    const asGroups = n > 1 || (/^\d{1,3}[.,]\d{3}$/.test(s) && (dec ? dec !== sep : sep === ","));
    if (asGroups) { if (!g3(s, sep === "," ? "," : "\\.")) return null; int = s.split(sep).join(""); grouped = true; }
    else [int, frac] = s.split(sep);
  } else int = s;
  // long bare digit runs are account, card and phone numbers: as numbers Excel would show 3.8E+11 and drop digits
  if (/^0\d/.test(int) || int.length + frac.length > 15 || (!grouped && !frac && (int.length > 11 || (plus && int.length > 6)))) return null;
  let v = Number(`${int}${frac ? `.${frac}` : ""}`);
  if (!Number.isFinite(v)) return null;
  if (neg) v = -v;
  const decimals = frac.length ? `.${"0".repeat(Math.min(frac.length, 10))}` : "";
  let z = pct ? `0${decimals}%` : `${grouped ? "#,##0" : "0"}${decimals}`;
  if (pct) v /= 100;
  if (cur && !pct) { const lit = `"${cur.replace(/"/g, "")}"`; z = curAfter ? `${z} ${lit}` : `${lit}${z}`; }
  return { v, z: z === "0" ? "General" : z };
}

/** A cell for SheetJS: a number or a date where the text is one, otherwise the text. */
export function typedCell(text, dec) {
  const s = String(text).trim();
  if (!s) return "";
  const d = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); // 05.03.2024: day first, the way dots are used
  const date = dateCell(d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : s);
  if (date) return date;
  const n = parseNumber(s, dec);
  return n ? { t: "n", v: n.v, z: n.z } : s;
}

// ---------- the tools ----------

const ocrHint = (name) => t("{name} has no text layer (probably a scan). Run it through Image to text (OCR) first, then convert the result.", { name });

/** "file.pdf: 12 pages" per file, and a warning for those without a text layer (only the first pages are looked at). */
function textLayerInfo(root, files) {
  const box = el("div");
  root.append(box);
  (async () => {
    const lines = [];
    for (const f of files.slice(0, 20)) {
      let line;
      try {
        const doc = await pdfjsOpen(new Uint8Array(await f.arrayBuffer()));
        try {
          let text = 0;
          for (let n = 1; n <= Math.min(3, doc.numPages) && !text; n++) { const page = await doc.getPage(n); text += (await page.getTextContent()).items.reduce((s, it) => s + (it.str?.trim().length || 0), 0); page.cleanup(); }
          line = el("div", { class: text ? "stat" : "stat bad", text: `${f.name}: ${plural(doc.numPages, "page")}${text ? "" : ` · ${t("no text layer (scanned?)")}`}` });
        } finally { await doc.destroy(); }
      } catch (err) { line = el("div", { class: "stat bad", text: `${f.name}: ${err?.name === "PasswordException" ? t("needs a password to open") : err.message || err}` }); }
      lines.push(line);
      box.replaceChildren(...lines);
    }
  })();
}

/** Per-page progress inside one file: the bar moves and Cancel is honoured between pages. */
const pageProgress = (progress, file) => (n, total) => {
  progress?.note?.(`${file.name} · ${t("page {n} of {total}", { n, total })}`);
  progress?.part?.((n - 1) / total);
};

const pdfToWordTool = {
  id: "pdf-to-word",
  title: "PDF to Word",
  description: "Turn a PDF into an editable Word document (.docx): paragraphs, headings, bold and italic, columns and pictures are rebuilt from its text layer. Scanned PDFs have no text layer; read those with Image to text (OCR) first.",
  keywords: ["pdf to docx", "pdf to doc", "pdf to word", "editable", "convert pdf", "word", "docx", "пдф у ворд", "pdf у word", "конвертувати pdf", "редагувати pdf", "пдф в ворд", "pdf в word", "конвертировать pdf", "редактировать pdf", "ворд"],
  accept: PDF_ACCEPT,
  hint: "One or more PDF files; each becomes its own .docx",
  runLabel: "Convert to Word",
  renderOptions(root, files) {
    const breaks = checkbox("Start each PDF page on a new page", true);
    const images = checkbox("Include pictures", true);
    const running = checkbox("Leave out page headers, footers and page numbers", true);
    const reflow = checkbox("Join wrapped lines into paragraphs", true);
    root.append(el("div", { class: "row" }, [reflow.label, breaks.label, images.label, running.label]));
    textLayerInfo(root, files);
    this.opts = { breaks, images, running, reflow };
  },
  async run(files, _root, progress) {
    const o = this.opts, JSZip = globalThis.JSZip;
    if (!JSZip) throw new Error(t("Could not load {name}", { name: "JSZip" }));
    const out = [], scans = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const pdf = await readPdf(file, { fonts: true, images: o.images.input.checked }, pageProgress(progress, file));
      if (!pdf.chars) { if (files.length === 1) throw new Error(ocrHint(file.name)); scans.push(file.name); continue; }
      const blank = pdf.pages.filter((p) => !p.rows.length).length; // counted before headers and footers go
      const model = wordModel(pdf.pages, { reflow: o.reflow.input.checked, running: o.running.input.checked });
      const blob = await writeDocx(JSZip, model, { pageBreaks: o.breaks.input.checked });
      const pics = new Set(model.pages.flatMap((p) => p.blocks.filter((b) => b.kind === "img").map((b) => b.key))).size;
      out.push({ name: `${baseName(file.name)}.docx`, blob, note: [plural(pdf.pages.length, "page"), plural(model.words, "word"), pics ? plural(pics, "picture") : null, blank ? t("{n} without text", { n: blank }) : null].filter(Boolean).join(" · ") });
    }
    if (!out.length) throw new Error(t("None of these PDFs has a text layer (scans?). Run them through Image to text (OCR) first."));
    if (scans.length) toast(t("Skipped (no text layer, run Image to text (OCR) first): {names}", { names: scans.join(", ") }), "error");
    return out;
  },
};

// Excel reads a CSV without a byte order mark in the computer's legacy code page, which garbles Cyrillic
const CSV_BOM = "\uFEFF";
const csvText = (rows) => CSV_BOM + rows.map((r) => r.map((c) => (/[",\n\r]/.test(c) || /^\s|\s$/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";

/** Each page's tables (and, with `all`, the text around them as rows of their own), in page order. */
export function pageSheets(pages, { all = false } = {}) {
  dropRunning(pages);
  return pages.map((p) => {
    const tables = findTables(p.rows);
    const parts = [];
    let pending = [];
    const flushText = () => { if (pending.length) parts.push({ text: true, rows: pending }); pending = []; };
    let ti = 0;
    for (const r of p.rows) {
      const tb = tables[ti];
      if (tb && tb.rowSet.has(r)) {
        if (r === tb.first) { flushText(); parts.push({ table: tb, rows: tb.rows }); }
        if (r === tb.last) ti++;
        continue;
      }
      if (all) pending.push(r.segs.map((s) => s.text));
    }
    flushText();
    return { n: p.n, tables: tables.length, parts };
  });
}

const sheetName = (name, used) => {
  // a sheet name is at most 31 characters, the " (2)" of a repeated one included, and has none of \ / ? * [ ] :
  const base = name.replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").slice(0, 31) || "Sheet";
  let s = base;
  for (let k = 2; used.has(s.toLowerCase()); k++) { const tail = ` (${k})`; s = base.slice(0, 31 - tail.length) + tail; }
  used.add(s.toLowerCase());
  return s;
};

/** The sheets of one PDF as [name, rows of strings, header row indices], per page, per table or all on one. */
export function arrangeSheets(sheets, layout, fileStem) {
  const out = [];
  const add = (name, parts) => {
    const rows = [], headers = [];
    let lastHeader = null;
    for (const part of parts) {
      let body = part.rows;
      // a table that goes on over the next page repeats its header there; on one sheet it is said once
      if (part.table && lastHeader && body[0]?.join("\u0001") === lastHeader) body = body.slice(1);
      else if (part.table) { if (rows.length) rows.push([]); headers.push(rows.length); lastHeader = body[0]?.join("\u0001"); }
      else if (rows.length) rows.push([]);
      rows.push(...body);
    }
    if (rows.length) out.push({ name, rows, headers });
  };
  if (layout === "one") add(fileStem, sheets.flatMap((s) => s.parts));
  else for (const s of sheets) {
    if (layout === "page") add(t("Page {n}", { n: s.n }), s.parts);
    else s.parts.filter((p) => p.table).forEach((p, i) => add(t("Page {n}, table {k}", { n: s.n, k: i + 1 }), [p]));
  }
  return out;
}

/** Cached analysis of a file for the preview, reused by run when the file did not change. */
const excelCache = new WeakMap();
const analyse = (file, onPage) => readPdf(file, { gapEm: 0.6 }, onPage);

const pdfToExcelTool = {
  id: "pdf-to-excel",
  title: "PDF to Excel",
  description: "Find the tables in a PDF and save them as an Excel workbook (.xlsx) or CSV: rows and columns are rebuilt from the positions of the text, numbers, percents, amounts and dates become real numbers and dates. One sheet per page, per table or for the whole file. Scanned PDFs need Image to text (OCR) first.",
  keywords: ["pdf to xlsx", "pdf to excel", "pdf to csv", "extract tables", "table", "spreadsheet", "bank statement", "invoice", "пдф в ексель", "pdf в excel", "таблиці з pdf", "витягти таблицю", "виписка", "рахунок", "пдф в эксель", "таблицы из pdf", "извлечь таблицу", "выписка", "счёт"],
  accept: PDF_ACCEPT,
  hint: "One or more PDF files; each becomes its own workbook",
  runLabel: "Convert to Excel",
  renderOptions(root, files) {
    const layout = select([["page", "One sheet per page"], ["table", "One sheet per table"], ["one", "Everything on one sheet"]], "page");
    const take = select([["tables", "Tables only"], ["all", "Tables and the rest of the text"]], "tables");
    const format = select([["xlsx", "Excel (.xlsx)"], ["both", "Excel (.xlsx) and CSV"], ["csv", "CSV only (one file per sheet)"]], "xlsx");
    const types = checkbox("Store numbers and dates as numbers and dates", true);
    const info = el("div", { class: "stat", text: "Looking for tables…" });
    const table = el("table", { class: "meta sheet-preview" });
    const wrap = el("div", { class: "table-wrap", hidden: true }, [table]);
    root.append(el("div", { class: "row" }, [field("Sheets", layout), field("Content", take), field("Save as", format), types.label]), info, wrap);
    this.opts = { layout, take, format, types };
    const file = files[0];
    if (!excelCache.has(file)) excelCache.set(file, analyse(file));
    excelCache.get(file).then((pdf) => {
      if (!pdf.chars) { info.textContent = ocrHint(file.name); info.className = "stat bad"; return; }
      const sheets = pageSheets(copyPages(pdf.pages));
      const total = sheets.reduce((s, x) => s + x.tables, 0);
      const first = sheets.flatMap((s) => s.parts).find((p) => p.table);
      info.textContent = `${file.name}: ${plural(pdf.pages.length, "page")} · ${plural(total, "table")}${first ? ` · ${t("preview of the first one")}` : ""}`;
      if (!first) return;
      table.replaceChildren(...first.rows.slice(0, 30).map((r, i) => el("tr", {}, r.slice(0, 12).map((c) => el(i === 0 ? "th" : "td", { text: c.length > 60 ? c.slice(0, 60) + "…" : c })))));
      wrap.hidden = false;
    }).catch((err) => { info.textContent = err.message; info.className = "stat bad"; });
  },
  async run(files, _root, progress) {
    const o = this.opts, fmt = o.format.value;
    const XLSX = fmt === "csv" ? null : await loadXlsx();
    const out = [], empty = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const pdf = await (excelCache.get(file) || analyse(file, pageProgress(progress, file)));
      if (!pdf.chars) { if (files.length === 1) throw new Error(ocrHint(file.name)); empty.push(file.name); continue; }
      const stem = baseName(file.name);
      const sheets = arrangeSheets(pageSheets(copyPages(pdf.pages), { all: o.take.value === "all" }), o.layout.value, stem);
      if (!sheets.length) { empty.push(file.name); continue; }
      const used = new Set();
      for (const s of sheets) s.name = sheetName(s.name, used);
      const tables = sheets.reduce((n, s) => n + s.headers.length, 0), rows = sheets.reduce((n, s) => n + s.rows.length, 0);
      if (XLSX) {
        const dec = decimalHint(sheets.flatMap((s) => s.rows.flat()));
        const wb = XLSX.utils.book_new();
        for (const s of sheets) {
          const heads = new Set(s.headers);
          // a table's first row is its header when something in it is not a number: it stays text ("2024" too)
          const aoa = s.rows.map((r, i) => (!o.types.input.checked || (heads.has(i) && r.some((c) => c && !parseNumber(c, dec))) ? r : r.map((c) => typedCell(c, dec))));
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          const width = Math.max(1, ...s.rows.map((r) => r.length));
          ws["!cols"] = Array.from({ length: width }, (_, i) => ({ wch: Math.min(60, Math.max(6, ...s.rows.slice(0, 300).map((r) => String(r[i] ?? "").length))) }));
          XLSX.utils.book_append_sheet(wb, ws, s.name);
        }
        const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
        out.push({ name: `${stem}.xlsx`, blob: new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), note: [plural(sheets.length, "sheet"), tables ? plural(tables, "table") : null, plural(rows, "row")].filter(Boolean).join(" · ") });
      }
      if (fmt !== "xlsx") for (const s of sheets) {
        const width = Math.max(...s.rows.map((r) => r.length));
        const rect = s.rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
        out.push({ name: sheets.length > 1 ? `${stem}-${s.name.replace(/[\\/:*?"<>|]+/g, "-")}.csv` : `${stem}.csv`, blob: new Blob([csvText(rect)], { type: "text/csv" }), note: plural(s.rows.length, "row") });
      }
    }
    if (!out.length) throw new Error(files.length === 1 && empty.length ? t("No tables found in {name}. Choose \"Tables and the rest of the text\" to get its text in a sheet.", { name: files[0].name }) : t("No tables found in these PDFs"));
    if (empty.length) toast(t("Nothing to convert in: {names}", { names: empty.join(", ") }), "error");
    return out;
  },
};

/** The cached pages are shared by the preview and every run; table finding drops header rows, so it gets a copy. */
function copyPages(pages) {
  return pages.map((p) => ({ ...p, rows: [...p.rows] }));
}

export const pdfConvertTools = [pdfToWordTool, pdfToExcelTool];
