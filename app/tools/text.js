// Text and developer tools: diff, checksums, word count & case, JWT, URL, regex.
import { el, baseName, field, select, checkbox, readAsText, formatBytes, plural, toast, t } from "../util.js";
import { copyButton } from "./data.js";

const mono = (attrs = {}) => el("textarea", { spellcheck: "false", ...attrs });
const stat = (text = "", cls = "") => el("div", { class: `stat ${cls}`.trim(), text });
const debounce = (fn, ms = 150) => { let timer; return () => { clearTimeout(timer); timer = setTimeout(fn, ms); }; };

// ---------- diff ----------

/** Line diff (Myers' O(ND) algorithm). Returns [{type: "ctx"|"add"|"del", a, b, text}]. */
export function diffLines(a, b) {
  const n = a.length, m = b.length, max = n + m;
  const v = new Map([[1, 0]]);
  const trace = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= n && y >= m) break outer;
    }
  }
  // Walk the trace back to produce the edit script.
  const ops = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && (vd.get(k - 1) ?? -1) < (vd.get(k + 1) ?? -1))) ? k + 1 : k - 1;
    const prevX = vd.get(prevK) ?? 0, prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ type: "ctx", a: x - 1, b: y - 1, text: a[x - 1] }); x--; y--; }
    if (d > 0) {
      if (x === prevX) { ops.push({ type: "add", b: y - 1, text: b[y - 1] }); y--; }
      else { ops.push({ type: "del", a: x - 1, text: a[x - 1] }); x--; }
    }
  }
  return ops.reverse();
}

function unified(ops, nameA, nameB) {
  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "ctx") { i++; continue; }
    const start = Math.max(0, i - 3);
    let end = i;
    while (end < ops.length && (ops[end].type !== "ctx" || ops.slice(end, end + 7).some((o) => o.type !== "ctx"))) end++;
    end = Math.min(ops.length, end + 3);
    const chunk = ops.slice(start, end);
    const aStart = (chunk.find((o) => o.a != null)?.a ?? 0) + 1, bStart = (chunk.find((o) => o.b != null)?.b ?? 0) + 1;
    const aLen = chunk.filter((o) => o.type !== "add").length, bLen = chunk.filter((o) => o.type !== "del").length;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of chunk) out.push((o.type === "add" ? "+" : o.type === "del" ? "-" : " ") + o.text);
    i = end;
  }
  return out.join("\n") + "\n";
}

