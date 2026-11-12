/**
 * Deadman Tournament bosses, Deadman-style: every `bosses.everyTicks` (the first after
 * `firstAfterTicks`) one from the pool - the God Wars generals with their bodyguards, the
 * Wilderness bosses, the Chaos Elemental, the King Black Dragon - spawns out in the open Wilderness,
 * never in Ferox Enclave, the lobby or the arena, with at most `maxActive` alive. `nearCircleChance`
 * of them land within `nearCircleBand` tiles of the safe zone's edge (either side); the rest
 * anywhere. One the fog reaches stays where it is: a risky kill.
 *
 * They fight as they do in their lairs (each boss's combat is registered by its NPC id) and drop
 * their own drop tables (NpcDrops). Every real player hears of a spawn and of a kill; a drop
 * worth `announceValue` or more (bones never) is broadcast to the whole server.
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");

const { state } = State;
/** npc -> { entry, guards: NPC[] } */
const active = new Map();
/** Every NPC this tournament spawned (bosses and guards), so their drops are known to be ours. */
const ours = new WeakMap();
let nextAt = 0;
let nextCommonAt = 0;

function direction(x, y) {
  if (!state.fog) return "";
  const dx = x - state.fog.cx;
  const dy = y - state.fog.cy;
  const ns = dy > 8 ? "north" : dy < -8 ? "south" : "";
  const ew = dx > 8 ? "east" : dx < -8 ? "west" : "";
  return ns || ew ? `, ${ns}${ns && ew ? "-" : ""}${ew} of the safe zone` : ", in the safe zone";
}

function nearCircleTile() {
  const { nearCircleBand } = Common.data.bosses;
  if (!state.fog) return null;
  const Tournament = require("./Tournament.DeadmanTournament");
  for (let attempt = 0; attempt < 20; attempt++) {
    // Inside the edge (the fog would soon drive everyone off a boss outside it).
    const reach = Math.round(state.fog.radius) - SAFE_MARGIN - Common.randomInt(0, nearCircleBand);
    const along = Common.randomInt(-reach, reach);
    const side = Common.randomInt(0, 3);
    const x = state.fog.cx + (side === 0 ? reach : side === 1 ? -reach : along);
    const y = state.fog.cy + (side === 2 ? reach : side === 3 ? -reach : along);
    const tile = Tournament.randomWildernessTile({ minX: x - 2, maxX: x + 2, minY: y - 2, maxY: y + 2 }, 10);
    if (tile) return tile;
  }
  return null;
}

function spawnAt(entry, tile) {
  const api = Common.api;
  const npc = api.spawnNpc({ id: entry.npc, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 6 });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  ours.set(npc, entry);
  const guards = [];
  for (const id of entry.guards ?? []) {
    const guard = api.spawnNpc({ id, x: tile.getX() + Common.randomInt(-2, 2), y: tile.getY() + Common.randomInt(-2, 2), z: tile.getZ(), wanderRadius: 6 });
    if (!guard) continue;
    guard.__skipDefaultRespawn = true;
    ours.set(guard, entry);
    guards.push(guard);
  }
  active.set(npc, { entry, guards });
  return npc;
}

/** Well inside the safe zone (SAFE_MARGIN tiles from its edge), so the fog doesn't reach it soon. */
const SAFE_MARGIN = 20;

function wellInside(tile) {
  if (!state.fog) return true;
  const away = Math.max(Math.abs(tile.getX() - state.fog.cx), Math.abs(tile.getY() - state.fog.cy));
  return away <= Math.round(state.fog.radius) - SAFE_MARGIN;
}

/** The styles that can hurt an NPC of ours (its pool entry's `hitBy`, e.g. ["ranged", "magic"] for Kree'arra and her flock); null: any. */
function hitBy(npc) {
  return ours.get(npc)?.hitBy ?? null;
}

/**
 * What shields a boss right now (`shieldedBy`: Vet'ion's skeleton hellhounds - he takes no damage
 * while they live): the nearest one alive by it, to kill first. Null when nothing does.
 */
