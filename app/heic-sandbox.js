// Runs inside a sandboxed page (eval allowed) and decodes HEIC on request from the app.
window.addEventListener("message", async (e) => {
  const { id, buffer, toType, quality } = e.data || {};
  if (!id || !buffer) return;
  try {
    const result = await heic2any({ blob: new Blob([buffer]), toType: toType || "image/jpeg", quality: quality ?? 0.9 });
    const blobs = Array.isArray(result) ? result : [result];
    const buffers = await Promise.all(blobs.map((b) => b.arrayBuffer()));
    e.source.postMessage({ id, buffers }, "*", buffers);
  } catch (err) {
    e.source.postMessage({ id, error: (err && (err.message || err.code)) || String(err) }, "*");
  }
});
window.parent.postMessage({ type: "heic-ready" }, "*");
