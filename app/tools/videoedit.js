// Video tools that re-encode: compress, convert, trim and edit. The browser's own WebCodecs encoders do the work and
// Mediabunny reads and writes the containers (MP4, MOV, WebM, MKV). The library is loaded on first use.
import { el, baseName, field, select, number, checkbox, formatBytes, t } from "../util.js";
import { timeline, fmtTime, VIDEO_ACCEPT } from "./video.js";

const ACCEPT = `${VIDEO_ACCEPT},.ts,.mts,.m2ts`;
const MB = 1024 * 1024;
let lib = null;
const mb = () => (lib ??= import("../../vendor/mediabunny/mediabunny.min.mjs"));

// Per container: the codecs it may carry as they are, and the order to encode in (the one that plays most widely first).
const FORMATS = {
  mp4: { ext: "mp4", mime: "video/mp4", label: "MP4", make: (M) => new M.Mp4OutputFormat({ fastStart: "in-memory" }), keepV: ["avc", "hevc", "av1", "vp9"], keepA: ["aac", "mp3", "opus", "flac"], encV: ["avc", "hevc"], encA: ["aac", "opus"] },
  mov: { ext: "mov", mime: "video/quicktime", label: "MOV", make: (M) => new M.MovOutputFormat({ fastStart: "in-memory" }), keepV: ["avc", "hevc", "prores"], keepA: ["aac", "mp3"], encV: ["avc", "hevc"], encA: ["aac"] },
  webm: { ext: "webm", mime: "video/webm", label: "WebM", make: (M) => new M.WebMOutputFormat(), keepV: ["vp9", "vp8", "av1"], keepA: ["opus", "vorbis"], encV: ["vp9", "vp8", "av1"], encA: ["opus", "vorbis"] },
  mkv: { ext: "mkv", mime: "video/x-matroska", label: "MKV", make: (M) => new M.MkvOutputFormat(), keepV: ["avc", "hevc", "vp9", "vp8", "av1"], keepA: ["aac", "opus", "mp3", "vorbis", "flac"], encV: ["avc", "vp9", "hevc"], encA: ["aac", "opus"] },
};
// Codecs that play nearly everywhere in these containers; HEVC in MP4 does not on many Windows and Android devices.
const EVERYWHERE = { mp4: ["avc"], mov: ["avc"], webm: ["vp9", "vp8"], mkv: ["avc"] };
const CODEC_NAME = { avc: "H.264", hevc: "HEVC (H.265)", vp9: "VP9", vp8: "VP8", av1: "AV1", prores: "ProRes", aac: "AAC", opus: "Opus", mp3: "MP3", vorbis: "Vorbis", flac: "FLAC", ac3: "AC-3", eac3: "E-AC-3" };
const codecName = (c) => CODEC_NAME[c] || (c ? String(c).toUpperCase() : "?");

function needWebCodecs() {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined" || typeof AudioEncoder === "undefined") {
    throw new Error("This browser cannot encode video. Use a recent Chrome, Edge or Firefox on a computer, or Safari 26 or later.");
  }
}

const openInput = (M, file) => new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) });

/** What is in a video file: duration, picture size (as displayed, rotation applied), codecs. */
async function probe(file) {
  const M = await mb();
  const input = openInput(M, file);
  try {
    const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new Error(t("{name} has neither a picture nor sound that FileForge can read", { name: file.name }));
    return {
      duration: await input.computeDuration(),
      width: video?.displayWidth || 0, height: video?.displayHeight || 0,
      vcodec: video?.codec || null, acodec: audio?.codec || null, channels: audio?.numberOfChannels || 0,
      video: !!video, audio: !!audio,
    };
  } catch (err) {
    if (/unsupported|unrecogni[sz]ed|not supported/i.test(String(err?.message))) throw new Error(t("{name} is not a video FileForge can read. MP4, MOV, WebM and MKV work; AVI and WMV do not.", { name: file.name }));
    throw err;
  } finally { input.dispose(); }
}

