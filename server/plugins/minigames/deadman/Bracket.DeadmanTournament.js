/**
 * The Deadman Tournament's 1v1 bracket, in the Deadman finale arena (Deadman: Reborn and All
 * Stars; the cache still has it: loc 56375 "Barrier" at x 3674 and 3685, y 8607-8608, the stands
 * up the stairs on plane 1).
 * - At `bracket.at` alive (or ::dmskip) the fog stops, chests and bosses go, and everyone left is
 *   moved to the arena on the real map to wait, healed, unable to fight;
 * - each round pairs them at random (an odd one out gets a bye); every duel runs at once in its own
 *   copy of the arena, both fighters healed and their food and potions topped back up to their
 *   starter kit's, keeping the gear they won in the Wilderness; a countdown, then "FIGHT!";
 * - a death is elimination (Tournament.eliminate); after `maxDuelTicks` the one with more of their
 *   hitpoints left wins; the winner goes back to wait for the next round;
 * - the last one standing wins the tournament.
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");
const Gear = require("./Gear.DeadmanTournament");

const { state } = State;
/** player -> duel */
const duels = new Map();
let round = 0;
/** How many were in the bracket when this round started (it names the round: the final, the semi-finals...). */
let roundSize = 0;

/** A round's name by how many it starts with: the final (2), the semi-finals (4), the quarter-finals (8), the round of 16... */
function stageName(size) {
  if (size <= 2) return "final";
  if (size <= 4) return "semi-finals";
  if (size <= 8) return "quarter-finals";
  const power = 2 ** Math.floor(Math.log2(size));
  return size === power ? `round of ${size}` : "play-in";
}

/** The round after this one. */
function nextStage() {
  const size = roundSize || state.alive.size;
  const target = 2 ** Math.floor(Math.log2(Math.max(1, size)));
  return size === target ? stageName(Math.max(2, size / 2)) : stageName(target);
}

/** A chat line with {left}, {round}, {stage}, {next} and {opponent} filled in. */
function fill(line, opponent = null) {
  return String(line)
    .replaceAll("{left}", String(state.alive.size))
    .replaceAll("{round}", String(Math.max(1, round)))
    .replaceAll("{stage}", stageName(roundSize || state.alive.size))
    .replaceAll("{next}", state.alive.size <= 2 ? "fireworks" : nextStage())
    .replaceAll("{opponent}", opponent?.getUsername?.() ?? "you");
}
let roundOpen = false;
let nextRoundAt = 0;
let ArenaClass = null;
/** Ticks without a hit before a duel's stand-off is broken. */
const STALL_TICKS = 25;
/** How often a duelling bot not on its opponent is set on them again. */
const RETARGET_EVERY = 5;
/** Stand-offs in a row (nothing landing between them) before a duel counts as stuck and is decided. */
const STUCK_STALLS = 5;
/** How often a long duel is logged (5 minutes). */
const LONG_DUEL_TICKS = 500;

