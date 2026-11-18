import { el, formatBytes, download, zipFiles, toast, withType, guessType, plural, t } from "./util.js";
import { initLang, setLang, getLang, LANGS } from "./i18n.js";
import { icon } from "./icons.js";
import { createSearch } from "./search.js";
import { insights } from "./insights.js";
import { imageTools } from "./tools/image.js";
import { photoTools } from "./tools/photo.js";
import { ocrTools } from "./tools/ocr.js";
import { officeTools } from "./tools/office.js";
import { videoTools } from "./tools/video.js";
import { qrTools, audioTools } from "./tools/media.js";
import { pdfTools, renderPdfPages } from "./tools/pdf.js";
import { pdfMoreTools } from "./tools/pdf-more.js";
import { packTools } from "./tools/pack.js";
import { gifTools } from "./tools/gif.js";
import { privacyTools } from "./tools/privacy.js";
import { markdownTools } from "./tools/markdown.js";
import { dataTools } from "./tools/data.js";
import { textTools } from "./tools/text.js";
import { pipelineTool } from "./tools/pipeline.js";
import { fileTools, decodeZipName } from "./tools/files.js";
import { thumbnail, preview } from "./thumbs.js";
import { isHeic, toBrowserImage } from "./heic.js";

await initLang();
for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
for (const n of document.querySelectorAll("[data-i18n-placeholder]")) n.placeholder = t(n.dataset.i18nPlaceholder);
for (const n of document.querySelectorAll("[aria-label]")) n.setAttribute("aria-label", t(n.getAttribute("aria-label")));
for (const n of document.querySelectorAll("[title]")) n.title = t(n.title);

const groups = [
  { id: "images", title: "Images", icon: "image", tools: [...imageTools.slice(0, 1), ...photoTools, ...ocrTools, ...imageTools.slice(1), ...gifTools, ...qrTools] },
  { id: "video", title: "Video & audio", icon: "video", tools: [...videoTools, ...audioTools] },
  { id: "pdf", title: "PDF", icon: "pdf", tools: [...pdfTools.slice(0, 1), ...packTools, ...pdfTools.slice(1), ...pdfMoreTools] },
  { id: "office", title: "Word & Excel", icon: "office", tools: officeTools },
  { id: "text", title: "Text & data", icon: "text", tools: [...markdownTools, ...dataTools, ...textTools] },
  { id: "files", title: "Files", icon: "file", tools: [...privacyTools, ...fileTools] },
  { id: "batch", title: "Batch", icon: "zap", tools: [pipelineTool] },
];
const tools = groups.flatMap((g) => g.tools);
for (const g of groups) for (const tool of g.tools) tool.group = g;
pipelineTool.setTools(tools);
export const allTools = tools;

const nav = document.getElementById("nav");
const navList = document.getElementById("navList");
const navFilter = document.getElementById("navFilter");
const navSelect = document.getElementById("navSelect");
const main = document.getElementById("main");
const VERSION = document.querySelector('meta[name="fileforge-version"]')?.content || "";

// runId changes whenever a job starts or is stopped: a job that finds another number when it returns was abandoned.
const state = { tool: null, files: [], results: [], busy: false, progress: null, runId: 0, runLabel: "" };
const ui = {};

// ---------- settings ----------
// Small preferences (in this browser only). The per-tool remembered options live under fileforge.options.*.
const DEFAULT_SETTINGS = { autoDownload: true, confirmLeave: true };
let settings = { ...DEFAULT_SETTINGS };
try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("fileforge.settings") || "{}") }; } catch (_) { /* ignore */ }
function saveSettings() { try { localStorage.setItem("fileforge.settings", JSON.stringify(settings)); } catch (_) { /* ignore */ } }

// ---------- recent tools ----------
function recentIds() {
  try { return (JSON.parse(localStorage.getItem("fileforge.recent") || "[]")).filter((id) => tools.some((x) => x.id === id)); } catch (_) { return []; }
}
function noteRecent(id) {
  const list = [id, ...recentIds().filter((x) => x !== id)].slice(0, 8);
  try { localStorage.setItem("fileforge.recent", JSON.stringify(list)); } catch (_) { /* ignore */ }
}

// ---------- favourites ----------
function favIds() {
  try { return (JSON.parse(localStorage.getItem("fileforge.favourites") || "[]")).filter((id) => tools.some((x) => x.id === id)); } catch (_) { return []; }
}
function isFav(id) { return favIds().includes(id); }
function toggleFav(id) {
  const list = isFav(id) ? favIds().filter((x) => x !== id) : [...favIds(), id];
  try { localStorage.setItem("fileforge.favourites", JSON.stringify(list)); } catch (_) { /* ignore */ }
  toast(list.includes(id) ? "Added to favourites" : "Removed from favourites");
  renderNav();
  if (state.tool) { paintFav(); return; }
  // The home page is rebuilt (its Favourites row changed): keep the card where it was, and the focus on its star.
  const star = `.tool-card[data-id="${id}"] .fav-btn`;
  const before = main.querySelector(star)?.getBoundingClientRect().top;
  renderHome(true);
  const btn = main.querySelector(star);
  if (btn && before != null) {
    window.scrollBy({ top: btn.getBoundingClientRect().top - before, behavior: "instant" });
    btn.focus({ preventScroll: true });
  }
}
function favButton(tool) {
  return el("button", { type: "button", class: "icon fav-btn", "aria-pressed": isFav(tool.id) ? "true" : "false", title: isFav(tool.id) ? "Remove from favourites" : "Add to favourites", onclick: (e) => { e.preventDefault(); toggleFav(tool.id); } }, [icon("star", 18)]);
}
function paintFav() {
  for (const b of document.querySelectorAll(".fav-btn")) {
    const id = b.closest("[data-id]")?.dataset.id || state.tool?.id;
    const on = isFav(id);
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.title = on ? t("Remove from favourites") : t("Add to favourites");
  }
}

// ---------- search ----------
// Matching lives in search.js: synonyms ("пдф", "сжать"), "png в jpg", typos and the wrong keyboard layout.
const search = createSearch(tools, (tool) => ({
  title: `${tool.title} ${t(tool.title)}`,
  text: [tool.description, t(tool.description), ...(tool.keywords || []), tool.group.title, t(tool.group.title), tool.id].join(" "),
}));
/** Tools matching every word of `q`, best matches (title hits) first. */
export function searchTools(q) { return search(q); }

// ---------- navigation ----------
function navLink(tool) {
  return el("a", { class: `nav-item${state.tool?.id === tool.id ? " active" : ""}`, href: `#${tool.id}`, "data-id": tool.id }, [icon(tool.icon || tool.id, 16), el("span", { text: tool.title })]);
}
// Sidebar groups fold away (remembered in this browser); a folded group still shows the tool that is open.
function collapsedGroups() { try { return new Set(JSON.parse(localStorage.getItem("fileforge.navCollapsed") || "[]")); } catch (_) { return new Set(); } }
function toggleGroup(id) {
  const set = collapsedGroups();
  if (set.has(id)) set.delete(id); else set.add(id);
  try { localStorage.setItem("fileforge.navCollapsed", JSON.stringify([...set])); } catch (_) { /* ignore */ }
  renderNav();
  navList.querySelector(`.nav-group[data-group="${id}"]`)?.focus(); // the list was rebuilt under the keyboard
}
function navGroup(id, title, count, collapsed) {
  return el("button", { type: "button", class: "nav-group", "data-group": id, "aria-expanded": collapsed ? "false" : "true", onclick: () => toggleGroup(id) }, [
    el("span", { class: "nav-group-title", text: title }), el("span", { class: "nav-count", text: String(count) }), icon("chevron", 14),
  ]);
}
/** `reveal`: scroll the sidebar to the open tool (after a tool change, not while the filter is being typed). */
function renderNav(reveal = false) {
  navList.replaceChildren();
  const collapsed = collapsedGroups();
  navSelect.replaceChildren(el("option", { value: "home", text: "All tools", selected: !state.tool }));
  const q = navFilter.value.trim();
  const shown = new Set(searchTools(q).map((x) => x.id));
  const favs = favIds().map((id) => tools.find((x) => x.id === id)).filter((x) => shown.has(x.id));
  if (favs.length) {
    const folded = !q && collapsed.has("favourites");
    navList.append(navGroup("favourites", "Favourites", favs.length, folded));
    for (const tool of favs) if (!folded) navList.append(navLink(tool));
  }
  for (const g of groups) {
    const items = g.tools.filter((x) => shown.has(x.id));
    if (!items.length) continue;
    const folded = !q && collapsed.has(g.id); // a search always shows its matches
    navList.append(navGroup(g.id, g.title, items.length, folded));
    for (const tool of items) if (!folded || state.tool?.id === tool.id) navList.append(navLink(tool));
    const optgroup = el("optgroup", { label: t(g.title) });
    for (const tool of g.tools) optgroup.append(el("option", { value: tool.id, text: tool.title, selected: state.tool?.id === tool.id }));
    navSelect.append(optgroup);
  }
  if (!shown.size) navList.append(el("div", { class: "nav-empty", text: "No tool matches" }));
  nav.querySelector(".nav-home")?.classList.toggle("active", !state.tool);
  if (reveal) navList.querySelector(".nav-item.active")?.scrollIntoView({ block: "nearest" });
}
navSelect.addEventListener("change", () => { location.hash = navSelect.value === "home" ? "" : `#${navSelect.value}`; });
navFilter.addEventListener("input", () => renderNav());
navFilter.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { const first = navList.querySelector(".nav-item"); if (first) { location.hash = first.getAttribute("href"); navFilter.value = ""; renderNav(); } }
  if (e.key === "Escape") { navFilter.value = ""; renderNav(); navFilter.blur(); }
});

