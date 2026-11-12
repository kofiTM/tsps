/**
 * Nex: Angel of Death's standard attacks: Nex's (Attacks.Nex.js, docs/nex.md) on her 5x5 body,
 * with her element changing at random (kofi) instead of by phase, and Soul Split coming and going.
 *  - Melee (Nex's 9180, max 27) when her target stands beside her body (not a corner): three in a
 *    row at most, then a spell. Protect from Melee blocks 80%.
 *  - Otherwise her element's spell, as Nex's phase spells: smoke (magic, everyone in range, poison,
 *    no drag: removed, kofi 2026-11-11), shadow (ranged, everyone, harder close up, prayer drain), blood (magic, her
 *    target and the 3x3 around them, heals her a quarter), ice (magic, everyone, prayer drain,
 *    frozen unless praying Magic). Protection blocks half. Her projectiles are 1.7x (custom spot anims).
 *  - Every 3-6 attacks a new element, never the same: Nex's line for it, and its pillar sends her power.
 *  - Soul Split (Nex's Zaros phase), only once Glacies is consumed (kofi): on for 4 attacks at random, its icon over her (head icon 11: archive 440 sprite 11, as Nex's Soul Split form 11280);
 *    each hit she lands sends a soul back to her, healing her a fifth of it.
 */
const Common = require("./Common.AngelOfDeath");
const NexCommon = require("../nex/Common.Nex");

const ELEMENTS = ["smoke", "shadow", "blood", "ice"];
const data = () => Common.data.combat;
const nexAttacks = () => NexCommon.data.fight.attacks;

const randomInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function drainPrayer(player, amount) {
  if (amount <= 0) return;
  const apply = Common.core.applyPrayerDrainModifiers;
  if (typeof apply === "function") amount = apply(player, amount, { source: "nex" });
  if (amount > 0) player.getSkillManager().decreaseCurrentLevel(Common.core.Skill.PRAYER, amount, 0);
}

/** Next to her 5x5 body on a side, not at a corner diagonal. */
function inMeleeReach(fight, player) {
  if (fight.distanceTo(player.getLocation()) !== 1) return false;
  const at = player.getLocation();
  const base = fight.boss.getLocation();
  const alongX = at.getX() >= base.getX() && at.getX() < base.getX() + Common.SIZE;
  const alongY = at.getY() >= base.getY() && at.getY() < base.getY() + Common.SIZE;
  return alongX || alongY;
}

/** The fight's attack state (created on her first attack). */
function state(fight) {
  if (!fight.attackState) {
    fight.attackState = {
      element: data().firstElement, untilSwitch: randomInt(...data().elementEvery),
      meleeChain: 0, noMeleeNext: false,
      soulSplit: false, soulSplitLeft: randomInt(...data().soulSplit.offAttacks),
      frozenUntil: new Map(),
    };
  }
  return fight.attackState;
}

/** Her attack on `target`; false when she can't reach them this turn. */
function attack(fight, target) {
  const st = state(fight);
  if (!target || target.getHitpoints() <= 0) return false;
  const distance = fight.distanceTo(target.getLocation());
  const held = require("./Minions.AngelOfDeath").holdsCentre(fight);   // held in the middle: anyone in the arena (kofi)
  if (distance === 0 || (!held && distance > data().magicRange)) return false;
  fight.boss.setMobileInteraction(target);
  const forced = require("./Minions.AngelOfDeath").forcedElement(fight);   // a minion alive: its element only (kofi)
  if (forced) {
    if (st.element !== forced) switchElement(fight, st, forced);
    soulSplitTurn(fight, st);
    st.meleeChain = 0;
    if (forced === "blood") blood(fight, target); else spell(fight, target);
    st.lastKind = "spell";
    return true;
  }
  beforeAttack(fight, st);
  const pillarPhase = require("./Minions.AngelOfDeath").pillarsStanding(fight);   // Zaros magic only (and rushes)
  if (!pillarPhase && inMeleeReach(fight, target) && !st.noMeleeNext) {
    melee(fight, target);
    st.lastKind = "melee";
    st.meleeChain++;
    if (st.meleeChain >= data().meleeChain) { st.meleeChain = 0; st.noMeleeNext = true; }
    return true;
  }
  st.meleeChain = 0;
  st.noMeleeNext = false;
  if (st.element === "blood") blood(fight, target);
  else spell(fight, target);
  st.lastKind = "spell";
  return true;
}