function shieldOf(npc) {
  const ids = ours.get(npc)?.shieldedBy;
  if (!ids?.length) return null;
  try {
    const near = Common.core.World.getNpcsNear(npc.getLocation(), 16) ?? [];
    const shields = near.filter((other) => ids.includes(other.getId?.()) && Common.alive(other));
    if (!shields.length) return null;
    shields.sort((a, b) => Common.distance(a.getLocation(), npc.getLocation()) - Common.distance(b.getLocation(), npc.getLocation()));
    return shields[0];
  } catch (_error) {
    return null;
  }
}

/** Clear ground: every tile within CLEARANCE of `tile` can be stood on (no fence, wall or rock beside a boss). */
const CLEARANCE = 3;

function clearAround(tile) {
  const { RegionManager } = Common.core;
  const z = tile.getZ();
  for (let dx = -CLEARANCE; dx <= CLEARANCE; dx++) {
    for (let dy = -CLEARANCE; dy <= CLEARANCE; dy++) {
      const x = tile.getX() + dx;
      const y = tile.getY() + dy;
      if (!Common.standable(x, y, z)) return false;
      // A fence or wall between two tiles leaves both standable: every step inside the square must
      // be open too, so nothing stands between a boss and the bots round it.
      for (const [sx, sy] of [[1, 0], [0, 1]]) {
        if (dx + sx > CLEARANCE || dy + sy > CLEARANCE) continue;
        let open = false;
        try {
          open = RegionManager.canMove(x, y, x + sx, y + sy, z, 1, 1, null);
        } catch (_error) {
          open = false;
        }
        if (!open) return false;
      }
    }
  }
  return true;
}

/** A spot for a boss: open ground, clear all round (near the safe zone's edge some of the time). */
function bossTile() {
  const Tournament = require("./Tournament.DeadmanTournament");
  const { nearCircleChance } = Common.data.bosses;
  for (let attempt = 0; attempt < 12; attempt++) {
    const tile = (Math.random() < nearCircleChance ? nearCircleTile() : null) ?? Tournament.randomWildernessTile();
    if (tile && clearAround(tile) && wellInside(tile)) return tile;
  }
  return null;
}

/**
 * A boss nobody has hurt for IDLE_TICKS (out of reach behind something, or just missed) teleports to
 * a new clear spot. One that has teleported RETIRE_AFTER_MOVES times without ever being hurt since it
 * spawned can't be hurt at all here, and is taken off the map.
 */
const IDLE_TICKS = 100;
const RETIRE_AFTER_MOVES = 2;

function checkIdle(npc, record) {
  const hp = npc.getHitpoints?.() ?? 0;
  if (record.lowestHp == null || hp < record.lowestHp) {
    if (record.lowestHp != null) record.everHurt = true;
    record.lowestHp = hp;
    record.hurtAt = state.clock;
  }
  record.hurtAt ??= state.clock;
  // Its shield (Vet'ion's hounds) being fought counts as it being fought: it stays put.
  if (shieldOf(npc)) record.hurtAt = state.clock;
  if (state.clock - record.hurtAt < IDLE_TICKS) return;
  if (!record.everHurt && (record.moves ?? 0) >= RETIRE_AFTER_MOVES) {
    retire(npc, `never hurt in ${record.moves} spots`);
    return;
  }
  const tile = bossTile();
  record.hurtAt = state.clock;
  if (!tile) return;
  record.moves = (record.moves ?? 0) + 1;
  record.lowestHp = hp;
  npc.getCombat?.().reset?.();
  npc.moveTo(tile);
  for (const guard of record.guards ?? []) {
    if (Common.alive(guard)) guard.moveTo(new Common.core.Location(tile.getX() + Common.randomInt(-2, 2), tile.getY() + Common.randomInt(-2, 2), tile.getZ()));
  }
  const level = Common.wildernessLevel(tile.getX(), tile.getY());
  Common.log(`boss moved: ${record.entry.name} untouched for a minute, now at ${tile.getX()},${tile.getY()} (level ${level})`);
  Common.feed(`<col=ff0000>${record.entry.name}</col> has moved to level ${level} Wilderness${direction(tile.getX(), tile.getY())}.`);
}

