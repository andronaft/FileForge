// FileForge background script: opens the app and wires the context menus.
// Works as a Chrome MV3 service worker and as a Firefox MV3 event page.
const api = globalThis.browser ?? globalThis.chrome;
const APP_URL = api.runtime.getURL("app/index.html");
const t = (key) => api.i18n.getMessage(key);

api.runtime.onInstalled.addListener(() => {
  // Right-click on the toolbar icon: switch between the side panel and a full tab.
  if (api.sidePanel || api.sidebarAction) {
    try {
      api.contextMenus.create({ id: "fileforge-side", title: t("menuSide"), contexts: ["action"] });
      api.contextMenus.create({ id: "fileforge-tab", title: t("menuTab"), contexts: ["action"] });
    } catch (_) { /* a browser without the "action" menu context */ }
  }
  api.contextMenus.create({ id: "fileforge-image", title: t("menuImage"), contexts: ["image"] });
  api.contextMenus.create({
    id: "fileforge-pdf",
    title: t("menuPdf"),
    contexts: ["link", "page"],
    targetUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"],
    documentUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"],
  });
});

// In Chrome, once the user picked the side panel, clicking the icon opens the panel itself (setPanelBehavior)
// and this listener is not called. Firefox always comes here: the sidebar is toggled from its own UI or the icon menu.
api.action.onClicked.addListener((tab) => { openApp(null, {}, tab); });

// ---------- side panel ----------
// Is FileForge currently open in the side panel / sidebar of this browser?
async function panelOpen() {
  try {
    if (api.sidebarAction) return await api.sidebarAction.isOpen({});
    if (api.runtime.getContexts) return (await api.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })).length > 0;
  } catch (_) { /* fall through */ }
  return false;
}
// Did the user choose the side panel as the default (Chrome remembers it in the panel behaviour)?
async function panelPreferred() {
  try { return !!(await api.sidePanel?.getPanelBehavior())?.openPanelOnActionClick; } catch (_) { return false; }
}
async function showPanel(tab) {
  if (api.sidePanel) {
    const windowId = tab?.windowId ?? (await api.windows.getCurrent()).id;
    await api.sidePanel.open({ windowId });
  } else if (api.sidebarAction) {
    await api.sidebarAction.open();
  }
}

// A tool + file the side panel should show. The panel asks for it when it loads; if it is already open it gets a message.
let pending = null;
let pendingTimer = 0;
function setPending(open) {
  pending = open;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { pending = null; }, 60_000);
}

// Embedded images (data:/blob: URLs) are too big for a URL, so they are parked here until the app tab asks for them.
const handoff = new Map();
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "fileforge-pull") {
    sendResponse(handoff.get(msg.id) || null);
    handoff.delete(msg.id);
  } else if (msg?.type === "fileforge-pending") {
    sendResponse(pending);
    pending = null;
  }
});

// Opens `tool` (null = the last used one) in the side panel when it is open or chosen, otherwise in a new tab.
async function openApp(tool, params = {}, tab) {
  if ((await panelOpen()) || (await panelPreferred())) {
    const open = tool ? { tool, params } : null;
    if (open) setPending(open);
    try { await showPanel(tab); } catch (_) { /* no user gesture left or already open; the panel still picks up `pending` */ }
    if (open) {
      // Already open: hand the request over now. Still loading: it will ask for `pending` itself.
      try { if (await api.runtime.sendMessage({ type: "fileforge-open", ...open })) pending = null; } catch (_) { /* nobody listening yet */ }
    }
    return;
  }
  const url = new URL(APP_URL);
  if (tool) url.searchParams.set("tool", tool);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  api.tabs.create({ url: url.toString() });
}

async function askOrigin(url) {
  try {
    return await api.permissions.request({ origins: [new URL(url).origin + "/*"] });
  } catch (_) {
    return false;
  }
}

// Reads a data:/blob: image. blob: URLs only resolve inside the page that made them, so those go through a script in that tab.
async function readEmbedded(src, tab, pageUrl) {
  if (src.startsWith("data:")) return src;
  if (!tab?.id || !pageUrl || !(await askOrigin(pageUrl))) return null;
  const [res] = await api.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (u) => {
      const blob = await (await fetch(u)).blob();
      return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
    },
    args: [src],
  });
  return typeof res?.result === "string" ? res.result : null;
}

// Opens the app with the file at `src` loaded into `tool`, after asking for that one site.
async function openWith(tool, src, info, tab) {
  if (!src) return openApp(tool, {}, tab);
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    let dataUrl = null;
    try { dataUrl = await readEmbedded(src, tab, info.pageUrl); } catch (_) { dataUrl = null; }
    if (!dataUrl) return openApp(tool, { note: "embedded" }, tab);
    const id = String(Date.now()) + Math.random().toString(36).slice(2);
    const ext = (dataUrl.match(/^data:image\/(\w+)/)?.[1] || "png").replace("jpeg", "jpg");
    handoff.set(id, { dataUrl, name: `image.${ext}` });
    setTimeout(() => handoff.delete(id), 60_000);
    return openApp(tool, { src: `handoff:${id}` }, tab);
  }
  const granted = await askOrigin(src);
  openApp(tool, granted ? { src } : {}, tab);
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "fileforge-image") openWith("crop", info.srcUrl, info, tab);
  else if (info.menuItemId === "fileforge-pdf") openWith("pdf-split", info.linkUrl || info.pageUrl, info, tab);
  else if (info.menuItemId === "fileforge-side") {
    try { await showPanel(tab); } catch (_) { /* ignore */ }
    try { await api.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }); } catch (_) { /* ignore */ }
  } else if (info.menuItemId === "fileforge-tab") {
    try { await api.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }); } catch (_) { /* ignore */ }
    try { await api.sidebarAction?.close(); } catch (_) { /* ignore */ }
    api.tabs.create({ url: APP_URL });
  }
});
