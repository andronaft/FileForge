// Compress an animated GIF for Discord, Slack, Telegram, e-mail or a README: fewer colours, fewer frames, a smaller
// width, and frames that only store the pixels that changed. Its own GIF decoder (ImageDecoder is missing in Firefox
// and hides disposal and offsets), gifenc for the encoding. Nothing leaves the page.
import { el, field, select, number, checkbox, formatBytes, baseName, plural, t } from "../util.js";
import { GIFEncoder, quantize, applyPalette } from "../../vendor/gifenc.esm.js";

// ---------- decoding ----------

const MAX_RGBA = 1.5 * 1024 ** 3; // all frames composited at full size: refuse above this
const MAX_PIXELS = 64e6; // one frame

const u16 = (b, p) => b[p] | (b[p + 1] << 8);

/** Concatenated data sub-blocks starting at `p`; returns [bytes, position after the terminator]. */
function subBlocks(b, p) {
  const parts = [];
  let total = 0;
  while (p < b.length) {
    const n = b[p++];
    if (!n) break;
    parts.push(b.subarray(p, Math.min(p + n, b.length)));
    total += n;
    p += n;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return [out.subarray(0, o), p];
}

function skipBlocks(b, p) {
  while (p < b.length) { const n = b[p++]; if (!n) break; p += n; }
  return p;
}

/**
 * The structure of a GIF without decoding any pixels: screen size, loop count (null = play once) and every frame
 * with its rectangle, palette, delay (hundredths of a second), disposal, transparent index and LZW data.
 * A truncated file keeps the frames before the cut.
 */
export function parseGif(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 13 || String.fromCharCode(b[0], b[1], b[2]) !== "GIF") throw new Error(t("Not a GIF file"));
  let width = u16(b, 6), height = u16(b, 8);
  const packed = b[10];
  let p = 13, global = null;
  if (packed & 0x80) { const n = 3 * (2 << (packed & 7)); global = b.subarray(p, p + n); p += n; }
  const frames = [];
  let loop = null, gce = null;
  while (p < b.length) {
    const kind = b[p++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4) {
        const f = b[p + 1];
        gce = { disposal: (f >> 2) & 7, delay: u16(b, p + 2), transparent: f & 1 ? b[p + 4] : -1 };
        p = skipBlocks(b, p);
      } else if (label === 0xff) {
        const n = b[p];
        const id = String.fromCharCode(...b.subarray(p + 1, p + 1 + Math.min(n, 11)));
        const [data, next] = subBlocks(b, p + 1 + n);
        if ((id === "NETSCAPE2.0" || id === "ANIMEXTS1.0") && data[0] === 1 && data.length >= 3) loop = u16(data, 1);
        p = next;
      } else p = skipBlocks(b, p);
    } else if (kind === 0x2c) {
      if (p + 9 > b.length) break;
      const x = u16(b, p), y = u16(b, p + 2), w = u16(b, p + 4), h = u16(b, p + 6), f = b[p + 8];
      p += 9;
      let palette = global;
      if (f & 0x80) { const n = 3 * (2 << (f & 7)); palette = b.subarray(p, p + n); p += n; }
      const minCode = b[p++];
      const [data, next] = subBlocks(b, p);
      p = next;
      frames.push({
        x, y, w, h, interlaced: !!(f & 0x40), palette, minCode, data,
        delay: gce ? gce.delay : 0, disposal: gce ? gce.disposal : 0, transparent: gce ? gce.transparent : -1,
      });
      gce = null;
    } else break; // garbage after the last frame
  }
  if (!width || !height) { // a broken screen descriptor: take the frames' extent
    for (const f of frames) { width = Math.max(width, f.x + f.w); height = Math.max(height, f.y + f.h); }
  }
  return { width, height, loop, frames };
}

/** LZW-decoded colour indices of one frame; returns the number of pixels actually present (short on a cut file). */
function lzw(data, minCode, out) {
  const count = out.length;
  if (minCode < 1 || minCode > 11) return 0;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  const clear = 1 << minCode, eoi = clear + 1;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCode + 1, mask = (1 << size) - 1, avail = clear + 2, old = -1, first = 0;
  let datum = 0, bits = 0, pos = 0, n = 0;
  while (n < count) {
    while (bits < size) {
      if (pos >= data.length) return n;
      datum |= data[pos++] << bits;
      bits += 8;
    }
    let code = datum & mask;
    datum >>>= size;
    bits -= size;
    if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; avail = clear + 2; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) {
      if (code >= clear) break; // corrupt
      out[n++] = first = code;
      old = code;
      continue;
    }
    if (code > avail) break; // corrupt
    const inCode = code;
    let top = 0;
    if (code === avail) { stack[top++] = first; code = old; }
    while (code >= clear) { stack[top++] = suffix[code]; code = prefix[code]; }
    first = suffix[code];
    stack[top++] = first;
    if (avail < 4096) {
      prefix[avail] = old; suffix[avail] = first; avail++;
      if (avail > mask && size < 12) { size++; mask = (1 << size) - 1; }
    }
    old = inCode;
    while (top > 0 && n < count) out[n++] = stack[--top];
  }
  return n;
}