/** Each attack: her element may change, Soul Split may come or go. */
function beforeAttack(fight, st) {
  if (st.element !== "zaros" && --st.untilSwitch <= 0) switchElement(fight, st);   // the last phase stays Zaros (kofi)
  soulSplitTurn(fight, st);
}

/** Soul Split comes and goes only in the last phase, once Glacies is consumed (kofi); off before. */
function soulSplitTurn(fight, st) {
  if (!fight.consumed?.has("ice")) {
    if (st.soulSplit) setSoulSplit(fight, st, false);
    return;
  }
  if (require("./Minions.AngelOfDeath").pillarsStanding(fight)) {   // always on while a pillar stands (kofi)
    if (!st.soulSplit) setSoulSplit(fight, st, true);
    st.soulSplitLeft = Infinity;
    return;
  }
  if (!Number.isFinite(st.soulSplitLeft)) st.soulSplitLeft = data().soulSplit.onAttacks;
  if (--st.soulSplitLeft <= 0) setSoulSplit(fight, st, !st.soulSplit);
}

function switchElement(fight, st, to = null) {
  const previous = st.element;
  st.element = to ?? NexCommon.pick(ELEMENTS.filter((e) => e !== previous));
  st.untilSwitch = randomInt(...data().elementEvery);
  fight.say(data().elements[st.element].line);
  // the element's pillar sends her its power (as in her spawn), 1.7x
  const call = Common.data.intro.pillars.find((c) => c.pillar === st.element);
  const pillar = fight.area.pillars.find((npc) => npc.__aodPillar === st.element && npc.isRegistered?.());
  if (call && pillar) {
    NexCommon.projectile(pillar, fight.boss, call.projectile);
    fight.areaSound(Common.data.intro.powerSound, pillar.getLocation());
  }
  fight.cue("element", { element: st.element, previous });
}

function setSoulSplit(fight, st, on) {
  const spec = data().soulSplit;
  st.soulSplit = on;
  st.soulSplitLeft = on ? spec.onAttacks : randomInt(...spec.offAttacks);
  fight.boss.setHeadIcon?.(on ? spec.icon : -1);   // sent with her next update (as Yama's)
  fight.cue("soulsplit", { on, until: fight.tick + st.soulSplitLeft * data().attackSpeed });
}

/** Soul Split: a soul from the hit player back to her, a fifth of the damage when it arrives. */
function soulSplit(fight, player, damage) {
  const st = state(fight);
  if (!st.soulSplit || damage <= 0 || fight.stage !== "fighting") return;
  const spec = data().soulSplit;
  NexCommon.projectile(player, fight.boss, spec.projectile);
  player.getPacketSender().sendSoundEffect(spec.sound, 1, 0);
  Common.later(NexCommon.landsIn(spec.projectile.end), () => {
    if (fight.stage !== "fighting" || !fight.boss?.isRegistered?.()) return;
    NexCommon.healNpc(fight.boss, Math.max(1, Math.floor(damage * spec.share)), Common.data.hitpoints);
    fight.areaSound(spec.healSound);
  });
}

function melee(fight, target) {
  fight.boss.performAnimation(NexCommon.animation(nexAttacks().melee.anim));
  fight.cue("auto", { style: "melee", element: null, target, at: fight.tick });
  NexCommon.strike(fight.boss, target, "melee", data().meleeMax, 0, {
    prayed: (style) => (style === "melee" ? 0.2 : 1),
    landed: (damage) => { fight.noteHit(target, "auto-melee", damage); soulSplit(fight, target, damage); },
  });
}

function projectileFor(fight, key, player) {
  const a = nexAttacks();
  return NexCommon.projectile(fight.boss, player, {
    ...a[key].projectile, id: data().elements[key].projectile,
    start: a.projectileStart, angle: a.projectileAngle, progress: a.projectileProgress,
  });
}

/** Smoke, shadow or ice: a projectile at everyone in the arena (kofi; spellsHitEveryone), each landing on its own. */
function spell(fight, target) {
  const key = state(fight).element;
  const style = nexAttacks()[key];
  fight.boss.performAnimation(NexCommon.animation(style.anim));
  fight.areaSound(style.sound);
  const kind = key === "shadow" ? "ranged" : "magic";
  let first = null;
  for (const player of fight.players()) {
    if (player.getHitpoints() <= 0) continue;
    if (!data().spellsHitEveryone && fight.distanceTo(player.getLocation()) > data().magicRange) continue;
    const cycles = projectileFor(fight, key, player);
    first ??= fight.tick + NexCommon.landsIn(cycles);
    const max = key === "shadow" ? shadowMax(fight, player) : data().magicMax;
    NexCommon.strike(fight.boss, player, kind, max, NexCommon.landsIn(cycles), {
      prayed: (prayer) => (prayer === kind ? 0.5 : 1),
      landed: (damage, accurate) => {
        landed(fight, key, player, damage, accurate);
      },
    });
  }
  fight.cue("auto", { style: kind, element: key, target, at: first ?? fight.tick });
}

