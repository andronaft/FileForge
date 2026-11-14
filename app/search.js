// Tool search that forgives how people actually type: "пдф", "jpg в pdf", "об'єднати", Russian words, a typo
// ("mrege"), or the wrong keyboard layout ("зва" for "pdf"). Everything is matched against the tool's English and
// translated title, description and keywords, so it works in either interface language.

/** Lower case, apostrophes dropped ("об'єднати" = "обєднати"), ё = е, punctuation to spaces. */
export function normalize(s) {
  return String(s).toLowerCase().replace(/[’'ʼ`´]/g, "").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Small words that carry no meaning in "png в jpg", "pdf to text", "фото на паспорт".
const STOP = new Set(["в", "у", "на", "з", "із", "зі", "до", "і", "й", "та", "для", "из", "с", "как", "як", "to", "in", "into", "from", "the", "a", "an", "and", "for", "of"]);

// What a typed word may also mean. The key is tested against the start of the word, the values are looked up in
// the tool text. Covers Cyrillic spellings of formats, Russian verbs and everyday synonyms.
const ALIASES = [
  [/^(пдф|пдв)/, ["pdf"]],
  [/^(джпг|жпг|джипег|джпег|жпег|jpe?g)/, ["jpg", "jpeg"]],
  [/^пнг/, ["png"]],
  [/^(хейк|хеік|хеик|heif)/, ["heic"]],
  [/^свг/, ["svg"]],
  [/^(кюар|куар|кьюар)/, ["qr"]],
  [/^(фото|фотк|картин|зображ|изображ|малюн|рисун|image|picture|photo|pic$)/, ["image", "зображен", "photo", "фото"]],
  [/^(сжат|сжим|зжат|зжим|стис|ужат|уменьш|зменш|вага$|вес$|легш)/, ["compress", "стисн"]],
  [/^(обрез|обріз|кроп|виріз|вырез)/, ["crop", "обріз"]],
  [/^(объедин|обьедин|обєдн|обьедн|склеи|склеї|злит|злий|соедин|зєдн|combine|join)/, ["merge", "злити"]],
  [/^(раздел|розділ|разбит|розбит|разрез|розріз)/, ["split", "розділ"]],
  [/^(поверн|поворот|розверн|разверн|переверн)/, ["rotate"]],
  [/^(подпис|підпис)/, ["sign", "підпис"]],
  [/^(конверт|преобраз|перетвор|формат)/, ["convert", "конверт"]],
  [/^(ексел|эксел|excel|xlsx?$|таблиц)/, ["table", "csv", "таблиц"]],
  [/^скан/, ["scan"]],
  [/^(паспорт|віза$|виза$)/, ["passport", "паспорт"]],
  [/^(водян|вотермарк|ватермарк)/, ["watermark"]],
  [/^(замаз|замал|закрас|заблюр|розмит|размыт|цензур|приховат|скрыт)/, ["redact"]],
  [/^(розмір|размер|ресайз|масштаб)/, ["resize", "розмір"]],
  [/^нумер/, ["page numbers"]],
  [/^(удал|видал|убрат|прибрат)/, ["remove", "delete", "видал"]],
  [/^(переймен|переимен)/, ["rename"]],
  [/^(колаж|коллаж)/, ["collage"]],
  [/^(хеш|хэш|контрольн)/, ["hash", "checksum"]],
  [/^(сравн|порівн)/, ["compare", "diff", "порівн"]],
  [/^(скрин|скрін)/, ["screenshot", "скріншот"]],
  [/^текст/, ["text", "текст"]],
  [/^(страниц|сторін)/, ["page", "сторін"]],
  [/^(иконк|іконк|фавік|фавик)/, ["icon", "favicon"]],
  [/^(цвет|колір|кольор)/, ["colour", "color", "кольор"]],
  [/^(метадан|exif|ексіф|эксиф)/, ["metadata", "exif"]],
];

function alternatives(word) {
  const out = [word];
  for (const [re, alts] of ALIASES) if (re.test(word)) for (const a of alts) if (!out.includes(a)) out.push(a);
  return out;
}

// "X to Y" queries: the kind of each word, and the tool that converts the first kind into the second.
const KINDS = [
  ["heic", /^(heic|heif)$/], ["svg", /^svg$/], ["pdf", /^pdf$/], ["md", /^(md|markdown)$/], ["csv", /^(csv|tsv)$/], ["json", /^json$/], ["html", /^html$/],
  ["text", /^(text|txt|текст.*)$/],
  ["img", /^(png|jpg|jpeg|webp|avif|gif|bmp|tiff?|image|images|photo|photos|picture|pictures|зображен.*|фото.*|картин.*)$/],
];
const CONVERTERS = {
  "img>img": "convert", "img>pdf": "images-to-pdf", "pdf>img": "pdf-to-images", "pdf>text": "pdf-to-text", "heic>img": "heic", "heic>pdf": "images-to-pdf",
  "svg>img": "svg-raster", "md>pdf": "md-to-pdf", "md>html": "md-to-html", "csv>json": "csv-json", "json>csv": "csv-json",
};
function converterFor(words) {
  const kinds = words.map((w) => {
    const alts = alternatives(w);
    return KINDS.find(([, re]) => alts.some((a) => re.test(a)))?.[0];
  }).filter(Boolean);
  return kinds.length === 2 ? CONVERTERS[kinds.join(">")] : undefined;
}

// The same keys on a QWERTY and on a Ukrainian (or Russian) keyboard.
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const UK = "йцукенгшщзхїфівапролджєячсмитьбю'";
const TO_UK = new Map([...EN].map((c, i) => [c, UK[i]]));
const TO_EN = new Map([...UK].map((c, i) => [c, EN[i]]).concat([["ы", "s"], ["э", "'"], ["ъ", "]"], ["ё", "`"]]));
/** The text as it would read had the other keyboard layout been on; null when nothing changes. */
export function swapLayout(s) {
  const lower = String(s).toLowerCase();
  const cyr = /[Ѐ-ӿ]/.test(lower);
  const map = cyr ? TO_EN : TO_UK;
  const out = [...lower].map((c) => map.get(c) ?? c).join("");
  return out === lower ? null : out;
}

/** Edit distance with swapped neighbours counted once ("mrege" → "merge" is 1); gives up past `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      if (d < best) best = d;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = row;
  }
  return prev[b.length];
}
/** A typo of the start of some word in the tool text: one slip for 4+ letters, two for 8+. */
function fuzzyHit(word, tokens) {
  if (word.length < 4) return false;
  const max = word.length >= 8 ? 2 : 1;
  for (const tok of tokens) {
    if (tok.length < word.length - max || tok[0] !== word[0]) continue;
    for (let len = word.length - 1; len <= word.length + 1; len++) {
      if (len <= tok.length && distance(word, tok.slice(0, len), max) <= max) return true;
    }
  }
  return false;
}

/**
 * A search over `tools`. `describe(tool)` returns { title, text }: the strings a hit in the title is scored on,
 * and everything else that may match. Returns search(q) → tools, best first; an empty query returns them all.
 */
export function createSearch(tools, describe) {
  const index = tools.map((tool) => {
    const d = describe(tool);
    const title = normalize(d.title), hay = `${title} ${normalize(d.text)}`;
    return { tool, title, hay, tokens: [...new Set(hay.split(" "))] };
  });

  function pass(words, fuzzy) {
    const wordAlts = words.map(alternatives);
    // A word is matched loosely only when no tool has it (or a synonym) as written.
    const loose = wordAlts.map((alts) => fuzzy && !index.some((e) => alts.some((a) => e.hay.includes(a))));
    const hits = [];
    for (const e of index) {
      let score = 0, ok = true;
      for (let i = 0; i < words.length && ok; i++) {
        let best = 0;
        wordAlts[i].forEach((a, n) => {
          const s = e.title.startsWith(a) ? 3 : e.title.includes(a) ? 2 : e.hay.includes(a) ? 1 : 0;
          if (s) best = Math.max(best, s - (n ? 0.25 : 0)); // a synonym counts a little less than the word itself
        });
        if (!best && loose[i] && fuzzyHit(words[i], e.tokens)) best = 0.5;
        if (best) score += best; else ok = false;
      }
      if (ok) hits.push({ tool: e.tool, score });
    }
    const converter = converterFor(words);
    if (converter) {
      const hit = hits.find((h) => h.tool.id === converter);
      if (hit) hit.score += 100;
      else { const e = index.find((x) => x.tool.id === converter); if (e) hits.push({ tool: e.tool, score: 100 }); }
    }
    return hits.sort((a, b) => b.score - a.score).map((h) => h.tool);
  }

  function wordsOf(q) {
    const all = normalize(q).split(" ").filter(Boolean);
    const meaningful = all.filter((w) => !STOP.has(w));
    return meaningful.length ? meaningful : all;
  }

  return function search(q) {
    const words = wordsOf(q);
    if (!words.length) return tools;
    let hits = pass(words, false);
    if (hits.length) return hits;
    const swapped = swapLayout(q);
    if (swapped) { hits = pass(wordsOf(swapped), false); if (hits.length) return hits; }
    hits = pass(words, true);
    if (!hits.length && swapped) hits = pass(wordsOf(swapped), true);
    return hits;
  };
}
