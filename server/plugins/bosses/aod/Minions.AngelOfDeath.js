/**
 * Her minions (kofi, 2026-11-11; data/aod.json "minions"). When a phase calls one (phase 2: Fumus):
 *   - she shouts its name ("Fumus!") and turns to its spot, the reaver spawn in its element's
 *     quadrant (lockdown.reaverCorners);
 *   - its RS3 amalgamation appears there (npcs 17007-17010, aod_amalgamations.py): static, no
 *     animations, 500 hp, never hits back; it just floats there and gets attacked;
 *   - once the amalgamation is killed, the minion itself (OSRS Fumus 11283, ...) appears in its place.
 *     Fumus stands still and casts Smoke Barrage every 3 ticks at a different player in his quadrant;
 *     while he lives everyone coughs (Nex's virus) and she only casts smoke. From her call until he
 *     dies she stays in the middle.
 *   - while either is up, every 2 ticks each other quadrant's pillar hits whoever stands in its
 *     quadrant with its own spell, and every 4 ticks the minion's own pillar hits one random player
 *     in its quadrant (kofi; data/aod.json minions.outside / inside).
 * Cues: minion, amalgamation, amalgamationdied, minionarrived (docs/aod-cues.md).
 */
const Common = require("./Common.AngelOfDeath");
const NexCommon = require("../nex/Common.Nex");
const NexMages = require("../nex/Mages.Nex");

const data = () => Common.data.minions;

/** The quadrant of an element's pillar (lockdown.tell.pillars is quadrant -> element). */
function quadrantOf(element) {
  const pillars = Common.data.lockdown.tell.pillars;
  return Object.keys(pillars).find((q) => pillars[q] === element);
}

/** Its spot: the reaver spawn of its quadrant (arena-local [x, y]). */
function spotOf(element) {
  return Common.data.lockdown.reaverCorners[quadrantOf(element)];
}

function minionsOf(fight) {
  if (!fight.minions) fight.minions = new Map();   // element -> { amalgamation, minion }
  return fight.minions;
}

/** She calls `element`'s minion: its amalgamation appears at its spot. */
function call(fight, element) {
  const own = data()[element];
  if (!own || minionsOf(fight).has(element)) return;
  const { spawn } = require("./Arena.AngelOfDeath");
  const spot = spotOf(element);
  const tile = fight.area.local(spot);
  fight.say(own.callSay ?? own.say);   // "Fumus, it's time!" (kofi)
  fight.boss.faceTile?.(tile);
  const call = Common.data.intro.pillars.find((p) => p.pillar === element);
  if (call) {
    fight.boss.performAnimation(NexCommon.animation(call.anim));
    fight.areaSound(call.sound);
  }
  const npc = spawn(fight.area, Common.AMALGAMATIONS[element], spot);
  if (!npc) return;
  const hp = data().amalgamationHitpoints;
  npc.setFlag?.("combat:no-retaliate");
  npc.setFlag?.("combat:no-regen");
  npc.setMaxHitpoints?.(hp);
  npc.setHitpoints(hp);
  npc.getMovementQueue().setBlockMovement(true).reset();
  npc.__aodAmalgamation = { fight, element };
  const siphon = NexCommon.data.specials.siphon;   // the reavers' arrival (Nex's siphon)
  npc.performGraphic(NexCommon.graphic(siphon.reaverGraphic));
  fight.areaSound(siphon.reaverSound, npc.getLocation());
  minionsOf(fight).set(element, { amalgamation: npc, minion: null });
  goHome(fight);                                   // she stays in the middle for the whole phase (kofi)
  fight.cue("minion", { element, name: own.name });
  fight.cue("amalgamation", { element, npc, tile: npc.getLocation().clone(), local: spot, hitpoints: hp });
}