function arenaClass() {
  if (ArenaClass) return ArenaClass;
  const { TemplatedInstanceArea } = Common.core;
  const { minX, minY, width, height, planes } = Common.data.bracket.chunks;
  ArenaClass = class DeadmanArena extends TemplatedInstanceArea {
    constructor(duel) {
      super(width, height);
      this.duel = duel;
      for (let z = 0; z < planes; z++) {
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            this.setChunk(z, x, y, { sourceChunkX: minX + x, sourceChunkY: minY + y, sourcePlane: z, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return "Deadman Arena";
    }

    isMulti() {
      return false;
    }

    allowSummonPet() {
      return false;
    }

    /** The copy's tile for a real-map tile of the arena. */
    at([x, y, z]) {
      return this.tile(x - minX * 8, y - minY * 8, z ?? 0);
    }

    canAttack(attacker, target) {
      const a = Common.asPlayer(attacker);
      const t = Common.asPlayer(target);
      if (!a || !t) return false;
      return fightRule(a, t);
    }

    canTeleport() {
      return false;
    }

    /** Logging out mid-duel: saved at the lobby, never on a copy that won't exist. */
    postLeave(mobile, logout) {
      const player = Common.asPlayer(mobile);
      if (player && logout) player.setLocation(require("./Tournament.DeadmanTournament").lobbyTile());
      super.postLeave(mobile, logout);
    }
  };
  return ArenaClass;
}

function holdingTile() {
  const { holding } = Common.data.bracket;
  const { Location } = Common.core;
  for (let i = 0; i < 30; i++) {
    const x = Common.randomInt(holding.minX, holding.maxX);
    const y = Common.randomInt(holding.minY, holding.maxY);
    if (Common.standable(x, y, holding.z)) return new Location(x, y, holding.z);
  }
  return new Location(holding.centre[0], holding.centre[1], holding.z);
}

function calm(player) {
  const combat = player.getCombat();
  combat.reset();
  combat.getHitQueue().clear();
  player.setPoisonDamage?.(0);
  player.setVenomed?.(false);
  player.getTimers?.().cancel?.(Common.core.TimerKey.FREEZE);
}

/** Food and potions back up to the starter kit's (gear stays as won). */
/** Why the core calls a target invalid (validTarget's own checks, one by one). */
function invalidWhy(a, t) {
  const out = [];
  try {
    const { CombatPosition } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatPosition");
    for (const [who, m] of [["attacker", a], ["target", t]]) {
      if (!m.isRegistered?.()) out.push(`${who} unregistered`);
      if (m.getHitpoints?.() <= 0) out.push(`${who} 0hp`);
      if (m.isUntargetable?.()) out.push(`${who} UNTARGETABLE`);
      if (m.isNeedsPlacement?.()) out.push(`${who} needs placement`);
      if (m.isTeleportingReturn?.()) out.push(`${who} teleporting`);
      if (m.isPlayer?.() && m.getAsPlayer().isDyingReturn?.()) out.push(`${who} dying`);
      if (m.isNpc?.() && m.getAsNpc().isDyingFunction?.()) out.push(`${who} npc dying`);
    }
    const aa = CombatPosition.area(a, t);
    const ta = CombatPosition.area(t, a);
    if (aa !== ta) out.push(`areas differ (${aa?.getName?.() ?? aa} / ${ta?.getName?.() ?? ta})`);
    const al = CombatPosition.location(a, t);
    const tl = CombatPosition.location(t, a);
    if (al.getZ() !== tl.getZ()) out.push("heights differ");
    if (al.getDistance(tl) >= 40) out.push(`combat positions ${Math.round(al.getDistance(tl))} apart (${al.getX()},${al.getY()} / ${tl.getX()},${tl.getY()})`);
    const owner = t.isNpc?.() ? t.getAsNpc().getOwner?.() : null;
    if (owner) out.push(`npc owned by ${owner.getUsername?.()}`);
  } catch (error) {
    out.push(`why threw ${error?.message ?? error}`);
  }
  return out.join(", ") || "no reason found";
}

/** Which area or plugin says no to `p` attacking `o` (each canAttack hook asked on its own). */
function refusedBy(p, o, method) {
  const out = [];
  try {
    const { PluginManager } = require("../../../src/main/typescript/elvarg/plugins/PluginManager");
    for (const [label, area] of [["own area", p.getArea?.()], ["their area", o.getArea?.()]]) {
      if (!area) continue;
      const answer = PluginManager.callArea(area, "canAttack", p, o, method);
      if (answer === false) out.push(`${label} ${area.getName?.() ?? ""}`);
    }
    for (const hook of PluginManager.canAttackHooks ?? []) {
      const event = { attacker: p, target: o, method, allow: null };
      try {
        hook.handler(event);
      } catch (_error) {
        // A hook that throws says nothing.
      }
      if (event.allow === false) out.push(hook.pluginName ?? "a plugin");
    }
    const { Wilderness } = require("../../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
    if (Wilderness.isInSafeBuilding(p.getLocation()) || Wilderness.isInSafeBuilding(o.getLocation())) out.push("a safe building");
  } catch (error) {
    out.push(`check threw ${error?.message ?? error}`);
  }
  return out.join(", ") || "nobody found";
}

/** Everything about whether `p` can hit `o` right now (for the stand-off log). */
function attackState(p, o) {
  const { CombatFactory } = Common.core;
  const parts = [];
  try {
    const { CanAttackResponse } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
    const method = CombatFactory.getMethod(p);
    const answer = CombatFactory.canAttack(p, method, o);
    let who = "";
    if (CanAttackResponse?.[answer] === "CANT_ATTACK_IN_AREA") who = ` (refused by: ${refusedBy(p, o, method)})`;
    parts.push(`${method?.constructor?.name ?? "?"} ${CanAttackResponse?.[answer] ?? answer}${who}${CombatFactory.validTarget(p, o) ? "" : ` (invalid: ${invalidWhy(p, o)})`}`);
  } catch (error) {
    parts.push(`check threw ${error?.message ?? error}`);
  }
  const combat = p.getCombat();
  const weapon = p.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const ammo = p.getEquipment().getItems()[Common.core.Equipment.AMMUNITION_SLOT];
  const spell = combat.getSelectedSpell?.();
  parts.push(weapon > 0 ? Common.itemName(weapon) : "no weapon");
  if (ammo && ammo.getId() > 0) parts.push(`ammo ${Common.itemName(ammo.getId())} x${ammo.getAmount()}`);
  if (spell) {
    let runes = "?";
    try {
      runes = require("./Bots.DeadmanTournament").hasRunesFor(p, spell) ? "runes ok" : "NO RUNES";
    } catch (_error) {
      // left as ?
    }
    parts.push(`spell ${spell.spellId?.()} (${runes}, same book ${p.getSpellbook?.() === spell.getSpellbook?.()})`);
  }
  parts.push(`target ${combat.getTarget?.()?.getUsername?.() ?? "none"}`);
  parts.push(`delay ${combat.getAttackDelay?.() ?? "?"}`);
  if (combat.isAnimationStalled?.()) parts.push("ANIMATION STALLED");
  if (p.getTimers?.()?.has?.(Common.core.TimerKey.FREEZE)) parts.push("frozen");
  return parts.join(", ");
}

function resupply(player) {
  const { Item, Equipment } = Common.core;
  const kit = Common.data.kits[player.getAttribute("deadman-tournament:kit")] ?? Common.data.kits[Gear.styleOf(player)];
  const inventory = player.getInventory();
  // Room for food first: keys are no use in the bracket, and spare gear (all but the best piece for
  // each style) goes - a semi-finalist's pack is otherwise full of pickups with no slot for food.
  const [bloody, bloodier] = [Common.data.keys.bloody[0], Common.data.keys.bloodier[0]];
  inventory.getItems().forEach((item, slot) => {
    if (item && (item.getId() === bloody || item.getId() === bloodier)) inventory.setItem(slot, new Item(-1, 0));
  });
  if (State.isBot(player)) Gear.wearUpgrades(player);
  for (const [id, , amount] of kit.inventory) {
    if (!Gear.isSupply(id)) continue;
    const have = inventory.getAmount(id);
    for (let i = have; i < (amount ?? 1) && inventory.getFreeSlots() > 0; i++) inventory.add(new Item(id, 1), false);
  }
  // Runes and ammo back up too: a mage with no runes or a ranger with no bolts can't swing at all
  // (a duel then stands still).
  const equipment = player.getEquipment();
  for (const [id, , amount] of [...kit.inventory, ...kit.worn]) {
    const definition = Common.core.ItemDefinition.forId(id);
    if (!definition?.isStackable?.()) continue;
    const want = amount ?? 1;
    const quiver = equipment.getItems()[Equipment.AMMUNITION_SLOT];
    if (Gear.isRune(id)) {
      const have = inventory.getAmount(id);
      if (have < want && (have > 0 || inventory.getFreeSlots() > 0)) inventory.add(new Item(id, want - have), false);
    } else if (definition.getEquipmentType?.()?.getSlot?.() === Equipment.AMMUNITION_SLOT) {
      if (quiver?.getId?.() === id && quiver.getAmount() < want) equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(id, want));
      else if (!quiver || quiver.getId() <= 0) equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(id, want));
    }
  }
  topUpAmmo(player);
  equipment.refreshItems?.();
  inventory.refreshItems();
}

/** Ammo a duel tops up to, and what's given when a bot has none that fits (by the weapon's kind). */
const AMMO_TOP_UP = 100;
const FALLBACK_AMMO = { "bolt rack": 4740, javelin: 19484, bolts: 9243, arrow: 892 };

/**
 * Before a duel, the quiver holds a full stack of ammo for the bot's ranged weapon (the one worn,
 * else the first in its pack), whatever it is - a bow or crossbow won in the battle as well as the
 * kit's. Ammo already in the quiver that fits is topped up; ammo in the pack that fits goes in;
 * otherwise it gets the usual ammo for that kind of weapon.
 */
function topUpAmmo(player) {
  const { Equipment, Item } = Common.core;
  const equipment = player.getEquipment();
  const inventory = player.getInventory();
  const worn = equipment.getItems()[Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const ranged = Gear.rangedWeapons(player);
  const weapon = ranged.includes(worn) ? worn : ranged[0];
  if (!weapon) return;
  const quiver = equipment.getItems()[Equipment.AMMUNITION_SLOT];
  const quiverId = quiver?.getId?.() ?? -1;
  if (quiverId > 0 && Gear.ammoFits(weapon, quiverId)) {
    if (quiver.getAmount() < AMMO_TOP_UP) equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(quiverId, AMMO_TOP_UP));
    return;
  }
  // Ammo in the pack that fits: into the quiver (what was there goes in the pack's place).
  let id = -1;
  inventory.getItems().forEach((item, slot) => {
    if (id > 0 || !item || item.getId() <= 0 || !Gear.ammoFits(weapon, item.getId())) return;
    id = item.getId();
    inventory.setItem(slot, quiverId > 0 ? new Item(quiverId, quiver.getAmount()) : new Item(-1, 0));
  });
  if (id <= 0) {
    id = FALLBACK_AMMO[Gear.ammoFor(weapon)[0]] ?? -1;
    if (id <= 0) return;
    // The old ammo is kept in the pack when there's room (it may fit another of its weapons).
    if (quiverId > 0 && inventory.getFreeSlots() > 0) inventory.add(new Item(quiverId, quiver.getAmount()), false);
  }
  equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(id, AMMO_TOP_UP));
}

function wait(player) {
  // Already in a newer duel (a late timer from the last round): leave them be.
  if (duels.has(player)) return;
  calm(player);
  Gear.heal(player);
  const area = player.getArea?.();
  if (area instanceof Common.core.TemplatedInstanceArea) area.leave?.(player, false);
  player.moveTo(holdingTile());
  player.getMovementQueue().setBlockMovement(false);
}

/** Waiting bots stroll about the waiting room and talk about the tournament (`bracket.chat`). */
function mingle() {
  const { holding, chat } = Common.data.bracket;
  const waiting = [...state.alive].filter((p) => State.isBot(p) && !duels.has(p));
  if (waiting.length === 0) return;
  const inRoom = (p) => {
    const at = p.getLocation();
    return at.getZ() === holding.z && Common.inBox(at.getX(), at.getY(), holding);
  };
  for (let i = 0; i < Math.min(3, waiting.length); i++) {
    const bot = Common.pick(waiting);
    if (bot.getMovementQueue().size() > 0) continue;
    const x = Common.randomInt(holding.minX, holding.maxX);
    const y = Common.randomInt(holding.minY, holding.maxY);
    try {
      bot.setRunning?.(false);
      Common.core.PathFinder.calculateWalkRoute(bot, x, y);
    } catch (_error) {
      // Next time.
    }
  }
  // {left}, {round}, {stage} and {next} are filled in from where the bracket is now.
  // Down to the final two: talk of the final only (no looting time or rounds to come).
  const lines = state.alive.size <= 2 ? (Common.data.bracket.finalWaitChat ?? chat) : chat;
  if (lines?.length && Math.random() < 0.3) Common.pick(waiting).forceChat?.(fill(Common.pick(lines)));
  // Anyone who's wandered out of the room is put back.
  if (state.clock % 10 === 0) for (const bot of waiting) if (!inRoom(bot) && !bot.getArea?.()) bot.moveTo(holdingTile());
}

/**
 * Whether a and b may fight: they're the two of one live duel. The duel comes from the arena copy
 * they stand in when the duel map has lost one of them (logged once a duel), so a stale map entry
 * never leaves two fighters unable to touch each other.
 */
function fightRule(a, b) {
  const mapped = duels.get(a);
  const copy = a?.getArea?.()?.duel ?? null;
  const isPair = (d) => d && ((d.a === a && d.b === b) || (d.a === b && d.b === a));
  const duel = isPair(mapped) ? mapped : isPair(copy) ? copy : null;
  const pair = Boolean(duel);
  // Only a live duel is repaired: one that's over has left the map for good (putting it back would
  // hold the round open for ever).
  if (pair && !duel.over && copy === duel && (mapped !== duel || duels.get(b) !== duel) && !duel.mapWarned) {
    duel.mapWarned = true;
    Common.log(`duel map lost a fighter: ${duel.a.getUsername()} -> ${duels.get(duel.a) === duel ? "ok" : duels.get(duel.a) ? "another duel" : "none"}, ${duel.b.getUsername()} -> ${duels.get(duel.b) === duel ? "ok" : duels.get(duel.b) ? "another duel" : "none"}`);
    duels.set(duel.a, duel);
    duels.set(duel.b, duel);
  }
  return Boolean(pair) && duel.live && !duel.over;
}

/**
 * What the top 100 brought from the Wilderness: every piece they wear or carry that wasn't in the
 * kit they started with, counted (logs/deadman-tournament.log).
 */
function gearReport() {
  const counts = new Map();
  let withUpgrades = 0;
  let pieces = 0;
  let keysUnused = 0;
  const keys = [Common.data.keys.bloody[0], Common.data.keys.bloodier[0]];
  for (const player of state.alive) {
    const kit = Common.data.kits[player.getAttribute("deadman-tournament:kit")];
    const started = new Set([...(kit?.worn ?? []), ...(kit?.inventory ?? [])].map(([id]) => id));
    const items = [...player.getEquipment().getItems(), ...player.getInventory().getItems()]
      .filter((item) => item && item.getId() > 0);
    const fresh = new Set();
    for (const item of items) {
      const id = item.getId();
      if (keys.includes(id)) keysUnused += item.getAmount();
      const slot = Common.core.ItemDefinition.forId(id)?.getEquipmentType?.()?.getSlot?.() ?? -1;
      if (slot < 0 || started.has(id)) continue;
      fresh.add(id);
    }
    if (fresh.size) withUpgrades++;
    pieces += fresh.size;
    for (const id of fresh) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, n]) => `${n} ${Common.itemName(id)}`).join(", ");
  // Totals so far plus the minute in progress.
  const totals = { ...(state.totals ?? {}) };
  for (const [name, value] of Object.entries(state.stats ?? {})) totals[name] = (totals[name] ?? 0) + value;
  Common.log(`top ${state.alive.size} gear: ${withUpgrades} brought upgrades, ${(pieces / Math.max(1, state.alive.size)).toFixed(1)} new pieces each on average, ${keysUnused} keys never used`);
  Common.log(`top ${state.alive.size} brought: ${top || "nothing new"}`);
  Common.log(`whole battle: ${totals.pickups ?? 0} floor pickups, ${totals.upgrades ?? 0} upgrades worn, ${totals.chests ?? 0} chests opened, ${totals.unstuck ?? 0} nudges`);
}