const describe = (i, file) => [fmtTime(i.duration), i.video ? `${i.width} × ${i.height}` : t("sound only"), [i.vcodec, i.acodec].filter(Boolean).map(codecName).join(" + "), formatBytes(file.size)].join(" · ");

/** Width and height (even numbers, as encoders want) with the short side at most `short` pixels. */
function fitShort(w, h, short) {
  const k = short && Math.min(w, h) > short ? short / Math.min(w, h) : 1;
  const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(w), height: even(h), scaled: k < 1 };
}

const REASON = {
  undecodable_source_codec: "the browser cannot decode {codec}",
  unknown_source_codec: "the format of this track is unknown",
  no_encodable_target_codec: "the browser cannot encode it for {format}",
  cannot_copy: "it cannot be copied into {format} as it is",
};
const whyDropped = (d, format) => t(REASON[d.reason] || "it could not be converted", { codec: codecName(d.track.codec), format: FORMATS[format].label });

/**
 * Runs one conversion of `file` into `format` and returns { blob, dropped }. `video` and `audio` are Mediabunny track
 * options, `trim` an optional { start, end }. Cancel (progress.signal) stops the encoder.
 */
async function run1(file, format, { video = {}, audio = {}, trim } = {}, progress) {
  needWebCodecs();
  const M = await mb();
  const input = openInput(M, file), target = new M.BufferTarget();
  const output = new M.Output({ format: FORMATS[format].make(M), target });
  const signal = progress?.signal;
  try {
    const conv = await M.Conversion.init({ input, output, video, audio, trim, showWarnings: false });
    const lostVideo = conv.discardedTracks.find((d) => d.track.type === "video" && d.reason !== "discarded_by_user");
    if (!conv.isValid || lostVideo) {
      const d = lostVideo || conv.discardedTracks.find((x) => x.reason !== "discarded_by_user");
      throw new Error(d ? t("{name}: the picture cannot be converted, {why}", { name: file.name, why: whyDropped(d, format) }) : t("{name} cannot be converted to {format}", { name: file.name, format: FORMATS[format].label }));
    }
    const stop = () => { conv.cancel().catch(() => {}); };
    signal?.addEventListener("abort", stop, { once: true });
    conv.onProgress = (p) => progress?.part?.(p, `${file.name} · ${Math.round(p * 100)}%`);
    try { await conv.execute(); } finally { signal?.removeEventListener("abort", stop); }
    if (signal?.aborted) throw new Error("Cancelled");
    const dropped = conv.discardedTracks.filter((d) => d.reason !== "discarded_by_user");
    return { blob: new Blob([target.buffer], { type: FORMATS[format].mime }), dropped };
  } catch (err) {
    if (signal?.aborted) throw new Error("Cancelled");
    // The encoder ran out of memory or the browser gave up on a codec: say so in words, not "EncodingError".
    if (/memory|allocation/i.test(String(err?.message))) throw new Error(t("{name} is too big for this device's memory. Try a smaller size or trim it first.", { name: file.name }));
    throw err;
  } finally { input.dispose(); }
}

/** The first codecs this browser can encode for `format`, falling back to WebM when it cannot make the container at all. */
async function pickCodecs(format, { width, height, audio }) {
  const M = await mb();
  const order = (f) => [...new Set([...(EVERYWHERE[f] || []), ...FORMATS[f].encV])];
  let v = await M.getFirstEncodableVideoCodec(order(format), { width, height });
  let a = audio ? await M.getFirstEncodableAudioCodec(FORMATS[format].encA, { numberOfChannels: 2, sampleRate: 48000 }) : null;
  if (v && (!audio || a)) return { format, v, a, switched: false };
  if (format !== "webm") {
    const w = await pickCodecs("webm", { width, height, audio });
    if (w.v) return { ...w, switched: true };
  }
  throw new Error("This browser has no video encoder for this size. Try a smaller size, or Chrome or Edge on a computer.");
}