/** One boss now (::dmboss [name] too): true if one spawned. `kind` "common" is the Barrows brothers' pool. */
function spawnBoss(name = null, kind = "main") {
  const Tournament = require("./Tournament.DeadmanTournament");
  const { nearCircleChance } = Common.data.bosses;
  const allPools = [...Common.data.bosses.pool, ...(Common.data.bosses.common?.pool ?? [])];
  const pool = name ? allPools : kind === "common" ? Common.data.bosses.common?.pool ?? [] : Common.data.bosses.pool;
  const live = new Set([...active.values()].map(({ entry }) => entry.npc));
  const choices = name
    ? pool.filter((entry) => entry.name.toLowerCase().includes(String(name).toLowerCase()))
    : pool.filter((entry) => !live.has(entry.npc));
  if (choices.length === 0) return false;
  const entry = Common.pick(choices);
  const tile = bossTile();
  if (!tile) return false;
  const npc = spawnAt(entry, tile);
  if (!npc) {
    Common.log(`${entry.name} (${entry.npc}) failed to spawn`);
    return false;
  }
  const level = Common.wildernessLevel(tile.getX(), tile.getY());
  const isCommon = (Common.data.bosses.common?.pool ?? []).includes(entry);
  active.get(npc).common = isCommon;
  const line = `<col=ff0000>${entry.name} has ${isCommon ? "risen" : "spawned"} in level ${level} Wilderness${direction(tile.getX(), tile.getY())}!</col>`;
  if (isCommon) Common.feed(line);
  else Common.broadcast(line);
  Common.log(`boss ${entry.name} at ${tile.getX()},${tile.getY()} (level ${level})`);
  return true;
}

function liveBosses() {
  const list = [];
  for (const [npc] of active) {
    if (Common.alive(npc)) list.push(npc);
  }
  return list;
}

/**
 * Every REPORT_EVERY ticks, for each live boss: its hitpoints, how many fighters are on it, how many
 * of those are within reach and touching it, and one of them in detail - the log says where bots
 * fail on a boss nobody hurts.
 */
const REPORT_EVERY = 25;

function reportBosses() {
  for (const [npc, record] of active) {
    if (!Common.alive(npc)) continue;
    const at = npc.getLocation();
    const size = Math.max(1, npc.getSize?.() ?? 1);
    const gap = (p) => {
      const h = p.getLocation();
      return Math.max(Math.max(0, at.getX() - h.getX(), h.getX() - (at.getX() + size - 1)), Math.max(0, at.getY() - h.getY(), h.getY() - (at.getY() + size - 1)));
    };
    const on = [...state.alive].filter((p) => p.getCombat?.().getTarget?.() === npc);
    const near = [...state.alive].filter((p) => Common.distance(p.getLocation(), at) <= 15);
    if (on.length === 0 && near.length === 0) continue;
    const sample = on[0] ?? near[0];
    const weapon = sample.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
    const combat = sample.getCombat();
    Common.log(`boss report: ${record.entry.name} hp ${npc.getHitpoints()}/${npc.getMaxHitpoints?.() ?? "?"} size ${size}`
      + ` - ${on.length} on it (${on.filter((p) => gap(p) <= 1).length} touching, ${on.filter((p) => gap(p) <= 6).length} within 6), ${near.length} within 15;`
      + ` e.g. ${sample.getUsername()} gap ${gap(sample)}, weapon ${weapon > 0 ? Common.itemName(weapon) : "none"},`
      + ` target ${combat.getTarget?.() === npc ? "the boss" : combat.getTarget?.() ? "other" : "none"}, spell ${combat.getSelectedSpell?.()?.spellId?.() ?? "none"},`
      + ` attack timer ${combat.getAttackTimer?.() ?? combat.getAttackDelay?.() ?? "?"}, moving ${sample.getMovementQueue().size()},`
      + ` last decision ${require("./Bots.DeadmanTournament").stepOf(sample)}; near: ${near.slice(0, 6).map((p) => require("./Bots.DeadmanTournament").stepOf(p)).join(" / ")}`);
  }
}

/** Everyone fighting one of our bosses this tick goes on its list of attackers (for the key). */
function noteAttackers() {
  for (const player of state.alive) {
    const target = player.getCombat?.().getTarget?.();
    const record = target ? active.get(target) : null;
    if (!record) continue;
    (record.attackers ??= new Set()).add(player);
  }
}

