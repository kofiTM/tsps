/**
 * Deadman Tournament bots (world config `DeadmanTournament:botCount`, ::dmbots): spawned a few a
 * tick across the Wilderness during the lobby, frozen in their starter kit until the start; then
 * they fight on the PlayerBots runtime's PvP brain (specs, switches, prayers, eating), as Last Man
 * Standing's do. This unit decides what they go after between fights, in order:
 *   1. caught in the fog: back towards the safe zone;
 *   2. their clan has decided to take a boss (Clans): straight to the boss and on it;
 *   3. a key in the pack: the nearest loot chest;
 *   4. something good on the floor nearby (an upgrade, a supply with room for it, a rune they
 *      use, a key): walk onto it and take it - an upgrade is worn and the old piece deleted;
 *   5. the nearest fighter who isn't a clanmate and isn't busy with someone else;
 *   6. otherwise drift towards the middle of the safe zone.
 * They never retreat or teleport out, keep only what they find (`player-bots:fixed-loadout`: no
 * free re-gear, no floor clean-up), and log out once they're eliminated.
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");
const Gear = require("./Gear.DeadmanTournament");
const Fog = require("./Fog.DeadmanTournament");
const Loot = require("./Loot.DeadmanTournament");
const Clans = require("./Clans.DeadmanTournament");
const { getActiveBotRuntime } = require("../../bots/runtime/RuntimeRegistry.PlayerBots");
const { startActivity } = require("../../bots/brain/BrainActivities.PlayerBots");
const { setModePvp } = require("../../bots/behaviours/state/State.PlayerBots");
const { requestMovement } = require("../../bots/behaviours/navigation/Navigation.PlayerBots");

const WALK_REASON = "deadman_tournament";

const { state } = State;
const PVP_ACTIVITY = "pvp";
const DECIDE_EVERY = 3;
const HOLD_MS = 2 * 60 * 1000;
const LOOT_RANGE = 8;
const SEEK_RANGE = 40;
const ENGAGE_DISTANCE = 12;
const STEP = 20;
const BOSS_REACH = 6;
/** How near a clanmate has to be for a bot to come to their help. */
const PROTECT_RANGE = 20;
/** How far from the group a clan member will go for a chest (the leader picks the rest). */
const MEMBER_CHEST_RANGE = 6;
/** An opponent further than this isn't a fight any more. */
const FIGHT_REACH = 16;
/** Standing still this many ticks out of a fight: the bot is nudged back into motion. */
const STUCK_TICKS = 15;
const lastSeen = new WeakMap();
const SKILL_ATTRIBUTE = "deadman-tournament:skill";
const SKILL_TIERS = { novice: 1, standard: 2, veteran: 3, elite: 4 };
const NAMES = ["Rex", "Grim", "Ash", "Vex", "Skull", "Blade", "Fang", "Raze", "Dusk", "Hex", "Kane", "Lux", "Nyx", "Onyx", "Pyre", "Rune", "Shade", "Thorn", "Volt", "Wolf"];
let serial = 0;
const order = new WeakMap();

function stateOf(bot) {
  return getActiveBotRuntime().runtime?.botStatesByName?.get(bot.getUsername()) ?? null;
}

function botName() {
  serial++;
  return `${NAMES[serial % NAMES.length]} DM${serial}`.slice(0, 12);
}

function isOwnSpawn(username) {
  return state.ownNames.has(username);
}

function spawnBot() {
  const { runtime, behaviorMode } = getActiveBotRuntime();
  if (!runtime) return null;
  const Tournament = require("./Tournament.DeadmanTournament");
  // Everyone waits together at the lobby (so a player can recruit a clan there); the start
  // scatters them over the Wilderness.
  const at = Tournament.lobbyTile(Common.data.lobby.botSpread);
  const username = botName();
  state.ownNames.add(username);
  const bot = runtime.spawnPvpBot(at, { username, mode: behaviorMode.PVP });
  if (!bot) return null;
  bot.setAttribute(Common.ATTRIBUTES.bot, true);
  bot.setAttribute(Common.ATTRIBUTES.participant, true);
  bot.setAttribute(Common.ATTRIBUTES.fixedLoadout, true);
  bot.setAttribute(Common.ATTRIBUTES.protectionPrayers, true);
  // Never spec with the magic shortbow (a waste): the bot runtime skips these for specs.
  bot.setAttribute("player-bots:banned-specs", [...Gear.BANNED_SPECS]);
  makeMale(bot);
  // Its fight chatter is Deadman's (PvpChatter reads this list in place of its own).
  if (Array.isArray(Common.data.fightChat)) bot.setAttribute("player-bots:chatter-lines", Common.data.fightChat);
  Gear.equipKit(bot);
  order.set(bot, serial);
  state.participants.add(bot);
  state.alive.add(bot);
  state.kills.set(bot, 0);
  return bot;
}

/** Lobby: a few bots a tick until there are enough (they wait where they'll start, frozen). */
function spawnSome() {
  if (state.phase !== "lobby") return;
  const perTick = Common.data.lobby.botsPerTick;
  for (let i = 0; i < perTick && state.botsSpawned < state.botTarget; i++) {
    state.botsSpawned++;
    if (!spawnBot()) Common.log("a bot failed to spawn");
  }
}

function alive(mobile) {
  return Common.alive(mobile);
}

/** In a fight that's really on: a live opponent within reach (one far off or dead is let go). */
function fighting(bot) {
  const combat = bot.getCombat();
  const here = bot.getLocation();
  let on = false;
  for (const other of [combat.getTarget?.(), combat.getAttacker?.()]) {
    if (!alive(other)) continue;
    if (other.getLocation().getZ() === here.getZ() && Common.distance(here, other.getLocation()) <= FIGHT_REACH) on = true;
  }
  if (!on && combat.getTarget?.()) combat.reset?.();
  return on;
}

function engagedElsewhere(other, bot) {
  const combat = other.getCombat();
  return [combat.getTarget?.(), combat.getAttacker?.()].some((mobile) => mobile && mobile !== bot && alive(mobile));
}

/**
 * A walk `step` tiles towards (x, y), to a tile that can be stood on. It goes through the bot
 * runtime's own movement requests (as BotLooting's loot walks do), so the PvP brain's seeking
 * doesn't cancel it the next tick - a walk set straight on the path finder was wiped, and bots
 * stood still; the path finder is the fallback.
 */
function walkToward(bot, x, y, step = STEP, run = true) {
  const from = bot.getLocation();
  const dx = x - from.getX();
  const dy = y - from.getY();
  const scale = Math.min(1, step / Math.max(Math.abs(dx), Math.abs(dy), 1));
  let tx = from.getX() + Math.round(dx * scale);
  let ty = from.getY() + Math.round(dy * scale);
  for (let i = 0; i < 6 && !Common.standable(tx, ty, from.getZ()); i++) {
    tx += Common.randomInt(-2, 2);
    ty += Common.randomInt(-2, 2);
  }
  bot.setRunning?.(run);
  // The lobby has no brain running to carry a request out (and the runtime keeps PvP bots'
  // requests in the Wilderness): there the path finder walks them directly.
  if (state.phase === "battle") try {
    const requested = requestMovement(bot, tx, ty, { z: from.getZ(), state: stateOf(bot), nowMs: Date.now(), reason: WALK_REASON });
    if (requested !== false) return;
  } catch (_error) {
    // Fall back to the path finder below.
  }
  try {
    Common.core.PathFinder.calculateWalkRoute(bot, tx, ty);
  } catch (_error) {
    // No route this time; the next decision tries again.
  }
}

