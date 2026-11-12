"""Convert RS3 (build 950) models into OSRS-format .dat files for TSPS custom items.

    python3 convert.py <rs3 cache dir> <rs3 model id> <out.dat> [--equip] [--max-tris N]

  * scale RS3 units (512/tile, +Y up) to OSRS (128/tile, -Y up) and fix triangle winding
  * weld duplicate vertices and drop degenerate faces (RS3 splits vertices per UV/normal)
  * optional clustering decimation down to --max-tris
  * each face gets a flat OSRS HSL colour sampled from the material's diffuse texture
    (index 53 PNG); emissive/normal maps are ignored. Untextured meshes use the
    RS3 vertex colour (same 16-bit HSL layout as OSRS).
  * --equip carries the RS3 legacy vertex labels over (they match OSRS: 50 = right-hand
    weapon, 161 = shield/off-hand); --label N forces one label (27 = OSRS left-hand bows).
"""
import argparse, colorsys, io, struct, sys
import numpy as np
from PIL import Image
from js5 import Cache
import rs3model, osrsmodel

WEAPON_LABEL = 50
OSRS_LABELS = {27, 28, 50, 161}


def map_label(l):
    if l in OSRS_LABELS:
        return l
    if 160 <= l <= 170:          # RS3 off-hand/bow-string sub-groups -> off-hand
        return 161
    return WEAPON_LABEL
_tex_cache = {}


def material_diffuse(cache, material_id):
    mats = getattr(cache, '_mats', None)
    if mats is None:
        mats = cache._mats = cache.files(26, 0)
    d = mats.get(material_id) if material_id >= 0 else None
    if not d:
        return None
    off = 8 if d[0] == 1 else 9
    tid = (d[off] << 8) | d[off + 1]
    if tid in _tex_cache:
        return _tex_cache[tid]
    png = cache.group(53, tid)
    img = None
    if png is not None and png[5:9] == b'\x89PNG':
        img = np.asarray(Image.open(io.BytesIO(png[5:])).convert('RGBA'), dtype=np.float32) / 255.0
    _tex_cache[tid] = img
    return img


def hsl16_to_rgb(c):
    h = ((c >> 10) & 63) / 64.0 + 1 / 128.0
    s = ((c >> 7) & 7) / 8.0 + 1 / 16.0
    l = (c & 127) / 128.0
    return colorsys.hls_to_rgb(h, l, s)


