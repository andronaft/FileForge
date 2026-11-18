// FileForge background script: opens the app and wires the context menus.
// Works as a Chrome MV3 service worker and as a Firefox MV3 event page.
const api = globalThis.browser ?? globalThis.chrome;
const APP_URL = api.runtime.getURL("app/index.html");
const t = (key) => api.i18n.getMessage(key);

api.runtime.onInstalled.addListener(() => {
  // Rebuilt from scratch on every install and update, so an id never exists twice.
  api.contextMenus.removeAll(createMenus);
});

function createMenus() {
  // Right-click on the toolbar icon: switch between the side panel and a full tab.
  if (api.sidePanel || api.sidebarAction) {
    try {
      api.contextMenus.create({ id: "fileforge-side", title: t("menuSide"), contexts: ["action"] });
      api.contextMenus.create({ id: "fileforge-tab", title: t("menuTab"), contexts: ["action"] });
    } catch (_) { /* a browser without the "action" menu context */ }
  }
  // Several entries for one context are folded by the browser into a "FileForge" submenu.
  api.contextMenus.create({ id: "fileforge-image", title: t("menuImage"), contexts: ["image"] });
  api.contextMenus.create({ id: "fileforge-image-convert", title: t("menuImageConvert"), contexts: ["image"] });
  api.contextMenus.create({ id: "fileforge-image-ocr", title: t("menuImageOcr"), contexts: ["image"] });
  api.contextMenus.create({ id: "fileforge-image-qr", title: t("menuImageQr"), contexts: ["image"] });
  // The address of the page or of a link as a QR code, to open it on a phone.
  api.contextMenus.create({ id: "fileforge-page-qr", title: t("menuPageQr"), contexts: ["page", "link"] });
  // Two entries, not one: an item with both pattern lists shows only where both match (a PDF link inside a PDF).
  const PDF_URLS = ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF", "*://*/*.PDF?*"];
  api.contextMenus.create({ id: "fileforge-pdf", title: t("menuPdf"), contexts: ["link"], targetUrlPatterns: PDF_URLS });
  api.contextMenus.create({ id: "fileforge-pdf-page", title: t("menuPdf"), contexts: ["page"], documentUrlPatterns: PDF_URLS });
  // Screenshots of the page, opened in Annotate. The click grants activeTab for this one tab.
  api.contextMenus.create({ id: "fileforge-shot", title: t("menuShotVisible"), contexts: ["page", "action"] });
  api.contextMenus.create({ id: "fileforge-shot-full", title: t("menuShotFull"), contexts: ["page", "action"] });
}

// In Chrome, once the user picked the side panel, clicking the icon opens the panel itself (setPanelBehavior)
// and this listener is not called. Firefox always comes here: the sidebar is toggled from its own UI or the icon menu.
api.action.onClicked.addListener((tab) => { openApp(null, {}, tab); });

// ---------- side panel ----------
// Is FileForge currently open in the side panel / sidebar of the window the user is in (any window when unknown)?
async function panelOpen(windowId) {
  try {
    if (api.sidebarAction) return await api.sidebarAction.isOpen(windowId != null ? { windowId } : {});
    if (api.runtime.getContexts) {
      const panels = await api.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] });
      return windowId != null ? panels.some((c) => c.windowId === windowId) : panels.length > 0;
    }
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
// The window a side panel lives in. The panel cannot tell reliably itself (Chrome answers "the last focused window").
async function senderWindow(sender) {
  try {
    if (sender?.tab?.windowId != null) return sender.tab.windowId;
    if (sender?.documentId && api.runtime.getContexts) {
      const [context] = await api.runtime.getContexts({ documentIds: [sender.documentId] });
      if (context && context.windowId >= 0) return context.windowId;
    }
  } catch (_) { /* unknown */ }
  return null;
}
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "fileforge-pull") {
    sendResponse(handoff.get(msg.id) || null);
    handoff.delete(msg.id);
  } else if (msg?.type === "fileforge-pending") {
    // A panel that just loaded: tell it its window and hand over the request waiting for that window, if any.
    // A panel in another window leaves the request for the one it was meant for.
    senderWindow(sender).then((windowId) => {
      const mine = pending && (pending.windowId == null || windowId == null || pending.windowId === windowId);
      sendResponse({ windowId, open: mine ? pending : null });
      if (mine) pending = null;
    });
    return true; // the answer comes later
  }
});

