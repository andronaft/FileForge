// Pictures to an animated GIF: a slideshow, a step-by-step, a before/after that plays anywhere.
import { el, field, select, number, checkbox, formatBytes, plural, t } from "../util.js";
import { loadImage, dims, makeCanvas } from "./image.js";
import { GIFEncoder, quantize, applyPalette } from "../../vendor/gifenc.esm.js";

const gifMakeTool = {
  id: "images-to-gif",
  title: "Images to GIF",
  description: "Turn a set of pictures into an animated GIF: a slideshow, steps of a how-to, a before and after. Order the frames with the arrows.",
  keywords: ["gif maker", "animated", "animation", "slideshow", "frames", "make gif", "зробити gif", "анімація", "гіф", "слайдшоу", "кадри"],
  accept: "image/*,.heic,.heif",
  orderable: true,
  hint: "Two or more pictures: JPG, PNG, WebP, HEIC",
  runLabel: "Make GIF",
  renderOptions(root, files) {
    const delay = number(0.6, { min: 0.05, max: 10, step: "0.05" });
    const width = select([["320", "320 px"], ["480", "480 px"], ["640", "640 px"], ["800", "800 px"], ["1080", "1080 px"]], "640");
    const fit = select([["contain", "Whole picture, bars if needed"], ["cover", "Fill the frame, crop the edges"]], "contain");
    const bg = select([["#ffffff", "White"], ["#000000", "Black"]], "#ffffff");
    const loop = checkbox("Loop forever", true);
    const back = checkbox("Play forward, then backward", false);
    root.append(
      el("div", { class: "row" }, [field("Seconds per picture", delay), field("Width", width), field("Different shapes", fit), field("Background", bg)]),
      el("div", { class: "row" }, [loop.label, back.label]),
      el("div", { class: "stat", text: t("{n} frames, the shape of the first picture", { n: files.length }) }),
    );
    this.opts = { delay, width, fit, bg, loop, back };
  },
  async run(files, _root, progress) {
    const o = this.opts;
    if (files.length < 2) throw new Error("Add at least two pictures");
    if (files.length > 300) throw new Error("Too many pictures for one GIF: keep it under 300");
    const order = o.back.input.checked ? [...files, ...files.slice(1, -1).reverse()] : files;
    const delay = Math.round(Math.max(0.02, Number(o.delay.value) || 0.6) * 1000);
    const gif = GIFEncoder();
    let w = 0, h = 0, c, g;
    const cache = new Map(); // a picture used twice (ping-pong) is quantised once
    progress?.start(order.length);
    for (const [i, file] of order.entries()) {
      await progress?.tick(t("frame {i} of {n}", { i: i + 1, n: order.length }));
      let frame = cache.get(file);
      if (!frame) {
        const img = await loadImage(file), d = dims(img);
        if (!c) {
          w = Math.min(Number(o.width.value), d.w); h = Math.max(1, Math.round((w / d.w) * d.h));
          c = makeCanvas(w, h); g = c.getContext("2d", { willReadFrequently: true });
        }
        g.fillStyle = o.bg.value; g.fillRect(0, 0, w, h);
        const k = o.fit.value === "cover" ? Math.max(w / d.w, h / d.h) : Math.min(w / d.w, h / d.h);
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (w - d.w * k) / 2, (h - d.h * k) / 2, d.w * k, d.h * k);
        if (img.close) img.close();
        const { data } = g.getImageData(0, 0, w, h);
        const palette = quantize(data, 256, { format: "rgb444" });
        frame = { index: applyPalette(data, palette, "rgb444"), palette };
        cache.set(file, frame);
      }
      gif.writeFrame(frame.index, w, h, { palette: frame.palette, delay, repeat: o.loop.input.checked ? 0 : -1 });
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: "image/gif" });
    return [{ name: "animation.gif", blob, note: `${plural(order.length, "frame")} · ${w} × ${h} px · ${formatBytes(blob.size)}` }];
  },
};

export const gifTools = [gifMakeTool];
