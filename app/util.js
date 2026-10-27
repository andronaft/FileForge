// Shared helpers for FileForge tools.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(2) : n < 100 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function baseName(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function zipFiles(files) {
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.name;
    let i = 1;
    while (used.has(name)) name = `${baseName(f.name)} (${i++})${f.name.slice(baseName(f.name).length)}`;
    used.add(name);
    zip.file(name, f.blob);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

let toastTimer;
export function toast(message, kind = "info") {
  const box = document.getElementById("toast");
  box.textContent = message;
  box.className = `toast toast-${kind}`;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, kind === "error" ? 6000 : 3000);
}

export function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** Parse "1-3, 5, 8-10" into sorted unique 0-based indices within [0, total). */
export function parseRanges(text, total) {
  const out = new Set();
  const parts = String(text).split(/[,\s]+/).filter(Boolean);
  if (!parts.length) throw new Error("Enter at least one page or range, e.g. 1-3, 5");
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Cannot understand "${part}". Use numbers and ranges like 1-3, 5`);
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > total) throw new Error(`Page ${a > total ? a : b} is out of range (document has ${total} page${total === 1 ? "" : "s"})`);
    for (let p = a; p <= b; p++) out.add(p - 1);
  }
  return [...out].sort((x, y) => x - y);
}

export function field(labelText, input, hint) {
  return el("label", { class: "field" }, [
    el("span", { class: "field-label", text: labelText }),
    input,
    hint ? el("span", { class: "field-hint", text: hint }) : null,
  ]);
}

export function select(options, value, attrs = {}) {
  const s = el("select", attrs);
  for (const [v, label] of options) s.append(el("option", { value: v, text: label, selected: v === value }));
  return s;
}

export function number(value, attrs = {}) {
  return el("input", { type: "number", value, ...attrs });
}

export function checkbox(labelText, checked = false, attrs = {}) {
  const input = el("input", { type: "checkbox", checked, ...attrs });
  return { input, label: el("label", { class: "check" }, [input, el("span", { text: labelText })]) };
}
