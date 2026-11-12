"""Stage 1 port of RS3's Nex: Angel of Death arena (950 cache region 3628, plane 2) into OSRS
region 8260 (an empty region: no terrain content, empty object file) as data/regions/8260.pack.

The arena floor is mostly made of floor objects, so every plane-2 object's models are placed and
ray-cast top-down; each tile gets the colour of its highest surface, matched to the nearest
plain-colour OSRS overlay. Blocked tiles come from RS3's tile settings (bit 1). No objects yet.

    python3 aod.py <rs3 950 cache> [--preview]
"""
import io, os, re, struct, sys, colorsys
import numpy as np
from js5 import Cache, Buf
from osrscache import OsrsCache
import convert, osrsmodel, rs3map

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RS3_REGION, RS3_PLANE = 3628, 2
OSRS_REGION = 8260          # (32, 68): empty in the rev 241 cache
SAMPLES = 4
TERRAIN_OVERLAYS = {150: (34, 31, 54), 155: (142, 106, 70)}   # matched to aod_paint's path and octagon colours
INTERIOR = (44, 41, 76)                                            # aod_paint's brick colour


def loc_models(cache, lid, typ):
    """Model ids of an RS3 loc def for a placement type (opcode 1: groups of type, count, models)."""
    d = cache.files(16, lid >> 8).get(lid & 255)
    if not d:
        return [], 1, 1
    size = [1, 1]
    m = re.search(rb'\x0e(.)', d[:12]); n = re.search(rb'\x0f(.)', d[:12])
    for i in range(len(d) - 4):
        if d[i] != 1:
            continue
        groups = d[i + 1]
        if not 1 <= groups <= 4:
            continue
        b = Buf(d, i + 2); out = {}
        try:
            for _ in range(groups):
                t = b.s8(); cnt = b.u8()
                out[t] = [b.smart32() for _ in range(cnt)]
        except Exception:
            continue
        if typ in out or (typ in (10, 11) and 10 in out) or -1 in out:
            sx = sy = 1
            for j in range(i):
                if d[j] == 0x0e and j + 1 < i: sx = d[j + 1] or 1
                if d[j] == 0x0f and j + 1 < i: sy = d[j + 1] or 1
            return out.get(typ) or out.get(10) or out.get(-1), sx, sy
    return [], 1, 1


def osrs_overlays():
    c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    out = []
    for oid, d in c.files(2, 4).items():
        b = Buf(d); rgb = None; tex = False; hide = False
        try:
            while b.left():
                op = b.u8()
                if op == 0: break
                if op == 1: rgb = b.u24()
                elif op == 2: b.u8(); tex = True
                elif op == 5: hide = True
                elif op == 7: b.u24()
                elif op in (8, 10, 12): pass
                elif op in (9, 15): b.u16()
                elif op in (11, 14, 16): b.u8()
                elif op == 13: b.u24()
                else: break
        except Exception:
            continue
        if rgb is not None and rgb != 0xff00ff and not tex:
            out.append((oid, np.array([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], float) / 255))
    return out


