// More PDF tools: passwords and permissions (qpdf), repair, true redaction and text comparison.
import { el, baseName, field, select, checkbox, formatBytes, plural, toast, t } from "../util.js";
import { pdfjsLib, openDoc, closeDocs, renderThumb, loadPdf, pdfBlob, canvasBlob } from "./pdf.js";
import { qpdf, qpdfMessage, pdfLock, decryptPdf, PdfPasswordError } from "../qpdf.js";
import { diffLines, unified } from "./text.js";

const { PDFDocument } = PDFLib;
const PDF_ACCEPT = "application/pdf,.pdf";
const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer());

/** A password field that is never remembered, with a Show checkbox. */
function passwordField(label, hint) {
  const input = el("input", { type: "password", autocomplete: "new-password", spellcheck: "false" });
  const show = checkbox("Show", false);
  show.input.addEventListener("change", () => { input.type = show.input.checked ? "text" : "password"; });
  const wrap = el("div", { class: "row", "data-noremember": "" }, [field(label, input, hint), show.label]);
  return { input, wrap };
}

/** "Opens freely", "restricted" or "needs a password" for each file, shown under the options. */
function lockList(root, files) {
  const box = el("div", { class: "stat" });
  root.append(box);
  const states = new Map();
  (async () => {
    for (const f of files) {
      try { states.set(f, await pdfLock(await bytesOf(f))); } catch (_) { states.set(f, "unknown"); }
      box.replaceChildren(...files.filter((x) => states.has(x)).map((x) => el("div", { text: `${x.name}: ${t({ none: "not protected", restricted: "opens without a password, but printing, copying or editing is restricted", password: "needs a password to open", unknown: "could not be read" }[states.get(x)])}` })));
    }
  })();
  return states;
}

// ---------- protect ----------

function randomPassword() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/[+/=]/g, "x");
}

const protectTool = {
  id: "pdf-protect",
  title: "Protect PDF",
  description: "Put a password on a PDF so it cannot be opened without it, and choose whether printing, copying text and editing are allowed. AES-256 encryption, done on your device.",
  keywords: ["password", "encrypt", "lock", "secure", "restrict", "permissions", "пароль", "захист", "зашифрувати"],
  accept: PDF_ACCEPT,
  hint: "One or more PDF files; they all get the same password",
  runLabel: "Protect",
  renderOptions(root) {
    const open = passwordField("Password to open", "Leave empty to only restrict printing, copying or editing");
    const print = checkbox("Allow printing", true), copy = checkbox("Allow copying text", true), edit = checkbox("Allow editing", true);
    root.append(open.wrap, el("div", { class: "row" }, [print.label, copy.label, edit.label]),
      el("div", { class: "stat", text: "Keep the password somewhere safe: without it the file cannot be opened, and FileForge cannot recover it. Restrictions without a password stop casual use only; any PDF tool can remove them." }));
    this.opts = { open: open.input, print, copy, edit };
  },
  async run(files, _root, progress) {
    const o = this.opts, user = o.open.value;
    const restricts = !o.print.input.checked || !o.copy.input.checked || !o.edit.input.checked;
    if (!user && !restricts) throw new Error("Type a password, or switch off at least one permission");
    // With restrictions the owner password must differ from the open password, or opening the file lifts them.
    const owner = restricts ? randomPassword() : user;
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const args = ["--encrypt", `--user-password=${user}`, `--owner-password=${owner}`, "--bits=256",
        `--print=${o.print.input.checked ? "full" : "none"}`, `--extract=${o.copy.input.checked ? "y" : "n"}`, `--modify=${o.edit.input.checked ? "all" : "none"}`,
        "--", "/in.pdf", "/out.pdf"];
      const res = await qpdf(await bytesOf(file), args);
      if (!res.output || (res.code !== 0 && res.code !== 3)) {
        if (/invalid password/i.test(res.log)) throw new Error(t("{name} already has a password. Remove it with Unlock PDF first.", { name: file.name }));
        throw new Error(`${file.name}: ${qpdfMessage(res.log) || "could not be encrypted"}`);
      }
      out.push({ name: `${baseName(file.name)}-protected.pdf`, blob: pdfBlob(res.output), note: user ? t("password set, AES-256") : t("restricted, no password to open") });
    }
    return out;
  },
};

