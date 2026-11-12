# RS3 -> OSRS item model port

Converts RS3 (build 950, OpenRS2 flat-file cache) models into the OSRS model
format that `CacheDefinitions.ts` serves for `custom-items.json`.

    C="C:/Users/kofi9/Desktop/950 open source code/950OpenSource/cache"
    python3 find_items.py "$C" "item name"            # RS3 item id by name
    python3 convert.py "$C" <rs3 model> out/drop.dat --max-tris 1000
    python3 convert.py "$C" <rs3 model> out/equip.dat --equip --max-tris 1000
    python3 icon.py out/drop.dat <xan> <yan> <zan> icon.png   # suggests zoom2d/offsets
    python3 render.py preview.png "label=out/drop.dat"         # quick preview

Get the RS3 model ids from the RS3 item definition: opcode 1 is the
ground/inventory model, and opcodes 23 and 25 are the male and female worn models.
Item xan/yan/zan carry over from RS3 as they are. Use icon.py for zoom and offsets.

Notes:
- RS3 units are 4x OSRS with +Y up; converted with /4, Y flipped, winding swapped.
- Mesh material ids are stored +1 in RS3 models (0 = none).
- Face colour = average of the material's diffuse texture under that face.
  Emissive, normal and glow maps are ignored.
- Worn models get OSRS label 50 (weapon hand) on every vertex. This suits weapons;
  armour would need per-body-part labels.

Ported so far:
| TSPS id | RS3 item | models |
|---|---|---|
| 50005 | Fractured Staff of Armadyl (51772) | 122924 ground, 122923 worn -> 1000012/1000013 |
| 50007 | Ek-ZekKil (52511) | 124261 ground, 124258 worn -> 1000010/1000011 |

Batch ports (weapons, dyes and capes) live in `port_items.py` (`WEAPONS`); `--write` regenerates
`custom-items.json` and `plugins/items/data/rs3-dyes.json` (`::rs3` spawns every plain item).

Capes (`cape=True`): worn vertices take the bone label of the nearest vertex on the OSRS cape they
play as, so they bend with the body. The item's RS3 recolours/retextures are applied (Igneous
Kal-Ket/Xil/Mej/Mor share one model). Capes get no dyed versions and take no dyed ids.

| TSPS id | RS3 item | plays as |
|---|---|---|
| 50325 | Igneous Kal-Zuk (52504) | Infernal cape |
| 50326 | TokHaar-Kal-Ket (23659, tint) | Infernal cape |
| 50327-50330 | Igneous Kal-Ket/Xil/Mej (52501-52503), Kal-Mor (55189) | Infernal cape |

RS3 skin weights (vertex flag 0x20) are `u16 n, n x u16 bone, u16 m, m x u8 weight`; worn models
with multi-bone vertices (capes) failed to decode before this was fixed (11 Nov).