function begin() {
  // Duel chatter from here on (no clans, fog or top 100 in a 1v1).
  if (Array.isArray(Common.data.duelChat)) {
    for (const player of state.alive) if (State.isBot(player)) player.setAttribute("player-bots:chatter-lines", Common.data.duelChat);
  }
  gearReport();
  round = 0;
  roundSize = 0;
  cleaningUp = 0;
  duels.clear();
  state.fightRule = fightRule;
  state.duelOf = (player) => duels.get(player) ?? null;
  for (const player of state.alive) wait(player);
  nextRoundAt = state.clock + Common.data.bracket.betweenRoundsTicks;
  roundOpen = false;
}

/**
 * A round. The field halves cleanly only from a power of two (64, 32...), so a field that isn't one
 * plays in first: just enough duels to bring it down to the power of two below (100 -> 36 duels
 * -> 64), the top killers sitting that round out. From then on there are never byes.
 */
function startRound() {
  round++;
  const alive = [...state.alive];
  roundSize = alive.length;
  const target = 2 ** Math.floor(Math.log2(Math.max(1, alive.length)));
  const playIn = alive.length - target;
  let fighters;
  let through = [];
  if (playIn > 0 && playIn * 2 < alive.length) {
    // Top killers (ties at random) go straight through; the rest play in.
    const ranked = Common.shuffle(alive).sort((a, b) => (state.kills.get(b) ?? 0) - (state.kills.get(a) ?? 0));
    through = ranked.slice(0, alive.length - playIn * 2);
    fighters = Common.shuffle(ranked.slice(alive.length - playIn * 2));
  } else {
    fighters = Common.shuffle(alive);
  }
  const pairs = [];
  while (fighters.length >= 2) pairs.push([fighters.pop(), fighters.pop()]);
  const bye = fighters.pop();
  const note = through.length
    ? `; the top ${through.length} killers go straight through to the last ${target}`
    : bye ? `; ${bye.getUsername()} has a bye` : "";
  Common.broadcast(`<col=ef1020>Deadman Tournament round ${round}: ${pairs.length} duel${pairs.length === 1 ? "" : "s"}${note}.</col>`);
  Common.log(`round ${round}: ${pairs.length} duels, ${state.alive.size} alive${through.length ? `, ${through.length} through to the last ${target}` : ""}`);
  for (const [a, b] of pairs) startDuel(a, b);
  roundOpen = true;
}

