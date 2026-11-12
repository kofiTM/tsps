/**
 * Elemental Lockdown (RS3, docs/aod-fight.md; numbers in data/aod.json "lockdown"). Ticks from its line:
 *   0      "The elements, they call to me..."; she rises (9187) and faces a random quadrant.
 *   2      she glides home to the centre (a move: she is in the air).
 *   3      she lands: up to 25 to anyone within 1 tile of her body.
 *   4      ice walls (Nex's icicles, made solid) on both midlines: anyone on one takes up to 15 and is
 *          thrown into a quadrant. Three blood reavers, one at the far corner of each other quadrant.
 *   (kofi, 2026-11-11; ticks from her leap, data/aod.json lockdown.channel)
 *   6      landed, she throws a large ball of the faced pillar's element at the pillar (her mage attack), powering it up.
 *   8      she kneels in Nex's siphon (9183), facing the pillar.
 *   9/11/13 the pillar's hits: its element's spell at everyone in its quadrant, up to 38 each (shadow is
 *          ranged, smoke/blood/ice magic; the right protection prayer blocks it all). With nobody
 *          there, each one goes into her instead ("The stones, they empower me"). She stands up at the end of her siphon (14 ticks).
 *   reavers walk a tile every 2 ticks to her (freezes and binds hold them); one that reaches her, or
 *          lives 100 ticks, is absorbed: she heals half its hitpoints, and 1.5x them is split across
 *          everyone as typeless damage. The walls stay until tick 34, or until every reaver is gone.
 * Cues: lockdown, lockdownempty, reavers, reaverabsorbed (docs/aod-cues.md).
 */
const Common = require("./Common.AngelOfDeath");
const NexCommon = require("../nex/Common.Nex");

const LOC_CLIP = 0x100;               // a solid loc on the tile (RsmodRouteFinding LOC)
const QUADRANTS = ["sw", "nw", "ne", "se"];
const spec = () => Common.data.lockdown;

/** The quadrant of an arena-local [x, y]; null on a midline. */
function quadrantOf([x, y]) {
  const m = spec().midline;
  if (x === m || y === m) return null;
  return (y > m ? "n" : "s") + (x > m ? "e" : "w");
}

/** Starts it; returns the ticks until her next attack. */
function start(fight) {
  const s = spec();
  clear(fight);
  const quadrant = NexCommon.pick(QUADRANTS);
  const L = (fight.lockdown = { quadrant, walls: [], reavers: [], startTick: fight.tick, done: false });
  const T = s.tell.ticks;                       // her leap; every tick below counts from it
  fight.say(s.say);
  fight.boss.setMobileInteraction(null);
  fight.boss.getMovementQueue().reset();
  const home = homeTile(fight);
  const face = { sw: [-8, -8], nw: [-8, 8], ne: [8, 8], se: [8, -8] }[quadrant];
  const centre = Common.CENTRE;
  const faceQuadrant = () => fight.boss.faceTile?.(fight.area.local([centre[0] + face[0], centre[1] + face[1]]));
  tell(fight, quadrant);
  const wallTiles = wallLocals();
  const element = s.tell.pillars[quadrant];
  const boltStyle = element === "shadow" ? "ranged" : "magic";
  fight.cue("lockdown", {
    quadrant, pillar: element, throwAt: fight.tick + T + s.channel.throwTick, channelAt: fight.tick + T + s.channel.siphonTick, leapAt: fight.tick + T, landAt: fight.tick + T + s.landTick,
    slam: zoneAround(fight, home, 1),
    wallsAt: fight.tick + T + s.wallTick, wallsUntil: fight.tick + T + s.wallUntil,
    walls: wallTiles.map((t) => fight.area.local(t)), locals: wallTiles,
    bolts: s.bolts.map((b) => ({ at: fight.tick + T + b.tick, style: boltStyle, element })),
  });
  fight.at(T, () => {
    faceQuadrant();
    fight.boss.performAnimation(NexCommon.animation(s.jumpAnim));   // her leap, up out of sight (seq 60101)
  });
  // Up there nobody sees her moved: to the middle, facing the quadrant, and down she comes (her spawn's fall).
  fight.at(T + s.dropTick, () => {
    if (!fight.boss.getLocation().equals(home)) fight.boss.moveTo(home);
    faceQuadrant();
    fight.boss.performAnimation(NexCommon.animation(s.landAnim));
    fight.areaSound(Common.data.intro.landSound);                  // its delay: when she touches down
  });
  fight.at(T + s.landTick, () => slam(fight));
  fight.at(T + s.wallTick, () => { raiseWalls(fight, wallTiles); spawnReavers(fight, quadrant); });
  fight.at(T + s.channel.throwTick, () => throwBall(fight, element));
  fight.at(T + s.channel.siphonTick, () => channel(fight, element));
  for (const bolt of s.bolts) fight.at(T + bolt.tick, () => fireBolt(fight, element, bolt === s.bolts[0]));
  fight.at(endTick(), () => release(fight));
  fight.at(T + s.wallUntil, () => lowerWalls(fight));
  return endTick();
}