// ---------- unlock ----------

const unlockTool = {
  id: "pdf-unlock",
  title: "Unlock PDF",
  description: "Remove the password from a PDF you can open, and lift restrictions on printing, copying and editing. A file that needs a password to open still needs that password here once.",
  keywords: ["password", "decrypt", "remove password", "unprotect", "restrictions", "bank statement", "пароль", "зняти пароль", "розблокувати"],
  accept: PDF_ACCEPT,
  hint: "One or more PDF files",
  runLabel: "Unlock",
  renderOptions(root, files) {
    const pw = passwordField("Password", "Only needed for files that ask for one when opened");
    root.append(pw.wrap);
    this.states = lockList(root, files);
    this.opts = { pw: pw.input };
  },
  async run(files, _root, progress) {
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const bytes = await bytesOf(file);
      const lock = await pdfLock(bytes);
      if (lock === "none") { out.push({ name: file.name, blob: pdfBlob(bytes), note: t("was not protected") }); continue; }
      let plain;
      try { plain = await decryptPdf(bytes, lock === "password" ? this.opts.pw.value : ""); }
      catch (err) {
        if (err instanceof PdfPasswordError) throw new Error(this.opts.pw.value ? t("Wrong password for {name}", { name: file.name }) : t("{name} needs its password: type it above", { name: file.name }));
        throw new Error(`${file.name}: ${err.message}`);
      }
      out.push({ name: `${baseName(file.name)}-unlocked.pdf`, blob: pdfBlob(plain), note: lock === "password" ? t("password removed") : t("restrictions removed") });
    }
    return out;
  },
};

// ---------- repair ----------

const repairTool = {
  id: "pdf-repair",
  title: "Repair PDF",
  description: "Rebuild a damaged PDF that will not open, opens with errors or was cut off during download: the file structure is reconstructed and every page that can be read is kept.",
  keywords: ["fix", "corrupt", "broken", "damaged", "recover", "rebuild", "linearize", "web optimised", "відновити", "пошкоджений"],
  accept: PDF_ACCEPT,
  hint: "One or more PDF files",
  runLabel: "Repair",
  renderOptions(root) {
    const web = checkbox("Optimise for the web (first page shows while the rest loads)", false);
    root.append(el("div", { class: "row" }, [web.label]));
    this.opts = { web };
  },
  async run(files, _root, progress) {
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const bytes = await bytesOf(file);
      const args = ["--password=", "--object-streams=generate", ...(this.opts.web.input.checked ? ["--linearize"] : []), "/in.pdf", "/out.pdf"];
      let res = await qpdf(bytes, args);
      let rescued = false;
      if (!res.output || (res.code !== 0 && res.code !== 3)) {
        if (/invalid password/i.test(res.log)) throw new Error(t("{name} is password-protected. Remove the password with Unlock PDF first.", { name: file.name }));
        // qpdf gives up on a file whose end is missing (a cut-off download). pdf-lib is more forgiving: it scans
        // for whatever objects are there. Rebuild with it, then let qpdf tidy the result.
        const reason = qpdfMessage(res.log) || "no readable pages";
        try {
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
          if (!doc.getPageCount()) throw new Error("no pages");
          const rebuilt = await doc.save();
          const tidy = await qpdf(rebuilt, args);
          res = tidy.output && (tidy.code === 0 || tidy.code === 3) ? tidy : { code: 0, log: "", output: rebuilt };
          rescued = true;
        } catch (_) {
          throw new Error(t("{name} is too damaged to rebuild ({reason})", { name: file.name, reason }));
        }
      }
      const problems = res.log.split("\n").filter((l) => /^WARNING:/.test(l)).length + (rescued ? 1 : 0);
      let pages = 0;
      try { pages = (await PDFDocument.load(res.output, { updateMetadata: false })).getPageCount(); } catch (_) { /* leave 0 */ }
      out.push({ name: `${baseName(file.name)}-repaired.pdf`, blob: pdfBlob(res.output), note: `${plural(pages, "page")} · ${rescued ? t("rebuilt from what was left of the file") : problems ? t("{n} problems fixed", { n: problems }) : t("no damage found")}` });
    }
    return out;
  },
};

