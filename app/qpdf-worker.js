// Runs qpdf (WebAssembly) off the main thread: encrypt, decrypt and repair PDFs. One fresh instance per job,
// because qpdf's main() may exit() and leave the module unusable.
importScripts("../vendor/qpdf.js");

// This qpdf build prints through console.log / console.error (it ignores Module.print), so capture those.
let sink = null;
for (const name of ["log", "error", "warn"]) {
  const original = console[name].bind(console);
  console[name] = (...args) => { if (sink) sink.push(args.join(" ")); else original(...args); };
}

self.onmessage = async (e) => {
  const { id, input, args } = e.data || {};
  if (!id) return;
  const log = [];
  sink = log;
  try {
    const qpdf = await Module({ locateFile: (name) => `../vendor/${name}`, noInitialRun: true });
    qpdf.FS.writeFile("/in.pdf", new Uint8Array(input));
    let code = 0;
    try { code = qpdf.callMain(args) ?? 0; }
    catch (err) { code = typeof err?.status === "number" ? err.status : 2; if (typeof err?.status !== "number") log.push(String(err?.message || err)); }
    // 0 = fine, 3 = written with warnings (e.g. a repaired file); anything else is an error
    let output = null;
    try { output = qpdf.FS.readFile("/out.pdf"); } catch (_) { /* nothing written */ }
    const buffer = output ? output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) : null;
    sink = null;
    self.postMessage({ id, code, log: log.join("\n"), output: buffer }, buffer ? [buffer] : []);
  } catch (err) {
    sink = null;
    self.postMessage({ id, code: -1, log: [...log, String(err?.message || err)].join("\n"), output: null });
  }
};
