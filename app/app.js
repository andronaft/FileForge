import { el, formatBytes, download, zipFiles, toast, withType, guessType, plural } from "./util.js";
import { imageTools } from "./tools/image.js";
import { pdfTools } from "./tools/pdf.js";
import { markdownTools } from "./tools/markdown.js";
import { dataTools } from "./tools/data.js";

const groups = [
  { title: "Images", tools: imageTools },
  { title: "PDF", tools: pdfTools },
  { title: "Text & data", tools: [...markdownTools, ...dataTools] },
];
const tools = groups.flatMap((g) => g.tools);
const nav = document.getElementById("nav");
const navSelect = document.getElementById("navSelect");
const main = document.getElementById("main");

const state = { tool: null, files: [], results: [], busy: false, progress: null };
const ui = {};

function renderNav() {
  nav.replaceChildren();
  navSelect.replaceChildren();
  for (const g of groups) {
    nav.append(el("div", { class: "nav-group", text: g.title }));
    const optgroup = el("optgroup", { label: g.title });
    for (const t of g.tools) {
      nav.append(el("a", {
        class: `nav-item${state.tool?.id === t.id ? " active" : ""}`,
        href: `#${t.id}`,
        text: t.title,
      }));
      optgroup.append(el("option", { value: t.id, text: t.title, selected: state.tool?.id === t.id }));
    }
    navSelect.append(optgroup);
  }
}
navSelect.addEventListener("change", () => { location.hash = `#${navSelect.value}`; });