// ---------- theme ----------
// Follows the system by default; the toggle in the top bar pins light or dark (remembered in this browser).
const themeBtn = document.getElementById("themeBtn");
function isDark() { return document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches); }
function applyTheme(mode) {
  if (mode) document.documentElement.dataset.theme = mode; else delete document.documentElement.dataset.theme;
  const dark = isDark();
  themeBtn.replaceChildren(icon(dark ? "sun" : "moon"));
  themeBtn.title = dark ? t("Switch to light theme") : t("Switch to dark theme");
  themeBtn.setAttribute("aria-label", themeBtn.title);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1e222c" : "#ffffff");
}
function setTheme(mode) {
  try { if (mode) localStorage.setItem("fileforge.theme", mode); else localStorage.removeItem("fileforge.theme"); } catch (_) { /* ignore */ }
  applyTheme(mode);
}
themeBtn.addEventListener("click", () => setTheme(isDark() ? "light" : "dark"));
let savedTheme = null;
try { savedTheme = localStorage.getItem("fileforge.theme"); } catch (_) { /* ignore */ }
applyTheme(savedTheme === "dark" || savedTheme === "light" ? savedTheme : null);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) applyTheme(null); });

// ---------- side panel / small window ----------
// `?view=side` marks the compact layout: the extension's side panel (Chrome) or sidebar (Firefox), or a small
// pop-up window of the web version. The button in the top bar switches between that and a full tab.
const ext = globalThis.browser ?? globalThis.chrome;
const isExtension = !!ext?.runtime?.id;
const sideView = new URLSearchParams(location.search).get("view") === "side";
if (sideView) document.documentElement.dataset.view = "side";
const viewBtn = document.getElementById("viewBtn");
const canSide = isExtension ? !!(ext.sidePanel || ext.sidebarAction) : typeof window.open === "function";
viewBtn.hidden = !canSide;
viewBtn.replaceChildren(icon(sideView ? "expand" : "panel"));
viewBtn.title = sideView ? t("Open in a full tab") : isExtension ? t("Open in the side panel") : t("Open in a small window beside your other windows");
viewBtn.setAttribute("aria-label", viewBtn.title);
function viewUrl(side) {
  const url = new URL(location.href);
  if (side) url.searchParams.set("view", "side"); else url.searchParams.delete("view");
  url.searchParams.delete("src"); url.searchParams.delete("note");
  return url.toString();
}
async function closeThisTab() {
  try {
    const me = await ext.tabs.getCurrent();
    if (me?.id != null) { await ext.tabs.remove(me.id); return; }
  } catch (_) { /* fall through */ }
  window.close();
}
viewBtn.addEventListener("click", async () => {
  if (sideView) {
    const url = viewUrl(false);
    if (!isExtension) { window.open(url, "_blank"); window.close(); return; }
    try { await ext.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }); } catch (_) { /* ignore */ }
    await ext.tabs.create({ url });
    if (ext.sidebarAction) { try { await ext.sidebarAction.close(); } catch (_) { /* ignore */ } } else window.close();
    return;
  }
  if (!isExtension) {
    const w = window.open(viewUrl(true), "fileforge-side", "popup,width=420,height=760");
    if (!w) toast("The browser blocked the small window. Allow pop-ups for this site and try again.", "error");
    return;
  }
  try {
    if (ext.sidePanel) {
      const win = await ext.windows.getCurrent();
      await ext.sidePanel.open({ windowId: win.id });
      await ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } else {
      await ext.sidebarAction.open();
    }
    await closeThisTab();
  } catch (_) {
    toast("Could not open the side panel. Right-click the FileForge icon and choose “Open in side panel”.", "error");
  }
});

// ---------- dialogs: command palette, settings, shortcuts, preview ----------
const palette = document.getElementById("palette");
const paletteInput = document.getElementById("paletteInput");
const paletteList = document.getElementById("paletteList");
const paletteNote = document.getElementById("paletteNote");
let paletteIndex = 0;
// Set while the palette is asking which tool should open dropped files: { files, tools }.
let paletteFiles = null;

function openPalette(withFiles) {
  if (palette.open) return;
  paletteFiles = withFiles?.files ? withFiles : null;
  paletteNote.hidden = !paletteFiles;
  if (paletteFiles) {
    const { files } = paletteFiles;
    paletteNote.replaceChildren(
      el("strong", { text: t("Open {files} with…", { files: plural(files.length, "file") }) }),
      el("span", { text: files.length === 1 ? files[0].name : t("{name} and {more} more", { name: files[0].name, more: files.length - 1 }) }),
    );
    // A look inside the files: what they are (a scan, a form, a photo with a location) and the tool for that.
    const box = el("div", { class: "palette-insights" }), mine = paletteFiles;
    paletteNote.append(box);
    insights(files).then((facts) => {
      if (paletteFiles !== mine) return;
      box.replaceChildren(...facts.filter((f) => tools.some((x) => x.id === f.tool)).map((f) => el("button", { type: "button", class: "palette-insight", onclick: () => { palette.close(); openWith(f.tool, f.files); } },
        [icon("zap", 16), el("span", { text: f.text }), el("strong", { text: f.action })])));
    });
  }
  paletteInput.value = "";
  paletteIndex = 0;
  renderPalette();
  palette.showModal();
  paletteInput.focus();
}
palette.addEventListener("close", () => { paletteFiles = null; });
function renderPalette() {
  const q = paletteInput.value;
  // For dropped files: only the tools that take them, in the suggested order until something is typed.
  let hits = paletteFiles
    ? (q.trim() ? searchTools(q).filter((x) => paletteFiles.tools.includes(x)) : paletteFiles.tools)
    : q.trim() ? searchTools(q).slice(0, 12)
      : [...new Set([...recentIds(), ...POPULAR])].map((id) => tools.find((x) => x.id === id)).filter(Boolean).slice(0, 12);
  // Nothing has every word: offer what has some of them rather than a dead end.
  let similar = false;
  if (!hits.length && q.trim()) { hits = search.similar(q).filter((x) => !paletteFiles || paletteFiles.tools.includes(x)).slice(0, 6); similar = hits.length > 0; }
  paletteIndex = Math.min(paletteIndex, Math.max(0, hits.length - 1));
  paletteList.replaceChildren(...hits.map((tool, i) => el("button", {
    type: "button", class: `palette-item${i === paletteIndex ? " active" : ""}`, role: "option", "aria-selected": i === paletteIndex ? "true" : "false",
    onclick: () => {
      const files = paletteFiles?.files;
      palette.close();
      if (files) openWith(tool.id, files); else location.hash = `#${tool.id}`;
    },
    onmousemove: () => { if (paletteIndex !== i) { paletteIndex = i; renderPalette(); } },
  }, [icon(tool.icon || tool.id, 18), el("span", { class: "palette-text" }, [el("strong", { text: tool.title }), el("small", { text: tool.description })]), el("kbd", { class: "palette-group", text: tool.group.title })])));
  if (similar) paletteList.prepend(el("div", { class: "palette-label", text: "No exact match. Similar tools:" }));
  if (!hits.length) paletteList.append(el("div", { class: "palette-empty", text: "No tool matches. Try another word, or just drop the file here and FileForge will suggest tools." }));
}
paletteInput.addEventListener("input", () => { paletteIndex = 0; renderPalette(); });
paletteInput.addEventListener("keydown", (e) => {
  const items = paletteList.querySelectorAll(".palette-item");
  const move = (step) => {
    e.preventDefault();
    paletteIndex = (paletteIndex + step + items.length) % Math.max(1, items.length);
    renderPalette();
    paletteList.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" }); // the list scrolls
  };
  if (e.key === "ArrowDown") move(1);
  else if (e.key === "ArrowUp") move(-1);
  else if (e.key === "Enter") { e.preventDefault(); items[paletteIndex]?.click(); }
});
palette.addEventListener("click", (e) => { if (e.target === palette) palette.close(); });
document.getElementById("searchBtn").addEventListener("click", () => openPalette());

