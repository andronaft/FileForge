// UI language. Strings in the code are English; t() looks each one up in the dictionary of the chosen language
// and falls back to the English text, so an untranslated string is never blank.

export const LANGS = { en: "English", uk: "Українська" };

let lang = "en";
let dict = {};
let pluralForms = {};
const LOADERS = { uk: () => import("./i18n/uk.js") };

export function getLang() { return lang; }

export function detectLang() {
  let saved = null;
  try { saved = localStorage.getItem("fileforge.lang"); } catch (_) { /* ignore */ }
  if (saved && LANGS[saved]) return saved;
  const spoken = (navigator.languages || [navigator.language || "en"]).map((l) => String(l).toLowerCase());
  return spoken.some((l) => l.startsWith("uk")) ? "uk" : "en";
}

/** Loads the dictionary for the detected language; call once before anything renders. */
export async function initLang() {
  lang = detectLang();
  if (lang !== "en") {
    try {
      const mod = await LOADERS[lang]();
      dict = mod.default || {};
      pluralForms = mod.plurals || {};
    } catch (_) { lang = "en"; }
  }
  document.documentElement.lang = lang;
  return lang;
}

export function setLang(next) {
  if (!LANGS[next] || next === lang) return;
  try { localStorage.setItem("fileforge.lang", next); } catch (_) { /* ignore */ }
  location.reload();
}

/** Translate a source string; `{name}` placeholders are filled from vars after the lookup. */
export function t(s, vars) {
  if (typeof s !== "string" || !s) return s;
  let out = Object.prototype.hasOwnProperty.call(dict, s) ? dict[s] : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** "1 page", "3 pages"; pass the plural form when it is not just +s. Ukrainian picks one of its three forms. */
export function plural(n, word, words) {
  const forms = pluralForms[word];
  if (forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    const form = a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2;
    return `${n} ${forms[form]}`;
  }
  return `${n} ${n === 1 ? word : words || word + "s"}`;
}