const diffTool = {
  id: "diff",
  title: "Text diff",
  description: "Compare two texts or files line by line: added and removed lines are highlighted, and the result can be saved as a unified .diff.",
  keywords: ["compare", "patch", "difference"],
  accept: ".txt,.md,.json,.csv,.html,.js,.css,.xml,.yaml,.yml,text/*,application/json",
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop two text files (first = original, second = changed)",
  runLabel: "Save .diff",
  renderOptions(root, files) {
    const a = mono({ placeholder: "Original text" }), b = mono({ placeholder: "Changed text" });
    const ignoreWs = checkbox("Ignore whitespace", false), ignoreCase = checkbox("Ignore case", false), onlyChanges = checkbox("Only changed lines with context", true);
    const summary = stat("Paste two texts to compare them");
    const out = el("div", { class: "diff", hidden: true });
    root.append(
      el("div", { class: "row" }, [ignoreWs.label, ignoreCase.label, onlyChanges.label]),
      el("div", { class: "md-grid" }, [field("Original", a), field("Changed", b)]),
      summary, out,
    );
    const norm = (s) => { let x = s; if (ignoreWs.input.checked) x = x.replace(/\s+/g, " ").trim(); if (ignoreCase.input.checked) x = x.toLowerCase(); return x; };
    const update = () => {
      if (!a.value && !b.value) { out.hidden = true; summary.textContent = t("Paste two texts to compare them"); this.ops = null; return; }
      const la = a.value.split("\n"), lb = b.value.split("\n");
      if (la.length + lb.length > 20000) { summary.textContent = t("Too long to compare live; keep each text under 10,000 lines"); return; }
      const ops = diffLines(la.map(norm), lb.map(norm)).map((o) => ({ ...o, text: o.type === "add" ? lb[o.b] : la[o.a] }));
      this.ops = ops;
      const add = ops.filter((o) => o.type === "add").length, del = ops.filter((o) => o.type === "del").length;
      summary.textContent = add || del ? `+${add} −${del} · ${t("{n} lines compared", { n: Math.max(la.length, lb.length) })}` : t("The texts are identical");
      summary.className = `stat ${add || del ? "" : "ok"}`;
      out.hidden = false;
      const shown = onlyChanges.input.checked ? ops.filter((o, i) => o.type !== "ctx" || ops.slice(Math.max(0, i - 3), i + 4).some((x) => x.type !== "ctx")) : ops;
      out.replaceChildren(...shown.slice(0, 3000).map((o) => el("span", { class: `l ${o.type}` }, [el("span", { class: "n", text: String((o.type === "add" ? o.b : o.a) + 1) }), (o.type === "add" ? "+ " : o.type === "del" ? "− " : "  ") + o.text])));
      if (shown.length > 3000) out.append(el("span", { class: "l ctx", text: t("… {n} more lines", { n: shown.length - 3000 }) }));
    };
    const go = debounce(update);
    for (const i of [a, b]) i.addEventListener("input", go);
    for (const c of [ignoreWs, ignoreCase, onlyChanges]) c.input.addEventListener("change", update);
    this.ui = { a, b, files };
    (async () => {
      if (files[0]) a.value = await readAsText(files[0]).catch(() => "");
      if (files[1]) b.value = await readAsText(files[1]).catch(() => "");
      update();
    })();
  },
  async run() {
    if (!this.ops) throw new Error("Paste two texts first");
    const { a, b, files } = this.ui;
    const nameA = files[0]?.name || "original.txt", nameB = files[1]?.name || "changed.txt";
    const text = unified(this.ops, nameA, nameB);
    void a; void b;
    return [{ name: `${baseName(nameA)}.diff`, blob: new Blob([text], { type: "text/plain" }), note: plural(this.ops.filter((o) => o.type !== "ctx").length, "change") }];
  },
};

// ---------- checksums ----------

const CRC_TABLE = (() => { const tbl = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c >>> 0; } return tbl; })();
function crc32Update(crc, bytes) { for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8); return crc >>> 0; }