/** Its amalgamation died: the minion appears in its place. */
function amalgamationDied(npc) {
  const { fight, element } = npc.__aodAmalgamation;
  const entry = minionsOf(fight).get(element);
  if (!entry || fight.stopped || fight.stage === "ended") return;
  entry.amalgamation = null;
  fight.cue("amalgamationdied", { element, npc });
  const own = data()[element];
  const { spawn } = require("./Arena.AngelOfDeath");
  const spot = spotOf(element);
  const minion = spawn(fight.area, own.npc, spot);
  if (!minion) return;
  minion.setFlag?.("combat:no-retaliate");          // no combat yet (kofi: it comes later)
  minion.setFlag?.("combat:no-regen");
  const hp = data().minionHitpoints;                 // set only while testing (kofi: 1); otherwise its own
  if (hp != null) { minion.setMaxHitpoints?.(hp); minion.setHitpoints(hp); minion.__aodMaxHitpoints = hp; }
  minion.getMovementQueue().setBlockMovement(true).reset();
  minion.faceTile?.(fight.centre());
  minion.__aodMinion = { fight, element };
  minion.__nexMage = own.name.toLowerCase();         // for Nex's mage effects (Mages.Nex applyEffect); no __nexFight, so Nex's hooks leave it alone
  const arrival = NexCommon.data.spawn.mageArrival;  // Nex's mages' arrival
  minion.performGraphic(NexCommon.graphic(arrival.graphic));
  minion.performAnimation(NexCommon.animation(arrival.anim));
  fight.areaSound(arrival.sound, minion.getLocation());
  entry.minion = minion;
  fight.noLockdown = true;                          // no more Elemental Lockdown once a minion is out (kofi)
  fight.say(own.say);
  fight.cue("minionarrived", { element, name: own.name, npc: minion, tile: minion.getLocation().clone(), local: spot });
}

/** Her south-west tile when centred on CENTRE. */
function homeTile(fight) {
  const h = Common.SIZE >> 1;
  return fight.area.local([Common.CENTRE[0] - h, Common.CENTRE[1] - h]);
}

/** While a minion's phase lasts (its amalgamation or it alive), and in the last phase (Glacies consumed), she stays in the middle. */
function holdsCentre(fight) {
  if (fight.consumed?.has("ice")) return true;
  for (const entry of fight.minions?.values() ?? []) {
    if ([entry.minion, entry.amalgamation].some((n) => n?.isRegistered?.() && n.getHitpoints() > 0)) return true;
  }
  return false;
}

/**
 * From the moment she calls a minion (its amalgamation up, then the minion) she only casts its element:
 * no melee, no specials (kofi). Not while she consumes it; null otherwise.
 */
function forcedElement(fight) {
  for (const [element, entry] of fight.minions ?? []) {
    if (entry.consuming) continue;
    if ([entry.minion, entry.amalgamation].some((n) => n?.isRegistered?.() && n.getHitpoints() > 0)) return element;
  }
  return null;
}

/** She leaps out of sight and falls back onto the middle (Lockdown's leap and fall), if she isn't there. */
function goHome(fight) {
  const home = homeTile(fight);
  const boss = fight.boss;
  if (!boss?.isRegistered?.() || boss.getLocation().equals(home)) return;
  const lock = Common.data.lockdown;
  boss.getMovementQueue().reset();
  boss.setMobileInteraction(null);
  boss.performAnimation(NexCommon.animation(lock.jumpAnim));
  fight.busyUntil = Math.max(fight.busyUntil, fight.tick + lock.landTick + 1);
  fight.nextAttackTick = Math.max(fight.nextAttackTick, fight.tick + lock.landTick + 1);
  fight.at(lock.dropTick, () => {
    if (fight.stage !== "fighting" || !boss.isRegistered?.()) return;
    boss.moveTo(home);
    boss.performAnimation(NexCommon.animation(lock.landAnim));
    fight.areaSound(Common.data.intro.landSound);
  });
}

/**
 * Fumus's Smoke Barrage (kofi): every 3 ticks at a player in his quadrant, never the one he hit last
 * when there is another; anyone in the 3x3 round them is hit too. Nex's Fumus numbers (data/nex.json
 * mages: max 29, poison, his projectile and impact); Protect from Magic blocks it.
 */
