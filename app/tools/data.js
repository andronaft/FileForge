import { el, baseName, field, select, number, checkbox, download, readAsText, plural, toast, t } from "../util.js";

// ---------- CSV helpers (RFC 4180) ----------

function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [[",", 0], [";", 0], ["\t", 0], ["|", 0]].map(([d]) => [d, (head.match(new RegExp(d === "|" ? "\\|" : d, "g")) || []).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : ",";
}

export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], cell = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function csvCell(v, delimiter) {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, delimiter = ",") {
  const list = Array.isArray(rows) ? rows : [rows];
  if (!list.length) return "";
  if (Array.isArray(list[0])) return list.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join("\n") + "\n";
  const keys = [];
  for (const r of list) for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k);
  return [keys.map((k) => csvCell(k, delimiter)).join(delimiter), ...list.map((r) => keys.map((k) => csvCell(r?.[k], delimiter)).join(delimiter))].join("\n") + "\n";
}

function coerce(v) {
  if (v === "") return "";
  // Only canonical numbers: "01234" (postcodes), "0501234567" (phones) and "1.50" stay strings.
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16 && String(Number(v)) === v) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

// ---------- shared text-tool layout ----------

export function copyButton(getText, label = "Copy") {
  return el("button", { type: "button", class: "copy", text: label, onclick: async () => {
    const text = getText();
    if (!text) return toast("Nothing to copy yet", "error");
    try { await navigator.clipboard.writeText(text); toast("Copied to the clipboard"); }
    catch (err) { toast(`Could not copy: ${err.message}`, "error"); }
  } });
}

function textLayout(root, { inputLabel, outputLabel, placeholder }) {
  const input = el("textarea", { placeholder, spellcheck: "false" });
  const output = el("textarea", { readonly: true, spellcheck: "false", placeholder: "Result appears here" });
  const out = field(outputLabel, output);
  out.append(copyButton(() => output.value, "Copy output"));
  root.append(el("div", { class: "md-grid" }, [field(inputLabel, input), out]));
  return { input, output };
}

async function fillFromFile(files, input, after) {
  if (!files[0]) return;
  try { input.value = await readAsText(files[0]); after?.(); } catch (_) { /* ignore */ }
}

// ---------- CSV ⇄ JSON ----------

const csvJsonTool = {
  id: "csv-json",
  title: "CSV ⇄ JSON",
  description: "Paste or drop a CSV to get JSON, or JSON (an array of objects or arrays) to get CSV. Quotes, commas and newlines inside cells are handled.",
  accept: ".csv,.tsv,.txt,.json,text/csv,application/json,text/plain",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop a .csv or .json file",
  runLabel: "Convert",
  renderOptions(root, files) {
    const { input, output } = textLayout(root, { inputLabel: "Input (CSV or JSON)", outputLabel: "Output", placeholder: "name,age\nAnna,31\nBob,25" });
    const delimiter = select([["auto", "Auto-detect"], [",", "Comma ,"], [";", "Semicolon ;"], ["\t", "Tab"], ["|", "Pipe |"]], "auto");
    const header = checkbox("First row is a header", true);
    const numbers = checkbox("Convert numbers and booleans", true);
    const indent = select([["2", "2 spaces"], ["4", "4 spaces"], ["0", "Minified"]], "2");
    root.prepend(el("div", { class: "row" }, [field("CSV delimiter", delimiter), field("JSON indent", indent), header.label, numbers.label]));
    this.ui = { input, output, delimiter, header, numbers, indent, files };
    fillFromFile(files, input);
  },
  async run() {
    const u = this.ui;
    const text = u.input.value.trim();
    if (!text) throw new Error("Paste some CSV or JSON first");
    const isJson = text.startsWith("[") || text.startsWith("{");
    const delimiter = u.delimiter.value === "auto" ? (isJson ? "," : detectDelimiter(text)) : u.delimiter.value;
    const base = u.files[0] ? baseName(u.files[0].name) : "data";
    if (isJson) {
      let data;
      try { data = JSON.parse(text); } catch (err) { throw new Error(t("Invalid JSON: {error}", { error: err.message })); }
      const csv = toCsv(data, delimiter);
      u.output.value = csv;
      return [{ name: `${base}.csv`, blob: new Blob([csv], { type: "text/csv" }), note: plural(Math.max(0, csv.split("\n").length - 2), "row") }];
    }
    const rows = parseCsv(text, delimiter);
    let data;
    if (u.header.input.checked && rows.length) {
      const keys = rows[0];
      data = rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, u.numbers.input.checked ? coerce(r[i] ?? "") : (r[i] ?? "")])));
    } else {
      data = rows.map((r) => r.map((c) => (u.numbers.input.checked ? coerce(c) : c)));
    }
    const json = JSON.stringify(data, null, Number(u.indent.value) || 0) + "\n";
    u.output.value = json;
    return [{ name: `${base}.json`, blob: new Blob([json], { type: "application/json" }), note: plural(data.length, "record") }];
  },
};

