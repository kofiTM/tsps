"""Hand-drawn flat floor for the Angel of Death arena, after RS3's look (dark indigo bricks, a bronze
octagon with an X and a pink ring, rune-inscribed paths, pink glyph circles with a purple glow).
The RS3 floor art lives in a terrain layer this port can't read yet, so it is redrawn on the real
layout (RS3 terrain overlays: 155 = octagon, 150 = paths).

build(T) -> [(model bytes, tile x, tile y)]: one flat floor-decoration model per 8x8-tile block,
PX pixels per tile, equal-colour pixels merged into rectangles."""
import math, numpy as np
import osrsmodel
from convert import rgb_to_hsl16

PX = 8
LO, HI = 15, 50                     # interior tiles [15, 50)
C = 32.5 * PX                       # octagon centre (pixels)
LIFT = 3                            # model units above the ground (avoids z-fighting)

PAL = {
    'mortar': (24, 23, 42), 'brick': (44, 41, 76), 'brick2': (50, 47, 86), 'brick3': (39, 37, 68),
    'glow': (84, 46, 108), 'pink': (232, 132, 238),
    'path': (34, 31, 54), 'pathedge': (62, 58, 96),
    'rim': (84, 62, 42), 'rimedge': (46, 74, 76), 'oct': (142, 106, 70), 'disc': (124, 92, 60), 'xline': (82, 60, 40),
}
NAMES = list(PAL)
IDX = {n: i for i, n in enumerate(NAMES)}

GLYPHS = [  # 5x5 rune shapes
    ["01110", "10001", "00110", "00100", "00100"], ["10101", "01110", "00100", "01110", "10101"],
    ["11100", "00100", "01110", "00100", "00111"], ["01010", "11111", "01010", "01010", "11011"],
    ["00100", "01010", "10001", "01010", "00100"], ["11011", "00100", "01110", "00100", "11011"],
    ["10000", "11100", "00111", "00001", "11111"], ["01100", "10010", "01100", "10010", "01100"],
]


