/**
 * One fight with Nex, in the public chamber or a private one (an arena: Chamber.Nex or
 * Instance.Nex), as captured (docs/nex.md):
 * - "AT LAST!": she appears in her spawning form and calls her four mages one by one, then "Fill my
 *   soul with smoke!" begins the smoke phase; she can't be hurt until her first attack.
 * - Five phases (smoke, shadow, blood, ice, Zaros). At 80/60/40/20% she calls the phase's mage
 *   ("Fumus, don't fail me!"), who becomes vulnerable; she still takes damage down to 75/55/35/15%,
 *   then nothing until the mage dies, and the next phase begins a tick after its death.
 * - An attack every 4 ticks (Attacks.Nex); every 6th is a special (Specials.Nex), the phase's
 *   first coming 4 ticks after its line. The Zaros phase heals her 500 and cycles her curses.
 * - At 0 hitpoints, Wrath: "Taste my wrath!", the blast four ticks later and its damage with the
 *   loot three ticks after that.
 */
const Common = require("./Common.Nex");
const Attacks = require("./Attacks.Nex");
const Specials = require("./Specials.Nex");
const { sendBossKillCount } = require("../../interface/BossKillCount.plugin");

const SIZE = 3;
const BOSS_NAME = "Nex";

/** A player gone invisible (AdminCommands ::invis answers): out of the fight for her. */
function invisible(player) {
  const query = { player, invisible: false };
  Common.api.emitCustomEvent("admin:is-invisible", query);
  return query.invisible === true;
}
/**
 * Ticks her target can stand under her before she walks out after them: she holds still for these
 * (a 5-tick stall, Wiki: Nex/Strategies), and from the next - the 6th - walks off them to attack.
 */
const UNDER_HOLD_TICKS = 5;
/**
 * Off the middle with someone under her for this many ticks (walking her back) - counted from the
 * tick after they first stood there, never reset by her walking - she darts the rest of the way home.
 * Wiki (Nex/Strategies): out of combat for 8 ticks she flies, and with the player under her at the
 * edges of the room she dashes to the centre.
 */
const SEND_HOME_TICKS = 8;
/** Up to two ticks out from under her (a bot catching up as she runs) doesn't start her count again. */
const UNDER_GAP_TICKS = 2;
/**
 * Up to this many ticks after a special starts, the walk home is only paused, not started again:
 * Shadow Smash puts a shadow under whoever is walking her (they step off it), and Blood Siphon drops
 * her target while she kneels (8 ticks). Restarting the count each time made the walk much longer
 * before her dart home (kofi's call).
 */
const SPECIAL_PAUSE_TICKS = 12;
/** Her specials (not her autos) whose hits are listed for talk (specialHits). */
const SPECIAL_HITS = new Set(["darkness", "dash", "smash", "sacrifice", "containment", "prison"]);
/** A Blood Siphon that heals her at least this much in all is cued as a big heal ("bigheal"). */
const BIG_SIPHON_HEAL = 60;
/**
 * Now and then, on an attack, she runs at her target to melee them instead of shooting - RUSH_CHANCE an
 * attack, given up after RUSH_TICKS if she can't get there. OSRS has it in the shadow phase; here it's
 * every phase (server custom: kofi's call).
 */
const RUSH_CHANCE = 0.08;
/** A little more often while one of her mages is up and being killed (kofi's call: not by much). */
const RUSH_CHANCE_MINION = 0.12;
const RUSH_TICKS = 10;
/**
 * A rush still closing in on its target runs on past RUSH_TICKS, up to this long in all: it timed out
 * as she got there round a teammate or a mage, so she never swung and the bot stepped under her
 * instead (kofi saw it). Reaching them she always gets her melee hit.
 */
const RUSH_MAX_TICKS = 20;
/** How far (tiles) a rush looks for a way round something blocking its straight run. */
const RUSH_PATH_RADIUS = 18;
/**
 * Shadow phase: now and then a re-target picks someone out of her range on purpose, and she flies to
 * them (the bot there then walks her back to the middle).
 */
const SHADOW_FAR_TARGET_CHANCE = 0.15;
/** After a flight she can't fly again this soon: never two teleports back to back. */
const FLY_GRACE_TICKS = 20;

class Fight {
  /**
   * `arena`: { area, tile([x,y,z]), real(location) -> [x, y], inChamber(location), players(),
   * spawn(id, tile), spawnAt(id, location), ended(fight, killed) } - Chamber.Nex or Instance.Nex.
   */
  constructor(arena) {
    const { fight } = Common.data;
    this.arena = arena;
    this.tick = 0;
    this.events = [];
    this.stage = "spawning";
    this.phaseIndex = 0;
    this.boss = null;
    this.mages = new Map();
    this.vulnerable = new Set();
    this.reavers = [];
    this.contribution = new Map();
    this.hudShown = new Set();
    this.musicPlayers = new Set();
    this.nextAttackTick = Infinity;
    this.lastAttackTick = 0;
    this.autosSinceSpecial = 0;
    this.specialDue = false;
    this.lane = 0;
    this.target = null;
    this.attacksOnTarget = 0;
    this.meleeChain = 0;
    this.noMeleeNext = false;
    this.curse = { form: null, attacks: 0, index: -1 };
    this.immuneUntil = 0;
    this.busyUntil = 0;
    this.siphonUntil = 0;
    this.hitpoints = fight.hitpoints;
    this.deaths = 0;
    this.startPlayers = 0;
    /** What the Combat Achievements judge: per player, the hits they took from each special. */
    this.record = { siphonHealed: false, hitBy: new Map(), coughing: new Set() };
    this.specialHits = [];
    /** The specials and Wrath as they start, newest last: what Bots.Nex's team reacts to. */
    this.cues = [];
    this.stopped = false;
    this.effects = new Specials.Effects(this);
    this.spawn();
  }

  // ------------------------------------------------------------------ helpers

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  /** Everyone in the fight: not a player who went invisible (::invis), whom she neither targets nor hits. */
  players() {
    return this.arena.players().filter((player) => !invisible(player));
  }

  phase() {
    return Common.data.fight.phases[this.phaseIndex];
  }

  /** The phase's key, for Peek: null before her smoke phase. */
  phaseName() {
    return this.stage === "spawning" ? null : this.phase().key;
  }

  tile(tile) {
    return this.arena.tile(tile);
  }

  centre() {
    return this.boss.getLocation().transform(1, 1);
  }

  distanceTo(player) {
    return Common.distanceToBody(player.getLocation(), this.boss.getLocation(), SIZE);
  }

  say(text) {
    Common.say(this.boss, this.players(), text);
  }

  areaSound(entry, location = this.centre()) {
    const [id, delay, range] = Array.isArray(entry) ? entry : [entry, 0, 7];
    Common.areaSound(this.players(), location, [id, delay ?? 0, range ?? 7]);
  }

  messageAll(text) {
    for (const player of this.players()) player.sendMessage(text);
  }

