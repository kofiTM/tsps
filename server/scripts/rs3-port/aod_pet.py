"""Lil' Angel: the Nex: Angel of Death pet. OSRS Nexling's follower (npc 11277: Nex's model at 48/128,
Nex's walk 9176 / stand 9177, Talk-to / Pick-up) with her armoured model, appended as npc 17005
-> data/definitions/angel-of-death-pet.json, installed by plugins/bosses/NexAod.plugin.js.
Item 50331 (custom-items.json) summons it; plugins/npcs/Pets.plugin.js has its row.

Reeves (RS3's AoD pet, kofi): Nex's blood reaver (npc 11294, model 43217, walk 9193 / stand 9195) at
72/128 on one tile, Attack swapped for Talk-to / Pick-up and Nexling's follower flags, appended as
npc 17006 in the same bundle; item 50332 summons it."""
import base64, json, os, struct, zlib
from osrscache import OsrsCache
from aod import ROOT

NPC_ID = 17005
MODEL_ID = 1000449                            # her armoured model (aod_armour.py), same rig as Nex's
c = OsrsCache(os.path.join(ROOT, 'caches', 'osrs-241_2026-10-20'))
nexling = c.files(2, 9)[11277]
assert nexling[-1] == 0
d = nexling[:-1]                              # later opcodes override Nexling's
d += b'\x02' + b"Lil' Angel\x00"              # name (kofi: the AoD model as the pet)
d += struct.pack('>BBi', 61, 1, MODEL_ID)     # her model in place of Nex's 43209; Nexling's 48 scale stays
d += b'\x00'

REEVES_ID = 17006
REEVES_SCALE = 72                             # ~111 tall, about Lil' Angel's height (a reaver is 197)
reaver = c.files(2, 9)[11294]
assert reaver[-1] == 0
r = reaver[:-1]
r += b'\x02' + b"Reeves\x00"
r += bytes([12, 1])                           # one tile (a reaver is 2x2)
r += struct.pack('>BHBH', 97, REEVES_SCALE, 98, REEVES_SCALE)
r += b'\x1fHidden\x00'                        # no Attack
r += b'\x1eTalk-to\x00' + b'\x20Pick-up\x00'  # Nexling's options
r += struct.pack('>BH', 95, 0)                # combat level 0, as Nexling
r += bytes([93, 122, 123])                    # Nexling's follower flags
r += b'\x00'
info = {"name": "osrs-242_2026-11-03", "game": "oldschool", "revision": 242}   # bundle target (was 241 before the upstream merge)
bundle = {"id": "angel-of-death-pet", "targetCache": info,
          "sourceCache": dict(info, environment="live", timestamp="2026-10-20T09:00:05.929Z", size=0),
          "definitions": [{"kind": "npc", "symbol": "lil_angel", "sourceId": NPC_ID, "id": NPC_ID,
                           "dataBase64": base64.b64encode(d).decode(), "crc": zlib.crc32(d) & 0xffffffff},
                          {"kind": "npc", "symbol": "reeves", "sourceId": REEVES_ID, "id": REEVES_ID,
                           "dataBase64": base64.b64encode(r).decode(), "crc": zlib.crc32(r) & 0xffffffff}]}
json.dump(bundle, open(os.path.join(ROOT, 'data', 'definitions', 'angel-of-death-pet.json'), 'w'), indent=1)
print('npc', NPC_ID, len(d), 'bytes; npc', REEVES_ID, len(r), 'bytes')