function minionAttack(fight, element, entry) {
  const own = data()[element];
  const spec = own.attack;
  const npc = entry.minion;
  if (!spec || !npc?.isRegistered?.() || npc.getHitpoints() <= 0 || entry.consuming) return;
  if (fight.tick < (entry.nextAttack ?? 0)) return;
  const { quadrantOf: quadrantAt } = require("./Lockdown.AngelOfDeath");
  const home = quadrantOf(element);
  const inside = fight.players().filter((p) => p.getHitpoints() > 0 && quadrantAt(fight.area.localOf(p.getLocation())) === home);
  if (inside.length === 0) return;
  entry.attacks = (entry.attacks ?? 0) + 1;
  if (spec.poolEvery && entry.attacks % spec.poolEvery === 0) {
    // every 4th of Umbra's attacks: Nex's shadow pools under everyone in his quadrant (kofi)
    entry.nextAttack = fight.tick + spec.every;
    npc.performAnimation(NexCommon.animation(NexCommon.data.mages.anim));
    require("./Specials.AngelOfDeath").pools(fight, inside);
    fight.cue("minionpools", { element, npc, players: inside });
    return;
  }
  const others = inside.filter((p) => p !== entry.lastTarget);
  const target = NexCommon.pick(others.length ? others : inside);
  entry.lastTarget = target;
  entry.nextAttack = fight.tick + spec.every;
  const mages = NexCommon.data.mages;
  const nexOwn = mages[own.name.toLowerCase()];      // Nex's Fumus / Umbra / Cruor / Glacies
  if (!nexOwn) return;
  npc.faceTile?.(target.getLocation());
  npc.performAnimation(NexCommon.animation(mages.anim));
  fight.areaSound([nexOwn.sound, 0, 7], npc.getLocation());
  const cycles = nexOwn.projectile ? NexCommon.projectile(npc, target, nexOwn.projectile) : 30 * mages.hitDelay;
  const at = target.getLocation();
  const hit = fight.players().filter((p) => p.getHitpoints() > 0
    && Math.max(Math.abs(p.getLocation().getX() - at.getX()), Math.abs(p.getLocation().getY() - at.getY())) <= spec.radius);
  for (const player of hit) {
    NexCommon.strike(npc, player, "magic", mages.maxHit, NexCommon.landsIn(cycles), {
      prayed: (prayer) => (prayer === "magic" ? 0 : 1),
      landed: (damage, accurate) => {
        if (!accurate) {
          const splash = NexCommon.data.fight.attacks.splash;
          player.performGraphic(NexCommon.graphic(splash.graphic, { height: splash.height }));
          return;
        }
        player.performGraphic(NexCommon.graphic(nexOwn.impact, { height: nexOwn.impactHeight ?? 0, delay: nexOwn.impactDelay ?? 0 }));
        NexMages.applyEffect(npc, player, damage);   // Nex's own: Fumus poisons, Umbra blinds, Cruor heals, Glacies freezes
        const cap = npc.__aodMaxHitpoints;          // Cruor's heal stays within his own (test) hitpoints
        if (cap != null && npc.isRegistered?.() && npc.getHitpoints() > cap) npc.setHitpoints(cap);
        fight.noteHit(player, `minion-${element}`, damage);
      },
    });
  }
  fight.cue("minionattack", { element, npc, target, players: hit });
}

/**
 * The killing blow on a minion (kofi): it doesn't die yet. "Take my power!!", and it stands there while
 * she consumes it: her Zaros spell (Nex's phase 5 magic) at it, five Soul Split souls from it to her,
 * then it casts Nex's Wrath over its whole quadrant and is gone (minions.consumed in aod.json).
 * Returns true when the death was taken over.
 */
