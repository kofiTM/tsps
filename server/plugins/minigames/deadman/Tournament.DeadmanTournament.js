/**
 * Deadman Tournament: the phases and the rules that hold through all of them.
 * - lobby: every real player online (or logging in) is entered and waits at the lobby tile; the
 *   bots spawn a few a tick across the Wilderness, frozen; the countdown is broadcast;
 * - battle: everyone's own belongings and stats are put away (Last Man Standing's Stash, which
 *   also gives them back on the next login after a crash), each gets 99 combat and a starter kit
 *   on a random Wilderness tile, and anyone may fight anyone who isn't a clanmate;
 * - a death is final: the fallen's things drop for the killer, a bot logs out, a player spectates;
 * - at `bracket.at` alive the bracket takes over; the last one standing wins, and the server
 *   saves everyone and shuts down (world config `DeadmanTournament:shutdownOnEnd`).
 * The other units hook in through State (onStart, onTick, onKill, onEliminated, onBracket, onEnd).
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");
const Gear = require("./Gear.DeadmanTournament");
const Stash = require("../lms/Stash.LastManStanding");
const { pauseRegionalWilderness } = require("../../bots/runtime/Registry.PlayerBots");
const { setBotSpawnGate } = require("../../bots/behaviours/spawn/PlayerFactory.PlayerBots");

const PAUSE_KEY = "deadman-tournament";
/** The tournament borrows Last Man Standing's stash under its own name, so the LMS lobby (by Ferox, in the Wilderness) never hands it back early. */
const STASH_HOLDER = "deadman-tournament";
/** The finale: the level-up fireworks on the winner every few ticks while everyone watches. */
const FIREWORKS = 199;
const FIREWORKS_EVERY = 3;
/** The champion bot says something every this many ticks while the fireworks go. */
const CHAMPION_CHAT_EVERY = 6;

const { state } = State;
const HUD_EVERY = 2;
let lastTickAt = 0;
const perf = { samples: 0, total: 0, max: 0 };
/** Why fighters went out since the last perf line (the log shows it). */
const reasons = new Map();

// ---------------------------------------------------------------- tiles

function excluded(x, y) {
  return (Common.data.wilderness.exclude ?? []).some((box) => Common.inBox(x, y, box));
}

/** A random walkable Wilderness tile, inside `box` if given ({minX, maxX, minY, maxY}). */
function randomWildernessTile(box = Common.data.wilderness, attempts = 60) {
  const wild = Common.data.wilderness;
  const minX = Math.max(wild.minX, box.minX);
  const maxX = Math.min(wild.maxX, box.maxX);
  const minY = Math.max(wild.minY, box.minY);
  const maxY = Math.min(wild.maxY, box.maxY);
  if (minX > maxX || minY > maxY) return null;
  for (let i = 0; i < attempts; i++) {
    const x = Common.randomInt(minX, maxX);
    const y = Common.randomInt(minY, maxY);
    if (excluded(x, y) || !Common.standable(x, y, wild.z) || !Common.openArea(x, y, wild.z)) continue;
    return new Common.core.Location(x, y, wild.z);
  }
  return null;
}

/** A walkable tile round the lobby, within `spread` tiles. */
function lobbyTile(spread = Common.data.lobby.spread) {
  const [x, y, z] = Common.data.lobby.tile;
  const { Location } = Common.core;
  for (let i = 0; i < 20; i++) {
    const tx = x + Common.randomInt(-spread, spread);
    const ty = y + Common.randomInt(-spread, spread);
    if (Common.standable(tx, ty, z)) return new Location(tx, ty, z);
  }
  return new Location(x, y, z);
}

/** A tile near `centre`, for a clan starting together. */
function tileNear(centre, range = 4) {
  const box = { minX: centre.getX() - range, maxX: centre.getX() + range, minY: centre.getY() - range, maxY: centre.getY() + range };
  return randomWildernessTile(box, 15) ?? centre.clone();
}