def rgb_to_hsl16(rgb):
    r, g, b = [min(1.0, max(0.0, float(x))) for x in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    hi = int(h * 64) & 63
    si = min(7, int(s * 8))
    li = min(127, max(0, int(round(l * 127))))
    return (hi << 10) | (si << 7) | li


def is_greyscale(img):
    rgb = img[..., :3].reshape(-1, 3)
    mx, mn = rgb.max(1), rgb.min(1)
    return float(((mx - mn) / (mx + 1e-6)).mean()) < 0.05


def sample(img, uv):
    hgt, wid = img.shape[:2]
    u = np.mod(uv[..., 0], 1.0)
    v = np.mod(uv[..., 1], 1.0)
    x = np.clip((u * wid).astype(int), 0, wid - 1)
    y = np.clip((v * hgt).astype(int), 0, hgt - 1)
    return img[y, x]


def face_colours(cache, m, raw, tint=False):
    """tint: greyscale textures (RS3 detail maps) take their colour from the vertex colours,
    as in RS3; coloured textures are used as they are."""
    uv = m.uv
    out_faces, out_cols, out_alpha = [], [], []
    for mesh in m.meshes:
        tris = mesh['tris']
        if not len(tris) or mesh['hidden']:
            continue
        img = material_diffuse(cache, mesh['material'])
        if img is not None:
            tuv = uv[tris]                                          # (F,3,2)
            pts = np.concatenate([tuv, tuv.mean(1, keepdims=True),
                                  (tuv + tuv.mean(1, keepdims=True)) / 2], axis=1)
            rgba = sample(img, pts)                                 # (F,7,4)
            rgb = rgba[..., :3].mean(1)
            if tint and is_greyscale(img):
                lum = rgb.mean(1) / max(1e-3, float(img[..., :3].mean()))
                vrgb = np.array([hsl16_to_rgb(int(c)) for c in m.colour[tris].reshape(-1)]).reshape(-1, 3, 3).mean(1)
                rgb = np.clip(vrgb * lum[:, None], 0, 1)
        else:
            rgb = np.array([hsl16_to_rgb(int(c)) for c in m.colour[tris].reshape(-1)]).reshape(-1, 3, 3).mean(1)
        cols = [rgb_to_hsl16(x) for x in rgb]
        a = m.alpha[tris].min(1)
        out_faces.append(tris)
        out_cols += cols
        out_alpha.append(255 - a)
    return np.concatenate(out_faces), np.array(out_cols), np.concatenate(out_alpha)


def weld(verts, faces):
    uniq, inv = np.unique(verts, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    f = inv[faces]
    keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    return uniq, f, keep


def decimate(verts, faces, cols, alphas, max_tris):
    """Vertex-clustering decimation: grow the grid cell until faces <= max_tris."""
    cell = 1.0
    while True:
        q = np.round(verts / cell).astype(np.int64)
        uniq, inv = np.unique(q, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        f = inv[faces]
        keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
        # drop duplicate triangles
        fk = f[keep]
        _, first = np.unique(np.sort(fk, axis=1), axis=0, return_index=True)
        if len(first) <= max_tris or cell > 64:
            # cluster representative = mean of member vertices
            rep = np.zeros((len(uniq), 3))
            np.add.at(rep, inv, verts)
            rep /= np.bincount(inv, minlength=len(uniq))[:, None]
            sel = np.where(keep)[0][np.sort(first)]
            return np.round(rep).astype(np.int64), inv[faces[sel]], cols[sel], alphas[sel], cell, inv
        cell *= 1.15


def convert(cache, model_id, equip=False, max_tris=None, label=None, centre_xy=None,
            recolor=(), retexture=(), tint=False, raw_labels=False):
    """recolor/retexture: RS3 item-definition swaps (vertex HSL colours / material ids),
    which is how most RS3 dyes are applied.
    raw_labels: keep the RS3 legacy vertex labels as they are (NPCs animated with their own RS3
    frames on a ported RS3 skeleton, e.g. vorago_anims.py); implies label-preserving welds."""
    raw = cache.group(47, model_id)
    m = rs3model.decode(raw)
    if recolor:
        table = dict(recolor)
        m.colour = np.array([table.get(int(c), int(c)) for c in m.colour])
    if retexture:
        table = dict(retexture)
        for mesh in m.meshes:
            mesh['material'] = table.get(mesh['material'], mesh['material'])
    faces, cols, alphas = face_colours(cache, m, raw, tint)
    v = m.pos.astype(np.float64) / 4.0
    v[:, 1] = -v[:, 1]                       # RS3 +Y up -> OSRS -Y up
    faces = faces[:, [0, 2, 1]]              # mirror flips handedness: keep faces outward
    if raw_labels:
        labels = np.where(m.label == 0xffff, 0, m.label).astype(np.int64)
        equip = True                         # weld per label and write the labels out
    else:
        labels = np.array([map_label(int(l)) for l in m.label]) if label is None else np.full(len(m.pos), label)
    vr = np.round(v).astype(np.int64)
    if equip:   # never weld across labels: append label as a 4th key column
        uniq, inv = np.unique(np.column_stack([vr, labels]), axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        f = inv[faces]
        keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
        verts, faces, vlabels = uniq[:, :3], f, uniq[:, 3]
    else:
        verts, faces, keep = weld(vr, faces)
        vlabels = np.zeros(len(verts), dtype=np.int64)
    faces, cols, alphas = faces[keep], cols[keep], alphas[keep]
    cell = None
    if max_tris and len(faces) > max_tris:
        old_inv_labels = vlabels
        verts, faces, cols, alphas, cell, inv = decimate(verts.astype(np.float64), faces, cols, alphas, max_tris)
        nl = np.zeros(len(verts), dtype=np.int64); nl[inv] = old_inv_labels; vlabels = nl
    used = np.unique(faces)                  # compact vertex list
    remap = -np.ones(len(verts), dtype=np.int64); remap[used] = np.arange(len(used))
    verts, faces, vlabels = verts[used], remap[faces], vlabels[used]
    if centre_xy is not None:   # move the bounding-box centre (x, y) onto a reference model's
        c = (verts.min(0) + verts.max(0)) / 2
        verts = verts + np.round([centre_xy[0] - c[0], centre_xy[1] - c[1], 0]).astype(np.int64)
    vskins = vlabels if equip else None
    data = osrsmodel.encode(verts, faces, cols, alphas=alphas, vskins=vskins)
    info = {'rs3_vertices': len(m.pos), 'rs3_tris': sum(len(x['tris']) for x in m.meshes),
            'vertices': len(verts), 'tris': len(faces), 'cell': cell,
            'min': verts.min(0).tolist(), 'max': verts.max(0).tolist(),
            'labels': sorted(set(vlabels.tolist())) if equip else None}
    return data, info


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('cache'); ap.add_argument('model', type=int); ap.add_argument('out')
    ap.add_argument('--equip', action='store_true'); ap.add_argument('--max-tris', type=int)
    ap.add_argument('--label', type=int)
    a = ap.parse_args()
    data, info = convert(Cache(a.cache), a.model, a.equip, a.max_tris, a.label)
    open(a.out, 'wb').write(data)
    print(a.out, len(data), 'bytes', info)