const settingsDlg = document.getElementById("settings");
function renderSettings() {
  const lang = el("select", { id: "langSelect" }, Object.entries(LANGS).map(([v, label]) => el("option", { value: v, text: label, selected: v === getLang() })));
  lang.addEventListener("change", () => setLang(lang.value));
  const theme = el("select", {}, [["", "Follow the system"], ["light", "Light"], ["dark", "Dark"]].map(([v, label]) => el("option", { value: v, text: label, selected: (document.documentElement.dataset.theme || "") === v })));
  theme.addEventListener("change", () => setTheme(theme.value || null));
  const auto = el("input", { type: "checkbox", checked: settings.autoDownload });
  auto.addEventListener("change", () => { settings.autoDownload = auto.checked; saveSettings(); });
  const body = settingsDlg.querySelector(".dialog-body");
  body.replaceChildren(
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Language" }), lang]),
    el("label", { class: "field" }, [el("span", { class: "field-label", text: "Theme" }), theme]),
    el("label", { class: "check" }, [auto, el("span", { text: "Download a single result automatically" })]),
    el("div", { class: "actions" }, [
      el("button", { type: "button", text: "Forget remembered options", onclick: () => {
        try { for (const k of Object.keys(localStorage)) if (k.startsWith("fileforge.options.")) localStorage.removeItem(k); } catch (_) { /* ignore */ }
        toast("Every tool is back to its defaults");
      } }),
      el("button", { type: "button", text: "Clear recent tools", onclick: () => { try { localStorage.removeItem("fileforge.recent"); } catch (_) { /* ignore */ } toast("Recent tools cleared"); if (!state.tool) renderHome(); } }),
    ]),
    el("p", { class: "stat" }, [
      t("FileForge {version} · everything runs on your device, nothing is uploaded.", { version: VERSION }), " ",
      el("a", { href: "https://github.com/andronaft/FileForge", target: "_blank", rel: "noopener", text: "Source code" }), " · ",
      el("a", { href: "https://github.com/andronaft/FileForge/blob/main/PRIVACY.md", target: "_blank", rel: "noopener", text: "Privacy" }), " · ",
      el("a", { href: "https://github.com/andronaft/FileForge/issues", target: "_blank", rel: "noopener", text: "Report a problem" }),
    ]),
  );
}
document.getElementById("settingsBtn").addEventListener("click", () => { renderSettings(); settingsDlg.showModal(); });

const shortcutsDlg = document.getElementById("shortcuts");
const MOD = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl";
// The hint on the search button is written for a Mac in index.html.
if (MOD !== "⌘") { const hint = document.querySelector("#searchBtn kbd"); if (hint) hint.textContent = `${MOD} K`; }
function renderShortcuts() {
  const rows = [
    [`${MOD} K`, "Find a tool"], [`${MOD} Enter`, "Run the current tool"], ["/", "Filter the tool list"], ["?", "This list"],
    ["Esc", "Close a dialog"], [`${MOD} V`, "Paste an image from the clipboard"], ["Alt Shift F", "Open FileForge from any tab (extension)"],
  ];
  shortcutsDlg.querySelector(".dialog-body").replaceChildren(el("table", { class: "meta" }, rows.map(([k, d]) => el("tr", {}, [el("th", {}, [el("kbd", { text: k })]), el("td", { text: d })]))));
}

const lightbox = document.getElementById("lightbox");
/** Show a file or result ({ name, blob }) in the lightbox: images and PDFs full size, text as text. */
async function previewResult(r) {
  const body = lightbox.querySelector(".dialog-body");
  body.replaceChildren();
  lightbox.querySelector("h2").textContent = r.name;
  lightbox.showModal();
  let blob = r.blob;
  if (isHeic(blob instanceof File ? blob : new File([blob], r.name, { type: blob.type }))) {
    body.append(el("p", { class: "stat", text: t("Decoding…") }));
    try { blob = await toBrowserImage(blob instanceof File ? blob : new File([blob], r.name, { type: blob.type })); }
    catch (err) { body.replaceChildren(el("p", { class: "stat", text: err.message })); return; }
    if (!lightbox.open) return;
    body.replaceChildren();
  }
  const url = URL.createObjectURL(blob);
  lightbox.addEventListener("close", () => URL.revokeObjectURL(url), { once: true });
  if (blob.type.startsWith("image/")) body.append(el("img", { src: url, alt: r.name }));
  else if (blob.type === "application/pdf") {
    const width = Math.min(900, body.clientWidth - 32);
    renderPdfPages(blob, body, width)
      .then((free) => { if (lightbox.open) lightbox.addEventListener("close", free, { once: true }); else free(); })
      .catch((err) => body.replaceChildren(el("p", { class: "stat", text: err.message })));
  }
  else blob.slice(0, 200_000).text().then((text) => body.append(el("pre", { text: text + (blob.size > 200_000 ? "\n…" : "") })));
}

/** A thumbnail that opens the file in the lightbox when it can be previewed. */
function thumbFor(file, name = file.name) {
  const canOpen = PREVIEWABLE({ blob: file }) || isHeic(file);
  const thumb = el(canOpen ? "button" : "span", canOpen
    ? { type: "button", class: "thumb", title: t("Preview"), "aria-label": t("Preview {name}", { name }), onclick: (e) => { e.stopPropagation(); previewResult({ name, blob: file }); } }
    : { class: "thumb", "aria-hidden": "true" }, [icon(kindIcon(file), 18)]);
  if (canOpen) thumb.draggable = false;
  thumbnail(file).then((c) => { if (c) thumb.replaceChildren(c); });
  return thumb;
}
for (const dlg of document.querySelectorAll("dialog")) {
  dlg.querySelector(".dialog-close")?.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
}

const inField = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
  if (inField(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); if (getComputedStyle(nav).display === "none") openPalette(); else { navFilter.focus(); navFilter.select(); } }
  else if (e.key === "?") { e.preventDefault(); renderShortcuts(); shortcutsDlg.showModal(); }
});

