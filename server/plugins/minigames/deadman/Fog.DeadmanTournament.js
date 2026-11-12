/**
 * The Deadman Tournament's fog: a square safe zone round a random centre that starts big enough to
 * hold the whole Wilderness and closes to `fog.finalRadius` over `fog.battleTicks`, or faster with the
 * fighting: fully closed as the field falls to `bracket.at` alive (closedShare).
 *
 * Outside it, a hit every `damageEvery` ticks from the very first tick, and it only gets worse:
 * the base climbs from `damageStart` to `damageMax` as the zone shrinks, plus one for every
 * `depthPerExtra` tiles a fighter is into the fog (capped at `damageCap`). A fog death is a death
 * like any other (Tournament.eliminate). Real players get a hint arrow towards the zone and the
 * overlay's fog line ("Safe", or how far in they are); the final square is marked with Deadman's
 * own safe-zone markers.
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");

const { state } = State;
const ARROW_IN_SIGHT = 64;
const ARROW_AHEAD = 30;
const ARROW_POSITION = 2;
const ARROW_HEIGHT = 60;
const MARKER = "deadman_safezone_indicator";
const arrows = new Map();
const markers = [];

function begin() {
  const { fog, wilderness: w } = Common.data;
  const inset = fog.centreInset;
  const cx = Common.randomInt(w.minX + inset, w.maxX - inset);
  const cy = Common.randomInt(w.minY + inset, w.maxY - inset);
  const startRadius = Math.max(cx - w.minX, w.maxX - cx, cy - w.minY, w.maxY - cy) + 2;
  state.fog = { cx, cy, startRadius, radius: startRadius, progress: 0, frozen: false };
  state.lastFogHit = new Map();
  state.fogStatus = status;
  Common.log(`fog centre ${cx},${cy} (level ${Common.wildernessLevel(cx, cy)}), radius ${startRadius} -> ${fog.finalRadius}`);
  placeMarkers();
  Common.broadcast(`<col=ef1020>The fog is closing in! The final safe zone is at level ${Common.wildernessLevel(cx, cy)} Wilderness.</col>`);
}

/** Deadman's markers round the final square, skipping tiles something stands on. */
function placeMarkers() {
  const { GameObject, ObjectManager, CacheDefinitions, Location } = Common.core;
  const id = CacheDefinitions.getLocId(MARKER);
  if (id == null) return;
  const { cx, cy } = state.fog;
  const r = Common.data.fog.finalRadius;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      if ((dx + dy) % 3 !== 0) continue;
      if (!Common.standable(cx + dx, cy + dy, 0)) continue;
      const marker = new GameObject(id, new Location(cx + dx, cy + dy, 0), 10, Common.randomInt(0, 3), null);
      ObjectManager.register(marker, true);
      markers.push(marker);
    }
  }
}

function removeMarkers() {
  for (const marker of markers.splice(0)) {
    try {
      Common.core.ObjectManager.deregister(marker, true);
    } catch (_error) {
      // Already gone.
    }
  }
}

/** How far into the fog a tile is (0: in the safe zone). */
function depthAt(x, y) {
  if (!state.fog) return 0;
  return Math.max(0, Math.max(Math.abs(x - state.fog.cx), Math.abs(y - state.fog.cy)) - Math.round(state.fog.radius));
}

function depthOf(player) {
  const here = player.getLocation();
  return depthAt(here.getX(), here.getY());
}

function inZone(x, y) {
  return depthAt(x, y) === 0;
}

function status(player) {
  if (state.phase === "bracket") return "Arena";
  if (!state.fog) return "Safe";
  const depth = depthOf(player);
  return depth > 0 ? `FOG +${depth}` : `Safe (${Math.round(state.fog.radius)})`;
}

function damageFor(depth) {
  const { damageStart, damageMax, depthPerExtra, damageCap } = Common.data.fog;
  const base = damageStart + Math.round((damageMax - damageStart) * state.fog.progress);
  return Math.min(damageCap, base + Math.floor(depth / depthPerExtra));
}

