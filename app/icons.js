// Small stroke icons (24 × 24 grid, Feather style) for tools and the chrome around them.
// Each entry is the inner SVG markup; icon(name) wraps it in an <svg>.

const ICONS = {
  // tools: images
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  resize: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  compress: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
  convert: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  heic: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  watermark: '<path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z"/>',
  redact: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 12h10"/><path d="M7 8h6"/><path d="M7 16h8"/>',
  adjust: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  frame: '<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="7" y="7" width="10" height="10" rx="1.5"/>',
  palette: '<circle cx="12" cy="12" r="10"/><circle cx="8" cy="10" r="1.2" fill="currentColor"/><circle cx="12" cy="7" r="1.2" fill="currentColor"/><circle cx="16" cy="10" r="1.2" fill="currentColor"/><path d="M12 22a3 3 0 0 0 0-6h-1a1.5 1.5 0 0 1 0-3h3a7 7 0 0 0 7-7"/>',
  qr: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14h1v1M14 20h1v1M17 17h4v4"/>',
  metadata: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/>',
  favicons: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 7l1.5 3 3.3.5-2.4 2.3.6 3.2L12 14.5 9 16l.6-3.2L7.2 10.5l3.3-.5z"/>',
  annotate: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  "id-photo": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10.5" r="2.5"/><path d="M5 18a4 4 0 0 1 8 0"/><path d="M15 9h3M15 13h3"/>',
  "doc-scan": '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  ocr: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 9h8M12 9v7"/>',
  "zip-create": '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11z"/><path d="M12 3v2M12 7v2M12 11v2"/><rect x="10.5" y="14" width="3" height="4" rx="1"/>',
  "zip-extract": '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11z"/><path d="M12 9v8M8.5 13.5L12 17l3.5-3.5"/>',
  "transparent-bg": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h6V3M9 9v6H3M9 15h6v6M15 15V9h6M15 9H9" stroke-width="1.2"/>',
  // tools: pdf
  "pdf-protect": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
  "pdf-unlock": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/>',
  "pdf-repair": '<path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.5 2.5-2.2-.6-.6-2.2z"/>',
  "pdf-redact": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><rect x="7.5" y="12" width="9" height="3.2" fill="currentColor"/>',
  "pdf-compare": '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/><path d="M5.5 9h2M5.5 12h2M16.5 9h2M16.5 15h2"/>',
  "pdf-sign": '<path d="M3 17c3-1 4-6 6-6s1 5 3 5 2-3 4-3 2 2 5 2"/><path d="M3 21h18"/>',
  "pdf-merge": '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 8v8M8 12h8"/>',
  "pdf-split": '<path d="M12 3v18"/><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M9 12h6" stroke-dasharray="2 2"/>',
  "pdf-reorder": '<rect x="3" y="4" width="7" height="9" rx="1"/><rect x="14" y="11" width="7" height="9" rx="1"/><path d="M14 7h3a2 2 0 0 1 2 2v1"/><path d="M10 17H7a2 2 0 0 1-2-2v-1"/>',
  "pdf-rotate": '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M14 3v6h6"/><path d="M21 3a4 4 0 0 0-4-2"/>',
  "pdf-delete-pages": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9.5 13.5l5 5M14.5 13.5l-5 5"/>',
  "pdf-page-numbers": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M11 18h2M12 14v4"/><path d="M10.5 14.5L12 14"/>',
  "pdf-watermark": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 17l8-6"/>',
  "pdf-compress": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13l3 3 3-3"/><path d="M12 10v6"/>',
  "pdf-metadata": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  "pdf-crop": '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/><path d="M10 10h4v4h-4z"/>',
  "pdf-nup": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
  "pdf-stamp": '<path d="M5 22h14"/><path d="M19.3 13.3a6 6 0 0 0-6-5.3H12V6a2 2 0 1 0-4 0v2H7a3 3 0 0 0-3 3v2h16z"/><path d="M12 8V6"/>',
  "pdf-extract-images": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="9" cy="12" r="1.3"/><path d="M19 19l-4-4-6 6"/>',
  "images-to-pdf": '<rect x="3" y="3" width="12" height="12" rx="2"/><circle cx="7" cy="7" r="1.2"/><path d="M15 11l-3-3-6 6"/><path d="M21 9v9a3 3 0 0 1-3 3H9"/>',
  "pdf-to-images": '<path d="M14 2H6a2 2 0 0 0-2 2v9"/><path d="M14 2v6h6v3"/><rect x="9" y="13" width="12" height="9" rx="1.5"/><circle cx="12.5" cy="16" r="1"/><path d="M21 21l-3.5-3.5L13 22"/>',
  "pdf-to-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/>',
  // tools: text & data
  "md-to-pdf": '<path d="M4 20V4h4l4 6 4-6h4v16"/><path d="M12 14v6"/>',
  "md-to-html": '<path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/><path d="M14 4l-4 16"/>',
  "csv-json": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  "json-format": '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
  base64: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  diff: '<path d="M12 3v18"/><path d="M5 8h4M7 6v4"/><path d="M15 16h4"/><rect x="3" y="3" width="8" height="18" rx="1.5" stroke-dasharray="3 2"/><rect x="13" y="3" width="8" height="18" rx="1.5"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  "text-case": '<path d="M4 20l5-14 5 14"/><path d="M6 15h6"/><path d="M15 12h5a2 2 0 0 1 0 4h-5"/><path d="M15 16h5"/>',
  jwt: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/>',
  url: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  regex: '<path d="M17 3v8"/><path d="M13.5 5l7 4M13.5 9l7-4"/><circle cx="6" cy="18" r="2"/><path d="M11 18h2"/>',
  pipeline: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10"/><path d="M5 8v4a2 2 0 0 0 2 2h3"/><path d="M19 8v4a2 2 0 0 1-2 2h-3"/><path d="M12 14v2"/>',
  collage: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><circle cx="7" cy="7" r="1" fill="currentColor"/><path d="M13 19l3-3 2 2 3-3"/>',
  "split-image": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  "image-compare": '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/><circle cx="7.5" cy="9" r="1.3"/><path d="M12 16l-4-4-4 4"/><path d="M21 15l-4-4-5 5"/>',
  "svg-raster": '<path d="M4 20l5-9 4 6 3-4 4 7z"/><path d="M3 4h4v4H3z"/><path d="M17 4h4v4h-4z"/><path d="M7 6h10"/>',
  rename: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 17l1-4 6-6 3 3-6 6z"/>',
  "pdf-booklet": '<path d="M2 4h8a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-8a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h9z"/>',
  "pdf-form": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><rect x="7" y="12" width="3" height="3"/><path d="M12 13.5h5"/><rect x="7" y="17" width="3" height="3"/><path d="M12 18.5h5"/>',
  colour: '<path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z"/><path d="M12 2.7V21"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>',
  star: '<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/>',
  // chrome
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h1M10 10h1M14 10h1M18 10h1M6 14h1M10 14h4M18 14h1"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  arrow: '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  wifi_off: '<path d="M1 1l22 22"/><path d="M16.7 11.4A11 11 0 0 0 12 10c-1 0-2 .1-3 .4"/><path d="M5 12.6a16 16 0 0 1 4.5-2.3"/><path d="M8.5 16.4a6 6 0 0 1 7 0"/><path d="M12 20h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};

/** An inline <svg> for `name`; unknown names give the generic file icon. */
export function icon(name, size = 18) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ic");
  svg.innerHTML = ICONS[name] || ICONS.file;
  return svg;
}

export const hasIcon = (name) => name in ICONS;