/** A bloodier key for one of a boss's attackers still alive, at random. */
function keyForAnAttacker(record, name) {
  const alive = [...(record.attackers ?? [])].filter((player) => state.alive.has(player) && Common.alive(player));
  if (alive.length === 0) return;
  const lucky = Common.pick(alive);
  const { Item } = Common.core;
  const bloodier = Common.data.keys.bloodier[0];
  require("./Loot.DeadmanTournament").give(lucky, [new Item(bloodier, 1)]);
  if (!State.isBot(lucky)) lucky.sendMessage(`<col=ef1020>You take a bloodier key from ${name}! Find a chest to open it.</col>`);
  Common.feed(`<col=ff0000>${lucky.getUsername()}</col> took a bloodier key from ${name}.`);
}

/**
 * A teleported or new NPC is "needs placement" until the world's end-of-tick reset - which only
 * runs for NPCs in regions a real player has active. A boss moved (or spawned, or its hounds called)
 * out where only bots are kept the flag for good, and the core calls a target that needs placement
 * invalid: a crowd of bots round it, none able to attack. Bosses, their guards and what shields them
 * still flagged a tick later are cleared here.
 */
const flaggedLastTick = new WeakSet();

function settlePlacement() {
  const npcs = [];
  for (const [npc, { guards }] of active) {
    if (!Common.alive(npc)) continue;
    npcs.push(npc, ...guards.filter((guard) => Common.alive(guard)));
    const ids = ours.get(npc)?.shieldedBy;
    if (ids?.length) {
      try {
        for (const other of Common.core.World.getNpcsNear(npc.getLocation(), 16) ?? []) if (ids.includes(other.getId?.())) npcs.push(other);
      } catch (_error) {
        // None to check.
      }
    }
  }
  for (const npc of npcs) {
    if (!npc.isNeedsPlacement?.()) {
      flaggedLastTick.delete(npc);
      continue;
    }
    if (flaggedLastTick.has(npc)) {
      npc.setNeedsPlacement(false);
      flaggedLastTick.delete(npc);
      Common.log(`placement settled: ${npc.getDefinition?.()?.getName?.() ?? npc.getId?.()} at ${npc.getLocation().getX()},${npc.getLocation().getY()}`);
    } else {
      flaggedLastTick.add(npc);
    }
  }
}

function tick() {
  if (state.phase !== "battle") return;
  const { everyTicks, firstAfterTicks, maxActive } = Common.data.bosses;
  for (const [npc, { guards }] of [...active]) {
    if (!npc.isRegistered?.() && (npc.getHitpoints?.() ?? 0) <= 0) {
      active.delete(npc);
      for (const guard of guards) if (!guard.isRegistered?.()) ours.delete(guard);
    }
  }
  noteAttackers();
  settlePlacement();
  for (const [npc, record] of [...active]) if (Common.alive(npc)) checkIdle(npc, record);
  if (state.clock % REPORT_EVERY === 0) reportBosses();
  if (nextAt === 0) nextAt = firstAfterTicks;
  if (state.clock >= nextAt) {
    nextAt = state.clock + Common.randomInt(everyTicks[0], everyTicks[1]);
    if (liveCount(false) < maxActive) spawnBoss();
  }
  // The Barrows brothers: their own, quicker timer.
  const common = Common.data.bosses.common;
  if (!common) return;
  if (nextCommonAt === 0) nextCommonAt = common.firstAfterTicks;
  if (state.clock >= nextCommonAt) {
    nextCommonAt = state.clock + Common.randomInt(common.everyTicks[0], common.everyTicks[1]);
    if (liveCount(true) < common.maxActive) spawnBoss(null, "common");
  }
}

function liveCount(common) {
  let count = 0;
  for (const [npc, record] of active) if (Boolean(record.common) === common && Common.alive(npc)) count++;
  return count;
}

/**
 * The boss's guaranteed unique: whole, to whoever of the killer and their clan (alive, within
 * `shareRange` of the boss) it helps most - a bot wears it straight away, dropping what it
 * replaces; with nobody it helps, the killer keeps it.
 */
