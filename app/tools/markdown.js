import { el, field, select, download, readAsText, toast } from "../util.js";

const SAMPLE = `# FileForge

Paste or type **Markdown** on the left, or drop a \`.md\` file above.

## What works

- Headings, lists, **bold**, _italic_, \`code\`
- Tables, blockquotes, links
- Fenced code blocks

| Feature | Status |
| --- | --- |
| Markdown → PDF | ✅ |
| Markdown → HTML | ✅ |

> Click **Save as PDF** and choose "Save as PDF" as the destination in the print dialog.
`;

const THEMES = {
  github: `
    body { font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #24292f; max-width: 820px; margin: 0 auto; padding: 32px 24px; }
    h1, h2 { border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
    h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
    code { background: #f6f8fa; padding: .15em .35em; border-radius: 4px; font: 85% ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { background: #f6f8fa; padding: 14px; border-radius: 6px; overflow: auto; }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; margin: 1em 0; }
    th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
    th { background: #f6f8fa; }
    blockquote { margin: 1em 0; padding: 0 1em; color: #57606a; border-left: 4px solid #d0d7de; }
    img { max-width: 100%; }
    a { color: #0969da; }`,
  serif: `
    body { font: 16px/1.7 Georgia, "Times New Roman", serif; color: #222; max-width: 760px; margin: 0 auto; padding: 40px 28px; }
    h1, h2, h3 { font-family: Georgia, serif; }
    code, pre { font: 90% ui-monospace, Menlo, monospace; background: #f3f3f3; }
    code { padding: .1em .3em; border-radius: 3px; } pre { padding: 12px; overflow: auto; }
    table { border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 6px 12px; }
    blockquote { border-left: 3px solid #bbb; margin: 1em 0; padding-left: 1em; color: #555; }
    img { max-width: 100%; }`,
  plain: `
    body { font: 14px/1.5 Helvetica, Arial, sans-serif; color: #000; margin: 0; padding: 24px; }
    code, pre { font-family: Menlo, monospace; } pre { background: #f4f4f4; padding: 10px; }
    table { border-collapse: collapse; } th, td { border: 1px solid #999; padding: 4px 8px; }
    img { max-width: 100%; }`,
};

function buildHtml(markdown, theme, pageSize, title) {
  const body = marked.parse(markdown, { gfm: true, breaks: false });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${pageSize}; margin: 18mm; }
${THEMES[theme] || THEMES.github}
@media print { body { max-width: none; padding: 0; } pre, blockquote, table, img { page-break-inside: avoid; } }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const mdToPdfTool = {
  id: "md-to-pdf",
  title: "Markdown to PDF",
  description: "Render Markdown with a clean stylesheet and save it as PDF through the browser's print dialog, or download it as a standalone HTML file.",
  accept: ".md,.markdown,.txt,text/markdown,text/plain",
  multiple: false,
  filesOptional: true,
  hint: "Optional: drop a .md file to load it into the editor",
  runLabel: "Save as PDF",
  text: SAMPLE,
  renderOptions(root, files) {
    const editor = el("textarea", { spellcheck: "false" });
    editor.value = this.text;
    // No allow-scripts: HTML inside a Markdown file is rendered but never executed (same-origin is kept so print() works).
    const preview = el("iframe", { class: "md-preview", title: "Preview", sandbox: "allow-same-origin allow-modals" });
    const theme = select([["github", "GitHub style"], ["serif", "Serif / book"], ["plain", "Plain"]], this.theme || "github");
    const pageSize = select([["A4", "A4"], ["Letter", "Letter"]], this.pageSize || "A4");
    const titleOf = () => (files[0] ? files[0].name.replace(/\.[^.]+$/, "") : (editor.value.match(/^#\s+(.+)$/m)?.[1] || "document"));
    const update = () => {
      this.text = editor.value; this.theme = theme.value; this.pageSize = pageSize.value;
      preview.srcdoc = buildHtml(editor.value, theme.value, pageSize.value, titleOf());
    };
    let timer;
    editor.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 200); });
    theme.addEventListener("change", update);
    pageSize.addEventListener("change", update);
    const htmlBtn = el("button", { type: "button", text: "Download .html", onclick: () => {
      download(new Blob([buildHtml(editor.value, theme.value, pageSize.value, titleOf())], { type: "text/html" }), `${titleOf()}.html`);
    } });
    const mdBtn = el("button", { type: "button", text: "Download .md", onclick: () => {
      download(new Blob([editor.value], { type: "text/markdown" }), `${titleOf()}.md`);
    } });
    root.append(
      el("div", { class: "row" }, [field("Style", theme), field("Page size", pageSize), el("div", { class: "actions" }, [htmlBtn, mdBtn])]),
      el("div", { class: "md-grid" }, [editor, preview]),
    );
    this.preview = preview;
    this.titleOf = titleOf;
    if (files[0]) {
      readAsText(files[0]).then((t) => { editor.value = t; update(); }).catch((err) => toast(err.message, "error"));
    } else {
      update();
    }
  },
  async run() {
    const win = this.preview?.contentWindow;
    if (!win) throw new Error("Preview is not ready yet");
    win.document.title = this.titleOf();
    win.focus();
    win.print();
    return [];
  },
};

export const markdownTools = [mdToPdfTool];
