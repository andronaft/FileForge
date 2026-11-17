// Office documents: Word (.docx) to PDF / HTML / Markdown / text with mammoth, and Excel / ODS to CSV / JSON and back
// with SheetJS. Both libraries are loaded only when one of these tools is opened.
import { el, baseName, field, select, checkbox, download, formatBytes, plural, toast, t } from "../util.js";
import { parseTable, convertTable } from "./data.js";

const VENDOR = new URL("../../vendor/office/", import.meta.url).href;
const loading = {};
function loadScript(name, global) {
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  loading[name] ??= new Promise((resolve, reject) => {
    const s = el("script", { src: VENDOR + name });
    s.onload = () => (globalThis[global] ? resolve(globalThis[global]) : reject(new Error(`${name} did not load`)));
    s.onerror = () => { delete loading[name]; reject(new Error(t("Could not load {name}", { name }))); };
    document.head.append(s);
  });
  return loading[name];
}

/** Markdown from mammoth's HTML: headings, paragraphs, bold / italic, links, lists (nested), tables, quotes. */
function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const esc = (s) => s.replace(/([\\`*_[\]])/g, "\\$1"); // only what would change the text inside a line
  const inline = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return esc(n.textContent.replace(/\s+/g, " "));
    if (n.nodeType !== 1) return "";
    const tag = n.tagName.toLowerCase(), inner = inline(n);
    if (tag === "strong" || tag === "b") return inner.trim() ? `**${inner}**` : inner;
    if (tag === "em" || tag === "i") return inner.trim() ? `*${inner}*` : inner;
    if (tag === "a") return n.getAttribute("href") && !n.getAttribute("href").startsWith("#") ? `[${inner}](${n.getAttribute("href")})` : inner;
    if (tag === "br") return "  \n";
    if (tag === "img") return `*[${t("picture")}${n.alt ? `: ${n.alt}` : ""}]*`;
    if (tag === "sup") return `^${inner}^`;
    return inner;
  }).join("");
  const blocks = (node, depth = 0) => {
    const out = [];
    for (const n of node.children) {
      const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) out.push(`${"#".repeat(Number(tag[1]))} ${inline(n).trim()}`);
      else if (tag === "p") { const x = inline(n).trim(); if (x) out.push(x); }
      else if (tag === "ul" || tag === "ol") {
        out.push([...n.children].filter((li) => li.tagName === "LI").map((li, i) => {
          const nested = [...li.children].filter((c) => /^(UL|OL)$/.test(c.tagName));
          const own = li.cloneNode(true);
          own.querySelectorAll("ul, ol").forEach((x) => x.remove());
          const text = inline(own).trim();
          const bullet = `${"  ".repeat(depth)}${tag === "ol" ? `${i + 1}.` : "-"} ${text}`;
          return [bullet, ...nested.map((x) => blocks({ children: [x] }, depth + 1).join("\n"))].join("\n");
        }).join("\n"));
      } else if (tag === "table") {
        const rows = [...n.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => inline(c).trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
        if (!rows.length) continue;
        const cols = Math.max(...rows.map((r) => r.length));
        const pad = (r) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
        out.push([`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(cols).fill("---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`)].join("\n"));
      } else if (tag === "blockquote") out.push(blocks(n, depth).join("\n\n").split("\n").map((l) => `> ${l}`).join("\n"));
      else out.push(...blocks(n, depth));
    }
    return out;
  };
  return blocks(doc.body).join("\n\n") + "\n";
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Word ----------

const DOC_CSS = `
  body { font: 11pt/1.5 Calibri, Carlito, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; max-width: 780px; margin: 0 auto; padding: 32px 28px; }
  h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.1em 0 .5em; }
  p { margin: 0 0 .7em; }
  table { border-collapse: collapse; margin: .8em 0; width: auto; max-width: 100%; }
  td, th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
  td p, th p { margin: 0; }
  img { max-width: 100%; height: auto; }
  ul, ol { margin: 0 0 .7em; padding-left: 1.6em; }
  a { color: #1a56b0; }
  blockquote { margin: .8em 0; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
  .footnotes, ol[class*=note] { font-size: 9pt; color: #444; }
  @media print { body { max-width: none; padding: 0; } table, img { page-break-inside: avoid; } }`;

// Word paragraph styles beyond the built-in headings that should still come out as something sensible.
const STYLE_MAP = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => h2.subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "r[style-name='Strong'] => strong",
  "p[style-name='Заголовок 1'] => h1:fresh",
  "p[style-name='Заголовок 2'] => h2:fresh",
  "p[style-name='Заголовок 3'] => h3:fresh",
];

