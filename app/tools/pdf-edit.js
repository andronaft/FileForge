// Edit PDF text: change a word, a date, a name or an amount that is already in a PDF, delete a piece of text, or
// add new text anywhere. A PDF has no paragraphs to retype, only pieces of text placed on the page, so a change is
// drawn over the original: a patch in the colour of the paper hides the old piece and the new text goes on the same
// baseline at the same size. The old text stays inside the file (it can still be copied or searched), which the
// tool says plainly; Redact PDF is the one that removes text for real.
import { el, baseName, field, select, checkbox, plural, t } from "../util.js";
import { pdfjsOpen, openDoc, closeDocs, renderThumb, loadPdf, pdfBlob, fontFor } from "./pdf.js";

const { StandardFonts, degrees, rgb } = PDFLib;

// ---------- geometry, colours and fonts (no DOM, no pdf.js: tested on their own) ----------
// Every piece of text is kept in PDF user space, the coordinates its content stream uses: the baseline origin
// (x, y), the direction of the baseline (angle, counter-clockwise), the font size and the advance width. Page
// rotation (/Rotate) and a crop box that does not start at 0,0 only matter where the page meets the screen, and
// pdf.js's viewport does that mapping both ways.

/** Where a pdf.js text item sits: { x, y, angle (radians), size, width, asc, desc } in user space. */
function runGeometry(item, style) {
  const [a, b, c, d, e, f] = item.transform;
  const size = Math.hypot(c, d) || item.height || 10;
  // pdf.js reports the font's own ascent and descent; some fonts claim silly values, so keep them in a sane band.
  // The top allows for accents and capitals, the bottom for descenders.
  const asc = Math.min(1.02, Math.max(0.78, style?.ascent || 0.8));
  const desc = Math.min(0.3, Math.max(0.2, -(style?.descent ?? -0.22)));
  return { x: e, y: f, angle: Math.atan2(b, a), size, width: item.width, asc, desc };
}

/** The corners of a piece's box in user space: bottom-left, bottom-right, top-right, top-left. `pad` is in ems. */
function quadOf(g, pad = 0) {
  const ux = Math.cos(g.angle), uy = Math.sin(g.angle), nx = -uy, ny = ux; // along the baseline, and up from it
  const p = g.size * pad, w = g.width + 2 * p, lo = -(g.desc * g.size + p), hi = g.asc * g.size + p;
  const x0 = g.x - ux * p, y0 = g.y - uy * p;
  const at = (s, h) => [x0 + ux * s + nx * h, y0 + uy * s + ny * h];
  return [at(0, lo), at(w, lo), at(w, hi), at(0, hi)];
}

/** The patch that hides a piece, as pdf-lib drawRectangle options (it turns the rectangle around its corner x, y). */
function coverRect(g, pad = 0.08) {
  const [bl] = quadOf(g, pad);
  return { x: bl[0], y: bl[1], width: g.width + 2 * g.size * pad, height: (g.asc + g.desc + 2 * pad) * g.size, rotate: g.angle * 180 / Math.PI };
}

/**
 * A piece's box as the reader sees it: { left, top, width, height, angle } in viewport units, where angle is the
 * CSS rotate() of the box around its top-left corner (clockwise, degrees). `toView` maps user space to the viewport.
 */
function viewBox(g, toView) {
  const [bl, br, , tl] = quadOf(g).map(([x, y]) => toView(x, y));
  const width = Math.hypot(br[0] - bl[0], br[1] - bl[1]), height = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  let angle = Math.atan2(br[1] - bl[1], br[0] - bl[0]) * 180 / Math.PI;
  if (Math.abs(angle) < 0.01) angle = 0;
  return { left: tl[0], top: tl[1], width, height, angle };
}

/** The baseline direction in user space that reads left to right on screen at a viewport point. */
function uprightAngle(toPdf, vx, vy) {
  const [x0, y0] = toPdf(vx, vy), [x1, y1] = toPdf(vx + 10, vy);
  return Math.atan2(y1 - y0, x1 - x0);
}

