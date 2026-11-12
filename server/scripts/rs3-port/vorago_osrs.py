"""Vorago, OSRS style: a low-poly rigid-piece model on his own RS3 skeleton, with his real RS3 animations.

    python3 vorago_osrs.py "<950 cache>" "<2016 cache>"            # dry run: sizes and checks only
    python3 vorago_osrs.py "<950 cache>" "<2016 cache>" --write

Why it doesn't stretch: his own RS3 skeleton (not Graardor's, which tore him apart in every animation),
and every triangle that would stretch more than MAX_STRETCH in any frame of his animations is turned
into overlapping rigid plates, one per bone it touches (a fully rigid model cracked open ~50-160 units
at the joints instead). Elsewhere the skin stays connected and bends gently. Low poly: decimated per
bone (vertex clustering keyed by bone, so no bone is lost); colours snapped to fewer shades.

Writes (all ids checked against every custom item model, custom-models.json and custom-seqs.json):
  data/models/vorago/osrs.dat                 model MODEL_ID (custom-models.json)
  data/definitions/custom-seqs.json           base 65000 (RS3 base 3855, rotationDivisor 64) + ANIMS
  data/definitions/vorago.json                npc NPC_ID: Graardor's definition, his model, idle/walk
The customSeqs dataset (AoD rows + these) is one packet: the script refuses to write above SEQ_BUDGET.
Needs the client's custom frame base support (client/custom/seqs: CustomSeqBaseLoader, rotationDivisor).
"""
import base64, json, os, struct, sys, zlib
from collections import Counter
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert, osrsmodel, rs3anim
import osrsanim as A
from js5 import Cache
from osrscache import OsrsCache

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFS = os.path.join(ROOT, 'data', 'definitions')
VORAGO_MODEL = 86771           # 950 cache, index 47
NPC_ID = 17015                 # next appended npc after the AoD's 17000-17014
SOURCE_NPC = 12444             # spare General Graardor: options/combat level come from it
SIZE = 5
TARGET_TRIS = 3000             # OSRS bosses: ~1000-5000; he is 9 tiles tall, so pieces are ~40 units
MAX_STRETCH = 0.15             # triangles stretching more (16%) in any frame become rigid plates
PLATE_INSET = 1.5
SHADE_STEP = 6                 # lightness snapped to steps of 6 (of 127): flatter, OSRS-like shading
RS3_BASE, BASE_ID, ROT_DIV = 3855, 65000, rs3anim.ROTATION_DIVISOR
SEQ_OFFSET, FIRST_RS3 = 60200, 20316      # custom seq = 60200 + (rs3 seq - 20316)
SEQ_BUDGET = 60000             # compressed customSeqs packet (limit 65535): keep headroom
# rs3 seq: (role, keep every Nth frame; the client tweens between kept frames)
ANIMS = {20316: ('idle', 2), 20317: ('walk', 2), 20323: ('rise', 2), 20328: ('swipe', 2),
         20356: ('punch', 2), 20319: ('throw blue', 2), 20355: ('throw red', 2), 20363: ('slam', 2),
         20318: ('block', 1), 20360: ('kneel', 2), 20361: ('kneeling', 2), 20352: ('death', 4)}
SCALING = {20323, 20363, 20352}   # rise/slam/death: RS3 grows and shrinks pieces on purpose
TEMPLATES = {20316: 7017, 20317: 7016, 20352: 7020}   # Graardor idle/walk/death, others his attack 7018


def seq_id(rs3): return SEQ_OFFSET + rs3 - FIRST_RS3


def lowpoly(data):
    """Decimate per bone: clusters are keyed by (cell, bone), so no bone is merged away and vertices
    still connect across bones where the RS3 mesh did (a skinned mesh)."""
    m = osrsmodel.decode(data)
    V = np.asarray(m['verts'], float); F = np.asarray(m['faces']); C = np.asarray(m['colours']).astype(np.int64)
    L = np.asarray(m['vskins'])
    cell = 1.0
    while True:
        q = np.column_stack([np.round(V / cell).astype(np.int64), L])
        uq, ci = np.unique(q, axis=0, return_inverse=True); ci = ci.reshape(-1); f = ci[F]
        keep = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
        _, first = np.unique(np.sort(f[keep], 1), axis=0, return_index=True)
        if len(first) <= TARGET_TRIS or cell > 64: break
        cell *= 1.1
    rep = np.zeros((len(uq), 3)); np.add.at(rep, ci, V); rep /= np.bincount(ci, minlength=len(uq))[:, None]
    sel = np.where(keep)[0][np.sort(first)]
    faces, cols = f[sel], C[sel]
    used = np.unique(faces); remap = -np.ones(len(uq), np.int64); remap[used] = np.arange(len(used))
    return rep[used], uq[used, 3], remap[faces], cols