/**
 * A bot keeps its quarry (no running back and forth between two): the one it's after stays while
 * alive, in range and still being closed on; a new one only when it's much nearer (QUARRY_SWITCH
 * of the distance) or the chase has gone QUARRY_STALE_TICKS without getting any closer.
 */
const QUARRY_SWITCH = 0.5;
const QUARRY_STALE_TICKS = 25;
const chases = new WeakMap();

function quarryOf(bot) {
  const nearest = nearestQuarry(bot);
  const chase = chases.get(bot);
  const here = bot.getLocation();
  if (chase && alive(chase.target) && state.alive.has(chase.target)) {
    const d = Common.distance(here, chase.target.getLocation());
    if (d <= SEEK_RANGE) {
      if (d < chase.best) {
        chase.best = d;
        chase.closedAt = state.clock;
      }
      const stale = state.clock - chase.closedAt > QUARRY_STALE_TICKS;
      const muchNearer = nearest && nearest !== chase.target && Common.distance(here, nearest.getLocation()) <= d * QUARRY_SWITCH;
      if (!stale && !muchNearer) return chase.target;
    }
  }
  if (nearest) chases.set(bot, { target: nearest, best: Common.distance(here, nearest.getLocation()), closedAt: state.clock });
  else chases.delete(bot);
  return nearest;
}

function nearestQuarry(bot) {
  const Tournament = require("./Tournament.DeadmanTournament");
  let best = null;
  let bestDistance = SEEK_RANGE + 1;
  const here = bot.getLocation();
  for (const other of state.alive) {
    if (other === bot || !alive(other) || Tournament.sameClan(bot, other)) continue;
    const d = Common.distance(here, other.getLocation());
    // All of the Wilderness is multi-combat in the tournament: someone already fighting is fair game.
    if (d >= bestDistance) continue;
    best = other;
    bestDistance = d;
  }
  return best;
}

/**
 * Onto `quarry`: the PvP brain is pointed at them (its specs, switches and eating), and the core
 * combat is told to attack straight away too - the brain alone can sit on a target without ever
 * swinging (a bot then just stands there).
 */
function hunt(bot, quarry, nowMs) {
  // Onto a player now, not a boss: the PvP brain back in charge (holdPvp).
  bossBusyAt.delete(bot);
  holdPvp(bot, false);
  applySkill(bot);
  const botState = stateOf(bot);
  readyWeapon(bot);
  if (botState?.pvp && (botState.pvp.targetPlayer !== quarry || botState.pvp.targetUsername !== quarry.getUsername())) {
    try {
      setModePvp(bot, botState, quarry, nowMs, HOLD_MS, getActiveBotRuntime().behaviorMode, { allowInCombatTransition: true });
    } catch (_error) {
      // The core attack below still goes ahead.
    }
  }
  if (bot.getCombat().getTarget?.() !== quarry) bot.getCombat().attack(quarry);
  if (Common.distance(bot.getLocation(), quarry.getLocation()) > ENGAGE_DISTANCE) {
    walkToward(bot, quarry.getLocation().getX(), quarry.getLocation().getY());
  }
}

/** Who's attacking a clanmate (or being attacked by them) near `bot`: the one to jump on. */
function clanThreat(bot) {
  const Tournament = require("./Tournament.DeadmanTournament");
  const clan = Clans.clanOf(bot);
  if (!clan) return null;
  // The leader first: a player's recruits drop everything for them.
  const members = clan.leader ? [clan.leader, ...clan.members] : [...clan.members];
  for (const member of members) {
    if (member === bot || !state.alive.has(member)) continue;
    if (Common.distance(bot.getLocation(), member.getLocation()) > PROTECT_RANGE) continue;
    const combat = member.getCombat();
    for (const foe of [combat.getAttacker?.(), combat.getTarget?.()]) {
      const enemy = Common.asPlayer(foe);
      if (enemy && enemy !== bot && state.alive.has(enemy) && alive(enemy) && !Tournament.sameClan(bot, enemy)) return enemy;
    }
  }
  return null;
}

/** Every tick: clanmates under attack get help straight away, even mid-fight for a leader. */
function protect(bot, nowMs) {
  const threat = clanThreat(bot);
  if (!threat) return false;
  const current = bot.getCombat().getTarget?.();
  const leaderAttacked = Clans.leaderOf(bot) && Clans.leaderOf(bot).getCombat().getAttacker?.() === threat;
  if (current === threat || (fighting(bot) && !leaderAttacked)) return false;
  hunt(bot, threat, nowMs);
  return true;
}

/**
 * Caught in the fog: out of it before anything else - any fight is dropped and the bot runs for
 * the safe zone (a fresh walk every 3 ticks, so the brain can't hold it in place).
 */
/**
 * In the fog, getting out beats everything: every tick any fight is dropped (a bot in the fog can't
 * attack anyone either - Tournament.canAttack - so the PvP brain has nothing to start), and the bot
 * keeps walking for the safe zone, the walk renewed whenever it stops.
 */
function escapeFog(bot) {
  if (!state.fog || Fog.depthOf(bot) <= 0) return false;
  const combat = bot.getCombat();
  if (combat.getTarget?.()) combat.reset?.();
  dropPvpTarget(bot);
  const decide = ((order.get(bot) ?? 0) + state.clock) % DECIDE_EVERY === 0;
  if (decide || bot.getMovementQueue().size() === 0) walkToward(bot, state.fog.cx, state.fog.cy);
  return true;
}

/**
 * The PvP brain keeps its opponent by name as well as by reference (it looks the name up again), so
 * both go: otherwise it puts the bot straight back on that player, dropping a boss attack.
 */
function dropPvpTarget(bot) {
  const pvp = stateOf(bot)?.pvp;
  if (!pvp) return;
  pvp.targetPlayer = null;
  pvp.targetUsername = null;
}

/**
 * Bosses a bot can't hurt: next to one for GIVE_UP_TICKS with its hitpoints never moving (it can't
 * be damaged, or nothing lands), the bot leaves it for GIVE_UP_FOR ticks and gets on with chests
 * and loot - so a boss nobody can hurt never freezes a crowd round it.
 */
const GIVE_UP_TICKS = 50;
const GIVE_UP_FOR = 100;
const bossWatch = new WeakMap();

function gaveUpOn(bot, boss) {
  const watch = bossWatch.get(bot);
  return Boolean(watch && watch.boss === boss && watch.until && state.clock < watch.until);
}

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

/** Bots that gave up on each boss (the first one logs why; Bosses moves or retires a boss nobody hurts). */
const givenUp = new WeakMap();

