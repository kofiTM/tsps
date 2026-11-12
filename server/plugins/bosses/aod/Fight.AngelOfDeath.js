/**
 * One fight with Nex: Angel of Death in an ::aod arena (docs/aod-fight.md). For now: her spawn
 * (Intro.AngelOfDeath) and then Nex's normal combat when attacked; the phases come next.
 * Driven by its own tick task, on Fight.Nex's pattern: at(ticks, action), cue(name, details) for the
 * bots (docs/aod-cues.md), her shouts, the HUD and the music.
 */
const Common = require("./Common.AngelOfDeath");
const NexCommon = require("../nex/Common.Nex");

/** Units that need the fight (required late: they require Common, not this). */
const Attacks = () => require("./Attacks.AngelOfDeath");
const Lockdown = () => require("./Lockdown.AngelOfDeath");
const Specials = () => require("./Specials.AngelOfDeath");
const Minions = () => require("./Minions.AngelOfDeath");
const NexSpecials = require("../nex/Specials.Nex");

class Fight {
  constructor(area) {
    this.area = area;
    this.tick = 0;
    this.events = [];
    this.cues = [];
    this.cueSeq = 0;
    this.stage = "intro";
    this.phase = 1;
    this.boss = null;
    this.hudShown = new Set();
    this.musicPlayers = new Set();
    this.lastHud = null;
    this.stopped = false;
    // her attacks (from when she is active)
    this.nextAttackTick = Infinity;
    this.busyUntil = 0;
    this.target = null;
    this.attacksOnTarget = 0;
    this.autosSinceSpecial = 0;
    this.specialDue = Infinity;
    this.specialRound = [];
    this.lastHitBy = new Map();
    // what Nex's specials (Specials.Nex, run by Specials.AngelOfDeath) read and leave on players
    this.effects = new NexSpecials.Effects(this);
    this.record = { coughing: new Set() };
    this.siphonUntil = 0;
    this.siphonReavers = [];
  }

  /** As Nex's fight.arena, for Nex's specials: the area their locs and clipping belong to. */
  get arena() {
    return { area: this.area };
  }

  /** Runs `action` `ticks` ticks into the fight (at least one). */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  /** Everyone in the arena. */
  players() {
    // The area keys players by world index, and a bot entered before it had one shares a slot with
    // another (kofi saw one of two test bots never attacked): count the arena's bots directly too.
    const out = new Set(this.area.getPlayers().filter((player) => player?.isRegistered?.()));
    for (const bot of this.area.bots ?? []) {
      if (bot?.isRegistered?.() && bot.getArea?.() === this.area) out.add(bot);
    }
    return [...out];
  }

  say(text) {
    NexCommon.say(this.boss, this.players(), text);
  }

  areaSound(entry, location = this.centre()) {
    const [id, delay, range] = Array.isArray(entry) ? entry : [entry, 0, 10];
    NexCommon.areaSound(this.players(), location, [id, delay ?? 0, range ?? 10]);
  }

  /** Her middle tile. */
  centre() {
    return this.boss.getLocation().transform(Common.SIZE >> 1, Common.SIZE >> 1);
  }

  /** Chebyshev distance from `location` (or a player, as Nex's specials pass) to her 5x5 body. */
  distanceTo(location) {
    const at = location?.getLocation ? location.getLocation() : location;
    return NexCommon.distanceToBody(at, this.boss.getLocation(), Common.SIZE);
  }

  /** What a bot reads (docs/aod-cues.md): numbered, newest last, the last 64 kept. */
  cue(name, details = {}) {
    this.cueSeq += 1;
    this.cues.push({ seq: this.cueSeq, name, tick: this.tick, ...details });
    if (this.cues.length > 64) this.cues.shift();
  }

