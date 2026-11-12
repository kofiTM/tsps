"""Vorago's phase-1 arena (the Borehole) -> OSRS region 8772 (34, 68: blank in rev 241).

    python3 vorago_arena.py "<950 cache>" [--write]

Source: RS3 950 cache region 12208 (48, 95); the 950 server source (Ataraxia950 VoragoInstance) puts phase 1
at (3104, 6112) = local (32, 32). How the RS3 arena is built (found 11 Nov 2026):
  * the arena tiles carry a *hidden* overlay (161) on level 1: the floor you see is objects - four
    10x10 rock slabs each of 84872/84874 (type 10) and 31 floor decorations (type 22), all on level 0;
  * the boundary is 104 invisible walls (loc 84, level 1, no model) plus blocked tile settings;
  * level-0 heights: 45 under the arena, up to 96 at the cave walls.
Port: level 0 heights (minus 44) and underlay colours (nearest plain OSRS underlay; hidden overlays are
dropped), tiles blocked where RS3 blocks them on level 0 or 1, and every visible level 0/1 object as a
new OSRS loc (models converted with convert.py, one merged model per RS3 loc and placement type; RS3
per-placement scale/offset baked into a model variant). Levels 2-3 (cave ceiling) are left out.

Safety (lessons from the Vorago/AoD break): model ids from 1200000 and loc ids after every existing
archived loc are checked for clashes; the region pack, every model packet and the definition-archive
packet (all bundles together) are checked against the 64 KB limits before anything is written.
"""
import base64, glob, json, os, struct, sys, zlib
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from js5 import Cache, Buf
from osrscache import OsrsCache
import convert, osrsmodel, rs3map, rs3loc
from aod import loc_models, osrs_overlays
from aod_locs import def_type, merge, smart

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFS = os.path.join(ROOT, 'data', 'definitions')
RS3_REGION = 12208
OSRS_REGION = 8772
FIRST_MODEL = 1200000
MODEL_DIR = os.path.join(ROOT, 'data', 'models', 'vorago-arena')
MAX_TRIS = 1500
FILL_RGB = np.array([0x60, 0x58, 0x48], float)   # dull rock under the slabs
WALLS = {0, 1, 2, 3, 9}                     # solid in OSRS (walls block their edges)
CACHE_INFO = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}


def rs3_floor_rgb(cache, group, fid):
    """(rgb, hidden) of an RS3 underlay (group 1) / overlay (group 4); ids in terrain are +1."""
    d = cache.files(2, group).get(fid - 1)
    if not d: return None, True
    b = Buf(d); rgb = None; hidden = False
    try:
        while b.left():
            op = b.u8()
            if op == 0: break
            if op == 1: rgb = b.u24()
            elif op in (2, 3): b.u16()
            elif op == 5: hidden = True
            else: break
    except Exception: pass
    if rgb == 0xff00ff: hidden = True
    return rgb, hidden


def osrs_underlays():
    c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    out = []
    for uid, d in c.files(2, 1).items():
        if d and d[0] == 1:
            rgb = int.from_bytes(d[1:4], 'big'); out.append((uid, np.array([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], float)))
    return out


