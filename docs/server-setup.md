# Server setup for the web app (zhukovskyi.space/tools/fileforge/)

Two settings live outside this repo: one in Cloudflare and one in nginx on the VPS. Both are done by hand.

## 1. Cloudflare: cache the big engine and model files

Cloudflare's default list of cached extensions has no `.wasm`, `.onnx` or `.mjs`. Today every visitor of Remove background is served the 28.7 MB ONNX Runtime and the 46 MB ISNet model straight from the VPS (`cf-cache-status: DYNAMIC`).

**Setup.** In Cloudflare → zhukovskyi.space → **Caching → Cache Rules → Create rule**:
- **Rule name:** `FileForge vendor files`
- **When incoming requests match…** → **Custom filter expression**: `URI Path` · `starts with` · `/tools/fileforge/vendor/`. As an expression: `(starts_with(http.request.uri.path, "/tools/fileforge/vendor/"))`
- **Cache eligibility:** **Eligible for cache**
- **Edge TTL:** **Ignore cache-control header and use this TTL** → `1 day`
- **Browser TTL:** **Respect origin**. The app's service worker and the browser cache handle the rest.
- **Deploy**

**Do not add `/tools/fileforge/app/`.** It is sent with `no-cache` on purpose, so a deploy reaches users at once.

**After a release that changes `vendor/`** (a new ONNX Runtime, a new model): **Caching → Configuration → Purge Everything**, or wait a day.

**Check:** run the command twice. The first answer is `MISS`, the second `HIT`:

```bash
curl -sI https://zhukovskyi.space/tools/fileforge/vendor/rembg/ort-wasm-simd-threaded.asyncify.wasm | grep -i cf-cache-status
```

## 2. nginx: the network lock as an HTTP header, so workers are covered too

The page's `<meta http-equiv="Content-Security-Policy">` covers the page itself. Web workers (ONNX Runtime, HEIC, qpdf, faces) and the service worker get their policy only from their own HTTP response. So the same policy has to go out as a header for `app/` and `vendor/`. (The extension needs nothing: `manifest.json` covers all its pages and workers.)

**Step 1.** In `/etc/nginx/sites-available/zhukovskyi.space.conf`, next to the other `map` blocks at the top, add:

```nginx
# FileForge web app: the browser may connect only to FileForge's own files (the same policy as the page's meta tag).
# Sent as a header so the app's web workers and service worker are locked too. Empty elsewhere = no header.
map $uri $ff_csp {
    default "";
    "~^/tools/fileforge/(app|vendor)/" "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; font-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'";
}
```

**Step 2.** In **both** `server {}` blocks, after `add_header Content-Security-Policy-Report-Only $zs_csp_out always;`, add:

```nginx
    add_header Content-Security-Policy $ff_csp always;
```

**Step 3.** Back up and apply:

```bash
sudo cp /etc/nginx/sites-available/zhukovskyi.space.conf /etc/nginx/sites-available/zhukovskyi.space.conf.bak-$(date +%F)
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**Check:** this must print the policy with `connect-src 'self' blob: data:`:

```bash
curl -sI https://zhukovskyi.space/tools/fileforge/app/ | grep -i "^content-security-policy:"
```

**If Cloudflare Web Analytics is set to inject its script automatically,** the browser will now block it on the app page. That is intended: one console line, and nothing else breaks.