// ---------------------------------------------------------------- phases

function enabled() {
  return Common.config(Common.CONFIG.enabled, false) === true;
}

function openLobby(botCount = Common.nextBotCount ?? Number(Common.config(Common.CONFIG.botCount, 300)), countdownTicks = null) {
  if (state.phase !== "idle") return false;
  // ::dmbots between tournaments counts once, for this lobby.
  Common.nextBotCount = null;
  State.reset();
  state.phase = "lobby";
  state.clock = 0;
  state.countdown = countdownTicks ?? Number(Common.config(Common.CONFIG.countdownTicks, Common.data.lobby.countdownTicks));
  state.botTarget = Math.max(0, Math.floor(botCount));
  lastCalled = null;
  // The Wilderness is the tournament's: no regional roamers filling it round real players.
  pauseRegionalWilderness(PAUSE_KEY, true);
  // Every other bot in the world (Wilderness, skilling, GE, dice...) goes, and none spawn till it's
  // over - only the tournament's own (Bots.isOwnSpawn) get through the gate.
  setBotSpawnGate(PAUSE_KEY, ownSpawnOnly);
  sweepOtherBots();
  for (const player of Common.realPlayers()) enterLobby(player);
  Common.log(`players entered: ${Common.realPlayers().map((player) => player.getUsername()).join(", ") || "none"}`);
  Common.broadcast(`<col=ef1020>The Deadman Tournament begins in ${Common.timeText(state.countdown)}! ${state.botTarget + 1} enter, one leaves.</col>`);
  Common.log(`lobby open: ${state.botTarget} bots wanted`);
  return true;
}

function enterLobby(player) {
  if (state.participants.has(player)) return;
  state.participants.add(player);
  state.alive.add(player);
  state.kills.set(player, 0);
  player.setAttribute(Common.ATTRIBUTES.participant, true);
  // Kitted out while they wait (their own things put away first), as the bots are.
  if (!State.isBot(player)) {
    if (!Stash.stashed(player)) Stash.save(player, STASH_HOLDER);
    Gear.equipKit(player);
  }
  player.moveTo(lobbyTile());
  // The overlay from the lobby on: how many are in, and later survivors, kills and the fog.
  if (!State.isBot(player)) openHud(player);
  player.sendMessage("<col=ef1020>You are entered in the Deadman Tournament. Wait here for the start.</col>");
}