function startDuel(a, b) {
  const duel = { a, b, area: new (arenaClass())(null), clock: 0, live: false, over: false };
  duel.area.duel = duel;
  const [sideA, sideB] = Common.data.bracket.sides;
  for (const [player, side] of [[a, sideA], [b, sideB]]) {
    duels.set(player, duel);
    calm(player);
    Gear.heal(player);
    resupply(player);
    const earlier = player.getArea?.();
    if (earlier instanceof Common.core.TemplatedInstanceArea && earlier !== duel.area) earlier.leave?.(player, false);
    duel.area.enter(player);
    player.moveTo(duel.area.at(side));
    player.getMovementQueue().setBlockMovement(true).reset?.();
    const other = player === a ? b : a;
    if (!State.isBot(player)) player.sendMessage(`<col=ef1020>Round ${round} (the ${stageName(roundSize)}): you fight ${other.getUsername()}!</col>`);
    // This duel's fight chatter, with the opponent's name and the round filled in.
    if (State.isBot(player) && Array.isArray(Common.data.duelChat)) {
      const lines = [...Common.data.duelChat];
      if (roundSize <= 2) lines.push(...(Common.data.bracket.finalChat ?? []));
      player.setAttribute("player-bots:chatter-lines", lines.map((line) => fill(line, other)));
    }
  }
}

