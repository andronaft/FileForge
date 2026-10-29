// FileForge background script: opens the app and wires the context menus.
// Works as a Chrome MV3 service worker and as a Firefox MV3 event page.
const api = globalThis.browser ?? globalThis.chrome;
const APP_URL = api.runtime.getURL("app/index.html");
const t = (key) => api.i18n.getMessage(key);

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({ id: "fileforge-image", title: t("menuImage"), contexts: ["image"] });
  api.contextMenus.create({
    id: "fileforge-pdf",
    title: t("menuPdf"),
    contexts: ["link", "page"],
    targetUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"],
    documentUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"],
  });
});

api.action.onClicked.addListener(() => {
  api.tabs.create({ url: APP_URL });
});

// Embedded images (data:/blob: URLs) are too big for a URL, so they are parked here until the app tab asks for them.
const handoff = new Map();
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "fileforge-pull") return;
  sendResponse(handoff.get(msg.id) || null);
  handoff.delete(msg.id);
});

function openApp(tool, params = {}) {
  const url = new URL(APP_URL);
  url.searchParams.set("tool", tool);
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
  if (!src) return openApp(tool);
  if (src.startsWith("data:") || src.startsWith("blob:")) {
    let dataUrl = null;
    try { dataUrl = await readEmbedded(src, tab, info.pageUrl); } catch (_) { dataUrl = null; }
    if (!dataUrl) return openApp(tool, { note: "embedded" });
    const id = String(Date.now()) + Math.random().toString(36).slice(2);
    const ext = (dataUrl.match(/^data:image\/(\w+)/)?.[1] || "png").replace("jpeg", "jpg");
    handoff.set(id, { dataUrl, name: `image.${ext}` });
    setTimeout(() => handoff.delete(id), 60_000);
    return openApp(tool, { src: `handoff:${id}` });
  }
  const granted = await askOrigin(src);
  openApp(tool, granted ? { src } : {});
}

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "fileforge-image") openWith("crop", info.srcUrl, info, tab);
  else if (info.menuItemId === "fileforge-pdf") openWith("pdf-split", info.linkUrl || info.pageUrl, info, tab);
});
