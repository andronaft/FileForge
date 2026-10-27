"""Generate FileForge PNG icons without external dependencies."""
import struct, zlib, pathlib

def png(width, height, pixels):
    raw = b"".join(b"\x00" + bytes(row) for row in pixels)
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def icon(size, pad=0):
    """A dark rounded square with an orange F. `pad` transparent pixels around it: the Chrome Web Store
    wants the 128 px icon drawn as 96 px artwork inside a 16 px transparent border."""
    bg = (30, 34, 44)
    fg = (255, 140, 40)
    inner = size - 2 * pad
    r = inner * 0.22
    px = []
    for y in range(size):
        row = []
        for x in range(size):
            ix, iy = x - pad, y - pad
            if not (0 <= ix < inner and 0 <= iy < inner):
                row += [0, 0, 0, 0]; continue
            # rounded square mask
            cx = min(max(ix, r), inner - 1 - r); cy = min(max(iy, r), inner - 1 - r)
            inside = (ix - cx) ** 2 + (iy - cy) ** 2 <= r * r
            if not inside:
                row += [0, 0, 0, 0]; continue
            # letter F from three bars, in unit coords
            u, v = ix / inner, iy / inner
            bar = (0.28 <= u < 0.42 and 0.22 <= v < 0.78) or \
                  (0.28 <= u < 0.74 and 0.22 <= v < 0.35) or \
                  (0.28 <= u < 0.64 and 0.47 <= v < 0.59)
            row += list(fg if bar else bg) + [255]
        px.append(row)
    return png(size, size, px)

out = pathlib.Path(__file__).resolve().parent.parent / "icons"
out.mkdir(exist_ok=True)
for s, pad in ((16, 0), (32, 0), (48, 0), (128, 16), (256, 0), (512, 0)):
    (out / f"icon{s}.png").write_bytes(icon(s, pad))
    print("wrote", out / f"icon{s}.png")