function requestedToolId() {
  const hash = location.hash.replace(/^#/, "");
  if (hash) return hash;
  return new URLSearchParams(location.search).get("tool") || tools[0].id;
}

function mount() {
  const tool = tools.find((t) => t.id === requestedToolId()) || tools[0];
  state.tool = tool;
  // Files stay loaded when switching to another tool that takes them (e.g. crop → compress).
  state.files = state.files.filter((f) => accepts(tool, f));
  if (tool.multiple === false) state.files = state.files.slice(0, 1);
  state.results = [];
  state.busy = false;
  document.title = `${tool.title} · FileForge`;
  renderNav();

  const fileInput = el("input", {
    type: "file", id: "fileInput", hidden: true,
    multiple: tool.multiple !== false, accept: tool.accept || "",
    onchange: () => { addFiles([...fileInput.files]); fileInput.value = ""; },
  });
  const dropzone = el("section", { class: "dropzone", tabindex: "0", role: "button", "aria-label": tool.multiple === false ? "Choose a file" : "Choose files" }, [
    fileInput,
    el("div", { class: "dz-inner" }, [
      el("strong", { text: tool.multiple === false ? "Drop a file here" : "Drop files here" }),
      " or ",
      el("button", { class: "link", type: "button", text: tool.multiple === false ? "choose a file" : "choose files", onclick: () => fileInput.click() }),
      el("div", { class: "dz-hint", text: tool.hint || "" }),
    ]),
  ]);
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  ui.dropzone = dropzone;

  ui.fileList = el("section", { class: "file-list" });
  ui.options = el("section", { class: "options card", hidden: !tool.filesOptional });
  ui.options.addEventListener("change", saveOptions);
  ui.options.addEventListener("input", saveOptions);
  ui.runBtn = el("button", { class: "primary", type: "button", text: tool.runLabel || "Run", title: "Ctrl+Enter / ⌘Enter", onclick: run });
  ui.cancelBtn = el("button", { type: "button", text: "Cancel", hidden: true, onclick: () => state.progress?.cancel() });
  ui.progress = el("div", { class: "progress", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, [el("div", { class: "progress-bar" }), el("span", { class: "progress-text" })]);
  ui.actions = el("section", { class: "actions", hidden: !tool.filesOptional }, [
    ui.runBtn,
    el("button", { type: "button", text: "Clear", onclick: () => { state.files = []; state.results = []; refresh(); } }),
    ui.cancelBtn,
    ui.progress,
  ]);
  ui.results = el("section", { class: "results card", hidden: true, "aria-live": "polite" });

  main.replaceChildren(
    el("section", { class: "tool-head" }, [el("h1", { text: tool.title }), el("p", { text: tool.description })]),
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

function addFiles(incoming) {
  const tool = state.tool;
  const accepted = incoming.map(withType).filter((f) => {
    const ok = accepts(tool, f);
    if (!ok) toast(`Skipped ${f.name}: not a supported file type for this tool`, "error");
    return ok;
  });
  if (!accepted.length) return;
  state.files = tool.multiple === false ? [accepted[0]] : [...state.files, ...accepted];
  state.results = [];
  refresh();
}

// Anywhere on the page is a drop target; the dashed box just shows where files go.
document.addEventListener("dragover", (e) => { e.preventDefault(); ui.dropzone?.classList.add("over"); });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) ui.dropzone?.classList.remove("over"); });
document.addEventListener("drop", (e) => {
  e.preventDefault();
  ui.dropzone?.classList.remove("over");
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
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
  const label = input.closest(".field")?.querySelector(".field-label")?.textContent || input.closest("label.check")?.querySelector("span")?.textContent;
  return label ? `${input.tagName.toLowerCase()}:${label}` : null;
}

function saveOptions() {
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
    const list = el("ul", { class: "files" });
    state.files.forEach((f, i) => {
      const row = el("li", {}, [
        el("span", { class: "file-name", text: f.name, title: f.name }),
        el("span", { class: "file-size", text: formatBytes(f.size) }),
      ]);
      if (tool.orderable && state.files.length > 1) {
        row.append(
          el("button", { class: "icon", type: "button", title: "Move up", text: "↑", disabled: i === 0, onclick: () => move(i, -1) }),
          el("button", { class: "icon", type: "button", title: "Move down", text: "↓", disabled: i === state.files.length - 1, onclick: () => move(i, 1) }),
        );
      }
      row.append(el("button", { class: "icon", type: "button", title: "Remove", text: "✕", onclick: () => { state.files.splice(i, 1); state.results = []; refresh(); } }));
      list.append(row);
    });
    ui.fileList.append(list);
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
  toast(`Copied ${r.name}`);
}

function renderResults() {
  ui.results.replaceChildren();
  ui.results.hidden = state.results.length === 0;
  if (!state.results.length) return;
  ui.results.append(el("h2", { text: `Done · ${plural(state.results.length, "file")}` }));
  const list = el("ul", { class: "files" });
  const canCopy = (r) => navigator.clipboard && ((r.blob.type.startsWith("image/") && "ClipboardItem" in window && r.blob.type !== "image/svg+xml") || COPYABLE_TEXT.test(r.blob.type));
  for (const r of state.results) {
    list.append(el("li", {}, [
      el("span", { class: "file-name", text: r.name, title: r.name }),
      el("span", { class: "file-size", text: formatBytes(r.blob.size) }),
      r.note ? el("span", { class: "file-note", text: r.note }) : null,
      canCopy(r) ? el("button", { type: "button", text: "Copy", title: "Copy to the clipboard", onclick: () => copyResult(r).catch((err) => toast(`Could not copy: ${err.message}`, "error")) }) : null,
      el("button", { type: "button", text: "Download", onclick: () => download(r.blob, r.name) }),
    ]));
  }
  ui.results.append(list);
  if (state.results.length > 1) {
    ui.results.append(el("div", { class: "actions" }, [
      el("button", { class: "primary", type: "button", text: "Download all (.zip)", onclick: async () => {
        try { download(await zipFiles(state.results), `fileforge-${state.tool.id}.zip`); }
        catch (err) { toast(err.message, "error"); }
      } }),
    ]));
  }
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
    cancel() { ctrl.abort(); text.textContent = "Cancelling…"; },
  };
}

async function run() {
  if (state.busy) return;
  const tool = state.tool;
  if (!state.files.length && !tool.filesOptional) return;
  state.busy = true;
  ui.runBtn.disabled = true;
  const label = ui.runBtn.textContent;
  ui.runBtn.textContent = "Working…";
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
      if (state.results.length === 1 && !tool.noAutoDownload) download(state.results[0].blob, state.results[0].name);
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

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
});

function toolFor(file) {
  const t = file.type;
  if (t === "application/pdf") return "pdf-split";
  if (t === "image/heic" || t === "image/heif") return "heic";
  if (t.startsWith("image/")) return "crop";
  if (/json/.test(t)) return "json-format";
  if (/csv|tab-separated/.test(t)) return "csv-json";
  if (/markdown|plain/.test(t)) return "md-to-pdf";
  return null;
}

function openFiles(files) {
  if (!files.length) return;
  const id = toolFor(files[0]);
  if (id && id !== state.tool.id) { history.replaceState(null, "", `${location.pathname}#${id}`); mount(); }
  addFiles(files);
}

async function loadFromSrc() {
  const params = new URLSearchParams(location.search);
  const src = params.get("src");
  if (params.get("note") === "embedded") toast("That image is embedded in the page and could not be read. Save it and drop it here instead.", "error");
  if (!src) return;
  history.replaceState(null, "", location.pathname + location.hash);
  try {
    let url = src, name = "file";
    if (src.startsWith("handoff:")) {
      // The extension's background script fetched an embedded (data:/blob:) image and holds it for us.
      const api = globalThis.browser ?? globalThis.chrome;
      const got = await api.runtime.sendMessage({ type: "fileforge-pull", id: src.slice(8) });
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
    openFiles(files.map(withType));
  });
}

window.addEventListener("hashchange", mount);
window.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});
mount();
loadFromSrc();
