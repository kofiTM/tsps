"use strict";

const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { World: BotTickWorld } = require("../../../src/main/typescript/elvarg/game/World");

/** The player-process hook skips bots, so bot-only checks run from their own tick task. */
function onEveryBotTick(api, handler) {
  api.getTaskManager().submit(new (class extends Task {
    execute() {
      for (const player of BotTickWorld.getPlayers()) {
        if (player?.isPlayerBot?.() !== true || player.isRegistered?.() !== true) continue;
        try {
          handler({ player });
        } catch (_error) {
          // One bot's failure must not stop the rest.
        }
      }
    }
  })(1));
}

const { MapObjects } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/MapObjects");
const { WebHandler } = require("../../../src/main/typescript/elvarg/game/entity/impl/object/impl/WebHandler");
const { CombatFactory } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatFactory");
const { CombatType } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { TimerKey } = require("../../../src/main/typescript/elvarg/util/timers/TimerKey");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { EquipPacketListener } = require("../../../src/main/typescript/elvarg/net/packet/impl/EquipPacketListener");
const { Inventory } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Inventory");

/** Frozen out of melee reach: hit from range instead of trying to walk (kofi, 2026-11-09). */
const HALBERD_ID = ItemIdentifiers.NOXIOUS_HALBERD;
const REACH_WEAPON_IDS = new Set(["ANCIENT_SCEPTRE", "ZARYTE_CROSSBOW", "KODAI_WAND", "NIGHTMARE_STAFF",
  "VOLATILE_NIGHTMARE_STAFF", "TOXIC_STAFF_OF_THE_DEAD", "ANCIENT_STAFF", "ARMADYL_CROSSBOW", "DRAGON_CROSSBOW",
  "RUNE_CROSSBOW", "HEAVY_BALLISTA", "MAGIC_SHORTBOW", "MAGIC_SHORTBOW_I_", "DARK_BOW", "TWISTED_BOW",
  "ZURIELS_STAFF", "MASTER_WAND", "STAFF_OF_THE_DEAD"].map((name) => ItemIdentifiers[name]).filter((id) => id != null));

function fixFrozenMelee(player) {
  const combat = player.getCombat?.();
  const target = combat?.getTarget?.();
  if (!target || player.getTimers?.().has?.(TimerKey.FREEZE) !== true) return;
  if (CombatFactory.getMethod(player)?.type?.() !== CombatType.MELEE) return;
  const here = player.getLocation?.();
  const there = target.getLocation?.();
  if (!here || !there || here.getZ() !== there.getZ()) return;
  const distance = Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY()));
  const weaponId = player.getEquipment?.()?.getItems?.()?.[3]?.getId?.() ?? -1;
  if (distance <= 1 || (distance === 2 && weaponId === HALBERD_ID)) return;
  const items = player.getInventory?.()?.getItems?.() ?? [];
  let slot = -1;
  if (distance === 2 && HALBERD_ID != null) slot = items.findIndex((item) => item?.getId?.() === HALBERD_ID);
  if (slot < 0) slot = items.findIndex((item) => REACH_WEAPON_IDS.has(item?.getId?.()));
  if (slot < 0) return;
  EquipPacketListener.equip(player, items[slot].getId(), slot, Inventory.INTERFACE_ID);
  combat.attack?.(target);
}

/** Server custom (kofi, 2026-11-09): bots slash webs blocking them, as players do (Mage Bank etc). */
const WEB_ID = 733;
const SLASHED_WEB_ID = 734;

/** The original web stays in the map list when slashed; a slashed web on its tile means it is open. */
function findLiveWeb(bucket) {
  const web = bucket?.find?.((object) => object?.getId?.() === WEB_ID);
  if (!web) return null;
  const loc = web.getLocation();
  const slashed = (BotTickWorld.getObjects?.() ?? []).some((object) => object?.getId?.() === SLASHED_WEB_ID &&
    object.getLocation().getX() === loc.getX() && object.getLocation().getY() === loc.getY() &&
    object.getLocation().getZ() === loc.getZ());
  return slashed ? null : web;
}
const SLASH_RETRY_MS = 2000;

