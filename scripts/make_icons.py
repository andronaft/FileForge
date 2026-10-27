"""Generate FileForge PNG icons without external dependencies."""
import struct, zlib, pathlib

def png(width, height, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def icon(size):
    bg = (30, 34, 44)
    fg = (255, 140, 40)
    r = size * 0.22
    px = []
    for y in range(size):
        row = []
        for x in range(size):
            # rounded square mask
            cx = min(max(x, r), size - 1 - r); cy = min(max(y, r), size - 1 - r)
            inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
            if not inside:
                row += [0, 0, 0, 0]; continue
            # letter F from three bars, in unit coords
            u, v = x / size, y / size
            bar = (0.28 <= u < 0.42 and 0.22 <= v < 0.78) or \
                  (0.28 <= u < 0.74 and 0.22 <= v < 0.35) or \
                  (0.28 <= u < 0.64 and 0.47 <= v < 0.59)
            row += list(fg if bar else bg) + [255]
        px.append(row)
    return png(size, size, px)

out = pathlib.Path(__file__).resolve().parent.parent / "icons"
out.mkdir(exist_ok=True)
for s in (16, 32, 48, 128):
    (out / f"icon{s}.png").write_bytes(icon(s))
    print("wrote", out / f"icon{s}.png")