  process() {
    if (this.stopped) return;
    this.tick++;
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) {
      try { event.action(); } catch (e) { console.error("[aod] fight event", e); }
      if (this.stopped) return;
    }
    for (const player of this.players()) if (!this.hudShown.has(player)) this.showHud(player);
    if (this.stage === "fighting") {
      try { this.effects.process(this.players()); } catch (e) { console.error("[aod] effects", e); }
      try { Minions().process(this); } catch (e) { console.error("[aod] minions", e); }
      this.checkPhase();
      if (this.stopped) return;
      this.act();
    }
    this.updateHud();
  }

  /** The last thing to hit each player (for death talk: docs/aod-cues.md). */
  noteHit(player, kind, amount) {
    if (amount > 0) this.lastHitBy.set(player, { kind, tick: this.tick });
  }

  // ------------------------------------------------------------------ phases

  /** The next phase once her hp is at or below its `below` (data.phases; phase 2 at 5000, kofi). */
  checkPhase() {
    if (!this.boss?.isRegistered?.()) return;
    const next = Common.data.phases?.[String(this.phase + 1)];
    if (!next || next.below == null || this.boss.getHitpoints() > next.below) return;
    if (Minions().holdsCentre(this)) return;   // the last minion first: then the next phase (kofi)
    this.enterPhase(this.phase + 1);
  }

  /** Phase `n` begins: its cue, and the minion it calls (phase 2: Fumus). */
  enterPhase(n, { skipped = false } = {}) {
    this.phase = n;
    const spec = Common.data.phases?.[String(n)] ?? {};
    this.cue("phase", { phase: n, hitpoints: this.boss.getHitpoints(), skipped });
    if (!spec.minion) return;
    if (skipped) Minions().skip(this, spec.minion);   // ::aodphase past it: as if consumed
    else Minions().call(this, spec.minion);
  }

  // ------------------------------------------------------------------ her turn

  /** From the end of her spawn: her first attack `inTicks` later. */
  begin(inTicks) {
    const { combat, specials } = Common.data;
    this.nextAttackTick = this.tick + inTicks;
    this.autosSinceSpecial = 0;
    this.specialDue = specials.firstAfter;
    this.specialRound = [];
    Attacks().state(this);
    void combat;
  }

  act() {
    const { combat, specials } = Common.data;
    if (!this.boss?.isRegistered?.() || this.boss.getHitpoints() <= 0) return;
    const alive = this.players().filter((p) => p.getHitpoints() > 0);
    if (alive.length === 0) { this.target = null; return; }
    if (!this.target || !alive.includes(this.target)) this.pickTarget(alive, "died");
    if (this.tick < this.busyUntil) return;
    if (this.rush) { this.rushStep(alive); return; }
    this.move();
    if (this.tick < this.nextAttackTick) return;
    if (this.startRush(alive)) return;
    if (this.autosSinceSpecial >= this.specialDue && !Minions().forcedElement(this) && !Minions().pillarsStanding(this)) {   // none while a minion lives or a pillar stands (kofi)
      // every `specials.every` attacks: Lockdown, then two of Nex's at random (Specials.AngelOfDeath)
      this.autosSinceSpecial = 0;
      this.specialDue = this.consumed?.has("ice") ? (specials.everyAfterGlacies ?? specials.every) : specials.every;   // 4 after Glacies (kofi)
      const ticks = Specials().start(this);
      if (ticks != null) {
        this.busyUntil = this.tick + ticks;
        this.nextAttackTick = this.tick + ticks;
        return;
      }
    }
    if (this.attacksOnTarget >= combat.retargetEvery) this.pickTarget(alive, "four");
    const rotating = this.pillarsDown && !this.cutscene && Common.data.finale?.pillarsDown?.rotation;   // the last phase (kofi)
    if (rotating ? Attacks().rotationAttack(this, this.target) : Attacks().attack(this, this.target)) {
      this.attacksOnTarget++;
      this.autosSinceSpecial++;
      this.nextAttackTick = this.tick + Attacks().nextAttackIn(this);   // 2x for a consumed element's spell (kofi)
    } else {
      // out of reach: someone else in range, else she waits a tick (and walks)
      const other = this.nearestInRange(alive, this.target);
      if (other && other !== this.target) this.pickTarget([other], "nearest");
    }
  }

  // ------------------------------------------------------------------ the last phase

  /** Glacies consumed (kofi): she stops, says her lines, then fights on with Nex's phase 5 (Zaros) magic. */
  finale() {
    const spec = Common.data.finale;
    if (!spec || this.finaleStarted) return;
    this.finaleStarted = true;
    const ticks = spec.lines.length * spec.every;
    this.busyUntil = Math.max(this.busyUntil, this.tick + ticks);
    this.nextAttackTick = Math.max(this.nextAttackTick, this.tick + ticks);
    this.boss.getMovementQueue().reset();
    this.boss.setMobileInteraction(null);
    spec.lines.forEach((line, i) => {
      const say = () => this.stage === "fighting" && this.say(line);
      if (i === 0) say(); else this.at(i * spec.every, say);
    });
    this.cue("finale", { lines: spec.lines, startsAt: this.tick + ticks });
    this.at(ticks, () => {
      if (this.stage !== "fighting") return;
      const st = Attacks().state(this);
      st.element = "zaros";        // her autos from now: Nex's phase 5 magic (Attacks.AngelOfDeath)
      this.finalStarted = true;    // the pillars attack, she can rush (Minions finalPillars, startRush)
      this.cue("element", { element: "zaros", previous: null });
      this.cue("phase", { phase: 6, hitpoints: this.boss.getHitpoints() });
      this.phase = 6;
    });
  }

  /** A pillar destroyed in phase 6 (kofi): a Fire Surge blast on it and 200 damage to her. */
  pillarDestroyed(pillar) {
    const spec = Common.data.finale?.pillarsDown;
    if (!spec) return;
    this.fireSurge(pillar);
    if (this.boss?.isRegistered?.()) NexCommon.damage(this.boss, spec.pillarDamage);
  }

  fireSurge(npc) {
    const fs = Common.data.finale.pillarsDown.fireSurge;
    npc.performGraphic(NexCommon.graphic(fs.graphic, { height: fs.height }));
    if (fs.sound) this.areaSound([fs.sound, 0, 20], npc.getLocation());
  }

  /**
   * The last pillar fell (kofi): she stops, "Nooooooo!!!", her Zaros spell at each pillar (a Fire Surge
   * blast as it lands), her lines, her siphon as five souls from each pillar flow into her, then the
   * phase: she can be hurt again and her Zaros magic is quicker (finale.pillarsDown).
   */
  allPillarsDown() {
    const spec = Common.data.finale?.pillarsDown;
    if (!spec || this.pillarsDown) return;
    this.pillarsDown = true;
    this.cutscene = true;          // no attacks, no rush, and she can't be hurt until the phase starts
    this.rush = null;
    const boss = this.boss;
    const end = spec.startTick;
    this.busyUntil = Math.max(this.busyUntil, this.tick + end);
    this.nextAttackTick = Math.max(this.nextAttackTick, this.tick + end);
    boss.getMovementQueue().reset();
    boss.setMobileInteraction(null);
    this.say(spec.say);
    this.cue("pillarsdown", { startsAt: this.tick + end });
    const live = () => this.stage === "fighting" && !this.stopped && boss?.isRegistered?.();
    const pillars = (this.area.pillars ?? []).filter((p) => p?.isRegistered?.());
    const zaros = NexCommon.data.fight.attacks.zaros;
    const a = NexCommon.data.fight.attacks;
    pillars.forEach((pillar, i) => this.at(spec.throwsFrom + i * spec.throwEvery, () => {
      if (!live() || !pillar.isRegistered?.()) return;
      boss.setPositionToFace?.(pillar.getLocation().transform(1, 1));
      boss.performAnimation(NexCommon.animation(zaros.anim));
      this.areaSound(zaros.sound);
      const cycles = NexCommon.projectile(boss, pillar, { ...zaros.projectile, start: a.projectileStart, angle: a.projectileAngle, progress: a.projectileProgress, endHeight: 90 });
      Common.later(NexCommon.landsIn(cycles), () => {
        if (!pillar.isRegistered?.()) return;
        pillar.performGraphic(NexCommon.graphic(zaros.impact, { height: zaros.impactHeight }));
        this.fireSurge(pillar);
      });
    }));
    for (const [tick, line] of spec.lines) this.at(tick, () => live() && this.say(line));
    this.at(spec.siphonTick, () => {
      if (!live()) return;
      boss.performAnimation(NexCommon.animation(spec.siphonAnim));
      for (const pillar of pillars) {
        const call = Common.data.intro.pillars.find((c) => c.pillar === pillar.__aodPillar);
        if (!call) continue;
        for (let k = 0; k < spec.souls; k++) {
          Common.later(1 + k * spec.soulEvery, () => {
            if (!live() || !pillar.isRegistered?.()) return;
            NexCommon.projectile(pillar, boss, call.projectile);
            this.areaSound(Common.data.intro.powerSound, pillar.getLocation());
          });
        }
      }
    });
    this.at(end, () => {
      if (!live()) return;
      this.cutscene = false;
      this.cue("phase", { phase: 7, hitpoints: boss.getHitpoints() });
      this.phase = 7;
    });
  }

  // ------------------------------------------------------------------ her rush (last phase)

  /** After Glacies (kofi): on an attack she may run at a random player, melee them, and teleport home. */
  startRush(alive) {
    const spec = Common.data.combat.rush;
    if (!spec || spec.enabled === false || !this.finalStarted || Math.random() >= spec.chance) return false;   // removed (kofi)
    const Attacks_ = Attacks();
    const pool = alive.filter((p) => !Attacks_.inMeleeReach(this, p) && this.distanceTo(p.getLocation()) > 0);
    if (pool.length === 0) return false;
    const target = NexCommon.pick(pool);
    this.rush = { target, until: this.tick + spec.giveUpTicks };
    this.target = target;
    this.boss.setMobileInteraction(null);   // faced, not followed: the run is hers alone
    this.boss.setMovementSteps?.(spec.steps);
    this.cue("rush", { target });
    this.rushStep(alive);
    return true;
  }

  /** A tick of her rush: on toward them (2 tiles), the melee once beside them, then straight home. */
  rushStep(alive) {
    const rush = this.rush;
    const target = rush.target;
    if (!alive.includes(target) || this.tick >= rush.until) { this.rushHome(); return; }
    if (Attacks().inMeleeReach(this, target)) {
      this.boss.getMovementQueue().reset();
      this.boss.setPositionToFace?.(target.getLocation());
      Attacks().melee(this, target);
      this.autosSinceSpecial++;
      this.nextAttackTick = this.tick + Common.data.combat.attackSpeed;
      this.at(1, () => this.rushHome());   // straight back to the middle (kofi)
      this.busyUntil = this.tick + 2;
      this.rush = { ...rush, done: true };
      return;
    }
    if (rush.done) return;
    this.boss.setPositionToFace?.(target.getLocation());
    // One straight run to the spot beside them (re-planned only if they move off it): planned afresh
    // every tick, and locked onto them so the engine moved her too, she zig-zagged (kofi).
    const dest = this.besideSpot(target.getLocation());
    if (rush.dest && rush.dest[0] === dest[0] && rush.dest[1] === dest[1] && this.boss.getMovementQueue().size?.() !== 0) return;
    rush.dest = dest;
    const mq = this.boss.getMovementQueue();
    mq.reset();
    let x = this.boss.getLocation().getX(), y = this.boss.getLocation().getY();
    for (let i = 0; i < 64 && (x !== dest[0] || y !== dest[1]); i++) {
      const dx = Math.sign(dest[0] - x), dy = Math.sign(dest[1] - y);   // diagonal first, then straight
      mq.walkStep(dx, dy);
      x += dx; y += dy;
    }
  }

  /** Her south-west tile so that `at` is beside her body on its nearest side, in the middle of that side. */
  besideSpot(at) {
    const S = Common.SIZE, h = S >> 1;
    const c = this.centre();
    const ex = at.getX() - c.getX(), ey = at.getY() - c.getY();
    if (Math.abs(ex) >= Math.abs(ey)) {
      return [ex >= 0 ? at.getX() - S : at.getX() + 1, at.getY() - h];   // they're east / west of her
    }
    return [at.getX() - h, ey >= 0 ? at.getY() - S : at.getY() + 1];     // north / south
  }

  /** The rush is over: she teleports back to the middle. */
  rushHome() {
    if (!this.rush) return;
    this.rush = null;
    const boss = this.boss;
    if (!boss?.isRegistered?.() || this.stage !== "fighting") return;
    const spec = Common.data.combat.rush;
    boss.setMovementSteps?.(1);
    boss.getMovementQueue().reset();
    const h = Common.SIZE >> 1;
    const home = this.area.local([Common.CENTRE[0] - h, Common.CENTRE[1] - h]);
    if (spec.teleportGraphic != null) NexCommon.tileGraphic(this.players(), this.centre(), spec.teleportGraphic);
    boss.moveTo(home);
    if (spec.teleportGraphic != null) NexCommon.tileGraphic(this.players(), this.centre(), spec.teleportGraphic);
    this.cue("rushhome", {});
  }

  /** Nearest first; after four attacks, the nearest other player in range (Nex's rule). */
  pickTarget(players, reason) {
    const others = players.filter((p) => p !== this.target);
    const pool = others.length ? others : players;
    const pick = this.nearestInRange(pool) ?? this.nearest(pool);
    if (!pick) return;
    if (pick !== this.target) this.cue("target", { target: pick, reason });
    this.target = pick;
    this.attacksOnTarget = 0;
    this.boss.setMobileInteraction(pick);
  }

  nearest(players) {
    let best = null, bestDistance = Infinity;
    for (const p of players) {
      const d = this.distanceTo(p.getLocation());
      if (d < bestDistance) { best = p; bestDistance = d; }
    }
    return best;
  }

  nearestInRange(players, except = null) {
    const range = Common.data.combat.magicRange;
    return this.nearest(players.filter((p) => p !== except && this.distanceTo(p.getLocation()) >= 1 && this.distanceTo(p.getLocation()) <= range));
  }

  /** Out of her range: she walks toward her target (a step a tick). */
  move() {
    const target = this.target;
    if (!target) return;
    if (Minions().holdsCentre(this)) return;   // a minion's phase: she stays in the middle (kofi)
    const d = this.distanceTo(target.getLocation());
    if (d >= 1 && d <= Common.data.combat.magicRange) return;
    const centre = this.centre(), at = target.getLocation();
    const mq = this.boss.getMovementQueue();
    if (d === 0) {
        // under her: she steps off them, away from where they stand
        mq.reset(); mq.walkStep(-Math.sign(at.getX() - centre.getX()) || 1, -Math.sign(at.getY() - centre.getY()) || 0);
        return;
    }
    mq.reset();
    mq.walkStep(Math.sign(at.getX() - centre.getX()), Math.sign(at.getY() - centre.getY()));
  }

  // ------------------------------------------------------------------ HUD and music

  hudValues() {
    return { npcId: Common.ANGEL_OF_DEATH, current: Math.max(0, this.boss?.getHitpoints?.() ?? 0), maximum: Common.data.hitpoints };
  }

  showHud(player) {
    if (!this.boss || this.stage === "ended") return;
    this.hudShown.add(player);
    Common.api.emitCustomEvent("boss-hud:show", { player, ...this.hudValues() });
    if (!this.musicPlayers.has(player)) {
      this.musicPlayers.add(player);
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: Common.data.intro.music });
      player.getPacketSender().sendSong(Common.data.intro.music);
    }
  }

  updateHud() {
    if (!this.boss) return;
    const values = this.hudValues();
    if (this.lastHud && this.lastHud.current === values.current) return;
    this.lastHud = values;
    for (const player of this.hudShown) Common.api.emitCustomEvent("boss-hud:update", { player, ...values, force: false });
  }

  hideHud(player) {
    if (!this.hudShown.delete(player)) return;
    Common.api.emitCustomEvent("boss-hud:hide", { player });
  }

  playerLeft(player) {
    this.hideHud(player);
    this.effects.playerLeft(player);
    if (this.musicPlayers.delete(player)) player.getPacketSender?.().sendSong(Common.data.intro.silence);
  }

  // ------------------------------------------------------------------ the end

  /** She died (`killed`) or the fight was ended (::aodend, the arena closing). */
  end(killed) {
    if (this.stage === "ended") return;
    this.stage = "ended";
    this.rush = null;
    this.cue("ended", { killed: !!killed, ticks: this.tick });
    for (const player of [...this.hudShown]) this.playerLeft(player);
    for (const player of [...this.musicPlayers]) this.playerLeft(player);
    if (!killed && this.boss?.isRegistered?.()) Common.api.removeNpc(this.boss);
    try { Lockdown().clear(this); } catch (e) { console.error("[aod] lockdown clear", e); }
    try { Specials().clear(this); } catch (e) { console.error("[aod] specials clear", e); }
    try { Minions().clear(this); } catch (e) { console.error("[aod] minions clear", e); }
    if (this.area.nex === this.boss) this.area.nex = null;
    if (this.area.fight === this) this.area.fight = null;
    this.stop();
  }

  stop() {
    this.stopped = true;
    this.events = [];
  }
}