/** Ticks from the start of Lockdown until she is up from her siphon (or past the last bolt). */
function endTick() {
  const s = spec();
  return Math.max(lastBoltTick() + 1, s.tell.ticks + s.channel.siphonTick + s.channel.siphonTicks);
}

/** Ticks from the start of Lockdown to its last bolt. */
function lastBoltTick() {
  const s = spec();
  return s.tell.ticks + s.bolts[s.bolts.length - 1].tick;
}

/** The chosen quadrant's pillar fires its element at her (her intro's projectile, quicker), so you see where she'll land. */
function tell(fight, quadrant) {
  const s = spec();
  const element = s.tell.pillars[quadrant];
  const call = Common.data.intro.pillars.find((p) => p.pillar === element);
  const pillar = fight.area.pillars?.find((npc) => npc.__aodPillar === element && npc.isRegistered?.());
  if (!call || !pillar) return;
  fight.boss.faceTile?.(pillar.getLocation().transform(1, 1));
  fight.boss.performAnimation(NexCommon.animation(call.anim));
  fight.areaSound(call.sound);
  NexCommon.projectile(pillar, fight.boss, { ...call.projectile, ...s.tell.projectile });
  fight.areaSound(Common.data.intro.powerSound, pillar.getLocation());
}

/** Her south-west tile when centred on CENTRE. */
function homeTile(fight) {
  const h = Common.SIZE >> 1;
  return fight.area.local([Common.CENTRE[0] - h, Common.CENTRE[1] - h]);
}

/** Instance-tile zone of her body at `sw` grown by `by`. */
function zoneAround(fight, sw, by) {
  return { minX: sw.getX() - by, minY: sw.getY() - by, maxX: sw.getX() + Common.SIZE - 1 + by, maxY: sw.getY() + Common.SIZE - 1 + by };
}

/** The midline tiles inside the arena walls, minus her body (arena-local). */
function wallLocals() {
  const { midline: m, interior: [lo, hi] } = spec();
  const h = Common.SIZE >> 1, c = Common.CENTRE;
  const body = (x, y) => x >= c[0] - h && x <= c[0] + h && y >= c[1] - h && y <= c[1] + h;
  const out = [];
  for (let i = lo; i <= hi; i++) {
    if (!body(m, i)) out.push([m, i]);
    if (i !== m && !body(i, m)) out.push([i, m]);
  }
  return out;
}

/** The extra icicles towards her (kofi): `wallInner` tiles onto her body's edge on each midline. */
function innerLocals() {
  const { midline: m, wallInner: n = 0 } = spec();
  const h = Common.SIZE >> 1, c = Common.CENTRE;
  const out = [];
  for (let k = 0; k < n; k++) {
    const d = h - k;
    if (d <= 0) break;
    out.push([m, c[1] - d], [m, c[1] + d], [c[0] - d, m], [c[0] + d, m]);
  }
  return out;
}

