// Trim and convert audio: a waveform with start and end handles, fades, volume, mono or stereo, and MP3 (lamejs),
// WAV, M4A (AAC) or Opus (the browser's WebCodecs encoders, through Mediabunny). The browser decodes the file
// (decodeAudioData, or Mediabunny for containers decodeAudioData does not take), so the whole recording sits in memory
// as 32-bit samples while it is cut; it is then fed to the encoder a block at a time.
import { el, baseName, field, select, number, checkbox, formatBytes, plural, t } from "../util.js";

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
let lib = null;
const mb = () => (lib ??= import("../../vendor/mediabunny/mediabunny.min.mjs"));

const ACCEPT = "audio/*,video/*,.mp3,.m4a,.m4b,.aac,.wav,.ogg,.oga,.opus,.flac,.weba,.mp4,.m4v,.mov,.webm,.mkv";
// Decoded sound takes 4 bytes per sample and channel: an hour of 44.1 kHz stereo is 1.27 GB. Past about a gigabyte
// (less on a phone) the tab runs out of memory without a useful error, so longer files are refused up front.
const MAX_DECODED = Math.min(1.2 * 1024 ** 3, ((globalThis.navigator?.deviceMemory || 8) * 1024 ** 3) / 6);
const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
const BLOCK = 1152 * 32; // frames per block: a whole number of MP3 frames, under a second of sound
const FORMATS = {
  mp3: { ext: "mp3", mime: "audio/mpeg", label: "MP3" },
  wav: { ext: "wav", mime: "audio/wav", label: "WAV (lossless, large)" },
  m4a: { ext: "m4a", mime: "audio/mp4", label: "M4A (AAC)", codec: "aac" },
  opus: { ext: "opus", mime: "audio/ogg", label: "OGG / Opus", codec: "opus" },
};

// ---------- pure helpers (no DOM; checked in Node) ----------

/** 83.4 → "1:23.4"; an hour or more → "1:02:03.4". */
function fmtClock(sec) {
  const tenths = Math.round(Math.max(0, Number(sec) || 0) * 10);
  const h = Math.floor(tenths / 36000), m = Math.floor((tenths % 36000) / 600), s = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "1:23.4", "83,4", "1:02:03" → seconds; "" → null; anything else → NaN. */
function parseClock(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3) return NaN;
  let total = 0;
  for (const [i, p] of parts.entries()) {
    const last = i === parts.length - 1;
    if (!(last ? /^(\d+\.?\d*|\.\d+)$/ : /^\d+$/).test(p)) return NaN;
    const v = Number(p);
    if (i > 0 && v >= 60) return NaN;
    total = total * 60 + v;
  }
  return total;
}

/**
 * How `n` source channels make `out` (1 or 2): one row of weights per output channel. 5.1 (L R C LFE SL SR, the Web
 * Audio order) folds down the way the Web Audio spec does; other layouts keep their first two channels for stereo
 * and average everything for mono.
 */
function mixMatrix(n, out) {
  const row = (fill) => Array.from({ length: n }, fill);
  let stereo;
  if (n === 1) stereo = [[1], [1]];
  else if (n === 6) stereo = [[1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0], [0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2]];
  else stereo = [row((_, i) => (i === 0 ? 1 : 0)), row((_, i) => (i === 1 ? 1 : 0))];
  if (out === 2) return stereo;
  if (n === 1) return [[1]];
  if (n === 2 || n === 6) return [row((_, i) => (stereo[0][i] + stereo[1][i]) / 2)];
  return [row(() => 1 / n)];
}