// ---------- home ----------
// The tool is always in the hash; a link with ?tool= (how the extension opens the app) is rewritten at start-up.
function requestedToolId() {
  return location.hash.replace(/^#/, "") || "home";
}

const POPULAR = ["pdf-merge", "pdf-pack", "compress", "pdf-sign", "doc-scan", "ocr", "images-to-pdf", "pdf-compress", "heic", "pdf-unlock", "word", "video-gif"];

function toolCard(tool) {
  return el("a", { class: "tool-card", href: `#${tool.id}`, "data-id": tool.id }, [
    el("span", { class: "tool-card-icon" }, [icon(tool.icon || tool.id, 22)]),
    el("span", { class: "tool-card-text" }, [el("strong", { text: tool.title }), el("span", { text: tool.description })]),
    favButton(tool),
  ]);
}

function renderHome(keepScroll = false) {
  stopRun();
  state.tool = null;
  state.results = [];
  document.title = "FileForge";
  renderNav();
  const search = el("button", { type: "button", class: "home-search", onclick: () => openPalette() }, [icon("search"), el("span", { text: t("Search {n} tools…", { n: tools.length }) }), el("kbd", { text: `${MOD} K` })]);
  const fileInput = el("input", { type: "file", hidden: true, multiple: true, onchange: () => { openFiles([...fileInput.files]); fileInput.value = ""; } });
  const drop = el("section", { class: "dropzone home-drop", tabindex: "0", role: "button", "aria-label": "Choose files" }, [
    fileInput,
    el("div", { class: "dz-inner" }, [
      icon("upload", 28),
      el("div", {}, [el("strong", { text: "Drop any file here" }), " ", t("or"), " ", el("button", { class: "link", type: "button", text: "choose files", onclick: () => fileInput.click() })]),
      el("div", { class: "dz-hint", text: "FileForge shows the tools that can open it: pick one, or press Enter for the suggested one" }),
    ]),
  ]);
  drop.addEventListener("keydown", (e) => { if (e.target === drop && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileInput.click(); } });
  ui.dropzone = drop;
  const recent = recentIds().map((id) => tools.find((x) => x.id === id));
  const favs = favIds().map((id) => tools.find((x) => x.id === id));
  const sections = groups.map((g) => el("section", { class: "home-group", id: `group-${g.id}` }, [
    el("h2", {}, [icon(g.icon, 18), el("span", { text: g.title }), el("span", { class: "count", text: String(g.tools.length) })]),
    el("div", { class: "tool-grid" }, g.tools.map(toolCard)),
  ]));
  const chip = (tool) => el("a", { class: "chip", href: `#${tool.id}` }, [icon(tool.icon || tool.id, 16), el("span", { text: tool.title })]);
  // The page is long: a row of group links, and the most common jobs until the user has their own recent ones.
  const jump = el("nav", { class: "chips jump", "aria-label": "Tool groups" }, groups.map((g, i) => el("button", { type: "button", class: "chip", onclick: () => sections[i].scrollIntoView({ behavior: "smooth", block: "start" }) }, [icon(g.icon, 16), el("span", { text: g.title }), el("span", { class: "count", text: String(g.tools.length) })])));
  const popular = POPULAR.map((id) => tools.find((x) => x.id === id)).filter(Boolean);
  main.replaceChildren(...[
    el("section", { class: "hero" }, [
      el("h1", { text: "Every file job, done on your device" }),
      el("p", { text: "Images, PDFs and text: crop, compress, convert, merge, split, redact, watermark and more. Nothing is uploaded, it works offline, and it stays free." }),
      search,
    ]),
    drop,
    favs.length ? el("section", { class: "home-group" }, [el("h2", {}, [icon("star", 18), el("span", { text: "Favourites" })]), el("div", { class: "chips" }, favs.map(chip))]) : null,
    recent.length ? el("section", { class: "home-group" }, [el("h2", {}, [icon("zap", 18), el("span", { text: "Recent" })]), el("div", { class: "chips" }, recent.map(chip))]) : null,
    recent.length < 3 ? el("section", { class: "home-group" }, [el("h2", {}, [icon("zap", 18), el("span", { text: "Popular" })]), el("div", { class: "chips" }, popular.filter((x) => !recent.includes(x)).map(chip))]) : null,
    jump,
    ...sections,
    el("footer", { class: "home-foot" }, [
      el("span", {}, [icon("shield", 16), " ", t("Private by design: no server, no account, no analytics.")]),
      el("span", {}, [icon("wifi_off", 16), " ", t("Works offline once loaded.")]),
      el("span", { text: VERSION ? `v${VERSION}` : "" }),
    ]),
  ].filter(Boolean));
  if (!keepScroll) window.scrollTo(0, 0);
}

// ---------- tool view ----------
function mount() {
  stopRun(); // a job belongs to the tool view that started it
  const id = requestedToolId();
  const tool = tools.find((x) => x.id === id);
  if (!tool) { if (id !== "home") history.replaceState(null, "", location.pathname + location.search); state.files = []; renderHome(); return; }
  state.tool = tool;
  noteRecent(tool.id);
  // Files stay loaded when switching to another tool that takes them (e.g. crop → compress).
  state.files = state.files.filter((f) => accepts(tool, f));
  if (tool.multiple === false) state.files = state.files.slice(0, 1);
  state.results = [];
  document.title = `${t(tool.title)} · FileForge`;
  renderNav(true);

  const many = tool.multiple !== false;
  const fileInput = el("input", {
    type: "file", id: "fileInput", hidden: true,
    // A ZIP can be picked too: addFiles unpacks it. A tool that takes any file gets no filter at all: "*/*,.zip"
    // would make the file dialog offer ZIP archives only.
    multiple: many, accept: takesAnything(tool) ? "" : many ? `${tool.accept},.zip` : tool.accept,
    onchange: () => { addFiles([...fileInput.files]); fileInput.value = ""; },
  });
  const folderInput = many ? el("input", {
    type: "file", hidden: true, webkitdirectory: "", multiple: true,
    onchange: () => {
      const picked = [...folderInput.files].filter((f) => !JUNK.test(f.webkitRelativePath || f.name));
      for (const f of picked) if (f.webkitRelativePath) f.relativePath = f.webkitRelativePath; // "site/blog/index.html"
      addFiles(picked);
      folderInput.value = "";
    },
  }) : null;
  const dropzone = el("section", { class: "dropzone", tabindex: "0", role: "button", "aria-label": tool.multiple === false ? "Choose a file" : "Choose files" }, [
    fileInput,
    el("div", { class: "dz-inner" }, [
      icon("upload", 24),
      el("div", {}, [
        el("strong", { text: tool.multiple === false ? "Drop a file here" : "Drop files here" }),
        " ", t("or"), " ",
        el("button", { class: "link", type: "button", text: tool.multiple === false ? "choose a file" : "choose files", onclick: () => fileInput.click() }),
        ...(folderInput ? [" ", t("or"), " ", el("button", { class: "link", type: "button", text: "a folder", onclick: () => folderInput.click() }), folderInput] : []),
      ]),
      el("div", { class: "dz-hint", text: tool.hint || "" }),
    ]),
  ]);
  // Only when the box itself has the focus: Enter on "a folder" inside it must stay that button's own.
  dropzone.addEventListener("keydown", (e) => { if (e.target === dropzone && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fileInput.click(); } });
  ui.dropzone = dropzone;

  ui.fileList = el("section", { class: "file-list" });
  ui.options = el("section", { class: "options card", hidden: !tool.filesOptional });
  ui.options.addEventListener("change", saveOptions);
  ui.options.addEventListener("input", saveOptions);
  // Fields the user really typed in are carried over when the options are rebuilt (see typedOptions).
  ui.options.addEventListener("input", (e) => { if (e.isTrusted && e.target?.dataset) e.target.dataset.edited = "1"; });
  ui.runBtn = el("button", { class: "primary", type: "button", text: tool.runLabel || "Run", title: `${MOD} Enter`, onclick: run });
  ui.cancelBtn = el("button", { type: "button", text: "Cancel", hidden: true, onclick: () => state.progress?.cancel() });
  ui.progress = el("div", { class: "progress", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, [el("div", { class: "progress-bar" }), el("span", { class: "progress-text" })]);
  ui.actions = el("section", { class: "actions run-row", hidden: !tool.filesOptional }, [
    ui.runBtn,
    el("button", { type: "button", text: "Clear", onclick: () => { stopRun(); state.files = []; state.results = []; refresh({ fresh: true }); } }),
    ui.cancelBtn,
    ui.progress,
  ]);
  ui.results = el("section", { class: "results card", hidden: true, "aria-live": "polite" });

  main.replaceChildren(
    el("section", { class: "tool-head" }, [
      el("span", { class: "tool-head-icon" }, [icon(tool.icon || tool.id, 26)]),
      el("div", { class: "tool-head-text" }, [el("h1", { text: tool.title }), el("p", { text: tool.description })]),
      favButton(tool),
    ]),
    dropzone,
    ui.fileList,
    ui.options,
    ui.actions,
    ui.results,
  );
  refresh();
}

function accepts(tool, f) {
  if (!tool.accept || tool.accept === "*/*") return true;
  return tool.accept.split(",").some((pattern) => {
    pattern = pattern.trim();
    if (pattern.endsWith("/*")) return f.type.startsWith(pattern.slice(0, -1));
    if (pattern.startsWith(".")) return f.name.toLowerCase().endsWith(pattern.toLowerCase());
    return f.type === pattern;
  });
}

// ---------- folders and ZIP archives ----------
// A dropped folder is walked recursively and a .zip is unpacked, so "all the scans in this folder" or "the photos
// someone sent as an archive" go straight into the tool. Hidden files and macOS resource forks are skipped.

const JUNK = /(^|\/)(\.|__MACOSX\/|Thumbs\.db$|desktop\.ini$)/i;
const MAX_EXPANDED = 2000;
const isZip = (f) => f.type === "application/zip" || f.type === "application/x-zip-compressed" || /\.zip$/i.test(f.name);
const takesAnything = (tool) => !tool.accept || tool.accept === "*/*";

/** withType() returns a copy when it fills in the type: the copy keeps the folder path the original carried. */
function typedFile(f) {
  const g = withType(f);
  if (g !== f && f.relativePath) g.relativePath = f.relativePath;
  return g;
}

async function unzip(file) {
  const zip = await JSZip.loadAsync(file, { decodeFileName: decodeZipName });
  const out = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || JUNK.test(entry.name)) continue;
    if (out.length >= MAX_EXPANDED) break;
    const name = entry.name.split("/").pop();
    const blob = await entry.async("blob");
    out.push(withType(new File([blob], name, { lastModified: entry.date?.getTime() || Date.now() })));
  }
  return out;
}