function findAdjacentWeb(player) {
  const loc = player.getLocation?.();
  if (!loc) return null;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const bucket = MapObjects.mapObjects.get(MapObjects.getHash(loc.getX() + dx, loc.getY() + dy, loc.getZ()));
      const web = findLiveWeb(bucket);
      if (web) return web;
    }
  }
  return null;
}

const { requestMovement } = require("../behaviours/navigation/Navigation.PlayerBots");

const STUCK_CHECKS = 3;
const WEB_SEARCH_RADIUS = 8;
const stuckByPlayer = new WeakMap();

const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

/** A bot that cannot reach its target and has not moved walks to a web between them (then slashes it). */
function walkToBlockingWeb(player) {
  const target = player.getCombat?.()?.getTarget?.() ?? player.getCombatFollowing?.();
  const here = player.getLocation?.();
  const there = target?.getLocation?.();
  if (!here || player.getTimers?.().has?.(TimerKey.FREEZE) === true) {
    stuckByPlayer.delete(player);
    return;
  }
  // With a reachable-looking target nearby there is nothing to unstick.
  const hasTarget = !!(target && there && here.getZ() === there.getZ());
  const distance = hasTarget ? chebyshev(here, there) : 99;
  if (hasTarget && distance <= 1) {
    stuckByPlayer.delete(player);
    return;
  }
  const last = stuckByPlayer.get(player);
  const key = here.getX() + "," + here.getY();
  const count = last?.key === key ? last.count + 1 : 1;
  stuckByPlayer.set(player, { key, count });
  if (count < STUCK_CHECKS) return;
  let best = null;
  for (let dx = -WEB_SEARCH_RADIUS; dx <= WEB_SEARCH_RADIUS; dx++) {
    for (let dy = -WEB_SEARCH_RADIUS; dy <= WEB_SEARCH_RADIUS; dy++) {
      const bucket = MapObjects.mapObjects.get(MapObjects.getHash(here.getX() + dx, here.getY() + dy, here.getZ()));
      const web = findLiveWeb(bucket);
      if (!web) continue;
      // With a target: only webs toward it. Idle and boxed in: the nearest web.
      const toTarget = hasTarget ? chebyshev(web.getLocation(), there) : 0;
      if (hasTarget && toTarget >= distance) continue;
      const score = chebyshev(here, web.getLocation()) + toTarget;
      if (!best || score < best.score) best = { web, score };
    }
  }
  if (!best) return;
  stuckByPlayer.set(player, { key, count: 0 });
  const loc = best.web.getLocation();
  requestMovement(player, loc.getX(), loc.getY(), { z: loc.getZ(), reason: "web_blocking_target" });
}

function registerBotWebs(api) {
  const nextTryAt = new WeakMap();
  onEveryBotTick(api, ({ player }) => {
    if (player?.isPlayerBot?.() !== true || (player.getHitpoints?.() ?? 0) <= 0) return;
    const nowMs = Date.now();
    if ((nextTryAt.get(player) ?? 0) > nowMs) return;
    nextTryAt.set(player, nowMs + 600);
    fixFrozenMelee(player);
    walkToBlockingWeb(player);
    const combat = player.getCombat?.();
    const busy = combat?.getTarget?.() || combat?.getAttacker?.() || player.getCombatFollowing?.() ||
      (player.getMovementQueue?.()?.size?.() ?? 0) > 0;
    // Any bot next to a web slashes it (an idle bot can be boxed in too).
    void busy;
    const web = findAdjacentWeb(player);
    if (!web) return;
    nextTryAt.set(player, nowMs + SLASH_RETRY_MS);
    player.setPositionToFace?.(web.getLocation());
    WebHandler.handleSlashWeb(player, web, false);
  });
}

module.exports = { registerBotWebs };
