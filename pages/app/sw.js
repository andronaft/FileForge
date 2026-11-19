// The web app moved to https://zhukovskyi.space/tools/fileforge/app/. This worker replaces the old offline one:
// it deletes the old caches, unregisters itself and reloads open tabs, which then follow the redirect.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