/** Folders (as drop entries) and ZIPs become the files inside them; ZIPs are kept as is for a tool that takes ZIPs
 *  or any file at all (the checksum of a downloaded archive, an archive inside a new one). */
async function expandFiles(files, tool = state.tool) {
  const out = [];
  for (const f of files) {
    if (isZip(f) && !(tool && (takesAnything(tool) || /zip/.test(tool.accept)))) {
      try {
        const inner = await unzip(f);
        if (inner.length) toast(t("Unpacked {files} from {name}", { files: plural(inner.length, "file"), name: f.name }));
        out.push(...inner);
      } catch (err) { toast(t("Could not open {name}: {error}", { name: f.name, error: err.message || String(err) }), "error"); }
    } else out.push(f);
    if (out.length >= MAX_EXPANDED) break;
  }
  return out;
}

/** Every file under the dropped items, walking into folders. Must start inside the drop event. */
function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map((it) => (it.kind === "file" && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null));
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve([...(dt.files || [])]);
  const out = [];
  const readAll = (reader) => new Promise((res, rej) => {
    const acc = [];
    const next = () => reader.readEntries((batch) => { if (!batch.length) res(acc); else { acc.push(...batch); next(); } }, rej);
    next();
  });
  const walk = async (entry) => {
    if (!entry || out.length >= MAX_EXPANDED || JUNK.test(entry.name)) return;
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej));
      // Inside a dropped folder: the path from that folder on ("site/blog/index.html"), for tools that keep the structure.
      const path = (entry.fullPath || "").replace(/^\/+/, "");
      if (path.includes("/")) f.relativePath = path;
      out.push(f);
    } else if (entry.isDirectory) {
      const children = await readAll(entry.createReader());
      children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const c of children) await walk(c);
    }
  };
  return entries.reduce((p, e) => p.then(() => walk(e)), Promise.resolve()).then(() => out);
}

async function addFiles(incoming) {
  const tool = state.tool;
  if (!tool) return openFiles(incoming);
  if (state.busy) { toast("Wait for the job to finish, or cancel it, before adding files", "error"); return; }
  incoming = await expandFiles(incoming.map(typedFile), tool);
  if (state.tool !== tool || state.busy) return; // unpacking took a while and the user moved on
  const skipped = [];
  const accepted = incoming.map(typedFile).filter((f) => {
    const ok = accepts(tool, f);
    if (!ok) skipped.push(f.name);
    return ok;
  });
  if (skipped.length) {
    const names = skipped.slice(0, 2).join(", ") + (skipped.length > 2 ? ` +${skipped.length - 2}` : "");
    toast(tool.hint && !tool.filesOptional ? t("Skipped {names}. This tool takes: {what}", { names, what: t(tool.hint) }) : t("Skipped {names}: this tool does not take such files", { names }), "error");
  }
  if (!accepted.length) return;
  state.files = tool.multiple === false ? [accepted[0]] : [...state.files, ...accepted];
  state.results = [];
  refresh();
}

// Anywhere on the page is a drop target; the dashed box just shows where files go.
const dropOverlay = document.getElementById("dropOverlay");
// A drag that starts inside this page (a result on its way to a folder or a chat) carries a file as well, but it
// is not incoming: it gets a mark that only this page knows, so another FileForge window still takes the drop.
const OWN_DRAG = `application/x-fileforge-${Math.random().toString(36).slice(2)}`;
document.addEventListener("dragstart", (e) => { try { e.dataTransfer?.setData(OWN_DRAG, "1"); } catch (_) { /* ignore */ } }, true);
const draggingFiles = (e) => { const types = [...(e.dataTransfer?.types || [])]; return types.includes("Files") && !types.includes(OWN_DRAG); };
let dragDepth = 0;
document.addEventListener("dragenter", (e) => { if (!draggingFiles(e)) return; dragDepth++; dropOverlay.hidden = false; });
document.addEventListener("dragover", (e) => { if (!draggingFiles(e)) return; e.preventDefault(); ui.dropzone?.classList.add("over"); });
document.addEventListener("dragleave", (e) => { if (!draggingFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { dropOverlay.hidden = true; ui.dropzone?.classList.remove("over"); } });
document.addEventListener("drop", (e) => {
  if (!draggingFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; dropOverlay.hidden = true;
  ui.dropzone?.classList.remove("over");
  if (e.dataTransfer?.files?.length) filesFromDrop(e.dataTransfer).then(addFiles).catch((err) => toast(err.message, "error"));
});

// ---------- remembered options ----------
// Dropdowns, sliders, checkboxes, colours and numbers come back the way you left them (per tool, in this
// browser only). Free-text fields such as page ranges do not, unless the tool marks them data-remember.

const optionsKey = () => `fileforge.options.${state.tool.id}`;

function rememberable(input) {
  if (input.closest("[data-noremember]")) return false;
  if (input.tagName === "SELECT") return true;
  if (input.tagName !== "INPUT") return false;
  if (["range", "checkbox", "color", "number"].includes(input.type)) return true;
  return input.type === "text" && input.hasAttribute("data-remember");
}

function optionName(input) {
  const label = input.closest(".field")?.querySelector(".field-label") || input.closest("label.check")?.querySelector("span");
  const key = label?.dataset.key || label?.textContent;
  return key ? `${input.tagName.toLowerCase()}:${key}` : null;
}

function saveOptions() {
  if (!state.tool) return;
  const out = {};
  for (const input of ui.options.querySelectorAll("input, select")) {
    if (!rememberable(input)) continue;
    const k = optionName(input);
    if (k) out[k] = input.type === "checkbox" ? input.checked : input.value;
  }
  try { localStorage.setItem(optionsKey(), JSON.stringify(out)); } catch (_) { /* private mode */ }
}

function restoreOptions() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(optionsKey()) || "null"); } catch (_) { return; }
  if (!saved) return;
  for (const input of ui.options.querySelectorAll("input, select")) {
    if (!rememberable(input)) continue;
    const k = optionName(input);
    if (!k || !(k in saved)) continue;
    if (input.type === "checkbox") input.checked = !!saved[k]; else input.value = saved[k];
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  ui.options.append(el("button", { class: "link small", type: "button", text: "Reset options to defaults", onclick: () => {
    if (state.busy) return; // the running job is reading these very fields
    try { localStorage.removeItem(optionsKey()); } catch (_) { /* ignore */ }
    refresh({ fresh: true });
  } }));
}

