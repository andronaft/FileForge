// Video tools that need no video encoder: the browser decodes the clip in a <video>, frames are grabbed at exact
// times, and they become an animated GIF (gifenc) or a set of images.
import { el, baseName, field, select, number, checkbox, formatBytes, plural, toast, t } from "../util.js";
import { GIFEncoder, quantize, applyPalette } from "../../vendor/gifenc.esm.js";

const VIDEO_ACCEPT = "video/*,.mp4,.m4v,.mov,.webm,.ogv,.mkv";

/** A <video> for `file`, loaded far enough to know its size and duration. */
async function openVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  await new Promise((resolve, reject) => {
    v.onloadeddata = resolve;
    v.onerror = () => reject(new Error(t("The browser cannot play {name}. MP4 (H.264) and WebM work everywhere; iPhone HEVC videos only in Safari and some Chrome builds.", { name: file.name })));
  });
  if (!Number.isFinite(v.duration)) { // some WebM files report Infinity until the end has been seen
    v.currentTime = 1e9;
    await new Promise((r) => { v.onseeked = r; setTimeout(r, 3000); });
  }
  v.release = () => { v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); };
  return v;
}

/** Seek and wait until the frame at `time` is ready to draw. */
function seek(v, time) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; v.onseeked = null; resolve(); };
    // After "seeked" the frame is normally drawable already; requestVideoFrameCallback confirms it where frames are
    // being presented, but it never fires in a background tab, so it only gets a short head start.
    v.onseeked = () => {
      if (v.requestVideoFrameCallback && !document.hidden) { v.requestVideoFrameCallback(finish); setTimeout(finish, 100); } else finish();
    };
    setTimeout(finish, 4000);
    v.currentTime = Math.min(Math.max(0, time), Math.max(0, v.duration - 0.001));
  });
}

