/**
 * Her spawn (::aodspawn in an ::aod arena), docs/aod-fight.md "The intro". Ticks from the command:
 *   0      she falls from the sky into the centre (seq 60100) and lands with Nex's slam; music, HUD.
 *   2      she touches down: "Who dares wake the Angel of Death?"
 *   7-16   (after a pause to read her line, kofi) each pillar in turn (smoke, shadow, blood, ice)
 *          sends her its element; she turns to it and calls out its element ("Smoke!").
 *   19     she rises (9187).
 *   22     she lands: "All of the elements' power is now mine to control!"
 *   25     she is active: hits land, and her attacks begin (Attacks.AngelOfDeath, Lockdown.AngelOfDeath).
 * She is immune until then (Fight.AngelOfDeath modifyHit). Cues: intro, start (docs/aod-cues.md).
 */
const Common = require("./Common.AngelOfDeath");
const NexCommon = require("../nex/Common.Nex");
const Arena = require("./Arena.AngelOfDeath");

const THROWN_ANIM = 1157;   // as Nex's dash and ice prison push (Specials.Nex)

function start(fight) {
  const { intro, hitpoints } = Common.data;
  const area = fight.area;
  const boss = Arena.spawnBoss(area, Common.ANGEL_OF_DEATH);
  if (!boss) { fight.end(false); return; }
  fight.boss = boss;
  boss.__aodFight = fight;
  boss.setFlag?.("combat:no-retaliate");          // not until she is active
  boss.setFlag?.("combat:no-regen");
  boss.setFlag?.("interaction:keep");
  boss.setMaxHitpoints?.(hitpoints);
  boss.setHitpoints(hitpoints);
  boss.faceTile?.(area.local(Common.PLAYER_START));
  boss.getMovementQueue().setBlockMovement(true).reset();
  // 0: the fall and the landing (the fall animation itself: custom seq, see data/aod.json landAnim)
  boss.performAnimation(NexCommon.animation(intro.landAnim));
  fight.areaSound(intro.landSound);                // its delay: when she touches down
  fight.at(intro.sayTick, () => fight.say(intro.say));
  for (const player of fight.players()) fight.showHud(player);
  const ring = { tile: fight.centre().clone(), local: area.localOf(fight.centre()), radius: intro.rise.radius, at: intro.rise.tick };
  fight.cue("intro", { by: area.owner ?? null, activeAt: intro.activeTick, ring });
  // 4-13: the pillars' powers
  for (const call of intro.pillars) fight.at(call.tick, () => pillarPower(fight, call));
  // 16: she rises; the ring of the elements
  if (intro.rise.enabled !== false) fight.at(intro.rise.tick, () => rise(fight));
  // 19, 22
  fight.at(intro.line.tick, () => fight.say(intro.line.say));
  fight.at(intro.activeTick, () => active(fight));
}

function pillarPower(fight, call) {
  const pillar = fight.area.pillars.find((npc) => npc.__aodPillar === call.pillar && npc.isRegistered?.());
  fight.say(call.say ?? `${call.name}!`);   // "Smoke!" etc. (kofi), not the Praesul's names
  fight.boss.performAnimation(NexCommon.animation(call.anim));
  fight.areaSound(call.sound);
  if (!pillar) return;
  fight.boss.faceTile?.(pillar.getLocation().transform(1, 1));
  NexCommon.projectile(pillar, fight.boss, call.projectile);
  fight.areaSound(Common.data.intro.powerSound, pillar.getLocation());
}

function rise(fight) {
  const { rise: spec } = Common.data.intro;
  // Her rise only: the ring of explosions and its throw-back are gone (kofi, 2026-11-11).
  fight.boss.performAnimation(NexCommon.animation(spec.anim));
  for (const sound of spec.sounds) fight.areaSound(sound);
}

/**
 * Unused since the ring went (kept for a later push). A forced move toward `dest` (seq 1157), stopping on the last walkable tile of the line, so nobody
 * lands in a wall (as Specials.Nex thrown).
 */
function thrown(fight, player, dest, startCycles, endCycles) {
  const { ForceMovement, ForceMovementTask, Location, RegionManager, TaskManager } = Common.core;
  const at = player.getLocation();
  const steps = Math.max(Math.abs(dest.getX() - at.getX()), Math.abs(dest.getY() - at.getY()));
  let land = null;
  for (let i = steps; i >= 1 && !land; i--) {
    const x = at.getX() + Math.round(((dest.getX() - at.getX()) * i) / steps);
    const y = at.getY() + Math.round(((dest.getY() - at.getY()) * i) / steps);
    if (!RegionManager.blocked(new Location(x, y, at.getZ()), fight.area)) land = [x, y];
  }
  if (!land) return;
  const dx = land[0] - at.getX();
  const dy = land[1] - at.getY();
  const direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2);
  TaskManager.submit(new ForceMovementTask(player, Math.max(1, Math.ceil(endCycles / 30)),
    new ForceMovement(at.clone(), new Location(dx, dy, 0), startCycles, endCycles, direction, THROWN_ANIM)));
}

function active(fight) {
  fight.stage = "fighting";
  const boss = fight.boss;
  // She never retaliates the engine's way: her attacks are the fight's (Fight.AngelOfDeath act).
  boss.getMovementQueue().setBlockMovement(false).reset();
  fight.begin(1);
  fight.cue("start", { players: fight.players(), firstAutoAt: fight.nextAttackTick });
}

module.exports = { start };