/**
 * The paper and ink colours around and inside a box of a rendered page. `img` is { data, width, height } (RGBA),
 * the box is in its pixels. The paper is the most common colour of a thin ring just outside the box (so a
 * neighbouring letter does not tint it); the ink is the average of the pixels inside that differ most from the paper.
 * Returns { bg: [r, g, b], ink: [r, g, b] | null }, channels 0–255; white paper when the ring is off the page.
 */
function sampleColours(img, x0, y0, x1, y1) {
  const { data, width, height } = img;
  const px = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const bins = new Map();
  const ring = 3;
  for (let y = y0 - ring; y <= y1 + ring; y++) {
    for (let x = x0 - ring; x <= x1 + ring; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      if (!inside(x, y)) continue;
      const c = px(x, y), k = (c[0] >> 4) << 8 | (c[1] >> 4) << 4 | (c[2] >> 4);
      const bin = bins.get(k) || { n: 0, s: [0, 0, 0] };
      bin.n++; bin.s[0] += c[0]; bin.s[1] += c[1]; bin.s[2] += c[2];
      bins.set(k, bin);
    }
  }
  let best = null;
  for (const bin of bins.values()) if (!best || bin.n > best.n) best = bin;
  const bg = best ? best.s.map((v) => Math.round(v / best.n)) : [255, 255, 255];
  const dist = (c) => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
  let max = 0;
  const cells = [];
  for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) { const c = px(x, y), d = dist(c); cells.push([c, d]); if (d > max) max = d; }
  }
  if (max < 60) return { bg, ink: null }; // nothing that stands out: no ink to match
  // anti-aliased edges are a mix of ink and paper; the cores of the strokes are the ink itself
  const core = cells.filter(([, d]) => d >= max * 0.85);
  const ink = [0, 1, 2].map((k) => Math.round(core.reduce((s, [c]) => s + c[k], 0) / core.length));
  return { bg, ink };
}

