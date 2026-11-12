# Nex: Angel of Death (OSRS-style)

Server custom: the RS3 encounter (https://runescape.wiki/w/Nex:_Angel_of_Death/Strategies, pvme.io
"AoD Mechanics" for 7s and 4s) rebuilt for an OSRS server. It is tick-based, protection prayers replace
RS3 defensives, damage and hitpoints are OSRS-scale, and dodges are on tiles. Everything here is
**ours** unless marked **RS3** (taken from the wiki or pvme as-is: RS3 ticks are 0.6s like ours, so
RS3 timings port tick for tick). Numbers are starting values and all of them live in
`server/plugins/bosses/aod/data/aod.json`.

Status: **design, waiting for kofi's go-ahead.** No fight code exists yet (see "Build order").

## Scale

| What | RS3 | Here | Rule |
| --- | --- | --- | --- |
| Her hitpoints | 3,000,000 | 6,000 (fixed for now; kofi tunes it later) | NPC hitpoints /500 (reavers, amalgamations, Praesul and crystals too) |
| Damage to players | e.g. 4,000 | 40 | RS3 player damage /100 (a 99 is about 10k LP in RS3) |
| Attack speed | 4 ticks | 4 ticks | RS3 |
| Team | 7 suggested, 1-50 | 1-5 (the player and up to 4 bots) | Her HP is the 5-player value; below that it scales (`hitpoints.perPlayer`) |

Phase thresholds (RS3, as fractions; P1 end is kofi's, 2026-11-11): **P1** 6,000-5,000 (to 83%), **P2** 5,000-3,600 (83-60%),
**P3** 60-20% (3,600-1,200), **P4** under 20% (1,200-0).

## The arena

Region 8260 copy (`AngelOfDeath.plugin.js`). Arena coordinates in this file are region-local, so
(32,32) is her centre tile `CENTRE`, and her 5x5 body covers (30-34, 30-34).

- **Quadrants:** NE, NW, SE, SW, split on the midlines x=32 and y=32 (her centre row and column).
- **Pillars and crystals (RS3 corners):** Cruor/Blood NW (12,50), Glacies/Ice NE (50,50),
  Fumus/Smoke SW (12,12), Umbra/Shadow SE (50,12). These are the existing pillar NPCs 17001-17004:
  untouchable decoration until P4, when they become the crystals.
- **The dome:** the "instakill safety zone" ring around the centre (RS3). Its radius is measured off
  the ported floor at build time (`dome.radius`, first guess 4 tiles from her centre).
- **Spawn:** players enter at (32,22), south of her. In `::aod` the arena opens without her; `::aodspawn` brings her in.

## The intro (kofi, 2026-11-11; our own style over time)

**Start (kofi, 2026-11-11):** `::aod1` is the idle arena (her standing, the pillars, the AoD Fans).
`::aod` is the fight arena: the pillars only, and `::aodspawn` brings her in; `::aodend` takes her
away for another try. There's no first-hit start.

**Her arrival (RS3, per kofi):** in RS3 she falls from the sky into the middle of the room. We
recreate that. OSRS Nex's spawn seq 9182 is not an emergence: it's a crouch, a leap about 1.5 tiles
up, then a slam (checked frame by frame on her model). Played backwards it looks the same, so the
fall is **seq 60100**: 12 frames of 9182's mid-air pose dropping from 2,400 units up (the root
translate only, so nothing bends), then 9182's own drop and slam (`scripts/rs3-port/aod_fall.py`,
`data/definitions/custom-seqs.json`, sent as the `customSeqs` dataset; client `custom/seqs/`).
**Later:** RS3's red ball that spawns her in the middle.

She is immune and hits nothing until tick 25.

| Tick | What happens |
| --- | --- |
| 0 | `::aodspawn`: she falls from the sky into the centre (seq 60100). The music starts and the HUD opens. |
| 2 | She touches down with 9182's slam (sound 5303): "Who dares wake the Angel of Death?" |
| 7, 10, 13, 16 (a pause after her line, kofi) | Each pillar in turn (Smoke, Shadow, Blood, Ice) glows and sends her its power: Nex's power projectile 2010, in the element's colour. She turns to it and calls out its element ("Smoke!", "Shadow!", "Blood!", "Ice!"; kofi). |
| 19 | She rises (seq 9187). |
| 22 | She lands: "All of the elements' power is now mine to control!" |
| 25 | She is active: the fight starts. |