/** The seconds the chat calls out, and the overhead count from 10 (as LMS's "12..." to "GO!"). */
const CALL_OUT = new Set([120, 90, 60, 45, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
const OVERHEAD_FROM = 10;
let lastCalled = null;

function lobbyTick() {
  if (state.countdown > 0) state.countdown--;
  const seconds = Math.ceil(state.countdown * 0.6);
  if (seconds !== lastCalled && state.countdown > 0) {
    lastCalled = seconds;
    if (CALL_OUT.has(seconds)) {
      Common.broadcast(`<col=ef1020>The Deadman Tournament begins in ${seconds} second${seconds === 1 ? "" : "s"}!</col>`);
    }
    if (seconds <= OVERHEAD_FROM) {
      for (const player of state.alive) if (!State.isBot(player)) player.forceChat?.(`${seconds}...`);
    }
  }
  if (state.countdown <= 0 && lastCalled !== 0) {
    lastCalled = 0;
    for (const player of state.alive) if (!State.isBot(player)) player.forceChat?.("GO!");
  }
  const ready = state.botsSpawned >= state.botTarget;
  if (state.countdown <= 0 && (ready || state.clock > state.botTarget / Common.data.lobby.botsPerTick + 200)) startBattle();
}

function startBattle() {
  state.phase = "battle";
  state.clock = 0;
  state.total = state.alive.size;
  const starts = new Map();
  for (const player of [...state.alive]) {
    if (!player.isRegistered?.()) {
      state.alive.delete(player);
      continue;
    }
    if (State.isBot(player)) continue;
    if (!Stash.stashed(player)) Stash.save(player, STASH_HOLDER);
    if (!player.getAttribute("deadman-tournament:kit")) Gear.equipKit(player);
    else Gear.heal(player);
    player.getMovementQueue().setBlockMovement(false);
    const tile = randomWildernessTile() ?? lobbyTile();
    player.moveTo(tile);
    starts.set(player.getAttribute(Common.ATTRIBUTES.team) ?? player, tile);
    openHud(player);
  }
  // The bots scatter from the lobby, each clan together (a player's recruits beside them).
  require("./Clans.DeadmanTournament").form();
  for (const bot of state.alive) {
    if (!State.isBot(bot)) continue;
    const team = bot.getAttribute(Common.ATTRIBUTES.team);
    const clanTile = team != null ? starts.get(team) : null;
    const tile = clanTile ? tileNear(clanTile) : randomWildernessTile() ?? lobbyTile();
    if (team != null && !clanTile) starts.set(team, tile);
    bot.moveTo(tile);
  }
  giveStartingKeys();
  State.run("start");
  const grace = Math.round((Common.data.battle?.graceTicks ?? 0) * 0.6);
  Common.broadcast(grace > 0
    ? `<col=ef1020>The Deadman Tournament has begun! ${state.alive.size} fighters across the Wilderness. ${grace} seconds to loot before anyone can fight - use your bloody key on a chest!</col>`
    : `<col=ef1020>The Deadman Tournament has begun! ${state.alive.size} fighters across the Wilderness. Get to the safe zone!</col>`);
  Common.log(`battle start: ${state.alive.size} alive (${State.aliveBots().length} bots)`);
}

/** The looting head start: no fighting between fighters for `battle.graceTicks` after the start. */
function inGrace() {
  return state.phase === "battle" && state.clock < (Common.data.battle?.graceTicks ?? 0);
}

/** `battle.startingKeys` bloody keys each, in the place of food (the kits fill the pack). */
function giveStartingKeys() {
  const count = Common.data.battle?.startingKeys ?? 0;
  if (count <= 0) return;
  const { Item } = Common.core;
  const key = Common.data.keys.bloody[0];
  const food = new Set(Common.data.supplies.food.map(([id]) => id));
  for (const player of state.alive) {
    const inventory = player.getInventory();
    for (let i = 0; i < count; i++) {
      let slot = inventory.getItems().findIndex((item) => !item || item.getId() <= 0);
      if (slot < 0) slot = inventory.getItems().map((item, index) => (item && food.has(item.getId()) ? index : -1)).filter((index) => index >= 0).pop() ?? -1;
      if (slot >= 0) inventory.setItem(slot, new Item(key, 1));
    }
    inventory.refreshItems?.();
  }
}

/** The head start's countdown in chat, then the fight. */
function graceTick() {
  const grace = Common.data.battle?.graceTicks ?? 0;
  if (state.phase !== "battle" || grace <= 0 || state.clock > grace) return;
  const left = Math.round((grace - state.clock) * 0.6);
  if (state.clock === grace) Common.broadcast("<col=ef1020>The looting is over - the fighting has begun! Anyone can be attacked.</col>");
  else if ((grace - state.clock) % 50 === 0 || (grace - state.clock) === 17) Common.broadcast(`<col=ef1020>Fighting starts in ${left} seconds - grab what you can!</col>`);
}

function startBracket() {
  if (state.phase !== "battle") return;
  state.phase = "bracket";
  state.clock = 0;
  Common.broadcast(`<col=ef1020>${state.alive.size} remain! The Deadman Tournament moves to the arena for the 1v1 bracket.</col>`);
  Common.log(`bracket start: ${state.alive.size} alive`);
  State.run("bracket");
}

/** The last one standing: the results, then (shortly) everyone's things back and the shutdown. */
function finish(winner) {
  if (state.phase === "done" || state.phase === "idle") return;
  state.phase = "done";
  state.clock = 0;
  state.winner = winner ?? null;
  const name = winner?.getUsername?.() ?? "Nobody";
  Common.broadcast(`<col=ef1020>${name} has won the Deadman Tournament with ${state.kills.get(winner) ?? 0} kills!</col>`);
  Common.log(`winner: ${name} (${state.kills.get(winner) ?? 0} kills)`);
  celebrate(winner);
  State.run("end", winner);
  // After the fireworks: everyone's things back and the world back to normal (bots gone, the
  // Wilderness's own bots back) - no restart. The champion stays on in the waiting room.
  // (shutdownOnEnd true in the world config shuts the server down instead, as it used to.)
  Common.later(Common.data.bracket.shutdownAfterTicks, () => {
    cleanUp();
    if (Common.config(Common.CONFIG.shutdownOnEnd, false) === true) {
      Common.broadcast("<col=ef1020>The server is shutting down: thanks for playing the Deadman Tournament!</col>");
      Common.log("shutting down");
      Common.later(5, () => process.emit("SIGINT"));
      return;
    }
    // Then a restart, so the world's own bots (Wilderness, skilling, GE...) all load back up.
    Common.broadcast("<col=ef1020>The Deadman Tournament is over - thanks for playing! The server restarts in 10 seconds.</col>");
    Common.log("over: restarting");
    Common.later(RESTART_DELAY_TICKS, restartServer);
  });
}

// The restart: touching data/restart-trigger.json makes nodemon do its graceful restart (saves
// everyone, then boots); with no watcher, the core's graceful shutdown instead.
const RESTART_DELAY_TICKS = 17;
function restartServer() {
  try {
    const fs = require("fs");
    const path = require("path");
    fs.writeFileSync(path.join(process.cwd(), "data", "restart-trigger.json"), JSON.stringify({ restartedBy: "deadman-tournament", at: new Date().toISOString() }, null, 2));
    Common.log("restart triggered");
  } catch (error) {
    Common.log(`restart failed (${error?.message ?? error}): shutting down`);
    process.emit("SIGINT");
  }
}

/**
 * The finale: everyone still around (fighters, spectators) is brought out of the arena copies onto
 * the real Deadman arena round the winner, who stands in the middle under fireworks; the shutdown
 * timer shows for everyone.
 */
function celebrate(winner) {
  const { bracket } = Common.data;
  const [cx, cy] = bracket.holding.centre;
  const { Location, TemplatedInstanceArea, Graphic } = Common.core;
  const centre = new Location(cx, cy, bracket.holding.z);
  const out = (player) => {
    const area = player.getArea?.();
    if (area instanceof TemplatedInstanceArea) area.leave?.(player, false);
  };
  if (winner?.isRegistered?.()) {
    out(winner);
    winner.getCombat?.().reset?.();
    winner.moveTo(centre);
    Gear.heal(winner);
    winner.forceChat?.("GG! Deadman champion!");
  }
  for (const player of [...state.participants, ...state.spectators]) {
    if (player === winner || State.isBot(player) || !player.isRegistered?.()) continue;
    out(player);
    player.moveTo(new Location(cx + Common.randomInt(-6, 6), cy + Common.randomInt(-6, 6), bracket.holding.z));
  }
  const seconds = Math.round(bracket.shutdownAfterTicks * 0.6);
  if (Common.config(Common.CONFIG.shutdownOnEnd, false) === true) {
    for (const player of Common.realPlayers()) player.getPacketSender().sendSystemUpdate?.(seconds);
  }
  let ticks = 0;
  const champion = bracket.championChat ?? [];
  // Fireworks and the champion's chat right up to the restart (the clean-up and its 10 seconds too).
  const lasts = bracket.shutdownAfterTicks + RESTART_DELAY_TICKS;
  Common.every(() => {
    if (!winner?.isRegistered?.() || ++ticks > lasts) return false;
    if (State.isBot(winner) && champion.length && ticks % CHAMPION_CHAT_EVERY === 0) winner.forceChat?.(Common.pick(champion));
    if (ticks % FIREWORKS_EVERY !== 1) return true;
    try {
      // High priority: a bot's own graphics (prayer, a spec) don't replace it.
      const Priority = Common.core.Priority;
      winner.performGraphic(Priority?.HIGH != null ? new Graphic(FIREWORKS, Priority.HIGH) : new Graphic(FIREWORKS));
    } catch (error) {
      Common.log(`fireworks failed: ${error?.message ?? error}`);
      return false;
    }
    return true;
  });
}

/** Everyone's own things back, the tournament's marks off, the bots gone. */
function cleanUp() {
  for (const player of [...state.participants, ...state.spectators]) {
    if (!player?.isRegistered?.()) continue;
    // The champion stays on (a bot winner isn't logged out with the rest): in the waiting room,
    // the middle of the finale arena, until the restart.
    if (State.isBot(player) && player !== state.winner) {
      State.run("eliminated", player, null, null);
      continue;
    }
    if (State.isBot(player)) {
      const [cx, cy] = Common.data.bracket.holding.centre;
      player.getCombat().reset();
      player.setAttribute(Common.ATTRIBUTES.participant, null);
      player.moveTo(new Common.core.Location(cx, cy, Common.data.bracket.holding.z));
      continue;
    }
    closeHud(player);
    player.setAttribute(Common.ATTRIBUTES.participant, null);
    player.setAttribute(Common.ATTRIBUTES.style, null);
    player.setAttribute(Common.ATTRIBUTES.runes, null);
    player.setAttribute(Common.ATTRIBUTES.team, null);
    player.setAttribute("deadman-tournament:kit", null);
    Common.api.emitCustomEvent("deadman-tournament:released", { player });
    const combat = player.getCombat();
    combat.reset();
    combat.getHitQueue().clear();
    if (Stash.stashed(player)) Stash.restore(player);
    player.moveTo(lobbyTile());
  }
  pauseRegionalWilderness(PAUSE_KEY, false);
  setBotSpawnGate(PAUSE_KEY, null);
  State.reset();
}

function stop() {
  if (state.phase === "idle") return false;
  State.run("end", null);
  cleanUp();
  // A restart after, as at the end: the world's own bots (gamblers, skillers...) all load back up.
  Common.broadcast("<col=ef1020>The Deadman Tournament has been called off. The server restarts in 10 seconds.</col>");
  Common.later(RESTART_DELAY_TICKS, restartServer);
  return true;
}

// ---------------------------------------------------------------- eliminations

/**
 * Out of the tournament: a death (a killer or the fog) or a ::dmkill. The units do the rest -
 * the drop and key (Loot), the logout (Bots), the spectating (Spectate), the next duel (Bracket).
 */
function eliminate(victim, killer = null, how = "died") {
  if (!state.alive.has(victim)) return;
  state.alive.delete(victim);
  const reason = how === "died" ? (killer && killer !== victim ? "killed by a player" : "killed by an NPC or nothing") : how;
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  const where = victim.getLocation().clone();
  const left = state.alive.size;
  if (killer && killer !== victim && state.alive.has(killer)) {
    state.kills.set(killer, (state.kills.get(killer) ?? 0) + 1);
    State.run("kill", killer, victim);
  }
  State.run("eliminated", victim, killer, where);
  const by = killer && killer !== victim ? ` by ${killer.getUsername()}` : how === "fog" ? " by the fog" : "";
  Common.feed(`<col=ef1020>${victim.getUsername()}</col> has been eliminated${by}. ${left} remain.`);
  if (left <= 1) {
    finish([...state.alive][0] ?? killer ?? null);
    return;
  }
  if (state.phase === "battle" && left <= Common.data.bracket.at) startBracket();
}

/**
 * ::dmkill: `count` random bots killed outright (a lethal hit, so they die like anyone else and
 * despawn); one still standing a few ticks later is taken out anyway. Real players are spared.
 */
function killBots(count) {
  const { HitDamage, HitMask } = Common.core;
  const bots = Common.shuffle(State.aliveBots()).filter((bot) => !(state.phase === "bracket" && state.duelOf?.(bot)));
  const chosen = bots.slice(0, Math.max(0, Math.min(count, state.alive.size - 1)));
  for (const bot of chosen) {
    try {
      bot.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.max(1, bot.getHitpoints()), HitMask.RED)]);
    } catch (_error) {
      eliminate(bot, null, "removed");
      continue;
    }
    Common.later(6, () => {
      if (state.alive.has(bot)) eliminate(bot, null, "removed");
    });
  }
  return chosen.length;
}