function awardUnique(entry, killer, where) {
  const uniques = entry.uniques ?? [];
  if (!killer || uniques.length === 0 || !state.alive.has(killer)) return;
  const Gear = require("./Gear.DeadmanTournament");
  const Loot = require("./Loot.DeadmanTournament");
  const Clans = require("./Clans.DeadmanTournament");
  const { Item } = Common.core;
  const items = Common.pick(uniques).map(([id, , amount]) => new Item(id, amount ?? 1));
  // A whole set (the Barrows brothers): onto the floor where it died, for the killer's clan (and
  // whoever's near) to take what each of them needs - the bots' loot step wears the upgrades.
  if (entry.dropWholeSet) {
    // Its own set and another brother's (at random), all on the floor for anyone.
    const others = (Common.data.bosses.common?.pool ?? []).filter((other) => other !== entry && other.dropWholeSet && other.uniques?.length);
    const second = others.length ? Common.pick(others) : null;
    if (second) for (const [id, , amount] of Common.pick(second.uniques)) items.push(new Item(id, amount ?? 1));
    Loot.dropForAll(killer, items, where.clone ? where.clone() : new Common.core.Location(where.x, where.y, where.z ?? 0));
    Common.feed(`<col=ef1020>${killer.getUsername()} killed ${entry.name}: ${second ? `its set and ${second.name.split(" ")[0]}'s are` : "a full set is"} on the floor!</col>`);
    return;
  }
  const clan = Clans.clanOf(killer);
  const range = Common.data.bosses.shareRange;
  const candidates = [killer, ...(clan ? [...clan.members] : [])]
    .filter((member, i, all) => all.indexOf(member) === i && state.alive.has(member) && Common.distance(member.getLocation(), where) <= range);
  let best = killer;
  let bestGain = 0;
  for (const member of candidates) {
    const gain = Gear.upgradeGain(member, items[0].getId());
    if (gain > bestGain) {
      best = member;
      bestGain = gain;
    }
  }
  Loot.give(best, items);
  if (State.isBot(best)) Gear.wearUpgrades(best);
  else best.sendMessage(`<col=ef1020>${entry.name}'s ${Common.itemName(items[0].getId())} is yours - check your inventory!</col>`);
  const forWho = best === killer ? "" : ` (for clanmate ${best.getUsername()})`;
  const line = `<col=ef1020>${killer.getUsername()} received a drop: ${Common.itemName(items[0].getId())}${forWho}</col> <col=ff0000>(${entry.name})</col>`;
  // The Barrows brothers' pieces go to the kill feed; the big bosses' to everyone.
  if ((Common.data.bosses.common?.pool ?? []).includes(entry)) Common.feed(line);
  else Common.broadcast(line);
}

/**
 * Every boss kill leaves a shared pile where it died, for whoever's there (bots and players): a
 * bloodier chest's worth of loot (`pile.chestRolls`) and one whole set (`pile.sets` or a Barrows
 * brother's), announced in the kill feed.
 */
function dropPile(killer, where) {
  const pile = Common.data.bosses.pile;
  if (!pile || !where) return;
  const Loot = require("./Loot.DeadmanTournament");
  const { Item, Location } = Common.core;
  const items = [];
  for (let i = 0; i < (pile.chestRolls ?? 1); i++) items.push(...Loot.roll("bloodier"));
  const barrowsSets = (Common.data.bosses.common?.pool ?? []).map((entry) => entry.uniques?.[0]).filter(Boolean);
  const sets = [...(pile.sets ?? []), ...barrowsSets];
  const set = sets.length ? Common.pick(sets) : [];
  for (const [id, , amount] of set) items.push(new Item(id, amount ?? 1));
  const at = where.clone ? where.clone() : new Location(where.x, where.y, where.z ?? 0);
  const owner = killer && state.alive.has(killer) ? killer : [...state.alive][0];
  if (!owner) return;
  Loot.dropForAll(owner, items, at);
  Loot.rebuildIndex();
  const setName = set.length ? Common.itemName(set[0][0]).replace(/ (helm|helmet|hat|hood|coif|faceguard|great helm|chestplate)$/i, "") : "loot";
  Common.feed(`<col=ef1020>A boss pile is on the floor: ${items.length} items and a ${setName} set!</col>`);
}

function npcDied({ npc, killer, location }) {
  const record = active.get(npc);
  if (!record) return;
  active.delete(npc);
  const player = Common.asPlayer(killer);
  const who = player?.getUsername?.() ?? "Someone";
  const line = `<col=ff0000>${who} has slain ${record.entry.name}!</col>`;
  Common.log(`boss killed: ${record.entry.name} by ${who}, ${record.attackers?.size ?? 0} attacker(s)`);
  if (record.common) Common.feed(line);
  else Common.broadcast(line);
  awardUnique(record.entry, player, location ?? npc.getLocation());
  dropPile(player, location ?? npc.getLocation());
  keyForAnAttacker(record, record.entry.name);
}

/** Godsword pieces never drop here: the whole godsword is the unique. */
const PIECES = /godsword shard|hilt$/i;

function dropRolled({ player, npc, drops }) {
  const entry = npc ? ours.get(npc) : null;
  if (!entry || !player || !Array.isArray(drops)) return;
  for (let i = drops.length - 1; i >= 0; i--) {
    const name = Common.itemName(Number(drops[i]?.itemId ?? drops[i]?.id));
    if (PIECES.test(name)) drops.splice(i, 1);
  }
  // Only what helps a fighter: weapons and armour (jewellery and ammo too), food and potions, runes.
  // Logs, ores, herbs, seeds, coins and the like go; and there's always at least one weapon or
  // armour piece - one from the bloodier chest table when the drop had none.
  const Gear = require("./Gear.DeadmanTournament");
  const gear = (id) => Gear.slotOf(id) >= 0;
  const useful = (id) => gear(id) || Gear.isSupply(id) || Gear.isRune(id);
  for (let i = drops.length - 1; i >= 0; i--) {
    if (!useful(Number(drops[i]?.itemId ?? drops[i]?.id))) drops.splice(i, 1);
  }
  if (!drops.some((drop) => gear(Number(drop?.itemId ?? drop?.id)))) {
    const table = Common.data.loot.bloodier;
    const roll = Common.pick(Math.random() < 0.5 ? table.offensive : table.defensive);
    for (const [id, , amount] of roll) drops.push({ itemId: id, id, amount: amount ?? 1 });
  }
  const { ItemDefinition } = Common.core;
  for (const drop of drops) {
    const id = Number(drop?.itemId ?? drop?.id);
    const amount = Number(drop?.amount ?? 1) || 1;
    const definition = ItemDefinition.forId(id);
    const name = definition?.getName?.() ?? "";
    if (!name || /bones$/i.test(name) || !gear(id)) continue;
    const value = Number(definition.getValue?.() ?? 0) * amount;
    if (value < Common.data.bosses.announceValue) continue;
    const what = amount > 1 ? `${amount.toLocaleString("en-US")} x ${name}` : name;
    Common.broadcast(`<col=ef1020>${player.getUsername()} received a drop: ${what}</col> <col=ff0000>(${entry.name})</col>`);
  }
}

/** Takes one boss (and its guards) off the map, logged: one nobody can hurt (Bots). */
function retire(npc, why) {
  const record = active.get(npc);
  if (!record) return;
  active.delete(npc);
  for (const mob of [npc, ...(record.guards ?? [])]) {
    try {
      Common.api.removeNpc(mob);
    } catch (_error) {
      // Already gone.
    }
  }
  Common.log(`boss removed: ${record.entry.name} - ${why}`);
  Common.feed(`<col=ff0000>${record.entry.name}</col> has vanished.`);
}

function despawnAll() {
  for (const [npc, { guards }] of active) {
    for (const mob of [npc, ...guards]) {
      try {
        Common.api.removeNpc(mob);
      } catch (_error) {
        // Already gone.
      }
    }
  }
  active.clear();
  nextAt = 0;
  nextCommonAt = 0;
}

function attachBosses(api) {
  State.onTick(tick);
  State.onBracket(despawnAll);
  State.onEnd(despawnAll);
  api.onNpcDeath(npcDied);
  api.onCustomEvent("npc-drops:roll", dropRolled);
}

/** One of the tournament's NPCs: a boss or one of its guards. */
function isOurs(npc) {
  return ours.has(npc);
}

module.exports = {
  shieldOf, attachBosses, spawnBoss, liveBosses, retire, hitBy, isOurs };