function tickDuel(duel) {
  if (duel.over) return;
  duel.clock++;
  // A fighter no longer in the tournament (or gone) can't hold a round up: the other goes through.
  const inIt = (p) => state.alive.has(p) && p.isRegistered?.() !== false;
  if (!inIt(duel.a) || !inIt(duel.b)) {
    const stays = inIt(duel.a) ? duel.a : inIt(duel.b) ? duel.b : null;
    const gone = stays === duel.a ? duel.b : duel.a;
    Common.log(`duel closed: ${gone.getUsername()} no longer in it; ${stays?.getUsername() ?? "nobody"} goes through`);
    if (state.alive.has(gone)) require("./Tournament.DeadmanTournament").eliminate(gone, stays, "left");
    settle(duel, stays);
    return;
  }
  const { countdownTicks, maxDuelTicks } = Common.data.bracket;
  if (!duel.live) {
    const left = countdownTicks - duel.clock;
    for (const player of [duel.a, duel.b]) player.forceChat?.(left > 0 ? `${left}...` : "FIGHT!");
    if (left <= 0) {
      duel.live = true;
      const Bots = require("./Bots.DeadmanTournament");
      const nowMs = Date.now();
      for (const [player, other] of [[duel.a, duel.b], [duel.b, duel.a]]) {
        player.getMovementQueue().setBlockMovement(false);
        if (State.isBot(player)) Bots.hunt(player, other, nowMs);
      }
    }
    return;
  }
  // Every few ticks a bot not on its opponent is set on them again (the PvP brain's opponent and the
  // core attack), well before it counts as a stand-off.
  if (duel.clock % RETARGET_EVERY === 0) {
    const Bots = require("./Bots.DeadmanTournament");
    const nowMs = Date.now();
    for (const [player, other] of [[duel.a, duel.b], [duel.b, duel.a]]) {
      if (!State.isBot(player)) continue;
      if (Bots.unfreezeStyle(player, other)) continue;
      if (Bots.duelTactics(player, other)) continue;
      if (player.getCombat().getTarget?.() !== other) Bots.hunt(player, other, nowMs);
    }
  }
  // A stand-off (nobody hit for STALL_TICKS): both are put side by side, told to drop any retreat,
  // and set on each other.
  const hp = duel.a.getHitpoints() + duel.b.getHitpoints();
  if (duel.lastHp !== hp) {
    duel.lastHp = hp;
    duel.quietSince = duel.clock;
    duel.stalls = 0;
  } else if (duel.clock - (duel.quietSince ?? duel.clock) >= STALL_TICKS) {
    duel.quietSince = duel.clock;
    duel.stalls = (duel.stalls ?? 0) + 1;
    // Why they aren't fighting, read before anything below changes it (a teleport marks the one
    // moved as "needs placement" till the tick ends, which the core counts as an invalid target).
    const verdict = [[duel.a, duel.b], [duel.b, duel.a]].map(([p, o]) => `${p.getUsername()}: ${attackState(p, o)}`).join("; ");
    // Side by side, only when they're apart.
    const there = duel.b.getLocation();
    const next = new Common.core.Location(there.getX() + 1, there.getY(), there.getZ());
    if (Common.distance(duel.a.getLocation(), there) > 1 && Common.standable(next.getX(), next.getY(), next.getZ(), duel.area)) duel.a.moveTo(next);
    const engaged = [];
    for (const [player, other] of [[duel.a, duel.b], [duel.b, duel.a]]) {
      const Bots = require("./Bots.DeadmanTournament");
      const pvp = Bots.stateOf(player)?.pvp;
      if (pvp) {
        pvp.avoidingFight = false;
        pvp.retreat = null;
      }
      player.getMovementQueue().setBlockMovement(false);
      if (State.isBot(player)) {
        // A clean slate (whatever stale attack state held it), then off the style the opponent is
        // praying against when the pack has another; from the second stand-off a mage whose casts
        // still land nothing goes to melee or ranged.
        player.getCombat().reset?.();
        let switched = Bots.offProtectedStyle(player, other);
        if (duel.stalls >= 2 && Gear.weaponStyle(player.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1) === "magic") {
          switched = Bots.offMagic(player) ?? switched;
          player.getCombat().setCastSpell?.(null);
          player.getCombat().setAutocastSpell?.(null);
        }
        engaged.push(`${player.getUsername()}: ${switched ? `switched to ${switched}, ` : ""}${Bots.engage(player, other)}`);
        Bots.hunt(player, other, Date.now());
      }
    }
    // Why they aren't fighting: the core's answer to an attack, where each is, and the copy.
    const where = (p) => `${p.getLocation().getX()},${p.getLocation().getY()},${p.getLocation().getZ()} in ${p.getArea?.()?.getName?.() ?? "no area"}${p.getArea?.() === duel.area ? " (their copy)" : ""}`;
    Common.log(`stand-off broken: ${duel.a.getUsername()} v ${duel.b.getUsername()} (${duel.stalls}); can attack: ${verdict}; ${duel.a.getUsername()} at ${where(duel.a)}, ${duel.b.getUsername()} at ${where(duel.b)}; live ${duel.live}; ${engaged.join(", ")}`);
    // Stuck for good (STUCK_STALLS stand-offs in a row with nothing landing): decided on hitpoints,
    // logged in full - the bracket moves on and the log shows what the two were doing.
    if (duel.stalls >= STUCK_STALLS && !duel.over) {
      const describe = (p) => {
        const weapon = p.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
        const prayers = (p.getPrayerActive?.() ?? []).map((on, id) => (on ? id : null)).filter((id) => id != null).join("/");
        return `${p.getUsername()} hp ${p.getHitpoints()}, ${weapon > 0 ? Common.itemName(weapon) : "no weapon"}, spell ${p.getCombat().getSelectedSpell?.()?.spellId?.() ?? "none"}, prayers ${prayers || "none"}, target ${p.getCombat().getTarget?.()?.getUsername?.() ?? "none"}`;
      };
      Common.log(`stuck duel decided: ${describe(duel.a)} v ${describe(duel.b)}`);
      const share = (p) => p.getHitpoints() / Math.max(1, p.getSkillManager().getMaxLevel(Common.core.Skill.HITPOINTS));
      // Level on hitpoints: a coin flip, never whoever happened to be listed first.
    const [winner, loser] = (share(duel.a) === share(duel.b) ? Math.random() < 0.5 : share(duel.a) > share(duel.b)) ? [duel.a, duel.b] : [duel.b, duel.a];
      Common.feed(`${winner.getUsername()} wins a stuck duel against ${loser.getUsername()}.`);
      require("./Tournament.DeadmanTournament").eliminate(loser, winner, "stuck");
      if (!duel.over) {
        state.alive.delete(loser);
        settle(duel, winner);
      }
      return;
    }
  }
  // Both fighters stay in their own arena copy: one found outside it (on the real arena, among
  // the waiting) is put back on their starting spot inside it.
  const [sideA, sideB] = Common.data.bracket.sides;
  for (const [player, side] of [[duel.a, sideA], [duel.b, sideB]]) {
    if (player.getArea?.() === duel.area) continue;
    Common.log(`duel fighter outside their copy: ${player.getUsername()} put back (${duel.a.getUsername()} v ${duel.b.getUsername()})`);
    duel.area.enter(player);
    player.moveTo(duel.area.at(side));
  }
  // Prayer never runs out in a duel (bracket.unlimitedPrayer), for players as for bots.
  if (Common.data.bracket.unlimitedPrayer !== false) {
    const { Skill } = Common.core;
    for (const player of [duel.a, duel.b]) {
      const skills = player.getSkillManager();
      player.setPrayerPointDrain?.(0);
      if (skills.getCurrentLevel(Skill.PRAYER) < skills.getMaxLevel(Skill.PRAYER)) skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
    }
  }
  // A bot that dropped its target picks it straight back up.
  const Bots = require("./Bots.DeadmanTournament");
  for (const [player, other] of [[duel.a, duel.b], [duel.b, duel.a]]) {
    if (State.isBot(player) && duel.clock % 3 === 0 && !Bots.fighting(player)) Bots.hunt(player, other, Date.now());
  }
  // A fighter down at 0 hitpoints whose death never came through: the other wins.
  for (const [player, other] of [[duel.a, duel.b], [duel.b, duel.a]]) {
    if (player.getHitpoints() > 0 || !player.isRegistered?.()) {
      duel.downSince?.delete?.(player);
      continue;
    }
    duel.downSince = duel.downSince ?? new Map();
    if (!duel.downSince.has(player)) duel.downSince.set(player, duel.clock);
    else if (duel.clock - duel.downSince.get(player) > 10) {
      require("./Tournament.DeadmanTournament").eliminate(player, other, "died");
      return;
    }
  }
  // A long duel (no limit set: maxDuelTicks 0) is logged every LONG_DUEL_TICKS, with what both
  // fighters are doing - a stuck or broken bot shows up there.
  if (duel.clock > countdownTicks && (duel.clock - countdownTicks) % LONG_DUEL_TICKS === 0) {
    const what = (p) => {
      const weapon = p.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
      const target = p.getCombat().getTarget?.();
      return `${p.getUsername()} hp ${p.getHitpoints()}, ${weapon > 0 ? Common.itemName(weapon) : "no weapon"}, target ${target === (p === duel.a ? duel.b : duel.a) ? "opponent" : target ? "other" : "none"}, spell ${p.getCombat().getSelectedSpell?.()?.spellId?.() ?? "none"}`;
    };
    Common.log(`long duel (${Math.round((duel.clock - countdownTicks) * 0.6)}s): ${what(duel.a)} v ${what(duel.b)}; ${Common.distance(duel.a.getLocation(), duel.b.getLocation())} tiles apart`);
  }
  if (maxDuelTicks > 0 && duel.clock >= countdownTicks + maxDuelTicks) {
    const share = (p) => p.getHitpoints() / Math.max(1, p.getSkillManager().getMaxLevel(Common.core.Skill.HITPOINTS));
    // Level on hitpoints: a coin flip, never whoever happened to be listed first.
    const [winner, loser] = (share(duel.a) === share(duel.b) ? Math.random() < 0.5 : share(duel.a) > share(duel.b)) ? [duel.a, duel.b] : [duel.b, duel.a];
    Common.feed(`${winner.getUsername()} wins on time against ${loser.getUsername()}.`);
    require("./Tournament.DeadmanTournament").eliminate(loser, winner, "time");
    // Whatever happened in there, the duel is over now.
    if (!duel.over) {
      Common.log(`duel forced shut on time: ${winner.getUsername()} v ${loser.getUsername()}`);
      state.alive.delete(loser);
      settle(duel, winner);
    }
  }
}