/**
 * Every few ticks: a tournament bot that's out (or a dead body the death task left standing) is
 * logged out again, so nobody who died lingers in the world.
 */
/** The spawn gate: only names the tournament is spawning itself (Bots puts them in state.ownNames). */
function ownSpawnOnly(username) {
  return state.ownNames.has(username);
}

/** Bots that aren't the tournament's: logged out (the spawn gate keeps them from coming back). */
function sweepOtherBots() {
  let gone = 0;
  for (const player of Common.players()) {
    if (player.isPlayerBot?.() !== true || player.getAttribute?.(Common.ATTRIBUTES.bot) === true) continue;
    player.getForcedLogoutTimer?.().start?.(0);
    player.requestLogout?.();
    gone++;
  }
  if (gone) Common.log(`other bots logged out for the tournament: ${gone}`);
}

function sweepTheFallen() {
  if (state.clock % 50 === 0) sweepOtherBots();
  for (const player of Common.players()) {
    if (player.getAttribute?.(Common.ATTRIBUTES.bot) !== true || state.alive.has(player)) continue;
    player.getForcedLogoutTimer?.().start?.(0);
    player.requestLogout?.();
  }
}

/** ::dmskip: bots out until `bracket.at` are left, then the bracket. */
function skipToBracket() {
  if (state.phase === "lobby") startBattle();
  if (state.phase !== "battle") return false;
  const surplus = state.alive.size - Common.data.bracket.at;
  if (surplus > 0) killBots(surplus);
  if (state.phase === "battle") startBracket();
  return true;
}

