/**
 * Her specials (kofi, 2026-11-11): one every 8 attacks, in rounds of three: Elemental Lockdown, then
 * two of Nex's picked at random, no repeat in a round (data/aod.json "specials"):
 *  - cough      Smoke Cough, Nex's virus: three coughs that drain prayer and stats, spreading to anyone beside.
 *  - smash      Shadow Smash: a shadow pool under everyone, erupting four ticks later.
 *  - siphon     Blood Siphon: she kneels, blood reavers spawn, and every hit on her heals her.
 *  - sacrifice  Blood Sacrifice: the marked player must get 7 tiles away within six ticks.
 *  - prison     Ice Prison: stalagmites around a player that shatter unless one is broken.
 * (Ice Containment is left out, kofi.)
 *
 * Cough, smash and prison run Nex's own (Specials.Nex) on this fight, which carries what they need
 * (effects, record, arena.area, distanceTo a player). Siphon and sacrifice are Nex's, rewritten only
 * because Nex's heals stop at Nex's hit points: hers go up to her own (6000).
 */
const Common = require("./Common.AngelOfDeath");
const NexCommon = require("../nex/Common.Nex");
const NexSpecials = require("../nex/Specials.Nex");
const NexAttacks = require("../nex/Attacks.Nex");
const Lockdown = () => require("./Lockdown.AngelOfDeath");

const spec = () => Common.data.specials;
const nex = () => NexCommon.data.specials;
const alive = (fight) => fight.players().filter((player) => player.getHitpoints() > 0);
const NEX_SPECIAL = { cough: "virus", smash: "smash", prison: "prison" };

/** The next special in her round: Lockdown first, then `randomPerRound` of the pool. */
function next(fight) {
  if (!fight.specialRound?.length) {
    const pool = [...spec().pool];
    const picks = [];
    while (picks.length < spec().randomPerRound && pool.length) picks.push(pool.splice(NexCommon.randomInt(0, pool.length - 1), 1)[0]);
    // once Umbra is consumed, Shadow Smash is in every round (kofi)
    if (fight.consumed?.has("shadow") && !picks.includes("smash")) picks[picks.length - 1] = "smash";
    fight.specialRound = fight.noLockdown ? picks : ["lockdown", ...picks];   // no Lockdown after Fumus (kofi)
  }
  if (fight.noLockdown) fight.specialRound = fight.specialRound.filter((name) => name !== "lockdown");
  if (!fight.specialRound.length) return next(fight);
  return fight.specialRound.shift();
}

/** Her next special; returns the ticks until her next attack, or null if it couldn't happen. */
function start(fight) {
  const name = next(fight);
  fight.cue("special", { name, upcoming: [...fight.specialRound] });
  if (name === "lockdown") return Lockdown().start(fight);
  if (name === "siphon") return siphon(fight);
  if (name === "sacrifice") return sacrifice(fight);
  if (name === "smash") return smash(fight);
  return NexSpecials.run(fight, NEX_SPECIAL[name]);
}

// ------------------------------------------------------------------ shadow smash

/** Waves of Shadow Smash: 1, or 2/3/4 once Umbra/Cruor/Glacies are consumed (kofi; specials.smash). */
function smashWaves(fight) {
  const by = spec().smash?.waves ?? {};
  let waves = 1;
  for (const element of fight.consumed ?? []) waves = Math.max(waves, by[element] ?? 1);
  return waves;
}

/** Nex's Shadow Smash ("Fear the shadow!"), in waves `gap` ticks apart, each under everyone where they stand then. */
function smash(fight) {
  const n = nex().smash;
  const waves = smashWaves(fight);
  const gap = spec().smash?.gap ?? 1;
  fight.say(n.say);
  fight.boss.performAnimation(NexCommon.animation(n.anim));
  fight.cue("smash", { waves, gap });
  for (let i = 0; i < waves; i++) {
    const wave = () => { if (fight.stage === "fighting") pools(fight, alive(fight)); };
    if (i === 0) wave(); else fight.at(i * gap, wave);
  }
  return n.nextAttackTicks + (waves - 1) * gap;
}

