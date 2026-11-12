# Porting an RS3 boss (model, animations, arena) — guide for agents

Worked example: **Vorago** (11 Nov 2026). Scripts in `server/scripts/rs3-port/`, plugin
`server/plugins/bosses/Vorago.plugin.js` (`::rago`, `::ragoanim`). Armour has its own guide:
`docs/rs3-armour-port-guide.md`.

## 0. Rules that keep the server from breaking (learned the hard way)
1. **Model ids must be unique across `custom-items.json` models AND `custom-models.json`.** A duplicate
   makes `ItemDefinitionLoader` throw and *no* custom content loads (the AoD arena went dark). NPC/boss
   models: 1100000 (Vorago), arena models 1200000+. Every script checks before writing.
2. **Every content packet is ≤ 64 KB after deflate**: `customSeqs` (all custom animations in ONE packet,
   AoD's included), `definitionArchives` (all bundles together), each `customModels` model, each region
   replacement (≤ 65533 bytes uncompressed). Scripts compute these and refuse to write over budget.
   Vorago's first animation set (560 KB) broke every login ("Server packet 210 exceeds short length").
3. Bots are never sent models/seqs/definitions, so none of this costs tick time with 499 bots.
4. Read `server/logs/server.log` after nodemon restarts: `[vorago] installed`, `[nexaod] N custom seq(s)`,
   and no `[ERROR]` lines (`failed to initialize`, `login hook failed`).
5. Test each change in game before stacking the next one; keep backups in `server/disabled-rs3-bosses/`.

## 1. Find the boss in the caches
* 950 cache (`Desktop/950 open source code/950OpenSource/cache`, OpenRS2 flat files, `js5.Cache`):
  models (index 47, NXT format), item/loc/npc defs, maps (index 5). **No animation frames.**
* 2016 cache (`Desktop/2016 cache`, dat2/idx, open with `osrscache.OsrsCache`): has the classic
  animation system: seqs (index 20, group = id >> 7), frames (index 0), frame bases/skeletons (index 1),
  npc defs (index 18, group = id >> 7). Find the npc by scanning index 18 for its name.
  - npc opcode 127 = render set (BAS, index 2 group 32): opcode 1 there = idle, walk.
  - All of the boss's animations = seqs whose frames use the same frame base (`rs3anim.seqs_on_base`).
* `Desktop/950 open source code/950OpenSource/Ataraxia950` is a full RS3 server: grep it for the boss
  (`BossInstanceHandler.java`, `*Instance.java`) to get arena coordinates and spawn tiles.

## 2. Model: own skeleton, OSRS look, no stretch (`vorago_osrs.py`)
* `convert.convert(cache, model, raw_labels=True)` keeps RS3's classic vertex labels (Vorago: 0-152),
  which match the boss's RS3 frame base exactly. **Never borrow an OSRS boss's skeleton** (the first
  Vorago used Graardor's and stretched in every animation: joint stretch 2.0 vs 0.15).
* Low poly: decimate per bone (vertex clustering keyed by (cell, label)) so no bone disappears;
  ~3000 tris for a 9-tile giant; snap lightness to steps of 6.
* Stretch: RS3 blends vertices between bones; classic labels can't, so some joints stretch even at full
  detail (11% of Vorago's triangles > 25%). Fix = **overlapping plates**: every triangle that stretches
  > 16% in any frame becomes one rigid copy per bone it touches (inset 1.5). A fully rigid model cracked
  open 50-160 units at the joints instead.

## 3. Animations (`rs3anim.py` + client support)
* Formats are OSRS's with small changes (all in `rs3anim.py` docstring): frame = u8 version, u16 base,
  **u16** count; base = u16 count, types, actor flags, u16 masks, smart label counts, smart labels.
* Units: **rotations are 16384 per turn** (OSRS 256) -> keep raw, client divides by `rotationDivisor`
  64 (rounding to OSRS steps made his feet slide ~25 units). **Translations: no scaling** (`UNIT = 1`);
  I first divided by 4 and he "barely moved".
* Client (`client/custom/seqs`): a `customSeqs` row with `kind: "base"` is a custom skeleton (id 65000+,
  OSRS base format, `rotationDivisor`); `CustomSeqBaseLoader` serves it; `Model.transform` sends
  fractional rotations through the float path; `angleDelta` is fraction-safe. Back-up copies of these
  four files: `server/disabled-rs3-bosses/new-rig/client/`.
* Budget: keep only the animations the fight uses and every 2nd frame (the client tweens). Vorago:
  12 anims, 193 frames, customSeqs 43 KB with AoD's. Custom seq id = 60200 + (RS3 id - 20316).
* Name roles by measuring motion (hand height/forward reach, body drop, end pose): RS3 has no names.

## 4. NPC definition
Append after the cache's npcs (next free id: check every bundle; Vorago 17015), cloned from a spare
cache npc with name, size, model (opcode 61 int) and **every** animation opcode overridden: 13 idle,
14 walk, 15/16 turn, 17 walk+turns — any left over plays the donor's frames on your skeleton. Server
side, give it its own `NpcDefinition` (attack/block/death anims) or appended npcs fall back to human
animations (that tore the AoD apart). Install through `definition-archives:install` with *all* bundles.

## 5. Arena (`vorago_arena.py`)
* Map region from the server source coordinates (Vorago phase 1: (3104, 6112) -> RS3 region 12208).
* Look before converting: which level holds the floor (Vorago: level 1, flag 8 = drawn at ground level)
  and whether the floor is terrain or objects (Vorago: hidden overlay 161 + 10x10 rock-slab objects).
  RS3 floor ids in terrain are +1.
* Target: a blank OSRS region (terrain 49153 bytes, objects 1 byte; Vorago 8772, AoD 8260).
* Terrain: level-0 heights (minus min), nearest plain OSRS underlay/overlay colours, blocked = RS3
  level 0 or 1 blocked. Flood-fill from the boss spot to prove the arena is enclosed.
* Objects: one merged model per (RS3 loc, placement type, per-placement scale/offset), new loc defs
  after every existing archived loc, walls solid, the rest non-solid.
* Plugin: `replaceMapRegion` + `sendReplacementToPlayer` before building the `TemplatedInstanceArea`.

## Commands
```
cd server/scripts/rs3-port
C950="C:/Users/kofi9/Desktop/950 open source code/950OpenSource/cache"; C2016="C:/Users/kofi9/Desktop/2016 cache"
python3 vorago_osrs.py "$C950" "$C2016" --write     # model, skeleton, animations, npc
python3 vorago_arena.py "$C950" --write             # region 8772 + arena objects
```