// ---------------------------------------------------------------- the HUD (LMS's overlay)

function component(name) {
  return Common.core.CacheDefinitions.getComponentId(name);
}

function openHud(player) {
  const sender = player.getPacketSender();
  const atmosphere = component("toplevel_osrs_stretch:overlay_atmosphere");
  const overlay = Common.core.CacheDefinitions.getInterfaceId("br_overlay");
  if (atmosphere != null && overlay != null) sender.sendSubInterface(atmosphere, overlay, 1);
}

function closeHud(player) {
  const atmosphere = component("toplevel_osrs_stretch:overlay_atmosphere");
  if (atmosphere != null) player.getPacketSender().closeSubInterface(atmosphere);
  player.getPacketSender().sendEntityHintRemoval?.(false);
}

function text(player, name, value) {
  const id = component(name);
  if (id != null) player.getPacketSender().sendString(String(value), id);
}

function hud() {
  // In the lobby: who's in so far, of everyone expected (the bots wanted, plus the players in).
  const expected = state.botTarget + State.aliveReal().length;
  const survivors = state.phase === "lobby" ? `${state.alive.size} / ${expected}` : `${state.alive.size} / ${state.total}`;
  for (const player of [...state.participants, ...state.spectators]) {
    if (State.isBot(player) || !player.isRegistered?.()) continue;
    text(player, "br_overlay:survivor_count", survivors);
    text(player, "br_overlay:kill_count", String(state.kills.get(player) ?? 0));
    text(player, "br_overlay:fog_status", state.fogStatus?.(player) ?? (state.phase === "bracket" ? "Arena" : "Safe"));
  }
}