const GREY = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3)); // no palette at all: a grey ramp

/** Source row of each decoded row of an interlaced frame. */
function interlaceRows(h) {
  const rows = [];
  for (const [start, stepY] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += stepY) rows.push(y);
  return rows;
}

/**
 * Full frames one by one, as the browser shows them: offsets, transparency and disposal 1/2/3 applied.
 * The yielded `rgba` is the same buffer every time: copy it to keep it.
 */
export function* compositeFrames(gif) {
  const W = gif.width, H = gif.height;
  const canvas = new Uint8Array(W * H * 4);
  let last = null, saved = null;
  for (const [i, f] of gif.frames.entries()) {
    if (last?.disposal === 2) { // background: transparent, as every browser does it
      for (let y = Math.max(0, last.y); y < Math.min(H, last.y + last.h); y++) {
        canvas.fill(0, (y * W + Math.max(0, last.x)) * 4, (y * W + Math.min(W, last.x + last.w)) * 4);
      }
    } else if (last?.disposal === 3 && saved) canvas.set(saved);
    if (f.disposal === 3) { if (saved) saved.set(canvas); else saved = canvas.slice(); }
    const idx = new Uint8Array(f.w * f.h);
    const n = lzw(f.data, f.minCode, idx);
    const pal = f.palette || GREY, colours = pal.length / 3;
    const rows = f.interlaced ? interlaceRows(f.h) : null;
    for (let r = 0, k = 0; r < f.h && k < n; r++) {
      const y = f.y + (rows ? rows[r] : r);
      if (y >= H) { k += f.w; continue; }
      for (let c = 0; c < f.w && k < n; c++, k++) {
        const x = f.x + c, ci = idx[k];
        if (x >= W || ci === f.transparent || ci >= colours) continue;
        const o = (y * W + x) * 4;
        canvas[o] = pal[ci * 3]; canvas[o + 1] = pal[ci * 3 + 1]; canvas[o + 2] = pal[ci * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    last = f;
    yield { rgba: canvas, delay: f.delay, index: i };
  }
}

/** Every frame of a GIF composited into its own RGBA copy: { width, height, loop, frames: [{ rgba, delay }] }. */
export function decodeGif(bytes) {
  const gif = parseGif(bytes);
  const frames = [];
  for (const f of compositeFrames(gif)) frames.push({ rgba: f.rgba.slice(), delay: f.delay });
  return { width: gif.width, height: gif.height, loop: gif.loop, frames };
}

// ---------- resizing (plain arrays: works without a canvas) ----------

/** Weights of the source pixels covering each output pixel (area average). */
function coverage(src, dst) {
  const k = src / dst, out = [];
  for (let i = 0; i < dst; i++) {
    const a = i * k, b = a + k, list = [];
    for (let s = Math.floor(a); s < Math.min(src, Math.ceil(b)); s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 1e-6) list.push(s, w / k);
    }
    out.push(list);
  }
  return out;
}

/** Area-average downscale of RGBA; colours are weighted by alpha, and alpha snaps to 0/255 as GIF needs. */
export function downscale(rgba, w, h, w2, h2) {
  if (w2 === w && h2 === h) return rgba;
  const cx = coverage(w, w2), cy = coverage(h, h2);
  const tmp = new Float32Array(w2 * h * 4); // premultiplied, after the horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w2; x++) {
      const list = cx[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < list.length; j += 2) {
        const o = (y * w + list[j]) * 4, wa = list[j + 1] * rgba[o + 3];
        r += rgba[o] * wa; g += rgba[o + 1] * wa; b += rgba[o + 2] * wa; a += wa;
      }
      const o = (y * w2 + x) * 4;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
    }
  }
  const out = new Uint8Array(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    const list = cy[y];
    for (let x = 0; x < w2; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < list.length; j += 2) {
        const o = (list[j] * w2 + x) * 4, wy = list[j + 1];
        r += tmp[o] * wy; g += tmp[o + 1] * wy; b += tmp[o + 2] * wy; a += tmp[o + 3] * wy;
      }
      const o = (y * w2 + x) * 4;
      if (a >= 127.5) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); out[o + 3] = 255; }
    }
  }
  return out;
}