function gaveUp(bot, boss) {
  const bots = givenUp.get(boss) ?? new Set();
  givenUp.set(boss, bots);
  if (bots.size === 0) {
    // Why nothing lands, once per boss: how far, what the bot is on, the core's answer to an attack.
    let verdict = "?";
    try {
      const { CombatFactory } = Common.core;
      const { CanAttackResponse } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
      const { CombatRange } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatRange");
      const method = CombatFactory.getMethod(bot);
      const answer = CombatFactory.canAttack(bot, method, boss);
      let reach = "?";
      try {
        reach = CombatRange.canReach(bot, method, boss) ? "in reach" : "OUT OF REACH";
      } catch (error) {
        reach = `reach threw ${error?.message ?? error}`;
      }
      verdict = `${method?.constructor?.name ?? "?"} ${CanAttackResponse?.[answer] ?? answer}${CombatFactory.validTarget(bot, boss) ? "" : ` (invalid: ${invalidWhy(bot, boss)})`}, ${reach}, boss at ${boss.getLocation().getX()},${boss.getLocation().getY()} size ${boss.getSize?.() ?? "?"}, bot at ${bot.getLocation().getX()},${bot.getLocation().getY()}`;
    } catch (error) {
      verdict = `threw ${error?.message ?? error}`;
    }
    const target = bot.getCombat().getTarget?.();
    const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
    Common.log(`can't hurt ${boss.getDefinition?.()?.getName?.()} (hp ${boss.getHitpoints?.()}): ${bot.getUsername()} ${Common.distance(bot.getLocation(), boss.getLocation())} tiles off, target ${target ? (target === boss ? "the boss" : target.getUsername?.() ?? target.getDefinition?.()?.getName?.() ?? "other") : "none"}, weapon ${weapon > 0 ? Common.itemName(weapon) : "none"}, spell ${bossSpell(bot)?.spellId?.() ?? "none"}, autocast ${bot.getCombat().getAutocastSpell?.()?.spellId?.() ?? "none"}, can attack: ${verdict}`);
  }
  bots.add(bot);
}

/** A boss the bot gave up on that's on it: the bot walks off, away from it (standing there, it dies). */
function fleeBoss(bot) {
  const attacker = bot.getCombat().getAttacker?.();
  if (!attacker || attacker.isPlayer?.() || !alive(attacker) || !gaveUpOn(bot, attacker)) return false;
  bot.getCombat().reset?.();
  const here = bot.getLocation();
  const there = attacker.getLocation();
  const dx = Math.sign(here.getX() - there.getX()) || 1;
  const dy = Math.sign(here.getY() - there.getY()) || 1;
  walkToward(bot, here.getX() + dx * 12, here.getY() + dy * 12);
  return true;
}

/**
 * Bots going for a boss: while busy with one (BOSS_BUSY_TICKS since they last went for it) they
 * start no fights with players (Tournament.canAttack) - the PvP brain would pull them off it - but
 * still hit back at whoever attacks them.
 */
const BOSS_BUSY_TICKS = 10;
const bossBusyAt = new WeakMap();

function bossBusy(bot) {
  return state.clock - (bossBusyAt.get(bot) ?? -Infinity) <= BOSS_BUSY_TICKS;
}

/**
 * The PvP brain held while a bot is busy with a boss (`player-bots:hold-pvp`, the PvpCombat action's
 * switch). Left running, the brain sees no player target (dropPvpTarget) and resets the bot's combat -
 * its boss attack - every time it runs, which is every cycle once a real player is near (a spectator
 * too: the runtime's level of detail), so bots stood at bosses doing nothing. Never held while a player
 * is attacking the bot: the brain fights them back as before.
 */
function holdPvp(bot, on) {
  const attacker = bot.getCombat?.().getAttacker?.();
  const hold = on && !(attacker?.isPlayer?.() && alive(attacker));
  if ((bot.getAttribute(Common.ATTRIBUTES.holdPvp) === true) !== hold) bot.setAttribute(Common.ATTRIBUTES.holdPvp, hold ? true : null);
}

/** Tiles between the bot and the nearest tile of the boss's body (a boss covers size x size tiles). */
function bossGap(bot, boss) {
  const here = bot.getLocation();
  const at = boss.getLocation();
  const size = Math.max(1, boss.getSize?.() ?? boss.getDefinition?.()?.getSize?.() ?? 1);
  const dx = Math.max(0, at.getX() - here.getX(), here.getX() - (at.getX() + size - 1));
  const dy = Math.max(0, at.getY() - here.getY(), here.getY() - (at.getY() + size - 1));
  return Math.max(dx, dy);
}

function meleeWeapon(bot) {
  const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  return weapon <= 0 || Gear.weaponStyle(weapon) === "melee";
}

/** Melee bots closing on a boss: how near they've got, and since when (no closer for BLOCKED_TICKS: blocked). */
const BLOCKED_TICKS = 8;
const approaches = new WeakMap();

/** Walks to `boss` and attacks it; true while the bot is busy with it. */
function goForBoss(bot, boss) {
  if (!boss || !alive(boss)) return false;
  // A shielded boss (Vet'ion behind his hellhounds): the shield first.
  const shield = require("./Bosses.DeadmanTournament").shieldOf(boss);
  if (shield) boss = shield;
  if (gaveUpOn(bot, boss)) return false;
  bossBusyAt.set(bot, state.clock);
  holdPvp(bot, true);
  dropPvpTarget(bot);
  // Melee has to stand next to the boss's body (bots don't close in by themselves); ranged and magic
  // only need to be within BOSS_REACH.
  const gap = bossGap(bot, boss);
  // Melee that can't get any closer (lava, a fence, a crowd in the way): ranged or magic instead,
  // from where it stands.
  if (meleeWeapon(bot) && gap > 1) {
    const approach = approaches.get(bot);
    if (!approach || approach.boss !== boss || gap < approach.gap) {
      approaches.set(bot, { boss, gap, since: state.clock });
    } else if (state.clock - approach.since >= BLOCKED_TICKS && gap <= BOSS_REACH + 4) {
      const switched = switchWeapon(bot, ["ranged"]) ?? (switchWeapon(bot, ["magic"]) && bossSpell(bot) ? "magic" : null);
      approaches.delete(bot);
      if (switched) count("blocked melee switches");
    }
  }
  if (gap > (meleeWeapon(bot) ? 1 : BOSS_REACH)) {
    // Close but not touching (a crowd round it): attack as well, so the core's combat steps it in.
    if (gap <= BOSS_REACH) attackBoss(bot, boss);
    walkToward(bot, boss.getLocation().getX(), boss.getLocation().getY());
    return true;
  }
  let watch = bossWatch.get(bot);
  if (!attackBoss(bot, boss)) {
    // No weapon that can hurt it: leave it straight away.
    bossWatch.set(bot, { boss, hp: boss.getHitpoints?.(), since: state.clock, until: state.clock + GIVE_UP_FOR });
    count("boss give-ups");
    return false;
  }
  watch = bossWatch.get(bot);
  if (!watch || watch.boss !== boss) {
    watch = { boss, hp: boss.getHitpoints?.(), since: state.clock, until: 0 };
    bossWatch.set(bot, watch);
  } else if (boss.getHitpoints?.() !== watch.hp) {
    watch.hp = boss.getHitpoints?.();
    watch.since = state.clock;
  } else if (state.clock - watch.since >= GIVE_UP_TICKS) {
    watch.until = state.clock + GIVE_UP_FOR;
    count("boss give-ups");
    gaveUp(bot, boss);
    return false;
  }
  return true;
}

/** What each bot last decided (for the log's boss report). */
const lastStep = new WeakMap();
function why(bot, step) {
  lastStep.set(bot, step);
}
function stepOf(bot) {
  return lastStep.get(bot) ?? "nothing yet";
}