const fmtTime = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, "0")}`; };

/** Start / end inputs with a scrub preview, shared by both tools. End starts at `firstSeconds` (a GIF wants a short
 *  part; frames are taken from the whole video). */
function timeline(root, file, onReady, firstSeconds = Infinity) {
  const start = number(0, { min: 0, step: "0.1", "data-noremember": "" }), end = number(0, { min: 0, step: "0.1", "data-noremember": "" });
  const scrub = el("input", { type: "range", min: 0, max: 1000, value: 0, class: "video-scrub", "aria-label": "Position" });
  const pos = el("span", { class: "stat", text: "0:00.0" });
  const canvas = el("canvas", { class: "video-preview" });
  const info = el("div", { class: "stat", text: "Loading…" });
  const setStart = el("button", { type: "button", class: "small", text: "Start here", onclick: () => { start.value = cur().toFixed(1); start.dispatchEvent(new Event("input")); } });
  const setEnd = el("button", { type: "button", class: "small", text: "End here", onclick: () => { end.value = cur().toFixed(1); end.dispatchEvent(new Event("input")); } });
  root.append(canvas, el("div", { class: "row video-row" }, [scrub, pos, setStart, setEnd]), el("div", { class: "row" }, [field("Start (seconds)", start), field("End (seconds)", end)]), info);
  let v = null, busy = false, wanted = null, shown = 0;
  const cur = () => (v ? (Number(scrub.value) / 1000) * v.duration : 0);
  const paint = async (time) => {
    wanted = time;
    if (busy || !v) return;
    busy = true;
    while (wanted != null) {
      const at = wanted; wanted = null;
      await seek(v, at);
      canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
      pos.textContent = fmtTime(at);
      shown = at;
    }
    busy = false;
  };
  scrub.addEventListener("input", () => paint(cur()));
  let resolveReady, rejectReady;
  const api = {
    start, end, info,
    /** Resolves with the <video> once it can be read; a Run pressed early waits for it instead of failing. */
    ready: new Promise((res, rej) => { resolveReady = res; rejectReady = rej; }),
    get video() { return v; },
    /** The time of the frame in the preview. Not video.currentTime: a Run moves that and leaves the preview alone. */
    shown: () => shown,
    range() {
      const d = v?.duration || 0;
      const a = Math.max(0, Math.min(d, Number(start.value) || 0));
      let b = Number(end.value) || d; b = Math.max(a, Math.min(d, b));
      return [a, b];
    },
  };
  openVideo(file).then((video) => {
    v = video;
    const k = Math.min(1, 640 / v.videoWidth, 300 / v.videoHeight);
    canvas.width = Math.max(1, Math.round(v.videoWidth * k)); canvas.height = Math.max(1, Math.round(v.videoHeight * k));
    start.max = end.max = v.duration.toFixed(1);
    if (!Number(end.value)) end.value = Math.min(Number.isFinite(v.duration) ? v.duration : 5, firstSeconds).toFixed(1);
    paint(0);
    onReady(api);
    resolveReady(v);
  }).catch((err) => { info.textContent = err.message; info.className = "stat bad"; rejectReady(err); });
  api.ready.catch(() => {}); // shown above; run() reports it again if pressed
  return api;
}

// ---------- video → GIF ----------

const gifTool = {
  id: "video-gif",
  title: "Video to GIF",
  description: "Turn a short clip or a screen recording into an animated GIF: pick the part, frame rate and width, speed it up or slow it down. Done on your device, no upload.",
  keywords: ["gif", "animated gif", "mp4 to gif", "mov to gif", "webm to gif", "screen recording", "make gif", "гіф", "гифка", "відео в гіф"],
  accept: VIDEO_ACCEPT,
  multiple: false,
  hint: "One video: MP4, WebM or MOV",
  runLabel: "Make GIF",
  renderOptions(root, files) {
    const fps = select([["5", "5 fps"], ["10", "10 fps"], ["12", "12 fps"], ["15", "15 fps"], ["20", "20 fps"], ["25", "25 fps"]], "10");
    const width = select([["240", "240 px"], ["320", "320 px"], ["480", "480 px"], ["640", "640 px"], ["800", "800 px"], ["0", "Original size"]], "480");
    const speed = select([["0.5", "0.5× (slow motion)"], ["1", "1× (normal)"], ["1.5", "1.5×"], ["2", "2× (faster)"], ["4", "4×"]], "1");
    const colours = select([["256", "256 colours (best)"], ["128", "128 colours"], ["64", "64 colours (smaller)"], ["32", "32 colours"]], "256");
    const loop = checkbox("Loop forever", true);
    const tl = timeline(root, files[0], () => estimate(), 5);
    root.append(el("div", { class: "row" }, [field("Frame rate", fps), field("Width", width), field("Speed", speed), field("Colours", colours), loop.label]));
    const estimate = () => {
      const v = tl.video; if (!v) return;
      const [a, b] = tl.range();
      const frames = Math.ceil(((b - a) / Number(speed.value)) * Number(fps.value));
      const w = Number(width.value) || v.videoWidth, h = Math.round((w / v.videoWidth) * v.videoHeight);
      tl.info.className = frames > 600 ? "stat bad" : "stat";
      tl.info.textContent = `${v.videoWidth} × ${v.videoHeight} · ${fmtTime(v.duration)} · ${t("GIF: {w} × {h}, {n} frames", { w, h, n: frames })}` + (frames > 600 ? ` · ${t("too long: keep it under 600 frames (shorter part, lower frame rate or faster)")}` : "");
    };
    for (const c of [fps, width, speed, tl.start, tl.end]) { c.addEventListener("input", estimate); c.addEventListener("change", estimate); }
    this.opts = { fps, width, speed, colours, loop, tl };
  },
  async run(files, _root, progress) {
    const o = this.opts, v = await o.tl.ready;
    const [a, b] = o.tl.range();
    if (b - a < 0.1) throw new Error("Pick a longer part: the end must be after the start");
    const fps = Number(o.fps.value), speed = Number(o.speed.value);
    const n = Math.max(1, Math.ceil(((b - a) / speed) * fps));
    if (n > 600) throw new Error("Too long for a GIF: keep it under 600 frames");
    const w = Math.min(Number(o.width.value) || v.videoWidth, v.videoWidth), h = Math.max(1, Math.round((w / v.videoWidth) * v.videoHeight));
    const c = el("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    const gif = GIFEncoder();
    const delay = Math.round(1000 / fps);
    const maxColours = Number(o.colours.value);
    progress?.start(n);
    for (let i = 0; i < n; i++) {
      await progress?.tick(`${t("frame {i} of {n}", { i: i + 1, n })}`);
      await seek(v, a + (i / fps) * speed);
      g.drawImage(v, 0, 0, w, h);
      const { data } = g.getImageData(0, 0, w, h);
      const palette = quantize(data, maxColours, { format: "rgb444" });
      gif.writeFrame(applyPalette(data, palette, "rgb444"), w, h, { palette, delay, repeat: o.loop.input.checked ? 0 : -1 });
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: "image/gif" });
    return [{ name: `${baseName(files[0].name)}.gif`, blob, note: `${w} × ${h} · ${plural(n, "frame")} · ${formatBytes(blob.size)}` }];
  },
};

// ---------- video → images ----------

const framesTool = {
  id: "video-frames",
  title: "Video to images",
  description: "Save frames of a video as pictures: one every few seconds, a fixed number spread over the clip, or just the frame you stop at. Good for thumbnails, a still from a family video, or slides from a recorded talk.",
  keywords: ["frames", "screenshot from video", "still", "thumbnail", "extract frames", "video to jpg", "video to png", "кадр", "кадри з відео", "скріншот з відео"],
  accept: VIDEO_ACCEPT,
  multiple: false,
  hint: "One video: MP4, WebM or MOV",
  runLabel: "Save frames",
  renderOptions(root, files) {
    const mode = select([["one", "Only the frame shown above"], ["count", "A number of frames, evenly spread"], ["every", "One frame every N seconds"]], "count");
    const count = number(10, { min: 1, max: 500 }), every = number(5, { min: 0.1, max: 3600, step: "0.1" });
    const format = select([["jpeg", "JPEG"], ["png", "PNG (lossless)"], ["webp", "WebP"]], "jpeg");
    const countField = field("How many", count), everyField = field("Every (seconds)", every);
    const tl = timeline(root, files[0], () => sync());
    root.append(el("div", { class: "row" }, [field("Which frames", mode), countField, everyField, field("Format", format)]));
    const sync = () => { countField.hidden = mode.value !== "count"; everyField.hidden = mode.value !== "every"; };
    mode.addEventListener("change", sync); sync();
    this.opts = { mode, count, every, format, tl };
  },
  async run(files, _root, progress) {
    const o = this.opts, v = await o.tl.ready;
    const [a, b] = o.tl.range();
    let times;
    if (o.mode.value === "one") times = [o.tl.shown()];
    else if (o.mode.value === "every") { const step = Math.max(0.1, Number(o.every.value) || 5); times = []; for (let x = a; x <= b + 1e-6 && times.length < 500; x += step) times.push(x); }
    else { const n = Math.max(1, Math.min(500, Number(o.count.value) || 10)); times = Array.from({ length: n }, (_, i) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1))); }
    const mime = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[o.format.value], ext = o.format.value === "jpeg" ? "jpg" : o.format.value;
    const c = el("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext("2d");
    progress?.start(times.length);
    const out = [], stem = baseName(files[0].name), digits = String(times.length).length;
    for (const [i, time] of times.entries()) {
      await progress?.tick(fmtTime(time));
      await seek(v, time);
      g.drawImage(v, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, mime, 0.92));
      out.push({ name: `${stem}-${String(i + 1).padStart(digits, "0")}-${fmtTime(time).replace(":", "m").replace(".", "s")}.${ext}`, blob, note: `${fmtTime(time)} · ${c.width} × ${c.height}` });
    }
    return out;
  },
};

export const videoTools = [gifTool, framesTool];
export { timeline, openVideo, fmtTime, VIDEO_ACCEPT };