// The 14 standard PDF fonts only cover WinAnsi (Latin-1 plus a few symbols), the same test as in pdf.js.
const WINANSI = /^[\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/;

/** Which standard font comes closest: { family: "helvetica" | "times" | "courier", bold, italic } from a font's name. */
function fontStyle(name = "", hints = {}) {
  const n = String(name).replace(/^[A-Z]{6}\+/, "");
  const bold = !!hints.bold || /bold|black|heavy|semibold|demi|,b$|-bd$/i.test(n);
  const italic = !!hints.italic || /italic|oblique|,i$|-it$/i.test(n);
  const mono = /courier|mono|consol|menlo|typewriter|fixed/i.test(n) || hints.family === "monospace";
  const sans = /sans|grotesk|gothic|arial|helvet|verdana|tahoma|calibri|segoe|roboto|inter\b|futura|frutiger|myriad/i.test(n);
  const serif = !mono && !sans && (/times|serif|roman|georgia|garamond|cambria|book|minion|palatino|baskerville|century|caslon|didot|bodoni|merriweather|charter/i.test(n) || hints.family === "serif");
  return { family: mono ? "courier" : serif ? "times" : "helvetica", bold, italic };
}

/** The pdf-lib StandardFonts value for a style. */
function standardFont({ family, bold, italic }) {
  const S = StandardFonts;
  if (family === "times") return bold ? (italic ? S.TimesRomanBoldItalic : S.TimesRomanBold) : italic ? S.TimesRomanItalic : S.TimesRoman;
  if (family === "courier") return bold ? (italic ? S.CourierBoldOblique : S.CourierBold) : italic ? S.CourierOblique : S.Courier;
  return bold ? (italic ? S.HelveticaBoldOblique : S.HelveticaBold) : italic ? S.HelveticaOblique : S.Helvetica;
}

// ---------- changes ----------
// Every user action is one entry of st.ops: { key, ...fields }. The state of a piece is its original merged with
// every entry for its key, in order, so Undo is simply dropping the last entry. Original pieces have keys "page:index",
// added text "a<number>"; an empty text means the piece is deleted.

/** The current state of every piece that has entries: Map key → merged fields. */
function foldOps(ops) {
  const out = new Map();
  for (const op of ops) out.set(op.key, Object.assign(out.get(op.key) || {}, op));
  return out;
}

/** The changes that will be saved: [{ key, page, kind: "edit" | "delete" | "add", run?, now }]. */
function pendingChanges(st) {
  const list = [];
  for (const [key, now] of foldOps(st.ops)) {
    if (now.added) { if (!now.text.trim()) continue; list.push({ key, page: now.page, kind: "add", now }); continue; }
    const run = st.runs[now.page]?.find((r) => r.key === key);
    if (!run || now.text === run.text) continue;
    list.push({ key, page: run.page, kind: now.text.trim() ? "edit" : "delete", run, now });
  }
  return list.sort((a, b) => a.page - b.page);
}

const INKS = { black: [17, 17, 17], blue: [26, 63, 168], red: [198, 40, 40] };
const CSS_FAMILY = { helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif', times: '"Times New Roman", Times, serif', courier: '"Courier New", Courier, monospace' };
const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
const clip = (s, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- the tool ----------

const pdfEditTool = {
  id: "pdf-edit",
  title: "Edit PDF text",
  description: "Fix a typo, a date, a name or an amount right in a PDF: click any text on the page and type the new one, delete a piece of text or add your own anywhere. The new text goes on top in a matching font and colour, over a patch in the colour of the page. The old text is covered, not removed from the file: to take sensitive text out for good, use Redact PDF.",
  keywords: ["edit pdf", "edit text", "change text", "replace text", "fix typo", "correct", "rewrite", "amount", "date", "name", "pdf editor", "редагувати pdf", "редагувати текст", "змінити текст", "виправити", "помилка", "редактировать pdf", "изменить текст", "исправить", "опечатка"],
  accept: "application/pdf,.pdf",
  multiple: false,
  hint: "One PDF with real text (a scan has no text to edit, but you can still add text to it)",
  runLabel: "Save edited PDF",
  renderOptions(root, files) {
    const file = files[0];
    const st = this.state?.file === file ? this.state : { file, ops: [], runs: [], seq: 0 };
    this.state = st;
    let adding = false, editor = null;

    // ---- toolbar ----
    const addBtn = el("button", { type: "button", class: "chip-btn", "aria-pressed": "false", onclick: () => setAdding(!adding) }, [el("span", { class: "glyph", text: "T+" }), "Add text"]);
    const undoBtn = el("button", { type: "button", text: "Undo", title: "Undo the last change (Ctrl+Z)", onclick: () => undo() });
    const resetBtn = el("button", { type: "button", text: "Reset", title: "Drop every change", onclick: () => reset() });
    const size = select(["8", "9", "10", "11", "12", "14", "16", "18", "24"].map((v) => [v, `${v} pt`]), "11");
    const family = select([["helvetica", "Sans serif"], ["times", "Serif"], ["courier", "Monospace"]], "helvetica");
    const ink = select([["black", "Black ink"], ["blue", "Blue ink"], ["red", "Red ink"]], "black");
    const bold = checkbox("Bold", false);
    const hint = el("div", { class: "stat" });
    const info = el("div", { class: "stat" });
    const list = el("ol", { class: "edit-changes" });
    const pagesBox = el("div", { class: "sign-pages edit-pages" });
    const setAdding = (on) => {
      adding = on;
      addBtn.classList.toggle("on", on); addBtn.setAttribute("aria-pressed", on ? "true" : "false");
      pagesBox.classList.toggle("placing", on);
      hint.textContent = on ? t("Click on the page where the new text should start.")
        : t("Click any text on the page to change it. × deletes a piece of text. The old text is covered, not removed from the file: use Redact PDF to remove sensitive text for real.");
    };
    root.append(
      el("div", { class: "annot-bar" }, [
        el("div", { class: "chip-row" }, [addBtn, undoBtn, resetBtn]),
        el("div", { class: "row" }, [field("Text size", size), field("Font", family), field("Ink", ink), bold.label]),
      ]),
      hint, pagesBox, info, list,
    );
    setAdding(false);

    // ---- pages ----
    const sheets = []; // per page: { sheet, layer, scale, vp }
    const toView = (L) => (x, y) => L.vp.convertToViewportPoint(x, y);
    const toPdf = (L) => (x, y) => L.vp.convertToPdfPoint(x, y);
    const paperOf = new Map(); // key → sampled [bg, ink] for the on-screen preview
    const coloursOf = (L, run) => {
      if (paperOf.has(run.key)) return paperOf.get(run.key);
      const canvas = L.sheet.querySelector("canvas.sign-canvas");
      if (!canvas) return { bg: [255, 255, 255], ink: null };
      const k = canvas.width / L.vp.width, pad = run.g.size * 0.15;
      const corners = quadOf(run.g).map(([x, y]) => L.vp.convertToViewportPoint(x, y));
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      const x0 = (Math.min(...xs) - pad) * k, x1 = (Math.max(...xs) + pad) * k, y0 = (Math.min(...ys) - pad) * k, y1 = (Math.max(...ys) + pad) * k;
      try {
        const g = canvas.getContext("2d", { willReadFrequently: true });
        const sx = Math.max(0, Math.floor(x0) - 4), sy = Math.max(0, Math.floor(y0) - 4);
        const w = Math.min(canvas.width - sx, Math.ceil(x1 - x0) + 9), h = Math.min(canvas.height - sy, Math.ceil(y1 - y0) + 9);
        if (w <= 0 || h <= 0) return { bg: [255, 255, 255], ink: null };
        const res = sampleColours(g.getImageData(sx, sy, w, h), x0 - sx, y0 - sy, x1 - sx, y1 - sy);
        paperOf.set(run.key, res);
        return res;
      } catch (_) { return { bg: [255, 255, 255], ink: null }; }
    };
    const boxStyle = (L, g) => {
      const b = viewBox(g, toView(L)), s = L.scale;
      return `left:${b.left * s}px;top:${b.top * s}px;min-width:${b.width * s}px;height:${b.height * s}px;line-height:${b.height * s}px;font-size:${g.size * s}px;${b.angle ? `transform:rotate(${b.angle}deg);transform-origin:0 0;` : ""}`;
    };

    const paintPage = (i) => {
      const L = sheets[i]; if (!L) return;
      const now = foldOps(st.ops);
      const nodes = [];
      for (const run of st.runs[i] || []) {
        const cur = now.get(run.key), changed = cur && cur.text !== run.text;
        const node = el("div", { class: `sign-item edit-run${changed ? " changed" : ""}`, title: changed ? `${t("Was")}: ${run.text}` : "Click to change", style: `${boxStyle(L, run.g)}cursor:text;white-space:pre;padding:0;font-family:${CSS_FAMILY[run.style.family]};${run.style.bold ? "font-weight:700;" : ""}${run.style.italic ? "font-style:italic;" : ""}` });
        if (changed) {
          const { bg, ink: inkC } = coloursOf(L, run);
          node.style.background = css(bg); node.style.color = css(inkC || INKS.black);
          node.textContent = cur.text;
        } else node.style.color = "transparent";
        node.addEventListener("pointerdown", (e) => { e.stopPropagation(); e.preventDefault(); openEditor(L, i, run.key, cur ? cur.text : run.text, run.g, node); });
        if (!changed || cur.text) node.append(delButton(() => push({ key: run.key, page: i, text: "" })));
        nodes.push(node);
      }
      for (const [key, cur] of now) {
        if (!cur.added || cur.page !== i || !cur.text.trim()) continue;
        const node = el("div", { class: "sign-item edit-added selected", style: `${boxStyle(L, cur.g)}white-space:pre;padding:0;color:${css(cur.color)};font-family:${CSS_FAMILY[cur.style.family]};${cur.style.bold ? "font-weight:700;" : ""}` });
        node.textContent = cur.text;
        node.append(delButton(() => push({ key, text: "" })));
        dragAdded(L, i, key, cur, node);
        nodes.push(node);
      }
      L.layer.replaceChildren(...nodes);
      if (editor?.page === i) L.layer.append(editor.input);
    };
    const delButton = (onDelete) => el("button", { type: "button", class: "sign-del", title: "Delete this text", "aria-label": "Delete this text", text: "×", onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); onDelete(); } });

    // ---- editing ----
    const push = (op) => { st.ops.push(op); paintPage(op.page ?? foldOps(st.ops).get(op.key)?.page); paintInfo(); };
    const undo = () => {
      closeEditor(false);
      const op = st.ops.pop(); if (!op) return;
      const page = op.page ?? foldOps(st.ops).get(op.key)?.page ?? st.runs.findIndex((rs) => rs?.some((r) => r.key === op.key));
      paintPage(page); paintInfo();
    };
    const reset = () => { closeEditor(false); st.ops = []; sheets.forEach((_, i) => paintPage(i)); paintInfo(); };
    const closeEditor = (commit) => {
      const ed = editor; if (!ed) return;
      editor = null;
      ed.input.remove();
      if (commit) ed.commit(ed.input.value.replace(/[\r\n]+/g, " "));
      paintPage(ed.page);
    };
    /** An input over the piece; `commit(text)` records the change. */
    const openEditor = (L, i, key, text, g, node, commit) => {
      closeEditor(true);
      const input = el("input", { type: "text", class: "edit-input", value: text, spellcheck: "false", "data-noremember": "", "aria-label": "New text" });
      const fam = node?.style.fontFamily || CSS_FAMILY.helvetica;
      input.setAttribute("style", `${boxStyle(L, g)}position:absolute;z-index:3;box-sizing:content-box;margin:0;padding:0 2px;border:0;outline:2px solid var(--accent);border-radius:2px;background:#fff;color:#111;font-family:${fam};${node?.style.fontWeight ? `font-weight:${node.style.fontWeight};` : ""}width:${Math.max(viewBox(g, toView(L)).width * L.scale + 24, 80)}px`);
      input.value = text;
      editor = {
        page: i, input,
        commit: commit || ((v) => { const cur = foldOps(st.ops).get(key); if (v !== (cur ? cur.text : st.runs[i].find((r) => r.key === key).text)) push({ key, page: i, text: v }); }),
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); closeEditor(true); }
        else if (e.key === "Escape") { e.preventDefault(); closeEditor(false); }
      });
      input.addEventListener("blur", () => { if (editor?.input === input) closeEditor(true); });
      input.addEventListener("pointerdown", (e) => e.stopPropagation());
      L.layer.append(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
    };
    const addAt = (L, i, vx, vy) => {
      const pt = Number(size.value) || 11;
      // the click marks the middle of the first letter: the baseline sits a third of an em below it
      const [x, y] = toPdf(L)(vx, vy + pt * 0.35);
      const style = { family: family.value, bold: bold.input.checked, italic: false };
      const g = { x, y, angle: uprightAngle(toPdf(L), vx, vy), size: pt, width: 0, asc: 0.8, desc: 0.22 };
      const key = `a${++st.seq}`;
      openEditor(L, i, key, "", g, null, (v) => { if (v.trim()) push({ key, page: i, added: true, text: v, g, style, color: INKS[ink.value] || INKS.black }); });
      editor.input.style.fontFamily = CSS_FAMILY[style.family];
      if (style.bold) editor.input.style.fontWeight = "700";
      editor.input.style.color = css(INKS[ink.value] || INKS.black);
      setAdding(false);
    };
    /** Added text moves when dragged and opens for editing when clicked. */
    const dragAdded = (L, i, key, cur, node) => {
      let start = null, moved = false;
      node.style.cursor = "move"; node.style.touchAction = "none";
      node.addEventListener("pointerdown", (e) => {
        e.stopPropagation(); e.preventDefault();
        start = { x: e.clientX, y: e.clientY }; moved = false;
        node.setPointerCapture(e.pointerId);
      });
      node.addEventListener("pointermove", (e) => {
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        node.style.translate = `${dx}px ${dy}px`;
      });
      const end = (e) => {
        if (!start) return;
        const dx = (e.clientX - start.x) / L.scale, dy = (e.clientY - start.y) / L.scale;
        start = null;
        if (!moved) { openEditor(L, i, key, cur.text, cur.g, node); return; }
        const [vx, vy] = toView(L)(cur.g.x, cur.g.y), [x, y] = toPdf(L)(vx + dx, vy + dy);
        push({ key, g: { ...cur.g, x, y } });
      };
      node.addEventListener("pointerup", end);
      node.addEventListener("pointercancel", () => { start = null; node.style.translate = ""; });
    };

    // ---- the list of changes ----
    const paintInfo = () => {
      const changes = pendingChanges(st);
      undoBtn.disabled = !st.ops.length; resetBtn.disabled = !st.ops.length;
      info.textContent = changes.length ? plural(changes.length, "change") : t("No changes yet");
      list.replaceChildren(...changes.map((c) => {
        const label = c.kind === "add" ? t("added “{text}”", { text: clip(c.now.text) })
          : c.kind === "delete" ? t("deleted “{text}”", { text: clip(c.run.text) })
          : `“${clip(c.run.text)}” → “${clip(c.now.text)}”`;
        return el("li", {}, [el("button", { type: "button", class: "link", onclick: () => sheets[c.page]?.sheet.scrollIntoView({ behavior: "smooth", block: "center" }) }, [`${t("page {n}", { n: c.page + 1 })}: ${label}`])]);
      }));
    };

    const onKey = (e) => {
      if (!root.isConnected) { document.removeEventListener("keydown", onKey); return; }
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && st.ops.length) { e.preventDefault(); undo(); }
    };
    document.addEventListener("keydown", onKey);

    closeDocs();
    const token = (this.token = {});
    openDoc(file).then(async (doc) => {
      if (this.token !== token) return; // a newer file took over while this one was opening
      const width = Math.min(820, root.clientWidth > 200 ? root.clientWidth - 40 : 820);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const paintCanvas = (i) => renderThumb(doc, i, Math.round(width * dpr)).then((c) => {
        c.className = "sign-canvas"; sheets[i].sheet.querySelector(".ph")?.replaceWith(c);
        paperOf.clear(); paintPage(i);
      }).catch(() => {});
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); paintCanvas(e.target._index); }
      }, { root: pagesBox, rootMargin: "400px" });
      for (let i = 0; i < doc.numPages; i++) {
        const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
        const scale = width / vp.width;
        const layer = el("div", { class: "sign-layer" });
        const sheet = el("div", { class: "sign-sheet", style: `width:${width}px;height:${Math.round(vp.height * scale)}px` }, [el("div", { class: "ph" }), layer, el("span", { class: "page-n", text: `${i + 1} / ${doc.numPages}` })]);
        sheet._index = i;
        const L = { sheet, layer, scale, vp };
        sheets.push(L);
        sheet.addEventListener("pointerdown", (e) => {
          if (e.target.closest(".sign-item, .edit-input")) return;
          if (!adding) return;
          e.preventDefault();
          const r = sheet.getBoundingClientRect();
          addAt(L, i, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
        });
        pagesBox.append(sheet);
        if (i < 2) paintCanvas(i); else io.observe(sheet);
      }
      // the text of each page, in the background: a long document is usable before all of it is read
      let pieces = 0;
      for (let i = 0; i < doc.numPages; i++) {
        if (this.token !== token) return;
        if (!st.runs[i]) {
          const page = await doc.getPage(i + 1), content = await page.getTextContent();
          st.runs[i] = content.items.map((it, k) => ({ it, k })).filter(({ it }) => it.str?.trim() && it.width > 0 && !content.styles[it.fontName]?.vertical).map(({ it, k }) => {
            const s = content.styles[it.fontName] || {};
            return { key: `${i}:${k}`, page: i, text: it.str, g: runGeometry(it, s), style: fontStyle("", { family: s.fontFamily }) };
          });
        }
        pieces += st.runs[i].length;
        paintPage(i);
      }
      if (!pieces) hint.textContent = t("This PDF has no text to edit (it is probably a scan or a picture). You can still add new text with Add text.");
      paintInfo();
    }).catch((err) => { pagesBox.replaceChildren(el("p", { class: "stat bad", text: err.message })); });
    paintInfo();
  },
  async run(files, _root, progress) {
    const st = this.state;
    const changes = st ? pendingChanges(st) : [];
    if (!changes.length) throw new Error("Change, delete or add some text first");
    const doc = await loadPdf(files[0]);
    const pages = doc.getPages();
    const view = await pdfjsOpen(new Uint8Array(await files[0].arrayBuffer()));
    const fonts = new Map();
    const fontOf = async (style, text) => {
      const winAnsi = WINANSI.test(text);
      const k = winAnsi ? standardFont(style) : `noto-${style.bold ? "bold" : "regular"}`;
      if (!fonts.has(k)) fonts.set(k, winAnsi ? await doc.embedFont(k) : await fontFor(doc, "Ж", style.bold));
      return fonts.get(k);
    };
    const byPage = new Map();
    for (const c of changes) byPage.set(c.page, [...(byPage.get(c.page) || []), c]);
    progress?.start(byPage.size);
    try {
      for (const [i, list] of byPage) {
        await progress?.tick(t("page {n}", { n: i + 1 }));
        const page = pages[i];
        if (!page) continue;
        // Render the page once: its pixels give the paper and ink colours, its fonts (loaded by the render) the names.
        const pdfPage = await view.getPage(i + 1), vp = pdfPage.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
        const img = g.getImageData(0, 0, canvas.width, canvas.height);
        // font ids are per document ("g_d3_f1"), so look the pieces up again in this one, by their index
        const items = (await pdfPage.getTextContent()).items;
        const texts = [];
        // patches first, then all the new text, so a patch never hides a neighbour's new text
        for (const c of list) {
          if (c.kind === "add") { texts.push({ text: c.now.text.trim(), g: c.now.g, style: c.now.style, color: c.now.color }); continue; }
          const corners = quadOf(c.run.g).map(([x, y]) => vp.convertToViewportPoint(x, y));
          const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
          const { bg, ink } = sampleColours(img, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
          const r = coverRect(c.run.g);
          page.drawRectangle({ x: r.x, y: r.y, width: r.width, height: r.height, rotate: degrees(r.rotate), color: rgb(bg[0] / 255, bg[1] / 255, bg[2] / 255), borderWidth: 0 });
          if (c.kind === "delete") continue;
          let style = c.run.style;
          try {
            const id = items[Number(c.key.split(":")[1])]?.fontName;
            const font = id && pdfPage.commonObjs.has(id) ? pdfPage.commonObjs.get(id) : null;
            if (font) style = fontStyle(font.name, { bold: font.bold, italic: font.italic, family: font.fallbackName || style.family });
          } catch (_) { /* the font is not loaded: keep what the text layer said */ }
          // a dark sampled ink is kept as it is; grey from thin anti-aliased strokes is taken as black
          const colour = ink && !(Math.max(...ink) < 90 && Math.max(...ink) - Math.min(...ink) < 24) ? ink : [0, 0, 0];
          texts.push({ text: c.now.text.trim(), g: c.run.g, style, color: colour });
        }
        for (const x of texts) {
          const font = await fontOf(x.style, x.text);
          page.drawText(x.text, { x: x.g.x, y: x.g.y, size: x.g.size, font, color: rgb(x.color[0] / 255, x.color[1] / 255, x.color[2] / 255), rotate: degrees(x.g.angle * 180 / Math.PI) });
        }
        pdfPage.cleanup();
      }
    } finally { await view.destroy(); }
    const blob = pdfBlob(await doc.save());
    return [{ name: `${baseName(files[0].name)}-edited.pdf`, blob, note: `${plural(changes.length, "change")} · ${t("old text covered, still inside the file")}` }];
  },
};

export const pdfEditTools = [pdfEditTool];
