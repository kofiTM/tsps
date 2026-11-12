"""Stage 2 of the Angel of Death arena: the RS3 arena scenery as real OSRS objects.

For every RS3 loc on plane 2 of region 3628 (950 cache), per placement type:
  - its RS3 models are converted (convert.py) and merged into one OSRS model
    -> data/models/aod/<model id>.dat, listed in data/definitions/custom-models.json;
  - a new OSRS loc definition is appended after the cache's own ids (opcode 6: int model id +
    type, sizes, non-solid - the baked terrain already carries the collision)
    -> data/definitions/aod-locs.json, an archived-definition bundle installed by
    plugins/bosses/AngelOfDeath.plugin.js;
  - the placements are written as the object file of data/regions/8260.pack.

    python3 aod_locs.py <rs3 950 cache>        (run aod.py first: it writes the terrain)
"""
import base64, json, os, struct, sys, zlib
import numpy as np
from js5 import Cache
import convert, osrsmodel, rs3map, rs3loc, aod_paint
from aod import loc_models, ROOT, RS3_REGION, RS3_PLANE, OSRS_REGION

FIRST_LOC = 63600
# The four pillars are attackable in the fight: npcs instead of locs (rev 242 has 16876 npcs and upstream's seasonal archives use up to 16907, so ours start at 17000;
# 17000 is the Angel of Death).
PILLARS = {100812: ('Pillar of Blood', 17001), 100814: ('Pillar of Ice', 17002),
           100816: ('Pillar of Smoke', 17003), 100818: ('Pillar of Shadow', 17004)}            # rev 242 has locs up to 63333 and upstream's seasonal archives use up to 63467, so ours start at 63600
FIRST_MODEL = 1000400
MAX_TRIS = 1800
MODEL_DIR = os.path.join(ROOT, 'data', 'models', 'aod')
CACHE_INFO = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}


def def_type(typ):
    if typ == 11: return 10            # diagonal objects use the normal model
    if 5 <= typ <= 8: return 4         # wall decoration variants use the type 4 model
    return typ


def merge(parts):
    vs, fs, cs = [], [], []; off = 0
    for m in parts:
        vs.append(m['verts']); fs.append(np.asarray(m['faces']) + off); cs.append(np.asarray(m['colours'])); off += len(m['verts'])
    return np.concatenate(vs), np.concatenate(fs), np.concatenate(cs)


def smart(v):
    out = b''
    while v >= 32767: out += struct.pack('>H', 32767 + 0x8000); v -= 32767
    return out + (bytes([v]) if v < 128 else struct.pack('>H', v + 0x8000))