/** Streaming MD5 (RFC 1321), small enough to bundle; WebCrypto has no MD5. */
function md5() {
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  let rest = new Uint8Array(0), length = 0;
  const block = (M, off) => {
    const w = new Uint32Array(16);
    for (let i = 0; i < 16; i++) w[i] = M[off + i * 4] | (M[off + i * 4 + 1] << 8) | (M[off + i * 4 + 2] << 16) | (M[off + i * 4 + 3] << 24);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + w[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  };
  return {
    update(bytes) {
      length += bytes.length;
      const buf = new Uint8Array(rest.length + bytes.length); buf.set(rest); buf.set(bytes, rest.length);
      let off = 0;
      for (; off + 64 <= buf.length; off += 64) block(buf, off);
      rest = buf.subarray(off);
    },
    digest() {
      const pad = new Uint8Array(((rest.length + 8) >> 6 << 6) + 64);
      pad.set(rest); pad[rest.length] = 0x80;
      const bits = length * 8;
      new DataView(pad.buffer).setUint32(pad.length - 8, bits >>> 0, true);
      new DataView(pad.buffer).setUint32(pad.length - 4, Math.floor(bits / 2 ** 32), true);
      for (let off = 0; off < pad.length; off += 64) block(pad, off);
      return [a0, b0, c0, d0].map((x) => [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff].map((b) => b.toString(16).padStart(2, "0")).join("")).join("");
    },
  };
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const ALGOS = [["sha256", "SHA-256"], ["sha1", "SHA-1"], ["md5", "MD5"], ["sha512", "SHA-512"], ["crc32", "CRC32"]];

async function hashBlob(blob, algos, progress) {
  const out = {};
  const subtle = algos.filter((a) => a.startsWith("sha"));
  if (subtle.length) {
    const buf = await blob.arrayBuffer();
    for (const a of subtle) out[a] = hex(await crypto.subtle.digest(a.replace("sha", "SHA-"), buf));
  }
  if (algos.includes("md5") || algos.includes("crc32")) {
    const m = algos.includes("md5") ? md5() : null;
    let crc = 0xffffffff;
    const CHUNK = 4 * 1024 * 1024;
    for (let off = 0; off < blob.size || off === 0; off += CHUNK) {
      const bytes = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
      m?.update(bytes);
      if (algos.includes("crc32")) crc = crc32Update(crc, bytes);
      if (blob.size === 0) break;
      if (progress?.signal.aborted) throw new Error("Cancelled");
    }
    if (m) out.md5 = m.digest();
    if (algos.includes("crc32")) out.crc32 = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

const hashTool = {
  id: "hash",
  title: "Checksums & hashes",
  description: "SHA-256, SHA-1, SHA-512, MD5 and CRC32 of files or text, with a field to check a download against the published checksum.",
  keywords: ["sha256", "md5", "checksum", "verify", "integrity", "digest"],
  accept: "*/*",
  filesOptional: true,
  noAutoDownload: true,
  hint: "Drop any files, or type text below",
  runLabel: "Compute",
  renderOptions(root, files) {
    const boxes = ALGOS.map(([v, label]) => checkbox(label, v === "sha256" || v === "md5"));
    const text = mono({ placeholder: "Text to hash (used when no file is dropped)", "data-noremember": "" });
    const expected = el("input", { type: "text", placeholder: "Paste the expected checksum to compare", "data-noremember": "" });
    const table = el("table", { class: "meta" });
    const status = stat("");
    root.append(
      el("div", { class: "row" }, [el("span", { class: "field-label", text: "Algorithms" }), ...boxes.map((b) => b.label)]),
      files.length ? stat(`${plural(files.length, "file")}, ${formatBytes(files.reduce((s, f) => s + f.size, 0))}`) : field("Text", text),
      field("Verify against", expected, "The matching row turns green"),
      status, table,
    );
    this.ui = { boxes, text, expected, table, status, files };
    expected.addEventListener("input", () => this.mark());
  },
  mark() {
    const want = this.ui.expected.value.trim().toLowerCase();
    let hit = false;
    for (const td of this.ui.table.querySelectorAll("td[data-hash]")) { const ok = want && td.dataset.hash === want; td.classList.toggle("stat", false); td.style.color = ok ? "var(--ok)" : ""; td.style.fontWeight = ok ? "600" : ""; hit ||= ok; }
    this.ui.status.textContent = want ? (hit ? t("✔ Matches") : t("✖ No hash matches the expected value")) : "";
    this.ui.status.className = `stat ${want ? (hit ? "ok" : "bad") : ""}`;
  },
  async run(files, _root, progress) {
    const u = this.ui;
    const algos = ALGOS.filter((_, i) => u.boxes[i].input.checked).map(([v]) => v);
    if (!algos.length) throw new Error("Pick at least one algorithm");
    const inputs = files.length ? files : [new File([u.text.value], "text", { type: "text/plain" })];
    if (!files.length && !u.text.value) throw new Error("Drop a file or type some text");
    const rows = [], lines = [];
    u.table.replaceChildren();
    for (const f of inputs) {
      await progress?.tick(f.name);
      const h = await hashBlob(f, algos, progress);
      for (const a of algos) {
        rows.push(el("tr", {}, [el("th", { text: `${f.name} · ${ALGOS.find(([v]) => v === a)[1]}` }), el("td", { text: h[a], "data-hash": h[a], style: "font-family: ui-monospace, Menlo, monospace" })]));
        lines.push(`${h[a]}  ${f.name}`);
      }
    }
    u.table.replaceChildren(...rows);
    this.mark();
    return [{ name: files.length === 1 ? `${files[0].name}.${algos[0]}.txt` : "checksums.txt", blob: new Blob([lines.join("\n") + "\n"], { type: "text/plain" }), note: plural(lines.length, "hash", "hashes") }];
  },
};

// ---------- word count & case ----------

const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);
const CASES = {
  none: (s) => s,
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.toLowerCase().replace(/(^|[\s(\["'])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()),
  sentence: (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, p, c) => p + c.toUpperCase()),
  camel: (s) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(""),
  pascal: (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(""),
  snake: (s) => words(s).map((w) => w.toLowerCase()).join("_"),
  kebab: (s) => words(s).map((w) => w.toLowerCase()).join("-"),
  constant: (s) => words(s).map((w) => w.toUpperCase()).join("_"),
  invert: (s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(""),
};

const textCaseTool = {
  id: "text-case",
  title: "Word count & case",
  description: "Live character, word, sentence and reading-time counts, plus case conversion (UPPER, Title, camelCase, snake_case…) and line clean-up: trim, dedupe, sort.",
  keywords: ["count", "characters", "uppercase", "lowercase", "camelcase", "snake", "sort lines", "dedupe", "reading time"],
  accept: ".txt,.md,.csv,text/*",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop a text file",
  runLabel: "Save as .txt",
  renderOptions(root, files) {
    const input = mono({ placeholder: "Paste text here…", "data-noremember": "" });
    const output = mono({ readonly: true, placeholder: "Result appears here" });
    const mode = select([["none", "Keep as is"], ["upper", "UPPERCASE"], ["lower", "lowercase"], ["title", "Title Case"], ["sentence", "Sentence case"], ["camel", "camelCase"], ["pascal", "PascalCase"], ["snake", "snake_case"], ["kebab", "kebab-case"], ["constant", "CONSTANT_CASE"], ["invert", "iNVERT cASE"]], "none");
    const trim = checkbox("Trim lines", false), empty = checkbox("Remove empty lines", false), dedupe = checkbox("Remove duplicate lines", false), sort = checkbox("Sort lines A→Z", false), rev = checkbox("Reverse lines", false), squeeze = checkbox("Collapse repeated spaces", false);
    const stats = el("div", { class: "stats" });
    const outField = field("Output", output);
    outField.append(copyButton(() => output.value, "Copy output"));
    root.append(
      el("div", { class: "row" }, [field("Case", mode), trim.label, empty.label, dedupe.label, sort.label, rev.label, squeeze.label]),
      stats,
      el("div", { class: "md-grid" }, [field("Input", input), outField]),
    );
    const update = () => {
      const s = input.value;
      const w = words(s).length, chars = [...s].length, noSpace = [...s.replace(/\s/g, "")].length;
      const sentences = (s.match(/[^.!?…]+[.!?…]+(\s|$)/g) || []).length || (s.trim() ? 1 : 0);
      const lines = s ? s.split("\n").length : 0, paragraphs = s.split(/\n\s*\n/).filter((p) => p.trim()).length;
      const bytes = new TextEncoder().encode(s).length;
      const mins = w / 200;
      const cells = [[chars, "characters"], [noSpace, "without spaces"], [w, "words"], [sentences, "sentences"], [lines, "lines"], [paragraphs, "paragraphs"], [formatBytes(bytes), "UTF-8"], [mins < 1 ? `${Math.max(1, Math.round(mins * 60))} s` : `${Math.round(mins)} min`, "reading time"]];
      stats.replaceChildren(...cells.map(([v, l]) => el("div", {}, [el("b", { text: typeof v === "number" ? v.toLocaleString() : v }), el("span", { text: l })])));
      let out = s;
      if (squeeze.input.checked) out = out.replace(/[ \t]{2,}/g, " ");
      let ls = out.split("\n");
      if (trim.input.checked) ls = ls.map((l) => l.trim());
      if (empty.input.checked) ls = ls.filter((l) => l.trim());
      if (dedupe.input.checked) ls = [...new Set(ls)];
      if (sort.input.checked) ls.sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare);
      if (rev.input.checked) ls.reverse();
      out = ls.join("\n");
      if (mode.value !== "none") out = mode.value === "camel" || mode.value === "pascal" || mode.value === "snake" || mode.value === "kebab" || mode.value === "constant" ? ls.map(CASES[mode.value]).join("\n") : CASES[mode.value](out);
      output.value = out;
    };
    input.addEventListener("input", debounce(update, 100));
    for (const c of [mode, trim.input, empty.input, dedupe.input, sort.input, rev.input, squeeze.input]) c.addEventListener("change", update);
    this.ui = { input, output, files };
    if (files[0]) readAsText(files[0]).then((x) => { input.value = x; update(); }).catch(() => update()); else update();
  },
  async run() {
    const { output, files } = this.ui;
    if (!output.value) throw new Error("Paste some text first");
    return [{ name: `${files[0] ? baseName(files[0].name) : "text"}-out.txt`, blob: new Blob([output.value], { type: "text/plain" }), note: plural(words(output.value).length, "word") }];
  },
};

// ---------- JWT ----------

function b64urlDecode(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(pad);
  return new Uint8Array([...bin].map((c) => c.charCodeAt(0)));
}
const jsonPart = (s) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
const when = (sec) => { const d = new Date(sec * 1000); return isNaN(d) ? String(sec) : `${d.toISOString().replace("T", " ").slice(0, 19)} UTC (${d.toLocaleString()})`; };

const jwtTool = {
  id: "jwt",
  title: "JWT decoder",
  description: "Decode a JSON Web Token: header, payload, readable issued/expiry dates and whether it has expired. Optionally verify an HS256/384/512 signature with its secret, all locally.",
  keywords: ["token", "jwt", "oauth", "bearer", "claims", "expired"],
  accept: ".txt,.jwt,text/plain",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop a file containing the token",
  runLabel: "Save payload as JSON",
  renderOptions(root, files) {
    const input = mono({ placeholder: "eyJhbGciOi…", "data-noremember": "" });
    const secret = el("input", { type: "text", placeholder: "Secret for HS256/384/512 (optional)", "data-noremember": "", autocomplete: "off" });
    const status = stat("");
    const claims = el("table", { class: "meta" });
    const header = mono({ readonly: true, placeholder: "Header" }), payload = mono({ readonly: true, placeholder: "Payload" });
    const pf = field("Payload", payload); pf.append(copyButton(() => payload.value, "Copy payload"));
    root.append(field("Token", input), el("div", { class: "row" }, [field("Verify signature", secret, "The secret stays on this device")]), status, claims, el("div", { class: "md-grid" }, [field("Header", header), pf]));
    const update = async () => {
      const raw = input.value.trim().replace(/^Bearer\s+/i, "");
      claims.replaceChildren(); header.value = payload.value = ""; this.payload = null;
      if (!raw) { status.textContent = ""; return; }
      const parts = raw.split(".");
      if (parts.length !== 3) { status.textContent = t("A JWT has three dot-separated parts"); status.className = "stat bad"; return; }
      let h, p;
      try { h = jsonPart(parts[0]); p = jsonPart(parts[1]); } catch (_) { status.textContent = t("Could not decode: not valid Base64url JSON"); status.className = "stat bad"; return; }
      header.value = JSON.stringify(h, null, 2); payload.value = JSON.stringify(p, null, 2); this.payload = p;
      const now = Date.now() / 1000;
      const rows = [];
      if (h.alg) rows.push(["Algorithm", `${h.alg}${h.typ ? ` · ${h.typ}` : ""}`]);
      if (p.iss) rows.push(["Issuer (iss)", String(p.iss)]);
      if (p.sub) rows.push(["Subject (sub)", String(p.sub)]);
      if (p.aud) rows.push(["Audience (aud)", [].concat(p.aud).join(", ")]);
      if (p.iat) rows.push(["Issued (iat)", when(p.iat)]);
      if (p.nbf) rows.push(["Not before (nbf)", when(p.nbf) + (p.nbf > now ? ` · ${t("not yet valid")}` : "")]);
      if (p.exp) rows.push(["Expires (exp)", when(p.exp) + (p.exp < now ? ` · ${t("EXPIRED")}` : ` · ${t("valid for {time}", { time: fmtDur(p.exp - now) })}`)]);
      claims.replaceChildren(...rows.map(([k, v]) => el("tr", {}, [el("th", { text: k }), el("td", { text: v })])));
      let verdict = p.exp && p.exp < now ? t("Token has expired") : t("Decoded (signature not verified)");
      let cls = p.exp && p.exp < now ? "bad" : "";
      if (secret.value && /^HS(256|384|512)$/.test(h.alg || "")) {
        try {
          const bits = h.alg.slice(2);
          const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret.value), { name: "HMAC", hash: `SHA-${bits}` }, false, ["verify"]);
          const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
          verdict = ok ? t("✔ Signature valid for this secret") + (p.exp && p.exp < now ? ` · ${t("but the token has expired")}` : "") : t("✖ Signature does not match this secret");
          cls = ok ? (p.exp && p.exp < now ? "bad" : "ok") : "bad";
        } catch (_) { /* leave the decoded verdict */ }
      }
      status.textContent = verdict; status.className = `stat ${cls}`;
    };
    input.addEventListener("input", debounce(update, 120));
    secret.addEventListener("input", debounce(update, 200));
    this.ui = { input };
    if (files[0]) readAsText(files[0]).then((x) => { input.value = x.trim(); update(); }).catch(() => {});
  },
  async run() {
    if (!this.payload) throw new Error("Paste a token first");
    return [{ name: "jwt-payload.json", blob: new Blob([JSON.stringify(this.payload, null, 2) + "\n"], { type: "application/json" }) }];
  },
};
function fmtDur(s) { if (s < 90) return `${Math.round(s)} s`; if (s < 5400) return `${Math.round(s / 60)} min`; if (s < 172800) return `${Math.round(s / 3600)} h`; return `${Math.round(s / 86400)} d`; }

// ---------- URL ----------

const urlTool = {
  id: "url",
  title: "URL encode, decode & parse",
  description: "Percent-encode or decode text, or paste a URL to see its host, path and every query parameter decoded in a table.",
  keywords: ["percent", "query string", "parameters", "uri", "encodeURIComponent"],
  accept: ".txt,text/plain",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "",
  runLabel: "Save output",
  renderOptions(root) {
    const input = mono({ placeholder: "https://example.com/path?q=hello%20world&lang=uk  or any text to encode", "data-noremember": "" });
    const mode = select([["parse", "Parse URL"], ["encode", "Encode (component)"], ["encodeFull", "Encode (keep / ? & =)"], ["decode", "Decode"]], "parse");
    const output = mono({ readonly: true, placeholder: "Result appears here" });
    const of = field("Output", output); of.append(copyButton(() => output.value, "Copy output"));
    const table = el("table", { class: "meta" });
    const status = stat("");
    root.append(el("div", { class: "row" }, [field("Mode", mode)]), field("Input", input), status, table, of);
    const update = () => {
      const s = input.value; table.replaceChildren(); status.textContent = ""; status.className = "stat";
      if (mode.value === "encode") output.value = encodeURIComponent(s);
      else if (mode.value === "encodeFull") output.value = encodeURI(s);
      else if (mode.value === "decode") { try { output.value = decodeURIComponent(s.replace(/\+/g, " ")); } catch (_) { output.value = ""; status.textContent = t("Not a valid percent-encoded string"); status.className = "stat bad"; } }
      else {
        if (!s.trim()) { output.value = ""; return; }
        let u;
        try { u = new URL(s.trim()); } catch (_) { try { u = new URL("https://" + s.trim()); } catch (__) { status.textContent = t("Not a URL"); status.className = "stat bad"; output.value = ""; return; } }
        const rows = [["Protocol", u.protocol], ["Host", u.hostname], ["Port", u.port || t("(default)")], ["Path", decodeURIComponent(u.pathname)], ["Hash", u.hash ? decodeURIComponent(u.hash) : ""], ...(u.username ? [["User", u.username]] : [])];
        const params = [...u.searchParams.entries()];
        for (const [k, v] of params) rows.push([`? ${k}`, v]);
        table.replaceChildren(...rows.filter(([, v]) => v).map(([k, v]) => el("tr", {}, [el("th", { text: k }), el("td", { text: v })])));
        output.value = JSON.stringify({ protocol: u.protocol, host: u.hostname, port: u.port, path: u.pathname, hash: u.hash, query: Object.fromEntries(params) }, null, 2);
        status.textContent = plural(params.length, "query parameter");
      }
    };
    input.addEventListener("input", debounce(update, 100)); mode.addEventListener("change", update);
    this.ui = { output };
    update();
  },
  async run() {
    if (!this.ui.output.value) throw new Error("Type something first");
    return [{ name: "url.txt", blob: new Blob([this.ui.output.value], { type: "text/plain" }) }];
  },
};

// ---------- regex ----------

const regexTool = {
  id: "regex",
  title: "Regex tester",
  description: "Try a JavaScript regular expression against text: matches are highlighted live, groups are listed, and a replacement can be previewed.",
  keywords: ["regular expression", "pattern", "match", "replace", "groups"],
  accept: ".txt,.md,.csv,.json,.log,text/*",
  multiple: false,
  filesOptional: true,
  noAutoDownload: true,
  hint: "Optional: drop a text file to search in",
  runLabel: "Save matches",
  renderOptions(root, files) {
    const pattern = el("input", { type: "text", placeholder: "\\b\\d{3}-\\d{4}\\b", "data-remember": "", spellcheck: "false", style: "font-family: ui-monospace, Menlo, monospace; width: 100%" });
    const flags = ["g", "i", "m", "s", "u"].map((f) => checkbox(f, f === "g"));
    const text = mono({ placeholder: "Text to test against", "data-noremember": "" });
    const replacement = el("input", { type: "text", placeholder: "Replacement, e.g. ($1)", "data-noremember": "", spellcheck: "false" });
    const status = stat("");
    const out = el("div", { class: "regex-out", hidden: true });
    const groups = el("table", { class: "meta" });
    const replaced = mono({ readonly: true, placeholder: "Replacement result" });
    const rf = field("Replaced text", replaced); rf.append(copyButton(() => replaced.value, "Copy result")); rf.hidden = true;
    root.append(
      el("div", { class: "row" }, [el("div", { class: "field", style: "flex: 1 1 320px" }, [el("span", { class: "field-label", text: "Pattern", "data-key": "Pattern" }), pattern]), el("span", { class: "field-label", text: "Flags" }), ...flags.map((f) => f.label)]),
      field("Test text", text), status, out, groups, el("div", { class: "row" }, [field("Replace with", replacement)]), rf,
    );
    const update = () => {
      this.matches = [];
      const src = pattern.value, fl = flags.filter((f) => f.input.checked).map((f) => f.label.textContent).join("");
      if (!src) { status.textContent = ""; out.hidden = true; groups.replaceChildren(); rf.hidden = true; return; }
      let re;
      try { re = new RegExp(src, fl); } catch (err) { status.textContent = `✖ ${err.message}`; status.className = "stat bad"; out.hidden = true; return; }
      const s = text.value;
      const matches = [];
      if (re.global) { for (const m of s.matchAll(re)) { matches.push(m); if (matches.length > 5000) break; } }
      else { const m = s.match(re); if (m) matches.push(m); }
      this.matches = matches;
      status.textContent = matches.length ? plural(matches.length, "match", "matches") : t("No match");
      status.className = `stat ${matches.length ? "ok" : ""}`;
      // highlighted text
      const frag = [];
      let pos = 0;
      for (const m of matches) {
        const i = m.index ?? 0;
        if (i < pos) continue;
        frag.push(s.slice(pos, i), el("mark", { text: m[0] || "∅" }));
        pos = i + (m[0]?.length || 0);
        if (frag.length > 10000) break;
      }
      frag.push(s.slice(pos));
      out.replaceChildren(...frag); out.hidden = !s;
      const named = Object.keys(matches[0]?.groups || {});
      groups.replaceChildren(...matches.slice(0, 200).map((m, k) => el("tr", {}, [
        el("th", { text: `#${k + 1} @${m.index}` }),
        el("td", { text: [m[0], ...m.slice(1).map((g, i) => `${named[i] ? named[i] : `$${i + 1}`}=${g ?? "∅"}`)].join("   ") }),
      ])));
      rf.hidden = !replacement.value && !re.global;
      try { replaced.value = replacement.value || re.global ? s.replace(re, replacement.value) : ""; } catch (_) { replaced.value = ""; }
    };
    const go = debounce(update, 120);
    for (const i of [pattern, text, replacement]) i.addEventListener("input", go);
    for (const f of flags) f.input.addEventListener("change", update);
    this.ui = { text };
    if (files[0]) readAsText(files[0]).then((x) => { text.value = x; update(); }).catch(() => {}); else update();
  },
  async run() {
    if (!this.matches?.length) throw new Error("No matches to save");
    const rows = this.matches.map((m) => ({ index: m.index, match: m[0], groups: m.slice(1), named: m.groups || undefined }));
    return [{ name: "matches.json", blob: new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }), note: plural(rows.length, "match", "matches") }];
  },
};

export const textTools = [diffTool, hashTool, textCaseTool, jwtTool, urlTool, regexTool];
