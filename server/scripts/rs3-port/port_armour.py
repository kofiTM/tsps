"""RS3 armour -> TSPS custom items (worn on the OSRS player body).

    python3 port_armour.py "<950 cache>" [--write]

How worn armour differs from weapons (port_items.py):
  * RS3 worn models still carry the classic 2007 player labels (convert.py raw_labels), and they are the
    OSRS player's labels (head 1/3/49, torso 17-26, legs 29-44...), so the armour bends with the body.
    But some label numbers mean different body parts in the two games (RS3 216 is a coat skirt, 93/58
    shoulder pads; in OSRS they move other parts, which stretched the robe top in OSRS animations).
    So a piece keeps only the labels OSRS's own armour of that slot uses (SLOT_LABELS, collected from
    Virtus, Ancestral, Bandos, Armadyl, Mystic, Fighter torso, Neitiznot, Serpentine...); every other
    vertex takes the label of the nearest vertex that has one of them.
  * Placement: RS3 bodies are close to OSRS ones. Each piece gets an offset (and optional uniform scale)
    found by matching its label centroids against the OSRS base item's worn model and checking that the
    OSRS body does not poke through (see docs/rs3-armour-port-guide.md).
  * Male and female worn models are separate (RS3 has both).
  * Safety: new model ids are checked against every custom-items.json model AND custom-models.json
    (npc/boss models): a duplicate id stops the server's whole custom content loader. The customItems
    packet must stay under 64 KB, and each model packet too.
"""
import json, os, sys, zlib, base64
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert, icon, osrsmodel, rs3obj, osrsanim as A
from js5 import Cache
from osrscache import OsrsCache
from port_items import ROOT, MODELS, ITEMS, slug, transport_size

ARMOUR = [
    # id, RS3 item, OSRS base item (stats, equip slot, hidden body parts), tris (ground, worn), offsets
    dict(id=50333, rs3=43166, name='Elite tectonic mask', base=26241, slot='head', tris=(700, 700),
         male=(1.0, (0, 6, -10)), female=(1.0, (0, 6, -8)),
         examine='A mask crafted from the shell of Vorago, the strongest creature in Gielinor.'),
    dict(id=50334, rs3=43169, name='Elite tectonic robe top', base=26243, slot='torso', tris=(1000, 1400),
         male=(1.0, (0, 0, 0)), female=(1.0, (0, 0, 0)),
         examine='A robe top crafted from the shell of Vorago, the strongest creature in Gielinor.'),
    dict(id=50335, rs3=43172, name='Elite tectonic robe bottom', base=26245, slot='legs', tris=(1000, 1200),
         male=(1.0, (0, 0, 0)), female=(1.0, (0, 0, 0)),
         examine='Robe bottoms crafted from the shell of Vorago, the strongest creature in Gielinor.'),
]
MODEL_PACKET_LIMIT = 0xffff
r = lambda a, b: set(range(a, b + 1))
SLOT_LABELS = {
    'head': {1, 2, 3, 49},
    'torso': {2, 4, 5, 8, 59, 60, 86, 91, 92} | r(17, 26),
    'legs': {5, 57, 76, 77, 166, 167} | r(29, 44) | r(79, 83),
}


def player_labels():
    """Every label the OSRS player skeleton moves (frame base of the standing animation, seq 808)."""
    o = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    seqs = o.files(2, 12)
    fid = A.decode_seq(seqs[808])['frames'][0]
    base_id = int.from_bytes(o.files(0, fid >> 16)[fid & 0xffff][:2], 'big')
    base = A.decode_base(list(o.files(1, base_id).values())[0])
    return {l for ls in base['labels'] for l in ls}


LEFT_ARM, RIGHT_ARM = {17, 18, 19, 20, 21}, {22, 23, 24, 25, 26}
# RS3 sleeve/shoulder labels -> which OSRS arm chain they belong to (Elite tectonic robe top; RS3 puts a
# whole shoulder pad + upper sleeve on 20/26, then jumps straight to the forearm 19/22)
ARM_SIDE = {17: LEFT_ARM, 19: LEFT_ARM, 20: LEFT_ARM, 21: LEFT_ARM, 93: LEFT_ARM, 169: LEFT_ARM,
            22: RIGHT_ARM, 23: RIGHT_ARM, 25: RIGHT_ARM, 26: RIGHT_ARM, 58: RIGHT_ARM, 147: RIGHT_ARM}
PAD_Y = -140            # sleeve vertices higher than this (y is down) are shoulder pad