  form() {
    const id = this.boss?.getNpcTransformationId?.() ?? -1;
    return id > 0 ? id : Common.data.npcs.spawning;
  }

  transform(id) {
    this.boss.setNpcTransformationId(id);
    this.updateHud({ force: true });
  }

  isMage(npc) {
    return npc?.__nexFight === this && npc.__nexMage != null;
  }

  isImmuneMage(npc) {
    return this.isMage(npc) && !this.vulnerable.has(npc.__nexMage);
  }

  /** Damage to Nex, her mages and the reavers is each player's share (Wiki). */
  credit(player, amount) {
    if (!player || amount <= 0) return;
    this.contribution.set(player, (this.contribution.get(player) ?? 0) + amount);
  }

  /** A special (or Wrath) starting, with what a player would read off it: the aisle, the mark, the tiles. */
  cue(name, details = {}) {
    // Numbered, so a reader keeps its place by number: only the last 16 are kept, and a place kept by
    // position stuck at 16 once the list was full - the bots saw no special after that.
    this.cueSeq = (this.cueSeq ?? 0) + 1;
    this.cues.push({ seq: this.cueSeq, name, tick: this.tick, ...details });
    if (this.cues.length > 16) this.cues.shift();
  }

  /** A player was hit by a special (the Combat Achievements' "no damage from" tasks). */
  noteHit(player, special, amount) {
    if (amount <= 0) return;
    // The last thing to hit each player, for what killed them (Bots.Nex: death talk).
    this.lastHitBy = this.lastHitBy ?? new Map();
    this.lastHitBy.set(player, { kind: special, tick: this.tick });
    const hits = this.record.hitBy.get(player) ?? new Set();
    hits.add(special);
    this.record.hitBy.set(player, hits);
    // Her specials' hits, in order, for her bot teammates to talk about (Bots.Nex Team.hitWatch).
    if (SPECIAL_HITS.has(special)) this.specialHits.push({ player, special, amount, tick: this.tick });
  }

  // ------------------------------------------------------------------ the spawn