def main():
    cache = Cache(sys.argv[1]); write = '--write' in sys.argv
    fs = cache.files(5, RS3_REGION); T = rs3map.terrain(fs[3])
    unders = osrs_underlays(); ucols = np.array([c for _, c in unders]); uids = [i for i, _ in unders]
    over = osrs_overlays(); ocols = np.array([c for _, c in over]) * 255; oids = [i for i, _ in over]
    # ---- terrain (OSRS level 0 only)
    terr = bytearray(); blocked = np.zeros((64, 64), bool)
    hmin = min(T[(0, x, y)].get('h', 45) for x in range(64) for y in range(64))
    for z in range(4):
        for x in range(64):
            for y in range(64):
                if z: terr += struct.pack('>H', 0); continue
                t0, t1 = T[(0, x, y)], T[(1, x, y)]
                for t in (t1, t0):                       # visible overlay: level 1 first, then level 0
                    if 'ov' in t:
                        rgb, hidden = rs3_floor_rgb(cache, 4, t['ov'])
                        if not hidden and rgb is not None:
                            c = np.array([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], float)
                            o = oids[int(((ocols - c) ** 2).sum(1).argmin())]
                            terr += struct.pack('>HH', 2 + min(t.get('shape', 0), 47), o + 1)
                            break
                setting = 1 if ((t0.get('set', 0) | t1.get('set', 0)) & 1) else 0
                blocked[x, y] = bool(setting)
                if setting: terr += struct.pack('>H', 50)
                un = t1.get('un') or t0.get('un')
                c = None
                if un:
                    rgb, hidden = rs3_floor_rgb(cache, 1, un)
                    if rgb is not None and not hidden:
                        c = np.array([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255], float)
                if c is None:
                    # Every tile gets a floor: RS3 hides the arena tiles and draws rock slabs on top, but
                    # the OSRS client only lets you click (walk to) tiles that have a floor (kofi: "can't
                    # click anywhere but the map to move"). The slabs cover it.
                    c = FILL_RGB
                terr += struct.pack('>H', 81 + uids[int(((ucols - c) ** 2).sum(1).argmin())] + 1)
                h = max(1, t0.get('h', hmin) - hmin + 1)
                terr += struct.pack('>H', 1) + bytes([min(h, 255)])
    # ---- objects
    L = [l for l in rs3map.locs(fs[0]) if l[3] in (0, 1)]
    taken_models = {int(k) for k in json.load(open(os.path.join(DEFS, 'custom-models.json')))
                    if not json.load(open(os.path.join(DEFS, 'custom-models.json')))[k].startswith('vorago-arena/')}
    taken_models |= {int(k) for r in json.load(open(os.path.join(DEFS, 'custom-items.json'))) for k in (r.get('models') or {})}
    bundles = {}
    for f in glob.glob(os.path.join(DEFS, '*.json')):
        try: d = json.load(open(f))
        except Exception: continue
        if isinstance(d, dict) and 'definitions' in d and d.get('id') != 'vorago-arena': bundles[d['id']] = d
    first_loc = 1 + max(x['id'] for b in bundles.values() for x in b['definitions'] if x['kind'] == 'loc')
    defs, placements, models, mcache = {}, [], {}, {}
    next_model = FIRST_MODEL
    for lid, x, y, z, typ, rot, ex in L:
        dt = def_type(typ)
        ekey = tuple(sorted((k, v) for k, v in (ex or {}).items() if k in ('ox', 'oy', 'oz', 'scale', 'sx', 'sy', 'sz')))
        key = (lid, dt, ekey)
        if key not in defs:
            mids, lsx, lsy = loc_models(cache, lid, typ)
            try: info = rs3loc.decode(cache.files(16, lid >> 8)[lid & 255])
            except Exception: info = {'sx': lsx, 'sy': lsy}
            parts = []
            for mid in mids or []:
                if mid not in mcache:
                    try: mcache[mid] = osrsmodel.decode(convert.convert(cache, mid, False, MAX_TRIS, tint=True)[0])
                    except Exception as e: print('  model', mid, 'failed:', e); mcache[mid] = None
                if mcache[mid] is not None: parts.append(mcache[mid])
            if not parts: defs[key] = None; continue
            v, f, c = merge(parts); v = v.astype(float); e = dict(ekey)
            sc = e.get('scale', 128) / 128.0
            v = v * np.array([e.get('sx', 128) / 128.0 * sc, e.get('sy', 128) / 128.0 * sc, e.get('sz', 128) / 128.0 * sc])
            v = v + np.array([e.get('ox', 0) / 4.0, -e.get('oy', 0) / 4.0, e.get('oz', 0) / 4.0])
            while next_model in taken_models: next_model += 1
            data = osrsmodel.encode(np.round(v).astype(np.int64), f, c)
            models[next_model] = data
            defs[key] = {'id': first_loc + len([d for d in defs.values() if d]), 'model': next_model,
                         'sx': info['sx'], 'sy': info['sy'], 'rs3': lid, 'type': dt, 'tris': len(f)}
            next_model += 1
        if defs[key]: placements.append((defs[key]['id'], x, y, typ, rot))
    live = [d for d in defs.values() if d]
    print('terrain: blocked tiles', int(blocked.sum()), '| locs', len(live), 'definitions,', len(placements), 'placements,',
          len(models), 'models,', sum(d['tris'] for d in live), 'tris')
    rows = []
    for d in live:
        b = bytearray([6, 1]) + struct.pack('>iB', d['model'], d['type'])
        if d['sx'] != 1: b += bytes([14, d['sx']])
        if d['sy'] != 1: b += bytes([15, d['sy']])
        if d['type'] not in WALLS: b += bytes([17])          # non-solid: tile settings carry the collision
        b += bytes([0]); b = bytes(b)
        rows.append({"kind": "loc", "symbol": 'vorago_arena_%d_%d' % (d['rs3'], d['type']), "sourceId": d['id'], "id": d['id'],
                     "dataBase64": base64.b64encode(b).decode(), "crc": zlib.crc32(b) & 0xffffffff})
    bundle = {"id": "vorago-arena", "targetCache": CACHE_INFO,
              "sourceCache": dict(CACHE_INFO, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
              "definitions": rows}
    obj = bytearray(); last_id = -1; by_id = {}
    for oid, x, y, typ, rot in placements: by_id.setdefault(oid, []).append(((x << 6) | y, (typ << 2) | (rot & 3)))
    for oid in sorted(by_id):
        obj += smart(oid - last_id); last_id = oid; pos = 0
        for p, attr in sorted(by_id[oid]):
            obj += smart(p - pos + 1); pos = p; obj += bytes([attr])
        obj += smart(0)
    obj += smart(0)
    pack = struct.pack('>iiiii', 1, OSRS_REGION, OSRS_REGION, OSRS_REGION >> 8, OSRS_REGION & 0xff)
    pack += struct.pack('>i', len(obj)) + bytes(obj) + struct.pack('>i', len(terr)) + bytes(terr)
    # ---- limits
    region_payload = 7 + len(terr) + len(obj)
    js = json.dumps({'gamemodeId': 'server', 'datasets': [{'key': 'definitionArchives', 'rows': list(bundles.values()) + [bundle]}]}, separators=(',', ':')).encode()
    defs_pkt = 5 + len(zlib.compress(js))
    big = max(len(json.dumps({'key': 'customModels', 'rows': [{'id': i, 'data': base64.b64encode(d).decode()}]})) for i, d in models.items())
    print('region payload', region_payload, '(max 65533) | definitionArchives', defs_pkt, '(max 65535) | biggest model packet', big, '| locs', first_loc, '-', first_loc + len(live) - 1)
    assert region_payload <= 0xfffd and defs_pkt <= 0xffff and big < 0xffff, 'over a packet limit: not writing'
    if not write: return
    os.makedirs(MODEL_DIR, exist_ok=True)
    cm = {k: v for k, v in json.load(open(os.path.join(DEFS, 'custom-models.json'))).items() if not v.startswith('vorago-arena/')}
    for i, d in models.items():
        open(os.path.join(MODEL_DIR, '%d.dat' % i), 'wb').write(d); cm[str(i)] = 'vorago-arena/%d.dat' % i
    json.dump(cm, open(os.path.join(DEFS, 'custom-models.json'), 'w'), indent=2)
    json.dump(bundle, open(os.path.join(DEFS, 'vorago-arena.json'), 'w'), indent=1)
    os.makedirs(os.path.join(ROOT, 'data', 'regions'), exist_ok=True)
    open(os.path.join(ROOT, 'data', 'regions', '%d.pack' % OSRS_REGION), 'wb').write(pack)
    print('written: data/regions/%d.pack, vorago-arena.json, %d models' % (OSRS_REGION, len(models)))


if __name__ == '__main__':
    main()