def main():
    cache = Cache(sys.argv[1])
    fs = cache.files(5, RS3_REGION)
    L = [l for l in rs3map.locs(fs[0]) if l[3] == RS3_PLANE]
    os.makedirs(MODEL_DIR, exist_ok=True)
    defs = {}                          # (rs3 id, def type) -> {'id', 'model', 'sx', 'sy'}
    placements = []                    # (osrs id, x, y, type, rot)
    next_model = FIRST_MODEL
    DROP = {59565, 78750}              # RS3 floor-art carriers (invisible here): the painted floor replaces them
    for lid, x, y, z, typ, rot, ex in L:
        if lid in DROP: continue
        if lid not in PILLARS and aod_paint.LO <= x < aod_paint.HI and aod_paint.LO <= y < aod_paint.HI:
            print('  interior object', lid, 'at', x, y, 'type', typ)
        dt = def_type(typ)
        key = (lid, dt)
        if key not in defs:
            mids, _, _ = loc_models(cache, lid, typ)
            info = rs3loc.decode(cache.files(16, lid >> 8)[lid & 255]); sx, sy = info['sx'], info['sy']
            parts = []
            for mid in mids or []:
                try:
                    d, info = convert.convert(cache, mid, False, MAX_TRIS, tint=True)
                    parts.append(osrsmodel.decode(d))
                except Exception as e:
                    print('  model', mid, 'failed:', e)
            if not parts:
                defs[key] = None; continue
            v, f, c = merge(parts)
            data = osrsmodel.encode(v, f, c)
            mid_out = next_model; next_model += 1
            open(os.path.join(MODEL_DIR, '%d.dat' % mid_out), 'wb').write(data)
            defs[key] = {'id': FIRST_LOC + len([d for d in defs.values() if d]), 'model': mid_out, 'sx': sx, 'sy': sy,
                         'rs3': lid, 'type': dt, 'tris': len(f), 'bytes': len(data)}
        d = defs[key]
        if d and lid in PILLARS:
            d.setdefault('spawns', []).append((x, y, rot))
        elif d:
            placements.append((d['id'], x, y, typ, rot))
    live = [d for d in defs.values() if d]
    # the painted floor: one floor decoration (type 22) per 8x8 block
    floor, _ = aod_paint.build(rs3map.terrain(fs[3]))
    for data, cx, cz, nf in floor:
        mid_out = next_model; next_model += 1
        open(os.path.join(MODEL_DIR, '%d.dat' % mid_out), 'wb').write(data)
        d = {'id': FIRST_LOC + len(live), 'model': mid_out, 'sx': 1, 'sy': 1, 'rs3': 0, 'type': 22, 'tris': nf,
             'bytes': len(data), 'floor': (cx, cz)}
        live.append(d)
        placements.append((d['id'], cx, cz, 22, 0))
    print('loc definitions', len(live), 'placements', len(placements))
    for d in live:
        print('  loc %d <- rs3 %d type %d: model %d, %d tris, %d bytes, size %dx%d' % (d['id'], d['rs3'], d['type'], d['model'], d['tris'], d['bytes'], d['sx'], d['sy']))
    # models
    cm_path = os.path.join(ROOT, 'data', 'definitions', 'custom-models.json')
    cm = json.load(open(cm_path))
    cm = {k: v for k, v in cm.items() if not v.startswith('aod/')}
    for d in live: cm[str(d['model'])] = 'aod/%d.dat' % d['model']
    json.dump(cm, open(cm_path, 'w'), indent=2)
    # loc definitions (OSRS rev 241 opcodes)
    rows = []
    pillars = []
    for d in live:
        if d['rs3'] not in PILLARS: continue
        name, npc = PILLARS[d['rs3']]
        b = bytes([0x3d, 1]) + struct.pack('>i', d['model'])          # opcode 61: int model ids
        b += b'\x02' + name.encode() + b'\x00'                         # name
        b += bytes([12, d['sx']])                                        # size
        b += b'\x1f' + b'Attack\x00'                                   # option 2: Attack
        b += bytes([93, 0])                                              # no minimap dot; end
        rows.append({"kind": "npc", "symbol": "aod_" + name.lower().replace(' ', '_'), "sourceId": npc, "id": npc,
                     "dataBase64": base64.b64encode(b).decode(), "crc": zlib.crc32(b) & 0xffffffff})
        for x, y, rot in d['spawns']:
            pillars.append({"npc": npc, "name": name, "x": x, "y": y, "rot": rot, "size": d['sx']})
    json.dump(pillars, open(os.path.join(ROOT, 'data', 'definitions', 'aod-pillars.json'), 'w'), indent=1)
    for d in live:
        if d['rs3'] in PILLARS: continue
        b = bytearray([6, 1]) + struct.pack('>iB', d['model'], d['type'])
        if d['sx'] != 1: b += bytes([14, d['sx']])
        if d['sy'] != 1: b += bytes([15, d['sy']])
        b += bytes([17, 0])                              # non-solid; then end
        b = bytes(b)
        rows.append({"kind": "loc", "symbol": ('aod_floor_%d_%d' % d['floor']) if 'floor' in d else 'aod_%d_%d' % (d['rs3'], d['type']), "sourceId": d['id'], "id": d['id'],
                     "dataBase64": base64.b64encode(b).decode(), "crc": zlib.crc32(b) & 0xffffffff})
    bundle = {"id": "aod-arena", "targetCache": CACHE_INFO,
              "sourceCache": dict(CACHE_INFO, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
              "definitions": rows}
    json.dump(bundle, open(os.path.join(ROOT, 'data', 'definitions', 'aod-locs.json'), 'w'), indent=1)
    # object file: ids ascending, positions ascending within each id
    obj = bytearray(); last_id = -1
    by_id = {}
    for oid, x, y, typ, rot in placements: by_id.setdefault(oid, []).append(((x << 6) | y, (typ << 2) | (rot & 3)))
    for oid in sorted(by_id):
        obj += smart(oid - last_id); last_id = oid
        pos = 0
        for p, attr in sorted(by_id[oid]):
            obj += smart(p - pos + 1); pos = p
            obj += bytes([attr])
        obj += smart(0)
    obj += smart(0)
    # rewrite the pack with these objects
    path = os.path.join(ROOT, 'data', 'regions', '%d.pack' % OSRS_REGION)
    pack = open(path, 'rb').read()
    ol = struct.unpack('>i', pack[20:24])[0]
    terr = pack[24 + ol + 4:]
    out = pack[:20] + struct.pack('>i', len(obj)) + bytes(obj) + struct.pack('>i', len(terr)) + terr
    open(path, 'wb').write(out)
    print('wrote', path, len(out), 'bytes; object file', len(obj))


if __name__ == '__main__':
    main()