def torso_labels(v, faces, raw, ref_item, sex):
    """OSRS labels for a robe top / body piece.
    * Sleeves: each vertex takes the nearest bone of its own OSRS arm chain (shoulder 21/25, upper arm
      20/18, elbow 17/23, forearm 19/22), read off the OSRS base item's worn model, then 2 passes of
      neighbour majority so stray vertices don't tear.
    * Shoulder pads (sleeve vertices above PAD_Y): bones 60 (left) / 59 (right). They move with the chest
      and are never used to compute a pivot. OSRS works out each joint's pivot by averaging every
      vertex with that joint's label, armour included: ~150 pad vertices on the shoulder bone dragged the
      shoulder pivot 33 units off the body (kofi: "the shoulder is completely in the wrong place").
    * Everything else (chest, collar, skirt): torso 8. The skirt hangs at hand height; nearest-vertex
      labelling attached it to the forearms, so it stretched out to the arms when running."""
    from collections import Counter
    from osrscache import obj_models, model_vertices, model_labels
    o = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    d = o.group(7, obj_models(o.files(2, 10)[ref_item])[sex])
    rv = np.asarray(model_vertices(d), float); rl = np.asarray(model_labels(d))
    out = np.full(len(v), 8, np.int64)
    side = [ARM_SIDE.get(int(l)) for l in raw]
    for i, p in enumerate(v):
        if side[i] is None: continue
        pool = np.isin(rl, list(side[i])); j = np.where(pool)[0][((rv[pool] - p) ** 2).sum(1).argmin()]
        out[i] = rl[j]
    nb = [set() for _ in v]
    for a, b, c in faces: nb[a] |= {b, c}; nb[b] |= {a, c}; nb[c] |= {a, b}
    for _ in range(2):
        new = out.copy()
        for i in range(len(v)):
            if side[i] is None: continue
            new[i] = Counter([out[j] for j in nb[i] if side[j] is side[i]] + [out[i]]).most_common(1)[0][0]
        out = new
    for i, p in enumerate(v):
        if side[i] is not None and p[1] < PAD_Y and out[i] in (18, 20, 21, 24, 25, 26):
            out[i] = 60 if p[0] < 0 else 59
    return out


# Player animations the stretch check runs: stand, walk, run, turns, casts, unarmed and weapon attacks.
CHECK_ANIMS = [808, 819, 824, 820, 821, 822, 711, 1979, 422, 423, 390, 386, 395, 400, 401, 426, 4230, 428, 419]
BODY_KIT = (28515, 26632, 28285)    # OSRS default male torso, arms, legs: pivots come from body + armour
MAX_STRETCH = 0.18                  # a triangle stretching more than 20% in any frame becomes plates
PLATE_INSET = 0.8
_anim_cache = {}


def _player_frames():
    if 'f' not in _anim_cache:
        import aod_armour
        o = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20')); an = aod_armour.Anims(o)
        body = [A.decode_v3(o.group(7, m)) for m in BODY_KIT]
        _anim_cache['f'] = ([an.frame(f) for s in CHECK_ANIMS for f in an.seq(s)['frames'][::2]], body)
    return _anim_cache['f']


def face_stretch(v, faces, lab):
    """Worst |log edge ratio| per armour triangle, worn on the OSRS body, over CHECK_ANIMS."""
    frames, body = _player_frames()
    V = np.vstack([np.asarray(b['verts'], float) for b in body] + [np.asarray(v, float)])
    L = np.concatenate([np.asarray(b['vskins']) for b in body] + [np.asarray(lab)])
    G = A.label_groups(L); F = np.asarray(faces) + sum(len(b['verts']) for b in body); E = ((0, 1), (1, 2), (2, 0))
    r0 = np.stack([np.linalg.norm(V[F[:, a]] - V[F[:, b]], axis=1) for a, b in E], 1) + 1e-6
    worst = np.zeros(len(F))
    for fr in frames:
        Va = A.animate_fractional(V, G, fr)
        r = np.stack([np.linalg.norm(Va[F[:, a]] - Va[F[:, b]], axis=1) for a, b in E], 1) + 1e-6
        worst = np.maximum(worst, np.abs(np.log(r / r0)).max(1))
    return worst


def plates(v, faces, cols, lab, joints):
    """Joint triangles become one rigid copy per bone they touch (overlapping armour plates) instead
    of stretching; copies after the first sit PLATE_INSET inside so they don't flicker at rest."""
    V = [np.asarray(x, float) for x in v]; L = list(lab); Fo, Co = [], []; cache = {}
    for fi, f in enumerate(faces):
        if not joints[fi]: Fo.append(list(f)); Co.append(cols[fi]); continue
        n = np.cross(V[f[1]] - V[f[0]], V[f[2]] - V[f[0]]); n = n / (np.linalg.norm(n) + 1e-9)
        for k, b in enumerate(dict.fromkeys(L[x] for x in f)):
            nf = []
            for x in f:
                if L[x] == b and k == 0: nf.append(x); continue
                key = (x, b, k)
                if key not in cache: cache[key] = len(V); V.append(V[x] - n * PLATE_INSET * k); L.append(b)
                nf.append(cache[key])
            Fo.append(nf); Co.append(cols[fi])
    return np.array(V), np.array(Fo), np.array(Co), np.array(L)