/** The loudest sample (absolute value) of frames [from, to) once mixed by `matrix`. */
function peakOf(src, matrix, from, to) {
  let peak = 0;
  for (const w of matrix) {
    const used = w.map((x, k) => [x, src[k]]).filter(([x]) => x);
    if (used.length === 1 && used[0][0] === 1) {
      const s = used[0][1];
      for (let i = from; i < to; i++) { const v = s[i] < 0 ? -s[i] : s[i]; if (v > peak) peak = v; }
      continue;
    }
    for (let i = from; i < to; i++) {
      let v = 0;
      for (const [x, s] of used) v += x * s[i];
      if (v < 0) v = -v;
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Frames [from, to) of `src` (planar Float32Arrays) mixed by `matrix`, times `gain`, with fades, clamped to [-1, 1],
 * in blocks: { data (planar, channel c at c × len), len, at, clipped }. `start` and `end` are where the whole edit
 * begins and ends, so a part of a split file fades only where the selection does. Fades are in frames.
 */
function* blocks(src, matrix, from, to, { gain = 1, fadeIn = 0, fadeOut = 0, start = from, end = to, block = BLOCK } = {}) {
  const outCh = matrix.length;
  for (let at = from; at < to; at += block) {
    const len = Math.min(block, to - at), data = new Float32Array(len * outCh);
    let clipped = 0;
    for (let o = 0; o < outCh; o++) {
      const plane = data.subarray(o * len, (o + 1) * len), w = matrix[o];
      for (let k = 0; k < w.length; k++) {
        const x = w[k], s = src[k];
        if (!x) continue;
        if (x === 1) for (let i = 0; i < len; i++) plane[i] += s[at + i];
        else for (let i = 0; i < len; i++) plane[i] += x * s[at + i];
      }
      const fading = (fadeIn && at - start < fadeIn) || (fadeOut && end - (at + len) < fadeOut);
      for (let i = 0; i < len; i++) {
        let g = gain;
        if (fading) {
          const f = at + i;
          if (f - start < fadeIn) g *= (f - start) / fadeIn;
          if (end - 1 - f < fadeOut) g *= Math.max(0, end - 1 - f) / fadeOut;
        }
        let v = plane[i] * g;
        if (v > 1) { v = 1; clipped++; } else if (v < -1) { v = -1; clipped++; }
        plane[i] = v;
      }
    }
    yield { data, len, at: at - from, clipped };
  }
}

/** Float samples in [-1, 1] as 16-bit integers. */
function toInt16(plane, out = new Int16Array(plane.length)) {
  for (let i = 0; i < plane.length; i++) out[i] = Math.round(plane[i] * 32767);
  return out;
}

/** The 44-byte header of a 16-bit PCM WAV file with `frames` frames. */
function wavHeader(frames, channels, rate) {
  const bytes = frames * channels * 2, v = new DataView(new ArrayBuffer(44));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, bytes, true);
  return v.buffer;
}

/** One block (planar floats) as interleaved little-endian 16-bit samples, the order WAV stores them in. */
function interleave16(data, len, channels) {
  const out = new DataView(new ArrayBuffer(len * channels * 2));
  for (let c = 0; c < channels; c++) {
    const plane = data.subarray(c * len, (c + 1) * len);
    for (let i = 0; i < len; i++) out.setInt16((i * channels + c) * 2, Math.round(plane[i] * 32767), true);
  }
  return new Uint8Array(out.buffer);
}

/** The loudest sample in each of `buckets` equal slices of the sound, over all channels: the waveform's bars. */
function peaks(channels, buckets) {
  const n = channels[0]?.length || 0, out = new Float32Array(buckets);
  if (!n) return out;
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b * n) / buckets), z = Math.max(a + 1, Math.floor(((b + 1) * n) / buckets));
    let m = 0;
    for (const ch of channels) for (let i = a; i < z && i < n; i++) { const v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > m) m = v; }
    out[b] = m;
  }
  return out;
}

/** [from, to) frame ranges of at most `every` frames; a last piece under `minLast` frames joins the one before. */
function splitRanges(from, to, every, minLast = 0) {
  if (!every || every >= to - from) return [[from, to]];
  const out = [];
  for (let a = from; a < to; a += every) out.push([a, Math.min(to, a + every)]);
  if (out.length > 1 && out.at(-1)[1] - out.at(-1)[0] < minLast) out.at(-2)[1] = out.pop()[1];
  return out;
}

