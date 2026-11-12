# Porting RS3 armour (worn on the OSRS player)

First done for Elite tectonic (11 Nov 2026): items 50333 mask, 50334 robe top, 50335 robe bottom.
Spawn with your usual item command or `::rs3bank`-style spawners; stats come from the base item.

## One command

```
cd server/scripts/rs3-port
python3 port_armour.py "C:/Users/kofi9/Desktop/950 open source code/950OpenSource/cache"          # dry run
python3 port_armour.py "C:/Users/kofi9/Desktop/950 open source code/950OpenSource/cache" --write  # writes
```

To add a set, add rows to `ARMOUR` in `port_armour.py`: TSPS id, RS3 item id (find with
`find_items.py <cache> "name"`), OSRS `base` item (gives stats, equip slot and which body parts are
hidden), `slot` (`head`, `torso`, `legs`), triangle budgets `(ground, worn)` and per-sex placement
`(scale, (dx, dy, dz))`. Only those rows are replaced; every other custom item is left alone.

## What the script does (and why)

1. **Models** (`convert.py`, RS3 build-950 cache, index 47): RS3 units /4, Y flipped, face colour =
   the material's diffuse texture averaged per face, decimated to the triangle budget (OSRS look:
   ~600 head, ~1200-1400 body pieces). RS3 has male and female worn models; both are ported.
2. **Labels (bones)**: RS3 worn models still carry the classic 2007 player labels
   (`convert.convert(..., raw_labels=True)`), numbered like OSRS: head 1/2/3/49, torso 2/8/17-26,
   legs 29-44/76-83/166-167. *But* a few numbers mean different parts in RS3 (on Elite tectonic, 216 is
   the coat skirt and 93/58 the shoulder pads; in OSRS those labels move other parts, which stretched the
   top). So each piece keeps only `SLOT_LABELS[slot]`, the labels OSRS's own armour of that slot uses
   (collected from Virtus, Ancestral, Bandos, Armadyl, Mystic, Fighter torso, helms); any other vertex
   takes the label of its nearest valid vertex.
   **Body pieces (robe tops, platebodies) need more** (`torso_labels`, used when `slot='torso'`). Two
   bugs found in game on the first Elite tectonic top (kofi, 11 Nov):
   - *Pivot drag.* OSRS computes each joint's pivot as the average of every vertex carrying that
     joint's label, **armour included**. RS3 put ~150 shoulder-pad vertices on the shoulder bone, so the
     shoulder pivot moved 33 units off the body: "shoulder completely in the wrong place". Pads now use
     bones **60 (left) / 59 (right)**: they move with the chest and are never used for a pivot (OSRS
     pauldrons do the same). Check with the pivot-shift measure: aim for Virtus' ~15 units.
   - *Wrong chain.* RS3 puts a pad + upper sleeve on 20/26 and jumps to the forearm 19/22; OSRS arms
     are a chain (shoulder 21/25, upper arm 20/18, elbow 17/23, forearm 19/22). Sleeve vertices take the
     nearest bone of their own arm chain from the OSRS base item's model, then neighbour smoothing.
   - *Skirt.* A long coat hangs at hand height: nearest-vertex labelling glued it to the forearms and it
     stretched out to the arms when running. Everything that isn't sleeve is torso (8).
   Per-label centroid matching and per-vertex nearest transfer were both tried and were worse.
   - *Plates (the final fix).* Moving the pads to 59/60 fixed the pivot but the triangles joining pad
     and sleeve then stretched between chest and arm (kofi: "now the arms stretch"; worst triangle 14x).
     Averages (p95/p99) hid it. `port_armour.py` now measures every triangle's **worst** stretch, worn on
     the OSRS body, over 19 player animations (`CHECK_ANIMS`: stand/walk/run/turns/casts/attacks), and any
     triangle over 20% becomes one rigid copy per bone it touches (overlapping armour plates, copies
     inset 0.8). The script prints "worst stretch left": it must be 0.0.
3. **Placement**: RS3 bodies are close to OSRS ones. Compare each label's centroid with the OSRS base
   item's worn model and check the OSRS body (kit models 28515 torso, 26632 arms, 28285 legs) does not
   poke through. Elite tectonic: top and bottom fit as they are; the mask moves (0, +6, -10) male,
   (0, +6, -8) female. Don't fit per-axis scales to garment centroids: they overfit (a 0.46 height squash).
4. **Safety checks before writing** (lesson from the Vorago break): every new model id is checked against
   all `custom-items.json` models *and* `custom-models.json` (NPC/boss models). A duplicate id makes
   `ItemDefinitionLoader` throw and **no custom content loads at all** (AoD arena included). Each model
   packet and the customItems packet (zlib) must stay under 64 KB; the script refuses to write otherwise.
   New item model ids continue from the highest 1100000+ id.

## Checking it

Stretch test (p95 |log edge-length ratio| on the armour's edges, on the OSRS body, over stand 808, walk
819, run 824 and casts 711/1979; lower is better):

| piece | Elite tectonic | OSRS Virtus (reference) |
|---|---|---|
| mask | 0.00 | 0.00 |
| robe top (male / female), first version | 0.21 / 0.15 | 0.18 / 0.12 |
| robe bottom (male / female) | 0.25 / 0.25 | 0.81 / 0.86 |

The p95 test above missed the robe-top bugs. Use the **p99 of the worst frame** per animation plus the
pivot shift (both in `/tmp/toplab.py`-style checks):

| robe top, male | stand 808 | walk 819 | run 824 | cast 711 / 1979 | pivot shift |
|---|---|---|---|---|---|
| first version (in game, wrong) | 0.55 | 0.47 | 1.11 | 1.45 / 1.78 | 33 |
| torso_labels (current) | 0.42 | 0.34 | 0.80 | 1.27 / 1.49 | 19 |
| OSRS Virtus | 0.39 | 0.25 | 0.56 | 0.91 / 0.90 | 15 |

Anything near the Virtus numbers looks normal in game. A value far above them means a label means the
wrong body part: list the worst label pairs (see the loop in this doc's history) and add/remove labels
from `SLOT_LABELS`.

## Not done yet
- Dyed / Barrows / shadow / Third Age / ice / blood / Aurora / Soul variants (same script, more rows;
  RS3 recolours via `recolor`/`retexture` like port_items.py's dyes).
- RS3 set effects (tectonic energy charges): the items use their base item's stats and effects.