  /** "AT LAST!": her spawning form in the middle, the music and the HUD; then the mages. */
  spawn() {
    const { npcs, chamber, spawn, music } = Common.data;
    this.boss = this.arena.spawn(npcs.spawning, chamber.nexTile);
    if (!this.boss) {
      this.stop();
      return;
    }
    this.boss.faceTile(this.tile(chamber.entry));
    this.boss.__nexFight = this;
    this.boss.setFlag("combat:no-retaliate");
    // Her attacks are the fight's, so the engine would think her idle and regenerate her.
    this.boss.setFlag("combat:no-regen");
    // She faces her target at any range (her spells reach 10 tiles; the engine lets go sooner).
    this.boss.setFlag("interaction:keep");
    this.boss.setHitpoints(this.hitpoints);
    this.boss.getMovementQueue().setBlockMovement(false).reset();
    this.baseDefence = this.boss.getDefenceLevel?.() ?? null;
    this.boss.performAnimation(Common.animation(spawn.anim));
    this.areaSound(spawn.sound);
    this.say(spawn.say);
    for (const player of this.players()) {
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: music.fight });
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: music.blood });
      this.playSong(player, music.fight);
      this.showHud(player);
    }
    this.startPlayers = this.players().length;
    for (const call of spawn.calls) this.at(call.tick, () => this.callMage(call));
    this.at(spawn.fillTick, () => this.fill());
  }

  /** "Fumus!": she turns to the corner and the mage appears there, sending her its power. */
  callMage(call) {
    const { chamber, spawn } = Common.data;
    const corner = chamber.mages[call.mage];
    this.say(`${call.mage[0].toUpperCase()}${call.mage.slice(1)}!`);
    this.boss.performAnimation(Common.animation(call.anim));
    this.areaSound(call.sound);
    const at = this.tile(corner.tile);
    this.boss.faceTile(at);
    const mage = this.arena.spawn(Common.data.npcs.mages[call.mage], corner.tile);
    if (!mage) return;
    mage.faceTile(this.centre());
    mage.__nexFight = this;
    mage.__nexMage = call.mage;
    mage.setFlag("combat:no-regen");
    mage.getMovementQueue().setBlockMovement(true).reset();
    mage.performGraphic(Common.graphic(spawn.mageArrival.graphic));
    mage.performAnimation(Common.animation(spawn.mageArrival.anim));
    this.areaSound(spawn.mageArrival.sound, mage.getLocation());
    this.mages.set(call.mage, mage);
    this.sendPower(mage);
  }

  /** A mage's power, sent to her on its arrival and on its phase's line. */
  sendPower(mage) {
    const { power } = Common.data.spawn;
    if (!mage?.isRegistered?.()) return;
    mage.performAnimation(Common.animation(Common.data.spawn.mageArrival.anim));
    Common.projectile(mage, this.boss, power);
    this.areaSound(power.sound, mage.getLocation());
  }

  /** "Fill my soul with smoke!": her fighting form; the smoke phase opens with her first attack. */
  fill() {
    const { npcs, spawn } = Common.data;
    this.transform(npcs.nex);
    this.stage = "fighting";
    // She can be hit from "Fill my soul with smoke!" (teams spec her right away); she just holds her
    // first attack, and stays put, until firstAttackTick.
    this.busyUntil = this.tick + (spawn.firstAttackTick - spawn.fillTick);
    // Her idle clock starts with the fight, not at zero: the spawn isn't idling, and counted as
    // such she flew off the middle to her first target before her first attack.
    this.lastAttackTick = this.tick + (spawn.firstAttackTick - spawn.fillTick);
    this.startPhase(0, spawn.firstAttackTick - spawn.fillTick);
  }

  // ------------------------------------------------------------------ phases

  /** A phase's line, its mage's power, and a special `delay` ticks later. */
  startPhase(index, delay = Common.data.fight.specialAfterPhaseTicks) {
    this.phaseIndex = index;
    const phase = this.phase();
    this.say(phase.line);
    if (phase.mage) this.sendPower(this.mages.get(phase.mage));
    this.autosSinceSpecial = 0;
    this.meleeChain = 0;
    this.noMeleeNext = false;
    this.specialDue = phase.specials.length > 0;
    // The phase opens in the lane of the last special (captured: the virus leads to the darkness,
    // the dash to the smash).
    this.lane = this.lastLane ?? 0;
    this.nextAttackTick = this.tick + delay;
    if (phase.key === "blood") for (const player of this.players()) this.playSong(player, Common.data.music.blood);
    if (phase.key === "zaros") this.zaros();
  }

  /** "NOW, THE POWER OF ZAROS!": 500 hitpoints back; her curses start with her first attack. */
  zaros() {
    const { zaros, fight } = Common.data;
    this.boss.performAnimation(Common.animation(zaros.anim));
    this.boss.performGraphic(Common.graphic(zaros.graphic));
    Common.healNpc(this.boss, zaros.heal, fight.hitpoints);
    this.curse = { form: null, attacks: 0, index: -1 };
  }

  /** At the phase's line her mage becomes vulnerable. */
  checkCall() {
    const phase = this.phase();
    if (!phase.mage || this.vulnerable.has(phase.mage) || !this.mages.has(phase.mage)) return;
    if (this.boss.getHitpoints() > Math.floor(Common.data.fight.hitpoints * phase.call)) return;
    const mage = this.mages.get(phase.mage);
    this.vulnerable.add(phase.mage);
    this.say(Common.data.fight.callLine.replace("[name]", mage.getCurrentDefinition().getName()));
    const target = Common.pick(this.players().filter((player) => player.getHitpoints() > 0));
    if (target) mage.getCombat().attack(target);
  }

  /** The phase's mage died: the next phase's line a tick later (captured). */
  mageDied(key) {
    const mage = this.mages.get(key);
    this.mages.delete(key);
    this.vulnerable.delete(key);
    if (mage) Common.later(Common.data.fight.mageRemoveTicks, () => mage.isRegistered?.() && Common.api.removeNpc(mage));
    if (this.stage !== "fighting" || this.phase().mage !== key) return;
    const next = this.phaseIndex + 1;
    this.stage = "switching";
    Specials.phaseEnded(this, this.phase().key);
    this.nextAttackTick = Infinity;
    this.at(Common.data.fight.nextPhaseTicks, () => {
      if (this.stage !== "switching") return;
      this.stage = "fighting";
      this.startPhase(next);
    });
  }

  /** Wiki: her Defence can be lowered by 10 levels at most. */
  capDefenceDrain() {
    if (this.baseDefence == null || !this.boss.getDefenceLevel) return;
    const floor = this.baseDefence - Common.data.fight.maxDefenceDrain;
    if (this.boss.getDefenceLevel() < floor) this.boss.setDefenceLevel(floor);
  }

  // ------------------------------------------------------------------ each tick

  process() {
    if (this.stopped) return;
    this.tick++;
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    const players = this.players();
    // An invisible watcher (::invis) keeps the fight going and still sees her health bar.
    const everyone = this.arena.players();
    if (everyone.length === 0 && this.stage !== "dying") {
      this.end(false);
      return;
    }
    if (this.stage !== "dying") {
      for (const player of everyone) if (!this.hudShown.has(player)) this.showHud(player);
      this.updateHud();
    }
    this.effects.process(players);
    // A siphon over: a big heal from its hits is cued once (Bots.Nex Team.healWatch).
    if (this.siphonHealed && this.tick >= this.siphonUntil) {
      if (this.siphonHealed >= BIG_SIPHON_HEAL) this.cue("bigheal", { amount: this.siphonHealed, source: "siphon" });
      this.siphonHealed = 0;
    }
    if (this.stage !== "fighting") return;
    this.checkCall();
    this.capDefenceDrain();
    if (this.tick >= this.busyUntil) this.pickTarget(players);
    this.move();
    if (this.tick >= this.nextAttackTick) this.act();
  }

  /** Her turn: a special when one is due, otherwise her attack (Attacks.Nex). */
  act() {
    const { fight } = Common.data;
    this.nextAttackTick = this.tick + fight.attackSpeed;
    const phase = this.phase();
    if (phase.specials.length > 0 && (this.specialDue || this.autosSinceSpecial >= fight.specialEvery - 1)) {
      const name = phase.specials[this.lane % phase.specials.length];
      const hold = Specials.run(this, name);
      if (hold != null) {
        this.specialAt = this.tick;
        this.specialDue = false;
        this.autosSinceSpecial = 0;
        this.lastLane = this.lane;
        this.lane = (this.lane + 1) % phase.specials.length;
        this.nextAttackTick = this.tick + hold;
        this.lastAttackTick = this.tick;
        return;
      }
    }
    // In any phase: sometimes she runs at her target to melee them (move runs her there), holding the
    // attack until she's in reach; their first melee hit ends it (Bots.Nex's reset bot watches it).
    if (!this.rush && this.target && this.distanceTo(this.target) > 1 && Math.random() < (this.vulnerable.size > 0 ? RUSH_CHANCE_MINION : RUSH_CHANCE)) {
      this.rush = { target: this.target, until: this.tick + RUSH_TICKS, startedAt: this.tick };
      // She runs in to melee: a chain of melee hits before it doesn't make this one a spell.
      this.noMeleeNext = false;
      this.meleeChain = 0;
      this.cue("rush", { target: this.target });
    }
    // A rush ends on a new target or when it runs out - but not with her beside them: that's the hit
    // it ran in for, so she swings (melee: noMeleeNext was cleared as it started).
    const arrived = this.rush && this.target && Attacks.inMeleeReach(this, this.target);
    if (this.rush && (this.rush.target !== this.target || (this.tick >= this.rush.until && !arrived))) this.rush = null;
    if (this.rush && this.target && !Attacks.inMeleeReach(this, this.target)) {
      this.nextAttackTick = this.tick + 1;
      return;
    }
    const melee = !!this.target && Attacks.inMeleeReach(this, this.target) && !this.noMeleeNext;
    if (!Attacks.attack(this, this.target)) {
      // Couldn't reach them this tick (under her, out of range): she tries again next tick, so a
      // player stepping under her on her attack tick delays it - the 5-tick stall (Wiki). Out of her
      // range, she switches to anyone within it instead (Wiki: "every attack until she succeeds").
      this.nextAttackTick = this.tick + 1;
      if (this.target && this.target !== this.farPick && this.distanceTo(this.target) > Common.data.fight.magicRange) this.retargetInRange();
      if (this.target && this.distanceTo(this.target) === 0) this.blockedAt ??= this.tick;
      return;
    }
    this.lastAttackTick = this.tick;
    this.autosSinceSpecial++;
    this.attacksOnTarget++;
    if (melee) {
      this.lastMelee = { target: this.target, tick: this.tick };
      this.rush = null;
    }
    if (phase.key === "zaros") this.rotateCurse();
  }

  /** Zaros: Soul Split on her first attack, Deflect Melee 4 attacks later, then none, and round (Wiki). */
  rotateCurse() {
    const { npcs, zaros } = Common.data;
    const forms = [npcs.soulSplit, npcs.deflect, npcs.nex];
    if (this.curse.index >= 0 && ++this.curse.attacks < zaros.curseEvery) return;
    this.curse.attacks = 0;
    this.curse.index = (this.curse.index + 1) % forms.length;
    this.curse.form = forms[this.curse.index];
    this.transform(this.curse.form);
    if (this.curse.form === npcs.soulSplit) this.areaSound(zaros.curseSound);
  }

  // ------------------------------------------------------------------ targeting and movement

  /**
   * Her target (Wiki: Nex/Strategies): every few attacks she re-targets the nearest player within her
   * attack range (10); players outside it, and her previous target, aren't considered. With none to
   * switch to she keeps her target and tries again next attack. Only with no target at all does she
   * take the nearest player wherever they are, so she's never left with nobody.
   */
  pickTarget(players) {
    const { fight } = Common.data;
    const alive = players.filter((player) => player.getHitpoints() > 0);
    const current = this.target && alive.includes(this.target) ? this.target : null;
    // Just flown to them: she stays on them for her walk-in, never switching on landing (which left
    // her standing there instead of walking at them - kofi's call).
    if (current && this.rush?.flight && this.rush.target === current && this.tick < this.rush.until) return;
    if (current && this.attacksOnTarget < fight.retargetEvery) return;
    // Shadow phase: sometimes someone out of range, on purpose; she flies to them (move).
    const far = alive.filter((player) => player !== current && this.distanceTo(player) > fight.magicRange);
    if (this.phase().key === "shadow" && far.length && Math.random() < SHADOW_FAR_TARGET_CHANCE) {
      this.target = Common.pick(far);
      this.farPick = this.target;
      this.cue("farpick", { target: this.target });
      this.attacksOnTarget = 0;
      this.boss.setMobileInteraction(this.target);
      return;
    }
    const pick = this.nearestInRange(alive, current) ?? (current ? null : this.nearest(alive));
    if (!pick) return;
    this.target = pick;
    this.attacksOnTarget = 0;
    this.boss.setMobileInteraction(this.target);
  }

  /** The nearest of `players` within her attack range, other than `except` (ties at random). */
  nearestInRange(players, except) {
    const { fight } = Common.data;
    return this.nearest(players.filter((player) => player !== except && this.distanceTo(player) <= fight.magicRange));
  }

  nearest(players) {
    let best = [];
    let bestDistance = Infinity;
    for (const player of players) {
      const distance = this.distanceTo(player);
      if (distance < bestDistance) {
        best = [player];
        bestDistance = distance;
      } else if (distance === bestDistance) {
        best.push(player);
      }
    }
    return best.length > 0 ? Common.pick(best) : null;
  }

  /** Her target out of reach: someone else within range instead, if there is anyone (Wiki). True if she switched. */
  retargetInRange() {
    const pick = this.nearestInRange(this.players().filter((player) => player.getHitpoints() > 0), this.target);
    if (!pick) return false;
    this.target = pick;
    this.attacksOnTarget = 0;
    this.boss.setMobileInteraction(pick);
    return true;
  }

  /** She closes in while her target is out of reach, and flies to it when she can't attack (captured). */
  move() {
    const { fight } = Common.data;
    const target = this.target;
    // Over players only for a step off someone under her (stepAwayFrom); otherwise they block her.
    this.boss.removeFlag?.(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG);
    // The tick her swing was first blocked by her target standing under her, and the tick they first
    // stood there, cleared once they aren't.
    // A special lately: time out from under her then pauses the count rather than restarting it.
    const specialBreak = this.tick - (this.specialAt ?? -Infinity) <= SPECIAL_PAUSE_TICKS;
    if (!target || this.distanceTo(target) !== 0) {
      this.blockedAt = null;
      // Home again: the walk is over (a bot stepping in and out beside her there kept it counting).
      if (this.atHome() || this.tick - (this.lastUnderTick ?? -Infinity) > (specialBreak ? SPECIAL_PAUSE_TICKS : UNDER_GAP_TICKS)) {
        this.underSince = null;
        this.walkedSince = null;
      }
    } else {
      // Back under her after a special's break: the ticks away don't count, so the walk carries on
      // from where it was (and she walks on at once if she was already walking).
      const away = this.tick - (this.lastUnderTick ?? this.tick) - 1;
      if (this.underSince != null && specialBreak && away > 0) {
        this.underSince += away;
        if (this.walkedSince != null) this.walkedSince += away;
      }
      this.underSince ??= this.tick;
      this.lastUnderTick = this.tick;
    }
    // Still gliding (the flight's tick): no steps yet. After a flight to her target she walks on into
    // melee straight away, her landing immunity notwithstanding (kofi's call).
    const gliding = this.tick <= (this.lastFlightTick ?? -Infinity);
    const flightWalkIn = this.rush?.flight && this.rush.target === target;
    if (!target || gliding || this.tick < this.busyUntil || (this.tick < this.immuneUntil && !flightWalkIn)) return;
    // Still standing up from Blood Siphon (Specials SIPHON_ANIM_TICKS): the animation plays out first,
    // then she walks or flies home - no flight from halfway through it (kofi's call).
    if (this.tick < (this.flightHeldUntil ?? -Infinity)) return;
    // Idle counts from her last attack or the end of a special that kept her busy (No Escape's 12
    // ticks were counted as idle, so she flew off to a target in range the moment it ended).
    const idleSince = Math.max(this.lastAttackTick, this.busyUntil ?? -Infinity, this.immuneUntil ?? -Infinity);
    // A rush is always run on foot, never flown (server custom: kofi's call). Its held
    // attack isn't idle time, so it can't set off her flight partway there.
    const rushingAt = this.rush && this.rush.target === target;
    if (!rushingAt && this.tick - idleSince >= fight.flyAfterTicks && this.tick - (this.lastFlightTick ?? -Infinity) >= FLY_GRACE_TICKS) {
      // Never off to someone out of range while there's anyone within it: she takes them instead.
      if (this.distanceTo(target) > fight.magicRange && this.farPick !== target && this.retargetInRange()) return;
      this.fly(target);
      return;
    }
    // Out of her range with nobody else within it - or picked out there on purpose (shadow phase):
    // she flies to them (no long run across the room).
    if (this.farPick !== target) this.farPick = null;
    // A rush at someone out of her range: the one time a rush goes by flight - straight to them, never
    // swapping to someone nearer (server custom: kofi's call).
    if (rushingAt && this.distanceTo(target) > fight.magicRange) {
      this.fly(target);
      // A rush that flew (not her idle flight): no 5-tick hold if they get under her after (kofi's call).
      if (this.rush) this.rush.flownRush = true;
      this.cue("rushfly", { target });
      return;
    }
    const chosenFar = this.farPick === target;
    if (this.distanceTo(target) > fight.magicRange && (chosenFar || !this.retargetInRange()) && this.tick - (this.lastFlightTick ?? -Infinity) >= FLY_GRACE_TICKS) {
      this.farPick = null;
      this.fly(target);
      return;
    }
    // A rush runs her right up to them; otherwise in range she stands and attacks. Right
    // up to them means into melee reach: a corner of her body touching theirs diagonally isn't (she
    // can't swing there), so the rush stopped there and she shot instead (kofi saw her stuck).
    const rushing = this.rush && this.rush.target === target && this.distanceTo(target) > 0 && !Attacks.inMeleeReach(this, target);
    // Still on her way to them: the rush keeps going (RUSH_MAX_TICKS at most) so it can't run out as
    // she arrives.
    if (rushing) this.rush.until = Math.max(this.rush.until, Math.min(this.tick + 2, this.rush.startedAt + RUSH_MAX_TICKS));
    if (!rushing && this.distanceTo(target) <= fight.magicRange && this.distanceTo(target) > 0) return;
    // Her target under her: she holds still for UNDER_HOLD_TICKS (so a 5-tick stall, stepping straight
    // back out, only delays her swing), then from the 6th tick walks off them each tick to attack;
    // her idle time still sends her flying (fly, above).
    if (this.distanceTo(target) === 0) {
      // Someone under her walking her home: any rush is over (she got to them). Left running, it sent her
      // straight back out after the dart home and she sat stuck there (kofi's call).
      if (this.rush && !this.rush.flight) this.rush = null;
      // Locked on to them the whole time (as in OSRS): walked off the middle she still faces them,
      // rather than looking anywhere a flight or a special left her facing.
      if (this.boss.getInteractingMobile?.() !== target) this.boss.setMobileInteraction(target);
      // Already home: she waits there for them to step out (her bots do at once), rather than walking
      // off the middle or flying out to a bridge.
      if (this.atHome()) {
        this.underSince = this.tick;
        this.walkedSince = null;
        return;
      }
      // Walked back long enough: she darts the rest of the way to the middle.
      // Count 1 is the tick after they first stood under her; she darts on count SEND_HOME_TICKS.
      if (this.tick - this.underSince >= SEND_HOME_TICKS) {
        this.cue("walkfly", { target, under: this.tick - this.underSince + 1 });
        this.underSince = null;
        this.walkedSince = null;
        this.fly(target);
        return;
      }
      // Walked home by a player under her: each step that brings her nearer the middle keeps her busy,
      // so arriving can't set off her idle flight (a walk home and a flight away straight after was the
      // double teleport). A step that doesn't (a wall in the way) leaves her idle time running, so she
      // still flies home rather than wandering.
      // On her middle tile (a walk home, where her bots stand): she walks at once, towards the middle of
      // the room (kofi's call, again 2026-11-03); her count runs on through the walk, so from far out she
      // still dashes home on SEND_HOME_TICKS. On an edge tile (a 5-tick stall) she holds UNDER_HOLD_TICKS,
      // so the stall keeps delaying her swing.
      const onCentre = target.getLocation().equals(this.boss.getLocation().transform(1, 1));
      // Once she's walking she keeps walking every tick while they're under her: after each of her
      // steps the bot is left on her edge a moment (it moves after her), which read as a stall and she
      // stopped and started (kofi's call).
      // Walked home after a rush she still holds the 5 ticks first (Wiki), so the walk is short and her
      // dash home on count SEND_HOME_TICKS comes (kofi: walking at once got her home before it, no dash).
      // Landed from a rush that flew to them out of range: she walks off them at once, no hold (kofi's call).
      const flownRush = this.rush?.flownRush && this.rush.target === target;
      if (onCentre || flownRush || this.walkedSince != null || this.tick - this.underSince >= UNDER_HOLD_TICKS) {
        if (this.walkedSince == null) {
          this.walkedSince = this.tick;
          this.cue("walkout", { target, under: this.tick - this.underSince + 1 });
        }
        const before = this.homeDistance(this.boss.getLocation());
        const to = this.stepAwayFrom(target);
        if (to && this.homeDistance(to) < before) this.lastAttackTick = this.tick;
      }
      return;
    }
    const { RegionManager } = Common.core;
    const from = this.boss.getLocation();
    const dx = Math.sign(target.getLocation().getX() - (from.getX() + 1));
    const dy = Math.sign(target.getLocation().getY() - (from.getY() + 1));
    // She runs at a player's speed (Wiki): two steps a tick while the way is clear.
    this.boss.setMovementSteps?.(2);
    // A rush charges through whoever stands in the way.
    if (rushing) this.boss.setFlag?.(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    const clear = (at, x, y) => RegionManager.canMove(at.getX(), at.getY(), at.getX() + x, at.getY() + y, from.getZ(), SIZE, SIZE, this.arena.area);
    const gap = (at) => Common.distanceToBody(target.getLocation(), at, SIZE);
    // In melee reach of them with her body's south-west tile at `at`: beside her body, not off a corner.
    const reachAt = (at) => {
      if (gap(at) !== 1) return false;
      const t = target.getLocation();
      return (t.getX() >= at.getX() && t.getX() < at.getX() + SIZE) || (t.getY() >= at.getY() && t.getY() < at.getY() + SIZE);
    };
    // A rush follows one planned route every tick (pathToReach): the fewest steps, then the tightest
    // line, so she hugs a corner round to them. Stepping straight at them first walked her into the
    // corner's pocket, and swapping between that and the planned way round had her swing wide and
    // zigzag (kofi saw it). In an open room the route is the same straight run.
    if (rushing) {
      this.rushAlong(target, from, clear, gap, reachAt);
      return;
    }
    const now = this.distanceTo(target);
    // Off a corner of them (1 away, can't swing): a sidestep onto their side first.
    const options = now === 1 ? [[dx, 0], [0, dy], [dx, dy]] : [[dx, dy], [dx, 0], [0, dy]];
    for (const [x, y] of options) {
      if (x === 0 && y === 0) continue;
      if (!clear(from, x, y)) continue;
      const step = from.transform(x, y);
      // Only a step that brings her nearer, or into melee reach: a sideways one that does neither had
      // her bouncing to and fro on the spot with the way ahead blocked. Never onto them (gap 0).
      if (gap(step) === 0 || (gap(step) >= now && !reachAt(step))) continue;
      const movement = this.boss.getMovementQueue();
      movement.reset();
      movement.addSteps(step);
      // The second step of the run, the same way on, if it's clear and nearer still (not once she's
      // in reach, and never onto them).
      const on = step.transform(x, y);
      if (!reachAt(step) && clear(step, x, y) && gap(on) < gap(step) && gap(on) > 0) movement.addSteps(on);
      return;
    }
    // No straight way nearer (a wall, a pillar, the chamber's edge): she waits for her idle flight.
  }

  /**
   * A rush's run to a tile she can swing from (kofi: she got stuck and never landed the hit): two
   * steps a tick along pathToReach's route, every step one tile on from the last (none skipped).
   */
  rushAlong(target, from, clear, gap, reachAt) {
    const path = this.pathToReach(from, clear, gap, reachAt);
    if (!path) {
      this.cue("rushstuck", { target, at: `${from.getX()},${from.getY()}` });
      return;
    }
    const movement = this.boss.getMovementQueue();
    movement.reset();
    // Two steps a tick, as she runs.
    for (const step of path.slice(0, 2)) movement.addSteps(step);
    if (!this.rushPathCued || this.rushPathCued !== this.rush) {
      this.rushPathCued = this.rush;
      // Time to get round: the rush lasts long enough to walk the detour (two steps a tick) and swing.
      this.rush.until = Math.max(this.rush.until, this.tick + Math.ceil(path.length / 2) + 2);
      this.cue("rushpath", { target, at: `${from.getX()},${from.getY()}`, steps: path.length });
    }
  }

  /**
   * The shortest walk for her 3x3 body from `from` to a spot where `reachAt` holds (her target in melee
   * reach), round whatever blocks the straight line: a list of her south-west tile at each step, or
   * null with no way within RUSH_PATH_RADIUS. Never through a tile where her body would cover them.
   * Of the routes with the fewest steps (her time there), the shortest line: it hugs a corner rather
   * than swinging wide round it, and runs straight where nothing's in the way (kofi's call).
   */
  pathToReach(from, clear, gap, reachAt) {
    const key = (at) => `${at.getX()},${at.getY()}`;
    // Cost: steps first (a thousand each), then the line's length (a straight step 100, a diagonal 141).
    const best = new Map([[key(from), 0]]);
    const came = new Map([[key(from), null]]);
    const heap = [{ at: from, cost: 0 }];
    const push = (node) => {
      heap.push(node);
      for (let i = heap.length - 1; i > 0;) {
        const parent = (i - 1) >> 1;
        if (heap[parent].cost <= heap[i].cost) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const [l, r] = [2 * i + 1, 2 * i + 2];
          let min = i;
          if (l < heap.length && heap[l].cost < heap[min].cost) min = l;
          if (r < heap.length && heap[r].cost < heap[min].cost) min = r;
          if (min === i) break;
          [heap[min], heap[i]] = [heap[i], heap[min]];
          i = min;
        }
      }
      return top;
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length) {
      const { at, cost } = pop();
      if (cost > best.get(key(at))) continue;
      if (at !== from && reachAt(at)) {
        const path = [];
        for (let step = at; step && key(step) !== key(from); step = came.get(key(step))) path.unshift(step);
        return path;
      }
      for (const [x, y] of dirs) {
        const next = at.transform(x, y);
        const k = key(next);
        const nextCost = cost + 1000 + (x !== 0 && y !== 0 ? 141 : 100);
        if (best.has(k) && best.get(k) <= nextCost) continue;
        if (Math.max(Math.abs(next.getX() - from.getX()), Math.abs(next.getY() - from.getY())) > RUSH_PATH_RADIUS) continue;
        if (!this.arena.inChamber(next) || !this.arena.inChamber(next.transform(SIZE - 1, SIZE - 1))) continue;
        if (gap(next) === 0 || !clear(at, x, y)) continue;
        best.set(k, nextCost);
        came.set(k, at);
        push({ at: next, cost: nextCost });
      }
    }
    return null;
  }

  /** Tiles from her middle tile. */
  homeDistance(at) {
    const home = this.tile(Common.data.chamber.nexTile);
    return Math.max(Math.abs(at.getX() - home.getX()), Math.abs(at.getY() - home.getY()));
  }

  /** On her middle tile or one off it. */
  atHome() {
    return this.homeDistance(this.boss.getLocation()) <= 1;
  }

  /** One step directly away from `player` (under her): the tile she steps to, or false when she can't. */
  stepAwayFrom(player) {
    const { RegionManager } = Common.core;
    const from = this.boss.getLocation();
    let dx = Math.sign(from.getX() + 1 - player.getLocation().getX());
    let dy = Math.sign(from.getY() + 1 - player.getLocation().getY());
    if (dx === 0 && dy === 0) {
      // On her centre tile: out towards the middle of the room (or any side when she's there).
      const home = this.tile(Common.data.chamber.nexTile);
      dx = Math.sign(home.getX() - from.getX()) || (Math.random() < 0.5 ? 1 : -1);
      dy = Math.sign(home.getY() - from.getY());
    }
    // Away first, then square to it (along a bridge when that's the only way), and back last.
    const tried = new Set();
    // Of the three steps away, the one nearest the middle first: blocked going diagonally home, she took
    // the sideways one and sat 11 off for a walk's worth of ticks (kofi saw the long walk).
    const away = [[dx, dy], [dx, 0], [0, dy]].map(([x, y], i) => ({ x, y, i, home: this.homeDistance(from.transform(x, y)) }))
      .sort((a, b) => a.home - b.home || a.i - b.i).map(({ x, y }) => [x, y]);
    for (const [x, y] of [...away, [dy, dx], [-dy, -dx], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if ((x === 0 && y === 0) || tried.has(`${x},${y}`)) continue;
      tried.add(`${x},${y}`);
      const to = from.transform(x, y);
      if (!this.arena.inChamber(to) || !this.arena.inChamber(to.transform(SIZE - 1, SIZE - 1))) continue;
      if (!RegionManager.canMove(from.getX(), from.getY(), to.getX(), to.getY(), from.getZ(), SIZE, SIZE, this.arena.area)) continue;
      // The player under her would otherwise block every step: her body still covers them.
      this.boss.setFlag?.(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
      // A walk, one tile a tick: a bot walking her home stays under her as she goes.
      this.boss.setMovementSteps?.(1);
      const movement = this.boss.getMovementQueue();
      movement.reset();
      movement.addSteps(to);
      return to;
    }
    return false;
  }

  /** seq 9187 and a 30-cycle glide to beside her target (captured); hits do nothing meanwhile (Wiki). */
  fly(target) {
    const { fight } = Common.data;
    this.lastAttackTick = this.tick;
    this.lastFlightTick = this.tick;
    this.immuneUntil = this.tick + 2;
    // Her swing as soon as the glide's done (30 cycles, a tick): no standing about after landing.
    this.nextAttackTick = Math.max(this.nextAttackTick, this.tick + 2);
    const home = this.tile(Common.data.chamber.nexTile);
    // Her target under her (she can't attack them there): back to the middle, or from the middle
    // out onto a bridge of the cross - the "shadow reset" teams use (Wiki: Nex/Strategies).
    let destination;
    const toTarget = this.distanceTo(target) !== 0;
    if (!toTarget) {
      const at = this.boss.getLocation();
      const inMiddle = Math.max(Math.abs(at.getX() - home.getX()), Math.abs(at.getY() - home.getY())) <= 1;
      destination = inMiddle ? this.tile(Common.pick(Common.data.chamber.aisles).end) : home;
    } else {
      destination = this.landingNear(target) ?? home;
    }
    this.boss.performAnimation(Common.animation(fight.flyAnim));
    this.boss.getMovementQueue().reset();
    this.boss.exactMove(destination, { startCycles: 0, endCycles: fight.flyCycles });
    // The move clears who she faces: turned straight back to her target (not left looking nowhere
    // until her next swing).
    this.boss.setMobileInteraction(target);
    // Flown to her target (not home from under them): the moment she lands she walks straight on
    // into melee to hit them, as a rush does (server custom: kofi's call), whatever the phase.
    // Home (or onto a bridge) from under them: no rush carries on - back to her normal attacks from
    // there, and a new rush can be rolled on any attack after.
    if (!toTarget) this.rush = null;
    if (toTarget) {
      this.rush = { target, until: this.tick + RUSH_TICKS, startedAt: this.tick, flight: true };
      this.noMeleeNext = false;
      this.meleeChain = 0;
    }
  }

  /** A free spot for her 3x3 body next to the player, inside the chamber. */
  landingNear(player) {
    const { RegionManager } = Common.core;
    const at = player.getLocation();
    const options = [[1, -1], [-3, -1], [-1, 1], [-1, -3], [1, 1], [-3, -3], [1, -3], [-3, 1]];
    for (const [dx, dy] of options) {
      const base = at.transform(dx, dy);
      if (!this.arena.inChamber(base) || !this.arena.inChamber(base.transform(2, 2))) continue;
      let free = true;
      for (let x = 0; x < SIZE && free; x++) {
        for (let y = 0; y < SIZE && free; y++) {
          free = !RegionManager.blocked(base.transform(x, y), this.arena.area);
        }
      }
      if (free) return base;
    }
    return null;
  }

  // ------------------------------------------------------------------ hits on her

  /** A hit on her, by the fight's rules. */
  hitBoss(hit) {
    const { fight, npcs, zaros } = Common.data;
    const attacker = hit.getAttacker?.();
    const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
    const total = hit.getTotalDamage();
    const zero = () => {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
    };
    if (this.stage === "spawning" || this.stage === "dying" || this.stage === "ended" || this.tick < this.immuneUntil) {
      zero();
      if (player && this.stage !== "dying") player.sendMessage(fight.immune);
      return;
    }
    this.areaSound(fight.hitSound);
    if (this.tick < this.siphonUntil && total > 0) {
      zero();
      Common.healNpc(this.boss, total, fight.hitpoints);
      this.record.siphonHealed = true;
      this.siphonHealed = (this.siphonHealed ?? 0) + total;
      return;
    }
    const phase = this.phase();
    if (phase.key === "zaros") {
      const { CombatType } = Common.core;
      if (this.form() === npcs.deflect && hit.getCombatType?.() === CombatType.MELEE && total > 0) {
        zero();
        if (player) {
          Common.damage(player, Math.floor(total * zaros.deflectShare));
          player.sendMessage(fight.messages.deflect);
        }
        return;
      }
    } else {
      // Down to the phase's floor, then nothing until its mage dies.
      const floor = Math.floor(fight.hitpoints * phase.floor);
      const room = Math.max(0, this.boss.getHitpoints() - floor);
      if (room === 0) {
        zero();
        if (player) player.sendMessage(fight.immune);
        return;
      }
      if (total > room) {
        let left = room;
        for (const part of hit.getHits()) {
          const amount = Math.min(left, part.getDamage());
          part.setDamage(amount);
          left -= amount;
        }
        hit.updateTotalDamage();
      }
    }
    this.credit(player, hit.getTotalDamage());
  }

  // ------------------------------------------------------------------ HUD and music

  hudValues() {
    return { npcId: this.form(), current: Math.max(0, this.boss?.getHitpoints?.() ?? 0), maximum: Common.data.fight.hitpoints };
  }

  showHud(player) {
    if (this.stage === "ended") return;
    this.hudShown.add(player);
    Common.api.emitCustomEvent("boss-hud:show", { player, ...this.hudValues() });
  }

  updateHud({ force = false } = {}) {
    if (!this.boss) return;
    const values = this.hudValues();
    for (const player of this.hudShown) Common.api.emitCustomEvent("boss-hud:update", { player, ...values, force });
  }

  hideHud(player) {
    if (!this.hudShown.delete(player)) return;
    Common.api.emitCustomEvent("boss-hud:hide", { player });
  }

  playSong(player, id) {
    this.musicPlayers.add(player);
    player.getPacketSender().sendSong(id);
  }

  playerLeft(player) {
    if (player.getHitpoints() <= 0 && this.stage !== "ended") this.deaths++;
    this.hideHud(player);
    this.effects.playerLeft(player);
    if (this.musicPlayers.delete(player)) player.getPacketSender().sendSong(Common.data.music.prison);
  }

  // ------------------------------------------------------------------ her end

  /** Her hitpoints reached 0: Wrath, then she is gone and the loot is down. */
  dying() {
    if (this.stage === "dying" || this.stage === "ended") return;
    const { wrath, npcs } = Common.data;
    this.stage = "dying";
    this.endTick = this.tick;
    this.events = [];
    Specials.interrupt(this);
    this.killReavers(false);
    for (const mage of this.mages.values()) Common.api.removeNpc(mage);
    this.mages.clear();
    this.boss.getMovementQueue().setBlockMovement(true).reset();
    this.boss.setMobileInteraction(null);
    this.say(wrath.say);
    this.transform(npcs.dying);
    const centre = this.centre();
    this.cue("wrath", { centre });
    this.at(wrath.deathAnimTick, () => this.boss.performAnimation(Common.animation(wrath.deathAnim)));
    this.at(wrath.blastTick, () => this.blast(centre));
    this.at(wrath.hudFadeTick, () => {
      for (const player of [...this.hudShown]) this.hideHud(player);
    });
    this.at(wrath.damageTick, () => {
      for (const player of this.players()) {
        const at = player.getLocation();
        if (Math.max(Math.abs(at.getX() - centre.getX()), Math.abs(at.getY() - centre.getY())) > wrath.radius) continue;
        Common.damage(player, Common.randomInt(0, wrath.maxHit));
      }
      this.won(centre);
    });
  }

  /** Wrath's blast, as captured: the centre's map animation and a ring of projectiles and bursts. */
  blast(centre) {
    const { wrath } = Common.data;
    const players = this.players();
    Common.tileGraphic(players, centre, wrath.centreGraphic);
    for (let dx = -wrath.radius; dx <= wrath.radius; dx++) {
      for (let dy = -wrath.radius; dy <= wrath.radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== wrath.radius) continue;
        const tile = centre.transform(dx, dy);
        const end = 16 + 4 * Common.randomInt(0, 3);
        Common.projectile(centre, tile, { ...wrath.projectile, start: 0, end, area: this.arena.area });
        Common.tileGraphic(players, tile, wrath.tileGraphic, { delay: end });
      }
    }
    for (const sound of wrath.sounds) this.areaSound([sound[0], sound[1], 7], centre);
  }

  won(centre) {
    const ticks = this.endTick - this.startedTick();
    const players = this.players();
    this.stage = "ended";
    if (this.boss?.isRegistered?.()) Common.api.removeNpc(this.boss);
    for (const player of players) {
      this.count(player, ticks, players.length);
      if (this.musicPlayers.has(player)) player.getPacketSender().sendSong(Common.data.music.silence);
    }
    require("./Loot.Nex").reward(this, players, centre);
    require("./CombatAchievements.Nex").judge(this, players, ticks);
    this.finish(true);
  }

  /** The tick "Fill my soul with smoke!" began the fight (the kill's timer). */
  startedTick() {
    return Common.data.spawn.fillTick;
  }

  count(player, ticks, team) {
    const { kill, varps } = Common.data;
    const own = Common.count(player, Common.KILLS_ATTRIBUTE) + 1;
    player.setAttribute(Common.KILLS_ATTRIBUTE, own);
    player.getPacketSender().sendConfig(varps.kills, own);
    require("./CombatAchievements.Nex").killed(player, own, (kills) => sendBossKillCount(player, kill.count.replace("[n]", kills)));
    const best = Common.count(player, Common.BEST_ATTRIBUTE);
    const duration = kill.duration.replace("[time]", Common.formatTicks(ticks));
    if (!best || ticks < best) {
      player.setAttribute(Common.BEST_ATTRIBUTE, ticks);
      Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
      player.sendMessage(duration + kill.best);
    } else {
      player.sendMessage(duration + kill.personalBest.replace("[time]", Common.formatTicks(best)));
    }
    Common.api.emitCustomEvent("collection-log:count", { player, category: "Nex" });
  }

  killReavers(healHer) {
    let healed = 0;
    for (const reaver of this.reavers) {
      if (!reaver?.isRegistered?.() || reaver.getHitpoints() <= 0) continue;
      healed += reaver.getHitpoints();
      if (healHer) Common.projectile(reaver, this.boss, { ...Common.data.specials.sacrifice.projectile, start: 0 });
      Common.api.removeNpc(reaver);
    }
    this.reavers = [];
    if (healHer && healed > 0) {
      Common.healNpc(this.boss, healed, Common.data.fight.hitpoints);
      this.record.siphonHealed = true;
      // Her bot teammates react to it (Bots.Nex Team.healWatch).
      this.cue("bigheal", { amount: healed, source: "reavers" });
    }
    return healed;
  }

  /** Everyone left or she died: clears the chamber and tells the arena. */
  end(killed) {
    if (this.stage === "ended" && !killed) return;
    this.stage = "ended";
    Specials.interrupt(this);
    this.killReavers(false);
    for (const mage of this.mages.values()) Common.api.removeNpc(mage);
    this.mages.clear();
    if (this.boss?.isRegistered?.()) Common.api.removeNpc(this.boss);
    for (const player of [...this.hudShown]) this.hideHud(player);
    this.finish(killed);
  }

  finish(killed) {
    if (this.stopped) return;
    this.stop();
    this.arena.ended(this, killed);
  }

  stop() {
    this.stopped = true;
    this.events = [];
  }
}