function slam(fight) {
  const s = spec();
  for (const player of fight.players()) {
    if (player.getHitpoints() <= 0 || fight.distanceTo(player.getLocation()) > 1) continue;
    const dmg = NexCommon.randomInt(Math.floor(s.slamMax / 2), s.slamMax);
    NexCommon.damage(player, dmg);
    fight.noteHit(player, "lockdown-slam", dmg);
  }
}

function raiseWalls(fight, locals) {
  const s = spec();
  const L = fight.lockdown;
  if (!L || fight.stage !== "fighting") return;
  const { GameObject, ObjectManager, RegionManager } = Common.core;
  for (const t of locals) {
    const at = fight.area.local(t);
    const object = new GameObject(s.wallLoc, at, 10, 0, fight.area);
    ObjectManager.register(object, true);
    RegionManager.addClipping(at.getX(), at.getY(), at.getZ(), LOC_CLIP, fight.area);
    L.walls.push(object);
  }
  const inner = innerLocals();
  for (const t of inner) {                         // solid too (kofi): the quadrants are sealed
    const at = fight.area.local(t);
    const object = new GameObject(s.wallLoc, at, 10, 0, fight.area);
    ObjectManager.register(object, true);
    RegionManager.addClipping(at.getX(), at.getY(), at.getZ(), LOC_CLIP, fight.area);
    L.walls.push(object);
  }
  // anyone on a wall: hurt and thrown into the quadrant they leaned into
  const onWall = new Set([...locals, ...inner].map(([x, y]) => `${x},${y}`));
  for (const player of fight.players()) {
    const [x, y] = fight.area.localOf(player.getLocation());
    if (!onWall.has(`${x},${y}`)) continue;
    const dmg = NexCommon.randomInt(5, s.wallMax);
    NexCommon.damage(player, dmg);
    fight.noteHit(player, "lockdown-wall", dmg);
    const m = s.midline;
    const dx = x === m ? (Math.random() < 0.5 ? -1 : 1) : 0;
    const dy = y === m ? (Math.random() < 0.5 ? -1 : 1) : 0;
    const to = player.getLocation().transform(dx, dy);
    player.getMovementQueue().reset();
    player.moveTo(to);
  }
}

function lowerWalls(fight) {
  const L = fight.lockdown;
  if (!L || !L.walls.length) return;
  const { ObjectManager, RegionManager } = Common.core;
  for (const object of L.walls) {
    const at = object.getLocation();
    if (!object.__aodNoClip) RegionManager.removeClipping(at.getX(), at.getY(), at.getZ(), LOC_CLIP, fight.area);
    ObjectManager.deregister(object, true);
  }
  L.walls = [];
}

function spawnReavers(fight, faced) {
  const s = spec();
  const L = fight.lockdown;
  if (!L || fight.stage !== "fighting") return;
  const { spawn } = require("./Arena.AngelOfDeath");
  for (const q of QUADRANTS) {
    if (q === faced) continue;
    const npc = spawn(fight.area, s.reaver, s.reaverCorners[q]);
    if (!npc) continue;
    npc.setFlag?.("combat:no-retaliate");
    // A step every reaverStepTicks (2) sent as a crawl: the client plays each over ~2 ticks (1280 ms),
    // so they walk slowly and smoothly instead of step, stop, step (kofi; as the Doom's larvae).
    npc.setCrawling?.(true);
    npc.setMaxHitpoints?.(s.reaverHitpoints);
    npc.setHitpoints(s.reaverHitpoints);
    npc.__aodReaver = { fight, quadrant: q, born: fight.tick };
    L.reavers.push(npc);
  }
  fight.cue("reavers", {
    reavers: L.reavers.map((npc) => ({ npc, quadrant: npc.__aodReaver.quadrant, tile: npc.getLocation().clone(), local: fight.area.localOf(npc.getLocation()) })),
    absorbAt: fight.tick + s.absorbAfter,
  });
  walk(fight);
}