def face_stretch(V, L, F, frames):
    """Worst |log edge-length ratio| of each triangle over the frames (client fractional path)."""
    G = A.label_groups(L); E = ((0, 1), (1, 2), (2, 0))
    r0 = np.stack([np.linalg.norm(V[F[:, a]] - V[F[:, b]], axis=1) for a, b in E], 1) + 1e-6
    worst = np.zeros(len(F))
    for fr in frames:
        Va = A.animate_fractional(V, G, fr)
        r = np.stack([np.linalg.norm(Va[F[:, a]] - Va[F[:, b]], axis=1) for a, b in E], 1) + 1e-6
        worst = np.maximum(worst, np.abs(np.log(r / r0)).max(1))
    return worst


def overlap_plates(V, L, F, C, joints):
    """Joint triangles (would stretch) become one rigid copy per bone they touch: overlapping rock
    plates. Copies after the first sit PLATE_INSET units inside so they never z-fight at rest."""
    V = [np.asarray(v, float) for v in V]; L = list(L); Fo, Co = [], []; cache = {}
    for fi, f in enumerate(F):
        if not joints[fi]: Fo.append(list(f)); Co.append(C[fi]); continue
        n = np.cross(V[f[1]] - V[f[0]], V[f[2]] - V[f[0]]); n = n / (np.linalg.norm(n) + 1e-9)
        for k, lab in enumerate(dict.fromkeys(L[v] for v in f)):
            nf = []
            for v in f:
                if L[v] == lab and k == 0: nf.append(v); continue
                key = (v, lab, k)
                if key not in cache: cache[key] = len(V); V.append(V[v] - n * PLATE_INSET * k); L.append(lab)
                nf.append(cache[key])
            Fo.append(nf); Co.append(C[fi])
    return np.array(V), np.array(L), np.array(Fo), np.array(Co)


def build_model(data, frames):
    V, L, F, C = lowpoly(data)
    joints = face_stretch(V, L, F, frames) > MAX_STRETCH
    V, L, F, C = overlap_plates(V, L, F, C, joints)
    after = face_stretch(V, L, F, frames)
    light = np.clip(np.round((C & 127) / SHADE_STEP) * SHADE_STEP, 0, 127).astype(np.int64)
    C = (C & ~127) | light
    body = osrsmodel.encode(np.round(V).astype(np.int64), F, C, vskins=L)
    return body, len(F), int(joints.sum()), after


def packet_size(rows):
    js = json.dumps({'gamemodeId': 'server', 'datasets': [{'key': 'customSeqs', 'rows': rows}]}, separators=(',', ':'))
    return 5 + len(zlib.compress(js.encode()))


