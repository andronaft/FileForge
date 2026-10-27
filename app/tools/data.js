import { el, baseName, field, select, number, checkbox, download, readAsText } from "../util.js";

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
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

// ---------- shared text-tool layout ----------

function textLayout(root, { inputLabel, outputLabel, placeholder }) {
  const input = el("textarea", { placeholder, spellcheck: "false" });
  const output = el("textarea", { readonly: true, spellcheck: "false", placeholder: "Result appears here" });
  root.append(el("div", { class: "md-grid" }, [field(inputLabel, input), field(outputLabel, output)]));
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
      try { data = JSON.parse(text); } catch (err) { throw new Error(`Invalid JSON: ${err.message}`); }
      const csv = toCsv(data, delimiter);
      u.output.value = csv;
      return [{ name: `${base}.csv`, blob: new Blob([csv], { type: "text/csv" }), note: `${csv.split("\n").length - 1} rows` }];
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
    return [{ name: `${base}.json`, blob: new Blob([json], { type: "application/json" }), note: `${data.length} records` }];
  },
};

// ---------- JSON format / validate ----------

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
      const m = err.message.match(/position (\d+)/);
      if (m) {
        const pos = Number(m[1]);
        const before = text.slice(0, pos);
        const line = before.split("\n").length, col = pos - before.lastIndexOf("\n");
        u.status.textContent = `✖ Invalid JSON at line ${line}, column ${col}: ${err.message}`;
        u.input.focus(); u.input.setSelectionRange(pos, pos + 1);
      } else {
        u.status.textContent = `✖ Invalid JSON: ${err.message}`;
      }
      throw new Error(u.status.textContent);
    }
    const sorter = (v) => Array.isArray(v) ? v.map(sorter) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorter(v[k])])) : v;
    if (u.sortKeys.input.checked) data = sorter(data);
    const indent = u.mode.value === "tab" ? "\t" : Number(u.mode.value);
    const out = JSON.stringify(data, null, indent) + (indent ? "\n" : "");
    u.output.value = out;
    u.status.textContent = `✔ Valid JSON · ${out.length.toLocaleString()} characters`;
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
    const info = el("div", { class: "stat", text: files[0] ? `Encoding file: ${files[0].name}` : "" });
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
    u.output.value = `${bytes.length.toLocaleString()} bytes decoded → ${name}`;
    download(blob, name);
    return [{ name, blob, note: `${bytes.length.toLocaleString()} bytes` }];
  },
};

export const dataTools = [csvJsonTool, jsonFormatTool, base64Tool];