/** A reaver step toward her every 2 ticks (frozen: it waits); absorbed at her side or in time. */
function walk(fight) {
  const s = spec();
  const L = fight.lockdown;
  if (!L || fight.stopped || fight.stage !== "fighting") return;
  L.reavers = L.reavers.filter((npc) => npc.isRegistered?.() && npc.getHitpoints() > 0);
  for (const npc of [...L.reavers]) {
    const at = npc.getLocation();
    if (reaverGap(fight, npc) <= 1 || fight.tick - npc.__aodReaver.born >= s.absorbAfter) { absorb(fight, npc); continue; }
    const mq = npc.getMovementQueue();
    if (!mq.getMobility().canMove()) continue;
    // middle to middle: a reaver is 2x2, and steering by its south-west tile left three of the four
    // jammed against her corner a tile short (kofi saw 2 of 3 stuck every time)
    const n = npc.size?.() ?? 1, b = fight.boss.getLocation(), S = Common.SIZE;
    const dx = (b.getX() * 2 + S) - (at.getX() * 2 + n), dy = (b.getY() * 2 + S) - (at.getY() * 2 + n);
    mq.reset();
    mq.walkStep(Math.sign(dx), Math.sign(dy));
  }
  L.reavers = L.reavers.filter((npc) => npc.isRegistered?.() && npc.getHitpoints() > 0);
  if (L.reavers.length === 0 && fight.tick - L.startTick > lastBoltTick()) lowerWalls(fight);
  if (L.reavers.length) Common.later(s.reaverStepTicks, () => walk(fight));
}

/** Tiles between a reaver's body and hers (0: touching or overlapping). */
function reaverGap(fight, npc) {
  const a = npc.getLocation(), n = npc.size?.() ?? 1;
  const b = fight.boss.getLocation(), S = Common.SIZE;
  const gx = Math.max(0, b.getX() - (a.getX() + n - 1), a.getX() - (b.getX() + S - 1));
  const gy = Math.max(0, b.getY() - (a.getY() + n - 1), a.getY() - (b.getY() + S - 1));
  return Math.max(gx, gy);
}

function absorb(fight, npc) {
  const s = spec();
  const hp = Math.max(0, npc.getHitpoints());
  const L = fight.lockdown;
  if (L) L.reavers = L.reavers.filter((r) => r !== npc);
  Common.api.removeNpc(npc);
  const healed = NexCommon.healNpc(fight.boss, Math.floor(hp / 2), Common.data.hitpoints);
  const players = fight.players().filter((p) => p.getHitpoints() > 0);
  const each = players.length ? Math.ceil((hp * s.absorbDamage) / players.length) : 0;
  for (const player of players) { NexCommon.damage(player, each); fight.noteHit(player, "reaver", each); }
  fight.say(s.absorbSay);
  fight.cue("reaverabsorbed", { npc, healed, damageEach: each });
}

/** The faced quadrant's pillar (an npc of the arena), or null. */
function pillarOf(fight, element) {
  return fight.area.pillars?.find((npc) => npc.__aodPillar === element && npc.isRegistered?.()) ?? null;
}

/** Her mage attack: a large ball of the pillar's element thrown at the pillar, powering it up before it hits you (kofi). */
function throwBall(fight, element) {
  const c = spec().channel;
  if (!fight.lockdown || fight.stage !== "fighting") return;
  const pillar = pillarOf(fight, element);
  if (!pillar) return;
  fight.boss.faceTile?.(pillar.getLocation().transform(1, 1));
  fight.boss.performAnimation(NexCommon.animation(c.throwAnims[element]));
  fight.areaSound(NexCommon.data.fight.attacks[element].sound);
  const cycles = NexCommon.projectile(fight.boss, pillar, { ...c.throw, id: c.throwProjectiles[element] });
  Common.later(NexCommon.landsIn(cycles), () => {
    if (fight.stage === "fighting" && pillar.isRegistered?.()) fight.areaSound(Common.data.intro.powerSound, pillar.getLocation());
  });
}