def worn(cache, model, tris, fit, valid, torso_ref=None, sex='male'):
    data, info = convert.convert(cache, model, True, tris, raw_labels=True, tint=True)
    m = osrsmodel.decode(data)
    v = np.asarray(m['verts'], float); lab = np.asarray(m['vskins'], np.int64)
    if torso_ref:
        lab = torso_labels(v, np.asarray(m['faces']), lab, torso_ref, sex)
    bad = ~np.isin(lab, list(valid))
    if bad.any():   # RS3-only labels: nearest vertex with a valid one
        good = np.where(~bad)[0]
        for i in np.where(bad)[0]:
            lab[i] = lab[good[((v[good] - v[i]) ** 2).sum(1).argmin()]]
    s, t = fit
    v = np.round(v * s + np.array(t, float)).astype(np.int64)
    faces, cols = np.asarray(m['faces']), np.asarray(m['colours'])
    joints = face_stretch(v, faces, lab) > MAX_STRETCH
    v2, faces, cols, lab = plates(v, faces, cols, lab, joints)
    after = face_stretch(v2, faces, lab)
    info['plates'] = int(joints.sum()); info['worst'] = round(float(after.max()), 2)
    return osrsmodel.encode(np.round(v2).astype(np.int64), faces, cols, vskins=lab), info, int(bad.sum())


def main():
    cache = Cache(sys.argv[1]); write = '--write' in sys.argv
    src = open(ITEMS, encoding='utf-8').read(); items = json.loads(src)
    mine = {a['id'] for a in ARMOUR}
    others = [i for i in items if i['id'] not in mine]
    taken = {int(k) for i in others for k in (i.get('models') or {})}
    taken |= {int(k) for k in json.load(open(os.path.join(ROOT, 'data', 'definitions', 'custom-models.json')))}
    nxt = max([1100000] + [t for t in taken if t >= 1100000]) + 1
    def new_id():
        nonlocal nxt
        while nxt in taken: nxt += 1
        taken.add(nxt); nxt += 1; return nxt - 1
    rows, files = [], {}
    for a in ARMOUR:
        o = rs3obj.decode(cache.files(19, a['rs3'] >> 8)[a['rs3'] & 255])
        folder = slug(a['name'])
        gdata, ginfo = convert.convert(cache, o['model'], False, a['tris'][0], tint=True)
        ref = a['base'] if a['slot'] == 'torso' else None
        mdata, minfo, mbad = worn(cache, o['male'], a['tris'][1], a['male'], SLOT_LABELS[a['slot']], ref, 'male')
        fdata, finfo, fbad = worn(cache, o['female'], a['tris'][1], a['female'], SLOT_LABELS[a['slot']], ref, 'female')
        xan, yan, zan = o.get('xan2d', 0), o.get('yan2d', 0), o.get('zan2d', 0)
        zoom, ox, oy = icon.fit(osrsmodel.decode(gdata), xan, yan, zan)
        gid, mid, fid = new_id(), new_id(), new_id()
        for mid_, rel, d in ((gid, 'drop.dat', gdata), (mid, 'male.dat', mdata), (fid, 'female.dat', fdata)):
            files[os.path.join(folder, rel)] = d
            pkt = len(json.dumps({'key': 'customModels', 'rows': [{'id': mid_, 'data': base64.b64encode(d).decode()}]}))
            assert pkt < MODEL_PACKET_LIMIT, '%s %s model packet %d bytes' % (a['name'], rel, pkt)
        print(a['id'], a['name'].ljust(28), 'tris', ginfo['tris'], minfo['tris'], finfo['tris'],
              'plates', minfo['plates'], finfo['plates'], 'worst stretch left', minfo['worst'], finfo['worst'],
              'relabelled', mbad, fbad, 'models', gid, mid, fid)
        rows.append({
            'id': a['id'], 'baseItemId': a['base'], 'aliasBase': True,
            'objType': {
                'name': a['name'], 'examine': a['examine'],
                'inventoryActions': ['Wear', None, None, None, 'Drop'], 'isTradable': True,
                'model': gid, 'maleModel': mid, 'femaleModel': fid,
                'maleModel1': -1, 'femaleModel1': -1, 'maleModel2': -1, 'femaleModel2': -1,
                'recolorFrom': [], 'recolorTo': [], 'retextureFrom': [], 'retextureTo': [],
                'zoom2d': zoom, 'xan2d': xan, 'yan2d': yan, 'zan2d': zan, 'offsetX2d': ox, 'offsetY2d': oy,
            },
            'itemDef': {'tradeable': True, 'dropable': True},
            'models': {str(gid): folder + '/drop.dat', str(mid): folder + '/male.dat', str(fid): folder + '/female.dat'},
        })
    out = sorted(others + rows, key=lambda r: r['id'])
    size = transport_size(out)
    print('rows', len(out), 'customItems packet', size, 'bytes (limit 65535)')
    if size > 0xffff: sys.exit('definition packet too large - not writing')
    if not write: return
    for rel, d in files.items():
        os.makedirs(os.path.dirname(os.path.join(MODELS, rel)), exist_ok=True)
        open(os.path.join(MODELS, rel), 'wb').write(d)
    open(ITEMS, 'w', encoding='utf-8').write(json.dumps(out, indent=2, ensure_ascii=False) + ('\n' if src.endswith('\n') else ''))
    print('wrote', ITEMS)


if __name__ == '__main__':
    main()