const dbOf = (gain) => 20 * Math.log10(gain);
const signed = (x, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

// ---------- reading ----------

/** Duration, channels, sample rate and codec of the sound track, as Mediabunny reads them; {} when it cannot. */
async function probeAudio(file) {
  try {
    const M = await mb();
    const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return { none: true };
      return { duration: await track.computeDuration(), channels: track.numberOfChannels, rate: track.sampleRate, codec: track.codec };
    } finally { input.dispose(); }
  } catch (_) { return {}; }
}

/** Refuses a file whose decoded sound would not fit in memory, before the browser tries and the tab dies. */
function checkSize(file, info, rate) {
  if (!info.duration) return;
  const need = info.duration * rate * Math.max(1, info.channels || 2) * 4;
  if (need <= MAX_DECODED) return;
  const max = MAX_DECODED / (rate * Math.max(1, info.channels || 2) * 4);
  throw new Error(t("{name} is too long to edit here: {length} of sound needs about {size} of memory once unpacked. Up to about {max} works on this device.", { name: file.name, length: fmtClock(info.duration), size: formatBytes(need), max: fmtClock(max).replace(/\.\d$/, "") }));
}

/** Decoding through Mediabunny and WebCodecs, for sound in a container decodeAudioData does not read (MKV, some MOV). */
async function decodeViaMediabunny(file, rate) {
  const M = await mb();
  const input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const chunks = [];
    let total = 0, ch = 0, sr = 0;
    for await (const s of new M.AudioSampleSink(track).samples()) {
      ch ||= s.numberOfChannels; sr ||= s.sampleRate;
      const planes = Array.from({ length: ch }, (_, c) => { const a = new Float32Array(s.numberOfFrames); s.copyTo(a, { planeIndex: c, format: "f32-planar" }); return a; });
      s.close();
      chunks.push(planes); total += planes[0].length;
    }
    if (!total) return null;
    const buf = new AudioBuffer({ length: total, numberOfChannels: ch, sampleRate: sr });
    let at = 0;
    for (const planes of chunks.splice(0)) { planes.forEach((a, c) => buf.copyToChannel(a, c, at)); at += planes[0].length; }
    if (sr === rate) return buf;
    const ctx = new OfflineAudioContext(ch, Math.max(1, Math.ceil((total * rate) / sr)), rate);
    const node = ctx.createBufferSource();
    node.buffer = buf; node.connect(ctx.destination); node.start();
    return await ctx.startRendering();
  } finally { input.dispose(); }
}

/** The whole sound of `file` as an AudioBuffer at `rate` samples per second. */
async function decodeFile(file, rate, info = {}) {
  const bytes = await file.arrayBuffer(); // a failure to read the file is reported as that, not as "no sound"
  try { return await new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes); }
  catch (err) {
    const other = info.none ? null : await decodeViaMediabunny(file, rate).catch(() => null);
    if (other) return other;
    // The same EncodingError comes for a file without sound and for sound too big for memory; only a small file is
    // certain to be the first case.
    if (info.none || (file.size < 8 * 1024 ** 2 && (!err?.name || err.name === "EncodingError"))) throw new Error(t("{name} has no sound track the browser can decode", { name: file.name }));
    throw new Error(t("{name} could not be decoded: it has no sound track the browser understands, or the recording is too long for this device's memory", { name: file.name }));
  }
}

/** The sample rate to decode at: Opus is always 48 kHz; MP3 and AAC keep the file's own rate when they can. */
function rateFor(format, src) {
  if (format === "opus") return 48000;
  if (format === "m4a") return src === 48000 ? 48000 : 44100;
  if (format === "mp3") return LAME_RATES.includes(src) ? src : 44100;
  return src >= 8000 && src <= 192000 ? src : 44100;
}

// ---------- encoders ----------

// Which of the WebCodecs formats this browser can make, checked once: { m4a, opus }.
let encodersP = null;
const encoders = () => (encodersP ??= (async () => {
  if (typeof AudioEncoder === "undefined") return { m4a: false, opus: false };
  try {
    const M = await mb();
    const ok = (codec, sampleRate) => M.canEncodeAudio(codec, { numberOfChannels: 2, sampleRate, bitrate: 128_000 }).catch(() => false);
    return { m4a: await ok("aac", 44100), opus: await ok("opus", 48000) };
  } catch (_) { return { m4a: false, opus: false }; }
})());
let encodersKnown = null;