/** Ticks a duel's winner has to loot the loser before going to wait for the next round (~10s). */
const PLAYER_LOOT_TICKS = 34;
const BOT_LOOT_TICKS = 6;
/** Finished duels whose loot time and arena clean-up are still running. */
let cleaningUp = 0;

function settle(duel, winner) {
  if (duel.over) return;
  duel.over = true;
  duel.live = false;
  for (const player of [duel.a, duel.b]) duels.delete(player);
  const won = winner && state.alive.has(winner) && state.phase === "bracket";
  if (won && !State.isBot(winner)) winner.sendMessage("<col=ef1020>You win your duel! You have 20 seconds to loot before the next round.</col>");
  // The winner stays in the arena copy for its loot time to take the loser's things, then waits.
  // A player gets PLAYER_LOOT_TICKS to pick through the pile; a bot takes its upgrades straight away.
  const lootTicks = won && duel.lootable ? (State.isBot(winner) ? BOT_LOOT_TICKS : PLAYER_LOOT_TICKS) : 1;
  // The next round waits for this duel's loot time and clean-up (cleaningUp), so a late timer
  // can never pull a fighter out of their next duel's copy.
  cleaningUp++;
  Common.later(lootTicks, () => {
    if (won && state.alive.has(winner) && state.phase === "bracket") wait(winner);
  });
  Common.later(lootTicks + 3, () => {
    // Spectators still in this copy go back to the real arena before it goes.
    for (const spectator of state.spectators) {
      if (spectator.getArea?.() !== duel.area) continue;
      duel.area.leave?.(spectator, false);
      spectator.moveTo(holdingTile());
    }
    try {
      if (!duel.area.isDestroyed?.()) duel.area.destroy?.();
    } finally {
      cleaningUp = Math.max(0, cleaningUp - 1);
    }
  });
}