/** She kneels in Nex's siphon, facing the pillar, while it throws its hits. */
function channel(fight, element) {
  const c = spec().channel;
  const L = fight.lockdown;
  if (!L || fight.stage !== "fighting") return;
  const pillar = pillarOf(fight, element);
  if (pillar) fight.boss.faceTile?.(pillar.getLocation().transform(1, 1));
  fight.boss.performAnimation(NexCommon.animation(c.siphonAnim));
  L.channelling = true;
}

/** She is up from her siphon (its own stand-up has played by now). */
function release(fight) {
  const L = fight.lockdown;
  if (!L?.channelling) return;
  L.channelling = false;
}

/** The pillar throws its element's spell at everyone in its quadrant (she is the attacker). */
function fireBolt(fight, element, first) {
  const s = spec();
  const L = fight.lockdown;
  if (!L || fight.stage !== "fighting") return;
  const inside = fight.players().filter((p) => p.getHitpoints() > 0 && quadrantOf(fight.area.localOf(p.getLocation())) === L.quadrant);
  const pillar = pillarOf(fight, element);
  if (!pillar) return;
  const style = element === "shadow" ? "ranged" : "magic";
  const nexStyle = NexCommon.data.fight.attacks[element];
  const b = s.pillarBolt;
  const shot = (to) => NexCommon.projectile(pillar, to, {
    id: Common.data.combat.elements[element].projectile, start: b.start,
    startHeight: b.startHeight, endHeight: b.endHeight, angle: b.angle, progress: b.progress,
  });
  fight.areaSound(nexStyle.sound, pillar.getLocation());
  if (inside.length === 0) {
    // nobody to hit: the pillar's power goes into her (kofi)
    const cycles = shot(fight.boss);
    Common.later(NexCommon.landsIn(cycles), () => {
      if (fight.stage !== "fighting" || !fight.boss?.isRegistered?.()) return;
      if (nexStyle.impact > 0) fight.boss.performGraphic(NexCommon.graphic(nexStyle.impact, { height: nexStyle.impactHeight }));
      fight.areaSound(nexStyle.impactSound);
    });
    if (first) {
      fight.say(s.emptySay);
      fight.cue("lockdownempty", { quadrant: L.quadrant });
    }
    return;
  }
  for (const player of inside) {
    const cycles = shot(player);
    NexCommon.strike(fight.boss, player, style, s.boltMax, NexCommon.landsIn(cycles), {
      prayed: (prayer) => (prayer === style ? 0 : 1),
      landed: (damage) => {
        if (nexStyle.impact > 0) player.performGraphic(NexCommon.graphic(nexStyle.impact, { height: nexStyle.impactHeight }));
        player.getPacketSender().sendSoundEffect(nexStyle.impactSound, 1, 0);
        fight.noteHit(player, "lockdown-bolt", damage);
      },
    });
  }
}

/** Walls down and reavers gone (a new Lockdown, the fight's end). */
function clear(fight) {
  const L = fight.lockdown;
  if (!L) return;
  L.channelling = false;
  lowerWalls(fight);
  for (const npc of L.reavers) if (npc.isRegistered?.()) Common.api.removeNpc(npc);
  L.reavers = [];
  fight.lockdown = null;
}

/** A reaver died: off the list (and the walls down if it was the last). */
function reaverDied(npc) {
  const info = npc?.__aodReaver;
  const L = info?.fight?.lockdown;
  if (!L) return;
  L.reavers = L.reavers.filter((r) => r !== npc);
  if (L.reavers.length === 0 && info.fight.tick - L.startTick > lastBoltTick()) lowerWalls(info.fight);
}

module.exports = { start, clear, reaverDied, quadrantOf };