// ---------- JSON format / validate ----------

/** Where JSON.parse would fail: { pos, message } or null. Browsers no longer put the offset in the error message. */
export function jsonError(text) {
  let i = 0;
  const n = text.length;
  const ws = () => { while (i < n && " \t\n\r".includes(text[i])) i++; };
  const fail = (message, at = i) => { throw { pos: Math.min(at, n), message }; };
  const value = () => {
    ws();
    if (i >= n) fail("Unexpected end of input");
    const c = text[i];
    if (c === "{") {
      i++; ws();
      if (text[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail(text[i] === "}" ? "Trailing comma before }" : "Expected a \"key\" in double quotes");
        string(); ws();
        if (text[i] !== ":") fail("Expected : after the key");
        i++; value(); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return; }
        fail(i >= n ? "Unexpected end of input, missing }" : "Expected , or } after a value");
      }
    }
    if (c === "[") {
      i++; ws();
      if (text[i] === "]") { i++; return; }
      for (;;) {
        ws();
        if (text[i] === "]") fail("Trailing comma before ]");
        value(); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return; }
        fail(i >= n ? "Unexpected end of input, missing ]" : "Expected , or ] after a value");
      }
    }
    if (c === '"') return string();
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
      if (!m || (text[i] === "-" && m[0].length === 1)) fail("Invalid number");
      i += m[0].length;
      if (text[i] === "." || (text[i] >= "0" && text[i] <= "9")) fail("Invalid number (leading zeros and trailing dots are not allowed)");
      return;
    }
    for (const word of ["true", "false", "null"]) if (text.startsWith(word, i)) { i += word.length; return; }
    fail(c === "'" ? "Strings must use double quotes" : `Unexpected character ${JSON.stringify(c)}`);
  };
  const string = () => {
    const start = i;
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail("Bad \\u escape", i); i += 6; continue; }
        if (!'"\\/bfnrt'.includes(e || "")) fail(`Bad escape \\${e ?? ""}`, i);
        i += 2; continue;
      }
      if (c === "\n") fail("Line break inside a string (missing closing quote?)", i);
      if (c < " ") fail("Control character inside a string", i);
      i++;
    }
    fail("Unterminated string", start);
  };
  try {
    value(); ws();
    if (i < n) fail(text[i] === "," ? "Trailing comma after the value" : "Unexpected text after the JSON value");
    return null;
  } catch (e) {
    if (e && typeof e.pos === "number") return e;
    throw e;
  }
}