function wordPage(body, title, pageSize) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${pageSize}; margin: 20mm 18mm; }
${DOC_CSS}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const wordTool = {
  id: "word",
  title: "Word to PDF",
  description: "Open a Word document (.docx) and save it as PDF, a web page, Markdown or plain text. Headings, lists, tables, links, bold and italic and pictures come across; exact page layout, columns and fonts do not.",
  keywords: ["docx", "word", "doc to pdf", "word to pdf", "word to html", "word to text", "microsoft word", "convert word", "ворд", "документ"],
  accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  multiple: false,
  hint: "One .docx file (Word 2007 or newer; old .doc files need saving as .docx first)",
  runLabel: "Save as PDF",
  noAutoDownload: true,
  renderOptions(root, files) {
    const file = files[0];
    const pageSize = select([["A4", "A4"], ["Letter", "Letter"]], "A4");
    const preview = el("iframe", { class: "md-preview doc-preview", title: "Preview", sandbox: "allow-same-origin allow-modals" });
    const info = el("div", { class: "stat", text: "Reading…" });
    const save = (fmt) => async () => {
      try {
        const st = await this.ready;
        const name = baseName(file.name);
        if (fmt === "html") download(new Blob([wordPage(st.html, name, pageSize.value)], { type: "text/html" }), `${name}.html`);
        else if (fmt === "md") download(new Blob([await st.markdown()], { type: "text/markdown" }), `${name}.md`);
        else download(new Blob([await st.text()], { type: "text/plain" }), `${name}.txt`);
      } catch (err) { toast(err.message, "error"); }
    };
    root.append(
      el("div", { class: "row" }, [field("Page size", pageSize), el("div", { class: "actions" }, [
        el("button", { type: "button", text: "Download .html", onclick: save("html") }),
        el("button", { type: "button", text: "Download .md", onclick: save("md") }),
        el("button", { type: "button", text: "Download .txt", onclick: save("txt") }),
      ])]),
      info, preview,
      el("div", { class: "stat", text: "Save as PDF opens the print dialog: pick \"Save as PDF\" as the printer." }),
    );
    this.preview = preview;
    this.title = baseName(file.name);
    this.ready = (async () => {
      const mammoth = await loadScript("mammoth.browser.min.js", "mammoth");
      const arrayBuffer = await file.arrayBuffer();
      const res = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP, includeDefaultStyleMap: true });
      const st = {
        html: res.value,
        markdown: async () => htmlToMarkdown(res.value),
        text: async () => (await mammoth.extractRawText({ arrayBuffer })).value,
      };
      const doc = new DOMParser().parseFromString(res.value, "text/html");
      const words = (doc.body.textContent.match(/\S+/g) || []).length;
      const unsupported = new Set(res.messages.filter((m) => m.type === "warning").map((m) => m.message.replace(/: .*$/, "")));
      info.textContent = [plural(words, "word"), plural(doc.querySelectorAll("table").length, "table"), plural(doc.querySelectorAll("img").length, "picture")].join(" · ")
        + (unsupported.size ? ` · ${t("some formatting was simplified")}` : "");
      return st;
    })();
    const paint = () => this.ready.then((st) => { preview.srcdoc = wordPage(st.html, this.title, pageSize.value); })
      .catch((err) => { info.textContent = /central directory|zip/i.test(err.message) ? t("This is not a .docx file. An old .doc needs saving as .docx in Word or LibreOffice first.") : err.message; info.className = "stat bad"; });
    pageSize.addEventListener("change", paint);
    paint();
  },
  async run() {
    await this.ready;
    const win = this.preview?.contentWindow;
    if (!win?.document?.body) throw new Error("Preview is not ready yet");
    win.document.title = this.title;
    win.focus();
    win.print();
    return [];
  },
};

