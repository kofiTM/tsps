"""Nex: Angel of Death: OSRS Nex (npc 11278) at 1.7x size, appended as npc 17000 (rev 242 has 16876 npcs; ours start at 17000; it was 16772 on rev 241
npcs) -> data/definitions/angel-of-death.json, installed by plugins/bosses/NexAod.plugin.js."""
import base64, json, os, struct, zlib
from osrscache import OsrsCache
from aod import ROOT

NPC_ID = 17000
MODEL_ID = 1000449                           # data/models/aod/1000449.dat: armoured (aod_armour.py); 1000448 = colours only
SCALE = 218                                  # 128 = normal size; 1.7x (kofi, 2026-11-11; was 1.5x)
c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
nex = c.files(2, 9)[11278]
assert nex[-1] == 0
d = nex[:-1]                                  # later opcodes override Nex's
d += b'\x02' + b'Nex: Angel of Death\x00'     # name (kofi)
d += bytes([12, 5])                           # 5x5 tiles (Nex is 3x3)
d += struct.pack('>BHBH', 97, SCALE, 98, SCALE)   # width / height scale
d += struct.pack('>BBi', 61, 1, MODEL_ID)         # her own model (aod_model.py colours + aod_armour.py plates)
d += b'\x00'
info = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}   # bundle target (was 241 before the upstream merge)
bundle = {"id": "angel-of-death", "targetCache": info,
          "sourceCache": dict(info, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
          "definitions": [{"kind": "npc", "symbol": "angel_of_death", "sourceId": NPC_ID, "id": NPC_ID,
                           "dataBase64": base64.b64encode(d).decode(), "crc": zlib.crc32(d) & 0xffffffff}]}
json.dump(bundle, open(os.path.join(ROOT, 'data', 'definitions', 'angel-of-death.json'), 'w'), indent=1)
print('npc', NPC_ID, len(d), 'bytes')