/** A fight in `area`, driven by a tick task of its own. */
function open(area) {
  const fight = new Fight(area);
  area.fight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, null, false); }
    execute() {
      if (fight.stopped) { this.stop(); return; }
      fight.process();
    }
  })());
  return fight;
}

const fightOf = (npc) => {
  const fight = npc?.__aodFight;
  return fight && !fight.stopped ? fight : null;
};

/** Until she is active (the end of her spawn), hits on her do nothing; while she siphons, they heal her. */
function modifyHit({ npc, hit }) {
  if (npc?.__aodPillar) {   // no damage until Glacies is consumed (kofi), none once destroyed
    const fight = npc.getArea?.()?.fight;
    if (!npc.__aodDestroyed && fight && !fight.stopped && fight.consumed?.has("ice")) return;
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.()) attacker.getAsPlayer().sendMessage(npc.__aodDestroyed ? Common.data.pillarDestroyed : Common.data.pillarsProtected);
    return;
  }
  const consumed = npc?.__aodMinion?.fight?.minions?.get(npc.__aodMinion.element)?.consuming;
  if (consumed) {   // being consumed: nothing more lands on it
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    return;
  }
  {
    const f = fightOf(npc);
    if (f && npc === f.boss && f.stage === "fighting" && (f.cutscene || Minions().pillarsStanding(f))) {
      for (const part of hit.getHits()) part.setDamage(0);   // she can't be hurt while pillars stand, nor in her speech (kofi)
      hit.updateTotalDamage();
      const attacker = hit.getAttacker?.();
      if (attacker?.isPlayer?.()) attacker.getAsPlayer().sendMessage(Common.data.finale.pillarsDown.immune);
      return;
    }
  }
  const fight = fightOf(npc);
  if (!fight || npc !== fight.boss) return;
  if (fight.stage === "fighting") {
    if (fight.tick >= fight.siphonUntil) return;
    const total = hit.getTotalDamage?.() ?? 0;
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    if (total > 0) NexCommon.healNpc(npc, total, Common.data.hitpoints);   // Blood Siphon (Nex's rule)
    return;
  }
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
  const attacker = hit.getAttacker?.();
  if (attacker?.isPlayer?.()) attacker.getAsPlayer().sendMessage(Common.data.immune);
}