/** Shadow shots hurt more the closer you stand (Wiki). */
function shadowMax(fight, player) {
  const { magicRange, shadowMax: max } = data();
  const distance = Math.max(1, Math.min(magicRange, fight.distanceTo(player.getLocation())));
  return Math.round(max - ((distance - 1) * (max - 2)) / (magicRange - 1));
}

function landed(fight, key, player, damage, accurate) {
  const a = nexAttacks();
  const style = a[key];
  const sender = player.getPacketSender();
  if (!accurate && key !== "shadow") {
    player.performGraphic(NexCommon.graphic(a.splash.graphic, { height: a.splash.height }));
    sender.sendSoundEffect(a.splash.sound, 1, 0);
    return;
  }
  if (style.impact > 0) player.performGraphic(NexCommon.graphic(style.impact, { height: style.impactHeight }));
  sender.sendSoundEffect(style.impactSound, 1, 0);
  fight.noteHit(player, `auto-${key}`, damage);
  if (damage <= 0) return;
  if (key === "smoke") Common.core.CombatFactory.poisonEntity(player, data().poisonSeverity, 1);
  else if (key === "shadow") drainPrayer(player, Math.ceil(damage / 10));
  else if (key === "ice") { drainPrayer(player, Math.floor(damage / 2)); iceFreeze(fight, player); }
  soulSplit(fight, player, damage);
}

/** The blood barrage: her target and anyone in the 3x3 around them, a quarter back to her. */
function blood(fight, target) {
  const a = nexAttacks();
  const style = a.blood;
  fight.boss.performAnimation(NexCommon.animation(style.anim));
  fight.areaSound(style.sound);
  const cycles = projectileFor(fight, "blood", target);
  fight.cue("auto", { style: "magic", element: "blood", target, at: fight.tick + NexCommon.landsIn(cycles) });
  const centre = target.getLocation();
  const victims = fight.players().filter((player) => {
    const at = player.getLocation();
    const held = require("./Minions.AngelOfDeath").holdsCentre(fight);   // held in the middle: anywhere (kofi)
    return player.getHitpoints() > 0 && (held || fight.distanceTo(at) <= data().magicRange)
      && Math.max(Math.abs(at.getX() - centre.getX()), Math.abs(at.getY() - centre.getY())) <= 1;
  });
  for (const player of victims) {
    NexCommon.strike(fight.boss, player, "magic", data().magicMax, NexCommon.landsIn(cycles), {
      prayed: (prayer) => (prayer === "magic" ? 0.5 : 1),
      landed: (damage, accurate) => {
        const sender = player.getPacketSender();
        if (!accurate) {
          player.performGraphic(NexCommon.graphic(a.splash.graphic, { height: a.splash.height }));
          sender.sendSoundEffect(a.splash.sound, 1, 0);
          return;
        }
        player.performGraphic(NexCommon.graphic(style.impact, { height: style.impactHeight }));
        sender.sendSoundEffect(style.impactSound, 1, 0);
        fight.noteHit(player, "auto-blood", damage);
        if (damage <= 0) return;
        drainPrayer(player, 5);
        Common.later(1, () => {
          if (fight.stage !== "fighting") return;
          NexCommon.healNpc(fight.boss, Math.floor(damage / 4), Common.data.hitpoints);
          fight.areaSound(style.healSound);
        });
        soulSplit(fight, player, damage);
      },
    });
  }
}

/** Her ice spell's freeze: 15 ticks unless praying against magic, never again within 5 of the last. */
function iceFreeze(fight, player) {
  if (NexCommon.protectedStyle(player) === "magic") return;
  const st = state(fight);
  const ended = st.frozenUntil.get(player);
  if (ended != null && fight.tick < ended + data().freezeGap) return;
  st.frozenUntil.set(player, fight.tick + data().freezeTicks);
  Common.core.CombatFactory.freeze(player, data().freezeTicks * 0.6);
  player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM ?? 0, NexCommon.data.fight.messages.frozen);
}