/** An encoder for one output file: add(planar, len) per block, then finish() → Blob; cancel() on the way out. */
async function makeEncoder(format, { channels, rate, kbps }) {
  if (format === "mp3") {
    const lame = await loadScript("lamejs.iife.js", "lamejs");
    const enc = new lame.Mp3Encoder(channels, rate, kbps), parts = [];
    return {
      add(data, len) {
        const l = toInt16(data.subarray(0, len)), r = channels > 1 ? toInt16(data.subarray(len, 2 * len)) : null;
        // One MP3 frame (1152 samples) at a time: lamejs slows down many times over when fed bigger blocks.
        for (let i = 0; i < len; i += 1152) {
          const chunk = r ? enc.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152)) : enc.encodeBuffer(l.subarray(i, i + 1152));
          if (chunk.length) parts.push(new Uint8Array(chunk));
        }
      },
      finish() { const tail = enc.flush(); if (tail.length) parts.push(new Uint8Array(tail)); return new Blob(parts, { type: FORMATS.mp3.mime }); },
      cancel() {},
    };
  }
  if (format === "wav") {
    const parts = [];
    let frames = 0;
    return {
      add(data, len) { parts.push(interleave16(data, len, channels)); frames += len; },
      finish() { return new Blob([wavHeader(frames, channels, rate), ...parts], { type: FORMATS.wav.mime }); },
      cancel() {},
    };
  }
  if (typeof AudioEncoder === "undefined") throw new Error(t("This browser cannot make {format} files. Pick MP3 or WAV.", { format: FORMATS[format].label }));
  const M = await mb(), codec = FORMATS[format].codec, bitrate = kbps * 1000;
  if (!(await M.canEncodeAudio(codec, { numberOfChannels: channels, sampleRate: rate, bitrate }).catch(() => false))) {
    throw new Error(t("This browser cannot make {format} at {kbps} kbps. Pick a lower bitrate, or MP3.", { format: FORMATS[format].label, kbps }));
  }
  const target = new M.BufferTarget();
  const output = new M.Output({ format: format === "m4a" ? new M.Mp4OutputFormat({ fastStart: "in-memory" }) : new M.OggOutputFormat(), target });
  const source = new M.AudioSampleSource({ codec, bitrate });
  output.addAudioTrack(source);
  await output.start();
  let frames = 0;
  return {
    async add(data, len) {
      const sample = new M.AudioSample({ data, format: "f32-planar", numberOfChannels: channels, sampleRate: rate, timestamp: frames / rate });
      frames += len;
      try { await source.add(sample); } finally { sample.close(); }
    },
    async finish() { source.close(); await output.finalize(); return new Blob([target.buffer], { type: FORMATS[format].mime }); },
    cancel() { output.cancel().catch(() => {}); },
  };
}

// ---------- the waveform ----------

/**
 * The waveform of `file` with start and end handles bound to the two time fields, and a button that plays the part
 * between them. Fills `info` with what is in the file. Returns { stop() } for the next render.
 */