/** A minion's killing blow: she consumes it first (Minions.consume, kofi). */
function beforeDeath(event) {
  const npc = event.npc;
  if (npc?.__aodPillar) {   // a destroyed pillar stays standing (kofi: something comes for them later)
    event.preventDeath = true;
    if (npc.__aodDestroyed) return;
    npc.__aodDestroyed = true;
    npc.getCombat?.().reset?.();
    const fight = npc.getArea?.()?.fight;
    if (!fight || fight.stopped) return;
    fight.cue("pillardestroyed", { element: npc.__aodPillar, npc });
    if (fight.finalStarted) fight.pillarDestroyed(npc);
    if (fight.finalStarted && !fight.pillarsDown && !(fight.area.pillars ?? []).some((p) => Minions().pillarAlive(p))) fight.allPillarsDown();
    return;
  }
  if (!npc?.__aodMinion) return;
  if (Minions().consume(npc)) event.preventDeath = true;
}

function npcDied({ npc }) {
  if (npc?.__aodReaver) { Lockdown().reaverDied(npc); return; }
  if (npc?.__aodSiphonReaver) { Specials().reaverDied(npc); return; }
  if (npc?.__aodAmalgamation) { Minions().amalgamationDied(npc); return; }
  if (npc?.__aodMinion) { Minions().minionDied(npc); return; }
  const fight = fightOf(npc);
  if (fight && npc === fight.boss) fight.end(true);
}

/** Her attacks are the fight's, never the engine's (as Fight.Nex's scriptedClass). */
function scriptedClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class AngelOfDeathScriptedCombat extends CombatMethod {
    start() {}
    hits() { return []; }
    attackSpeed() { return 100; }
    attackDistance() { return 64; }
    canAttack() { return false; }
    type() { return CombatType.MAGIC; }
  };
}

function attachFight(api) {
  api.registerNpcCombatMethodProvider(Common.ANGEL_OF_DEATH, scriptedClass());
  api.onNpcHitModify(modifyHit);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(npcDied);
}

module.exports = { Fight, open, fightOf, attachFight };