// ------------------------------------------------------------------ hooks

const fightOf = (npc) => {
  const fight = npc?.__nexFight;
  return fight && !fight.stopped ? fight : null;
};

/** Opens a fight in `arena`, driven from a tick task of its own. */
function open(arena) {
  const fight = new Fight(arena);
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped) {
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  return fight;
}

/** Nex and her mages fight on the fight's timers, never the engine's. */
function scriptedClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class NexScriptedCombat extends CombatMethod {
    start() {}

    hits() {
      return [];
    }

    attackSpeed() {
      return 100;
    }

    attackDistance() {
      return 64;
    }

    canAttack() {
      return false;
    }

    type() {
      return CombatType.MAGIC;
    }
  };
}

function modifyHit({ npc, hit }) {
  const fight = fightOf(npc);
  if (!fight) return;
  if (npc === fight.boss) {
    fight.hitBoss(hit);
    return;
  }
  if (fight.isImmuneMage(npc)) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    return;
  }
  const attacker = hit.getAttacker?.();
  if (attacker?.isPlayer?.()) fight.credit(attacker.getAsPlayer(), hit.getTotalDamage());
}

/** Hitting a blood reaver heals you half the damage (Wiki). */
function dealtDamage({ player, target, hit }) {
  const fight = fightOf(target);
  if (!fight || !fight.reavers.includes(target)) return;
  const amount = hit.getTotalDamage();
  if (amount > 1) Common.healPlayer(player, Math.floor(amount / 2));
}