// ---------------------------------------------------------------- the tick

function measure() {
  const now = Date.now();
  if (lastTickAt) {
    const gap = now - lastTickAt;
    perf.samples++;
    perf.total += gap;
    perf.max = Math.max(perf.max, gap);
  }
  lastTickAt = now;
  if (perf.samples >= Common.data.perf.windowTicks) {
    state.perf = { average: Math.round(perf.total / perf.samples), max: perf.max };
    Common.log(`perf: tick average ${state.perf.average}ms, worst ${perf.max}ms; ${state.phase}, ${state.alive.size} alive (${State.aliveBots().length} bots), ${Common.players().length} online`);
    if (reasons.size) Common.log(`eliminations: ${[...reasons].map(([why, n]) => `${n} ${why}`).join(", ")}`);
    if (state.phase === "battle" || state.phase === "bracket") {
      // Switching shows as bots wielding a weapon of a style other than their kit's main one.
      const bots = State.aliveBots();
      const switched = bots.filter((bot) => {
        const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
        return weapon > 0 && Gear.weaponStyle(weapon) !== Gear.styleOf(bot);
      }).length;
      const stats = state.stats ?? {};
      // Running totals for the whole battle (the bracket's gear report shows them).
      state.totals = state.totals ?? {};
      for (const [name, value] of Object.entries(stats)) state.totals[name] = (state.totals[name] ?? 0) + value;
      Common.log(`bots: ${switched}/${bots.length} on a switch weapon right now; ${stats.pickups ?? 0} floor pickups, ${stats.upgrades ?? 0} upgrades worn, ${stats.chests ?? 0} chests opened, ${stats.unstuck ?? 0} nudged out of standing still, ${stats["lone boss attacks"] ?? 0} lone bots on a boss, ${stats["boss give-ups"] ?? 0} gave up on a boss they couldn't hurt, ${stats["third-party attacks"] ?? 0} third-party attacks, ${stats["frozen switches"] ?? 0} switched off melee while frozen, ${stats["step-unders"] ?? 0} step-unders, ${stats["step-outs"] ?? 0} step-outs, ${stats["melee on a frozen foe"] ?? 0} melee on a frozen foe, ${stats["blocked melee switches"] ?? 0} switched off melee when blocked from a boss, ${stats["unreachable chests skipped"] ?? 0} unreachable chests skipped`);
      for (const sample of state.stuckSamples ?? []) Common.log(`standing still: ${sample}`);
      state.stuckSamples = [];
      state.stats = {};
    }
    reasons.clear();
    perf.samples = 0;
    perf.total = 0;
    perf.max = 0;
  }
}