// ---------- a scrolling stack of pages with an overlay (redact) ----------

/** Lays out every page of `doc` in `box`; calls onSheet(i, sheet, layer, scale, viewport) once per page. */
async function pageStack(doc, box, root, onSheet) {
  const width = Math.min(820, root.clientWidth > 200 ? root.clientWidth - 40 : 820);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const paint = (sheet, i) => renderThumb(doc, i, Math.round(width * dpr)).then((c) => { c.className = "sign-canvas"; sheet.querySelector(".ph")?.replaceWith(c); }).catch(() => {});
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); paint(e.target, e.target._index); }
  }, { root: box, rootMargin: "400px" });
  for (let i = 0; i < doc.numPages; i++) {
    const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
    const scale = width / vp.width;
    const layer = el("div", { class: "sign-layer" });
    const sheet = el("div", { class: "sign-sheet", style: `width:${width}px;height:${Math.round(vp.height * scale)}px` }, [el("div", { class: "ph" }), layer, el("span", { class: "page-n", text: `${i + 1} / ${doc.numPages}` })]);
    sheet._index = i;
    box.append(sheet);
    onSheet(i, sheet, layer, scale, vp);
    if (i < 2) paint(sheet, i); else io.observe(sheet);
  }
}

// ---------- redact ----------

