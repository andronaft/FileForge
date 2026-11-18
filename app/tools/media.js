// Read QR codes and barcodes from pictures, and take the sound out of a video (or convert audio) to MP3 / WAV.
import { el, baseName, field, select, number, checkbox, formatBytes, plural, toast, t } from "../util.js";
import { loadImage, dims, makeCanvas } from "./image.js";
import { copyButton } from "./data.js";

const VENDOR = new URL("../../vendor/", import.meta.url).href;
const loading = {};
function loadScript(name, global) {
  if (globalThis[global]) return Promise.resolve(globalThis[global]);
  loading[name] ??= new Promise((resolve, reject) => {
    const s = el("script", { src: VENDOR + name });
    s.onload = () => (globalThis[global] ? resolve(globalThis[global]) : reject(new Error(`${name} did not load`)));
    s.onerror = () => { delete loading[name]; reject(new Error(t("Could not load {name}", { name }))); };
    document.head.append(s);
  });
  return loading[name];
}

// ---------- read QR codes ----------

/** What a decoded string is, so it can be shown as more than raw text. */
export function describeCode(text) {
  const s = text.trim();
  if (/^WIFI:/i.test(s)) {
    const get = (k) => (s.match(new RegExp(`(?:^WIFI:|;)${k}:((?:\\\\.|[^;])*)`, "i"))?.[1] || "").replace(/\\(.)/g, "$1");
    return { kind: "Wi-Fi network", rows: [["Network", get("S")], ["Password", get("P")], ["Security", get("T") || "none"]].filter((r) => r[1]) };
  }
  if (/^https?:\/\//i.test(s) && !/\s/.test(s)) return { kind: "Link", url: s };
  if (/^mailto:/i.test(s)) return { kind: "E-mail", rows: [["To", decodeURIComponent(s.slice(7).split("?")[0])]] };
  if (/^(tel|sms|smsto):/i.test(s)) return { kind: "Phone", rows: [["Number", s.replace(/^\w+:/, "").split(/[:?]/)[0]]] };
  if (/^geo:/i.test(s)) return { kind: "Location", rows: [["Coordinates", s.slice(4).split("?")[0]]] };
  if (/^BEGIN:VCARD/i.test(s) || /^MECARD:/i.test(s)) {
    const pick = (re) => s.match(re)?.[1]?.trim();
    return { kind: "Contact", rows: [["Name", pick(/(?:^|\n)FN[^:\n]*:(.+)/i) || pick(/(?:MECARD:|;)N:([^;]+)/i)], ["Phone", pick(/(?:^|\n)TEL[^:\n]*:(.+)/i) || pick(/;TEL:([^;]+)/i)], ["E-mail", pick(/(?:^|\n)EMAIL[^:\n]*:(.+)/i) || pick(/;EMAIL:([^;]+)/i)]].filter((r) => r[1]) };
  }
  return { kind: "Text" };
}

/** Every code found in an image: [{ text, format }]. BarcodeDetector where the browser has it, jsQR otherwise. */
async function readCodes(file) {
  const img = await loadImage(file);
  const d = dims(img), k = Math.min(1, 2400 / Math.max(d.w, d.h));
  const c = makeCanvas(d.w * k, d.h * k);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  if ("BarcodeDetector" in globalThis) {
    try {
      const found = await new BarcodeDetector().detect(c);
      if (found.length) return found.map((f) => ({ text: f.rawValue, format: f.format.replace(/_/g, " ").toUpperCase() }));
    } catch (_) { /* fall through to jsQR */ }
  }
  const jsQR = await loadScript("jsqr.js", "jsQR");
  // A code that fills the frame, a small one in a big screenshot, a blurry phone photo: try a few sizes.
  for (const scale of [1, 0.5, 2, 0.25]) {
    const w = Math.round(c.width * scale), h = Math.round(c.height * scale);
    if (w < 40 || h < 40 || w * h > 16e6) continue;
    const s = makeCanvas(w, h), sg = s.getContext("2d", { willReadFrequently: true });
    sg.imageSmoothingEnabled = scale < 1;
    sg.drawImage(c, 0, 0, w, h);
    const hit = jsQR(sg.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (hit?.data) return [{ text: hit.data, format: "QR CODE" }];
  }
  return [];
}

const qrReadTool = {
  id: "qr-read",
  title: "Read QR code",
  description: "Find out what a QR code or barcode says without pointing a phone at the screen: drop a screenshot or a photo, see the link, Wi-Fi password, contact or text, and copy it. Links are shown, never opened for you.",
  keywords: ["qr reader", "scan qr", "decode qr", "barcode", "qr scanner", "wifi password", "зчитати qr", "сканувати qr", "прочитати qr", "штрихкод", "считать qr"],
  accept: "image/*",
  noAutoDownload: true,
  hint: "A screenshot or photo with a QR code; paste one with Ctrl+V",
  runLabel: "Save as text",
  renderOptions(root, files) {
    const box = el("div", { class: "qr-results" });
    root.append(box);
    this.found = [];
    this.ready = (async () => {
      for (const file of files) {
        const card = el("div", { class: "qr-card" }, [el("div", { class: "stat", text: `${file.name}: ${t("Reading…")}` })]);
        box.append(card);
        let codes = [];
        try { codes = await readCodes(file); } catch (err) { card.replaceChildren(el("div", { class: "stat bad", text: `${file.name}: ${err.message}` })); continue; }
        if (!codes.length) { card.replaceChildren(el("div", { class: "stat bad", text: `${file.name}: ${t("no QR code or barcode found. Crop closer to the code, or use a sharper picture.")}` })); continue; }
        card.replaceChildren(...codes.map((code) => {
          this.found.push({ file: file.name, ...code });
          const info = describeCode(code.text);
          const value = el("textarea", { readonly: true, spellcheck: "false", rows: Math.min(8, Math.max(1, code.text.split("\n").length)), class: "qr-text" });
          value.value = code.text;
          const head = el("div", { class: "qr-head" }, [el("strong", { text: info.kind }), el("span", { class: "stat", text: `${code.format} · ${file.name}` })]);
          const parts = [head];
          if (info.rows?.length) parts.push(el("table", { class: "meta" }, info.rows.map(([k2, v]) => el("tr", {}, [el("th", { text: k2 }), el("td", {}, [v])]))));
          if (info.url) {
            let host = "";
            try { host = new URL(info.url).hostname; } catch (_) { /* odd URL */ }
            parts.push(el("div", { class: "stat" }, [t("Leads to the site"), " ", el("strong", {}, [host || "?"]), ". ", t("Check that it is the site you expect before opening it.")]));
          }
          parts.push(value, el("div", { class: "actions" }, [
            copyButton(() => code.text, "Copy"),
            info.rows?.find((r) => r[0] === "Password") ? copyButton(() => info.rows.find((r) => r[0] === "Password")[1], "Copy password") : null,
            info.url ? el("a", { class: "button-link", href: info.url, target: "_blank", rel: "noopener noreferrer", text: "Open link" }) : null,
          ]));
          return el("div", { class: "qr-item" }, parts);
        }));
      }
    })();
  },
  async run() {
    await this.ready;
    if (!this.found?.length) throw new Error("No code was found in these pictures");
    const text = this.found.map((f) => (this.found.length > 1 ? `# ${f.file} (${f.format})\n` : "") + f.text).join("\n\n") + "\n";
    return [{ name: "qr-codes.txt", blob: new Blob([text], { type: "text/plain" }), note: plural(this.found.length, "code") }];
  },
};

// ---------- audio from video ----------

function wavBlob(channels, sampleRate) {
  const n = channels[0].length, ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += 2) v.setInt16(o, channels[c][i], true);
  return new Blob([buf], { type: "audio/wav" });
}

const fmtDur = (s) => { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s - m * 60)).padStart(2, "0")}`; };

const audioTool = {
  id: "audio-extract",
  title: "Video to MP3",
  description: "Take the sound out of a video as MP3 or WAV, or convert an audio file (M4A, OGG, WAV, FLAC) to MP3. Trim the start and end if you only need a part.",
  keywords: ["mp3", "audio", "extract audio", "video to audio", "mp4 to mp3", "sound", "wav", "m4a to mp3", "convert audio", "voice message", "звук", "аудіо", "музика", "витягти звук", "звук из видео"],
  accept: "video/*,audio/*,.mp4,.m4v,.mov,.webm,.mkv,.mp3,.m4a,.wav,.ogg,.oga,.opus,.flac,.aac",
  hint: "Videos or audio files",
  runLabel: "Convert",
  renderOptions(root, files) {
    const format = select([["mp3-128", "MP3, 128 kbps (voice, small)"], ["mp3-192", "MP3, 192 kbps (music)"], ["mp3-320", "MP3, 320 kbps (best)"], ["wav", "WAV (lossless, large)"]], "mp3-192");
    const mono = checkbox("Mono (half the size, fine for speech)", false);
    const start = number("", { min: 0, step: "0.1", placeholder: "0", "data-noremember": "" }), end = number("", { min: 0, step: "0.1", placeholder: "end", "data-noremember": "" });
    root.append(el("div", { class: "row" }, [field("Format", format), mono.label]),
      el("div", { class: "row" }, [field("Start (seconds)", start), field("End (seconds)", end)]),
      el("div", { class: "stat", text: `${plural(files.length, "file")} · ${formatBytes(files.reduce((s, f) => s + f.size, 0))}` }));
    this.opts = { format, mono, start, end };
  },
  async run(files, _root, progress) {
    const o = this.opts, wantMp3 = o.format.value !== "wav", kbps = Number(o.format.value.split("-")[1]) || 192;
    const lame = wantMp3 ? await loadScript("lamejs.iife.js", "lamejs") : null;
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      if (file.size > 1.5 * 1024 ** 3) throw new Error(t("{name} is too big to decode in the browser (over 1.5 GB)", { name: file.name }));
      let audio;
      try { audio = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await file.arrayBuffer()); }
      catch (_) { throw new Error(t("{name} has no sound track the browser can decode", { name: file.name })); }
      const rate = audio.sampleRate;
      const from = Math.max(0, Math.min(audio.length, Math.round((Number(o.start.value) || 0) * rate)));
      const to = Math.max(from, Math.min(audio.length, o.end.value ? Math.round(Number(o.end.value) * rate) : audio.length));
      if (to - from < rate / 10) throw new Error(t("Nothing left of {name} between that start and end", { name: file.name }));
      const src = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c).subarray(from, to));
      const n = to - from, chCount = o.mono.input.checked || src.length === 1 ? 1 : 2;
      const pcm = Array.from({ length: chCount }, () => new Int16Array(n));
      for (let i = 0; i < n; i++) {
        if (chCount === 1) { let s = 0; for (const ch of src) s += ch[i]; s /= src.length; pcm[0][i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767))); }
        else for (let c = 0; c < 2; c++) pcm[c][i] = Math.max(-32768, Math.min(32767, Math.round(src[c][i] * 32767)));
      }
      let blob;
      if (wantMp3) {
        // One MP3 frame (1152 samples) at a time: lamejs slows down many times over when fed bigger blocks.
        const enc = new lame.Mp3Encoder(chCount, rate, kbps), parts = [], BLOCK = 1152;
        let lastYield = performance.now();
        for (let i = 0; i < n; i += BLOCK) {
          const chunk = chCount === 1 ? enc.encodeBuffer(pcm[0].subarray(i, i + BLOCK)) : enc.encodeBuffer(pcm[0].subarray(i, i + BLOCK), pcm[1].subarray(i, i + BLOCK));
          if (chunk.length) parts.push(new Uint8Array(chunk));
          if (performance.now() - lastYield > 120) { // let the page breathe and show how far it is
            progress?.note?.(`${file.name} · ${Math.round((i / n) * 100)}%`);
            await new Promise((r) => setTimeout(r, 0));
            lastYield = performance.now();
          }
        }
        const tail = enc.flush();
        if (tail.length) parts.push(new Uint8Array(tail));
        blob = new Blob(parts, { type: "audio/mpeg" });
      } else blob = wavBlob(pcm, rate);
      out.push({ name: `${baseName(file.name)}.${wantMp3 ? "mp3" : "wav"}`, blob, note: `${fmtDur(n / rate)} · ${chCount === 1 ? t("mono") : t("stereo")}${wantMp3 ? ` · ${kbps} kbps` : ""} · ${formatBytes(blob.size)}` });
    }
    return out;
  },
};

export const qrTools = [qrReadTool];
export const audioTools = [audioTool];
