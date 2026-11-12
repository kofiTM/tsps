"""Nex: Angel of Death's minions as her own npcs (kofi, 2026-11-11).

    python3 aod_minions.py   ->  data/definitions/aod-minions.json (installed by plugins/bosses/NexAod.plugin.js)

npcs 17011-17014, Fumus, Umbra, Cruor and Glacies: OSRS's (11283-11286) at 1.3x, each holding a Wand of
the praesul and Imperium core (kofi): Fumus the Third Age ones (items 50081/50088), Umbra the shadow-dyed
(50078/50085), Cruor the blood-dyed (50079/50086), Glacies the ice-dyed (50080/50087); their worn models
(custom-models.json) added to his six. He is on
the player rig (his cast is the ancient barrage, 1979), so the wand moves with his hand. 1.3x size (kofi).
"""
import base64, json, os, struct, sys, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osrscache import OsrsCache
from aod import ROOT

MINIONS = {
    17011: (11283, "fumus", [1000156, 1000170]),   # + Third Age Wand of the praesul and Imperium core (worn)
    17012: (11284, "umbra", [1000150, 1000164]),   # shadow-dyed wand and core (kofi)
    17013: (11285, "cruor", [1000152, 1000166]),   # blood-dyed
    17014: (11286, "glacies", [1000154, 1000168]), # ice-dyed
}
SCALE = {17011: 166, 17012: 166, 17013: 166, 17014: 166}                                 # 1.3x (kofi); 128 is normal size

def models_of(d):
    """Fumus's definition ends with opcode 61 (int model ids); returns (bytes before it, ids, bytes after)."""
    i = d.rfind(b'\x3d')
    while i >= 0:
        n = d[i + 1]
        end = i + 2 + 4 * n
        if end <= len(d) and d[end:end + 1] in (b'\xf9', b'\x00'):
            ids = list(struct.unpack('>%di' % n, d[i + 2:end]))
            return d[:i], ids, d[end:]
        i = d.rfind(b'\x3d', 0, i)
    raise ValueError('no opcode 61 model list')

def main():
    c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
    rows = []
    for npc, (source, symbol, extra) in MINIONS.items():
        d = c.files(2, 9)[source]
        head, ids, tail = models_of(d)
        ids = ids + extra
        b = head + bytes([0x3d, len(ids)]) + struct.pack('>%di' % len(ids), *ids) + tail
        if npc in SCALE:
            assert b[-1] == 0
            b = b[:-1] + struct.pack('>BHBH', 97, SCALE[npc], 98, SCALE[npc]) + b'\x00'   # later opcodes win
        rows.append({"kind": "npc", "symbol": "aod_" + symbol, "sourceId": npc, "id": npc,
                     "dataBase64": base64.b64encode(b).decode(), "crc": zlib.crc32(b) & 0xffffffff})
        print('npc %d (%s from %d): models %s' % (npc, symbol, source, ids))
    info = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}   # bundle target (was 241 before the upstream merge)
    bundle = {"id": "aod-minions", "targetCache": info,
              "sourceCache": dict(info, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
              "definitions": rows}
    json.dump(bundle, open(os.path.join(ROOT, 'data', 'definitions', 'aod-minions.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