/** One wave of Nex's shadow pools under `players`, erupting `eruptTicks` later for up to 50 on anyone still on it. */
function pools(fight, players) {
  const n = nex().smash;
  const objects = NexCommon.data.objects;
  for (const player of players) {
    const at = player.getLocation().clone();
    const shadow = fight.effects.placeLoc(objects.shadow, at, 0);
    fight.at(n.eruptTicks, () => {
      fight.effects.removeLoc(shadow);
      if (fight.stage !== "fighting") return;
      fight.effects.placeLoc(objects.shadowErupted, at, n.clearTicks - n.eruptTicks);
      NexCommon.tileGraphic(fight.players(), at, n.graphic);
      NexCommon.areaSound(fight.players(), at, n.sound);
      for (const victim of alive(fight)) {
        if (!victim.getLocation().equals(at)) continue;
        const amount = NexCommon.randomInt(0, n.maxHit);
        victim.sendMessage(n.hit);
        NexCommon.damage(victim, amount);
        fight.noteHit(victim, "smash", amount);
      }
    });
  }
  fight.cue("pools", { tiles: players.map((p) => p.getLocation().clone()), at: fight.tick + n.eruptTicks });
}

// ------------------------------------------------------------------ blood siphon

/** Nex's: she kneels, healing from every hit (Fight.AngelOfDeath modifyHit); a reaver per three players. */
function siphon(fight) {
  const n = nex().siphon;
  fight.say(n.say);
  fight.cue("siphon");
  fight.boss.performAnimation(NexCommon.animation(n.anim));
  fight.boss.performGraphic(NexCommon.graphic(n.graphic));
  fight.boss.getMovementQueue().reset();
  fight.boss.setMobileInteraction(null);
  killReavers(fight, true);                       // last siphon's reavers, left alive, heal her
  const count = Math.max(1, Math.min(n.maxReavers, Math.ceil(fight.players().length / n.playersPerReaver)));
  for (let i = 0; i < count; i++) spawnReaver(fight);
  fight.siphonUntil = fight.tick + n.kneelTicks;
  const ticks = Math.max(n.nextAttackTicks, spec().siphon.animTicks);   // the whole kneel and stand-up
  fight.at(ticks, () => { if (fight.target) fight.boss.setMobileInteraction(fight.target); });
  return ticks;
}

/** A reaver on a free 2x2 a few tiles from her, attacking someone (Nex's reaver: Blood Blitz). */
function spawnReaver(fight) {
  const n = nex().siphon, s = spec().siphon;
  const { RegionManager } = Common.core;
  const { spawn } = require("./Arena.AngelOfDeath");
  const base = fight.boss.getLocation();
  const [lo, hi] = Common.data.lockdown.interior;
  for (let attempt = 0; attempt < 50; attempt++) {
    const tile = base.transform(NexCommon.randomInt(-s.spawnRadius, s.spawnRadius + Common.SIZE - 1),
      NexCommon.randomInt(-s.spawnRadius, s.spawnRadius + Common.SIZE - 1));
    const [x, y] = fight.area.localOf(tile);
    if (x < lo || y < lo || x + 1 > hi || y + 1 > hi) continue;
    if (NexCommon.distanceToBody(tile, base, Common.SIZE) < 2) continue;
    let free = true;
    for (let dx = 0; dx < 2 && free; dx++) {
      for (let dy = 0; dy < 2 && free; dy++) free = !RegionManager.blocked(tile.transform(dx, dy), fight.area);
    }
    if (!free) continue;
    const reaver = spawn(fight.area, NexCommon.data.npcs.reaver, [x, y]);
    if (!reaver) return;
    reaver.setMaxHitpoints?.(s.reaverHitpoints);
    reaver.setHitpoints(s.reaverHitpoints);
    reaver.__aodSiphonReaver = fight;
    reaver.performGraphic(NexCommon.graphic(n.reaverGraphic));
    fight.areaSound(n.reaverSound, tile);
    fight.siphonReavers.push(reaver);
    const target = NexCommon.pick(alive(fight));
    if (target) reaver.getCombat().attack(target);
    return;
  }
}

/** Removes the siphon's reavers; with `healHer`, what they have left heals her (Nex's rule). */
function killReavers(fight, healHer) {
  let healed = 0;
  for (const reaver of fight.siphonReavers) {
    if (!reaver?.isRegistered?.() || reaver.getHitpoints() <= 0) continue;
    healed += reaver.getHitpoints();
    if (healHer) NexCommon.projectile(reaver, fight.boss, { ...nex().sacrifice.projectile, start: 0 });
    Common.api.removeNpc(reaver);
  }
  fight.siphonReavers = [];
  if (healHer && healed > 0) {
    const amount = NexCommon.healNpc(fight.boss, healed, Common.data.hitpoints);
    fight.cue("bigheal", { amount, source: "reavers" });
  }
  return healed;
}

function reaverDied(npc) {
  const fight = npc.__aodSiphonReaver;
  if (fight) fight.siphonReavers = fight.siphonReavers.filter((reaver) => reaver !== npc);
}

// ------------------------------------------------------------------ blood sacrifice