/**
 * The loser's things, for the winner: a bot winner takes what's an upgrade (worn or as a switch)
 * and any supplies it has room for straight away; a player winner finds it all on the arena floor.
 */
function lootForWinner(duel, victim, winner) {
  if (!winner || !state.alive.has(winner)) return;
  const Loot = require("./Loot.DeadmanTournament");
  const items = Gear.belongings(victim);
  Gear.empty(victim);
  victim.getInventory().refreshItems?.();
  victim.getEquipment().refreshItems?.();
  if (items.length === 0) return;
  duel.lootable = true;
  if (!State.isBot(winner)) {
    Loot.dropAt(winner, items, victim.getLocation());
    return;
  }
  Common.later(3, () => {
    if (!state.alive.has(winner)) return;
    const { Item } = Common.core;
    for (const item of items) {
      const id = item.getId();
      if (Gear.isSupply(id) || Gear.isRune(id)) {
        if (Gear.wants(winner, id)) winner.getInventory().add(new Item(id, item.getAmount()), false);
        continue;
      }
      if (Gear.upgradeGain(winner, id) > 0) Gear.wearUpgrades(winner, new Item(id, item.getAmount()));
    }
    winner.getInventory().refreshItems?.();
    winner.forceChat?.(Common.pick(["ty for the loot", "upgrades :)", "nice gear", "I'll take that", "loot's mine"]));
  });
}

