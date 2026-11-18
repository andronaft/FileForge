# Mediabunny 1.65.2

Reads and writes MP4, MOV, WebM and MKV and converts video and audio through the browser's own WebCodecs encoders
and decoders. Used by Compress video, Convert video and Trim & edit video (`app/tools/videoedit.js`), loaded only
when one of them is opened.

- Source: npm package `mediabunny@1.65.2`, file `dist/bundles/mediabunny.min.mjs`, unchanged
  (tarball sha512 `goZpibvo/5hkc/56WVNm93Ini+o7K4y8aXA20c/BN1B+m3L5aHQa8MTvO+S1APg/YI8kMILtrX6QCqUtxLW7bA==`).
- Project: https://github.com/Vanilagy/mediabunny
- Licence: Mozilla Public License 2.0, see `LICENSE` in this folder. The unminified source of this exact version is in
  the npm package and in the project's repository at the tag `v1.65.2`.

Under the extension's CSP (no `blob:` workers) the paths that start workers from blob URLs do not work: live camera
or screen capture (`MediaStreamVideoTrackSource`, `MediaStreamTrackProcessor`) and video with a transparency channel
(`ColorAlphaMerger` / `ColorAlphaSplitter`). FileForge uses none of them: file conversion discards alpha by default.
