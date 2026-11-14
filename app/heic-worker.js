// Decodes HEIC/HEIF off the main thread with libheif (WebAssembly). Replies with raw RGBA pixels per image.
importScripts("../vendor/libheif-bundle.js");

let lib = null;
async function load() {
  if (!lib) {
    lib = libheif(); // the bundle carries the .wasm inline, so nothing is fetched
    if (lib && typeof lib.then === "function") lib = await lib;
    else if (lib && lib.ready && typeof lib.ready.then === "function") await lib.ready;
  }
  return lib;
}

function pixels(image) {
  const width = image.get_width(), height = image.get_height();
  return new Promise((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) => {
      if (out) resolve(out); else reject(new Error("libheif could not decode this image"));
    });
  });
}

self.onmessage = async (e) => {
  const { id, buffer, all } = e.data || {};
  if (!id) return;
  const decoder = new (await load()).HeifDecoder();
  try {
    const images = decoder.decode(new Uint8Array(buffer));
    if (!images.length) throw new Error("Not a HEIC/HEIF image, or it uses a feature libheif cannot read");
    const out = [];
    for (const image of all ? images : images.slice(0, 1)) {
      const { data, width, height } = await pixels(image);
      out.push({ width, height, data });
    }
    images.forEach((im) => im.free());
    self.postMessage({ id, images: out }, out.map((im) => im.data.buffer));
  } catch (err) {
    self.postMessage({ id, error: (err && err.message) || String(err) });
  } finally {
    if (decoder.decoder) lib.heif_context_free(decoder.decoder);
  }
};