/**
 * A thrall's hit skips modifyHit (it is damage, not a PendingHit), so her rules are applied to its
 * max hit instead: nothing while she is immune, at a phase's floor or on an uncalled mage, no more
 * than the room above the floor, and during Blood Siphon it heals her (Wiki: every hit does).
 */
function thrallMaxHit(request) {
  const fight = fightOf(request.target);
  if (!fight) return;
  const npc = request.target;
  if (fight.isImmuneMage(npc)) {
    request.maxHit = 0;
    return;
  }
  // A thrall doesn't finish Cruor while reavers live: they'd heal her their hitpoints as he dies.
  if (npc === fight.mages.get("cruor") && fight.reavers.some((reaver) => reaver?.isRegistered?.() && reaver.getHitpoints() > 0)) {
    request.maxHit = 0;
    return;
  }
  if (npc !== fight.boss) return;
  const { fight: data } = Common.data;
  if (fight.stage !== "fighting" || fight.tick < fight.immuneUntil) {
    request.maxHit = 0;
    return;
  }
  if (fight.tick < fight.siphonUntil) {
    Common.healNpc(fight.boss, Common.randomInt(0, Math.max(0, request.maxHit)), data.hitpoints);
    fight.record.siphonHealed = true;
    request.maxHit = 0;
    return;
  }
  const phase = fight.phase();
  if (phase.key === "zaros") return;
  const room = Math.max(0, fight.boss.getHitpoints() - Math.floor(data.hitpoints * phase.floor));
  request.maxHit = Math.min(request.maxHit, room);
}