const redactPdfTool = {
  id: "pdf-redact",
  title: "Redact PDF",
  description: "Black out names, numbers and signatures in a PDF for good. Pages you mark are rebuilt as images, so the hidden text is really gone and cannot be copied or searched back out.",
  keywords: ["black out", "hide", "censor", "remove text", "sensitive", "privacy", "blackout", "замалювати", "приховати"],
  accept: PDF_ACCEPT,
  multiple: false,
  hint: "One PDF",
  runLabel: "Redact & save",
  renderOptions(root, files) {
    const file = files[0];
    const st = this.state?.file === file ? this.state : { file, boxes: [] };
    this.state = st;
    const find = el("input", { type: "text", placeholder: "IBAN, name, number…", "data-noremember": "" });
    const dpi = select([["150", "150 dpi (smaller file)"], ["200", "200 dpi"], ["300", "300 dpi (sharpest)"]], "200");
    const all = checkbox("Turn every page into an image (also drops hidden layers and comments)", false);
    const info = el("div", { class: "stat" });
    const pagesBox = el("div", { class: "sign-pages redact-pages" });
    const layers = [];
    const paint = () => {
      for (const L of layers) L.layer.replaceChildren(...st.boxes.filter((b) => b.page === L.i).map((b) => {
        const n = el("div", { class: "redact-box", title: "Click to remove", style: `left:${b.x * L.scale}px;top:${b.y * L.scale}px;width:${b.w * L.scale}px;height:${b.h * L.scale}px` });
        n.addEventListener("pointerdown", (e) => { e.stopPropagation(); st.boxes = st.boxes.filter((x) => x !== b); paint(); });
        return n;
      }));
      const pages = new Set(st.boxes.map((b) => b.page)).size;
      info.textContent = st.boxes.length ? t("{areas} on {pages} · click a box to remove it", { areas: plural(st.boxes.length, "area"), pages: plural(pages, "page"), n: pages }) : t("Drag over the parts to hide, or find a word to mark every place it appears");
    };
    const findBtn = el("button", { type: "button", text: "Find & mark", onclick: async () => {
      const q = find.value.trim().toLowerCase();
      if (!q || !this.doc) return;
      let hits = 0;
      for (let i = 0; i < this.doc.numPages; i++) {
        const page = await this.doc.getPage(i + 1), vp = page.getViewport({ scale: 1 });
        for (const item of (await page.getTextContent()).items) {
          const s = item.str.toLowerCase();
          if (!s.includes(q) || !item.width) continue;
          const [, , , , e, f] = item.transform, h = item.height || Math.hypot(item.transform[2], item.transform[3]);
          for (let at = s.indexOf(q); at >= 0; at = s.indexOf(q, at + q.length)) {
            const x0 = e + item.width * (at / s.length), x1 = e + item.width * ((at + q.length) / s.length);
            const [ax, ay] = vp.convertToViewportPoint(x0, f - h * 0.25), [bx, by] = vp.convertToViewportPoint(x1, f + h * 0.95);
            st.boxes.push({ page: i, x: Math.min(ax, bx) - 1.5, y: Math.min(ay, by) - 1, w: Math.abs(bx - ax) + 3, h: Math.abs(by - ay) + 2 });
            hits++;
          }
        }
      }
      paint();
      toast(hits ? t("Marked {n} places", { n: hits }) : t("No text like that in this PDF (a scan has no text to search)"), hits ? "info" : "error");
    } });
    find.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findBtn.click(); } });
    root.append(
      el("div", { class: "row" }, [field("Find text to hide", find), findBtn,
        el("button", { type: "button", text: "Undo", onclick: () => { st.boxes.pop(); paint(); } }),
        el("button", { type: "button", text: "Clear all", onclick: () => { st.boxes = []; paint(); } })]),
      info, pagesBox,
      el("div", { class: "row" }, [field("Quality of redacted pages", dpi), all.label]),
    );
    this.opts = { dpi, all };
    closeDocs();
    openDoc(file).then((doc) => {
      this.doc = doc;
      return pageStack(doc, pagesBox, root, (i, sheet, layer, scale) => {
        layers.push({ i, layer, scale });
        let start = null, live = null;
        const at = (e) => { const r = sheet.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
        sheet.addEventListener("pointerdown", (e) => {
          start = at(e); sheet.setPointerCapture(e.pointerId);
          live = el("div", { class: "redact-box live" }); layer.append(live);
        });
        sheet.addEventListener("pointermove", (e) => {
          if (!start) return;
          const p = at(e);
          Object.assign(live.style, { left: `${Math.min(start.x, p.x) * scale}px`, top: `${Math.min(start.y, p.y) * scale}px`, width: `${Math.abs(p.x - start.x) * scale}px`, height: `${Math.abs(p.y - start.y) * scale}px` });
        });
        const end = (e) => {
          if (!start) return;
          const p = at(e), b = { page: i, x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
          start = null;
          if (b.w > 3 && b.h > 3) st.boxes.push(b);
          paint();
        };
        sheet.addEventListener("pointerup", end);
        sheet.addEventListener("pointercancel", () => { start = null; paint(); });
      });
    }).then(paint).catch((err) => { pagesBox.replaceChildren(el("p", { class: "stat bad", text: err.message })); });
  },
  async run(files, _root, progress) {
    const st = this.state, o = this.opts;
    if (!st?.boxes.length && !o.all.input.checked) throw new Error("Mark at least one area to hide");
    const src = await loadPdf(files[0]);
    const doc = await pdfjsLib.getDocument({ data: await bytesOf(files[0]), isEvalSupported: false }).promise;
    const out = await PDFDocument.create();
    const scale = (Number(o.dpi.value) || 200) / 72;
    let rebuilt = 0;
    try {
      progress?.start(doc.numPages);
      for (let i = 0; i < doc.numPages; i++) {
        await progress?.tick(`page ${i + 1}`);
        const boxes = st.boxes.filter((b) => b.page === i);
        if (!boxes.length && !o.all.input.checked) { const [copy] = await out.copyPages(src, [i]); out.addPage(copy); continue; }
        const page = await doc.getPage(i + 1), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const g = canvas.getContext("2d");
        g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
        g.fillStyle = "#000";
        for (const b of boxes) g.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
        const jpg = await out.embedJpg(await (await canvasBlob(canvas, "image/jpeg", 0.9)).arrayBuffer());
        out.addPage([base.width, base.height]).drawImage(jpg, { x: 0, y: 0, width: base.width, height: base.height });
        page.cleanup(); rebuilt++;
      }
    } finally { await doc.destroy(); }
    const blob = pdfBlob(await out.save());
    return [{ name: `${baseName(files[0].name)}-redacted.pdf`, blob, note: `${t("{areas} hidden", { areas: plural(st.boxes.length, "area") })} · ${t("{pages} rebuilt as images", { pages: plural(rebuilt, "page") })}` }];
  },
};

// ---------- compare ----------

