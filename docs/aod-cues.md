# Angel of Death fight cues

For the boss-bots chat, which builds `server/plugins/bosses/aod/Bots.AngelOfDeath.js` from this file.
The fight (`Fight.AngelOfDeath.js`) is the AoD agent's. Design: [aod-fight.md](aod-fight.md).

## How cues work

The contract is the same as Fight.Nex's: `fight.cue(name, details)` pushes

```js
{ seq, name, tick, ...details }
```

onto `fight.cues`, newest last. **Read them by `seq`, never by position.** The list keeps the last
**64** (Nex keeps 16; AoD cues every auto). `fight.tick` is the fight's tick, and every tick in a
payload is on that clock.

Payload conventions, shared by every cue:

| Field | Meaning |
| --- | --- |
| `target`, `player`, `marked`, `by` | A Player object |
| `npc` | The NPC (reaver, amalgamation, Praesul, crystal, icicle) |
| `tile` / `tiles` | Instance `Location`s (what `player.getLocation()` compares with `.equals`) |
| `local` / `locals` | The same as region-local `[x, y]` (arena coords: her centre is `[32, 32]`) |
| `zone` | `{ minX, minY, maxX, maxY }` in **instance** coords, inclusive |
| `at` | The tick it lands or resolves: react before it |
| `until` | The last tick it is still dangerous (or still up) |
| `quadrant` | `"ne" \| "nw" \| "se" \| "sw"` |
| `element` | `"smoke" \| "shadow" \| "blood" \| "ice"` |
| `style` | `"magic" \| "ranged" \| "melee" \| "typeless"` |

Every timing a bot needs is in the payload. Bots never have to read `aod.json`, but the same numbers
are there (`Common.AngelOfDeath.data`).

Live state a bot can also read straight off the fight (not cues): `fight.phase` (1-4), `fight.stage`
(`"idle" | "intro" | "fighting" | "dying" | "ended"`), `fight.boss`, `fight.target`, `fight.rage`,
`fight.torment.get(player)`, `fight.reavers`, `fight.amalgamations` (Map element → npc),
`fight.praesul` (Map element → npc), `fight.deathOrder` (elements), `fight.crystals` (Map element →
npc), `fight.nextCrystal` (element or null), `fight.domeContains(location)`, `fight.quadrantOf(location)`,
`fight.distanceTo(player)`, `fight.bombs` (list of `{ tile, local }`).

## Lifecycle

| Cue | When | Payload | What a bot does |
| --- | --- | --- | --- |
| `intro` | `::aodspawn` (in `::aod`): she falls into the centre | `{ by, activeAt, ring: { tile, local, radius: 3, at } }` | Pot up, take spots; don't spec (she's immune until `activeAt`); be outside `ring` by `ring.at` |
| `start` | She is active (tick 22 of her spawn) | `{ players, firstAutoAt }` | Pray, start attacking |
| `phase` | Each phase's line | `{ phase: 1-4, line }` | Switch phase tactics |
| `summoning` | P2 start: she flies home, half damage for 4 ticks | `{ until }` | Hold specs till `until` |
| `floor` | She hits 20% with a Praesul alive | `{ waitingFor: [element] }` | Everyone on the Praesul |
| `p4` | P4 opens (all Praesul dead) | `{ order: [element], next: element }` | Go to `next` crystal; tank leads her off |
| `dying` | 0 HP after the crystals | `{ tile, local, at }` | Stop attacking; loot at `at` |
| `ended` | Fight over: her death, `::aodend` or the arena closing | `{ killed: bool, ticks }` | Post-boss chat |

## Her attacks and targeting