function act(bot, nowMs) {
  if (alive(bot) && fleeBoss(bot)) return why(bot, "fleeing a boss it gave up on");
  // A boss or a boss's guard on the bot (one it hasn't given up on): it fights back (the PvP brain
  // only fights players).
  const attacker = bot.getCombat().getAttacker?.();
  if (alive(bot) && attacker && !attacker.isPlayer?.() && require("./Bosses.DeadmanTournament").isOurs(attacker)
    && bot.getCombat().getTarget?.() !== attacker && goForBoss(bot, attacker)) return why(bot, "fighting back a boss");
  if (!alive(bot)) return;
  // Mid-fight, an upgrade on the floor close by is still grabbed (as many upgrades as possible
  // reach the finals): taken from under its feet, or a few steps over to it.
  if (fighting(bot)) {
    // An upgrade close by first: it drops the fight, runs over and takes it.
    if (startGrab(bot)) return why(bot, "grabbing an upgrade mid-fight");
    unfreezeStyle(bot, bot.getCombat().getTarget?.());
    return why(bot, "in a fight");
  }
  const here = bot.getLocation();
  // 1. Out of the fog first.
  if (state.fog && Fog.depthOf(bot) > 0) {
    walkToward(bot, state.fog.cx, state.fog.cy);
    return why(bot, "out of the fog");
  }
  // 2. The clan's boss, once it's chosen one: every member straight to it and on it (no detours for
  // chests or floor loot, no waiting on the leader); the drop lands right there for after.
  // 1b. Loot right at its feet (a chest it just opened, a kill) comes before bosses, keys and the
  // clan: take everything it can use from the pile before moving on.
  const atFeet = Loot.lootNear(bot, AT_FEET);
  if (atFeet) {
    if (Common.distance(here, atFeet.getPosition()) > 1) {
      walkToward(bot, atFeet.getPosition().getX(), atFeet.getPosition().getY(), AT_FEET + 1);
      return why(bot, "loot at its feet");
    }
    // A pickup that fails falls through to the rest (never stuck on one item).
    if (Loot.take(bot, atFeet)) {
      count("pickups");
      return why(bot, "loot at its feet");
    }
  }
  let clanBoss = Clans.bossFor(bot);
  // A boss right here is piled on by everyone, clan or not, unless their clan's own boss is nearer.
  const nearBoss = loneBoss(bot, NEAR_BOSS);
  if (nearBoss && (!clanBoss || Common.distance(here, nearBoss.getLocation()) < Common.distance(here, clanBoss.getLocation()))) {
    if (goForBoss(bot, nearBoss)) return why(bot, "boss close by");
  }
  // A third party: the boss's attackers first, one at a time (the nearest), then the boss itself.
  if (clanBoss && alive(clanBoss) && Clans.planFor(bot) === "third-party" && !require("./Tournament.DeadmanTournament").inGrace()) {
    const prey = Clans.bossAttackers(clanBoss, Clans.clanOf(bot))
      .filter((p) => Common.distance(p.getLocation(), clanBoss.getLocation()) <= 25)
      .sort((p, q) => Common.distance(here, p.getLocation()) - Common.distance(here, q.getLocation()))[0];
    if (prey) {
      count("third-party attacks");
      bossBusyAt.delete(bot);
      hunt(bot, prey, nowMs);
      return why(bot, "third party");
    }
  }
  if (goForBoss(bot, clanBoss)) return why(bot, "clan boss");
  // 2b. A lone bot near a boss piles on it, alongside whoever else is on it (loners or a clan).
  if (!Clans.clanOf(bot)) {
    const target = loneBoss(bot);
    if (target && bot.getCombat().getTarget?.() !== target && Common.distance(here, target.getLocation()) <= BOSS_REACH) count("lone boss attacks");
    if (goForBoss(bot, target)) return why(bot, "lone boss");
  }
  // 3. A key: straight to the nearest chest, however far (the clan follows its first
  // member, and that member leads to a chest when any of them carries a key).
  const clan = Clans.clanOf(bot);
  const anchor = Clans.anchorOf(bot);
  const leadsClan = clan && !anchor;
  const keyHere = Loot.hasKey(bot) || (leadsClan && [...clan.members].some((m) => m !== bot && state.alive.has(m) && Loot.hasKey(m)));
  // Clans stay together: only someone with no one to follow (a clan's leader, or a bot alone)
  // picks a chest anywhere and goes; a member only opens one within a few tiles of the group.
  if (keyHere && (!anchor || Common.distance(here, anchor.getLocation()) <= 10)) {
    const chest = Loot.nearestChest(bot, anchor ? MEMBER_CHEST_RANGE : Infinity, (c) => skippingChest(bot, c));
    if (chest) noteChestProgress(bot, chest);
    if (anchor && !chest) {
      // Nothing near the group: keep with the leader (below).
    } else if (chest) {
      if (Common.distance(here, chest.getLocation()) <= 2) {
        if (Loot.hasKey(bot) && Loot.open(bot, chest)) count("chests");
      } else {
        // To a tile beside it (the chest's own tile is blocked, so no route ends on it).
        walkToward(bot, chest.getLocation().getX() + Common.pick([-1, 1]), chest.getLocation().getY() + Common.pick([-1, 0, 1]));
      }
      if (Loot.hasKey(bot) || Common.distance(here, chest.getLocation()) > 2) return why(bot, "chest");
    }
  }
  // Clans move as one: a recruit keeps to its leader, a bot clan to its first member alive.
  const leash = Clans.leaderOf(bot) ? 5 : 10;
  if (anchor && Common.distance(here, anchor.getLocation()) > leash) {
    walkToward(bot, anchor.getLocation().getX(), anchor.getLocation().getY());
    return why(bot, "keeping with the clan");
  }
  // 4. Loot nearby (not wandering off from the clan for it).
  const loot = Loot.lootNear(bot, anchor ? Math.min(LOOT_RANGE, leash) : LOOT_RANGE);
  if (loot) {
    if (Common.distance(here, loot.getPosition()) <= 1 && Loot.take(bot, loot)) {
      count("pickups");
      return why(bot, "floor loot");
    }
    walkToward(bot, loot.getPosition().getX(), loot.getPosition().getY(), LOOT_RANGE + 1);
    return why(bot, "floor loot");
  }
  // 5. Someone to fight (not during the looting head start).
  const quarry = require("./Tournament.DeadmanTournament").inGrace() ? null : quarryOf(bot);
  if (quarry) {
    hunt(bot, quarry, nowMs);
    return why(bot, "hunting");
  }
  // 6. Towards the middle.
  why(bot, "drifting to the middle");
  if (state.fog && bot.getMovementQueue().size() === 0) {
    const r = Math.max(3, Math.round(state.fog.radius / 2));
    walkToward(bot, state.fog.cx + Common.randomInt(-r, r), state.fog.cy + Common.randomInt(-r, r));
  }
}

/**
 * The lobby: bots mill about Edgeville and talk Deadman while they wait; any that stray past the
 * lobby (the bot brain wanders) are walked back.
 */