def main():
    cache = Cache(sys.argv[1])
    fs = cache.files(5, RS3_REGION)
    T = rs3map.terrain(fs[3])
    L = [l for l in rs3map.locs(fs[0]) if l[3] == RS3_PLANE]
    G = 64 * SAMPLES
    top = np.full((G, G), -1e9); col = np.zeros((G, G, 3))
    model_cache = {}
    placed = 0
    for lid, x, y, z, typ, rot, ex in L:
        mids, _, _ = loc_models(cache, lid, typ)
        import rs3loc; _i = rs3loc.decode(cache.files(16, lid >> 8)[lid & 255]); sx, sy = _i['sx'], _i['sy']
        if rot & 1: sx, sy = sy, sx
        for mid in mids or []:
            if mid not in model_cache:
                try:
                    d, _ = convert.convert(cache, mid, False, None, tint=True)
                    model_cache[mid] = osrsmodel.decode(d)
                except Exception:
                    model_cache[mid] = None
            m = model_cache[mid]
            if m is None: continue
            v = m['verts'].astype(float)
            vx, vy, vz = v[:, 0], -v[:, 1], v[:, 2]            # vy: up
            for _ in range(rot):                               # 90 deg clockwise steps
                vx, vz = vz, -vx
            cx = (x + sx / 2) * 128; cz = (y + sy / 2) * 128
            px = (vx + cx) / 128 * SAMPLES; pz = (vz + cz) / 128 * SAMPLES
            rgbs = [colorsys.hls_to_rgb(((c >> 10) & 63) / 64, (c & 127) / 128, ((c >> 7) & 7) / 8) for c in m['colours']]
            for fi, (a, b2, c2) in enumerate(m['faces']):
                xs = px[[a, b2, c2]]; zs = pz[[a, b2, c2]]; hs = vy[[a, b2, c2]]
                x0, x1 = int(max(0, np.floor(xs.min()))), int(min(G - 1, np.ceil(xs.max())))
                z0, z1 = int(max(0, np.floor(zs.min()))), int(min(G - 1, np.ceil(zs.max())))
                if x1 < x0 or z1 < z0: continue
                det = (xs[1] - xs[0]) * (zs[2] - zs[0]) - (xs[2] - xs[0]) * (zs[1] - zs[0])
                if abs(det) < 1e-9: continue
                gx, gz = np.meshgrid(np.arange(x0, x1 + 1) + .5, np.arange(z0, z1 + 1) + .5, indexing='ij')
                w1 = ((gx - xs[0]) * (zs[2] - zs[0]) - (xs[2] - xs[0]) * (gz - zs[0])) / det
                w2 = ((xs[1] - xs[0]) * (gz - zs[0]) - (gx - xs[0]) * (zs[1] - zs[0])) / det
                w0 = 1 - w1 - w2
                ins = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
                h = w0 * hs[0] + w1 * hs[1] + w2 * hs[2]
                sub = top[x0:x1 + 1, z0:z1 + 1]; upd = ins & (h > sub)
                sub[upd] = h[upd]
                col[x0:x1 + 1, z0:z1 + 1][upd] = rgbs[fi]
            placed += 1
    print('placed models', placed, 'distinct', len(model_cache))
    overlays = osrs_overlays()
    ocols = np.array([c for _, c in overlays]); oids = [i for i, _ in overlays]
    print('osrs plain overlays', len(overlays))
    # interior: flood fill from the centre through tiles that aren't wall (tall geometry) or blocked
    tmax = np.array([[top[x*SAMPLES:(x+1)*SAMPLES, y*SAMPLES:(y+1)*SAMPLES].max() for y in range(64)] for x in range(64)])
    wall = (tmax > 40) | np.array([[T[(RS3_PLANE, x, y)].get('set', 0) & 1 for y in range(64)] for x in range(64)], bool)
    inner = np.zeros((64, 64), bool); stack = [(32, 32)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < 64 and 0 <= y < 64) or inner[x, y] or wall[x, y]: continue
        inner[x, y] = True; stack += [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]
    if inner[0].any() or inner[63].any() or inner[:, 0].any() or inner[:, 63].any():
        print('WARNING: interior fill leaked to the region edge'); inner[:] = False
    print('interior tiles', int(inner.sum()))
    # terrain
    out = bytearray(); tilecol = np.zeros((64, 64, 3)); has = np.zeros((64, 64), bool)
    for zz in range(4):
        for x in range(64):
            for y in range(64):
                if zz != 0:
                    out += struct.pack('>H', 0); continue
                t = T[(RS3_PLANE, x, y)]
                cells = col[x * SAMPLES:(x + 1) * SAMPLES, y * SAMPLES:(y + 1) * SAMPLES]
                hit = top[x * SAMPLES:(x + 1) * SAMPLES, y * SAMPLES:(y + 1) * SAMPLES] > -1e8
                ovc = TERRAIN_OVERLAYS.get(t.get('ov'))
                if hit.any() and (ovc is None or top[x * SAMPLES:(x + 1) * SAMPLES, y * SAMPLES:(y + 1) * SAMPLES][hit].max() > 40):
                    rgb = cells[hit].mean(0); shape = 0
                elif ovc is not None:
                    rgb = np.array(ovc, float) / 255; shape = 0   # RS3 corner shapes don't map onto OSRS's: full tiles
                elif inner[x, y]:
                    rgb = np.array(INTERIOR, float) / 255; shape = 0
                else:
                    rgb = None
                if rgb is not None:
                    o = oids[int(((ocols - rgb) ** 2).sum(1).argmin())]
                    out += struct.pack('>HH', 2 + min(shape, 47), o + 1)
                    tilecol[x, y] = rgb; has[x, y] = True
                setting = t.get('set', 0) & 0x1f
                if rgb is None: setting |= 1                     # no floor: unwalkable void
                if setting: out += struct.pack('>H', 49 + setting)
                out += struct.pack('>H', 1) + bytes([1])         # flat ground
    objects = b'\x00'                                            # no objects yet (stage 1)
    c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    terrain_file = object_file = OSRS_REGION                     # unnamed cache: group = region id
    pack = struct.pack('>iiiii', 1, object_file, terrain_file, OSRS_REGION >> 8, OSRS_REGION & 0xff)
    pack += struct.pack('>i', len(objects)) + objects + struct.pack('>i', len(out)) + bytes(out)
    os.makedirs(os.path.join(ROOT, 'data', 'regions'), exist_ok=True)
    open(os.path.join(ROOT, 'data', 'regions', '%d.pack' % OSRS_REGION), 'wb').write(pack)
    print('wrote data/regions/%d.pack' % OSRS_REGION, len(pack), 'bytes; floored tiles', int(has.sum()))
    if '--preview' in sys.argv:
        from PIL import Image
        img = Image.fromarray((np.flipud(tilecol.transpose(1, 0, 2)) * 255).astype(np.uint8)).resize((512, 512), Image.NEAREST)
        img.save('_preview/aod-floor.png')
        print('\n'.join(''.join('#' if wall[x, y] else ('.' if has[x, y] else ' ') for x in range(64)) for y in range(63, -1, -1)))


if __name__ == '__main__':
    main()
