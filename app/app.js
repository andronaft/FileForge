import { el, formatBytes, download, zipFiles, toast } from "./util.js";
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
const main = document.getElementById("main");

const state = { tool: null, files: [], results: [], busy: false };
const ui = {};

function renderNav() {
  nav.replaceChildren();
  for (const g of groups) {
    nav.append(el("div", { class: "nav-group", text: g.title }));
    for (const t of g.tools) {
      nav.append(el("a", {
        class: `nav-item${state.tool?.id === t.id ? " active" : ""}`,
        href: `#${t.id}`,
        text: t.title,
      }));
    }
  }
}

function requestedToolId() {
  const hash = location.hash.replace(/^#/, "");
  if (hash) return hash;
  return new URLSearchParams(location.search).get("tool") || tools[0].id;
}

function mount() {
  const tool = tools.find((t) => t.id === requestedToolId()) || tools[0];
  state.tool = tool;
  state.files = [];
  state.results = [];
  state.busy = false;
  document.title = `${tool.title} · FileForge`;
  renderNav();

  const fileInput = el("input", {
    type: "file", id: "fileInput", hidden: true,
    multiple: tool.multiple !== false, accept: tool.accept || "",
    onchange: () => { addFiles([...fileInput.files]); fileInput.value = ""; },
  });
  const dropzone = el("section", { class: "dropzone", tabindex: "0" }, [
    fileInput,
    el("div", { class: "dz-inner" }, [
      el("strong", { text: tool.multiple === false ? "Drop a file here" : "Drop files here" }),
      " or ",
      el("button", { class: "link", type: "button", text: tool.multiple === false ? "choose a file" : "choose files", onclick: () => fileInput.click() }),
      el("div", { class: "dz-hint", text: tool.hint || "" }),
    ]),
  ]);
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("over");
    addFiles([...e.dataTransfer.files]);
  });
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });

  ui.fileList = el("section", { class: "file-list" });
  ui.options = el("section", { class: "options card", hidden: !tool.filesOptional });
  ui.runBtn = el("button", { class: "primary", type: "button", text: tool.runLabel || "Run", onclick: run });
  ui.actions = el("section", { class: "actions", hidden: !tool.filesOptional }, [
    ui.runBtn,
    el("button", { type: "button", text: "Clear", onclick: () => { state.files = []; state.results = []; refresh(); } }),
  ]);
  ui.results = el("section", { class: "results card", hidden: true });

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

function addFiles(incoming) {
  const tool = state.tool;
  const accepted = incoming.filter((f) => {
    if (!tool.accept || tool.accept === "*/*") return true;
    const ok = tool.accept.split(",").some((pattern) => {
      pattern = pattern.trim();
      if (pattern.endsWith("/*")) return f.type.startsWith(pattern.slice(0, -1));
      if (pattern.startsWith(".")) return f.name.toLowerCase().endsWith(pattern.toLowerCase());
      return f.type === pattern;
    });
    if (!ok) toast(`Skipped ${f.name}: not a supported file type for this tool`, "error");
    return ok;
  });
  if (!accepted.length) return;
  state.files = tool.multiple === false ? [accepted[0]] : [...state.files, ...accepted];
  state.results = [];
  refresh();
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

function renderResults() {
  ui.results.replaceChildren();
  ui.results.hidden = state.results.length === 0;
  if (!state.results.length) return;
  ui.results.append(el("h2", { text: `Done · ${state.results.length} file${state.results.length === 1 ? "" : "s"}` }));
  const list = el("ul", { class: "files" });
  for (const r of state.results) {
    list.append(el("li", {}, [
      el("span", { class: "file-name", text: r.name, title: r.name }),
      el("span", { class: "file-size", text: formatBytes(r.blob.size) }),
      r.note ? el("span", { class: "file-note", text: r.note }) : null,
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

async function run() {
  if (state.busy) return;
  const tool = state.tool;
  if (!state.files.length && !tool.filesOptional) return;
  state.busy = true;
  ui.runBtn.disabled = true;
  const label = ui.runBtn.textContent;
  ui.runBtn.textContent = "Working…";
  try {
    const results = await tool.run(state.files, ui.options);
    state.results = results || [];
    renderResults();
    if (state.results.length) {
      ui.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (state.results.length === 1 && !tool.noAutoDownload) download(state.results[0].blob, state.results[0].name);
    }
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), "error");
  } finally {
    state.busy = false;
    ui.runBtn.disabled = false;
    ui.runBtn.textContent = label;
  }
}

async function loadFromSrc() {
  const src = new URLSearchParams(location.search).get("src");
  if (!src) return;
  history.replaceState(null, "", location.pathname + location.hash);
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) throw new Error("not an image");
    const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "image") || "image";
    addFiles([new File([blob], name.includes(".") ? name : `${name}.${blob.type.split("/")[1] || "png"}`, { type: blob.type })]);
  } catch (err) {
    toast("Could not load that image automatically. Save it and drop it here instead.", "error");
  }
}

window.addEventListener("hashchange", mount);
window.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});
mount();
loadFromSrc();
