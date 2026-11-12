"""Top-down textured render of the Angel of Death arena floor (950 cache region 3628, plane 2).

Every plane-2 object's RS3 meshes are rasterised with their real textures (UV-sampled per pixel,
alpha-blended low to high), keeping only faces below FLOOR_MAX (OSRS units above the ground), so
walls and pillars don't cover the floor. Output: an RGB image, PX pixels per tile, plus the max
height of each loc def (to decide which objects stay 3D)."""
import sys, numpy as np
from js5 import Cache
import rs3model, rs3map, rs3loc
from convert import material_diffuse, hsl16_to_rgb, is_greyscale
from aod import loc_models, RS3_REGION, RS3_PLANE

PX = 8
FLOOR_MAX = 48
BACKGROUND = (0x38 / 255, 0x38 / 255, 0x38 / 255)

_vcol = {}
def vrgb(c):
    if c not in _vcol: _vcol[c] = hsl16_to_rgb(int(c))
    return _vcol[c]


def render(cache, floor_max=FLOOR_MAX, skip=()):
    fs = cache.files(5, RS3_REGION)
    L = [l for l in rs3map.locs(fs[0]) if l[3] == RS3_PLANE]
    G = 64 * PX
    img = np.zeros((G, G, 3)); img[:] = BACKGROUND
    tris = []                                   # (mean height, xs, zs, uv(3,2) or None, tex, rgb(3,3), alpha(3))
    heights = {}
    models = {}
    for lid, x, y, z, typ, rot, ex in L:
        if lid in skip: continue
        mids, _, _ = loc_models(cache, lid, typ)
        info = rs3loc.decode(cache.files(16, lid >> 8)[lid & 255]); sx, sy = info['sx'], info['sy']
        if rot & 1: sx, sy = sy, sx
        for mid in mids or []:
            if mid not in models:
                try: models[mid] = rs3model.decode(cache.group(47, mid))
                except Exception: models[mid] = None
            m = models[mid]
            if m is None: continue
            p = m.pos.astype(float) / 4.0
            vx, vh, vz = p[:, 0], p[:, 1], p[:, 2]
            heights[lid] = max(heights.get(lid, -1e9), float(vh.max()))
            for _ in range(rot): vx, vz = vz, -vx
            wx = (vx + (x + sx / 2) * 128) / 128 * PX
            wz = (vz + (y + sy / 2) * 128) / 128 * PX
            for mesh in m.meshes:
                if mesh['hidden'] or not len(mesh['tris']): continue
                tex = material_diffuse(cache, mesh['material'])
                grey = tex is not None and is_greyscale(tex)
                for t in mesh['tris']:
                    if vh[t].max() > floor_max: continue
                    tris.append((vh[t].mean(), wx[t], wz[t], m.uv[t] if tex is not None else None, tex, grey,
                                 np.array([vrgb(c) for c in m.colour[t]]), m.alpha[t] / 255.0))
    tris.sort(key=lambda r: r[0])
    for h, xs, zs, uv, tex, grey, cols, al in tris:
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
        if not ins.any(): continue
        W = np.stack([w0[ins], w1[ins], w2[ins]], 1)
        vc = W @ cols; a = W @ al
        if tex is not None:
            u = W @ uv
            th, tw = tex.shape[:2]
            px = tex[np.clip((np.mod(u[:, 1], 1) * th).astype(int), 0, th - 1), np.clip((np.mod(u[:, 0], 1) * tw).astype(int), 0, tw - 1)]
            rgb = px[:, :3]
            if grey: rgb = np.clip(vc * (rgb.mean(1, keepdims=True) / max(1e-3, float(tex[..., :3].mean()))), 0, 1)
            a = a * px[:, 3]
        else:
            rgb = vc
        sub = img[x0:x1 + 1, z0:z1 + 1]
        cur = sub[ins]
        sub[ins] = cur * (1 - a[:, None]) + rgb * a[:, None]
    return img, heights


if __name__ == '__main__':
    from PIL import Image
    cache = Cache(sys.argv[1])
    img, heights = render(cache)
    for lid, h in sorted(heights.items(), key=lambda kv: kv[1]): print(lid, round(h))
    out = (np.flipud(img.transpose(1, 0, 2)) * 255).astype(np.uint8)
    Image.fromarray(out).save('_preview/aod-textured.png')