def draw(T):
    n = 64 * PX
    img = np.full((n, n), IDX['mortar'], np.int16)
    xs, zs = np.meshgrid(np.arange(n) + .5, np.arange(n) + .5, indexing='ij')
    # bricks: 1 tile long, half a tile high, running bond, 1px mortar
    row = (zs // (PX // 2)).astype(int)
    off = (row % 2) * (PX // 2)
    col = ((xs + off) // PX).astype(int)
    inner = ((zs % (PX // 2)) >= 1) & (((xs + off) % PX) >= 1)
    h = (col * 7919 + row * 104729) % 9
    shade = np.where(h < 3, IDX['brick2'], np.where(h < 5, IDX['brick3'], IDX['brick']))
    img[inner] = shade[inner]
    # glyph circles in the four quadrants (under paths and octagon)
    pink = np.zeros((n, n), bool)
    def ring(cx, cz, r, w=1.2):
        nonlocal pink
        d = np.hypot(xs - cx, zs - cz); pink |= np.abs(d - r) <= w
    def seg(x0, z0, x1, z1, w=1.0):
        nonlocal pink
        vx, vz = x1 - x0, z1 - z0; L = vx * vx + vz * vz
        t = np.clip(((xs - x0) * vx + (zs - z0) * vz) / L, 0, 1)
        pink |= np.hypot(xs - (x0 + t * vx), zs - (z0 + t * vz)) <= w
    def glyph(cx, cz, k, scale=1):
        g = GLYPHS[k % len(GLYPHS)]
        for gy in range(5):
            for gx in range(5):
                if g[gy][gx] == '1':
                    x0 = int(cx - 2.5 * scale + gx * scale); z0 = int(cz + 2.5 * scale - (gy + 1) * scale)
                    pink[x0:x0 + scale, z0:z0 + scale] = True
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = C + sx * 9.5 * PX, C + sz * 9.5 * PX
            ring(cx, cz, 5.2 * PX); ring(cx, cz, 3.6 * PX, 0.8)
            for a in range(12):
                t = a * math.pi / 6 + math.pi / 12
                seg(cx + math.cos(t) * 3.9 * PX, cz + math.sin(t) * 3.9 * PX, cx + math.cos(t) * 6.4 * PX, cz + math.sin(t) * 6.4 * PX, 0.7)
            glyph(cx, cz, (sx + 2) * 3 + sz, 2)
            for (ox, oz) in ((13.2, 4.6), (4.6, 13.2)):
                rx, rz = C + sx * ox * PX, C + sz * oz * PX
                ring(rx, rz, 1.5 * PX, 0.9); glyph(rx, rz, int(ox + oz * 3 + sx * 5 + sz), 1)
    glow = np.zeros_like(pink)
    for dx in range(-3, 4):
        for dz in range(-3, 4):
            if dx * dx + dz * dz <= 9: glow |= np.roll(np.roll(pink, dx, 0), dz, 1)
    img[glow] = IDX['glow']; img[pink] = IDX['pink']
    # paths (RS3 overlay 150 inside the interior): plain stone with edge lines and a line of runes
    tx, tz = (xs // PX).astype(int), (zs // PX).astype(int)
    path = np.zeros((n, n), bool)
    for x in range(LO, HI):
        for y in range(LO, HI):
            if T[(2, x, y)].get('ov') == 150: path[x * PX:(x + 1) * PX, y * PX:(y + 1) * PX] = True
    img[path] = IDX['path']
    edge = path & ~(np.roll(path, 1, 0) & np.roll(path, -1, 0) & np.roll(path, 1, 1) & np.roll(path, -1, 1))
    img[edge] = IDX['pathedge']
    runes = np.zeros((n, n), bool)
    pink = runes
    k = 0
    for p in range(LO * PX + 6, 25 * PX, 11):            # four arms, from the walls in to the octagon
        for (gx, gz) in ((p, C), (64 * PX - p, C), (C, p), (C, 64 * PX - p)):
            glyph(gx, gz, k); k += 1
    rglow = np.zeros_like(runes)
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1): rglow |= np.roll(np.roll(runes, dx, 0), dz, 1)
    img[rglow & path & ~edge] = IDX['glow']; img[runes & path] = IDX['pink']
    # octagon: bronze rim, teal edge, pink ring, darker disc with an X, four pink notches
    def octo(r):
        a = np.maximum(np.abs(xs - C), np.abs(zs - C))
        b = (np.abs(xs - C) + np.abs(zs - C)) / math.sqrt(2)
        return np.maximum(a, b) <= r
    R = 7.5 * PX
    img[octo(R)] = IDX['rimedge']; img[octo(R - 1.5)] = IDX['rim']; img[octo(R - 6)] = IDX['oct']
    d = np.hypot(xs - C, zs - C)
    disc = d <= 4.4 * PX
    img[disc] = IDX['disc']
    xl = disc & ((np.abs((xs - C) - (zs - C)) <= 1.6) | (np.abs((xs - C) + (zs - C)) <= 1.6))
    img[xl] = IDX['xline']
    img[np.abs(d - 4.6 * PX) <= 1.3] = IDX['pink']
    for ux, uz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        along = (xs - C) * ux + (zs - C) * uz; across = np.abs((xs - C) * uz - (zs - C) * ux)
        frame = (along >= 4.2 * PX) & (along <= 6.6 * PX) & (across <= 4)
        img[frame] = IDX['rim']
        img[frame & (across <= 1.5) & (along >= 4.6 * PX) & (along <= 6.2 * PX)] = IDX['pink']
    return img


def rects(cells):
    """Greedy: equal-valued pixels -> rectangles (x, z, w, h, value)."""
    h, w = cells.shape
    used = np.zeros_like(cells, bool); out = []
    for x in range(h):
        for z in range(w):
            if used[x, z]: continue
            v = cells[x, z]; z1 = z
            while z1 + 1 < w and not used[x, z1 + 1] and cells[x, z1 + 1] == v: z1 += 1
            x1 = x
            while x1 + 1 < h and (cells[x1 + 1, z:z1 + 1] == v).all() and not used[x1 + 1, z:z1 + 1].any(): x1 += 1
            used[x:x1 + 1, z:z1 + 1] = True
            out.append((x, z, x1 - x + 1, z1 - z + 1, v))
    return out


def build(T, chunk=8):
    img = draw(T)
    hsl = [rgb_to_hsl16(np.array(PAL[nm]) / 255.0) for nm in NAMES]
    out = []
    for cx in range(LO, HI, chunk):
        for cz in range(LO, HI, chunk):
            x1, z1 = min(HI, cx + chunk), min(HI, cz + chunk)
            cells = img[cx * PX:x1 * PX, cz * PX:z1 * PX]
            verts, faces, cols = [], [], []
            ox, oz = cx * 128 + 64, cz * 128 + 64              # model origin: centre of the block's south-west tile
            s = 128 // PX
            for x, z, w, hh, v in rects(cells):
                a = len(verts)
                X0, X1 = (cx * PX + x) * s - ox, (cx * PX + x + w) * s - ox
                Z0, Z1 = (cz * PX + z) * s - oz, (cz * PX + z + hh) * s - oz
                verts += [(X0, -LIFT, Z0), (X1, -LIFT, Z0), (X1, -LIFT, Z1), (X0, -LIFT, Z1)]
                faces += [(a, a + 1, a + 3), (a + 1, a + 2, a + 3)]   # wound to face up
                cols += [hsl[v], hsl[v]]
            out.append((osrsmodel.encode(np.array(verts), np.array(faces), np.array(cols)), cx, cz, len(faces)))
    return out, img


if __name__ == '__main__':
    import sys
    from PIL import Image
    from js5 import Cache
    import rs3map
    from aod import RS3_REGION
    T = rs3map.terrain(Cache(sys.argv[1]).files(5, RS3_REGION)[3])
    models, img = build(T)
    for d, cx, cz, nf in models: print(cx, cz, nf, 'tris', len(d), 'bytes')
    rgb = np.array([PAL[nm] for nm in NAMES], np.uint8)[img]
    Image.fromarray(np.flipud(rgb[LO * PX:HI * PX, LO * PX:HI * PX].transpose(1, 0, 2))).resize((560, 560), Image.NEAREST).save('_preview/aod-paint.png')
