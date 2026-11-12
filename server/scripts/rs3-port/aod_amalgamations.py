"""Nex: Angel of Death's four amalgamations (kofi, 2026-11-11): RS3's Ice, Blood, Smoke and Shadow
amalgamation (npcs 24005-24008) all use one model, 115980, with nothing in their definitions to tell
them apart, so each is recoloured here in its element. They are static: no animations, they float
where they spawn and get attacked (one per minion: Fumus, Umbra, Cruor, Glacies).

    python3 aod_amalgamations.py <950 cache>
      -> data/models/aod_amalgamations/<model>.dat, custom-models.json rows (kept out of 'aod/',
         which aod_locs.py rewrites), data/definitions/aod-amalgamations.json (npcs 17007-17010,
         installed by plugins/bosses/NexAod.plugin.js)
"""
import base64, json, os, struct, sys, zlib
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from js5 import Cache
import convert, osrsmodel
from aod import ROOT

RS3_MODEL = 115980
SIZE = 2                       # tiles
SCALE = 218                    # 1.7x, as everything else in her arena
# element: (npc id, model id, name, hue 0-63, saturation 0-7, lightness factor)
ELEMENTS = {
    "smoke":  (17007, 1000450, "Smoke amalgamation",  0, 0, 0.80),
    "shadow": (17008, 1000451, "Shadow amalgamation", 50, 3, 0.45),
    "blood":  (17009, 1000452, "Blood amalgamation",  0, 6, 0.75),
    "ice":    (17010, 1000453, "Ice amalgamation",   36, 4, 1.10),
}
FOLDER = 'aod_amalgamations'

def recolour(colours, hue, sat, light):
    out = []
    for c in colours:
        lum = int(c) & 127
        out.append((hue << 10) | (sat << 7) | max(2, min(126, int(round(lum * light)))))
    return out

def main():
    rs3 = Cache(sys.argv[1])
    data, _ = convert.convert(rs3, RS3_MODEL, False, None, tint=True)
    base = osrsmodel.decode(data)
    os.makedirs(os.path.join(ROOT, 'data', 'models', FOLDER), exist_ok=True)
    cm_path = os.path.join(ROOT, 'data', 'definitions', 'custom-models.json')
    cm = json.load(open(cm_path))
    rows = []
    for element, (npc, model, name, hue, sat, light) in ELEMENTS.items():
        body = osrsmodel.encode(base['verts'], base['faces'], recolour(base['colours'], hue, sat, light))
        open(os.path.join(ROOT, 'data', 'models', FOLDER, '%d.dat' % model), 'wb').write(body)
        cm[str(model)] = '%s/%d.dat' % (FOLDER, model)
        b = bytes([0x3d, 1]) + struct.pack('>i', model)            # opcode 61: int model id
        b += b'\x02' + name.encode() + b'\x00'
        b += bytes([12, SIZE])
        b += struct.pack('>BHBH', 97, SCALE, 98, SCALE)
        b += b'\x1fAttack\x00'
        b += bytes([93, 0])                                          # no minimap dot; end
        rows.append({"kind": "npc", "symbol": "aod_%s_amalgamation" % element, "sourceId": npc, "id": npc,
                     "dataBase64": base64.b64encode(b).decode(), "crc": zlib.crc32(b) & 0xffffffff})
        print('%s: npc %d, model %d (%d tris)' % (name, npc, model, len(base['faces'])))
    json.dump(cm, open(cm_path, 'w'), indent=2)
    info = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}   # bundle target (was 241 before the upstream merge)
    bundle = {"id": "aod-amalgamations", "targetCache": info,
              "sourceCache": dict(info, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
              "definitions": rows}
    json.dump(bundle, open(os.path.join(ROOT, 'data', 'definitions', 'aod-amalgamations.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