// ---------- Excel / ODS → table formats ----------

const SHEET_FORMATS = { csv: ["CSV", "csv", "text/csv"], tsv: ["TSV (tab-separated)", "tsv", "text/tab-separated-values"], json: ["JSON (array of objects)", "json", "application/json"], jsonrows: ["JSON (array of rows)", "json", "application/json"], markdown: ["Markdown table", "md", "text/markdown"], html: ["HTML table", "html", "text/html"], sql: ["SQL INSERT statements", "sql", "text/plain"] };

/** A sheet as rows of strings, using the cell text Excel shows (dates and numbers formatted). */
function sheetRows(XLSX, ws) {
  // dateNF replaces Excel's locale-dependent "short date" (m/d/yy in SheetJS) with an unambiguous ISO date
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", blankrows: false, dateNF: "yyyy-mm-dd" });
  // drop empty trailing columns
  let width = 0;
  for (const r of rows) for (let i = r.length - 1; i >= width; i--) if (String(r[i]).trim()) { width = i + 1; break; }
  return rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? "")));
}

const excelReadTool = {
  id: "excel-read",
  title: "Excel to CSV / JSON",
  description: "Open an Excel workbook (.xlsx, .xls), an OpenDocument sheet (.ods) or Numbers export and save its sheets as CSV, JSON, a Markdown or HTML table or SQL. Every sheet, or only the one you pick.",
  keywords: ["xlsx", "xls", "excel", "spreadsheet", "ods", "sheet", "excel to csv", "excel to json", "таблиця", "ексель"],
  accept: ".xlsx,.xlsm,.xls,.xlsb,.ods,.fods,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet",
  hint: "One or more spreadsheets",
  runLabel: "Convert",
  renderOptions(root, files) {
    const to = select(Object.entries(SHEET_FORMATS).map(([k, [label]]) => [k, label]), "csv");
    const which = select([["all", "Every sheet"]], "all", { "data-noremember": "" });
    const header = checkbox("First row is the header", true);
    const info = el("div", { class: "stat", text: "Reading…" });
    const table = el("table", { class: "meta sheet-preview" });
    root.append(el("div", { class: "row" }, [field("Save as", to), field("Sheets", which), header.label]), info, el("div", { class: "table-wrap" }, [table]));
    this.opts = { to, which, header };
    this.ready = (async () => {
      const XLSX = await loadScript("xlsx.full.min.js", "XLSX");
      const books = [];
      for (const f of files) books.push({ file: f, wb: XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true, dense: true }) });
      return { XLSX, books };
    })();
    this.ready.then(({ XLSX, books }) => {
      const names = [...new Set(books.flatMap((b) => b.wb.SheetNames))];
      if (books.length === 1) for (const n of names) which.append(el("option", { value: n, text: n }));
      const show = () => {
        const b = books[0], name = which.value === "all" ? b.wb.SheetNames[0] : which.value;
        const rows = sheetRows(XLSX, b.wb.Sheets[name]);
        info.textContent = `${books.length > 1 ? plural(books.length, "file") + " · " : ""}${plural(books.reduce((s, x) => s + x.wb.SheetNames.length, 0), "sheet")} · ${t("preview of {name}", { name })}: ${plural(rows.length, "row")}`;
        table.replaceChildren(...rows.slice(0, 40).map((r) => el("tr", {}, r.slice(0, 12).map((c, i) => el(i === 0 ? "th" : "td", { text: c.length > 60 ? c.slice(0, 60) + "…" : c })))));
      };
      which.addEventListener("change", show);
      show();
    }).catch((err) => { info.textContent = err.message; info.className = "stat bad"; });
  },
  async run(files, _root, progress) {
    const { XLSX, books } = await this.ready;
    const o = this.opts, [, ext, mime] = SHEET_FORMATS[o.to.value];
    const out = [];
    for (const { file, wb } of books) {
      const names = o.which.value === "all" ? wb.SheetNames : wb.SheetNames.filter((n) => n === o.which.value);
      for (const name of names) {
        await progress?.tick(`${file.name} · ${name}`);
        const rows = sheetRows(XLSX, wb.Sheets[name]);
        if (!rows.length) continue;
        const text = convertTable(rows, o.to.value, o.header.input.checked, name.replace(/\W+/g, "_") || "data");
        const stem = wb.SheetNames.length > 1 ? `${baseName(file.name)}-${name.replace(/[\\/:*?"<>|]+/g, "-")}` : baseName(file.name);
        out.push({ name: `${stem}.${ext}`, blob: new Blob([text], { type: mime }), note: `${plural(rows.length, "row")} × ${rows[0].length}` });
      }
    }
    if (!out.length) throw new Error("These sheets are empty");
    return out;
  },
};