function mingle() {
  const { tile: [lx, ly], botSpread, chat } = Common.data.lobby;
  const bots = [...state.alive].filter(State.isBot);
  if (bots.length === 0) return;
  // Once every bot is in, the clans form, so they can be seen walking about together.
  if (state.botsSpawned >= state.botTarget) Clans.form();
  // Clan members keep to their leader (a player, or the clan's first member): within 3 tiles.
  for (const bot of bots) {
    const anchor = Clans.anchorOf(bot);
    if (!anchor || (bot.getMovementQueue().size() > 0 && ((order.get(bot) ?? 0) + state.clock) % 4 !== 0)) continue;
    if (Common.distance(bot.getLocation(), anchor.getLocation()) > 3) {
      walkToward(bot, anchor.getLocation().getX() + Common.randomInt(-1, 1), anchor.getLocation().getY() + Common.randomInt(-1, 1), 12, false);
    }
  }
  // Everyone else (and the clans' leaders, taking their clans along) strolls about Edgeville.
  for (let i = 0; i < Math.min(bots.length, 25); i++) {
    const bot = Common.pick(bots);
    if (Clans.anchorOf(bot) || bot.getMovementQueue().size() > 0) continue;
    walkToward(bot, lx + Common.randomInt(-botSpread, botSpread), ly + Common.randomInt(-botSpread, botSpread), 8, false);
  }
  if (Math.random() < 0.6) Common.pick(bots).forceChat?.(Common.pick(chat));
  // Strays (the bot brain wanders) are put back.
  if (state.clock % 5 === 0) {
    for (const bot of bots) {
      const d = Common.distance(bot.getLocation(), { x: lx, y: ly });
      if (d > botSpread + 12 || bot.getLocation().getZ() !== 0) bot.moveTo(require("./Tournament.DeadmanTournament").lobbyTile(botSpread));
    }
  }
}

/** The Obligator on Smash, its 3-tick style (Thrust is 5 ticks): set whenever a bot wields one. */
const OBLIGATOR_IDS = new Set([34715, 34716, 34717, 34718]);
const SMASH_INDEX = 2;

function smashStyle(bot) {
  try {
    const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
    if (!OBLIGATOR_IDS.has(weapon)) return;
    const smash = Common.core.WeaponInterfaces.EXTENDING_CHAINMACE?.getFightType?.()?.[SMASH_INDEX];
    if (smash && bot.getFightType?.() !== smash) bot.setFightType(smash);
  } catch (_error) {
    // No chainmace interface in this cache: leave its style be.
  }
}

function tick() {
  if (state.phase === "lobby") {
    spawnSome();
    mingle();
    return;
  }
  if (state.phase === "bracket") {
    for (const bot of state.alive) {
      if (!State.isBot(bot)) continue;
      holdPvp(bot, false);
      smashStyle(bot);
    }
    return;
  }
  if (state.phase !== "battle") return;
  if (state.clock % RESCUE_EVERY === 0) rescue();
  const nowMs = Date.now();
  for (const bot of state.alive) {
    if (!State.isBot(bot)) continue;
    try {
      // Off again once the bot's done with its boss (or a player is on it).
      holdPvp(bot, alive(bot) && bossBusy(bot));
      smashStyle(bot);
      if (alive(bot) && state.clock % 5 === 0) unstick(bot);
      if (alive(bot) && escapeFog(bot)) continue;
      if (alive(bot) && grabUpgrade(bot)) continue;
      // Mid-fight, an upgrade nearby is looked for every few ticks, not only on its decisions.
      if (alive(bot) && state.clock % 3 === 0 && fighting(bot) && startGrab(bot)) continue;
      if (alive(bot) && !require("./Tournament.DeadmanTournament").inGrace() && protect(bot, nowMs)) continue;
      if (((order.get(bot) ?? 0) + state.clock) % DECIDE_EVERY !== 0) continue;
      act(bot, nowMs);
    } catch (error) {
      Common.log(`bot ${bot.getUsername()} failed to act: ${error?.message ?? error}`);
    }
  }
}

/**
 * On a boss with a magic weapon (a staff, a wand...), a bot casts: the hardest-hitting combat spell
 * on its spellbook it has the level, runes and gear for goes on autocast first. (Attacking with a
 * staff and no spell set just whacks the boss with it.) No such spell: it fights as it is.
 */
/** The runes a spell takes are in the pack or a rune pouch (the core's own check, Spell.canCast). */
function hasRunesFor(bot, spell) {
  const { Spell } = require("../../../src/main/typescript/elvarg/game/content/combat/magic/Spell");
  const { PluginManager } = require("../../../src/main/typescript/elvarg/plugins/PluginManager");
  const short = Spell.inventoryShortfall(bot, spell.itemsToConsume(bot) ?? []);
  return short.length === 0 || PluginManager.checkSpellRuneSource(bot, short) === true;
}