// The options are rebuilt whenever the file list changes. Dropdowns and numbers come back from the remembered
// options; a text the user typed into a field that is not remembered (a rename pattern, find and replace, page
// ranges, a start time) would be gone. For tools that take many files those fields are carried over: only the
// ones really typed in, so a default that follows the files still follows them. Not for one-file tools (a new
// file there is a new job) and not where the tool keeps its own state (data-noremember on the whole panel).
const isTypedField = (input) => (input.type === "text" || input.type === "number") && !rememberable(input);
function typedFields() {
  const seen = new Map(), out = [];
  for (const input of ui.options.querySelectorAll("input")) {
    if (!isTypedField(input)) continue;
    const name = optionName(input);
    if (!name) continue;
    const nth = seen.get(name) || 0;
    seen.set(name, nth + 1);
    out.push({ input, key: `${name}#${nth}` });
  }
  return out;
}
function typedOptions() {
  if (!state.tool || state.tool.multiple === false || ui.options.hasAttribute("data-noremember")) return new Map();
  return new Map(typedFields().filter((x) => x.input.dataset.edited).map((x) => [x.key, x.input.value]));
}
function retypeOptions(kept) {
  if (!kept.size) return;
  for (const { input, key } of typedFields()) {
    if (!kept.has(key)) continue;
    input.value = kept.get(key);
    input.dataset.edited = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/** After the file list was rebuilt: the focus goes back to the same button of row `i` (or one that is enabled). */
function focusRow(i, act) {
  const row = ui.fileList.querySelectorAll("li")[i];
  if (!row) { ui.dropzone?.focus(); return; }
  (row.querySelector(`[data-act="${act}"]:not(:disabled)`) || row.querySelector("[data-act]:not(:disabled)"))?.focus();
}

/** Redraw the file list, the options and the results. `fresh`: the options start over (Clear, Reset). */
function refresh({ fresh = false } = {}) {
  const tool = state.tool;
  const hasFiles = state.files.length > 0;
  ui.dropzone?.classList.toggle("compact", hasFiles); // the big target has done its job; leave a slim "add more" bar
  ui.fileList.replaceChildren();
  if (hasFiles) {
    const orderable = tool.orderable && state.files.length > 1;
    const list = el("ul", { class: `files${orderable ? " orderable" : ""}` });
    let dragFrom = null;
    state.files.forEach((f, i) => {
      const thumb = thumbFor(f);
      const info = el("span", { class: "file-info" });
      preview(f).then((p) => { info.textContent = p.info; });
      const acts = el("span", { class: "file-actions" });
      const row = el("li", { draggable: orderable ? "true" : null, "data-index": String(i) }, [
        orderable ? el("span", { class: "grip", title: "Drag to reorder", text: "⋮⋮" }) : null,
        thumb,
        el("span", { class: "file-text" }, [
          el("span", { class: "file-name", text: f.name, title: f.name }),
          el("span", { class: "file-meta" }, [el("span", { class: "file-size", text: formatBytes(f.size) }), info]),
        ]),
        acts,
      ]);
      if (orderable) {
        acts.append(
          el("button", { class: "icon", type: "button", title: "Move up", text: "↑", "data-act": "up", disabled: i === 0, onclick: () => move(i, -1) }),
          el("button", { class: "icon", type: "button", title: "Move down", text: "↓", "data-act": "down", disabled: i === state.files.length - 1, onclick: () => move(i, 1) }),
        );
        row.addEventListener("dragstart", (e) => { dragFrom = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); row.classList.add("dragging"); });
        row.addEventListener("dragend", () => { row.classList.remove("dragging"); list.querySelectorAll(".drop-before, .drop-after").forEach((n) => n.classList.remove("drop-before", "drop-after")); });
        row.addEventListener("dragover", (e) => {
          if (dragFrom === null) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "move";
          const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
          row.classList.toggle("drop-after", after); row.classList.toggle("drop-before", !after);
        });
        row.addEventListener("drop", (e) => {
          if (dragFrom === null) return;
          e.preventDefault(); e.stopPropagation();
          const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
          const [item] = state.files.splice(dragFrom, 1);
          let to = i + (after ? 1 : 0);
          if (dragFrom < to) to--;
          state.files.splice(to, 0, item);
          dragFrom = null; state.results = []; refresh();
        });
      }
      acts.append(el("button", { class: "icon", type: "button", title: "Remove", "aria-label": "Remove", "data-act": "remove", onclick: () => { state.files.splice(i, 1); state.results = []; refresh(); focusRow(Math.min(i, state.files.length - 1), "remove"); } }, [icon("close", 14)]));
      list.append(row);
    });
    // A long list scrolls inside its own box, under a line that says how much is in it.
    if (state.files.length > 8) {
      list.classList.add("long");
      ui.fileList.append(el("div", { class: "files-head stat", text: `${plural(state.files.length, "file")} · ${formatBytes(state.files.reduce((s, f) => s + f.size, 0))}` }));
    }
    ui.fileList.append(list);
    if (orderable) {
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
      ui.fileList.append(el("div", { class: "actions sort-row" }, [
        el("span", { class: "stat", text: "Drag rows to reorder, or" }),
        el("button", { type: "button", class: "small", text: "Sort by name", onclick: () => { state.files.sort((a, b) => collator.compare(a.name, b.name)); state.results = []; refresh(); } }),
        el("button", { type: "button", class: "small", text: "Sort by date", onclick: () => { state.files.sort((a, b) => a.lastModified - b.lastModified); state.results = []; refresh(); } }),
        el("button", { type: "button", class: "small", text: "Reverse", onclick: () => { state.files.reverse(); state.results = []; refresh(); } }),
      ]));
    }
  }
  const showControls = hasFiles || tool.filesOptional;
  ui.options.hidden = !showControls;
  ui.actions.hidden = !showControls;
  if (showControls) {
    const kept = fresh ? new Map() : typedOptions();
    ui.options.replaceChildren();
    try {
      tool.renderOptions(ui.options, state.files);
      restoreOptions();
      retypeOptions(kept);
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), "error");
    }
  }
  renderResults();
}

function kindIcon(f) {
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  if (/wordprocessingml|msword/.test(f.type)) return "word";
  if (/spreadsheet|ms-excel/.test(f.type)) return "excel-read";
  if (f.type === "application/pdf") return "pdf";
  if (f.type.startsWith("text/") || /json/.test(f.type)) return "text";
  return "file";
}

function move(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.files.length) return;
  [state.files[i], state.files[j]] = [state.files[j], state.files[i]];
  state.results = [];
  refresh();
  focusRow(j, delta < 0 ? "up" : "down");
}

const COPYABLE_TEXT = /^(text\/|application\/(json|manifest\+json|xml))/;

async function copyResult(r) {
  if (r.blob.type.startsWith("image/")) {
    // The clipboard takes PNG only; keep the promise inside the click so the user gesture still counts.
    const png = r.blob.type === "image/png" ? r.blob : (async () => {
      const bmp = await createImageBitmap(r.blob);
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0); bmp.close();
      return new Promise((res) => c.toBlob(res, "image/png"));
    })();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } else {
    await navigator.clipboard.writeText(await r.blob.text());
  }
  toast(t("Copied {name}", { name: r.name }));
}

const PREVIEWABLE = (r) => r.blob.type.startsWith("image/") || r.blob.type === "application/pdf" || COPYABLE_TEXT.test(r.blob.type);

async function saveToFolder(results) {
  const dir = await window.showDirectoryPicker({ mode: "readwrite", id: "fileforge-results" });
  const used = new Set();
  for (const r of results) {
    const dot = r.name.lastIndexOf("."), stem = dot > 0 ? r.name.slice(0, dot) : r.name, ext = dot > 0 ? r.name.slice(dot) : "";
    let name = r.name, k = 1;
    while (used.has(name.toLowerCase())) name = `${stem} (${++k})${ext}`;
    used.add(name.toLowerCase());
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(r.blob); await w.close();
  }
  toast(t("Saved {files} to {folder}", { files: plural(results.length, "file"), folder: dir.name }));
}

