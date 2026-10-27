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

// Opens the app with the file at `src` loaded into `tool`, after asking for that one site.
async function openWith(tool, src) {
  let granted = false;
  if (src) {
    try {
      granted = await api.permissions.request({ origins: [new URL(src).origin + "/*"] });
    } catch (_) {
      granted = false;
    }
  }
  const url = new URL(APP_URL);
  url.searchParams.set("tool", tool);
  if (granted) url.searchParams.set("src", src);
  api.tabs.create({ url: url.toString() });
}

api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "fileforge-image") openWith("crop", info.srcUrl);
  else if (info.menuItemId === "fileforge-pdf") openWith("pdf-split", info.linkUrl || info.pageUrl);
});