/** The text of a PDF as lines, each tagged with its page number. */
async function pdfLines(file) {
  const doc = await pdfjsLib.getDocument({ data: await bytesOf(file), isEvalSupported: false }).promise;
  const out = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      let line = "";
      for (const item of (await page.getTextContent()).items) {
        line += item.str;
        if (item.hasEOL) { if (line.trim()) out.push({ page: n, text: line.replace(/\s+/g, " ").trim() }); line = ""; }
      }
      if (line.trim()) out.push({ page: n, text: line.replace(/\s+/g, " ").trim() });
      page.cleanup();
    }
    return { lines: out, pages: doc.numPages };
  } finally { await doc.destroy(); }
}

const comparePdfTool = {
  id: "pdf-compare",
  title: "Compare PDFs",
  description: "See what changed between two versions of a PDF: the text of both is compared line by line, with added and removed lines highlighted and the pages they are on.",
  keywords: ["diff", "difference", "changes", "versions", "contract", "revision", "порівняти", "різниця", "зміни"],
  accept: PDF_ACCEPT,
  orderable: true,
  noAutoDownload: true,
  hint: "Two PDF files: the original first, the changed one second",
  runLabel: "Save report",
  renderOptions(root, files) {
    const summary = el("div", { class: "stat", text: files.length < 2 ? "Add two PDFs to compare" : "Comparing…" });
    const onlyChanges = checkbox("Only changed lines with context", true);
    const out = el("div", { class: "diff", hidden: true });
    root.append(el("div", { class: "row" }, [onlyChanges.label]), summary, out);
    this.ops = null;
    if (files.length < 2) return;
    const [fa, fb] = files;
    const show = () => {
      const ops = this.ops; if (!ops) return;
      const shown = onlyChanges.input.checked ? ops.filter((o, i) => o.type !== "ctx" || ops.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== "ctx")) : ops;
      out.hidden = false;
      out.replaceChildren(...shown.slice(0, 3000).map((o) => el("span", { class: `l ${o.type}` }, [el("span", { class: "n", text: `p${o.page}` }), (o.type === "add" ? "+ " : o.type === "del" ? "− " : "  ") + o.text])));
      if (shown.length > 3000) out.append(el("span", { class: "l ctx", text: t("… {n} more lines", { n: shown.length - 3000 }) }));
    };
    onlyChanges.input.addEventListener("change", show);
    (async () => {
      const [a, b] = await Promise.all([pdfLines(fa), pdfLines(fb)]);
      if (!a.lines.length && !b.lines.length) { summary.textContent = t("Neither PDF has a text layer (scans?). Run them through Image to text (OCR) first."); summary.className = "stat bad"; return; }
      if (a.lines.length + b.lines.length > 40000) { summary.textContent = t("Too long to compare: keep both PDFs under 20,000 lines of text"); return; }
      const ops = diffLines(a.lines.map((l) => l.text), b.lines.map((l) => l.text)).map((o) => ({ ...o, page: o.type === "add" ? b.lines[o.b].page : a.lines[o.a].page }));
      this.ops = ops; this.names = [fa.name, fb.name];
      const add = ops.filter((o) => o.type === "add"), del = ops.filter((o) => o.type === "del");
      const pages = [...new Set([...add, ...del].map((o) => o.page))].sort((x, y) => x - y);
      this.summary = add.length || del.length
        ? t("+{add} −{del} lines · changes on {pages}: {list}", { add: add.length, del: del.length, pages: plural(pages.length, "page"), list: pages.slice(0, 30).join(", ") + (pages.length > 30 ? "…" : "") })
        : t("The text of both PDFs is identical ({a} and {b})", { a: plural(a.pages, "page"), b: plural(b.pages, "page") });
      summary.textContent = this.summary;
      summary.className = `stat ${add.length || del.length ? "" : "ok"}`;
      show();
    })().catch((err) => { summary.textContent = err.message; summary.className = "stat bad"; });
  },
  async run(files) {
    if (files.length !== 2) throw new Error("Add exactly two PDFs: the original and the changed one");
    if (!this.ops) throw new Error("Preview is not ready yet");
    const text = `${this.summary}\n\n${unified(this.ops, this.names[0], this.names[1])}`;
    return [{ name: `${baseName(files[1].name)}-changes.diff`, blob: new Blob([text], { type: "text/plain" }), note: formatBytes(text.length) }];
  },
};

export const pdfMoreTools = [protectTool, unlockTool, repairTool, redactPdfTool, comparePdfTool];
