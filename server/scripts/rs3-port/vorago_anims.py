"""Vorago with his own RS3 model, skeleton and animations (replaces vorago.py's Graardor rig).

    python3 vorago_anims.py "<950 cache>" "<2016 cache>"

Writes:
  data/models/vorago/body-rs3.dat     his RS3 model (950 cache, model 86771) keeping RS3's own vertex
                                      labels (convert.py raw_labels) -> model 1000305
  data/definitions/custom-seqs.json   custom frame base 65000 (RS3 base 3855, fine rotations) and his
                                      25 RS3 animations as seqs 60200 + (rs3 id - 20316); AoD rows kept
  data/definitions/vorago.json        npc 17015 "Vorago": Graardor's definition (size 5) with his model,
                                      idle 60200 / walk 60201 (installed by Vorago.plugin.js)

Animations come from the 2016 cache (the 950 cache has no index 0 frames); rs3anim.py has the formats.
Nothing here runs on the server at runtime: the client animates, bots are never sent the data.
"""
import base64, json, os, struct, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert, rs3anim
from js5 import Cache
from osrscache import OsrsCache

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFS = os.path.join(ROOT, 'data', 'definitions')
VORAGO_MODEL = 86771          # 950 cache, index 47
MODEL_ID = 1000305
NPC_ID = 17015                # next free appended npc (AoD bundles use 17000-17014)
SOURCE_NPC = 12444            # spare General Graardor: options, combat level, size come from it
RS3_BASE = 3855
BASE_ID = 65000               # custom frame base (client/custom/seqs CustomSeqBaseLoader)
FIRST_RS3_SEQ = 20316
SEQ_OFFSET = 60200            # custom seq = 60200 + (rs3 id - 20316)
SEQ_GROUPS = range(155, 162)  # rs3 seq groups 20316 >> 7 .. 20383 >> 7, with margin
TEMPLATES = {20316: 7017, 20317: 7016, 20337: 7016, 20352: 7020}   # Graardor idle/walk/death; others 7018
SIZE = 5                      # RS3 Vorago is 5x5


def custom_seq(rs3_id): return SEQ_OFFSET + rs3_id - FIRST_RS3_SEQ


def main():
    rs3, old = sys.argv[1], sys.argv[2]
    data, info = convert.convert(Cache(rs3), VORAGO_MODEL, False, None, tint=True, raw_labels=True)
    out = os.path.join(ROOT, 'data', 'models', 'vorago', 'body-rs3.dat')
    open(out, 'wb').write(data)
    print('model', MODEL_ID, info['vertices'], 'verts', info['tris'], 'tris')

    anims = rs3anim.Rs3Anims(old)
    base = anims.base(RS3_BASE)
    rows = [{"kind": "base", "id": BASE_ID, "data": rs3anim.b64(rs3anim.osrs_base(base)),
             "rotationDivisor": rs3anim.ROTATION_DIVISOR, "name": "Vorago (RS3 base %d)" % RS3_BASE}]
    seqs = sorted(anims.seqs_on_base(RS3_BASE, SEQ_GROUPS))
    for sid in seqs:
        s = anims.seq(sid)
        rows.append({"id": custom_seq(sid), "template": TEMPLATES.get(sid, 7018), "rs3": sid,
                     "frameLengths": s['lengths'],
                     "frames": [rs3anim.b64(rs3anim.osrs_frame(anims.frame(f), base, BASE_ID)) for f in s['frames']]})
    print('seqs', len(seqs), [custom_seq(s) for s in seqs])

    path = os.path.join(DEFS, 'custom-seqs.json')
    keep = [r for r in json.load(open(path)) if not (r.get('kind') == 'base' and r['id'] == BASE_ID)
            and not SEQ_OFFSET <= r.get('id', 0) < SEQ_OFFSET + 100]
    json.dump(keep + rows, open(path, 'w'), indent=1)

    osrs = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    d = osrs.files(2, 9)[SOURCE_NPC]
    assert d[-1] == 0
    d = d[:-1] + b'\x02Vorago\x00' + bytes([12, SIZE])
    idle, walk = custom_seq(20316), custom_seq(20317)
    d += struct.pack('>BH', 13, idle) + struct.pack('>BH', 14, walk)
    # turning in place (15/16) and walk + turn (17): Graardor's would play his frames on Vorago's labels
    d += struct.pack('>BH', 15, idle) + struct.pack('>BH', 16, idle) + struct.pack('>BHHHH', 17, walk, walk, walk, walk)
    d += struct.pack('>BBi', 61, 1, MODEL_ID) + b'\x00'
    cinfo = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}   # bundle target (was 241 before the upstream merge)
    bundle = {"id": "vorago", "targetCache": cinfo,
              "sourceCache": dict(cinfo, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
              "definitions": [{"kind": "npc", "symbol": "vorago", "sourceId": NPC_ID, "id": NPC_ID,
                               "dataBase64": base64.b64encode(d).decode(), "crc": zlib.crc32(d) & 0xffffffff}]}
    json.dump(bundle, open(os.path.join(DEFS, 'vorago.json'), 'w'), indent=1)
    models = json.load(open(os.path.join(DEFS, 'custom-models.json')))
    models[str(MODEL_ID)] = 'vorago/body-rs3.dat'
    json.dump(models, open(os.path.join(DEFS, 'custom-models.json'), 'w'), indent=2)
    print('npc', NPC_ID, 'written')


if __name__ == '__main__':
    main()