function tick() {
  measure();
  if (state.phase === "idle") return;
  state.clock++;
  for (const player of [...state.alive]) {
    if (!player.isRegistered?.()) eliminate(player, null, "left");
  }
  if (state.phase === "lobby") lobbyTick();
  graceTick();
  if (state.clock % 5 === 0) sweepTheFallen();
  State.run("tick");
  if (state.phase !== "idle" && state.clock % HUD_EVERY === 0) hud();
}

// ---------------------------------------------------------------- the rules

function sameClan(a, b) {
  const clan = a.getAttribute(Common.ATTRIBUTES.team);
  return clan != null && clan === b.getAttribute(Common.ATTRIBUTES.team);
}

function canAttack(event) {
  if (state.phase === "idle") return;
  const a = Common.asPlayer(event.attacker);
  const t = Common.asPlayer(event.target);
  if ((a && state.spectators.has(a)) || (t && state.spectators.has(t))) {
    event.allow = false;
    return;
  }
  const inA = a && state.participants.has(a);
  const inT = t && state.participants.has(t);
  if (!inA && !inT) return;
  // Nothing fights in the lobby, or once it's over.
  if (state.phase === "lobby" || state.phase === "done") {
    event.allow = false;
    return;
  }
  if (!a || !t) return; // a participant and an NPC (a boss): the usual rules.
  if (inA !== inT || !state.alive.has(a) || !state.alive.has(t)) {
    event.allow = false;
    return;
  }
  if (state.phase === "bracket") {
    event.allow = state.fightRule ? state.fightRule(a, t) : false;
    return;
  }
  // A bot going for a boss starts no player fights (it hits back at whoever's on it).
  if (State.isBot(a) && require("./Bots.DeadmanTournament").bossBusy(a) && t.getCombat?.().getTarget?.() !== a) {
    event.allow = false;
    return;
  }
  // A bot in the fog is getting out, not fighting (players in the fog still can).
  if (State.isBot(a) && require("./Fog.DeadmanTournament").depthOf(a) > 0) {
    event.allow = false;
    return;
  }
  // The looting head start: nobody fights anybody yet.
  if (inGrace()) {
    event.allow = false;
    if (!State.isBot(a)) a.sendMessage?.("You can't fight yet - it's the looting head start.");
    return;
  }
  event.allow = !sameClan(a, t);
}

