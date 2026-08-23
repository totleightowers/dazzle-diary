"""Dazzle Diary icon: a gem drawn as drills, half of them placed.

No Pillow or rsvg on this phone, so it rasterises here. Each cell is drawn
only over the pixels it covers, rather than testing every cell for every
subsample -- the difference between an hour and a few seconds.
"""
import zlib, struct, pathlib

PLUM  = (0x4b, 0x25, 0x45, 255)
CREAM = (0xf6, 0xef, 0xdf, 255)
GOLD  = (0xe8, 0xb7, 0x4a, 255)

# Coarse on purpose: at 48px a seven-wide grid turns to mush, and a launcher
# icon is 48px more often than it is 512.
ROWS    = [3, 5, 5, 3, 1]         # a gem: broad shoulders, tapering to a point
PLACED  = 3                       # the top three rows are done, the rest waiting
SPARKLE = (1, 2)                  # one AB drill
COLS    = max(ROWS)


def cells():
    for r, n in enumerate(ROWS):
        start = (COLS - n) / 2.0
        for i in range(n):
            c = start + i
            yield c, r, r < PLACED, (r, int(c)) == SPARKLE


def _rr(px, py, x, y, w, h, rad):
    if px < x or py < y or px > x + w or py > y + h:
        return False
    cx = min(max(px, x + rad), x + w - rad)
    cy = min(max(py, y + rad), y + h - rad)
    return (px - cx) ** 2 + (py - cy) ** 2 <= rad * rad


def render(size, *, bleed, motif, corner=0.229, ss=4):
    buf = [[(0, 0, 0, 0)] * size for _ in range(size)]

    if bleed:
        rad = size * corner
        for y in range(size):
            row = buf[y]
            for x in range(size):
                if not rad:
                    row[x] = PLUM
                else:
                    hit = sum(_rr(x + (sx + .5) / ss, y + (sy + .5) / ss, 0, 0, size, size, rad)
                              for sy in range(ss) for sx in range(ss))
                    if hit:
                        row[x] = PLUM[:3] + (int(round(255 * hit / (ss * ss))),)

    if not motif:
        return buf

    span = size * motif
    gap = span / (COLS * 6.0 - 1)
    cw = gap * 5
    ox = (size - span) / 2.0
    oy = (size - (len(ROWS) * cw + (len(ROWS) - 1) * gap)) / 2.0
    rad = cw * 0.28
    inner = cw * 0.52
    ioff = (cw - inner) / 2.0

    for c, r, filled, gold in cells():
        bx, by = ox + c * (cw + gap), oy + r * (cw + gap)
        colour = (GOLD if gold else CREAM) if filled else CREAM
        alpha = 1.0 if filled else 0.52          # an empty seat is a faint ring
        for y in range(max(0, int(by)), min(size, int(by + cw) + 2)):
            for x in range(max(0, int(bx)), min(size, int(bx + cw) + 2)):
                hit = 0
                for sy in range(ss):
                    for sx in range(ss):
                        fx, fy = x + (sx + .5) / ss, y + (sy + .5) / ss
                        if not _rr(fx, fy, bx, by, cw, cw, rad):
                            continue
                        if not filled and _rr(fx, fy, bx + ioff, by + ioff, inner, inner, rad * .6):
                            continue
                        hit += 1
                if not hit:
                    continue
                a = (hit / (ss * ss)) * alpha
                dst = buf[y][x]
                buf[y][x] = tuple(int(round(colour[i] * a + dst[i] * (1 - a))) for i in range(3)) + (
                    int(round(255 * a + dst[3] * (1 - a))),)
    return buf


def write_png(path, px):
    size = len(px)
    raw = b''.join(b'\x00' + b''.join(bytes(p) for p in row) for row in px)

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    pathlib.Path(path).write_bytes(png)
    return len(png)


def svg():
    size, span = 48, 48 * 0.80
    gap = span / (COLS * 6.0 - 1)
    cw = gap * 5
    rad = cw * 0.28
    ox = (size - span) / 2.0
    oy = (size - (len(ROWS) * cw + (len(ROWS) - 1) * gap)) / 2.0
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">',
           '  <rect width="48" height="48" rx="11" fill="#4b2545"/>']
    for c, r, filled, gold in cells():
        x, y = ox + c * (cw + gap), oy + r * (cw + gap)
        box = f'x="{x:.2f}" y="{y:.2f}" width="{cw:.2f}" height="{cw:.2f}" rx="{rad:.2f}"'
        out.append(f'  <rect {box} fill="{"#e8b74a" if gold else "#f6efdf"}"/>' if filled
                   else f'  <rect {box} fill="none" stroke="#f6efdf" '
                        f'stroke-width="{cw * 0.24:.2f}" opacity=".52"/>')
    out.append('</svg>')
    return '\n'.join(out)


if __name__ == '__main__':
    import pathlib as _p
    _p.Path('app/icon.svg').write_text(svg())
    jobs = [('app/icon-192.png', 192, dict(bleed=True, motif=0.80)),
            ('app/icon-512.png', 512, dict(bleed=True, motif=0.80)),
            ('app/icon-maskable.png', 512, dict(bleed=True, motif=0.58, corner=0.0))]
    for d, legacy, adaptive in [('mdpi', 48, 108), ('hdpi', 72, 162), ('xhdpi', 96, 216),
                                ('xxhdpi', 144, 324), ('xxxhdpi', 192, 432)]:
        m = f'android/res/mipmap-{d}/'
        jobs += [(m + 'ic_launcher.png', legacy, dict(bleed=True, motif=0.80)),
                 (m + 'ic_launcher_background.png', adaptive, dict(bleed=True, motif=0.0, corner=0.0)),
                 (m + 'ic_launcher_foreground.png', adaptive, dict(bleed=False, motif=0.52))]
    for path, size, kw in jobs:
        print(f"{path}  {size}x{size}  {write_png(path, render(size, **kw))} bytes")