function waveform(root, file, startIn, endIn, info, onLength) {
  const canvas = el("canvas", { class: "audio-wave", role: "img", "aria-label": "Waveform: drag the handles to choose the part to keep" });
  const play = el("button", { type: "button", class: "small", text: "Play selection", disabled: true });
  const pos = el("span", { class: "stat", text: "" });
  root.append(canvas, el("div", { class: "row video-row" }, [play, pos]));
  const url = URL.createObjectURL(file);
  const audio = el("audio", { preload: "auto", src: url });
  let bars = null, duration = 0, dragging = null, playing = false, alive = true, frame = 0;

  const sel = () => {
    const a = parseClock(startIn.value), b = parseClock(endIn.value);
    const s = Number.isFinite(a) && a !== null ? Math.min(Math.max(0, a), duration) : 0;
    const e = Number.isFinite(b) && b !== null ? Math.min(Math.max(s, b), duration) : duration;
    return [s, e];
  };
  const draw = () => {
    const dpr = globalThis.devicePixelRatio || 1;
    const W = Math.max(100, Math.round((canvas.clientWidth || 800) * dpr)), H = Math.max(40, Math.round((canvas.clientHeight || 120) * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const g = canvas.getContext("2d"), css = getComputedStyle(canvas);
    const accent = css.getPropertyValue("--accent").trim() || "#ff8c28", muted = css.getPropertyValue("--muted").trim() || "#5d6474", ink = css.getPropertyValue("--text").trim() || css.color || "#1b1f27";
    g.clearRect(0, 0, W, H);
    if (!bars || !duration) return;
    const [a, b] = sel(), xa = (a / duration) * W, xb = (b / duration) * W, mid = H / 2;
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((x / W) * bars.length), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / W) * bars.length));
      let m = 0;
      for (let i = i0; i < i1; i++) if (bars[i] > m) m = bars[i];
      const h = Math.max(dpr, m * (mid - 2 * dpr));
      const inside = x >= xa && x <= xb;
      g.globalAlpha = inside ? 1 : 0.35;
      g.fillStyle = inside ? accent : muted;
      g.fillRect(x, mid - h, 1, h * 2);
    }
    g.globalAlpha = 1;
    g.fillStyle = ink;
    for (const x of [xa, xb]) {
      g.fillRect(Math.round(x - dpr), 0, Math.round(2 * dpr), H);
      g.fillRect(Math.round(x - 5 * dpr), 0, Math.round(10 * dpr), Math.round(10 * dpr)); // a grip to aim a finger at
      g.fillRect(Math.round(x - 5 * dpr), H - Math.round(10 * dpr), Math.round(10 * dpr), Math.round(10 * dpr));
    }
    if (playing) { g.fillStyle = muted; g.fillRect(Math.round((audio.currentTime / duration) * W), 0, Math.max(1, Math.round(dpr)), H); }
  };
  const update = () => { draw(); const [a, b] = sel(); onLength(duration ? b - a : null); };

  // Dragging: the handle nearer to the pointer follows it, never closer than 0.1 s to the other one.
  const timeAt = (e) => { const r = canvas.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))) * duration; };
  const moveTo = (e) => {
    const x = timeAt(e), [a, b] = sel();
    if (dragging === "start") startIn.value = fmtClock(Math.min(x, Math.max(0, b - 0.1)));
    else endIn.value = fmtClock(Math.max(x, Math.min(duration, a + 0.1)));
    update();
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!duration) return;
    const x = timeAt(e), [a, b] = sel();
    dragging = Math.abs(x - a) < Math.abs(x - b) || (x < a) ? "start" : "end";
    canvas.setPointerCapture?.(e.pointerId);
    moveTo(e);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => { if (dragging) moveTo(e); });
  const drop = () => { if (!dragging) return; (dragging === "start" ? startIn : endIn).dispatchEvent(new Event("change", { bubbles: true })); dragging = null; };
  canvas.addEventListener("pointerup", drop);
  canvas.addEventListener("pointercancel", drop);
  for (const input of [startIn, endIn]) {
    input.addEventListener("input", () => { input.toggleAttribute("aria-invalid", Number.isNaN(parseClock(input.value))); update(); });
    input.addEventListener("change", () => { const v = parseClock(input.value); if (Number.isFinite(v) && v !== null && duration) input.value = fmtClock(Math.min(v, duration)); update(); });
  }

  // Playing: from the start handle to the end handle, the original sound (fades and volume come when saving).
  const stop = () => { playing = false; audio.pause(); cancelAnimationFrame(frame); play.textContent = t("Play selection"); pos.textContent = ""; draw(); };
  const tickPlay = () => {
    if (!playing) return;
    if (!canvas.isConnected) { release(); return; } // the tool was left while it played
    const [, b] = sel();
    if (audio.currentTime >= b || audio.ended) { stop(); return; }
    pos.textContent = fmtClock(audio.currentTime);
    draw();
    frame = requestAnimationFrame(tickPlay);
  };
  audio.addEventListener("timeupdate", () => { if (playing && audio.currentTime >= sel()[1]) stop(); }); // rAF sleeps in a background tab
  play.addEventListener("click", async () => {
    if (playing) { stop(); return; }
    const [a] = sel();
    audio.currentTime = a;
    playing = true;
    play.textContent = t("Stop");
    try { await audio.play(); tickPlay(); } catch (_) { stop(); }
  });
  audio.addEventListener("error", () => { play.hidden = true; });
  audio.addEventListener("loadedmetadata", () => { play.disabled = false; });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null;
  ro?.observe(canvas);
  const release = () => { if (!alive) return; alive = false; playing = false; audio.pause(); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); ro?.disconnect(); };

  info.textContent = t("Reading the sound…");
  (async () => {
    const meta = await probeAudio(file);
    if (!alive) return;
    // A small, 8 kHz copy is enough to draw from and takes a sixth of the memory of the real thing.
    let buf;
    try {
      if (meta.duration && meta.duration * 8000 * (meta.channels || 2) * 4 > MAX_DECODED) throw new Error(t("{name} is too long to show its waveform on this device", { name: file.name }));
      buf = await decodeFile(file, 8000, meta);
    } catch (err) { if (alive) { info.textContent = err.message; info.className = "stat bad"; } return; }
    if (!alive) return;
    duration = buf.length / buf.sampleRate;
    const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
    bars = peaks(chans, 4000);
    const p = Math.max(...bars) || 1;
    for (let i = 0; i < bars.length; i++) bars[i] /= p; // a quiet recording still fills the height
    const s = parseClock(startIn.value), e = parseClock(endIn.value);
    if (!Number.isFinite(s) || s === null) startIn.value = fmtClock(0);
    if (!Number.isFinite(e) || e === null || e > duration) endIn.value = fmtClock(duration);
    const ch = meta.channels || buf.numberOfChannels;
    info.textContent = [fmtClock(meta.duration || duration), ch === 1 ? t("mono") : ch === 2 ? t("stereo") : t("{n} channels", { n: ch }), meta.rate ? `${(meta.rate / 1000).toLocaleString()} kHz` : null, formatBytes(file.size)].filter(Boolean).join(" · ");
    update();
  })();
  return { stop: release };
}

