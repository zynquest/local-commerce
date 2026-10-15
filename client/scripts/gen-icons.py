"""Generates PWA PNG icons (green rounded square + white shopping bag) with no dependencies."""
import struct, zlib, math, os

def png(size, path, pad=0.0):
    G = (21, 128, 61); W = (255, 255, 255)
    rows = []
    s = size
    r = s * 0.22
    for y in range(s):
        row = bytearray([0])
        for x in range(s):
            # rounded-square mask (full bleed when pad==0 for maskable)
            cx = min(max(x, r), s - 1 - r); cy = min(max(y, r), s - 1 - r)
            inside = math.hypot(x - cx, y - cy) <= r
            u, v = x / s, y / s
            # bag body
            # bag body: trapezoid, wider at the bottom
            t = (v - 0.38) / 0.40
            half = 0.20 + 0.05 * t
            body = 0.38 <= v <= 0.78 and abs(u - 0.5) <= half
            # two thin handles rising from the bag's top edge
            handle = False
            for hx in (0.40, 0.60):
                d = math.hypot(u - hx, v - 0.38)
                if 0.055 <= d <= 0.085 and v <= 0.38:
                    handle = True
            # fold line across the top of the bag
            fold = body and 0.455 <= v <= 0.475 and abs(u - 0.5) <= half - 0.03
            col = W if (body or handle) else G
            if fold:
                col = G
            row += bytes(col) + bytes([255 if inside else 0])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', s, s, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

out = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(out, exist_ok=True)
for n, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (180, 'apple-touch-icon.png')]:
    png(n, os.path.join(out, name))
print('icons written to', os.path.abspath(out))
