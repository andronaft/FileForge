// Tools that work on any file: batch rename, create and extract ZIP archives.
import { el, baseName, field, select, number, checkbox, formatBytes, plural, guessType, t } from "../util.js";

const CYR = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", ы: "y", э: "e", ё: "e", ъ: "" };
/** Latin letters, digits, dots, dashes and underscores only: transliterates Cyrillic, strips accents, turns spaces into dashes. */
export function slugify(s) {
  return [...s].map((ch) => { const lower = ch.toLowerCase(); return lower in CYR ? (ch === lower ? CYR[lower] : CYR[lower].replace(/^./, (x) => x.toUpperCase())) : ch; }).join("")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

const pad2 = (n) => String(n).padStart(2, "0");
function stamp(file) {
  const d = new Date(file.lastModified || Date.now());
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, time: `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}` };
}

export function renameOne(file, index, o) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1) : "";
  let name = baseName(file.name);
  if (o.find) {
    try { name = name.replace(new RegExp(o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), o.replace); }
    catch (err) { throw new Error(t("Bad pattern: {msg}", { msg: err.message })); }
  }
  const n = String(o.start + index * o.step).padStart(o.pad, "0");
  const { date, time } = stamp(file);
  let out = (o.pattern || "{name}").replace(/\{name\}/g, name).replace(/\{n\}/g, n).replace(/\{date\}/g, date).replace(/\{time\}/g, time).replace(/\{ext\}/g, ext);
  if (o.caseMode === "lower") out = out.toLowerCase(); else if (o.caseMode === "upper") out = out.toUpperCase();
  if (o.slug) out = slugify(out);
  if (!/\{ext\}/.test(o.pattern || "") && ext) out += `.${o.caseMode === "lower" ? ext.toLowerCase() : o.caseMode === "upper" ? ext.toUpperCase() : ext}`;
  return out || file.name;
}

const renameTool = {
  id: "rename",
  title: "Rename files",
  description: "Rename many files at once with a pattern: a counter, the date, find and replace (plain or regex), lower-case, and Latin-only names for uploads. Download them one by one or as a zip.",
  keywords: ["batch", "bulk", "pattern", "counter", "number", "sequence", "replace", "transliterate", "slug"],
  accept: "*/*",
  hint: "Any files — the order of the list is the numbering order",
  runLabel: "Rename",
  renderOptions(root, files) {
    const pattern = el("input", { type: "text", value: "{name}", placeholder: "{name}-{n}" });
    const start = number(1, { min: 0 }), step = number(1, { min: 1, max: 100 }), pad = number(2, { min: 1, max: 8 });
    const find = el("input", { type: "text", placeholder: "Text to find" }), replace = el("input", { type: "text", placeholder: "Replacement" }), regex = checkbox("Regular expression", false);
    const caseMode = select([["keep", "Keep"], ["lower", "lower case"], ["upper", "UPPER CASE"]], "keep");
    const slug = checkbox("Latin letters only (transliterate, no spaces)", false);
    const table = el("table", { class: "meta" }), stat = el("div", { class: "stat" });
    root.append(
      el("div", { class: "row" }, [field("Pattern", pattern, "{name} original name · {n} counter · {date} · {time} · {ext}")]),
      el("div", { class: "row" }, [field("Counter starts at", start), field("Step", step), field("Digits", pad), field("Letter case", caseMode), slug.label]),
      el("div", { class: "row" }, [field("Find", find), field("Replace with", replace), regex.label]),
      stat, el("div", { class: "table-wrap" }, [table]),
    );
    this.opts = () => ({ pattern: pattern.value, start: Number(start.value) || 0, step: Number(step.value) || 1, pad: Number(pad.value) || 1, find: find.value, replace: replace.value, regex: regex.input.checked, caseMode: caseMode.value, slug: slug.input.checked });
    const preview = () => {
      try {
        const names = files.map((f, i) => renameOne(f, i, this.opts()));
        const changed = names.filter((n, i) => n !== files[i].name).length;
        stat.textContent = t("{changed} of {total} names change", { changed, total: files.length });
        table.replaceChildren(...files.slice(0, 60).map((f, i) => el("tr", {}, [el("th", { text: f.name }), el("td", { text: names[i] === f.name ? "—" : names[i] })])));
      } catch (err) { stat.textContent = err.message; }
    };
    for (const i of [pattern, start, step, pad, find, replace, regex.input, caseMode, slug.input]) { i.addEventListener("input", preview); i.addEventListener("change", preview); }
    preview();
  },
  async run(files) {
    const o = this.opts(), used = new Set(), out = [];
    files.forEach((f, i) => {
      let name = renameOne(f, i, o), k = 1;
      const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      while (used.has(name.toLowerCase())) name = `${stem}-${++k}${ext}`;
      used.add(name.toLowerCase());
      out.push({ name, blob: f, note: name === f.name ? t("unchanged") : t("was {name}", { name: f.name }) });
    });
    return out;
  },
};

// ---------- ZIP ----------

/** `name`, or `name (2)`, `name (3)`… when it is already taken (case-insensitive). */
function unique(name, used) {
  const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
  let out = name, k = 1;
  while (used.has(out.toLowerCase())) out = `${stem} (${++k})${ext}`;
  used.add(out.toLowerCase());
  return out;
}