// ---------- the tool ----------

const audioEditTool = {
  id: "audio-edit",
  title: "Trim & convert audio",
  description: "Cut the part you need out of a song, podcast or voice message on its waveform, fade it in and out, make it louder or quieter, and save it as MP3, WAV, M4A or Opus. Good for ringtones. Also takes the sound of a video.",
  keywords: ["trim audio", "cut audio", "cut mp3", "audio cutter", "mp3 cutter", "ringtone", "fade in", "fade out", "normalize", "normalise", "louder", "volume", "split audio", "wav to mp3", "flac to mp3", "m4a", "ogg", "opus", "podcast", "voice message",
    "обрізати аудіо", "обрізати mp3", "вирізати фрагмент пісні", "рингтон", "гучність", "голосніше", "нормалізувати", "розділити аудіо", "конвертувати аудіо", "затухання",
    "обрезать аудио", "обрезать mp3", "обрезать песню", "нарезать музыку", "громкость", "конвертировать аудио", "рінгтон"],
  accept: ACCEPT,
  hint: "Audio files (MP3, M4A, WAV, OGG, FLAC) or a video for its sound",
  runLabel: "Save audio",
  renderOptions(root, files) {
    this.wave?.stop();
    this.wave = null;
    const one = files.length === 1;
    const once = { "data-noremember": "", spellcheck: "false", inputmode: "decimal", autocomplete: "off" };
    const start = el("input", { type: "text", placeholder: "0:00.0", ...once }), end = el("input", { type: "text", placeholder: one ? "0:00.0" : "end", ...once });
    const length = el("span", { class: "stat", text: "" });
    const fadeIn = number(0, { min: 0, max: 30, step: "0.5" }), fadeOut = number(0, { min: 0, max: 30, step: "0.5" });
    const volume = number(0, { min: -12, max: 12, step: "1" });
    const normalise = checkbox("Normalise loudness (peaks to −1 dB)", false);
    const format = select(Object.entries(FORMATS).filter(([k]) => !encodersKnown || k === "mp3" || k === "wav" || encodersKnown[k]).map(([k, f]) => [k, f.label]), "mp3");
    const kbps = select([["96", "96 kbps (voice)"], ["128", "128 kbps"], ["192", "192 kbps (music)"], ["256", "256 kbps"], ["320", "320 kbps (best)"]], "192");
    const channels = select([["keep", "As in the file"], ["mono", "Mono"], ["stereo", "Stereo"]], "keep");
    const split = checkbox("Split into parts", false);
    const every = number(10, { min: 0.5, max: 600, step: "0.5" });
    const info = el("div", { class: "stat video-probe" });
    const kbpsField = field("Bitrate", kbps), everyField = field("Every (minutes)", every), volumeField = field("Volume (dB)", volume);
    const sync = () => {
      if (!format.value) format.value = "mp3"; // a remembered format this browser turned out not to make
      kbpsField.hidden = format.value === "wav";
      everyField.hidden = !split.input.checked;
      volume.disabled = normalise.input.checked;
      volumeField.style.opacity = normalise.input.checked ? "0.5" : "";
    };
    for (const c of [format, split.input, normalise.input]) c.addEventListener("change", sync);
    const showLength = (s) => { length.textContent = s == null ? "" : t("Selection: {length}", { length: fmtClock(s) }); };
    if (one) this.wave = waveform(root, files[0], start, end, info, showLength);
    root.append(
      el("div", { class: "row" }, [field("Start", start, one ? "Drag the handles or type m:ss.s" : "The same for every file"), field("End", end, one ? null : "Empty: to the end of each file"), one ? length : null]),
      el("div", { class: "row" }, [field("Fade in (seconds)", fadeIn), field("Fade out (seconds)", fadeOut), volumeField, normalise.label]),
      el("div", { class: "row" }, [field("Format", format), kbpsField, field("Channels", channels)]),
      el("div", { class: "row" }, [split.label, everyField]),
      info,
    );
    if (!one) {
      info.textContent = t("{files}: each one is cut, faded and converted with the same settings.", { files: plural(files.length, "file") });
      for (const input of [start, end]) input.addEventListener("input", () => input.toggleAttribute("aria-invalid", Number.isNaN(parseClock(input.value))));
    }
    this.opts = { start, end, fadeIn, fadeOut, volume, normalise, format, kbps, channels, split, every };
    setTimeout(sync, 0); // after the remembered options are restored
    // The first time, AAC and Opus are offered until the check says otherwise: a remembered choice must find its option.
    if (!encodersKnown) encoders().then((e) => {
      encodersKnown = e;
      for (const o of [...format.options]) if (o.value !== "mp3" && o.value !== "wav" && !e[o.value]) o.remove();
      if (!format.value) { format.value = "mp3"; format.dispatchEvent(new Event("change", { bubbles: true })); }
    });
  },
  async run(files, _root, progress) {
    const o = this.opts, fmt = o.format.value || "mp3", F = FORMATS[fmt], kbps = Number(o.kbps.value) || 192;
    const a0 = parseClock(o.start.value), b0 = parseClock(o.end.value);
    if (Number.isNaN(a0) || Number.isNaN(b0)) throw new Error("Type the start and end like 1:23.4 (minutes:seconds) or in seconds");
    const fadeInS = Math.max(0, Number(o.fadeIn.value) || 0), fadeOutS = Math.max(0, Number(o.fadeOut.value) || 0);
    const norm = o.normalise.input.checked, db = Math.max(-12, Math.min(12, Number(o.volume.value) || 0));
    const everyMin = o.split.input.checked ? Math.max(0.5, Number(o.every.value) || 10) : 0;
    const signal = progress?.signal, out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const meta = await probeAudio(file), rate = rateFor(fmt, meta.rate);
      checkSize(file, meta, rate);
      progress?.note?.(t("Decoding {name}…", { name: file.name }));
      let buf = await decodeFile(file, rate, meta);
      if (signal?.aborted) throw new Error("Cancelled");
      const total = buf.length, dur = total / rate;
      // The end field shows tenths and the waveform comes from a smaller copy: an end within 0.1 s of the end is the end.
      const a = Math.max(0, Math.min(a0 ?? 0, dur)), b = Math.max(a, b0 == null || b0 >= dur - 0.1 ? dur : b0);
      if (b - a < 0.1) throw new Error(t("Nothing left of {name} between that start and end", { name: file.name }));
      const from = Math.round(a * rate), to = Math.round(b * rate);
      const src = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
      buf = null;
      const outCh = o.channels.value === "mono" ? 1 : o.channels.value === "stereo" ? 2 : Math.min(2, src.length);
      const matrix = mixMatrix(src.length, outCh);
      let gain = 10 ** (db / 20);
      if (norm) { const p = peakOf(src, matrix, from, to); gain = p > 1e-5 ? 10 ** (-1 / 20) / p : 1; }
      // Fades fit inside the part: each at most half of it.
      const half = (to - from) / 2, fadeIn = Math.min(half, Math.round(fadeInS * rate)), fadeOut = Math.min(half, Math.round(fadeOutS * rate));
      const ranges = splitRanges(from, to, Math.round(everyMin * 60 * rate), rate); // a last piece under a second joins the one before
      if (ranges.length > 500) throw new Error("That makes more than 500 parts: pick a longer piece length");
      const trimmed = a > 0.05 || b < dur - 0.05;
      const edited = trimmed || fadeIn || fadeOut || Math.abs(gain - 1) > 1e-3 || outCh !== Math.min(2, src.length) || src.length > 2 || F.mime === file.type;
      const stem = baseName(file.name), digits = String(ranges.length).length;
      let clipped = 0, lastYield = performance.now();
      for (const [pi, [pa, pb]] of ranges.entries()) {
        const enc = await makeEncoder(fmt, { channels: outCh, rate, kbps });
        try {
          for (const blk of blocks(src, matrix, pa, pb, { gain, fadeIn, fadeOut, start: from, end: to })) {
            await enc.add(blk.data, blk.len);
            clipped += blk.clipped;
            if (performance.now() - lastYield > 100) { // let the page breathe, show how far it is, and hear Cancel
              if (signal?.aborted) throw new Error("Cancelled");
              const done = (pa - from + blk.at + blk.len) / (to - from);
              progress?.part?.(done, `${file.name} · ${Math.round(done * 100)}%`);
              await new Promise((r) => setTimeout(r, 0));
              lastYield = performance.now();
            }
          }
        } catch (err) { enc.cancel(); throw err; }
        const blob = await enc.finish();
        const notes = [fmtClock((pb - pa) / rate), outCh === 1 ? t("mono") : t("stereo"), fmt === "wav" ? `${rate / 1000} kHz` : `${kbps} kbps`, formatBytes(blob.size)];
        if (ranges.length > 1) notes.unshift(t("part {i} of {n}", { i: pi + 1, n: ranges.length }));
        if (norm && Math.abs(gain - 1) > 1e-3) notes.push(t("normalised: {db} dB", { db: signed(dbOf(gain)) }));
        else if (db) notes.push(`${signed(db, 0)} dB`);
        if (pi === ranges.length - 1 && clipped > rate / 100) notes.push(t("some peaks were cut off: lower the volume"));
        const name = ranges.length > 1 ? `${stem}-part${String(pi + 1).padStart(digits, "0")}.${F.ext}` : `${stem}${edited ? "-edited" : ""}.${F.ext}`;
        out.push({ name, blob, note: notes.join(" · ") });
      }
    }
    return out;
  },
};

export const audioEditTools = [audioEditTool];
export { fmtClock, parseClock, mixMatrix, peakOf, blocks, toInt16, wavHeader, interleave16, peaks, splitRanges, rateFor };