## Her standard attacks (P1-P3)

| Attack | When | Max | Prayer | Extra |
| --- | --- | --- | --- | --- |
| Magic | Target out of melee reach | 33 | Protect from Magic blocks it | Hits the target and anyone in the 3x3 around them (RS3: her magic hits a quadrant's worth; tightened for OSRS) |
| Melee | Target in reach (not diagonal) | 35 | Protect from Melee blocks 80% | Drains prayer by a quarter of the damage. Adds a Torment stack (below) |

- **Targeting (replaces Provoke):** OSRS has no taunt, so she always attacks the **nearest** player and
  keeps them for 4 attacks (the Nex rule) before re-picking the nearest. The tank's job is to stay
  closest. Out of reach for 9 ticks, she flies to her target as Nex does.
- **Torment** (RS3 melee "enrage stacks" on the target): +1 per landed melee hit, and each stack adds
  +3% to her damage against that player. At 5, 10 and 15 stacks (RS3 "Set 1/2/3" defensive resets),
  her next melee on them **pierces Protect from Melee** and disables it for 3 ticks. Stacks clear
  after 50 ticks with no landed melee hit (RS3 30s). The counter is to swap tanks, or flick off her
  melee.
- **Rage** (her pillar stacks, RS3 max 150): every 3 stacks give +1% to all her damage, so 150 is
  +50%. At 100 or more, her magic also splashes the 5x5 around her target. Gains:
  - +20 when the quadrant she faces in Elemental Lockdown is empty (RS3).
  - +10 for each reaver absorbed.
  - +1 every 5 ticks while she stands still within 6 tiles of a pillar in P1-P3 (RS3 passive).
  - +1 a tick while she is within 6 tiles of the attackable crystal in P4 (RS3).

  Rage never drops during a kill. It is shown on her HUD as a counter (`boss-hud:counter`, or a
  message every 10 stacks if BossHud has no counter).
- **Defence drain:** DWH, elder maul and BGS specials work on her. Her Defence floor is 70% of base
  (replaces Statius's warhammer and Smoke Cloud; Nex's cap is 10 levels).

## Phase 1 (6,000-5,000 hp, kofi)

**Rotation (RS3):** 4 autos, Elemental Lockdown, 4-14 autos, Shadow Orbs, 4-14 autos, then back to
Elemental Lockdown.

### Elemental Lockdown

Tick 0 is her line, "The elements, they call to me..." (RS3).

| Tick | What happens |
| --- | --- |
| 0 | Line; she rises (Nex's flight seq 9187) and faces a random quadrant (RS3). |
| 3 | She lands on `CENTRE`. Anyone in the 3x3 around her body takes 25 typeless (RS3: typeless 3x3). |
| 4 | Ice stalagmites (Nex's 42943 icicle loc) fill both midlines, splitting the arena. Anyone standing on a midline takes 15 and is pushed into the nearest quadrant (RS3 "moderate damage"). The walls block movement until tick 34, or until every reaver is gone. |
| 4 | Three blood reavers spawn, one at the outer corner of each quadrant she isn't facing (RS3). |
| 6, 8, 10 | Three elemental bolts hit everyone in the faced quadrant, max 38 each (RS3 3x ~3,500-4,000). **Prayer flick (replaces Disruption Shield, Resonance and Reflect):** the bolts are magic, ranged, magic, with their own projectile colours (ice blue, shadow, ice blue). The right protection prayer blocks a bolt fully and the wrong one takes it in full. |
| 6 | If the faced quadrant is empty: "The stones, they empower me" (RS3), and +20 rage (RS3). |

- **Phased early (RS3):** if her HP crosses 5,000 before tick 4, there are no walls and no reavers, but
  the three bolts still come.
- **Blood reavers:** 100 HP each (RS3 50k), defence 1, no attacks. Each walks one tile every 2 ticks
  towards her, around the walls through the centre gap at her body. A reaver that reaches her, or is
  still alive at tick 104 (RS3: one minute), is **absorbed**:
  - she heals half its remaining HP (RS3);
  - its remaining HP x1.5 is split as typeless damage across all players (RS3: half its HP split);
  - she gets +10 rage.

  She says a line on each absorb (RS3 paraphrase; ours: "A blood sacrifice is taken. My power is
  tested.").
- **Counters (replace sticky bombs, Dominion mines and Death Guard's stun):** kill them (chinchompas,
  barrage); **bind them**, because Ice Barrage/Blitz, Entangle, Snare and Bind hold a reaver for
  their normal OSRS freeze time with the 5-tick immunity after; or block them, since reavers can't
  path through a player standing in the centre gap. Hitting a reaver heals you nothing (unlike Nex's
  siphon).

### Shadow Orbs

Line: "Let the shadow engulf you. Give in to it." (RS3)

- Four orbs per player (RS3). Each lands on the player's tile **as it is on that tick**, at ticks 2, 3,
  4 and 5. A tile graphic shows on the tile 1 tick before each orb lands.
- An orb stays 8 ticks after landing (4 if the player's orbs form a straight N-S or E-W line, RS3) and
  deals **3 typeless a tick** to anyone on its tile (RS3 300/tick).
- **The dodge (RS3):** stand still until the 4th orb lands, then take one step. Your four orbs end up
  on one tile and you take nothing. Walking during the drop leaves a trail of single orbs, which is
  safe for you but can catch teammates.

## Phase 2 (5,000-3,600 hp)

At 5,000 hp, wherever she is, she returns to `CENTRE` (flight) and says the P2 line (ours, after the RS3
paraphrase): "You will know pain, intruders. Praesul, to me!". While she summons (4 ticks) she takes
half damage (RS3). The P1 rotation carries on through P2 (RS3).

### Amalgamations and the Praesul

| Tick | What happens |
| --- | --- |
| 4 | Four amalgamations (shadow, ice, blood, smoke) spawn, each in the quadrant diagonally opposite its pillar, 8 tiles from her (RS3). Anyone within 2 tiles of one takes 35 typeless (RS3 4,000). |
| 4-54 | Each has 80 HP (RS3 40k) and a strength bar that fills over 50 ticks (**ours**; RS3 doesn't publish the time). The bar shows overhead every 5 ticks (`[|||||.....]`) and as an orange counter on the team's HUD. |
| On death or full bar | Its Praesul steps out of its pillar. **Weakened** if the amalgamation died first: 300 HP (RS3 150k), Defence 200. **Full strength** if the bar filled: 600 HP (RS3 300k), Defence 250, plus the stun (below). |

The Praesul's line on arrival, weakened (RS3): "So be it. I'll do what I can." / "Too soon, but that
will be enough to crush you." / "I do not feel complete, master. My contact with the elements has
been cut short.". At full strength (ours): "The elements are mine, master. They will not leave this
place.". Each Praesul's text has its own colour (RS3): Umbra violet, Glacies blue, Cruor red, Fumus
white.

| Praesul | Pillar | Cast (every 4 ticks, magic max 22, Protect from Magic blocks) | Full strength adds |
| --- | --- | --- | --- |
| Umbra | SE | Shadow: Attack -15% and a darkness overlay for 5 ticks (the screen fade of Nex's Embrace Darkness) | Every 5th cast stuns: held 3 ticks |
| Glacies | NE | Ice: frozen 5 ticks unless praying Magic | Every 5th cast stuns |
| Cruor | NW | Blood: heals himself a quarter of the hit | Every 5th cast stuns |
| Fumus | SW | Smoke: poison 8 | Every 5th cast stuns |

- **Moving (replaces the RS3 lure):** a Praesul walks to whoever has done it the most damage and casts
  from 4 tiles away. That lets a minion tank drag them together under her for chinchompas or a barrage
  (RS3 tanks lure them under Nex for the chinner). They can be poisoned (RS3).
- **Death:** "Master, I have failed you...." (RS3). Their **death order is the P4 crystal order**
  (RS3). If several die on the same tick, they count in the order Glacies, Cruor, Fumus, Umbra (RS3).
- **The gate:** P3 starts at 60% whether or not the Praesul are alive (RS3). She can't go below 20%
  until all four are dead, and keeps using her specials meanwhile (RS3). At the 20% floor: "Nex is
  immune to your attacks!".

## Phase 3 (60-20%)

Line at 60% (RS3): "Understand this, mortals. You know nothing of the power you meddle with."

She drops her P1/P2 specials (RS3). After every 4-9 autos she uses a random one of the three
specials below. The same special never comes twice in a row, and Icicle Slam is never first (RS3).

### Smoke Blades

Line (RS3): "Feel the smoke all around you. LET IT CONSUME YOU."

- Tick 0: two random players are marked (RS3), one **North** and one **East** (an overhead `N` / `E`
  and the message "Smoke gathers to your north!" / "...east!"). Solo or duo, one player can get both.
- Tick 8 (two autos later, pvme): a smoke wall forms through the marked player's tile **at that
  moment**. North is a full-height column on their x and East is a full-width row on their y. It
  lasts 6 ticks and deals **10 magic a tick** to anyone in it (RS3 rapid 2,000). Protect from Magic
  halves it (this replaces Devotion).
- **The dodge (RS3):** a North wall doesn't form if its player is against the east or west wall of
  the arena; an East wall doesn't form against the north or south wall. Or step out of the line in
  the 6 ticks. Put your line away from teammates (pvme).

### Unstable Smoke

Line (RS3): "Even I can not control the element of smoke... Let us see if you can."

- Tick 3: a black cloud lands on a random tile 6-10 tiles from her, and a 5x5 smoke ring forms
  around it. Her next auto comes as the cast ends and is silent, with no animation (RS3 "invisible
  auto", pvme).
- The first time anyone steps into the ring, a crystal (Touch) appears at its centre (RS3).
- **Touched:** 140 damage split evenly among everyone **in the ring** (RS3 14,000). This needs 2 or
  more players in the ring to be survivable (pvme).
- **Not touched by tick 33:** it explodes for 375 split across **everyone in the arena** (RS3 37,500).

### Icicle Slam

- Tick 0: one target, or two with 5 players (RS3): "The ice gathers above you!" and a frost tint.
- Tick 2: the target is held (no moving or acting) for up to 15 ticks (RS3 6s bind + 9s stun).
- Tick 5 (RS3 five ticks): the icicle falls on them. Anyone in the 3x3 takes 45, in the 5x5 25, in
  the 7x7 17 (RS3 5,000 / 2,500 / 1,666; nested rings, the worst ring only). The target takes none of
  the ring hit.
- The icicle (40 HP, RS3 20k) stays on them and **bleeds them 15 every 2 ticks** (RS3 Dismember-style
  ~2,000). Protect from Melee halves the bleed (RS3 Deflect Melee).
- **Freeing them (replaces Freedom):** teammates break the icicle. It's weak to stab and crush; bows
  and two-handed weapons can't hit it ("Your weapon is unsuitable to break the ice.", as Nex's ice
  prison). It breaks at 0, or shatters on its own at tick 17 for 30. The target can't free
  themselves, because OSRS has no Freedom.
- **Skipped:** if her HP crosses into P4 before the icicle falls, it never falls (RS3/pvme).

## Phase 4 (under 20%)

Starts once she is under 20% **and** all four Praesul are dead (RS3). Line (RS3): "Noooo... you
cannot defeat me..".

- **She is immune** until all four crystals are destroyed (RS3), and the fight ends at 0 after that.
  Only the crystal next in the Praesul death order can be attacked. The pillar NPC transforms into its
  crystal and the others say "This crystal is protected by the others.". When all four crystals are
  down, she can be damaged again.
- **Magic only** (RS3): no melee and no Torment. Range 10 (RS3). She walks to stay within 3 tiles of
  her target (RS3 "casts within 3 tiles"), so the **tank leads her away** from the crystal being
  killed (RS3 lure). Being near that crystal earns her rage every tick.
- **Crystals:** 400 HP each (pvme 200k), Defence 150, **weak to crush**. DWH/elder maul specials
  lower their Defence (replaces the vulnerability bomb).

### Mark of the Elements (always first in P4, then 30 ticks after each bomb)

- A random player gets a blue bar (overhead, filling over **10 ticks**) and the message "The elements
  gather around you. Get to the centre!".
- When it fills: a marked player **outside the dome takes 90% of their max HP** as typeless damage
  that nothing blocks (kofi, for now; RS3 kills outright). Inside, a second bar fills over 8 ticks.
  A player outside the dome gets no bomb.
- When the second bar fills, a **bomb** drops on their tile and stays until she dies (RS3). Every 2
  ticks it deals 30 typeless (RS3 3,000) to anyone within 1 tile, **but only while she is within 10
  tiles of it** (pvme: bombs far from Nex do nothing). So place them near the team for the first
  three crystals and away for the last (pvme).

### Crystal riders (each stops when its crystal is destroyed, RS3)

| Crystal | While it stands | Counter |
| --- | --- | --- |
| Smoke | Her magic poisons 16 and spreads a **virus** that escalates on each hit: low, medium, high. Every 5 ticks it drains prayer 2/5/10 (10 at high is RS3's "far more than it says") and 1/2/3 from the player's best combat stat. Reuses Nex's virus effect with stages. | Gas mask, facemask or slayer helm halves it (Nex rule). Super restores. Kill smoke early. |
| Shadow | Every 8 ticks, 3-5 **traps** (RS3) follow random players. Each sits on its player's tile, moves to their tile every tick, and erupts 3 ticks after it appears for 45 typeless (RS3 4,800). There's a 1-tick dark tile graphic only, as RS3 gives no warning. | Keep moving, and don't drag traps under teammates (pvme). |
| Ice | Each of her hits that isn't blocked by Protect from Magic adds a **frost** stack (a blue tint that deepens). At 5 stacks: held for 10 ticks and bleeding 15 every 3 ticks (RS3 6s bind + bleed). Her unblocked hits also freeze 5 ticks (RS3). | Protect from Magic stops it entirely (replaces Freedom and Deflect Magic). |
| Blood | She heals a quarter of every hit she lands (RS3's flat 500-700 is nothing at /500 scale, so this is ours). | Mostly hits the tank (pvme: "mostly irrelevant"). Kill it first if the tank is weak. |

### Her death

At 0, after the crystals: "Zaros... forgive me..." (ours), Nex's dying form and seq 9184, then she is
gone after 4 ticks. There's no Wrath blast (RS3 has none). The kill count, time and personal best go
in messages, as Nex's do. Loot comes later (see Extras).

## RS3 counters and what replaces them

| RS3 ability / tool | Used against | OSRS replacement |
| --- | --- | --- |
| Disruption Shield, Resonance, Reflect, Debilitate | Lockdown's 3 hits | Per-bolt prayer flick (magic / ranged / magic by projectile colour) |
| Devotion, Enhanced Devoted | Smoke Blades | Walk out or hug the wall; Protect from Magic halves |
| Freedom | Icicle Slam, ice freeze | Teammates break the icicle (stab/crush); Protect from Magic prevents frost |
| Surge, Bladed Dive, Escape | Mark, lines, lure | Run, plus longer telegraphs (10-tick Mark bar, 8-tick smoke wall) |
| Provoke | Tanking, P4 lure | She targets the nearest player; the tank stays closest |
| Sticky bombs, Dominion mines, Death Guard stun | Reavers | Freeze spells and binds hold reavers; chinchompas; body-block the centre gap |
| Threads of Fate, chinning lured minions | Praesul | Praesul walk to their top damager; tank stacks them; chinchompas / barrage |
| Statius's warhammer, Smoke Cloud | Her Defence | DWH / elder maul / BGS specs (floor 70%) |
| Vulnerability bomb | Crystals | Crush weakness; DWH / elder maul specs on crystals |
| Soul Split, Guthix rests, jellyfish | Sustain | Blood fury, Sanguinesti, blood spells, brews/restores |
| Death's Swiftness, Sunshine | Burst | Specs: Zaryte crossbow, voidwaker, claws, dark bow |
| Immortality | The Mark | Nothing blocks it; get in the dome (90% of max HP outside) |

## Extras (suggestions, need kofi's yes)

1. **Combat Achievements** after RS3's "perfect" set, judged per kill like Nex's: Icy-them-coming (no
   Icicle Slam damage), Did It For Them (no smoke explosion), Poppin' Pillars (all 4 crystals within
   25 ticks of each other), You're Not Strong Enough (no full-strength Praesul), One for All (at most
   one player caught by Lockdown bolts), No Smoking (no Smoke Blades damage), Do Not Return To Sender
   (no reaver absorbed), and Perfect AoD (all seven, nobody dead).
2. **Enraged mode:** `::aod hard` starts her at 60 rage and makes the amalgamation bars 35 ticks.
3. **Practice mode:** `::aod practice`, with no deaths kept and no loot.
4. **Loot:** OSRS-flavoured uniques for the Praesul wand, core and codex (stats to design), with
   shares like Nex's (`Loot.Nex` pattern). A separate task.
5. **The 4 AoD Fan bots become the fight team** when the fight starts (the boss-bots chat).
6. **A fight timer and personal best** in the arena (Nex's messages).

## Files (`server/plugins/bosses/aod/`)

Unit files end `.AngelOfDeath.js` (server rule 12). The helpers reused from `nex/` are
`Common.Nex` (strike, projectile, damage, healNpc/healPlayer, say, areaSound, later),
`Specials.Nex` (`hold`, `thrown`, the virus effect, the icicle loc and the stalagmite-break rules) and
`Attacks.Nex` (`drainPrayer`, `inMeleeReach`). Nex's own NPCs are marked `__nexFight` and AoD's
`__aodFight`, so neither fight's hooks touch the other's NPCs.

| File | Holds |
| --- | --- |
| `AngelOfDeath.plugin.js` (exists) | Becomes the attach-only entry: `Common.init`, each unit's `attach*`, and the commands. The arena class, pillars and fan bots move out to units. |
| `NexAod.plugin.js` (exists) | Unchanged: it already installs the `angel-of-death.json` bundle, which now also holds the new NPCs. |
| `aod/Common.AngelOfDeath.js` | Loads `data/aod.json`; quadrants, midlines, dome and local/instance tile helpers; her shouts with Praesul colours; re-exports what's used from `Common.Nex`. |
| `aod/Arena.AngelOfDeath.js` | The `TemplatedInstanceArea` (from today's plugin), pillar spawns and the arena contract `{ area, tile, real, inChamber, players, spawn, spawnAt, ended }`; it starts and stops the fight. |
| `aod/Fight.AngelOfDeath.js` | The `Fight` class on Fight.Nex's pattern: tick loop, `at()`, phases and gates, targeting (nearest, 4 attacks), movement and flight, `hitBoss` (immunity, floors, defence floor, half damage while summoning), rage and Torment, HUD, `cue()`, death and end. |
| `aod/Attacks.AngelOfDeath.js` | Her magic and melee autos, Torment piercing, rage scaling and the P4 crystal riders on her hits. |
| `aod/Lockdown.AngelOfDeath.js` | Elemental Lockdown (flight, walls, bolts, empty-quadrant rage), the blood reavers (walk, bind, absorb) and Shadow Orbs. |
| `aod/Praesul.AngelOfDeath.js` | Amalgamations and their bars, the 4 Praesul (casts, stun, top-damager walking), death order. |
| `aod/Smoke.AngelOfDeath.js` | Smoke Blades and Unstable Smoke (ring, crystal Touch, split damage). |
| `aod/Ice.AngelOfDeath.js` | Icicle Slam (hold, rings, icicle bleed and break). |
| `aod/Crystals.AngelOfDeath.js` | P4: crystal order and immunity, Mark of the Elements, dome, bombs, virus, traps, frost, blood heal. |
| `aod/Commands.AngelOfDeath.js` | `::aod1` (idle), `::aod` (fight arena), `::aodspawn`, `::aodend` (done); later `::aodphase <1-4>`, `::aodspecial <name>`, `::aodhp <n>`, `::aodrage <n>`; all DEVELOPER. |
| `aod/data/aod.json` | Every number in this file (rule 15: plugin-only data lives with the plugin). |
| `aod/Bots.AngelOfDeath.js` | **Not mine**: the boss-bots chat builds it from `docs/aod-cues.md`. |
| `scripts/rs3-port/angel_of_death.py` (kofi OK'd) | Extended to write the new NPC definitions into `data/definitions/angel-of-death.json`, next to 17000: 4 amalgamations (recoloured clouds), 4 Praesul (Nex's mages x1.25 in their colours), the AoD blood reaver and the pillars' crystal forms. |
| `data/definitions/npc-combat-defs.json` | The new NPCs' combat stats, where every NPC's go (kofi). That file has kofi's uncommitted work in it, so I only add AoD's entries and touch nothing else. |
| `data/definitions/npc-drops.json` | Her loot, later (Extras 4). |

Tests: a new `server/tests/aod.test.cjs` on `nex.test.cjs`'s pattern (phase gates, Lockdown
timeline, orb stacking, smoke-wall skip at walls, crystal order, Mark kill outside the dome).

## Build order (each step testable in `::aod` with `::aodspawn` and the agent MCP)

1. Units split out of `AngelOfDeath.plugin.js` with no behaviour change; the intro; Fight skeleton
   with her autos, targeting, HUD, phases, gates and cues. The new NPC definitions and combat stats.
2. P1: Lockdown, reavers, orbs.
3. P2: amalgamations and Praesul.
4. P3: Smoke Blades, Unstable Smoke, Icicle Slam.
5. P4: crystals, Mark, riders, death.
6. Extras kofi picks.

## Decisions (kofi, 2026-11-11)

1. 6,000 HP for now, with the /500 and /100 scales; HP gets tuned later.
2. `scripts/rs3-port/angel_of_death.py` may be edited: Praesul are Nex's mages x1.25 in their colours,
   amalgamations are recoloured clouds.
3. Everything goes where it normally would: combat stats in `npc-combat-defs.json`, definitions in
   the `angel-of-death.json` bundle, drops in `npc-drops.json`.
4. Mark of the Elements: 90% of max HP outside the dome, for now.
5. Start: `::aodspawn` (in `::aod`) spawns her (no first-hit start). She falls from the sky as in RS3; the red
   spawn ball comes later.
6. The fall: (a), a proper animation (seq 60100). Custom sequences were added to the client
   (`client/custom/seqs/`, wired in `Dat2CacheLoaderFactory.ts` and `GamemodeContentStore.ts`); the
   server sends them from `NexAod.plugin.js` (no core change).

## Her specials (kofi, 2026-11-11)

One every 8 attacks (`specials.every`, the first after `specials.firstAfter` 8), in rounds of three:
Elemental Lockdown, then two of Nex's picked at random with no repeat in the round: Smoke Cough (the
virus), Shadow Smash (shadow pools), Blood Siphon, Blood Sacrifice and Ice Prison. Ice Containment is
left out. Cough, Smash and Prison run Nex's own code (Specials.Nex); Siphon and Sacrifice are Nex's
rules with her own reavers (150 hp) and heals up to her own 6000. Specials.AngelOfDeath.js.

## Lockdown channel (kofi, 2026-11-11)

Ticks from her leap (`lockdown.channel` in aod.json). Tick 6, after she lands: her mage attack (9188
for blood/ice, 9189 for smoke/shadow) throws a large ball of the faced pillar's element at the
pillar, powering it up (spot anims 60014-60017, Nex's projectiles at 3x). Tick 8: she kneels for 14 ticks in Nex's
siphon (9183), facing the pillar. Ticks 9, 11, 13: the pillar throws its element's spell at everyone
in its quadrant (her 1.7x projectiles 60010-60013, up to 38; shadow is ranged, the rest magic, so one
protection prayer covers all three). If nobody is in the quadrant, each hit goes into her instead and
she says "The stones, they empower me". She stands up at the end of the siphon (seq 60104, Nex's 9183 fitted to 14 ticks), then attacks again. (The arms-out holds 60102/60103
from `aod_hold.py` stay in custom-seqs.json but are unused.)

## Phase 2 as built (kofi, 2026-11-11)

At 5,000 hp (`phases` in aod.json) she shouts "Fumus!" and turns to his spot: the Lockdown reaver
spawn in the smoke (south-west) quadrant: the middle of its painted circle, local (22,22). There the **Smoke amalgamation** appears with
the reavers' arrival effect: RS3's amalgamation model (115980, `scripts/rs3-port/aod_amalgamations.py`,
recoloured per element because RS3's four share one model; npcs 17007 smoke, 17008 shadow, 17009
blood, 17010 ice). It is static, has no animations, never hits back and has 500 hp. As soon as it
dies, **Fumus** appears in its place with Nex's mage arrival: npc 17011, OSRS Fumus at 1.3x holding
the Third Age Wand of the praesul and Imperium core (`aod_minions.py`). He stands still and casts
Smoke Barrage every 3 ticks at a different player in the smoke quadrant each time (the 3x3 round the
target too; max 29, poison, Protect from Magic blocks; Nex's Fumus numbers). While he lives everyone
has Nex's Smoke Cough at all times, and she only casts her smoke spell (no melee, no specials). From
her call until he dies she stays in the middle (she leaps and falls back there if she isn't).
While the amalgamation or Fumus is up, every 2 ticks each other pillar hits everyone in its quadrant
with its own spell, and every 4 ticks the Smoke pillar hits one random player in the smoke quadrant
(up to 20; the right prayer halves it). Units: `aod/Minions.AngelOfDeath.js`. Test with `::aodphase 2`.

### Fumus consumed (kofi, 2026-11-11)

Fumus's killing blow doesn't kill him (`minions.consumed`). He says "Take my power!!" and stands there,
taking no more damage, while she consumes him: her Zaros spell (Nex's phase 5 magic) at him, then five
Soul Split souls from him to her, one a tick (ticks 2-6). At tick 8 he says "Taste her wrath!", at
11 Nex's Wrath bursts across the whole smoke quadrant, and at 14 everyone still in that quadrant takes
up to 50 typeless. Then the phase is over: she moves and uses everything again, and from now on her
smoke spell autos come every 2 ticks (`combat.consumedSpeed`).

## Phase 3 as built (kofi, 2026-11-11): Umbra

At 4,000 hp, once Fumus's phase is over, she says "Umbra, it's time!" and phase 3 runs as phase 2
did, in the shadow (south-east) quadrant: the Shadow amalgamation (17008, 500 hp, static) at the
middle of its circle; once it dies, Umbra (17012: OSRS Umbra at 1.3x with the shadow-dyed Wand of the
praesul and Imperium core). Umbra casts Shadow Barrage every 3 ticks at a different player in his
quadrant (3x3; Nex's Umbra: max 29, blinds and lowers Attack by 15%; Protect from Magic blocks it).
She holds the middle and only casts her shadow spell (ranged) from her call; the other pillars punish
everyone outside the shadow quadrant every 2 ticks and the Shadow pillar hits a random player inside it
every 4. On his killing blow she consumes him the same way ("Take my power!!", her Zaros spell, five
souls, "Taste her wrath!" over the shadow quadrant), then her shadow spells are 2x speed too. No cough
for Umbra (Fumus's own). `::aodphase 3` or `::phase 3` skips straight to it (anything skipped counts as
consumed).

## Phases 4 and 5 as built (kofi, 2026-11-11): Cruor and Glacies

The same again. Phase 4 at 3,000 hp: "Cruor, it's time!", the Blood amalgamation (17009) in the
middle of the north-west circle, then Cruor (17013, blood-dyed wand and core) casting Blood Barrage
(Nex's Cruor: max 29, heals himself a quarter); she casts only blood (her 3x3 blood barrage). Phase 5 at
2,000 hp: "Glacies, it's time!", the Ice amalgamation (17010) in the north-east circle, then Glacies
(17014, ice-dyed wand and core) casting Ice Barrage (Nex's Glacies: max 29, 6-tick freeze); she casts
only ice. Each is consumed like Fumus, and its element's spells are 2x speed after. The last phase
(after Glacies) is next.