const zipCreateTool = {
  id: "zip-create",
  title: "Create ZIP",
  description: "Pack files into one ZIP archive to send or upload them together. Drop a folder to pack everything inside it.",
  keywords: ["archive", "compress files", "pack", "zip files", "bundle", "архів", "заархівувати", "запакувати"],
  accept: "*/*",
  hint: "Any files or a folder",
  runLabel: "Create ZIP",
  renderOptions(root, files) {
    const name = el("input", { type: "text", value: "archive", placeholder: "archive", "data-remember": "" });
    const level = select([["6", "Normal"], ["9", "Smallest (slower)"], ["0", "No compression (fastest, for photos and video)"]], "6");
    const total = files.reduce((s, f) => s + f.size, 0);
    root.append(el("div", { class: "row" }, [field("Archive name", name), field("Compression", level)]),
      el("div", { class: "stat", text: `${plural(files.length, "file")} · ${formatBytes(total)}` }));
    this.opts = { name, level };
  },
  async run(files, _root, progress) {
    const zip = new JSZip(), used = new Set();
    for (const f of files) zip.file(unique(f.name, used), f, { date: new Date(f.lastModified || Date.now()) });
    const level = Number(this.opts.level.value);
    progress?.start(100);
    let last = 0;
    const blob = await zip.generateAsync({ type: "blob", compression: level ? "DEFLATE" : "STORE", compressionOptions: { level: level || 1 } }, (m) => {
      const pct = Math.floor(m.percent);
      while (last < pct) { last++; progress?.tick(m.currentFile || ""); }
    });
    const total = files.reduce((s, f) => s + f.size, 0);
    const stem = (this.opts.name.value.trim() || "archive").replace(/\.zip$/i, "").replace(/[\\/:*?"<>|]+/g, "-");
    return [{ name: `${stem}.zip`, blob, note: `${plural(files.length, "file")} · ${total ? Math.round((1 - blob.size / total) * 100) : 0}% ${t("smaller")}` }];
  },
};

const zipExtractTool = {
  id: "zip-extract",
  title: "Extract ZIP",
  description: "Open a ZIP archive, see what is inside and take the files out: all of them or only those whose name matches. Then send them straight into another tool.",
  keywords: ["unzip", "unpack", "open archive", "decompress", "розпакувати", "розархівувати", "архів"],
  accept: ".zip,application/zip,application/x-zip-compressed",
  hint: "One or more ZIP archives",
  runLabel: "Extract",
  renderOptions(root, files) {
    const info = el("div", { class: "stat", text: "Reading…" });
    const filter = el("input", { type: "text", placeholder: ".pdf, invoice…", "data-noremember": "" });
    const table = el("table", { class: "meta" });
    root.append(el("div", { class: "row" }, [field("Only names containing", filter)]), info, el("div", { class: "table-wrap" }, [table]));
    const st = { entries: [], filter };
    this.state = st;
    const paint = () => {
      const q = filter.value.trim().toLowerCase();
      const shown = st.entries.filter((e) => !q || e.path.toLowerCase().includes(q));
      const size = shown.reduce((s, e) => s + e.size, 0);
      info.textContent = st.error || `${plural(shown.length, "file")} · ${formatBytes(size)}${st.entries.length > shown.length ? ` (${t("of {n} in the archive", { n: st.entries.length })})` : ""}`;
      table.replaceChildren(...shown.slice(0, 200).map((e) => el("tr", {}, [el("th", { text: e.path }), el("td", { text: formatBytes(e.size) })])));
      if (shown.length > 200) table.append(el("tr", {}, [el("th", { text: t("… {n} more", { n: shown.length - 200 }) }), el("td", {})]));
    };
    filter.addEventListener("input", paint);
    st.ready = (async () => {
      for (const f of files) {
        try {
          const zip = await JSZip.loadAsync(f);
          for (const entry of Object.values(zip.files)) {
            if (entry.dir || /(^|\/)(__MACOSX\/|\.DS_Store$)/.test(entry.name)) continue;
            st.entries.push({ entry, path: entry.name, size: entry._data?.uncompressedSize || 0 });
          }
        } catch (err) { st.error = t("Could not open {name}: {error}", { name: f.name, error: /encrypt/i.test(err.message) ? t("password-protected archives are not supported") : err.message }); }
      }
      paint();
    })();
  },
  async run(_files, _root, progress) {
    const st = this.state;
    await st.ready;
    if (st.error && !st.entries.length) throw new Error(st.error);
    const q = st.filter.value.trim().toLowerCase();
    const picked = st.entries.filter((e) => !q || e.path.toLowerCase().includes(q));
    if (!picked.length) throw new Error("Nothing to extract");
    if (picked.length > 2000) throw new Error("More than 2,000 files: narrow them down with the name filter");
    progress?.start(picked.length);
    const used = new Set(), out = [];
    for (const e of picked) {
      await progress?.tick(e.path);
      let blob;
      try { blob = await e.entry.async("blob"); }
      catch (err) { throw new Error(t("Could not open {name}: {error}", { name: e.path, error: /encrypt/i.test(err.message) ? t("password-protected archives are not supported") : err.message })); }
      const name = unique(e.path.split("/").pop(), used);
      out.push({ name, blob: new File([blob], name, { type: guessType(name), lastModified: e.entry.date?.getTime() || Date.now() }), note: e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "" });
    }
    return out;
  },
};

export const fileTools = [renameTool, zipCreateTool, zipExtractTool];
