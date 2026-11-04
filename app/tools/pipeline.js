// Pipeline: chain several tools (resize → compress → watermark…) and run them on every file in one go.
import { el, select, guessType, plural, toast, t } from "../util.js";
import { icon } from "../icons.js";

let registry = [];
const NOT_CHAINABLE = new Set(["pipeline", "redact", "pdf-reorder", "favicons", "pdf-stamp", "palette", "qr", "crop", "image-compare", "svg-raster", "pdf-form", "rename"]);
const OUTPUT_KIND = { "images-to-pdf": "pdf", "pdf-to-images": "image", "pdf-to-text": "text", "pdf-extract-images": "image" };

function kindOf(tool) {
  const a = tool.accept || "";
  if (a.includes("image/")) return "image";
  if (a.includes("application/pdf")) return "pdf";
  return "other";
}
function fileKind(f) { return f.type.startsWith("image/") ? "image" : f.type === "application/pdf" ? "pdf" : "other"; }
function chainable(kind) { return registry.filter((x) => !NOT_CHAINABLE.has(x.id) && !x.filesOptional && x.multiple !== false && kindOf(x) === kind); }

export const pipelineTool = {
  id: "pipeline",
  title: "Pipeline",
  description: "Chain several tools and run them on all your files in one go: resize → adjust → watermark → compress, or merge → page numbers → compress. Each step keeps its usual options.",
  keywords: ["batch", "chain", "automate", "workflow", "steps", "macro"],
  accept: "image/*,application/pdf,.pdf",
  hint: "Images or PDFs — the steps offered depend on what you drop",
  runLabel: "Run pipeline",
  setTools(tools) { registry = tools; },
  renderOptions(root, files) {
    root.dataset.noremember = "";
    const steps = [];
    this.steps = steps;
    const list = el("div", { class: "steps" });
    const adder = el("select", { "aria-label": "Add a step" });
    const addBtn = el("button", { type: "button", class: "small", onclick: () => addStep(adder.value) }, [icon("plus", 14), t("Add step")]);
    const hint = el("div", { class: "stat" });
    root.append(el("div", { class: "row" }, [el("span", { class: "field-label", text: "Next step" }), adder, addBtn]), list, hint);

    const inputKind = fileKind(files[0]);
    const kindAfter = (upto) => steps.slice(0, upto).reduce((k, s) => OUTPUT_KIND[s.tool.id] || k, inputKind);
    const refreshAdder = () => {
      const kind = kindAfter(steps.length);
      const options = chainable(kind);
      adder.replaceChildren(...options.map((x) => el("option", { value: x.id, text: x.title })));
      adder.disabled = addBtn.disabled = !options.length;
      hint.textContent = steps.length ? t("{n} steps · files go through them in order; the output of each step is the input of the next", { n: steps.length }) : t("Add the first step. Every step shows the same options as the tool itself.");
      if (kind === "text") hint.textContent = t("The last step produces text, so nothing can follow it.");
    };
    const render = () => {
      list.replaceChildren(...steps.map((step, i) => {
        const head = el("div", { class: "step-head" }, [
          el("span", { class: "n", text: String(i + 1) }), icon(step.tool.icon || step.tool.id, 16), el("strong", { text: step.tool.title }),
          el("button", { type: "button", class: "icon", title: "Move up", disabled: i === 0, onclick: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; render(); } }, "↑"),
          el("button", { type: "button", class: "icon", title: "Move down", disabled: i === steps.length - 1, onclick: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; render(); } }, "↓"),
          el("button", { type: "button", class: "icon", title: "Remove step", onclick: () => { steps.splice(i, 1); render(); } }, [icon("close", 14)]),
        ]);
        return el("div", { class: "step" }, [head, step.root]);
      }));
      refreshAdder();
      save();
    };
    const addStep = (id, values) => {
      const tool = registry.find((x) => x.id === id);
      if (!tool) return;
      const stepRoot = el("div", { class: "step-body options" });
      try { tool.renderOptions(stepRoot, files); } catch (err) { toast(err.message, "error"); return; }
      const step = { tool, root: stepRoot, snapshot: { ...tool } };
      if (values) restore(stepRoot, values);
      stepRoot.addEventListener("input", save); stepRoot.addEventListener("change", save);
      steps.push(step);
      render();
    };
    const values = (stepRoot) => [...stepRoot.querySelectorAll("input, select")].map((i) => (i.type === "checkbox" ? i.checked : i.value));
    const restore = (stepRoot, vals) => { [...stepRoot.querySelectorAll("input, select")].forEach((i, k) => { if (k >= vals.length) return; if (i.type === "checkbox") i.checked = !!vals[k]; else i.value = vals[k]; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }); };
    const save = () => { try { localStorage.setItem(`fileforge.pipeline.${inputKind}`, JSON.stringify(steps.map((s) => ({ id: s.tool.id, values: values(s.root) })))); } catch (_) { /* ignore */ } };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`fileforge.pipeline.${inputKind}`) || "null"); } catch (_) { /* ignore */ }
    if (Array.isArray(saved) && saved.length) for (const s of saved) addStep(s.id, s.values);
    render();
  },
  async run(files, _root, progress) {
    const steps = this.steps || [];
    if (!steps.length) throw new Error(t("Add at least one step"));
    let current = files;
    progress?.start(steps.length);
    const sub = { signal: progress?.signal, start() {}, async tick() { if (progress?.signal.aborted) throw new Error("Cancelled"); await new Promise((r) => setTimeout(r, 0)); }, cancel() {} };
    for (const [i, step] of steps.entries()) {
      await progress?.tick(`${i + 1}. ${t(step.tool.title)}`);
      Object.assign(step.tool, step.snapshot); // this step's own option elements, even if the same tool appears twice
      const results = await step.tool.run(current, step.root, sub);
      if (!results?.length) throw new Error(t("Step {n} ({tool}) produced no files", { n: i + 1, tool: t(step.tool.title) }));
      current = results.map((r) => new File([r.blob], r.name, { type: r.blob.type || guessType(r.name), lastModified: Date.now() }));
    }
    return current.map((f) => ({ name: f.name, blob: f, note: t("after {n} steps", { n: steps.length }) }));
  },
};