| Cue | When | Payload | What a bot does |
| --- | --- | --- | --- |
| `auto` | Every auto, as it is thrown | `{ style: "magic"\|"ranged"\|"melee", element, target, at, silent? }` (shadow is ranged) | The target prays `style` before `at`. `silent: true` is Unstable Smoke's animation-less auto |
| `target` | She picks a new target | `{ target, reason: "nearest"\|"four"\|"died" }` | The tank re-takes "nearest" |
| `fly` | Out of reach 9 ticks, or flying home | `{ target?, tile, local, at, home: bool }` | Make room at the landing |
| `element` | Her element changes (every 3-6 attacks, kofi) | `{ element, previous }` | Switch protection: smoke/ice/blood = Magic, shadow = Missiles |
| `soulsplit` | Soul Split on or off (her head icon) | `{ on, until }` | While on: her hits heal her a fifth; DPS her anyway, or hold off |
| `torment` | A target's Torment stacks change | `{ player, stacks, pierceNext: bool }` | At `pierceNext`, the tank steps out of melee or swaps |
| `rage` | Her rage rises | `{ rage, gained, source: "empty"\|"absorb"\|"pillar"\|"crystal" }` | P4: tank pulls her further from the crystal |

## Phase 1 and 2

| Cue | When | Payload | What a bot does |
| --- | --- | --- | --- |
| `lockdown` | Line (tick 0); `quadrant`'s pillar fires at her, she leaps at `leapAt`, lands in the middle, throws a big ball at the pillar at `throwAt`, and from `channelAt` kneels (siphon) while the pillar throws its spell at the quadrant, or at her if it is empty (2026-11-11) | `{ quadrant, pillar, throwAt, channelAt, leapAt, landAt, slam: zone, wallsAt, wallsUntil, walls: tiles, locals, bolts: [{ at, style, element }] x3 }` | Off her 5x5 (and a tile round it) by `landAt`; off midlines by `wallsAt`; the tank for `quadrant` stays in it and prays `bolts[i].style` (all three are the pillar's element: shadow = Missiles, else Magic); others leave `quadrant` |
| `special` | Each special, as it starts (every 8 attacks: Lockdown, then 2 of Nex's at random) | `{ name: "lockdown"\|"cough"\|"smash"\|"siphon"\|"sacrifice"\|"prison", upcoming }` | Nex's cues follow for hers: `virus`, `smash`, `siphon`, `sacrifice`, `prison` (docs/nex.md) |
| `bigheal` | A siphon starts with the last siphon's reavers alive: they heal her | `{ amount, source: "reavers" }` | Kill siphon reavers before her next siphon |
| `lockdownempty` | Nobody in the faced quadrant | `{ quadrant, rage }` | (Talk: someone should have tanked) |
| `reavers` | Reavers spawn | `{ reavers: [{ npc, quadrant, tile, local }], absorbAt }` | Bind (freeze spells), chin, or kill; block the centre gap |
| `reaverabsorbed` | A reaver reaches her or times out | `{ npc, healed, damageEach }` | (Talk) |
| `orbs` | Shadow Orbs line | `{ drops: [at x4], lingers, players }` | **Stand still** through `drops[3]`, then step one tile |
| `orb` | Each orb lands | `{ player, tile, local, until }` | Never path over a live orb tile (`until`) |
| `amalgamations` | P2, tick 4 | `{ list: [{ element, npc, tile, local, fullAt }], blast: 2 }` | Not within 2 tiles of one on spawn; kill each before `fullAt` |
| `amalgamationdied` | Killed in time | `{ element, npc, weakened: true }` | Next amalgamation |
| `amalgamationfull` | Bar filled | `{ element, weakened: false }` | (Talk) |
| `praesul` | A Praesul arrives | `{ element, npc, tile, local, weakened, hp }` | Minion tank takes aggro, stacks them under her |
| `praesulstun` | A full-strength Praesul's 5th cast | `{ element, npc, player, at, until }` | (Talk; nothing to dodge) |
| `praesuldied` | A Praesul dies | `{ element, order: [element] }` | `order` is the P4 crystal order so far |

### Minions (as built, 2026-11-11)

| Cue | When | Payload | What a bot does |
| --- | --- | --- | --- |
| `minion` | She calls a minion (phase 2: Fumus) | `{ element, name }` | |
| `amalgamation` | Its amalgamation appears at the quadrant's reaver spawn | `{ element, npc, tile, local, hitpoints }` | Kill it (it never hits back) |
| `amalgamationdied` | It died | `{ element, npc }` | |
| `minionarrived` | The minion appears in its place | `{ element, name, npc, tile, local }` | Kill it; stay in its quadrant |
| `minionattack` | Fumus's Smoke Barrage, every 3 ticks | `{ element, npc, target, players }` | Pray Magic; don't stand next to `target` |
| `miniondied` | The minion died: she can move and use everything again | `{ element, name }` | |

## Phase 3

| Cue | When | Payload | What a bot does |
| --- | --- | --- | --- |
| `smokeblades` | Line, tick 0 | `{ marks: [{ player, dir: "north"\|"east" }], at, lasts }` | A marked bot walks to a wall that cancels its line (north: an E or W wall; east: an N or S wall) by `at`, away from teammates |
| `smokewall` | Wall forms (`at`) | `{ player, dir, tiles, zone, until }` or `{ player, dir, skipped: true }` | Anyone in `zone` steps out (perpendicular) |
| `unstablesmoke` | Cloud lands | `{ tile, local, ring: zone, explodesAt }` | Decide: ≥2 enter the ring and Touch, or all stay out and eat at `explodesAt` |
| `smokecrystal` | First step into the ring | `{ npc, tile, local, explodesAt }` | The chosen bot Touches it once enough are in |
| `smoketouched` | Touched | `{ by, inRing: [player], damageEach }` | (Talk) |
| `smokeexploded` | Not touched in time | `{ damageEach }` | (Talk) |
| `icicleslam` | Warning, tick 0 | `{ targets: [player], heldAt, landAt, rings: [{ size: 3, max: 45 }, { size: 5, max: 25 }, { size: 7, max: 17 }] }` | Everyone else gets 4+ tiles from each target by `landAt` |
| `icicle` | Icicle falls | `{ player, npc, tile, local, shattersAt }` | Stab/crush bots break `npc`; the trapped bot prays Melee (halves the bleed) |
| `icefreed` | Icicle broken or shattered | `{ player, broken: bool }` | Back to work |

## Phase 4

| Cue | When | Payload | What a bot does |
| --- | --- | --- | --- |
| `crystal` | A crystal becomes attackable | `{ element, npc, tile, local, left: [element] }` | DPS on it (crush); the tank keeps her 6+ tiles away |
| `crystaldied` | A crystal is destroyed | `{ element, left: [element], rider: element }` | That rider is gone (stop praying around it) |
| `vulnerable` | All crystals down | `{}` | Everyone on her |
| `mark` | First bar starts | `{ player, at, dome: { tile, local, radius } }` | Marked bot runs into the dome before `at` |
| `mark2` | Second bar (survived the first) | `{ player, at }` | Marked bot walks to where the bomb should go (near the team for crystals 1-3, far for the 4th) before `at` |
| `markhit` | Marked player outside the dome when the bar fills | `{ player, damage }` (90% of their max HP, no bomb follows) | Eat at once; (death talk: "the Mark" if it kills) |
| `bomb` | Bomb placed (stays to the end) | `{ tile, local, radius: 1, every: 2, range: 10 }` | Never stand within `radius` of a bomb while she is within `range` of it |
| `virus` | Smoke rider hit / stage change | `{ player, stage: 1-3 }` | Restore prayer; swap to gas mask/slayer helm if carried |
| `trap` | Shadow rider trap appears | `{ player, tile, local, at }` | That player keeps moving and away from teammates until `at` |
| `frost` | Ice rider stack | `{ player, stacks, frozenAt: 5 }` | Pray Magic (stops new stacks) |
| `frozen` | 5 frost stacks | `{ player, until }` | (Talk) |

## What killed someone (for `Deaths.BossBots`)

`fight.noteHit(player, kind, amount)`, as in Fight.Nex, keeps `fight.lastHitBy`. The kinds are:
`auto-magic`, `auto-melee`, `lockdown-slam`, `lockdown-wall`, `lockdown-bolt`, `reaver`, `orb`,
`amalgamation`, `praesul-<element>`, `smokewall`, `smoke-touched`, `smoke-exploded`, `icicle-ring`,
`icicle-bleed`, `icicle-shatter`, `markhit`, `bomb`, `virus`, `trap`, `frost`.

## Open for the bot chat

- A cue you need that isn't here: ask the AoD chat (via kofi) before working around it.
- Names and payloads are fixed once the fight is built. Changes after that get noted here with a date.
