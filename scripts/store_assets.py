#!/usr/bin/env python3
"""Make the store images with the installed Chrome in headless mode (nothing to install):

  docs/screenshots/<name>.png          the app at 1280x760 with a tool filled in (scripts/store/harness.html)
  docs/store/<n>-<name>.jpg            captioned 1280x800 screenshots; the first five go to the Chrome Web Store,
                                       addons.mozilla.org takes all of them (scripts/store/frame.html)
  docs/store/promo-small-440x280.jpg   Chrome Web Store promo tiles (scripts/store/promo.html)
  docs/store/promo-marquee-1400x560.jpg

JPEG because the Chrome Web Store rejects PNGs with an alpha channel. Usage: python3 scripts/store_assets.py
Chrome is driven over the DevTools protocol with a tiny WebSocket client, so the screenshot is taken only
once the harness says it is ready.
"""
import base64, functools, http.server, json, os, pathlib, shutil, socket, socketserver, struct, subprocess, sys, tempfile, threading, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHROME = next((p for p in [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chromium-browser"), shutil.which("chrome"),
] if p and pathlib.Path(p).exists()), None)
if not CHROME:
    sys.exit("Chrome or Chromium not found")

SHOTS = [  # name, title (HTML), subtitle
    ("crop", 'Crop, resize, compress — <span class="accent">on your device</span>', "Drag the handles or type exact pixels · aspect-ratio presets · nothing is uploaded"),
    ("pdf-merge", 'Merge, split and fix <span class="accent">PDFs</span>', "Put files in order, then merge · split by ranges · rotate, delete pages, add numbers or a watermark"),
    ("compress", '<span class="accent">Smaller</span> photos in one click', "JPG, PNG and WebP · see the new size before you download · convert between formats"),
    ("md-to-pdf", 'Markdown → <span class="accent">PDF</span>', "Live preview, three themes, A4 or Letter · also CSV ⇄ JSON, JSON formatting, Base64"),
    ("pdf-to-images", 'Every page as an <span class="accent">image</span>', "PNG or JPG at 72–300 dpi · pick pages · download all as a zip"),
    ("watermark", 'Watermark with a <span class="accent">live preview</span>', "Any text, corner, centre or tiled · opacity and size · batch for many photos"),
    ("json-format", 'Text &amp; data <span class="accent">tools</span>', "Format and validate JSON with the exact error position · CSV ⇄ JSON · Base64"),
    ("favicons", '<span class="accent">Favicons</span> from one logo', "favicon.ico, every PNG size, apple-touch-icon, HTML snippet and web manifest"),
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


class WebSocket:
    """Just enough of RFC 6455 for talking to Chrome on localhost."""

    def __init__(self, url):
        u = urllib.parse.urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        assert b" 101 " in buf.split(b"\r\n")[0], buf

    def _read(self, n):
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise ConnectionError("Chrome closed the connection")
            out += chunk
        return out

    def send(self, text):
        data = text.encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126:
            head.append(0x80 | n)
        elif n < 65536:
            head.append(0x80 | 126); head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127); head += struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        message = b""
        while True:
            b0, b1 = self._read(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(n)
            op = b0 & 0x0F
            if op == 0x9:  # ping
                self.sock.sendall(bytes([0x8A, 0x80]) + os.urandom(4))
                continue
            if op == 0x8:
                raise ConnectionError("Chrome closed the WebSocket")
            message += payload
            if b0 & 0x80:
                return message.decode()


class Chrome:
    def __init__(self, profile):
        self.port = socket.create_server(("127.0.0.1", 0)).getsockname()[1]
        self.proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={self.port}", f"--user-data-dir={profile}",
                                      "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--force-device-scale-factor=1",
                                      "--window-size=1400,900", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list"))
                page = next(p for p in pages if p["type"] == "page")
                break
            except Exception:
                time.sleep(0.2)
        else:
            sys.exit("Chrome did not start")
        self.ws = WebSocket(page["webSocketDebuggerUrl"])
        self.seq = 0

    def call(self, method, **params):
        self.seq += 1
        self.ws.send(json.dumps({"id": self.seq, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.seq:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def evaluate(self, expression):
        r = self.call("Runtime.evaluate", expression=expression, returnByValue=True)
        return r.get("result", {}).get("value")

    def shoot(self, url, out, w, h, ready="document.readyState === 'complete'", timeout=60):
        self.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=False)
        self.call("Page.navigate", url=url)
        t0 = time.time()
        while True:
            state = self.evaluate(f"(() => {{ const t = document.title; if (t.startsWith('error')) return t; return ({ready}) ? 'ok' : 'wait'; }})()")
            if state == "ok":
                break
            if state and state.startswith("error"):
                sys.exit(f"{url}: {state}")
            if time.time() - t0 > timeout:
                sys.exit(f"{url}: not ready after {timeout}s")
            time.sleep(0.2)
        time.sleep(0.3)  # let fonts and the last paint settle
        fmt = "jpeg" if out.suffix == ".jpg" else "png"
        shot = self.call("Page.captureScreenshot", format=fmt, **({"quality": 92} if fmt == "jpeg" else {}))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(shot["data"]))
        print(f"{out.relative_to(ROOT)}  {w}x{h}")

    def close(self):
        self.proc.terminate()
        self.proc.wait()


IMAGES_LOADED = "document.readyState === 'complete' && [...document.images].every((i) => i.complete && i.naturalWidth > 0) && document.fonts.status === 'loaded'"

httpd, port = serve()
base = f"http://127.0.0.1:{port}/scripts/store"
q = urllib.parse.quote
with tempfile.TemporaryDirectory() as profile:
    chrome = Chrome(profile)
    try:
        for i, (name, title, sub) in enumerate(SHOTS, 1):
            chrome.shoot(f"{base}/harness.html?shot={name}", ROOT / "docs" / "screenshots" / f"{name}.png", 1280, 760, ready="document.title === 'ready'")
            chrome.shoot(f"{base}/frame.html?title={q(title)}&sub={q(sub)}&img=../../docs/screenshots/{name}.png",
                         ROOT / "docs" / "store" / f"{i}-{name}.jpg", 1280, 800, ready=IMAGES_LOADED)
        chrome.shoot(f"{base}/promo.html?kind=small", ROOT / "docs" / "store" / "promo-small-440x280.jpg", 440, 280, ready=IMAGES_LOADED)
        chrome.shoot(f"{base}/promo.html?kind=marquee&img=../../docs/screenshots/crop.png", ROOT / "docs" / "store" / "promo-marquee-1400x560.jpg", 1400, 560, ready=IMAGES_LOADED)
    finally:
        chrome.close()
httpd.shutdown()