// ---------- encoding ----------

/** What a browser waits for a frame: 0 and 1 hundredths are shown as 10. Used when frames are merged. */
const shown = (d) => (d <= 1 ? 10 : d);

/** The frames to encode: every `step`-th source frame at `w2` × `h2`, its delay the sum of the frames it replaces. */
function* outputFrames(gif, w2, h2, step) {
  const n = gif.frames.length;
  for (const f of compositeFrames(gif)) {
    if (f.index % step) continue;
    let delay = f.delay;
    if (step > 1) { delay = 0; for (let j = f.index; j < Math.min(n, f.index + step); j++) delay += shown(gif.frames[j].delay); }
    yield { rgba: downscale(f.rgba, gif.width, gif.height, w2, h2), delay };
  }
}

const LOSSY = 3 * 10 * 10; // squared RGB distance under which a pixel counts as unchanged in lossy mode

/**
 * Encode full RGBA frames into a GIF. Each frame stores only the pixels that changed since the last one (the rest is
 * a transparent index over the frame below, which LZW packs to almost nothing) with its own palette of those pixels.
 * Frames that change nothing are merged into the one before. A frame that needs a pixel to turn transparent gets a
 * cleared canvas (the previous frame is disposed to background). `loop`: null = play once, 0 = forever.
 */
export async function encodeGif(frames, w, h, { colors = 256, lossy = false, loop = 0, check } = {}) {
  const gif = GIFEncoder();
  const total = w * h, ref = new Uint8Array(total * 4); // what is on screen, in source colours (alpha 0 = clear)
  const thr = lossy ? LOSSY : 0;
  const changed = new Uint8Array(total);
  let pending = null, i = 0;
  const write = (fr, dispose) => {
    gif.writeFrame(fr.index, w, h, {
      palette: fr.palette, delay: fr.delay * 10, repeat: loop == null ? -1 : loop, dispose,
      transparent: fr.tIndex >= 0, transparentIndex: Math.max(0, fr.tIndex),
      colorDepth: Math.max(1, Math.ceil(Math.log2(fr.palette.length))),
    });
  };
  for await (const f of frames) {
    await check?.(i++);
    const src = f.rgba;
    let clear = false;
    if (pending) {
      for (let p = 0; p < total; p++) if (!src[p * 4 + 3] && ref[p * 4 + 3]) { clear = true; break; }
      if (clear) { write(pending, 2); pending = null; ref.fill(0); }
    }
    let count = 0, opaque = 0;
    for (let p = 0, o = 0; p < total; p++, o += 4) {
      let c = 0;
      if (src[o + 3]) {
        opaque++;
        if (!ref[o + 3]) c = 1;
        else {
          const dr = src[o] - ref[o], dg = src[o + 1] - ref[o + 1], db = src[o + 2] - ref[o + 2];
          c = dr * dr + dg * dg + db * db > thr ? 1 : 0;
        }
      }
      changed[p] = c;
      count += c;
    }
    if (pending && !count) { pending.delay = shown(pending.delay) + shown(f.delay); continue; } // nothing new on screen
    if (pending) { write(pending, 1); pending = null; }
    const compact = new Uint8Array(count * 4);
    for (let p = 0, k = 0; p < total; p++) {
      if (!changed[p]) continue;
      const o = p * 4;
      compact[k++] = src[o]; compact[k++] = src[o + 1]; compact[k++] = src[o + 2]; compact[k++] = 255;
      ref[o] = src[o]; ref[o + 1] = src[o + 1]; ref[o + 2] = src[o + 2]; ref[o + 3] = 255;
    }
    const needT = count < total;
    const palette = count ? quantize(compact, needT ? colors - 1 : colors) : [];
    const tIndex = needT ? palette.length : -1;
    if (needT) palette.push([0, 0, 0]);
    while (palette.length < 2) palette.push([0, 0, 0]);
    const mapped = count ? applyPalette(compact, palette.slice(0, needT ? tIndex : palette.length)) : null;
    const index = new Uint8Array(total);
    if (needT) index.fill(tIndex);
    for (let p = 0, k = 0; p < total; p++) if (changed[p]) index[p] = mapped[k++];
    pending = { index, palette, tIndex, delay: f.delay };
  }
  if (pending) write(pending, 1);
  gif.finish();
  return gif.bytes();
}

// ---------- the tool ----------