function eliminated(victim, killer) {
  const duel = duels.get(victim);
  if (!duel) return;
  const winner = victim === duel.a ? duel.b : duel.a;
  if (state.phase === "bracket") lootForWinner(duel, victim, winner);
  // The loser says they're out, the winner gg's back.
  const { outChat, winChat } = Common.data.bracket;
  if (State.isBot(victim) && outChat?.length) victim.forceChat?.(fill(Common.pick(outChat), winner));
  if (winner && State.isBot(winner) && winChat?.length) Common.later(2, () => winner.forceChat?.(fill(Common.pick(winChat), victim)));
  calm(victim);
  settle(duel, winner ?? killer);
  // A player out of the bracket leaves the arena copy (Spectate takes over); a bot logs out.
  if (!State.isBot(victim) && victim.isRegistered?.()) {
    const area = victim.getArea?.();
    if (area instanceof Common.core.TemplatedInstanceArea) area.leave?.(victim, false);
    victim.moveTo(holdingTile());
  }
}

function tick() {
  if (state.phase !== "bracket") return;
  if (state.clock % 3 === 0) mingle();
  // A duel that's over never holds the round open (whatever put it back in the map).
  for (const [player, duel] of [...duels]) if (duel.over) duels.delete(player);
  const live = new Set(duels.values());
  for (const duel of live) tickDuel(duel);
  if (roundOpen && duels.size === 0 && cleaningUp === 0) {
    roundOpen = false;
    nextRoundAt = state.clock + Common.data.bracket.betweenRoundsTicks;
  }
  if (!roundOpen && state.clock >= nextRoundAt && state.alive.size >= 2) startRound();
}

function ended() {
  for (const duel of new Set(duels.values())) settle(duel, null);
  duels.clear();
  state.fightRule = null;
  state.duelOf = null;
}

function attachBracket() {
  State.onBracket(begin);
  State.onTick(tick);
  State.onEliminated(eliminated);
  State.onEnd(ended);
}

module.exports = { attachBracket, fightRule };