function consume(npc) {
  const info = npc.__aodMinion;
  const fight = info?.fight;
  const entry = fight?.minions?.get(info.element);
  if (!entry || entry.consuming || fight.stopped || fight.stage !== "fighting") return false;
  const c = data().consumed;
  const element = info.element;
  entry.consuming = true;
  npc.setHitpoints(1);
  npc.resetAttributes?.();
  npc.getCombat?.().reset?.();
  npc.performAnimation(NexCommon.animation(-1));
  npc.setMobileInteraction?.(null);
  npc.faceTile?.(fight.centre());                   // he looks at her as he gives her his power (kofi)
  NexCommon.say(npc, fight.players(), c.say);
  fight.cue("minionconsumed", { element, npc });
  const boss = fight.boss;
  const nexData = NexCommon.data;
  const zaros = nexData.fight.attacks.zaros;
  const quiet = c.damageTick + 1;
  fight.busyUntil = Math.max(fight.busyUntil, fight.tick + quiet);
  fight.nextAttackTick = Math.max(fight.nextAttackTick, fight.tick + quiet);
  const alive = () => fight.stage === "fighting" && !fight.stopped && boss?.isRegistered?.() && npc.isRegistered?.();
  // her Zaros spell at it
  const spell = () => {
    if (!alive()) return;
    boss.getMovementQueue().reset();
    boss.setMobileInteraction(npc);
    boss.performAnimation(NexCommon.animation(zaros.anim));
    fight.areaSound(zaros.sound);
    const a = nexData.fight.attacks;
    const cycles = NexCommon.projectile(boss, npc, { ...zaros.projectile, start: a.projectileStart, angle: a.projectileAngle, progress: a.projectileProgress });
    Common.later(NexCommon.landsIn(cycles), () => {
      if (!npc.isRegistered?.()) return;
      npc.performGraphic(NexCommon.graphic(zaros.impact, { height: zaros.impactHeight }));
      fight.areaSound(zaros.impactSound, npc.getLocation());
    });
  };
  if (c.spellTick > 0) Common.later(c.spellTick, spell); else spell();
  // its souls to her
  const ss = Common.data.combat.soulSplit;
  for (let i = 0; i < c.clouds; i++) {
    Common.later(c.cloudsFrom + i, () => {
      if (!alive()) return;
      const cycles = NexCommon.projectile(npc, boss, ss.projectile);
      fight.areaSound([ss.sound, 0, 10], npc.getLocation());
      Common.later(NexCommon.landsIn(cycles), () => alive() && fight.areaSound(ss.healSound));
    });
  }
  // its Wrath over the whole quadrant
  const wrath = nexData.wrath;
  Common.later(c.wrathTick, () => {
    if (!alive()) return;
    boss.setMobileInteraction(null);
    NexCommon.say(npc, fight.players(), c.wrathSay ?? wrath.say);   // "Taste her wrath!" (kofi)
  });
  Common.later(c.blastTick, () => {
    if (!alive()) return;
    quadrantBlast(fight, npc, element, c.blastStep);
    npc.performAnimation(NexCommon.animation(836));   // he goes down as his power leaves him
  });
  Common.later(c.goneTick, () => { if (npc.isRegistered?.()) Common.api.removeNpc(npc); });
  Common.later(c.damageTick, () => {
    if (fight.stage === "fighting" && !fight.stopped) {
      const { quadrantOf: quadrantAt } = require("./Lockdown.AngelOfDeath");
      const home = quadrantOf(element);
      for (const player of fight.players()) {
        if (player.getHitpoints() <= 0 || quadrantAt(fight.area.localOf(player.getLocation())) !== home) continue;
        const dmg = NexCommon.randomInt(0, wrath.maxHit);
        NexCommon.damage(player, dmg);
        fight.noteHit(player, `wrath-${element}`, dmg);
      }
    }
    minionDied(npc);
  });
  return true;
}

/** Nex's Wrath blast spread over a whole quadrant: its centre graphic on the minion, bursts every `step` tiles. */
function quadrantBlast(fight, npc, element, step) {
  const wrath = NexCommon.data.wrath;
  const players = fight.players();
  const { midline: m, interior: [lo, hi] } = Common.data.lockdown;
  const q = quadrantOf(element);
  const xs = q.endsWith("e") ? [m + 1, hi] : [lo, m - 1];
  const ys = q.startsWith("n") ? [m + 1, hi] : [lo, m - 1];
  const centre = npc.getLocation();
  NexCommon.tileGraphic(players, centre, wrath.centreGraphic);
  for (let x = xs[0]; x <= xs[1]; x += step) {
    for (let y = ys[0]; y <= ys[1]; y += step) {
      const tile = fight.area.local([x, y]);
      const end = 16 + 4 * NexCommon.randomInt(0, 6);
      if ((x + y) % (step * 2) === 0) NexCommon.projectile(centre, tile, { ...wrath.projectile, start: 0, end, area: fight.area });
      NexCommon.tileGraphic(players, tile, wrath.tileGraphic, { delay: end });
    }
  }
  for (const sound of wrath.sounds) fight.areaSound([sound[0], sound[1], 20], centre);
}