/** A thrall's damage counts as its summoner's (Wiki: Thralls), for the shares and the MVP. */
function thrallHit({ player, target, damage }) {
  const fight = fightOf(target);
  if (fight) fight.credit(player, damage);
}

/** At 0 she casts Wrath before going. */
function beforeDeath(event) {
  const fight = fightOf(event.npc);
  if (!fight || event.npc !== fight.boss) return;
  event.preventDeath = true;
  fight.dying();
}

function npcDied({ npc, killer }) {
  const fight = fightOf(npc);
  if (!fight) return;
  if (npc.__nexMage != null) {
    // Captured: ancient essence (varbit 13080) up 2 for the mage's killer.
    if (killer?.isPlayer?.()) {
      const player = killer.getAsPlayer();
      Common.setEssence(player, Common.getEssence(player) + Common.data.fight.mageEssence);
    }
    fight.mageDied(npc.__nexMage);
    return;
  }
  if (fight.reavers.includes(npc)) Specials.reaverDied(fight, npc);
}

function attachFight(api) {
  const { npcs } = Common.data;
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_ATTRIBUTE, 0);
  api.persistAttribute(Common.DEATHS_ATTRIBUTE, 0);
  const method = scriptedClass();
  for (const id of [npcs.nex, npcs.spawning, npcs.soulSplit, npcs.deflect, npcs.dying]) api.registerNpcCombatMethodProvider(id, method);
  api.onNpcHitModify(modifyHit);
  api.onCustomEvent("magic:thrall-max-hit", thrallMaxHit);
  api.onCustomEvent("magic:thrall-hit", thrallHit);
  api.onPlayerDealtDamage(dealtDamage);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(npcDied);
}

module.exports = { attachFight, open, fightOf, Fight, SIZE };