/** Unused (kofi 2026-11-11: she never drags). Smoke: someone 2-6 tiles away pulled in (Nex's drag). */
function dragCandidate(fight) {
  const spec = NexCommon.data.specials.drag;
  const close = fight.players().filter((p) => p.getHitpoints() > 0 && fight.distanceTo(p.getLocation()) > 1 && fight.distanceTo(p.getLocation()) <= spec.range);
  if (close.length === 0) return null;
  const player = NexCommon.pick(close);
  return Math.random() < (NexCommon.protectedStyle(player) === "magic" ? spec.chancePraying : spec.chance) ? player : null;
}

function dragIn(fight, player) {
  const spec = NexCommon.data.specials.drag;
  if (fight.stage !== "fighting" || player.getHitpoints() <= 0) return;
  const spot = besideHer(fight, player);
  player.sendMessage(spec.message.replace("Nex", "Nex: Angel of Death"));
  player.getMovementQueue().reset();
  if (spot) player.moveTo(spot);
  player.performAnimation(NexCommon.animation(spec.anim));
  player.getPacketSender().sendSoundEffect(spec.sound, 1, 0);
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    player.performAnimation(NexCommon.animation(-1));
    const { PrayerHandler } = Common.core;
    const praying = PrayerHandler.PROTECTION_PRAYERS.some((prayer) => PrayerHandler.isActivated(player, prayer));
    player.getCombat().getPrayerBlockTimer().start(data().prayerBlockSeconds);
    PrayerHandler.resetPrayers(player, PrayerHandler.PROTECTION_PRAYERS);
    if (praying) player.sendMessage(NexCommon.data.fight.messages.injured);
  });
}

/** The free tile beside her 5x5 body nearest the player. */
function besideHer(fight, player) {
  const { RegionManager } = Common.core;
  const base = fight.boss.getLocation();
  const at = player.getLocation();
  let best = null, bestDistance = Infinity;
  for (let x = -1; x <= Common.SIZE; x++) {
    for (let y = -1; y <= Common.SIZE; y++) {
      if (x >= 0 && x < Common.SIZE && y >= 0 && y < Common.SIZE) continue;
      const tile = base.transform(x, y);
      if (RegionManager.blocked(tile, fight.area)) continue;
      const distance = tile.getDistance(at);
      if (distance < bestDistance) { best = tile; bestDistance = distance; }
    }
  }
  return best;
}

/**
 * The last phase (after the pillars, kofi): one attack is two casts of the rotation's spell, a tick
 * apart (smoke, shadow, blood, ice, Zaros, round again). Returns false if she has nobody to cast at.
 */
function rotationAttack(fight, target) {
  const spec = Common.data.finale.pillarsDown;
  const st = state(fight);
  if (!target || target.getHitpoints() <= 0) return false;
  st.rotation = st.rotation ?? 0;
  const element = spec.rotation[st.rotation % spec.rotation.length];
  st.rotation++;
  st.element = element;
  st.lastKind = "spell";
  soulSplitTurn(fight, st);
  fight.boss.setMobileInteraction(target);
  fight.cue("element", { element, previous: null });
  for (let i = 0; i < (spec.castsPerAttack ?? 1); i++) {
    const cast = () => {
      if (fight.stage !== "fighting" || fight.cutscene) return;
      const now = target.getHitpoints() > 0 && fight.players().includes(target) ? target : fight.players().find((p) => p.getHitpoints() > 0);
      if (!now) return;
      st.element = element;
      if (element === "blood") blood(fight, now); else spell(fight, now);
    };
    if (i === 0) cast(); else fight.at(i * (spec.castGap ?? 1), cast);
  }
  return true;
}

/** Ticks until her next attack: 2x speed for a spell in an element whose minion she consumed (kofi). */
function nextAttackIn(fight) {
  const st = state(fight);
  const { attackSpeed, consumedSpeed } = data();
  const down = Common.data.finale?.pillarsDown;
  if (fight.pillarsDown && !fight.cutscene && down?.attackSpeed) return down.attackSpeed;   // the last phase: every 4 (kofi)
  if (st.lastKind === "spell" && consumedSpeed && fight.consumed?.has(st.element)) return consumedSpeed;
  return attackSpeed;
}

module.exports = { attack, rotationAttack, melee, state, nextAttackIn, switchElement, setSoulSplit, inMeleeReach, drainPrayer, ELEMENTS };
