// FileForge service worker: opens the app and wires the image context menu.
const APP_URL = chrome.runtime.getURL("app/index.html");

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "fileforge-image",
    title: "Edit image in FileForge",
    contexts: ["image"],
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: APP_URL });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "fileforge-image" || !info.srcUrl) return;
  let granted = false;
  try {
    const origin = new URL(info.srcUrl).origin + "/*";
    granted = await chrome.permissions.request({ origins: [origin] });
  } catch (_) {
    granted = false;
  }
  const url = new URL(APP_URL);
  url.searchParams.set("tool", "image");
  if (granted) url.searchParams.set("src", info.srcUrl);
  chrome.tabs.create({ url: url.toString() });
});