/** Two inputs with the same stem (photo.jpg, photo.png) must not both become photo.webp. */
function uniqueNames(results) {
  const seen = new Set();
  for (const r of results) {
    let name = r.name, k = 2;
    const dot = name.lastIndexOf("."), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
    while (seen.has(name.toLowerCase())) name = `${stem} (${k++})${ext}`;
    seen.add(name.toLowerCase()); r.name = name;
  }
  return results;
}

function renderResults() {
  ui.results.replaceChildren();
  ui.results.hidden = state.results.length === 0;
  if (!state.results.length) return;
  const total = state.results.reduce((s, r) => s + r.blob.size, 0), many = state.results.length > 1;
  // What the user came for goes first: with several results, "Download all" sits in the heading, not under a long list.
  const headActions = el("div", { class: "actions" });
  ui.results.append(el("div", { class: "results-head" }, [
    el("h2", {}, [
      icon("check", 18), el("span", { text: t("Done · {files}", { files: plural(state.results.length, "file") }) }),
      many ? el("span", { class: "stat", text: formatBytes(total) }) : null,
      state.saved ? el("span", { class: "saved-hint", text: "Saved to your downloads folder" }) : null,
    ]),
    headActions,
  ]));
  const list = el("ul", { class: "files results-list" });
  const canCopy = (r) => navigator.clipboard && ((r.blob.type.startsWith("image/") && "ClipboardItem" in window && r.blob.type !== "image/svg+xml") || COPYABLE_TEXT.test(r.blob.type));
  for (const r of state.results) {
    const asFile = r.blob instanceof File ? r.blob : new File([r.blob], r.name, { type: r.blob.type });
    const thumb = thumbFor(asFile, r.name);
    const row = el("li", { draggable: "true", title: t("Drag it out to a folder, a mail or a chat") });
    row.addEventListener("dragstart", (e) => {
      const url = URL.createObjectURL(asFile);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("DownloadURL", `${asFile.type || "application/octet-stream"}:${r.name.replace(/:/g, "-")}:${url}`);
      try { e.dataTransfer.items.add(asFile); } catch (_) { /* older browsers */ }
    });
    list.append(row);
    row.append(...[
      thumb,
      el("span", { class: "file-name", text: r.name, title: r.name }),
      el("span", { class: "file-size", text: formatBytes(r.blob.size) }),
      r.note ? el("span", { class: `file-note${/^[−-]\d/.test(r.note) ? " good" : ""}`, text: r.note }) : null,
      el("span", { class: "file-actions" }, [
        PREVIEWABLE(r) ? el("button", { type: "button", class: "icon", title: "Preview", "aria-label": "Preview", onclick: () => previewResult(r) }, [icon("eye", 16)]) : null,
        canCopy(r) ? el("button", { type: "button", class: "icon", title: "Copy to the clipboard", "aria-label": "Copy", onclick: () => copyResult(r).catch((err) => toast(t("Could not copy: {error}", { error: err.message }), "error")) }, [icon("copy", 16)]) : null,
        el("button", { type: "button", class: many ? "small dl" : "primary dl", onclick: () => download(r.blob, r.name) }, [icon("download", many ? 14 : 16), t(state.saved ? "Download again" : "Download")]),
      ]),
    ].filter(Boolean));
  }
  ui.results.append(list);
  const actions = el("div", { class: "actions" });
  if (many) {
    headActions.append(el("button", { class: "primary", type: "button", onclick: async () => {
      try { download(await zipFiles(state.results), `fileforge-${state.tool.id}.zip`); }
      catch (err) { toast(err.message, "error"); }
    } }, [icon("download", 16), t("Download all (.zip)")]));
    // Chromium only: write every result straight into a folder the user picks, no archive to unpack.
    if ("showDirectoryPicker" in window) headActions.append(el("button", { type: "button", onclick: () => saveToFolder(state.results).catch((err) => { if (err.name !== "AbortError") toast(err.message, "error"); }) }, [icon("file", 16), t("Save all to a folder…")]));
  }
  // Hand the results to another tool (crop → compress → watermark) without downloading and re-dropping them.
  const asFiles = state.results.map((r) => new File([r.blob], r.name, { type: r.blob.type || guessType(r.name), lastModified: Date.now() }));
  const next = tools.filter((x) => x.id !== state.tool.id && !x.filesOptional && asFiles.every((f) => accepts(x, f)) && (x.multiple !== false || asFiles.length === 1));
  if (next.length) {
    // The likeliest next step first (favourites, recent, popular), not whatever comes first in the catalogue.
    const liked = [...favIds(), ...recentIds(), ...POPULAR];
    const rank = (x) => { const i = liked.indexOf(x.id); return i < 0 ? liked.length : i; };
    next.sort((a, b) => rank(a) - rank(b));
    const pick = el("select", { "aria-label": "Continue in" }, next.map((x) => el("option", { value: x.id, text: x.title })));
    actions.append(el("span", { class: "stat", text: "Continue in" }), pick, el("button", { type: "button", text: "Open", class: "continue", onclick: () => {
      const files = asFiles;
      state.files = []; // the results replace the inputs
      history.replaceState(null, "", `${location.pathname}${location.search}#${pick.value}`);
      mount();
      addFiles(files);
    } }));
  }
  if (actions.childElementCount) ui.results.append(actions);
}

// ---------- progress ----------
// Tools call `await progress.tick(name)` once per file (or page): it updates the bar, lets the page repaint
// and throws when the user pressed Cancel.

function makeProgress() {
  const ctrl = new AbortController();
  // This job's own bar: `ui.progress` belongs to another tool once the user has moved on.
  const box = ui.progress;
  const bar = box.querySelector(".progress-bar");
  const text = box.querySelector(".progress-text");
  return {
    signal: ctrl.signal, done: 0, total: 0,
    start(total) { this.total = total; this.done = 0; bar.style.width = "0%"; text.textContent = ""; box.hidden = total < 2; },
    async tick(name) {
      if (ctrl.signal.aborted) throw new Error("Cancelled");
      const pct = this.total ? Math.round((this.done / this.total) * 100) : 0;
      bar.style.width = `${pct}%`;
      box.setAttribute("aria-valuenow", String(pct));
      text.textContent = `${this.done + 1} / ${this.total}${name ? ` · ${name}` : ""}`;
      this.done++;
      await new Promise((r) => setTimeout(r, 0));
    },
    /** Detail inside one long step (the percent of a big file); Cancel stops it here too. */
    note(detail) { if (ctrl.signal.aborted) throw new Error("Cancelled"); text.textContent = detail; },
    cancel() { ctrl.abort(); box.hidden = false; text.textContent = t("Cancelling…"); },
  };
}

/** While a job runs, the file list and the drop target are frozen: the tool is working through that very list. */
function lockInputs() {
  for (const n of [ui.fileList, ui.dropzone]) {
    if (!n) continue;
    n.inert = state.busy;
    n.style.opacity = state.busy ? "0.6" : "";
  }
}

function finishRun() {
  state.busy = false;
  state.progress = null;
  if (ui.runBtn) {
    ui.runBtn.disabled = false;
    ui.runBtn.textContent = state.runLabel;
    ui.cancelBtn.hidden = true;
    ui.progress.hidden = true;
  }
  lockInputs();
}

/** Stop the running job, if any, and disown it: it ends at its next step and whatever it returns is ignored.
 *  Called when its tool is left (another tool, the home page) or its files are cleared. */
function stopRun() {
  if (!state.busy) return;
  state.progress?.cancel();
  state.runId++;
  finishRun();
  toast("Cancelled");
}