const audioNote = (dropped, format) => dropped.filter((d) => d.track.type === "audio").map((d) => t("sound left out: {why}", { why: whyDropped(d, format) }));
const saving = (blob, file) => (blob.size < file.size ? `−${Math.min(99, Math.round((1 - blob.size / file.size) * 100))}% (${t("was {size}", { size: formatBytes(file.size) })})` : t("was {size}", { size: formatBytes(file.size) }));

/** Shows what is in each file under the options, once Mediabunny has read it; a later render takes over. */
function probeInto(tool, files, box, onFirst) {
  const token = (tool.token = {});
  box.textContent = t("Reading the video…");
  (async () => {
    const lines = [];
    for (const f of files.slice(0, 6)) {
      try { const i = await probe(f); if (f === files[0]) onFirst?.(i); lines.push(`${f.name}: ${describe(i, f)}`); }
      catch (err) { lines.push(err.message); }
      if (tool.token !== token) return;
      box.textContent = lines.join("\n");
    }
    if (files.length > 6) box.textContent += `\n${t("… and {n} more", { n: files.length - 6 })}`;
  })();
}

// ---------- compress ----------

const LEVELS = { high: "QUALITY_HIGH", medium: "QUALITY_MEDIUM", low: "QUALITY_LOW", lowest: "QUALITY_VERY_LOW" };

