import { el, formatBytes, download, zipFiles, toast, withType, guessType, plural, t } from "./util.js";
import { initLang, setLang, getLang, LANGS } from "./i18n.js";
import { icon } from "./icons.js";
import { createSearch } from "./search.js";
import { imageTools } from "./tools/image.js";
import { photoTools } from "./tools/photo.js";
import { ocrTools } from "./tools/ocr.js";
import { pdfTools, renderPdfPages } from "./tools/pdf.js";
import { pdfMoreTools } from "./tools/pdf-more.js";
import { markdownTools } from "./tools/markdown.js";
import { dataTools } from "./tools/data.js";
import { textTools } from "./tools/text.js";
import { pipelineTool } from "./tools/pipeline.js";
import { fileTools } from "./tools/files.js";
import { thumbnail, preview } from "./thumbs.js";
import { isHeic, toBrowserImage } from "./heic.js";

await initLang();
for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n);
for (const n of document.querySelectorAll("[data-i18n-placeholder]")) n.placeholder = t(n.dataset.i18nPlaceholder);
for (const n of document.querySelectorAll("[aria-label]")) n.setAttribute("aria-label", t(n.getAttribute("aria-label")));

const groups = [
  { id: "images", title: "Images", icon: "image", tools: [...imageTools.slice(0, 1), ...photoTools, ...ocrTools, ...imageTools.slice(1)] },
  { id: "pdf", title: "PDF", icon: "pdf", tools: [...pdfTools, ...pdfMoreTools] },
  { id: "text", title: "Text & data", icon: "text", tools: [...markdownTools, ...dataTools, ...textTools] },
  { id: "files", title: "Files", icon: "file", tools: fileTools },
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

const state = { tool: null, files: [], results: [], busy: false, progress: null };
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
  if (state.tool) paintFav(); else renderHome();
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
function renderNav() {
  navList.replaceChildren();
  navSelect.replaceChildren(el("option", { value: "home", text: "All tools", selected: !state.tool }));
  const q = navFilter.value.trim();
  const shown = new Set(searchTools(q).map((x) => x.id));
  const favs = favIds().map((id) => tools.find((x) => x.id === id)).filter((x) => shown.has(x.id));
  if (favs.length) {
    navList.append(el("div", { class: "nav-group", text: "Favourites" }));
    for (const tool of favs) navList.append(navLink(tool));
  }
  for (const g of groups) {
    const items = g.tools.filter((x) => shown.has(x.id));
    if (!items.length) continue;
    navList.append(el("div", { class: "nav-group", text: g.title }));
    for (const tool of items) navList.append(navLink(tool));
    const optgroup = el("optgroup", { label: t(g.title) });
    for (const tool of g.tools) optgroup.append(el("option", { value: tool.id, text: tool.title, selected: state.tool?.id === tool.id }));
    navSelect.append(optgroup);
  }
  if (!shown.size) navList.append(el("div", { class: "nav-empty", text: "No tool matches" }));
  nav.querySelector(".nav-home")?.classList.toggle("active", !state.tool);
}
navSelect.addEventListener("change", () => { location.hash = navSelect.value === "home" ? "" : `#${navSelect.value}`; });
navFilter.addEventListener("input", renderNav);
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
  const hits = paletteFiles
    ? (q.trim() ? searchTools(q).filter((x) => paletteFiles.tools.includes(x)) : paletteFiles.tools)
    : searchTools(q).slice(0, 12);
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
  if (!hits.length) paletteList.append(el("div", { class: "palette-empty", text: "No tool matches" }));
}
paletteInput.addEventListener("input", () => { paletteIndex = 0; renderPalette(); });
paletteInput.addEventListener("keydown", (e) => {
  const items = paletteList.querySelectorAll(".palette-item");
  if (e.key === "ArrowDown") { e.preventDefault(); paletteIndex = (paletteIndex + 1) % Math.max(1, items.length); renderPalette(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); paletteIndex = (paletteIndex - 1 + items.length) % Math.max(1, items.length); renderPalette(); }
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
function requestedToolId() {
  const hash = location.hash.replace(/^#/, "");
  if (hash) return hash;
  return new URLSearchParams(location.search).get("tool") || "home";
}

function toolCard(tool) {
  return el("a", { class: "tool-card", href: `#${tool.id}`, "data-id": tool.id }, [
    el("span", { class: "tool-card-icon" }, [icon(tool.icon || tool.id, 22)]),
    el("span", { class: "tool-card-text" }, [el("strong", { text: tool.title }), el("span", { text: tool.description })]),
    favButton(tool),
  ]);
}

function renderHome() {
  state.tool = null;
  state.results = [];
  document.title = "FileForge";
  renderNav();
  const search = el("button", { type: "button", class: "home-search", onclick: () => openPalette() }, [icon("search"), el("span", { text: "Search 50+ tools…" }), el("kbd", { text: `${MOD} K` })]);
  const fileInput = el("input", { type: "file", hidden: true, multiple: true, onchange: () => { openFiles([...fileInput.files]); fileInput.value = ""; } });
  const drop = el("section", { class: "dropzone home-drop", tabindex: "0", role: "button", "aria-label": "Choose files" }, [
    fileInput,
    el("div", { class: "dz-inner" }, [
      icon("upload", 28),
      el("div", {}, [el("strong", { text: "Drop any file here" }), " ", t("or"), " ", el("button", { class: "link", type: "button", text: "choose files", onclick: () => fileInput.click() })]),
      el("div", { class: "dz-hint", text: "FileForge shows the tools that can open it: pick one, or press Enter for the suggested one" }),
    ]),
  ]);
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  ui.dropzone = drop;
  const recent = recentIds().map((id) => tools.find((x) => x.id === id));
  const favs = favIds().map((id) => tools.find((x) => x.id === id));
  const sections = groups.map((g) => el("section", { class: "home-group" }, [
    el("h2", {}, [icon(g.icon, 18), el("span", { text: g.title }), el("span", { class: "count", text: String(g.tools.length) })]),
    el("div", { class: "tool-grid" }, g.tools.map(toolCard)),
  ]));
  main.replaceChildren(...[
    el("section", { class: "hero" }, [
      el("h1", { text: "Every file job, done on your device" }),
      el("p", { text: "Images, PDFs and text: crop, compress, convert, merge, split, redact, watermark and more. Nothing is uploaded, it works offline, and it stays free." }),
      search,
    ]),
    drop,
    favs.length ? el("section", { class: "home-group" }, [el("h2", {}, [icon("star", 18), el("span", { text: "Favourites" })]), el("div", { class: "chips" }, favs.map((tool) => el("a", { class: "chip", href: `#${tool.id}` }, [icon(tool.icon || tool.id, 16), el("span", { text: tool.title })])))]) : null,
    recent.length ? el("section", { class: "home-group" }, [el("h2", {}, [icon("zap", 18), el("span", { text: "Recent" })]), el("div", { class: "chips" }, recent.map((tool) => el("a", { class: "chip", href: `#${tool.id}` }, [icon(tool.icon || tool.id, 16), el("span", { text: tool.title })])))]) : null,
    ...sections,
    el("footer", { class: "home-foot" }, [
      el("span", {}, [icon("shield", 16), " ", t("Private by design: no server, no account, no analytics.")]),
      el("span", {}, [icon("wifi_off", 16), " ", t("Works offline once loaded.")]),
      el("span", { text: VERSION ? `v${VERSION}` : "" }),
    ]),
  ].filter(Boolean));
  window.scrollTo(0, 0);
}

// ---------- tool view ----------
function mount() {
  const id = requestedToolId();
  const tool = tools.find((x) => x.id === id);
  if (!tool) { if (id !== "home") history.replaceState(null, "", location.pathname + location.search); state.files = []; renderHome(); return; }
  state.tool = tool;
  noteRecent(tool.id);
  // Files stay loaded when switching to another tool that takes them (e.g. crop → compress).
  state.files = state.files.filter((f) => accepts(tool, f));
  if (tool.multiple === false) state.files = state.files.slice(0, 1);
  state.results = [];
  state.busy = false;
  document.title = `${t(tool.title)} · FileForge`;
  renderNav();

  const many = tool.multiple !== false;
  const fileInput = el("input", {
    type: "file", id: "fileInput", hidden: true,
    // A ZIP can be picked too: addFiles unpacks it.
    multiple: many, accept: tool.accept && many ? `${tool.accept},.zip` : tool.accept || "",
    onchange: () => { addFiles([...fileInput.files]); fileInput.value = ""; },
  });
  const folderInput = many ? el("input", {
    type: "file", hidden: true, webkitdirectory: "", multiple: true,
    onchange: () => { addFiles([...folderInput.files].filter((f) => !JUNK.test(f.webkitRelativePath || f.name))); folderInput.value = ""; },
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
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  ui.dropzone = dropzone;

  ui.fileList = el("section", { class: "file-list" });
  ui.options = el("section", { class: "options card", hidden: !tool.filesOptional });
  ui.options.addEventListener("change", saveOptions);
  ui.options.addEventListener("input", saveOptions);
  ui.runBtn = el("button", { class: "primary", type: "button", text: tool.runLabel || "Run", title: `${MOD} Enter`, onclick: run });
  ui.cancelBtn = el("button", { type: "button", text: "Cancel", hidden: true, onclick: () => state.progress?.cancel() });
  ui.progress = el("div", { class: "progress", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, [el("div", { class: "progress-bar" }), el("span", { class: "progress-text" })]);
  ui.actions = el("section", { class: "actions run-row", hidden: !tool.filesOptional }, [
    ui.runBtn,
    el("button", { type: "button", text: "Clear", onclick: () => { state.files = []; state.results = []; refresh(); } }),
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

async function unzip(file) {
  const zip = await JSZip.loadAsync(file);
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

/** Folders (as drop entries) and ZIPs become the files inside them; ZIPs are kept as is for a tool that takes ZIPs. */
async function expandFiles(files, tool = state.tool) {
  const out = [];
  for (const f of files) {
    if (isZip(f) && !(tool && /zip/.test(tool.accept || ""))) {
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
    if (entry.isFile) out.push(await new Promise((res, rej) => entry.file(res, rej)));
    else if (entry.isDirectory) {
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
  incoming = await expandFiles(incoming.map(withType), tool);
  const skipped = [];
  const accepted = incoming.map(withType).filter((f) => {
    const ok = accepts(tool, f);
    if (!ok) skipped.push(f.name);
    return ok;
  });
  if (skipped.length === 1) toast(t("Skipped {name}: not a supported file type for this tool", { name: skipped[0] }), "error");
  else if (skipped.length > 1) toast(t("Skipped {files} this tool does not take", { files: plural(skipped.length, "file") }), "error");
  if (!accepted.length) return;
  state.files = tool.multiple === false ? [accepted[0]] : [...state.files, ...accepted];
  state.results = [];
  refresh();
}

// Anywhere on the page is a drop target; the dashed box just shows where files go.
const dropOverlay = document.getElementById("dropOverlay");
const draggingFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
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
    try { localStorage.removeItem(optionsKey()); } catch (_) { /* ignore */ }
    refresh();
  } }));
}

function refresh() {
  const tool = state.tool;
  const hasFiles = state.files.length > 0;
  ui.fileList.replaceChildren();
  if (hasFiles) {
    const orderable = tool.orderable && state.files.length > 1;
    const list = el("ul", { class: `files${orderable ? " orderable" : ""}` });
    let dragFrom = null;
    state.files.forEach((f, i) => {
      const thumb = thumbFor(f);
      const info = el("span", { class: "file-info" });
      preview(f).then((p) => { info.textContent = p.info; });
      const row = el("li", { draggable: orderable ? "true" : null, "data-index": String(i) }, [
        orderable ? el("span", { class: "grip", title: "Drag to reorder", text: "⋮⋮" }) : null,
        thumb,
        el("span", { class: "file-name", text: f.name, title: f.name }),
        info,
        el("span", { class: "file-size", text: formatBytes(f.size) }),
      ]);
      if (orderable) {
        row.append(
          el("button", { class: "icon", type: "button", title: "Move up", text: "↑", disabled: i === 0, onclick: () => move(i, -1) }),
          el("button", { class: "icon", type: "button", title: "Move down", text: "↓", disabled: i === state.files.length - 1, onclick: () => move(i, 1) }),
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
      row.append(el("button", { class: "icon", type: "button", title: "Remove", "aria-label": "Remove", onclick: () => { state.files.splice(i, 1); state.results = []; refresh(); } }, [icon("close", 14)]));
      list.append(row);
    });
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
    ui.options.replaceChildren();
    try {
      tool.renderOptions(ui.options, state.files);
      restoreOptions();
    } catch (err) {
      console.error(err);
      toast(err.message || String(err), "error");
    }
  }
  renderResults();
}

function kindIcon(f) {
  if (f.type.startsWith("image/")) return "image";
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

function renderResults() {
  ui.results.replaceChildren();
  ui.results.hidden = state.results.length === 0;
  if (!state.results.length) return;
  const total = state.results.reduce((s, r) => s + r.blob.size, 0);
  ui.results.append(el("h2", {}, [icon("check", 18), el("span", { text: t("Done · {files}", { files: plural(state.results.length, "file") }) }), el("span", { class: "stat", text: formatBytes(total) })]));
  const list = el("ul", { class: "files results-list" });
  const canCopy = (r) => navigator.clipboard && ((r.blob.type.startsWith("image/") && "ClipboardItem" in window && r.blob.type !== "image/svg+xml") || COPYABLE_TEXT.test(r.blob.type));
  for (const r of state.results) {
    const asFile = r.blob instanceof File ? r.blob : new File([r.blob], r.name, { type: r.blob.type });
    const thumb = thumbFor(asFile, r.name);
    list.append(el("li", {}, [
      thumb,
      el("span", { class: "file-name", text: r.name, title: r.name }),
      el("span", { class: "file-size", text: formatBytes(r.blob.size) }),
      r.note ? el("span", { class: "file-note", text: r.note }) : null,
      el("span", { class: "file-actions" }, [
        PREVIEWABLE(r) ? el("button", { type: "button", class: "icon", title: "Preview", "aria-label": "Preview", onclick: () => previewResult(r) }, [icon("eye", 16)]) : null,
        canCopy(r) ? el("button", { type: "button", class: "icon", title: "Copy to the clipboard", "aria-label": "Copy", onclick: () => copyResult(r).catch((err) => toast(t("Could not copy: {error}", { error: err.message }), "error")) }, [icon("copy", 16)]) : null,
        el("button", { type: "button", class: "small", onclick: () => download(r.blob, r.name) }, [icon("download", 14), t("Download")]),
      ]),
    ]));
  }
  ui.results.append(list);
  const actions = el("div", { class: "actions" });
  if (state.results.length > 1) {
    actions.append(el("button", { class: "primary", type: "button", onclick: async () => {
      try { download(await zipFiles(state.results), `fileforge-${state.tool.id}.zip`); }
      catch (err) { toast(err.message, "error"); }
    } }, [icon("download", 16), t("Download all (.zip)")]));
    // Chromium only: write every result straight into a folder the user picks, no archive to unpack.
    if ("showDirectoryPicker" in window) actions.append(el("button", { type: "button", onclick: () => saveToFolder(state.results).catch((err) => { if (err.name !== "AbortError") toast(err.message, "error"); }) }, [icon("file", 16), t("Save all to a folder…")]));
  }
  // Hand the results to another tool (crop → compress → watermark) without downloading and re-dropping them.
  const asFiles = state.results.map((r) => new File([r.blob], r.name, { type: r.blob.type || guessType(r.name), lastModified: Date.now() }));
  const next = tools.filter((x) => x.id !== state.tool.id && !x.filesOptional && asFiles.every((f) => accepts(x, f)) && (x.multiple !== false || asFiles.length === 1));
  if (next.length) {
    const pick = el("select", { "aria-label": "Continue with" }, next.map((x) => el("option", { value: x.id, text: x.title })));
    actions.append(el("span", { class: "stat", text: "Continue with" }), pick, el("button", { type: "button", text: "Open", class: "continue", onclick: () => {
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
  const bar = ui.progress.querySelector(".progress-bar");
  const text = ui.progress.querySelector(".progress-text");
  return {
    signal: ctrl.signal, done: 0, total: 0,
    start(total) { this.total = total; this.done = 0; bar.style.width = "0%"; text.textContent = ""; ui.progress.hidden = total < 2; },
    async tick(name) {
      if (ctrl.signal.aborted) throw new Error("Cancelled");
      const pct = this.total ? Math.round((this.done / this.total) * 100) : 0;
      bar.style.width = `${pct}%`;
      ui.progress.setAttribute("aria-valuenow", String(pct));
      text.textContent = `${this.done + 1} / ${this.total}${name ? ` · ${name}` : ""}`;
      this.done++;
      await new Promise((r) => setTimeout(r, 0));
    },
    cancel() { ctrl.abort(); text.textContent = t("Cancelling…"); },
  };
}

async function run() {
  if (state.busy || !state.tool) return;
  const tool = state.tool;
  if (!state.files.length && !tool.filesOptional) return;
  state.busy = true;
  ui.runBtn.disabled = true;
  const label = ui.runBtn.textContent;
  ui.runBtn.textContent = t("Working…");
  const progress = makeProgress();
  state.progress = progress;
  progress.start(state.files.length);
  ui.cancelBtn.hidden = state.files.length < 2;
  try {
    const results = await tool.run(state.files, ui.options, progress);
    state.results = results || [];
    renderResults();
    if (state.results.length) {
      ui.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (state.results.length === 1 && !tool.noAutoDownload && settings.autoDownload) download(state.results[0].blob, state.results[0].name);
    }
  } catch (err) {
    if (err.message === "Cancelled") toast("Cancelled");
    else { console.error(err); toast(err.message || String(err), "error"); }
  } finally {
    state.busy = false;
    state.progress = null;
    ui.runBtn.disabled = false;
    ui.runBtn.textContent = label;
    ui.cancelBtn.hidden = true;
    ui.progress.hidden = true;
  }
}

export function toolFor(file) {
  const ty = file.type;
  if (ty === "application/pdf") return "pdf-split";
  if (ty === "image/heic" || ty === "image/heif") return "heic";
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
  if (id !== state.tool?.id) { history.replaceState(null, "", `${location.pathname}${location.search}#${id}`); mount(); }
  addFiles(files);
}

/** Files that arrived with no tool open (dropped on the home page, "Open with"): ask which tool should take them. */
async function openFiles(files) {
  files = await expandFiles(files.map(withType), null);
  if (!files.length) return;
  const list = toolsFor(files);
  if (!list.length) { toast(t("No tool takes {name}", { name: files[0].name }), "error"); return; }
  if (list.length === 1 || palette.open) { openWith(list[0].id, files); return; }
  openPalette({ files, tools: list });
}

async function loadFromSrc() {
  const params = new URLSearchParams(location.search);
  const src = params.get("src");
  if (params.get("note") === "embedded") toast("That image is embedded in the page and could not be read. Save it and drop it here instead.", "error");
  if (!src) return;
  history.replaceState(null, "", location.pathname + (sideView ? "?view=side" : "") + location.hash);
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
mount();
loadFromSrc();

// In the side panel the background script hands over context-menu requests ("Edit image in FileForge") instead of
// opening a tab: one waits in `pending` while the panel loads, later ones arrive as messages.
function openRequested(req) {
  if (!req?.tool) return;
  const p = new URLSearchParams(req.params || {});
  p.set("view", "side");
  history.replaceState(null, "", `${location.pathname}?${p}#${req.tool}`);
  state.files = [];
  mount();
  loadFromSrc();
}
if (isExtension && sideView) {
  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "fileforge-open") return;
    openRequested(msg);
    sendResponse(true);
  });
  Promise.resolve(ext.runtime.sendMessage({ type: "fileforge-pending" })).then(openRequested).catch(() => {});
}