async function run() {
  if (state.busy || !state.tool) return;
  const tool = state.tool;
  if (!state.files.length && !tool.filesOptional) return;
  const id = ++state.runId;
  state.busy = true;
  ui.runBtn.disabled = true;
  state.runLabel = ui.runBtn.textContent;
  ui.runBtn.textContent = t("Working…");
  const progress = makeProgress();
  state.progress = progress;
  progress.start(state.files.length);
  ui.cancelBtn.hidden = false; // one file can be a long job too: a 300-page PDF, a video
  lockInputs();
  try {
    // A copy of the list: nothing that happens to it meanwhile reaches the job.
    const results = await tool.run([...state.files], ui.options, progress);
    if (id !== state.runId) return; // stopped meanwhile: these results are nobody's
    if (progress.signal.aborted) throw new Error("Cancelled"); // Cancel was pressed during the last step
    state.results = uniqueNames(results || []);
    state.saved = state.results.length === 1 && !tool.noAutoDownload && settings.autoDownload;
    renderResults();
    if (state.results.length) {
      ui.results.scrollIntoView({ behavior: "smooth", block: "start" });
      if (state.saved) download(state.results[0].blob, state.results[0].name);
    }
  } catch (err) {
    if (id !== state.runId) return;
    if (err.message === "Cancelled") toast("Cancelled");
    else { console.error(err); toast(err.message || String(err), "error"); }
  } finally {
    if (id === state.runId) finishRun();
  }
}

export function toolFor(file) {
  const ty = file.type;
  if (ty === "application/pdf") return "pdf-split";
  if (ty === "image/heic" || ty === "image/heif") return "heic";
  if (ty.startsWith("video/")) return "video-gif";
  if (ty.startsWith("audio/")) return "audio-extract";
  if (/wordprocessingml/.test(ty)) return "word";
  if (/spreadsheet|ms-excel/.test(ty)) return "excel-read";
  if (/zip/.test(ty)) return "zip-extract";
  if (ty.startsWith("image/")) return "crop";
  if (/json/.test(ty)) return "json-format";
  if (/csv|tab-separated/.test(ty)) return "csv-json";
  if (/markdown|plain/.test(ty)) return "md-to-pdf";
  return null;
}

/** The tools that can open these files, most likely first: the default for the type, favourites, recent, the rest. */
function toolsFor(files) {
  let list = tools.filter((x) => files.every((f) => accepts(x, f)) && (x.multiple !== false || files.length === 1));
  // A mixed drop no tool takes whole: offer what opens the first file; the tool says which files it skipped.
  if (!list.length) list = tools.filter((x) => accepts(x, files[0]));
  // Several files rule out the one-file default (Crop, Split): suggest what people do with a batch instead.
  let suggested = toolFor(files[0]);
  if (!list.some((x) => x.id === suggested)) suggested = { crop: "compress", "pdf-split": "pdf-merge" }[suggested] || suggested;
  const first = [suggested, ...favIds().filter((id) => id !== suggested), ...recentIds().filter((id) => id !== suggested)];
  // Tools that take any file at all (hashes, Base64, rename) go last unless they are a favourite or recent.
  const rank = (x) => { const i = first.indexOf(x.id); return i >= 0 ? i : first.length + (x.accept && x.accept !== "*/*" ? 0 : 1); };
  return list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((o) => o.x);
}

function openWith(id, files) {
  // A new history entry: Back returns to the page the files were dropped on instead of leaving the app.
  if (id !== state.tool?.id) { history.pushState(null, "", `${location.pathname}${location.search}#${id}`); mount(); }
  addFiles(files);
}

/** Files that arrived with no tool open (dropped on the home page, "Open with"): ask which tool should take them. */
async function openFiles(files) {
  files = await expandFiles(files.map(typedFile), null);
  if (!files.length) return;
  const list = toolsFor(files);
  if (!list.length) { toast(t("No tool takes {name}", { name: files[0].name }), "error"); return; }
  if (list.length === 1 || palette.open) { if (palette.open) palette.close(); openWith(list[0].id, files); return; }
  openPalette({ files, tools: list });
}

async function loadFromSrc() {
  const params = new URLSearchParams(location.search);
  const src = params.get("src");
  if (params.get("note") === "embedded") toast("That image is embedded in the page and could not be read. Save it and drop it here instead.", "error");
  if (params.get("note") === "shot") toast("This page cannot be captured. Browser pages (settings, the extension store, the new tab page) are off limits to extensions.", "error");
  // Text handed over by the extension (a page address for the QR tool): into the tool's first text box.
  const text = params.get("text");
  if (text) {
    const box = ui.options?.querySelector("textarea, input[type=text]");
    if (box) { box.value = text; box.dispatchEvent(new Event("input", { bubbles: true })); }
  }
  // Shown or taken once: none of it belongs in the address, where a reload would repeat it.
  if (src || text || params.has("note")) history.replaceState(null, "", location.pathname + (sideView ? "?view=side" : "") + location.hash);
  if (!src) return;
  try {
    let url = src, name = "file";
    if (src.startsWith("handoff:")) {
      // The extension's background script fetched an embedded (data:/blob:) image and holds it for us.
      const got = await ext.runtime.sendMessage({ type: "fileforge-pull", id: src.slice(8) });
      if (!got) throw new Error("nothing pending");
      url = got.dataUrl; name = got.name || name;
    } else {
      name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "file") || "file";
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const type = blob.type && blob.type !== "application/octet-stream" ? blob.type : guessType(name);
    addFiles([new File([blob], name.includes(".") ? name : `${name}.${type.split("/")[1]?.replace("jpeg", "jpg") || "bin"}`, { type })]);
  } catch (err) {
    toast("Could not load that file automatically. Save it and drop it here instead.", "error");
  }
}

// The web build (GitHub Pages) works offline through a service worker; the extension needs none.
if (document.documentElement.dataset.site && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
// Installed as an app, FileForge is an "Open with" target for images, PDFs and text files (file_handlers in the manifest).
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async (launch) => {
    const files = await Promise.all((launch.files || []).map((h) => h.getFile()));
    openFiles(files);
  });
}

window.addEventListener("hashchange", mount);
window.addEventListener("paste", (e) => {
  if (inField(e) && !state.tool?.accept?.startsWith("image/")) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});
window.addEventListener("beforeunload", (e) => { if (settings.confirmLeave && state.files.length && !sideView) { e.preventDefault(); e.returnValue = ""; } });
// "Skip to the tool" moves the focus; as a plain #main link it would count as a tool that does not exist.
document.querySelector(".skip-link")?.addEventListener("click", (e) => { e.preventDefault(); main.focus(); });
// A link with ?tool=crop (how the extension opens the app) becomes #crop: the address then follows the tool like any
// other, and "All tools" really leads home.
{
  const params = new URLSearchParams(location.search);
  const tool = params.get("tool");
  if (tool) {
    params.delete("tool");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + (location.hash || `#${tool}`));
  }
}
mount();
loadFromSrc();

// In the side panel the background script hands over context-menu requests ("Edit image in FileForge") instead of
// opening a tab: one waits in `pending` while the panel loads, later ones arrive as messages.
let panelWindow = null; // the window this panel is in, once the background script has said so
let lastRequest = null;
const forThisPanel = (req) => req?.windowId == null || panelWindow == null || req.windowId === panelWindow;
function openRequested(req) {
  if (!req?.tool || !forThisPanel(req)) return;
  if (req.id && req.id === lastRequest) return; // the same request arriving a second way
  lastRequest = req.id || null;
  const p = new URLSearchParams(req.params || {});
  p.set("view", "side");
  history.replaceState(null, "", `${location.pathname}?${p}#${req.tool}`);
  state.files = [];
  mount();
  loadFromSrc();
}
if (isExtension && sideView) {
  (async () => {
    // First what was waiting while the panel loaded (with it comes the id of this panel's window), then messages.
    let first = null;
    try { first = await ext.runtime.sendMessage({ type: "fileforge-pending" }); } catch (_) { /* nobody answered */ }
    panelWindow = first?.windowId ?? null;
    // Firefox has no such answer, but there a sidebar's "current window" is its own (in Chrome it is the last focused one).
    if (panelWindow == null && ext.sidebarAction) { try { panelWindow = (await ext.windows.getCurrent()).id; } catch (_) { /* take every request */ } }
    ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type !== "fileforge-open" || !forThisPanel(msg)) return; // not ours: leave it unanswered
      openRequested(msg);
      sendResponse(true);
    });
    openRequested(first?.open);
  })();
}