function bossSpell(bot) {
  const { CombatSpells } = require("../../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
  const level = bot.getSkillManager().getCurrentLevel(Common.core.Skill.MAGIC);
  let best = null;
  let bestHit = 0;
  for (const value of Object.values(CombatSpells)) {
    const spell = typeof value?.spellId === "function" ? value : null;
    if (!spell || typeof spell.maximumHit !== "function") continue;
    try {
      if (spell.getSpellbook?.() !== bot.getSpellbook()) continue;
      if (spell.levelRequired() > level) continue;
      if (!hasRunesFor(bot, spell)) continue;
      if (!bot.getEquipment().containsAllItem(spell.equipmentRequired(bot) ?? [])) continue;
      const hit = Number(spell.maximumHit()) || 0;
      if (hit > bestHit) {
        best = spell;
        bestHit = hit;
      }
    } catch (_error) {
      // A spell that can't be weighed (special requirements): skip it.
    }
  }
  return best;
}

/**
 * Swaps a magic weapon the bot can't cast with for the best melee or ranged weapon in its pack (with
 * ammo for it, and the set for a set weapon). Returns the new weapon's name, or null.
 */
function offMagic(bot) {
  return switchWeapon(bot, ["melee", "ranged"]);
}

/**
 * Swaps the worn weapon for the best one in the pack of one of `styles` (with ammo for it, the set
 * for a set weapon, and for magic a spell it can then cast). Returns the new weapon's name, or null.
 */
function switchWeapon(bot, styles) {
  const { Equipment, Item } = Common.core;
  const equipment = bot.getEquipment();
  const inventory = bot.getInventory();
  let best = null;
  let bestScore = 0;
  inventory.getItems().forEach((item, slot) => {
    const id = item?.getId?.() ?? -1;
    if (id <= 0 || Gear.itemStyle(id) == null) return;
    if (Common.core.ItemDefinition.forId(id)?.getEquipmentType?.()?.getSlot?.() !== Equipment.WEAPON_SLOT) return;
    const style = Gear.weaponStyle(id);
    if (!styles.includes(style) || !Gear.hasAmmoFor(bot, id) || !Gear.hasSetFor(bot, id)) return;
    const value = Gear.score(id, style);
    if (value > bestScore) {
      best = { id, slot, amount: item.getAmount() };
      bestScore = value;
    }
  });
  if (!best) return null;
  const old = equipment.getItems()[Equipment.WEAPON_SLOT];
  if (Gear.isTwoHanded(best.id)) {
    const shield = equipment.getItems()[Equipment.SHIELD_SLOT];
    if (shield && shield.getId() > 0) {
      if (inventory.getFreeSlots() < 1) return null;
      inventory.add(new Item(shield.getId(), shield.getAmount()), false);
      equipment.setItem(Equipment.SHIELD_SLOT, new Item(-1, 0));
    }
  }
  inventory.setItem(best.slot, old && old.getId() > 0 ? new Item(old.getId(), old.getAmount()) : new Item(-1, 0));
  equipment.setItem(Equipment.WEAPON_SLOT, new Item(best.id, best.amount));
  equipment.refreshItems?.();
  inventory.refreshItems?.();
  try {
    Common.core.WeaponInterfaceManager?.assign?.(bot);
    bot.getUpdateFlag?.().flag?.(Common.core.Flag.APPEARANCE);
  } catch (_error) {
    // The look catches up on the next equipment change.
  }
  return Common.itemName(best.id);
}

/**
 * Sets a bot on a target (a boss, or a duel opponent at a stand-off) so it actually hits: with a
 * magic weapon it autocasts the hardest-hitting spell it can cast; with none it can cast, it
 * switches to its best melee or ranged weapon. Returns how it engaged, for the log.
 */
function engage(bot, target) {
  const combat = bot.getCombat();
  const how = readyWeapon(bot);
  // A spell is cast the way the PvP brain casts it (castSpellOn), autocast keeping it going.
  const spell = how === "autocast" ? combat.getAutocastSpell?.() : null;
  if (spell && typeof combat.castSpellOn === "function") {
    if (combat.getTarget?.() !== target || combat.getCastSpell?.() !== spell) combat.castSpellOn(target, spell);
  } else if (combat.getTarget?.() !== target) {
    combat.attack(target);
  }
  return how;
}

/**
 * A magic weapon gets a spell it can cast on autocast (the PvP brain only knows its own loadouts'
 * spells and Ancient ice, so a tournament mage often has none and doesn't attack at all); with none
 * it can cast, the bot switches to its best melee or ranged weapon. Returns what it did.
 */
function readyWeapon(bot) {
  const combat = bot.getCombat();
  const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  let how = "attack";
  if (weapon > 0 && Gear.weaponStyle(weapon) === "magic") {
    const spell = bossSpell(bot);
    if (spell) {
      if (combat.getAutocastSpell?.() !== spell) {
        const { Autocasting } = require("../../../src/main/typescript/elvarg/game/content/combat/magic/Autocasting");
        Autocasting.setAutocast(bot, spell);
      }
      how = "autocast";
    } else {
      const switched = offMagic(bot);
      combat.setCastSpell?.(null);
      combat.setAutocastSpell?.(null);
      how = switched ? `no spell, switched to ${switched}` : "no spell, no other weapon";
    }
  }
  return how;
}

/**
 * On a boss: a boss only some styles can hurt (Kree'arra's flock: ranged or magic) gets one of those
 * - the bot switches to its best such weapon in the pack. False when it has none (nothing it can do).
 */
function attackBoss(bot, boss) {
  const styles = require("./Bosses.DeadmanTournament").hitBy(boss);
  if (styles) {
    const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
    const style = weapon > 0 ? Gear.weaponStyle(weapon) : "melee";
    if (!styles.includes(style) && !switchWeapon(bot, styles)) return false;
    // A magic weapon with no spell to cast would be swapped for melee by engage: not here.
    const now = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
    if (Gear.weaponStyle(now) === "magic" && !bossSpell(bot)) return false;
  }
  engage(bot, boss);
  return true;
}

/**
 * A chest the bot can't get to (beyond a cliff, a wall or water): no closer for CHEST_STUCK_TICKS
 * and it's skipped for CHEST_SKIP_TICKS - the next nearest is tried instead.
 */
const CHEST_STUCK_TICKS = 16;
const CHEST_SKIP_TICKS = 200;
const chestTries = new WeakMap();

function skippingChest(bot, chest) {
  const tries = chestTries.get(bot);
  return Boolean(tries?.skip?.get(chest) > state.clock);
}

function noteChestProgress(bot, chest) {
  const tries = chestTries.get(bot) ?? { skip: new Map() };
  chestTries.set(bot, tries);
  const d = Common.distance(bot.getLocation(), chest.getLocation());
  if (tries.chest !== chest || d < tries.best) {
    tries.chest = chest;
    tries.best = d;
    tries.since = state.clock;
  } else if (d > 2 && state.clock - tries.since >= CHEST_STUCK_TICKS) {
    tries.skip.set(chest, state.clock + CHEST_SKIP_TICKS);
    tries.chest = null;
    count("unreachable chests skipped");
  }
}

/** Loot this close is taken before anything else but the fog and a fight. */
const AT_FEET = 3;

/** How near an upgrade on the floor must be for a bot to grab it in the middle of a fight. */
const MID_FIGHT_GRAB = 10;
/** A grab mid-fight is given up after this long without reaching the item. */
const GRAB_TICKS = 15;
/** Bots running for an upgrade mid-fight: the ground item and when they gave up on it. */
const grabs = new WeakMap();

/**
 * Mid-fight, an upgrade on the floor within MID_FIGHT_GRAB comes first (as many upgrades as
 * possible reach the finals): the bot drops its fight, runs over and picks it up, then the fight
 * carries on (it hits back at whoever's on it). Started from the bot's decisions, carried on every
 * tick. True while it's busy with one.
 */
function grabUpgrade(bot) {
  const grab = grabs.get(bot);
  if (!grab) return false;
  const item = grab.item;
  if (item.isPendingRemoval?.() || state.clock > grab.until) {
    grabs.delete(bot);
    return false;
  }
  if (Common.distance(bot.getLocation(), item.getPosition()) <= 1) {
    if (Loot.take(bot, item)) count("mid-fight upgrades grabbed");
    grabs.delete(bot);
    return false;
  }
  if (state.clock % 2 === 0) walkToward(bot, item.getPosition().getX(), item.getPosition().getY(), MID_FIGHT_GRAB + 1);
  return true;
}

function startGrab(bot) {
  if (grabs.has(bot)) return true;
  const upgrade = Loot.lootNear(bot, MID_FIGHT_GRAB, true);
  if (!upgrade) return false;
  if (Common.distance(bot.getLocation(), upgrade.getPosition()) <= 1) {
    if (Loot.take(bot, upgrade)) count("mid-fight upgrades grabbed");
    return true;
  }
  // Off the fight (the brain's chase would pull it straight back) and over to it.
  dropPvpTarget(bot);
  bot.getCombat().reset?.();
  grabs.set(bot, { item: upgrade, until: state.clock + GRAB_TICKS });
  walkToward(bot, upgrade.getPosition().getX(), upgrade.getPosition().getY(), MID_FIGHT_GRAB + 1);
  count("mid-fight grabs started");
  return true;
}

/**
 * Female bot models are broken for now (kofi, 2026-11-09): a bot spawned female gets a male look
 * (PlayerFactory's male ranges), keeping its colours.
 */
const MALE_LOOK = { 1: [0, 8], 2: [18, 25], 3: [26, 31], 4: [33, 34], 5: [36, 40], 6: [42, 43], 7: [10, 17] };

function makeMale(bot) {
  const appearance = bot.getAppearance?.();
  if (!appearance || appearance.isMale?.() !== false) return;
  const look = [...appearance.getLook()];
  look[0] = 0;
  for (const [index, [low, high]] of Object.entries(MALE_LOOK)) look[Number(index)] = Common.randomInt(low, high);
  appearance.setLookArray(look);
}

/**
 * Frozen with a melee weapon and not next to its target: the bot switches to its best ranged
 * weapon (with ammo) or magic weapon (with a spell it can cast) and attacks with that - the PvP
 * brain only reviews styles when an attack is ready, which a frozen melee bot out of reach never is.
 * True when it switched.
 */
function unfreezeStyle(bot, target) {
  if (!target || !alive(target) || !meleeWeapon(bot)) return false;
  const { TimerKey } = require("../../../src/main/typescript/elvarg/util/timers/TimerKey");
  if (!bot.getTimers?.()?.has?.(TimerKey.FREEZE)) return false;
  if (Common.distance(bot.getLocation(), target.getLocation()) <= 1) return false;
  const switched = switchWeapon(bot, ["ranged"]) ?? (switchWeapon(bot, ["magic"]) && bossSpell(bot) ? "magic" : null);
  if (!switched) return false;
  count("frozen switches");
  engage(bot, target);
  return true;
}

/**
 * Duel tactics on a frozen opponent (the PvP brain plays hybrid at range and never steps under):
 * - under STEP_UNDER_HP of its hitpoints, the bot steps onto the opponent's tile - a frozen
 *   opponent can't hit it there - and eats;
 * - standing under them with its hitpoints back over STEP_OUT_HP, it steps out beside them;
 * - otherwise it switches to its best melee weapon and walks in to hit (they can't step away).
 * Returns what it did (for the log), or null.
 */
const STEP_UNDER_HP = 0.75;

/** Straight to an exact tile (the path finder; no nudging of the tile). */
function stepTo(bot, x, y) {
  try {
    bot.setRunning?.(true);
    Common.core.PathFinder.calculateWalkRoute(bot, x, y);
  } catch (_error) {
    // No route this time; the next look tries again.
  }
}
const STEP_OUT_HP = 0.7;

function duelTactics(bot, foe) {
  if (!foe || !alive(foe) || !alive(bot)) return null;
  const { TimerKey } = require("../../../src/main/typescript/elvarg/util/timers/TimerKey");
  const frozen = (p) => p.getTimers?.()?.has?.(TimerKey.FREEZE) === true;
  const here = bot.getLocation();
  const there = foe.getLocation();
  const under = here.getX() === there.getX() && here.getY() === there.getY();
  const hp = bot.getHitpoints() / Math.max(1, bot.getSkillManager().getMaxLevel(Common.core.Skill.HITPOINTS));
  // Under them: out again as soon as it's healed or their freeze is over (nobody can hit anyone
  // on their own tile, so staying there is a stand-off).
  if (under && !frozen(bot)) {
    if (hp < STEP_OUT_HP && frozen(foe)) return "staying under";
    // Out beside them, then on them with melee.
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .find(([dx, dy]) => Common.standable(there.getX() + dx, there.getY() + dy, there.getZ(), bot.getArea?.())) ?? [1, 0];
    stepTo(bot, there.getX() + side[0], there.getY() + side[1]);
    switchWeapon(bot, ["melee"]);
    engage(bot, foe);
    count("step-outs");
    return "stepped out";
  }
  if (!frozen(foe) || frozen(bot)) return null;
  if (hp < STEP_UNDER_HP) {
    bot.getCombat().reset?.();
    stepTo(bot, there.getX(), there.getY());
    count("step-unders");
    return "stepping under";
  }
  if (!meleeWeapon(bot) && !switchWeapon(bot, ["melee"])) return null;
  engage(bot, foe);
  count("melee on a frozen foe");
  return "melee on a frozen foe";
}

/**
 * Off a style the opponent prays against (a stand-off: barrages into Protect from Magic): the bot
 * switches to its best weapon of a style they aren't protecting from. Returns the weapon, or null.
 */
function offProtectedStyle(bot, foe) {
  const { PrayerHandler } = Common.core;
  if (!PrayerHandler || !foe) return null;
  const protects = {
    magic: PrayerHandler.isActivated(foe, PrayerHandler.PROTECT_FROM_MAGIC),
    ranged: PrayerHandler.isActivated(foe, PrayerHandler.PROTECT_FROM_MISSILES),
    melee: PrayerHandler.isActivated(foe, PrayerHandler.PROTECT_FROM_MELEE),
  };
  const weapon = bot.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const style = weapon > 0 ? Gear.weaponStyle(weapon) : "melee";
  if (!protects[style]) return null;
  const open = ["ranged", "magic", "melee"].filter((s) => !protects[s]);
  for (const s of open) {
    if (s === "magic") {
      const name = switchWeapon(bot, ["magic"]);
      if (name && bossSpell(bot)) return name;
      continue;
    }
    const name = switchWeapon(bot, [s]);
    if (name) return name;
  }
  return null;
}

/** A boss this close is piled on by every bot, clan or not. */
const NEAR_BOSS = 15;

/** How far a lone bot will go to pile on a boss. */
const LONE_BOSS_RANGE = 40;

/** The boss a lone bot piles on: the nearest live one within LONE_BOSS_RANGE. */
function loneBoss(bot, range = LONE_BOSS_RANGE) {
  const here = bot.getLocation();
  let best = null;
  let bestDistance = range + 1;
  for (const boss of require("./Bosses.DeadmanTournament").liveBosses()) {
    if (boss.getLocation().getZ() !== here.getZ() || gaveUpOn(bot, boss)) continue;
    const distance = Common.distance(here, boss.getLocation());
    if (distance < bestDistance) {
      best = boss;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A bot inside a no-spawn zone (`wilderness.exclude`: the Mage Arena's walled ring and the like) is
 * trapped there: it's put on open ground just outside, within RESCUE_SPREAD tiles of the zone, so
 * its clan comes out near each other.
 */
const RESCUE_EVERY = 50;
const RESCUE_SPREAD = 15;

function rescue() {
  const Tournament = require("./Tournament.DeadmanTournament");
  const zones = Common.data.wilderness.exclude ?? [];
  let moved = 0;
  for (const bot of state.alive) {
    if (!State.isBot(bot) || !alive(bot)) continue;
    const here = bot.getLocation();
    const zone = zones.find((box) => Common.inBox(here.getX(), here.getY(), box));
    if (!zone) continue;
    const around = { minX: zone.minX - RESCUE_SPREAD, maxX: zone.maxX + RESCUE_SPREAD, minY: zone.minY - RESCUE_SPREAD, maxY: zone.maxY + RESCUE_SPREAD };
    const tile = Tournament.randomWildernessTile(around, 30);
    if (!tile) continue;
    bot.getCombat?.().reset?.();
    bot.getMovementQueue?.().reset?.();
    bot.moveTo(tile);
    moved++;
  }
  if (moved) Common.log(`rescued ${moved} bot(s) from a no-spawn zone`);
}

function count(name) {
  state.stats = state.stats ?? {};
  state.stats[name] = (state.stats[name] ?? 0) + 1;
}

/**
 * A bot that hasn't moved for STUCK_TICKS while out of a fight has its combat and walk cleared and
 * is sent a few tiles towards the zone's middle (a blocked route, a target it can't reach).
 */
function unstick(bot) {
  const at = bot.getLocation();
  const key = `${at.getX()},${at.getY()},${at.getZ()}`;
  const seen = lastSeen.get(bot);
  if (!seen || seen.key !== key || fighting(bot)) {
    lastSeen.set(bot, { key, ticks: 0 });
    return;
  }
  seen.ticks += 5;
  if (seen.ticks < STUCK_TICKS) return;
  seen.ticks = 0;
  count("unstuck");
  // A few each minute in the log, to see why they stood still.
  state.stuckSamples = state.stuckSamples ?? [];
  if (state.stuckSamples.length < 4) {
    const combat = bot.getCombat();
    const pvp = stateOf(bot)?.pvp;
    const target = combat.getTarget?.();
    state.stuckSamples.push(`${bot.getUsername()} at ${key}: walk queue ${bot.getMovementQueue().size()}, blocked ${bot.getMovementQueue().isMovementBlocked?.() ?? "?"}, ` +
      `target ${target ? `${target.getUsername?.() ?? target.getDefinition?.()?.getName?.()} ${Common.distance(at, target.getLocation())} away` : "none"}, ` +
      `brain ${pvp?.phase ?? stateOf(bot)?.mode ?? "?"}, fog depth ${state.fog ? Fog.depthOf(bot) : 0}, anchor ${Clans.anchorOf(bot) ? Common.distance(at, Clans.anchorOf(bot).getLocation()) : "-"}, key ${Loot.hasKey(bot)}`);
  }
  bot.getCombat().reset?.();
  bot.getMovementQueue().setBlockMovement(false).reset?.();
  const cx = state.fog?.cx ?? at.getX();
  const cy = state.fog?.cy ?? at.getY();
  const toward = (from, to) => from + Math.sign(to - from) * Common.randomInt(3, 8) + Common.randomInt(-3, 3);
  walkToward(bot, toward(at.getX(), cx), toward(at.getY(), cy), 10);
}

/**
 * The PvP brain's skill for this bot (PvpProfileRegistry: standard 2, veteran 3, elite 4), drawn by
 * `botSkill` weights, and its fighting treated as hybrid/NH (so it runs protection prayers against
 * what it's hit with, as the runtime's NH and tribrid bots do). Elites are the high-risk experts:
 * prayer flicks, combo eats, tighter switches. Re-applied whenever it's pointed at a fight, since
 * the runtime can reset its PvP state.
 */
function applySkill(bot) {
  const pvp = stateOf(bot)?.pvp;
  if (!pvp) return;
  let skill = bot.getAttribute(SKILL_ATTRIBUTE);
  if (!skill) {
    const weights = Object.entries(Common.data.botSkill ?? { standard: 1 });
    let roll = Math.random() * weights.reduce((sum, [, weight]) => sum + weight, 0);
    skill = weights[0][0];
    for (const [name, weight] of weights) {
      roll -= weight;
      if (roll < 0) {
        skill = name;
        break;
      }
    }
    bot.setAttribute(SKILL_ATTRIBUTE, skill);
  }
  if (pvp.profileId !== skill) pvp.profileId = skill;
  pvp.confidenceTier = SKILL_TIERS[skill] ?? 2;
  if (!/(^|_)(nh|tribrid)(_|$)/.test(String(pvp.generatedArchetypeId ?? ""))) pvp.generatedArchetypeId = "deadman_tribrid";
}

/** The start: each bot's PvP brain, from where it stands. */
function started() {
  for (const bot of state.alive) {
    if (!State.isBot(bot)) continue;
    bot.getMovementQueue().setBlockMovement(false);
    const at = bot.getLocation();
    try {
      startActivity(bot, PVP_ACTIVITY, { home: { x: at.getX(), y: at.getY(), z: at.getZ() } });
      applySkill(bot);
    } catch (error) {
      Common.log(`bot ${bot.getUsername()} has no PvP brain: ${error?.message ?? error}`);
    }
  }
}

function logout(bot) {
  if (bot.getAttribute?.("deadman-tournament:logging-out")) return;
  bot.setAttribute?.("deadman-tournament:logging-out", true);
  state.participants.delete(bot);
  // Straight out: the bot runtime would otherwise walk the dead bot to the bank to re-gear.
  bot.getMovementQueue?.().setBlockMovement(true).reset?.();
  bot.setNpcTransformationId?.(11858);
  Common.later(1, () => {
    bot.getForcedLogoutTimer?.().start(0);
    bot.requestLogout?.();
  });
}

function eliminated(victim) {
  if (State.isBot(victim)) logout(victim);
}

/** No retreat or teleport home: they fight to the end. */
function defensiveAction(request) {
  if (!State.isBot(request.player) || !state.alive.has(request.player)) return;
  request.result = { handled: false, status: "running" };
}

/** Deadman Tournament: no Smite for anyone in it - they pray against what they're hit with. */
function noSmite(event) {
  if (!state.participants.has(event.player)) return;
  if (event.prayer !== Common.core.PrayerData?.SMITE) return;
  event.disabled = true;
  event.message = "Smite is disabled in the Deadman Tournament.";
}

/**
 * Overheads: every tick a tournament bot in a fight prays against its opponent's weapon (a staff
 * or wand: magic; a bow, crossbow, ballista...: missiles; anything else: melee). How quickly it
 * reacts to a switch depends on its skill (elite next tick, veteran ~2s, standard ~3s). In the
 * bracket its prayer points are kept full (`bracket.unlimitedPrayer`, as Last Man Standing does).
 */
const REACTION_TICKS = { novice: 8, standard: 5, veteran: 3, elite: 1 };
const PROTECT = { magic: "PROTECT_FROM_MAGIC", ranged: "PROTECT_FROM_MISSILES", melee: "PROTECT_FROM_MELEE" };
const prayerPlan = new WeakMap();

function opponentOf(bot) {
  // In a duel the opponent is known, even while combat is reset (stand-off breaker, a re-entry).
  const duel = state.duelOf?.(bot);
  if (duel) {
    const foe = duel.a === bot ? duel.b : duel.a;
    if (foe && alive(foe)) return foe;
  }
  const combat = bot.getCombat();
  for (const other of [combat.getTarget?.(), combat.getAttacker?.()]) {
    const foe = Common.asPlayer(other);
    if (foe && alive(foe)) return foe;
  }
  return null;
}

function pray(bot) {
  const { PrayerHandler, Skill } = Common.core;
  if (state.phase === "bracket" && Common.data.bracket.unlimitedPrayer !== false) {
    const skills = bot.getSkillManager();
    bot.setPrayerPointDrain?.(0);
    if (skills.getCurrentLevel(Skill.PRAYER) < skills.getMaxLevel(Skill.PRAYER)) skills.setCurrentLevel(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER), true);
  }
  const foe = opponentOf(bot);
  if (!foe) return;
  const weapon = foe.getEquipment().getItems()[Common.core.Equipment.WEAPON_SLOT]?.getId?.() ?? -1;
  const wanted = PrayerHandler[PROTECT[weapon > 0 ? Gear.weaponStyle(weapon) : "melee"]];
  if (wanted == null || PrayerHandler.isActivated(bot, wanted)) {
    prayerPlan.delete(bot);
    return;
  }
  const plan = prayerPlan.get(bot);
  if (!plan || plan.prayer !== wanted) {
    const delay = REACTION_TICKS[bot.getAttribute(SKILL_ATTRIBUTE) ?? "standard"] ?? 5;
    prayerPlan.set(bot, { prayer: wanted, at: state.clock + delay });
    return;
  }
  if (state.clock < plan.at) return;
  try {
    PrayerHandler.activatePrayerPrayerId(bot, wanted);
  } catch (_error) {
    // Out of prayer, or a prayer the bot can't use: the next tick tries again.
  }
}

function prayerTick() {
  if (state.phase !== "battle" && state.phase !== "bracket") return;
  for (const bot of state.alive) {
    if (State.isBot(bot) && alive(bot)) pray(bot);
  }
}

function attachBots(api) {
  State.onTick(prayerTick);
  api.onPrayerDisabled(noSmite);
  State.onTick(tick);
  State.onStart(started);
  State.onEliminated(eliminated);
  api.onCustomEvent("player-bots:pvp-defensive-action", defensiveAction);
}

module.exports = {
  offMagic,
  hasRunesFor, attachBots, isOwnSpawn, spawnBot, walkToward, hunt, stateOf, fighting, count, engage, bossBusy, unfreezeStyle, duelTactics, stepOf, offProtectedStyle };
