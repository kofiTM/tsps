"""Tiny flat-shaded software renderer for OSRS .dat previews (no game client needed)."""
import colorsys, math, sys
import numpy as np
from PIL import Image, ImageDraw
import osrsmodel


def hsl16_rgb(c):
    h = ((c >> 10) & 63) / 64.0 + 1 / 128.0
    s = ((c >> 7) & 7) / 8.0 + 1 / 16.0
    l = (c & 127) / 128.0
    return np.array(colorsys.hls_to_rgb(h, l, s))


def rot(yaw, pitch):
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    return rx @ ry


def render(models, yaw, pitch, size=360, scale=None, centre=None):
    """models: list of (decoded model, tint or None)."""
    R = rot(yaw, pitch)
    allv = np.concatenate([m['verts'] for m, _ in models]).astype(float)
    if centre is None:
        centre = (allv.min(0) + allv.max(0)) / 2
    if scale is None:
        ext = np.abs((allv - centre) @ R.T)[:, :2].max()
        scale = size * 0.45 / max(ext, 1)
    img = np.full((size, size, 3), 0.18)
    zb = np.full((size, size), np.inf)
    light = np.array([-0.4, -0.7, -0.6]); light /= np.linalg.norm(light)
    for m, tint in models:
        V = (m['verts'] - centre) @ R.T
        F = m['faces']
        for i, (a, b, c) in enumerate(F):
            p = V[[a, b, c]]
            n = np.cross(p[1] - p[0], p[2] - p[0])
            nl = np.linalg.norm(n)
            if nl == 0:
                continue
            n /= nl
            if n[2] > 0:   # back face (camera looks down +z)
                continue
            col = hsl16_rgb(int(m['colours'][i])) if tint is None else np.array(tint)
            shade = 0.45 + 0.55 * max(0.0, float(-n @ light))
            col = np.clip(col * shade * 1.25, 0, 1)
            xs = p[:, 0] * scale + size / 2
            ys = p[:, 1] * scale + size / 2
            x0, x1 = int(max(0, math.floor(xs.min()))), int(min(size - 1, math.ceil(xs.max())))
            y0, y1 = int(max(0, math.floor(ys.min()))), int(min(size - 1, math.ceil(ys.max())))
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
            if abs(d) < 1e-9:
                continue
            w1 = ((gx - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (gy - ys[0])) / d
            w2 = ((xs[1] - xs[0]) * (gy - ys[0]) - (gx - xs[0]) * (ys[1] - ys[0])) / d
            w0 = 1 - w1 - w2
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            z = w0 * p[0, 2] + w1 * p[1, 2] + w2 * p[2, 2]
            sub = zb[y0:y1 + 1, x0:x1 + 1]
            upd = inside & (z < sub)
            sub[upd] = z[upd]
            img[y0:y1 + 1, x0:x1 + 1][upd] = col
    return Image.fromarray((img * 255).astype(np.uint8))


def load(path):
    return osrsmodel.decode(open(path, 'rb').read())


if __name__ == '__main__':
    out = sys.argv[1]
    tiles = []
    for spec in sys.argv[2:]:
        label, rest = spec.split('=', 1)
        parts = rest.split('+')
        ms = [(load(parts[0]), None)] + [(load(p), (0.9, 0.25, 0.25)) for p in parts[1:]]
        for yaw, pitch in ((0.6, -0.5), (math.pi / 2, 0.0)):
            im = render(ms, yaw, pitch)
            ImageDraw.Draw(im).text((6, 6), label, fill=(255, 255, 255))
            tiles.append(im)
    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (360 * cols, 360 * rows), (20, 20, 20))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * 360, (i // cols) * 360))
    sheet.save(out)