const TARGETS = [["none", "No limit"], ["8", "8 MB (Discord)"], ["10", "10 MB"], ["5", "5 MB"], ["2", "2 MB"], ["1", "1 MB"], ["custom", "Your own size"]];
const ORDINAL = { 2: "every 2nd frame", 3: "every 3rd frame" };

/** Output size for a maximum width, keeping the shape. */
const sizeFor = (gif, maxW) => {
  const w2 = Math.max(1, Math.min(gif.width, Math.round(maxW)));
  return [w2, Math.max(1, Math.round((w2 / gif.width) * gif.height))];
};

/** What these settings changed compared with the source, for the note. */
function describe(gif, s, colorsSet) {
  const [w2, h2] = sizeFor(gif, s.width);
  const parts = [`${w2} × ${h2} px`];
  if (s.colors < 256 || colorsSet) parts.push(plural(s.colors, "colour"));
  if (s.step > 1) parts.push(t(ORDINAL[s.step]));
  if (s.lossy) parts.push(t("lossy"));
  return parts.join(" · ");
}

/** "8 MB" for a target in bytes (decimal megabytes, as the services count them). */
const mb = (bytes) => `${+(bytes / 1e6).toPrecision(3)} MB`;

const gifCompressTool = {
  id: "gif-compress",
  title: "Compress GIF",
  description: "Make an animated GIF smaller for Discord, Slack, Telegram, e-mail or a README: pick a size limit and the tool finds settings that fit, or set the width, colours and frame rate yourself. Speed, transparency and looping stay as they were.",
  keywords: ["compress gif", "gif compressor", "optimize gif", "gif optimizer", "reduce gif size", "smaller gif", "shrink gif", "discord gif", "gif size", "стиснути gif", "стиснути гіф", "зменшити gif", "зменшити гіф", "оптимізувати gif", "розмір gif", "сжать gif", "сжать гиф", "уменьшить gif", "уменьшить гиф", "оптимизировать gif", "размер gif"],
  accept: "image/gif,.gif",
  hint: "Animated or still GIFs, several at once",
  runLabel: "Compress",
  renderOptions(root, files) {
    const target = select(TARGETS, "none");
    const custom = number("", { min: 0.05, step: "0.1", placeholder: "MB" });
    const customField = field("Size limit (MB)", custom); customField.hidden = true;
    const width = select([["keep", "Keep"], ["800", "800 px"], ["640", "640 px"], ["480", "480 px"], ["320", "320 px"]], "keep");
    const colors = select([["256", "256 colours"], ["128", "128 colours"], ["64", "64 colours"], ["32", "32 colours"]], "256");
    const frames = select([["1", "Keep every frame"], ["2", "Every 2nd frame"], ["3", "Every 3rd frame"]], "1");
    const lossy = checkbox("Lossy: ignore tiny changes between frames", false);
    const stat = el("div", { class: "stat", text: "" });
    target.addEventListener("change", () => { customField.hidden = target.value !== "custom"; });
    root.append(
      el("div", { class: "row" }, [field("Size limit", target, "Width, colours and frames are lowered until the GIF fits"), customField]),
      el("div", { class: "row" }, [field("Max width", width), field("Colours", colors), field("Frame rate", frames, "Dropped frames add their time to the ones kept: the speed stays the same")]),
      el("div", { class: "row" }, [lossy.label]),
      stat,
    );
    this.opts = { target, custom, width, colors, frames, lossy };
    // A quick look at the first file: parsing is cheap, no pixels are decoded.
    files[0]?.arrayBuffer().then((buf) => {
      const g = parseGif(new Uint8Array(buf));
      stat.textContent = `${files[0].name}: ${g.width} × ${g.height} px · ${plural(g.frames.length, "frame")} · ${formatBytes(files[0].size)}`;
    }).catch(() => {});
  },
  async run(files, _root, progress) {
    const o = this.opts;
    const limit = o.target.value === "custom" ? Math.round((Number(o.custom.value) || 0) * 1e6) : o.target.value === "none" ? 0 : Number(o.target.value) * 1e6;
    if (o.target.value === "custom" && !limit) throw new Error(t("Enter the size limit in MB"));
    const out = [];
    for (const file of files) {
      await progress?.tick(file.name);
      const gif = parseGif(new Uint8Array(await file.arrayBuffer()));
      const n = gif.frames.length;
      if (!n) throw new Error(t("{name}: no pictures in this GIF", { name: file.name }));
      if (gif.width * gif.height > MAX_PIXELS || gif.width * gif.height * 4 * n > MAX_RGBA) {
        throw new Error(t("{name} is too big to open here: {n} at {w} × {h} need {size} of memory (the limit is 1.5 GB)", { name: file.name, n: plural(n, "frame"), w: gif.width, h: gif.height, size: formatBytes(gif.width * gif.height * 4 * n) }));
      }
      // Decoded frames at one size are kept while the search only changes colours, if they fit in memory.
      let cache = null;
      const framesAt = (w2, h2, step) => {
        const key = `${w2}x${h2}/${step}`;
        if (cache?.key === key && cache.done) return cache.frames;
        const kept = Math.ceil(n / step), keep = w2 * h2 * 4 * kept < 400 * 1024 ** 2;
        if (!keep) { cache = null; return outputFrames(gif, w2, h2, step); }
        const list = [];
        const entry = cache = { key, frames: list, done: false };
        const same = w2 === gif.width && h2 === gif.height; // then the frame is the decoder's own buffer
        return (async function* () {
          for (const f of outputFrames(gif, w2, h2, step)) { const c = { rgba: same ? f.rgba.slice() : f.rgba, delay: f.delay }; list.push(c); yield c; }
          entry.done = true;
        })();
      };
      let tries = 0, lastYield = Date.now();
      const attempt = async (s) => {
        const [w2, h2] = sizeFor(gif, s.width);
        const kept = Math.ceil(n / s.step);
        const label = tries++ ? t("try {i}", { i: tries }) : "";
        const check = async (i) => {
          if (Date.now() - lastYield < 50) return;
          progress?.note?.(`${file.name}${label ? ` · ${label}` : ""} · ${t("frame {i} of {n}", { i: i + 1, n: kept })}`);
          if (progress?.signal?.aborted) throw new Error("Cancelled");
          await new Promise((r) => setTimeout(r, 0));
          lastYield = Date.now();
        };
        const bytes = await encodeGif(framesAt(w2, h2, s.step), w2, h2, { colors: s.colors, lossy: s.lossy, loop: gif.loop, check });
        return { s: { ...s }, bytes };
      };
      const base = { width: o.width.value === "keep" ? gif.width : Math.min(gif.width, Number(o.width.value)), colors: Number(o.colors.value), step: n > 2 ? Number(o.frames.value) : 1, lossy: o.lossy.input.checked };
      const colorsSet = base.colors < 256;
      let best = await attempt(base);
      if (limit && file.size <= limit && best.bytes.length >= file.size) {
        out.push({ name: file.name, blob: file, note: t("already under {limit}, kept as it was", { limit: mb(limit) }) });
        continue;
      }
      if (limit && best.bytes.length > limit) {
        // Smallest visible loss first: colours, then tiny changes, then frames, then the width.
        const s = { ...base };
        const tryIt = async () => { const r = await attempt(s); if (r.bytes.length < best.bytes.length) best = r; return r.bytes.length <= limit; };
        let fits = false;
        for (const c of [128, 64, 32]) { if (fits) break; if (c < s.colors) { s.colors = c; fits = await tryIt(); } }
        if (!fits && !s.lossy) { s.lossy = true; fits = await tryIt(); }
        for (const st of [2, 3]) { if (fits) break; if (st > s.step && n >= 2 * st) { s.step = st; fits = await tryIt(); } }
        while (!fits && s.width > 64) {
          // Size grows roughly with the area: aim straight at the limit, at least 15% narrower each time.
          const k = Math.sqrt(limit / best.bytes.length) * 0.95;
          s.width = Math.max(64, Math.min(Math.round(s.width * 0.85), Math.floor(s.width * k)));
          fits = await tryIt();
        }
      }
      cache = null;
      const size = best.bytes.length, what = describe(gif, best.s, colorsSet);
      if (!limit && size >= file.size) {
        out.push({ name: file.name, blob: file, note: t("already as small as it gets (re-encoding gave {size})", { size: formatBytes(size) }) });
        continue;
      }
      const blob = new Blob([best.bytes], { type: "image/gif" });
      const saved = size < file.size ? `−${Math.round((1 - size / file.size) * 100)}% ${t("(was {size})", { size: formatBytes(file.size) })}` : t("{size}, bigger than the original {was}", { size: formatBytes(size), was: formatBytes(file.size) });
      const fit = !limit ? "" : size <= limit ? ` · ${t("fits {limit}", { limit: mb(limit) })}` : ` · ${t("does not fit {limit}: this is the smallest it gets", { limit: mb(limit) })}`;
      out.push({ name: `${baseName(file.name)}-compressed.gif`, blob, note: `${saved}${fit} · ${what}` });
    }
    return out;
  },
};

export const gifCompressTools = [gifCompressTool];
