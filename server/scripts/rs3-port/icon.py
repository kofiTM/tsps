"""Approximate the OSRS client's inventory-icon projection to pick zoom2d/offsets."""
import math, sys
import numpy as np
from PIL import Image
import osrsmodel
from render import hsl16_rgb

SIN = lambda a: math.sin(a * 2 * math.pi / 2048)
COS = lambda a: math.cos(a * 2 * math.pi / 2048)


def project(m, zoom, xan, yan, zan, ox, oy):
    v = m['verts'].astype(float)
    x, y, z = v[:, 0].copy(), v[:, 1].copy(), v[:, 2].copy()
    height = max(1.0, -y.min())
    if zan:
        t = y * SIN(zan) + x * COS(zan); y = y * COS(zan) - x * SIN(zan); x = t
    if yan:
        t = z * SIN(yan) + x * COS(yan); z = z * COS(yan) - x * SIN(yan); x = t
    x += ox
    y += height / 2 + zoom * SIN(xan) + oy
    z += zoom * COS(xan) + oy
    t = y * COS(xan) - z * SIN(xan); z = y * SIN(xan) + z * COS(xan); y = t
    return np.stack([16 + x * 512 / z, 16 + y * 512 / z, z], 1)


def draw(m, zoom, xan, yan, zan, ox, oy, size=32):
    p = project(m, zoom, xan, yan, zan, ox, oy)
    img = np.zeros((size, size, 4)); zb = np.full((size, size), np.inf)
    for i, (a, b, c) in enumerate(m['faces']):
        q = p[[a, b, c]]
        d = (q[1, 0] - q[0, 0]) * (q[2, 1] - q[0, 1]) - (q[2, 0] - q[0, 0]) * (q[1, 1] - q[0, 1])
        if abs(d) < 1e-9:
            continue
        x0, x1 = max(0, int(q[:, 0].min())), min(size - 1, int(q[:, 0].max()) + 1)
        y0, y1 = max(0, int(q[:, 1].min())), min(size - 1, int(q[:, 1].max()) + 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(y0, y1 + 1) + .5)
        w1 = ((gx - q[0, 0]) * (q[2, 1] - q[0, 1]) - (q[2, 0] - q[0, 0]) * (gy - q[0, 1])) / d
        w2 = ((q[1, 0] - q[0, 0]) * (gy - q[0, 1]) - (gx - q[0, 0]) * (q[1, 1] - q[0, 1])) / d
        w0 = 1 - w1 - w2
        ins = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        z = w0 * q[0, 2] + w1 * q[1, 2] + w2 * q[2, 2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]; upd = ins & (z < sub); sub[upd] = z[upd]
        img[y0:y1 + 1, x0:x1 + 1][upd] = list(hsl16_rgb(int(m['colours'][i]))) + [1]
    return img


def fit(m, xan, yan, zan, target=30):
    """Pick zoom so the projected bounds span ~target px; then centre with offsets."""
    zoom = 2000
    for _ in range(30):
        p = project(m, zoom, xan, yan, zan, 0, 0)
        span = max(np.ptp(p[:, 0]), np.ptp(p[:, 1]))
        zoom = int(zoom * span / target)
    best = None
    for ox in range(-60, 61, 2):
        for oy in range(-60, 61, 2):
            p = project(m, zoom, xan, yan, zan, ox, oy)
            cx = (p[:, 0].min() + p[:, 0].max()) / 2 - 16
            cy = (p[:, 1].min() + p[:, 1].max()) / 2 - 16
            e = cx * cx + cy * cy
            if best is None or e < best[0]:
                best = (e, ox, oy)
    return zoom, best[1], best[2]


if __name__ == '__main__':
    m = osrsmodel.decode(open(sys.argv[1], 'rb').read())
    xan, yan, zan = map(int, sys.argv[2:5])
    zoom, ox, oy = fit(m, xan, yan, zan)
    print('zoom2d', zoom, 'offsetX2d', ox, 'offsetY2d', oy)
    im = draw(m, zoom, xan, yan, zan, ox, oy)
    Image.fromarray((im * 255).astype(np.uint8), 'RGBA').resize((256, 256), Image.NEAREST).save(sys.argv[5])