const jsonFormatTool = {
  id: "json-format",
  title: "JSON format & validate",
  description: "Pretty-print or minify JSON and see exactly where it is broken.",
  accept: ".json,.txt,application/json,text/plain",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop a .json file",
  runLabel: "Format",
  renderOptions(root, files) {
    const { input, output } = textLayout(root, { inputLabel: "Input", outputLabel: "Output", placeholder: '{"a": 1, "b": [1, 2, 3]}' });
    const mode = select([["2", "Pretty, 2 spaces"], ["4", "Pretty, 4 spaces"], ["tab", "Pretty, tabs"], ["0", "Minify"]], "2");
    const sortKeys = checkbox("Sort object keys", false);
    const status = el("div", { class: "stat" });
    root.prepend(el("div", { class: "row" }, [field("Mode", mode), sortKeys.label]), status);
    this.ui = { input, output, mode, sortKeys, status, files };
    fillFromFile(files, input);
  },
  async run() {
    const u = this.ui;
    const text = u.input.value;
    if (!text.trim()) throw new Error("Paste some JSON first");
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      const e = jsonError(text);
      if (e) {
        const before = text.slice(0, e.pos);
        const line = before.split("\n").length, col = e.pos - before.lastIndexOf("\n");
        u.status.textContent = t("✖ Invalid JSON at line {line}, column {col}: {message}", { line, col, message: t(e.message) });
        u.input.focus(); u.input.setSelectionRange(e.pos, Math.min(e.pos + 1, text.length));
      } else {
        u.status.textContent = t("Invalid JSON: {error}", { error: err.message });
      }
      throw new Error(u.status.textContent);
    }
    const sorter = (v) => Array.isArray(v) ? v.map(sorter) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorter(v[k])])) : v;
    if (u.sortKeys.input.checked) data = sorter(data);
    const indent = u.mode.value === "tab" ? "\t" : Number(u.mode.value);
    const out = JSON.stringify(data, null, indent) + (indent ? "\n" : "");
    u.output.value = out;
    u.status.textContent = t("✔ Valid JSON · {n} characters", { n: out.length.toLocaleString() });
    const base = u.files[0] ? baseName(u.files[0].name) : "data";
    return [{ name: `${base}${indent ? "" : ".min"}.json`, blob: new Blob([out], { type: "application/json" }) }];
  },
};

// ---------- Base64 ----------

function bytesToBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