def main():
    rs3, old = sys.argv[1], sys.argv[2]; write = '--write' in sys.argv
    full, _ = convert.convert(Cache(rs3), VORAGO_MODEL, False, None, tint=True, raw_labels=True)
    items = json.load(open(os.path.join(DEFS, 'custom-items.json')))
    npc_models = json.load(open(os.path.join(DEFS, 'custom-models.json')))
    taken = {int(k) for i in items for k in (i.get('models') or {})} | {int(k) for k in npc_models}
    mine = [int(k) for k, f in npc_models.items() if f == 'vorago/osrs.dat']
    model_id = mine[0] if mine else next(i for i in range(1100000, 1200000) if i not in taken)
    assert model_id not in {int(k) for i in items for k in (i.get('models') or {})}, 'model id clash'

    anims = rs3anim.Rs3Anims(old); base = anims.base(RS3_BASE)
    obase = A.decode_base(rs3anim.osrs_base(base))
    rows = [{"kind": "base", "id": BASE_ID, "data": rs3anim.b64(rs3anim.osrs_base(base)), "rotationDivisor": ROT_DIV}]
    for sid, (role, step) in ANIMS.items():
        s = anims.seq(sid); fr, ln = s['frames'], s['lengths']
        idx = list(range(0, len(fr), step))
        if idx[-1] != len(fr) - 1: idx.append(len(fr) - 1)
        lens = [sum(ln[i:(idx[k + 1] if k + 1 < len(idx) else len(fr))]) for k, i in enumerate(idx)]
        rows.append({"id": seq_id(sid), "template": TEMPLATES.get(sid, 7018), "name": "vorago " + role,
                     "frameLengths": lens,
                     "frames": [rs3anim.b64(rs3anim.osrs_frame(anims.frame(fr[i]), base, BASE_ID)) for i in idx]})
    frames = []
    for (sid, _), row in zip(ANIMS.items(), rows[1:]):
        if sid in SCALING: continue
        for b64 in row['frames']:
            f = A.decode_frame(base64.b64decode(b64), lambda i: obase)
            f['ops'] = [(i, x / ROT_DIV, y / ROT_DIV, z / ROT_DIV, r) if obase['types'][i] == 2 else (i, x, y, z, r)
                        for i, x, y, z, r in f['ops']]
            frames.append(f)
    body, tris, joints, after = build_model(full, frames)
    print('model', tris, 'tris,', joints, 'joint triangles made plates, worst stretch left %.2f'
          ' (%d tris over %.2f: RS3-scaled bones)' % (after.max(), (after > MAX_STRETCH + 0.01).sum(), MAX_STRETCH), len(body), 'bytes')
    pkt = len(json.dumps({'key': 'customModels', 'rows': [{'id': model_id, 'data': base64.b64encode(body).decode()}]}))
    assert pkt < 0xffff, 'model packet %d' % pkt
    seqs_path = os.path.join(DEFS, 'custom-seqs.json')
    existing = [r for r in json.load(open(seqs_path))
                if not (r.get('kind') == 'base' and r['id'] == BASE_ID) and not SEQ_OFFSET <= r.get('id', 0) < SEQ_OFFSET + 100]
    clash = {r['id'] for r in existing} & {r['id'] for r in rows}
    assert not clash, 'seq id clash %s' % clash
    size = packet_size(existing + rows)
    print('anims', len(rows) - 1, 'frames', sum(len(r['frames']) for r in rows[1:]),
          '| customSeqs packet', size, 'bytes with the AoD rows (budget %d, limit 65535)' % SEQ_BUDGET)
    assert size <= SEQ_BUDGET, 'customSeqs packet too large'

    o = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    d = o.files(2, 9)[SOURCE_NPC]; assert d[-1] == 0
    idle, walk = seq_id(20316), seq_id(20317)
    d = d[:-1] + b'\x02Vorago\x00' + bytes([12, SIZE])
    d += struct.pack('>BH', 13, idle) + struct.pack('>BH', 14, walk)
    d += struct.pack('>BH', 15, idle) + struct.pack('>BH', 16, idle) + struct.pack('>BHHHH', 17, walk, walk, walk, walk)
    d += struct.pack('>BBi', 61, 1, model_id) + b'\x00'
    cinfo = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}   # bundle target (was 241 before the upstream merge)
    bundle = {"id": "vorago", "targetCache": cinfo,
              "sourceCache": dict(cinfo, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
              "definitions": [{"kind": "npc", "symbol": "vorago", "sourceId": NPC_ID, "id": NPC_ID,
                               "dataBase64": base64.b64encode(d).decode(), "crc": zlib.crc32(d) & 0xffffffff}]}
    print('npc', NPC_ID, 'model', model_id)
    if not write: return
    os.makedirs(os.path.join(ROOT, 'data', 'models', 'vorago'), exist_ok=True)
    open(os.path.join(ROOT, 'data', 'models', 'vorago', 'osrs.dat'), 'wb').write(body)
    npc_models[str(model_id)] = 'vorago/osrs.dat'
    json.dump(npc_models, open(os.path.join(DEFS, 'custom-models.json'), 'w'), indent=2)
    json.dump(existing + rows, open(seqs_path, 'w'), indent=1)
    json.dump(bundle, open(os.path.join(DEFS, 'vorago.json'), 'w'), indent=1)
    print('written')


if __name__ == '__main__':
    main()
