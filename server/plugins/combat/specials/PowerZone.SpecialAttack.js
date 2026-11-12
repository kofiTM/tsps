"use strict";

/**
 * Server custom (kofi, 2026-11-11): a damage zone on the ground, after RuneScape 3's Sunshine and the Zaros godsword's
 * Blackhole. A zone covers a square of tiles around where its owner stood; while the owner stands in it, their hits of
 * one style are boosted (the specials register the hit modifier and ask `inside`). Only the owner benefits, one zone
 * of each kind per player (a new one replaces the old), and it stays when the weapon is switched, as in RS3.
 * Used by ZarosGodsword.SpecialAttack.js and WandOfThePraesul.SpecialAttack.js.
 */
const VIEW_DISTANCE = 32;

let core = null;
/** kind -> WeakMap(player -> { x, y, z, until, target }) */
const zones = new Map();

function now() {
  return core.World.getProcessCycle();
}

function table(kind) {
  if (!zones.has(kind)) zones.set(kind, new WeakMap());
  return zones.get(kind);
}

function active(player, kind) {
  const zone = table(kind).get(player);
  if (!zone) return null;
  if (zone.until < now() || !player.isRegistered?.()) {
    table(kind).delete(player);
    return null;
  }
  return zone;
}

function covers(zone, location, radius) {
  return location != null && location.getZ() === zone.z
    && Math.abs(location.getX() - zone.x) <= radius && Math.abs(location.getY() - zone.y) <= radius;
}

/** Whether `player` stands in their own live zone of `kind` (radius 3 = 7x7). */
function inside(player, kind, radius) {
  const zone = player ? active(player, kind) : null;
  return zone != null && covers(zone, player.getLocation(), radius);
}

function viewers(zone) {
  const out = [];
  for (const player of core.World.getPlayers()) {
    if (player?.isPlayerBot?.()) continue;
    const at = player?.getLocation?.();
    if (at && at.getZ() === zone.z && Math.abs(at.getX() - zone.x) <= VIEW_DISTANCE && Math.abs(at.getY() - zone.y) <= VIEW_DISTANCE) out.push(player);
  }
  return out;
}

function showGraphics(zone, graphics) {
  const location = new core.Location(zone.x, zone.y, zone.z);
  const people = viewers(zone);
  for (const { id, height = 0 } of graphics) {
    const graphic = new core.Graphic(id, 0, height);
    for (const viewer of people) viewer.getPacketSender().sendGraphic(graphic, location);
  }
}

/**
 * Opens a zone of `kind` where `player` stands. Options: duration (ticks), graphics ([{ id, height }], replayed every
 * graphicInterval ticks while it lasts), target (remembered for onPulse), pulseInterval + onPulse(player, zone) for
 * damage over time, onEnd(player).
 */
function open(player, kind, options) {
  const at = player.getLocation();
  const zone = { x: at.getX(), y: at.getY(), z: at.getZ(), until: now() + options.duration, target: options.target ?? null };
  table(kind).set(player, zone);
  const { Task, TaskManager } = core;
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, `power-zone:${kind}`, true);
    }

    execute() {
      try {
        // Replaced by a newer zone: that one carries on. Expired or its owner left: this one ends.
        if (table(kind).get(player) !== zone) {
          this.stop();
          return;
        }
        if (active(player, kind) !== zone) {
          this.stop();
          if (player.isRegistered?.()) options.onEnd?.(player);
          return;
        }
        if (options.graphics?.length && tick % (options.graphicInterval ?? 4) === 0) showGraphics(zone, options.graphics);
        if (options.onPulse && tick > 0 && tick % (options.pulseInterval ?? 3) === 0) options.onPulse(player, zone);
        tick++;
      } catch (error) {
        this.stop();
        console.error(`[power zone ${kind}] tick failed`, error);
      }
    }
  })());
  return zone;
}

module.exports = function registerPowerZone(api) {
  core = api.core;
};
module.exports.open = open;
module.exports.inside = inside;
module.exports.covers = covers;