function base64ToBytes(b64) {
  const clean = b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const bin = atob(clean.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const base64Tool = {
  id: "base64",
  title: "Base64 encode / decode",
  description: "Encode text or any file to Base64 (optionally as a data: URL), or decode Base64 back to text or a file.",
  accept: "*/*",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop any file to encode it",
  runLabel: "Run",
  renderOptions(root, files) {
    const { input, output } = textLayout(root, { inputLabel: "Input", outputLabel: "Output", placeholder: "Text to encode, or Base64 to decode" });
    const mode = select([["encode", "Encode"], ["decode", "Decode"]], files[0] ? "encode" : "encode");
    const dataUrl = checkbox("As data: URL", false);
    const decodeAs = select([["text", "Decode to text (UTF-8)"], ["file", "Decode to file (download)"]], "text");
    const decodeName = el("input", { type: "text", value: "decoded.bin", placeholder: "File name" });
    const decodeRow = el("div", { class: "row", hidden: true }, [field("Decode as", decodeAs), field("File name", decodeName)]);
    const encodeRow = el("div", { class: "row" }, [dataUrl.label]);
    mode.addEventListener("change", () => { decodeRow.hidden = mode.value !== "decode"; encodeRow.hidden = mode.value !== "encode"; });
    const info = el("div", { class: "stat", text: files[0] ? t("Encoding file: {name}", { name: files[0].name }) : "" });
    root.prepend(el("div", { class: "row" }, [field("Mode", mode)]), encodeRow, decodeRow, info);
    this.ui = { input, output, mode, dataUrl, decodeAs, decodeName, files };
  },
  async run() {
    const u = this.ui;
    const file = u.files[0];
    if (u.mode.value === "encode") {
      let bytes, type = "text/plain";
      if (file) { bytes = new Uint8Array(await file.arrayBuffer()); type = file.type || "application/octet-stream"; }
      else {
        if (!u.input.value) throw new Error("Type some text or drop a file");
        bytes = new TextEncoder().encode(u.input.value);
      }
      const b64 = bytesToBase64(bytes);
      const out = u.dataUrl.input.checked ? `data:${type};base64,${b64}` : b64;
      u.output.value = out.length > 2_000_000 ? out.slice(0, 2_000_000) + "\n…(truncated in preview, download for the full output)" : out;
      return [{ name: `${file ? baseName(file.name) : "text"}.base64.txt`, blob: new Blob([out], { type: "text/plain" }), note: `${out.length.toLocaleString()} chars` }];
    }
    const src = u.input.value.trim() || (file ? await readAsText(file) : "");
    if (!src) throw new Error("Paste Base64 to decode");
    let bytes;
    try { bytes = base64ToBytes(src); } catch (_) { throw new Error("That is not valid Base64"); }
    if (u.decodeAs.value === "text") {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      u.output.value = text;
      return [{ name: "decoded.txt", blob: new Blob([text], { type: "text/plain" }), note: `${bytes.length.toLocaleString()} bytes` }];
    }
    const m = src.match(/^data:([^;,]+)/);
    const name = u.decodeName.value.trim() || "decoded.bin";
    const blob = new Blob([bytes], { type: m ? m[1] : "application/octet-stream" });
    u.output.value = t("{n} bytes decoded → {name}", { n: bytes.length.toLocaleString(), name });
    download(blob, name);
    return [{ name, blob, note: `${bytes.length.toLocaleString()} bytes` }];
  },
};

// ---------- table converter ----------

/** Rows (arrays of strings) from CSV/TSV, a Markdown table, an HTML table or a JSON array. Returns {rows, from}. */
export function parseTable(text) {
  const s = text.trim();
  if (!s) return { rows: [], from: "" };
  if (s.startsWith("[") || s.startsWith("{")) {
    try {
      let data = JSON.parse(s);
      if (!Array.isArray(data)) data = [data];
      if (!data.length) return { rows: [], from: "json" };
      if (Array.isArray(data[0])) return { rows: data.map((r) => r.map((c) => (c == null ? "" : typeof c === "object" ? JSON.stringify(c) : String(c)))), from: "json" };
      const keys = [];
      for (const r of data) for (const k of Object.keys(r || {})) if (!keys.includes(k)) keys.push(k);
      return { rows: [keys, ...data.map((r) => keys.map((k) => (r?.[k] == null ? "" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k]))))], from: "json" };
    } catch (_) { /* not JSON after all */ }
  }
  if (/<table[\s>]/i.test(s)) {
    const doc = new DOMParser().parseFromString(s, "text/html");
    const rows = [...doc.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th, td")].map((c) => c.textContent.trim()));
    return { rows: rows.filter((r) => r.length), from: "html" };
  }
  const lines = s.split(/\r?\n/);
  if (lines.every((l) => /^\s*\|/.test(l) || !l.trim())) {
    const rows = lines.filter((l) => l.trim() && !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|")));
    return { rows, from: "markdown" };
  }
  const delimiter = detectDelimiter(s);
  return { rows: parseCsv(s, delimiter), from: delimiter === "\t" ? "tsv" : "csv" };
}

const isNum = (v) => /^-?\d[\d\s]*([.,]\d+)?%?$/.test(String(v).trim()) && String(v).trim() !== "";
export function toMarkdownTable(rows, header = true) {
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = rows.map((r) => Array.from({ length: cols }, (_, i) => String(r[i] ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")));
  const body = header ? grid.slice(1) : grid;
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...grid.map((r) => [...r[i]].length)));
  const numeric = Array.from({ length: cols }, (_, i) => body.length > 0 && body.every((r) => !r[i] || isNum(r[i])));
  const line = (r) => `| ${r.map((c, i) => (numeric[i] ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join(" | ")} |`;
  const head = header ? grid[0] : Array.from({ length: cols }, (_, i) => `col${i + 1}`);
  return [line(head), `| ${widths.map((w, i) => (numeric[i] ? "-".repeat(w - 1) + ":" : "-".repeat(w))).join(" | ")} |`, ...body.map(line)].join("\n") + "\n";
}
const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function toHtmlTable(rows, header = true) {
  if (!rows.length) return "";
  const cell = (tag, c) => `<${tag}>${escHtml(c)}</${tag}>`;
  const body = header ? rows.slice(1) : rows;
  return `<table>\n${header ? `  <thead>\n    <tr>${rows[0].map((c) => cell("th", c)).join("")}</tr>\n  </thead>\n` : ""}  <tbody>\n${body.map((r) => `    <tr>${r.map((c) => cell("td", c)).join("")}</tr>`).join("\n")}\n  </tbody>\n</table>\n`;
}

const FORMATS = { markdown: ["Markdown table", "md"], csv: ["CSV", "csv"], tsv: ["TSV (tab-separated)", "tsv"], html: ["HTML table", "html"], json: ["JSON (array of objects)", "json"], jsonrows: ["JSON (array of rows)", "json"], sql: ["SQL INSERT statements", "sql"] };
export function convertTable(rows, to, header, tableName = "data") {
  if (to === "markdown") return toMarkdownTable(rows, header);
  if (to === "html") return toHtmlTable(rows, header);
  if (to === "csv") return toCsv(rows, ",");
  if (to === "tsv") return toCsv(rows, "\t");
  if (to === "jsonrows") return JSON.stringify(rows, null, 2) + "\n";
  const keys = header ? rows[0] : rows[0]?.map((_, i) => `col${i + 1}`) || [];
  const body = header ? rows.slice(1) : rows;
  if (to === "json") return JSON.stringify(body.map((r) => Object.fromEntries(keys.map((k, i) => [k, coerce(r[i] ?? "")]))), null, 2) + "\n";
  const q = (v) => (v === "" ? "NULL" : typeof coerce(v) === "number" ? String(coerce(v)) : `'${String(v).replace(/'/g, "''")}'`);
  const id = (k) => `"${String(k).replace(/"/g, '""')}"`;
  return body.map((r) => `INSERT INTO ${id(tableName)} (${keys.map(id).join(", ")}) VALUES (${keys.map((_, i) => q(r[i] ?? "")).join(", ")});`).join("\n") + "\n";
}

const tableTool = {
  id: "table",
  title: "Table converter",
  description: "Paste a table in any form — CSV, TSV, Markdown, HTML or JSON — and get it back as a Markdown table, CSV, HTML, JSON or SQL INSERTs. Handy for READMEs, issues and docs.",
  keywords: ["markdown table", "csv", "tsv", "html table", "sql", "insert", "convert", "excel", "paste"],
  accept: ".csv,.tsv,.txt,.md,.json,.html,text/*,application/json",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop a CSV, TSV, Markdown, HTML or JSON file",
  runLabel: "Save",
  renderOptions(root, files) {
    const { input, output } = textLayout(root, { inputLabel: "Input (CSV, TSV, Markdown, HTML or JSON)", outputLabel: "Output", placeholder: "name,qty,price\nMug,2,12.5\nT-shirt,1,24" });
    const to = select(Object.entries(FORMATS).map(([k, [label]]) => [k, label]), "markdown");
    const header = checkbox("First row is the header", true);
    const tableName = el("input", { type: "text", value: "data", placeholder: "Table name (SQL)" });
    const status = el("div", { class: "stat" });
    root.prepend(el("div", { class: "row" }, [field("Convert to", to), header.label, field("Table name (SQL)", tableName)]), status);
    const update = () => {
      try {
        const { rows, from } = parseTable(input.value);
        if (!rows.length) { output.value = ""; status.textContent = ""; return; }
        output.value = convertTable(rows, to.value, header.input.checked, tableName.value.trim() || "data");
        status.textContent = t("Read as {from}: {rows} × {cols}", { from: from.toUpperCase(), rows: plural(rows.length, "row"), cols: Math.max(...rows.map((r) => r.length)) });
      } catch (err) { output.value = ""; status.textContent = err.message; }
    };
    input.addEventListener("input", update); to.addEventListener("change", update); header.input.addEventListener("change", update); tableName.addEventListener("input", update);
    this.ui = { input, output, to, files };
    fillFromFile(files, input, update);
    update();
  },
  async run() {
    const { output, to, files } = this.ui;
    if (!output.value) throw new Error("Paste a table first");
    const [, ext] = FORMATS[to.value];
    return [{ name: `${files[0] ? baseName(files[0].name) : "table"}.${ext}`, blob: new Blob([output.value], { type: "text/plain" }), note: plural(output.value.split("\n").filter(Boolean).length, "row") }];
  },
};

export const dataTools = [csvJsonTool, tableTool, jsonFormatTool, base64Tool];