function hit(player, damage) {
  const { HitDamage, HitMask } = Common.core;
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
}

function pointArrow(player) {
  const { Location } = Common.core;
  const here = player.getLocation();
  const dx = state.fog.cx - here.getX();
  const dy = state.fog.cy - here.getY();
  let tile;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= ARROW_IN_SIGHT) tile = new Location(state.fog.cx, state.fog.cy, 0);
  else if (Math.abs(dx) >= Math.abs(dy)) tile = new Location(here.getX() + Math.sign(dx) * ARROW_AHEAD, here.getY(), 0);
  else tile = new Location(here.getX(), here.getY() + Math.sign(dy) * ARROW_AHEAD, 0);
  const key = `${tile.getX()},${tile.getY()}`;
  if (arrows.get(player) === key) return;
  arrows.set(player, key);
  player.getPacketSender().sendPositionalHint(tile, ARROW_POSITION, ARROW_HEIGHT, 0);
}

const FASTEST_CLOSE_TICKS = 300;

/**
 * How far the zone has closed, 0 to 1: time (`fog.battleTicks`) or the fighting, whichever is further
 * along - the share of the field gone between the start and `bracket.at` alive, so the zone is at its
 * smallest as the bracket begins however many are in or however fast they die. (On time alone, 500 in
 * were down to the bracket before the zone was a third closed and almost nobody died to the fog.)
 */
function closedShare() {
  const byTime = state.clock / Common.data.fog.battleTicks;
  const start = state.total ?? 0;
  const end = Common.data.bracket.at;
  const byFighting = start > end ? (start - state.alive.size) / (start - end) : 0;
  const was = state.fog.progress ?? 0;
  // A burst of deaths (a massacre, ::dmkill) never snaps the zone shut: at most a full close in
  // FASTEST_CLOSE_TICKS.
  const wanted = Math.min(1, Math.max(byTime, byFighting, was));
  return Math.min(wanted, was + 1 / FASTEST_CLOSE_TICKS);
}

function tick() {
  if (state.phase !== "battle" || !state.fog || state.fog.frozen) return;
  const { finalRadius, damageEvery, warnEvery } = Common.data.fog;
  // Never opens back up (Math.max with the last value inside closedShare).
  state.fog.progress = closedShare();
  state.fog.radius = state.fog.startRadius - (state.fog.startRadius - finalRadius) * state.fog.progress;
  if (state.clock % warnEvery === 0) {
    Common.broadcast(`<col=ef1020>The safe zone is now ${Math.round(state.fog.radius)} tiles from its centre; the fog hits for ${damageFor(0)}+.</col>`);
  }
  // No fog damage during the looting head start.
  const damageTick = state.clock % damageEvery === 0 && !require("./Tournament.DeadmanTournament").inGrace();
  for (const player of state.alive) {
    // The fog's arrow, unless they follow a bot leader (whose arrow shows them where to go).
    if (!State.isBot(player) && state.clock % 3 === 0 && !require("./Clans.DeadmanTournament").followsBot(player)) pointArrow(player);
    if (!damageTick || player.getHitpoints() <= 0) continue;
    const depth = depthOf(player);
    if (depth <= 0) continue;
    hit(player, damageFor(depth));
    state.lastFogHit.set(player, state.clock);
  }
}

function freeze() {
  if (state.fog) state.fog.frozen = true;
  for (const player of arrows.keys()) player.getPacketSender?.().sendEntityHintRemoval?.(false);
  arrows.clear();
}

function ended() {
  removeMarkers();
  freeze();
  state.fog = null;
  state.fogStatus = null;
}

function attachFog() {
  State.onStart(begin);
  State.onTick(tick);
  State.onBracket(freeze);
  State.onEnd(ended);
}

module.exports = { attachFog, depthOf, depthAt, inZone, damageFor };
