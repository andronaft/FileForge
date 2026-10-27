// FileForge background script: opens the app and wires the image context menu.
// Works as a Chrome MV3 service worker and as a Firefox MV3 event page.
const api = globalThis.browser ?? globalThis.chrome;
const APP_URL = api.runtime.getURL("app/index.html");

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "fileforge-image",
    title: "Edit image in FileForge",
    contexts: ["image"],
  });
});

api.action.onClicked.addListener(() => {
  api.tabs.create({ url: APP_URL });
});

api.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "fileforge-image" || !info.srcUrl) return;
  let granted = false;
  try {
    const origin = new URL(info.srcUrl).origin + "/*";
    granted = await api.permissions.request({ origins: [origin] });
  } catch (_) {
    granted = false;
  }
  const url = new URL(APP_URL);
  url.searchParams.set("tool", "crop");
  if (granted) url.searchParams.set("src", info.srcUrl);
  api.tabs.create({ url: url.toString() });
});
