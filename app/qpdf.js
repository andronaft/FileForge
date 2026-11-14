// qpdf (WebAssembly, in a worker) for what pdf-lib cannot do: passwords, permissions and repairing broken files.

let worker = null;
let seq = 0;
const pending = new Map();

function qpdfWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./qpdf-worker.js", import.meta.url));
  worker.onmessage = (e) => {
    const p = pending.get(e.data?.id);
    if (!p) return;
    pending.delete(e.data.id);
    p.resolve(e.data);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    for (const p of pending.values()) p.reject(new Error("The PDF engine failed to start" + (e.message ? `: ${e.message}` : "")));
    pending.clear();
    worker?.terminate(); worker = null;
  };
  return worker;
}

/** Run qpdf on `bytes` (as /in.pdf); `args` should write /out.pdf. Resolves { code, log, output: Uint8Array | null }. */
let queue = Promise.resolve(); // one job at a time: the worker captures qpdf's output per job
export function qpdf(bytes, args) {
  const input = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const job = queue.then(() => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    qpdfWorker().postMessage({ id, input, args }, [input]);
  })).then((res) => ({ code: res.code, log: res.log || "", output: res.output ? new Uint8Array(res.output) : null }));
  queue = job.catch(() => {});
  return job;
}

/** The first meaningful line of qpdf's output, without the "qpdf: /in.pdf:" noise. */
export function qpdfMessage(log) {
  const line = log.split("\n").map((l) => l.trim()).filter((l) => l && !/^WARNING:/.test(l)).pop() || log.trim();
  return line.replace(/^(qpdf|this\.program):\s*/, "").replace(/\/(in|out)\.pdf:?\s*/g, "").trim();
}

export class PdfPasswordError extends Error {}

/**
 * How a PDF is locked: "none", "restricted" (opens without a password, but printing / copying / editing is
 * limited by an owner password) or "password" (cannot be opened without one).
 */
export async function pdfLock(bytes) {
  // exit codes: 0 = a password is needed, 3 = encrypted but opens without one, 2 = not encrypted. This build
  // reports a locked file as an "invalid password" error instead of 0, so look at the message too.
  const { code, log } = await qpdf(bytes, ["--requires-password", "/in.pdf"]);
  return code === 0 || /invalid password/i.test(log) ? "password" : code === 3 ? "restricted" : "none";
}

/** Remove the password and all restrictions. Throws PdfPasswordError when the password is missing or wrong. */
export async function decryptPdf(bytes, password = "") {
  const { code, log, output } = await qpdf(bytes, [`--password=${password}`, "--decrypt", "/in.pdf", "/out.pdf"]);
  if (output && (code === 0 || code === 3)) return output;
  if (/invalid password/i.test(log)) throw new PdfPasswordError(password ? "Wrong password" : "This PDF needs a password to open");
  throw new Error(qpdfMessage(log) || "Could not unlock this PDF");
}
