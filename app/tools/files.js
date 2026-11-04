// Tools that work on any file: batch rename.
import { el, baseName, field, select, number, checkbox, plural, t } from "../util.js";

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

export const fileTools = [renameTool];