/** Nex's: the marked player has six ticks to get 7 tiles away, or takes up to 50 and splashes those beside. */
function sacrifice(fight) {
  const n = nex().sacrifice;
  const players = alive(fight);
  if (players.length === 0) return null;
  const marked = NexCommon.pick(players);
  fight.say(n.say);
  fight.cue("sacrifice", { marked });
  fight.areaSound(n.sound);
  marked.getPacketSender().sendSoundEffect(n.synth, 1, 0);
  marked.sendMessage(n.marked);
  marked.tint(n.tint);
  fight.at(n.resolveTicks, () => {
    if (fight.stage !== "fighting" || marked.getHitpoints() <= 0 || !fight.players().includes(marked)) return;
    if (fight.distanceTo(marked) >= n.escapeDistance) {
      marked.sendMessage(n.escaped);
      return;
    }
    marked.sendMessage(n.failed);
    fight.boss.performAnimation(NexCommon.animation(n.failAnim));
    fight.areaSound(n.failSound);
    const { Skill } = Common.core;
    const prayer = (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER);
    let healed = 0;
    for (const player of alive(fight)) {
      const splash = player !== marked;
      if (splash && player.getLocation().getDistance(marked.getLocation()) > 1) {
        player.sendMessage(n.unleashed);
        continue;
      }
      const cycles = NexCommon.projectile(fight.boss, player, { ...n.projectile, start: NexCommon.data.fight.attacks.projectileStart });
      const amount = NexCommon.randomInt(0, splash ? n.splashMaxHit : n.maxHit);
      if (splash) player.sendMessage(n.unleashed);
      healed += amount;
      NexCommon.later(NexCommon.landsIn(cycles), () => {
        if (!player.isRegistered()) return;
        player.performGraphic(NexCommon.graphic(n.impact));
        player.getPacketSender().sendSoundEffect(n.impactSound, 1, 0);
        NexCommon.damage(player, amount);
        NexAttacks.drainPrayer(player, Math.floor(prayer(player) / 3));
        fight.noteHit(player, "sacrifice", amount);
      });
    }
    NexCommon.later(2, () => fight.stage === "fighting" && NexCommon.healNpc(fight.boss, healed, Common.data.hitpoints));
  });
  return n.nextAttackTicks;
}

// ------------------------------------------------------------------ ice prison: breaking out

/**
 * Attack on a stalagmite in her arena: Nex's rule (a stab or crush one-hander, by attack bonus).
 * Nex's own handler (Specials.Nex attackStalagmite) only knows Nex's chamber, and lets this one run.
 */
function attackStalagmite({ player, object }) {
  const area = require("./Arena.AngelOfDeath").arenaOf(player);
  const fight = area?.fight;
  const state = fight?.effects?.prison;
  if (!state || !state.stalagmites.some((loc) => loc.getLocation().equals(object.getLocation()))) return false;
  const n = nex().prison;
  if (state.inside.includes(player)) {
    player.sendMessage(n.frozenInside);
    return true;
  }
  const style = player.getFightType?.()?.getBonusType?.();
  const weapon = player.getEquipment().getItems()[3];
  const twoHanded = weapon?.getId?.() > 0 && Common.core.ItemDefinition.forId(weapon.getId())?.isDoubleHanded?.();
  if ((style !== 0 && style !== 2 && style != null) || twoHanded) {
    player.sendMessage(n.unsuitable);
    return true;
  }
  player.performAnimation(NexCommon.animation(player.getAttackAnim?.() ?? 422));
  const bonuses = player.getBonusManager?.()?.getAttackBonus?.() ?? [];
  const bonus = Math.max(bonuses[0] ?? 0, bonuses[2] ?? 0);
  if (Math.random() >= 0.25 + Math.min(1, Math.max(0, bonus) / 130) * 0.75) {
    player.sendMessage(n.fail);
    return true;
  }
  player.sendMessage(n.success);
  NexCommon.areaSound(fight.players(), object.getLocation(), [n.breakSound, 0, 7]);
  fight.effects.removeLoc(object);
  for (const trapped of state.inside) trapped.sendMessage(n.freed);
  NexCommon.later(1, () => {
    if (fight.effects.prison === state) fight.effects.prison = null;
    for (const loc of state.stalagmites) fight.effects.removeLoc(loc);
    fight.effects.removeLoc(state.blocker);
  });
  return true;
}

/** The fight ended: the reavers go (no heal), and every shadow, stalagmite and cough with them. */
function clear(fight) {
  killReavers(fight, false);
  fight.effects?.clear();
}

function attach(api) {
  api.onObjectInteraction("Stalagmite", { Attack: attackStalagmite });
}

module.exports = { start, next, clear, pools, smashWaves, reaverDied, attach, siphon, sacrifice, killReavers };