// ---------- tables → Excel ----------

const excelWriteTool = {
  id: "excel-write",
  title: "CSV / JSON to Excel",
  description: "Turn CSV, TSV, JSON, Markdown or HTML tables into an Excel workbook (.xlsx) or OpenDocument sheet (.ods). Several files become sheets of one workbook; numbers and dates stay numbers and dates.",
  keywords: ["xlsx", "excel", "csv to excel", "json to excel", "spreadsheet", "ods", "export", "таблиця", "ексель"],
  accept: ".csv,.tsv,.txt,.json,.md,.html,text/*,application/json",
  orderable: true,
  hint: "One or more table files; each becomes a sheet",
  runLabel: "Create workbook",
  renderOptions(root, files) {
    const format = select([["xlsx", "Excel (.xlsx)"], ["ods", "OpenDocument (.ods)"]], "xlsx");
    const name = el("input", { type: "text", value: files.length === 1 ? baseName(files[0].name) : "workbook", "data-noremember": "" });
    const types = checkbox("Store numbers and dates as numbers and dates", true);
    const info = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [field("Workbook name", name), field("Format", format), types.label]), info);
    this.opts = { format, name, types };
    (async () => {
      const parts = [];
      for (const f of files) { const { rows, from } = parseTable(await f.text()); parts.push(`${f.name}: ${from.toUpperCase() || "?"}, ${plural(rows.length, "row")}`); }
      info.replaceChildren(...parts.map((p) => el("div", { text: p })));
    })().catch((err) => { info.textContent = err.message; });
  },
  async run(files) {
    const XLSX = await loadScript("xlsx.full.min.js", "XLSX");
    const o = this.opts, wb = XLSX.utils.book_new(), used = new Set();
    const typed = (v) => {
      if (!o.types.input.checked) return v;
      const s = v.trim();
      if (/^-?\d+(\.\d+)?$/.test(s) && !/^-?0\d/.test(s) && s.length < 16) return Number(s);
      if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) { const d = new Date(s.replace(" ", "T")); if (!isNaN(d)) return d; }
      return v;
    };
    let total = 0;
    for (const f of files) {
      const { rows } = parseTable(await f.text());
      if (!rows.length) continue;
      const ws = XLSX.utils.aoa_to_sheet(rows.map((r, i) => (i === 0 ? r : r.map(typed))), { cellDates: true, dateNF: "yyyy-mm-dd" });
      ws["!cols"] = Array.from({ length: Math.max(...rows.map((r) => r.length)) }, (_, i) => ({ wch: Math.min(60, Math.max(6, ...rows.slice(0, 200).map((r) => String(r[i] ?? "").length))) }));
      let sheet = baseName(f.name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
      for (let k = 2; used.has(sheet.toLowerCase()); k++) sheet = `${sheet.slice(0, 28)} (${k})`;
      used.add(sheet.toLowerCase());
      XLSX.utils.book_append_sheet(wb, ws, sheet);
      total += rows.length;
    }
    if (!wb.SheetNames.length) throw new Error("No table found in these files");
    const fmt = o.format.value;
    const bytes = XLSX.write(wb, { bookType: fmt, type: "array", compression: true });
    const blob = new Blob([bytes], { type: fmt === "ods" ? "application/vnd.oasis.opendocument.spreadsheet" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const stem = (o.name.value.trim() || "workbook").replace(/[\\/:*?"<>|]+/g, "-");
    return [{ name: `${stem}.${fmt}`, blob, note: `${plural(wb.SheetNames.length, "sheet")} · ${plural(total, "row")} · ${formatBytes(blob.size)}` }];
  },
};

export const officeTools = [wordTool, excelReadTool, excelWriteTool];