// Opens `tool` (null = the last used one) in the side panel when it is open or chosen, otherwise in a new tab.
// `late`: the user's click was a while ago (a screenshot took seconds), so a closed panel can no longer be opened.
async function openApp(tool, params = {}, tab, late = false) {
  const windowId = tab?.windowId;
  const wasOpen = await panelOpen(windowId);
  if (wasOpen || (!late && (await panelPreferred()))) {
    // `id` lets the panel drop a request it gets twice (as `pending` and as a message); `windowId` keeps a panel
    // in another window from taking it.
    const open = tool ? { tool, params, windowId, id: String(Date.now()) + Math.random().toString(36).slice(2) } : null;
    if (open) setPending(open);
    let shown = true;
    try { await showPanel(tab); } catch (_) { shown = false; /* no user gesture left, or it is open already */ }
    if (shown || wasOpen || (await panelOpen(windowId))) {
      if (open) {
        // Already open: hand the request over now. Still loading: it will ask for `pending` itself.
        try { if (await api.runtime.sendMessage({ type: "fileforge-open", ...open })) pending = null; } catch (_) { /* nobody listening yet */ }
      }
      return;
    }
    // The panel is the default but closed, and the click is too old to open it (a permission prompt came in
    // between): a tab is better than nothing happening.
    if (pending === open) pending = null;
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

// ---------- screenshots ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blobToDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
const MAX_HEIGHT = 30000; // device pixels; canvases stop at 32767

/** The visible part of the tab, or the whole page scrolled through and stitched together. */
async function capture(tab, full) {
  // Chrome allows two captures a second, counted in one-second windows: keep them 550 ms apart, and wait out a
  // refusal once instead of losing the whole page.
  let lastShot = 0;
  const shot = async () => {
    const wait = lastShot + 550 - Date.now();
    if (wait > 0) await sleep(wait);
    try { lastShot = Date.now(); return await api.tabs.captureVisibleTab(tab.windowId, { format: "png" }); }
    catch (err) {
      if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(err?.message || err))) throw err;
      await sleep(1100);
      lastShot = Date.now();
      return api.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    }
  };
  if (!full) return (await fetch(await shot())).blob();
  const run = async (func, args = []) => (await api.scripting.executeScript({ target: { tabId: tab.id }, func, args }))[0]?.result;
  const page = await run(() => {
    const se = document.scrollingElement || document.documentElement;
    return { h: innerHeight, total: Math.max(se.scrollHeight, document.body?.scrollHeight || 0), x: scrollX, y: scrollY, dpr: devicePixelRatio };
  });
  if (!page || page.total <= page.h + 2) return (await fetch(await shot())).blob();
  const parts = [];
  try {
    for (let y = 0; y < page.total && y * page.dpr < MAX_HEIGHT; y += page.h) {
      // From the second screen on, fixed and sticky bars (headers, cookie banners) are hidden so they appear once.
      await run((top, hide) => {
        if (hide && !document.documentElement.dataset.ffShot) {
          document.documentElement.dataset.ffShot = "1";
          for (const n of document.querySelectorAll("body *")) {
            const pos = getComputedStyle(n).position;
            if (pos === "fixed" || pos === "sticky") { n.dataset.ffVis = n.style.visibility; n.style.visibility = "hidden"; }
          }
        }
        // "instant": a page with `scroll-behavior: smooth` would otherwise still be on its way when it is captured.
        scrollTo({ left: 0, top, behavior: "instant" });
      }, [y, y > 0]);
      await sleep(y === 0 ? 150 : 300); // lazy images
      // Where the page really is now (the last screen stops short of `y`, and a page may move itself).
      const at = await run(() => scrollY);
      try { parts.push({ y: typeof at === "number" ? at : y, blob: await (await fetch(await shot())).blob() }); }
      catch (err) { if (!parts.length) throw err; break; } // keep what was captured so far
    }
  } finally {
    await run((x, y) => {
      for (const n of document.querySelectorAll("[data-ff-vis]")) { n.style.visibility = n.dataset.ffVis; delete n.dataset.ffVis; }
      delete document.documentElement.dataset.ffShot;
      scrollTo({ left: x, top: y, behavior: "instant" });
    }, [page.x, page.y]).catch(() => {});
  }
  const bitmaps = await Promise.all(parts.map((p) => createImageBitmap(p.blob)));
  const k = bitmaps[0].height / page.h; // device pixels per CSS pixel, as captured
  const height = Math.min(MAX_HEIGHT, Math.round(Math.max(...parts.map((p, i) => p.y * k + bitmaps[i].height))));
  const canvas = new OffscreenCanvas(bitmaps[0].width, height);
  const g = canvas.getContext("2d");
  parts.forEach((p, i) => g.drawImage(bitmaps[i], 0, Math.round(p.y * k)));
  return canvas.convertToBlob({ type: "image/png" });
}

async function screenshot(tab, full) {
  let blob;
  try { blob = await capture(tab, full); }
  catch (_) { return openApp("annotate", { note: "shot" }, tab, true); }
  if (blob.size > 25 * 1024 * 1024) { // keep the hand-over message small enough
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  }
  let host = "page";
  try { host = new URL(tab.url).hostname.replace(/^www\./, "") || host; } catch (_) { /* no URL access */ }
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  const name = `screenshot-${host}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${blob.type === "image/jpeg" ? "jpg" : "png"}`;
  const id = String(Date.now()) + Math.random().toString(36).slice(2);
  handoff.set(id, { dataUrl: await blobToDataUrl(blob), name });
  setTimeout(() => handoff.delete(id), 120_000);
  return openApp("annotate", { src: `handoff:${id}` }, tab, full);
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "fileforge-shot" || info.menuItemId === "fileforge-shot-full") screenshot(tab, info.menuItemId === "fileforge-shot-full");
  else if (info.menuItemId === "fileforge-image") openWith("crop", info.srcUrl, info, tab);
  else if (info.menuItemId === "fileforge-image-convert") openWith("convert", info.srcUrl, info, tab);
  else if (info.menuItemId === "fileforge-image-ocr") openWith("ocr", info.srcUrl, info, tab);
  else if (info.menuItemId === "fileforge-image-qr") openWith("qr-read", info.srcUrl, info, tab);
  else if (info.menuItemId === "fileforge-page-qr") openApp("qr", { text: info.linkUrl || info.pageUrl || tab?.url || "" }, tab);
  else if (info.menuItemId === "fileforge-pdf") openWith("pdf-split", info.linkUrl, info, tab);
  else if (info.menuItemId === "fileforge-pdf-page") openWith("pdf-split", info.frameUrl || info.pageUrl, info, tab);
  else if (info.menuItemId === "fileforge-side") {
    try { await showPanel(tab); } catch (_) { /* ignore */ }
    try { await api.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }); } catch (_) { /* ignore */ }
  } else if (info.menuItemId === "fileforge-tab") {
    try { await api.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }); } catch (_) { /* ignore */ }
    try { await api.sidebarAction?.close(); } catch (_) { /* ignore */ }
    api.tabs.create({ url: APP_URL });
  }
});