const compressVideoTool = {
  id: "video-compress",
  title: "Compress video",
  description: "Make a video smaller for a messenger, e-mail or an upload form: pick a quality, or a size limit such as 25 MB for e-mail, and FileForge lowers the bitrate and, if needed, the resolution.",
  keywords: ["compress video", "reduce video size", "smaller video", "shrink mp4", "video size", "telegram", "whatsapp", "discord", "email video", "mb", "стиснути відео", "зменшити відео", "розмір відео", "для телеграм", "для вайбер"],
  accept: ACCEPT,
  hint: "Videos: MP4, MOV (iPhone), WebM, MKV",
  runLabel: "Compress",
  renderOptions(root, files) {
    const mode = select([["medium", "Balanced"], ["high", "High quality"], ["low", "Small file"], ["lowest", "Smallest file"], ["fit", "Fit into a size limit"]], "medium");
    const limit = select([["8", "8 MB"], ["10", "10 MB"], ["16", "16 MB"], ["20", "20 MB (Discord)"], ["25", "25 MB (e-mail)"], ["50", "50 MB"], ["100", "100 MB (WhatsApp)"], ["custom", "Other…"]], "25");
    const custom = number(20, { min: 1, step: "1" });
    const size = select([["auto", "Automatic"], ["0", "Keep the original"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"]], "auto");
    const sound = select([["keep", "Keep"], ["mono", "Mono, smaller"], ["none", "Remove the sound"]], "keep");
    const format = select([["mp4", "MP4 (plays everywhere)"], ["webm", "WebM"]], "mp4");
    const limitField = field("Size limit", limit), customField = field("MB", custom);
    const info = el("div", { class: "stat video-probe" });
    const sync = () => { limitField.hidden = mode.value !== "fit"; customField.hidden = mode.value !== "fit" || limit.value !== "custom"; };
    mode.addEventListener("change", sync); limit.addEventListener("change", sync);
    root.append(
      el("div", { class: "row" }, [field("Quality", mode), limitField, customField]),
      el("div", { class: "row" }, [field("Picture size", size, "Automatic: the original size, or smaller when a size limit needs it"), field("Sound", sound), field("Format", format)]),
      info,
    );
    this.opts = { mode, limit, custom, size, sound, format };
    setTimeout(sync, 0); // after the remembered options are restored
    probeInto(this, files, info);
  },
  async run(files, _root, progress) {
    needWebCodecs();
    const M = await mb(), o = this.opts, out = [];
    const fit = o.mode.value === "fit";
    const limit = fit ? (o.limit.value === "custom" ? Number(o.custom.value) || 0 : Number(o.limit.value)) * MB : 0;
    progress?.start(files.length);
    for (const file of files) {
      await progress?.tick(file.name);
      const info = await probe(file);
      if (!info.video) throw new Error(t("{name} has no picture: use Video to MP3 for sound files", { name: file.name }));
      const keepSound = info.audio && o.sound.value !== "none", mono = o.sound.value === "mono" || info.channels === 1;
      let abit = !keepSound ? 0 : mono ? 48_000 : 96_000, vbit = 0, short = o.size.value === "auto" ? 0 : Number(o.size.value);
      if (fit) {
        if (file.size <= limit * 0.98 && o.size.value === "auto" && o.sound.value === "keep") { out.push({ name: file.name, blob: file, note: t("already under {limit}: kept as is", { limit: formatBytes(limit) }) }); continue; }
        const total = (limit * 8 * 0.93) / Math.max(0.5, info.duration); // a few percent for the container and the encoder's aim
        if (keepSound && total < 400_000) abit = mono ? 32_000 : 64_000;
        vbit = total - abit;
        if (vbit < 90_000) {
          const min = Math.ceil(((90_000 + abit) * info.duration) / 8 / 0.93);
          throw new Error(t("{name} is too long to fit into {limit}: even a small picture needs about {min}. Pick a bigger limit, or trim the video first.", { name: file.name, limit: formatBytes(limit), min: formatBytes(min) }));
        }
        // Fewer pixels for fewer bits: a 720p picture at 300 kbit/s is a smear, 480p at the same rate looks fine.
        if (o.size.value === "auto") short = vbit >= 2_500_000 ? 1080 : vbit >= 1_200_000 ? 720 : vbit >= 600_000 ? 540 : vbit >= 300_000 ? 480 : 360;
      }
      let dims = fitShort(info.width, info.height, short);
      const pick = await pickCodecs(o.format.value, { width: dims.width, height: dims.height, audio: keepSound });
      const audioOpts = keepSound ? { codec: pick.a, numberOfChannels: mono ? 1 : undefined, quality: fit ? new M.Quality({ bitrate: abit }) : M[LEVELS[o.mode.value]], forceTranscode: true } : { discard: true };
      let best = null, bestDims = dims, dropped = [];
      for (let attempt = 0; attempt < (fit ? 5 : 1); attempt++) {
        const quality = fit ? new M.Quality({ bitrate: Math.round(vbit) }) : M[LEVELS[o.mode.value]];
        const video = { codec: pick.v, quality, forceTranscode: true, ...(dims.scaled ? { width: dims.width, height: dims.height, fit: "fill" } : {}) };
        const r = await run1(file, pick.format, { video, audio: audioOpts }, progress);
        if (!best || r.blob.size < best.size) { best = r.blob; bestDims = dims; dropped = r.dropped; }
        if (!fit || r.blob.size <= limit) break;
        // A few percent over: the encoder missed the bitrate, aim a little lower. Far over: the picture is too busy for
        // that many pixels (an encoder has a floor it cannot go under), so take a smaller size as well.
        const over = r.blob.size / limit;
        vbit *= (1 / over) * (over < 1.1 ? 0.9 : 0.92);
        if (over > 1.25 && o.size.value === "auto") {
          const next = [1080, 720, 540, 480, 360, 240].find((s) => s < Math.min(dims.width, dims.height));
          if (next) dims = fitShort(info.width, info.height, next);
          vbit = Math.max(vbit, 90_000);
        }
        if (vbit < 60_000) break;
      }
      dims = bestDims;
      if (!fit && best.size >= file.size) { out.push({ name: file.name, blob: file, note: t("already compact: kept as is") }); continue; }
      const notes = [saving(best, file), `${dims.width} × ${dims.height}`, codecName(pick.v)];
      if (limit) notes.push(best.size <= limit ? t("fits into {limit}", { limit: formatBytes(limit) }) : t("still over {limit}", { limit: formatBytes(limit) }));
      if (pick.switched) notes.push(t("saved as WebM: this browser cannot make MP4"));
      notes.push(...audioNote(dropped, pick.format));
      out.push({ name: `${baseName(file.name)}-compressed.${FORMATS[pick.format].ext}`, blob: best, note: notes.join(" · ") });
    }
    return out;
  },
};

// ---------- convert ----------

const convertVideoTool = {
  id: "video-convert",
  title: "Convert video",
  description: "MOV, MKV or WebM to MP4, MP4 to WebM, and back. When the video inside already fits the new format it is copied as it is, in seconds and with no quality lost.",
  keywords: ["convert video", "mov to mp4", "mkv to mp4", "webm to mp4", "mp4 to webm", "iphone video", "hevc", "h264", "container", "конвертувати відео", "mov в mp4", "перетворити відео"],
  accept: ACCEPT,
  hint: "Videos: MOV (iPhone), MKV, WebM, MP4",
  runLabel: "Convert",
  renderOptions(root, files) {
    const format = select([["mp4", "MP4"], ["webm", "WebM"], ["mov", "MOV"], ["mkv", "MKV"]], "mp4");
    const play = checkbox("Make it play everywhere (H.264 or VP9; slower if the video has to be re-encoded)", true);
    const info = el("div", { class: "stat video-probe" });
    root.append(el("div", { class: "row" }, [field("Convert to", format), play.label]), info);
    this.opts = { format, play };
    probeInto(this, files, info);
  },
  async run(files, _root, progress) {
    needWebCodecs();
    const M = await mb(), o = this.opts, out = [];
    progress?.start(files.length);
    for (const file of files) {
      await progress?.tick(file.name);
      const info = await probe(file);
      let format = o.format.value;
      const okV = o.play.input.checked ? EVERYWHERE[format] : FORMATS[format].keepV;
      const copyV = !info.video || okV.includes(info.vcodec), copyA = !info.audio || FORMATS[format].keepA.includes(info.acodec);
      let video = {}, audio = {}, pick = null;
      if (!copyV || !copyA) {
        pick = await pickCodecs(format, { width: info.width, height: info.height, audio: info.audio && !copyA });
        format = pick.format;
        if (!copyV || pick.switched) video = { codec: pick.v, quality: M.QUALITY_HIGH };
        if ((!copyA || pick.switched) && info.audio) audio = { codec: pick.a, quality: M.QUALITY_HIGH };
      }
      const r = await run1(file, format, { video, audio }, progress);
      const notes = [formatBytes(r.blob.size)];
      notes.push(copyV && copyA && !pick?.switched ? t("copied as it was, no quality lost") : t("re-encoded to {codecs}", { codecs: [video.codec, audio.codec].filter(Boolean).map(codecName).join(" + ") }));
      if (pick?.switched) notes.push(t("saved as WebM: this browser cannot make MP4"));
      notes.push(...audioNote(r.dropped, format));
      out.push({ name: `${baseName(file.name)}.${FORMATS[format].ext}`, blob: r.blob, note: notes.join(" · ") });
    }
    return out;
  },
};

// ---------- trim and edit ----------

const SHAPES = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 };

const trimVideoTool = {
  id: "video-trim",
  title: "Trim & edit video",
  description: "Cut a part out of a video, turn it, mirror it, crop it to 9:16 for Reels and TikTok or to a square, make it smaller or take the sound out.",
  keywords: ["trim video", "cut video", "clip", "rotate video", "flip video", "crop video", "9:16", "vertical", "reels", "tiktok", "shorts", "square video", "mute", "remove sound", "обрізати відео", "вирізати", "повернути відео", "без звуку", "вертикальне відео"],
  accept: ACCEPT,
  multiple: false,
  hint: "One video: MP4, MOV, WebM, MKV",
  runLabel: "Save video",
  renderOptions(root, files) {
    // Turning, mirroring, cropping and muting belong to this one video: they are not carried over to the next.
    const once = { "data-noremember": "" };
    const rotate = select([["0", "No"], ["90", "90° right"], ["180", "180°"], ["270", "90° left"]], "0", once);
    const flip = checkbox("Mirror", false, once);
    const shape = select([["", "Keep"], ["9:16", "9:16 vertical (Reels, TikTok, Shorts)"], ["1:1", "1:1 square"], ["4:5", "4:5 (Instagram feed)"], ["16:9", "16:9 widescreen"]], "", once);
    const size = select([["0", "Keep the original"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"]], "0");
    const sound = checkbox("Remove the sound", false, once);
    const format = select([["mp4", "MP4"], ["webm", "WebM"]], "mp4");
    this.tl = timeline(root, files[0], (api) => { api.info.hidden = true; }); // its "Loading…" line has nothing more to say here
    const info = el("div", { class: "stat video-probe" });
    root.append(
      el("div", { class: "row" }, [field("Turn", rotate), field("Shape", shape), field("Picture size", size), field("Format", format)]),
      el("div", { class: "row" }, [flip.label, sound.label]),
      info,
    );
    this.opts = { rotate, flip, shape, size, sound, format };
    this.info = null;
    probeInto(this, files, info, (i) => { this.info = i; });
  },
  async run(files, _root, progress) {
    needWebCodecs();
    const M = await mb(), o = this.opts, file = files[0];
    progress?.start(1);
    await progress?.tick(file.name);
    const info = this.info || await probe(file);
    if (!info.video) throw new Error(t("{name} has no picture: use Video to MP3 for sound files", { name: file.name }));
    // The preview may be unable to play the file (HEVC in some browsers): then the typed seconds count.
    let [a, b] = this.tl.video ? this.tl.range() : [Number(this.tl.start.value) || 0, Number(this.tl.end.value) || info.duration];
    a = Math.max(0, Math.min(a, info.duration)); b = Math.max(a, Math.min(b || info.duration, info.duration));
    if (b - a < 0.1) throw new Error("Pick a longer part: the end must be after the start");
    const rot = Number(o.rotate.value) || 0, turned = rot === 90 || rot === 270;
    let w = turned ? info.height : info.width, h = turned ? info.width : info.height;
    const video = { forceTranscode: false };
    if (rot) video.rotate = rot;
    if (o.flip.input.checked) video.flip = true;
    const ratio = SHAPES[o.shape.value];
    if (ratio) {
      // The middle of the picture, as large as the shape allows; even numbers for the encoder.
      const cw = Math.min(w, h * ratio), ch = Math.min(h, w / ratio), even = (n) => Math.max(2, Math.floor(n / 2) * 2);
      video.crop = { left: even((w - cw) / 2), top: even((h - ch) / 2), width: even(cw), height: even(ch) };
      w = video.crop.width; h = video.crop.height;
    }
    const dims = fitShort(w, h, Number(o.size.value));
    if (dims.scaled) Object.assign(video, { width: dims.width, height: dims.height, fit: "fill" });
    const trimmed = a > 0.05 || b < info.duration - 0.05;
    const changes = ratio || dims.scaled || trimmed;
    let format = o.format.value, pick = null;
    // Turning and mirroring alone can be written as a note in the file; anything else means new frames.
    if (changes || !FORMATS[format].keepV.includes(info.vcodec)) {
      pick = await pickCodecs(format, { width: dims.width, height: dims.height, audio: info.audio && !o.sound.input.checked });
      format = pick.format;
      Object.assign(video, { codec: pick.v, quality: M.QUALITY_HIGH });
    }
    const audio = o.sound.input.checked || !info.audio ? { discard: true } : FORMATS[format].keepA.includes(info.acodec) && !pick?.switched ? {} : { codec: pick?.a, quality: M.QUALITY_HIGH };
    const r = await run1(file, format, { video, audio, trim: trimmed ? { start: a, end: b } : undefined }, progress);
    const notes = [fmtTime(b - a), `${dims.width} × ${dims.height}`, formatBytes(r.blob.size)];
    if (o.sound.input.checked) notes.push(t("no sound"));
    if (pick?.switched) notes.push(t("saved as WebM: this browser cannot make MP4"));
    notes.push(...audioNote(r.dropped, format));
    return [{ name: `${baseName(file.name)}-edited.${FORMATS[format].ext}`, blob: r.blob, note: notes.join(" · ") }];
  },
};

export const videoEditTools = [compressVideoTool, convertVideoTool, trimVideoTool];