function canTeleport(event) {
  if (state.phase === "battle" || state.phase === "bracket") {
    if (state.alive.has(event.player)) event.allow = false;
  }
}

function noExperience(event) {
  if (state.phase !== "idle" && state.participants.has(event.player)) event.allow = false;
}

function keepItems(event) {
  if (state.alive.has(event.player)) event.shouldDrop = false;
}

function died(event) {
  const player = event.player;
  if (!state.alive.has(player)) return;
  event.handled = true;
  const killer = Common.asPlayer(event.killer) ?? Common.asPlayer(player.getCombat?.().getKiller?.(true));
  eliminate(player, killer, state.lastFogHit?.get?.(player) === state.clock ? "fog" : "died");
}

function login({ player }) {
  // Only people: the world's other bots log in all the time, and the tournament's own are entered as they spawn.
  if (!player || player.isPlayerBot?.() === true) return;
  // Saved inside an arena copy that's gone (a restart mid-bracket): those tiles (x past 6400) are
  // no real map, so the login is a black screen. Off to Edgeville.
  const at = player.getLocation?.();
  if (at && at.getX() > 6400) {
    const [x, y, z] = Common.data.lobby.tile;
    player.moveTo(new Common.core.Location(x, y, z));
    Common.log(`login: ${player.getUsername()} was in a gone arena copy (${at.getX()},${at.getY()}); moved to the lobby`);
  }
  if (state.phase === "lobby") Common.later(2, () => enterLobby(player));
  else if (state.phase === "battle" || state.phase === "bracket") {
    Common.later(2, () => Common.api.emitCustomEvent("deadman-tournament:spectate", { player, joined: true }));
  }
}

function serverStarted() {
  // One task for the whole tournament; idle it only times the ticks (the load test).
  Common.every(tick);
  if (!enabled()) return;
  Common.checkItems();
  if (Common.config(Common.CONFIG.autoStart, true) !== true) return;
  Common.later(Common.data.lobby.startDelayTicks, () => openLobby());
}

function attachTournament(api) {
  api.onServerStartup(serverStarted);
  api.onCanAttack(canAttack);
  api.onCanTeleport(canTeleport);
  api.onCanGainExperience(noExperience);
  api.onShouldDropItemsOnDeath(keepItems);
  api.onPlayerDeath(died);
  api.onPlayerLogin(login);
}

module.exports = {
  attachTournament,
  openLobby,
  startBattle,
  startBracket,
  finish,
  stop,
  eliminate,
  killBots,
  skipToBracket,
  randomWildernessTile,
  excluded,
  lobbyTile,
  tileNear,
  inGrace,
  openHud,
  closeHud,
  sameClan,
  enabled,
};