/** The minion died: its phase is over (she can move and use everything again). */
function minionDied(npc) {
  const { fight, element } = npc.__aodMinion;
  const entry = fight.minions?.get(element);
  if (entry) entry.minion = null;
  if (!fight.consumed) fight.consumed = new Set();
  fight.consumed.add(element);   // her spells in this element are 2x speed from now (kofi)
  if (element === "ice") fight.specialDue = Math.min(fight.specialDue, Common.data.specials.everyAfterGlacies ?? fight.specialDue);   // the next special 4 attacks on
  fight.cue("miniondied", { element, name: data()[element]?.name });
  if (element === "ice") fight.finale?.();   // all four gone: her lines, then the last phase (kofi)
}

/** The pillar of quadrant `q` throws its own element's spell at `player` (her as the attacker). */
function pillarShot(fight, q, players, { onDamage = null } = {}) {
  const out = data().outside;
  const element = Common.data.lockdown.tell.pillars[q];
  const pillar = fight.area.pillars?.find((npc) => npc.__aodPillar === element && pillarAlive(npc));
  if (!pillar || players.length === 0) return;
  const style = element === "shadow" ? "ranged" : "magic";
  const nexStyle = NexCommon.data.fight.attacks[element];
  fight.areaSound(nexStyle.sound, pillar.getLocation());
  for (const player of players) {
    const cycles = NexCommon.projectile(pillar, player, {
      id: Common.data.combat.elements[element].projectile, start: out.start,
      startHeight: out.startHeight, endHeight: out.endHeight, angle: out.angle, progress: out.progress,
    });
    NexCommon.strike(fight.boss, player, style, out.max, NexCommon.landsIn(cycles), {
      prayed: (prayer) => (prayer === style ? 1 - out.prayed : 1),
      landed: (damage) => {
        if (nexStyle.impact > 0) player.performGraphic(NexCommon.graphic(nexStyle.impact, { height: nexStyle.impactHeight }));
        player.getPacketSender().sendSoundEffect(nexStyle.impactSound, 1, 0);
        fight.noteHit(player, `pillar-${element}`, damage);
        if (onDamage) onDamage(damage, pillar);
      },
    });
  }
}

/**
 * Each tick of the fight, while a minion's amalgamation or the minion is up (kofi):
 *  - every 2 ticks, each other quadrant's pillar hits everyone standing in its quadrant;
 *  - every 4 ticks, the minion's own quadrant's pillar hits one random player standing in it.
 */
function process(fight) {
  finalPillars(fight);
  if (!fight.minions?.size) return;
  cough(fight);
  for (const [element, entry] of fight.minions) minionAttack(fight, element, entry);
  const { outside, inside } = data();
  const outsideDue = outside && fight.tick % outside.every === 0;
  const insideDue = inside && fight.tick % inside.every === 0;
  if (!outsideDue && !insideDue) return;
  const { quadrantOf: quadrantAt } = require("./Lockdown.AngelOfDeath");
  const home = new Set();
  for (const [element, entry] of fight.minions) {
    if ([entry.minion, entry.amalgamation].some((n) => n?.isRegistered?.() && n.getHitpoints() > 0)) home.add(quadrantOf(element));
  }
  if (home.size === 0) return;
  const byQuadrant = new Map();
  for (const player of fight.players()) {
    if (player.getHitpoints() <= 0) continue;
    const q = quadrantAt(fight.area.localOf(player.getLocation()));
    if (q == null) continue;
    if (!byQuadrant.has(q)) byQuadrant.set(q, []);
    byQuadrant.get(q).push(player);
  }
  for (const [q, players] of byQuadrant) {
    if (home.has(q)) { if (insideDue) pillarShot(fight, q, [NexCommon.pick(players)]); }
    else if (outsideDue) pillarShot(fight, q, players);
  }
}

/** Phase 6 (after her lines): every standing pillar hits everyone in its quadrant every 4 ticks; every 4th is its special (kofi). */
function finalPillars(fight) {
  const spec = data().final;
  if (!spec || !fight.finalStarted || fight.tick % spec.every !== 0) return;
  const { quadrantOf: quadrantAt } = require("./Lockdown.AngelOfDeath");
  const byQuadrant = new Map();
  for (const player of fight.players()) {
    if (player.getHitpoints() <= 0) continue;
    const q = quadrantAt(fight.area.localOf(player.getLocation()));
    if (q == null) continue;
    if (!byQuadrant.has(q)) byQuadrant.set(q, []);
    byQuadrant.get(q).push(player);
  }
  for (const [q, players] of byQuadrant) {
    const element = Common.data.lockdown.tell.pillars[q];
    const pillar = fight.area.pillars?.find((npc) => npc.__aodPillar === element && pillarAlive(npc));
    if (!pillar) continue;                                   // a destroyed pillar throws nothing
    pillar.__aodAttacks = (pillar.__aodAttacks ?? 0) + 1;
    const special = spec.specialEvery && pillar.__aodAttacks % spec.specialEvery === 0 ? spec.specials?.[element] : null;
    if (special) pillarSpecial(fight, pillar, element, special, players);
    else pillarShot(fight, q, players);
  }
}

/** A pillar's special on its own quadrant (Nex's, cast from the pillar at `players` only). */
function pillarSpecial(fight, pillar, element, special, players) {
  fight.cue("pillarspecial", { element, special, npc: pillar, players });
  if (special === "pools") { require("./Specials.AngelOfDeath").pools(fight, players); return; }
  if (special === "siphon") {
    const q = quadrantOf(element);
    pillarShot(fight, q, players, { onDamage: (damage, p) => {
      if (damage > 0 && p.isRegistered?.()) NexCommon.healNpc(p, damage, Common.data.pillarHitpoints ?? 500);
    } });
    return;
  }
  // Nex's own (Specials.Nex), on a stand-in fight: the pillar casts it, and only this quadrant counts
  const shim = Object.create(fight);
  shim.boss = pillar;
  shim.players = () => players.filter((p) => p.isRegistered?.() && fight.players().includes(p));
  shim.say = () => {};
  const NexSpecials = require("../nex/Specials.Nex");
  NexSpecials.run(shim, special === "cough" ? "virus" : special);
}

/** A pillar still in the fight: there and not destroyed (destroyed ones stay standing, kofi). */
function pillarAlive(npc) {
  return !!npc?.isRegistered?.() && !npc.__aodDestroyed && npc.getHitpoints() > 0;
}

/** Phase 6 while any pillar stands: Zaros magic and rushes only, Soul Split always on (kofi). */
function pillarsStanding(fight) {
  return !!fight.finalStarted && (fight.area.pillars ?? []).some(pillarAlive);
}

/** While a coughing minion (Fumus) lives, everyone has Nex's Smoke Cough at all times (kofi). */
function cough(fight) {
  for (const [element, entry] of fight.minions) {
    if (!data()[element]?.cough || !entry.minion?.isRegistered?.() || entry.minion.getHitpoints() <= 0 || entry.consuming) continue;
    for (const player of fight.players()) {
      if (player.getHitpoints() > 0 && !fight.effects.virus.has(player)) fight.effects.infect(player, false);
    }
  }
}

/** ::aodphase past a minion's phase: its amalgamation or minion goes as if consumed (no sequence). */
function skip(fight, element) {
  const entry = minionsOf(fight).get(element) ?? { amalgamation: null, minion: null };
  for (const npc of [entry.amalgamation, entry.minion]) if (npc?.isRegistered?.()) Common.api.removeNpc(npc);
  minionsOf(fight).set(element, { amalgamation: null, minion: null });
  if (!fight.consumed) fight.consumed = new Set();
  fight.consumed.add(element);
  fight.noLockdown = true;
}

/** The fight ended: amalgamations and minions go. */
function clear(fight) {
  for (const entry of minionsOf(fight).values()) {
    for (const npc of [entry.amalgamation, entry.minion]) if (npc?.isRegistered?.()) Common.api.removeNpc(npc);
  }
  fight.minions = new Map();
}

module.exports = { pillarsStanding, pillarAlive, call, amalgamationDied, consume, minionDied, skip, process, clear, spotOf, holdsCentre, forcedElement };
