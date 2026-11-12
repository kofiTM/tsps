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

const {
  requestMovement,
  peekMovementRequest,
  clearMovementRequest,
} = require("../behaviours/navigation/Navigation.PlayerBots");

const LOOT_WALK_REASON = "loot_kill";
/**
 * Server custom (kofi, 2026-11-09): a bot with this attribute keeps what it wins - its kills'
 * drops stay on the floor for it (or anyone) to pick up, and no free re-gear follows a kill. The
 * Deadman Tournament sets it on its bots.
 */
const FIXED_LOADOUT_ATTRIBUTE = "player-bots:fixed-loadout";

function keepsLoot(player) {
  return player?.getAttribute?.(FIXED_LOADOUT_ATTRIBUTE) === true;
}

/** Drops the loot walk (and only the loot walk) so it can never override a fight. */
function cancelLootWalk(player) {
  if (peekMovementRequest(player)?.reason === LOOT_WALK_REASON) {
    clearMovementRequest(player);
  }
}

/**
 * Bots loot their kills: after a kill the bot walks onto the drop and everything it owns
 * there (the victim's items, bones) is taken off the floor and deleted. A sweep also
 * deletes any bot-owned floor items older than SWEEP_MAX_AGE_TICKS, so nothing a bot
 * "owns" is ever left lying around. Items owned by real players are never touched.
 */
const LOOT_WALK_DELAY_MS = 1200;
const LOOT_TIMEOUT_MS = 8000;
const SWEEP_INTERVAL_MS = 5000;
const SWEEP_MAX_AGE_TICKS = 25;

function registerBotLooting(api, runtime) {
  const World = api.getWorld();
  const ItemOnGroundManager = api.getItemOnGroundManager();
  const pendingLoot = new Map();
  let nextSweepAt = 0;

  const isBotName = (name) => {
    if (typeof name !== "string" || name.length === 0) return false;
    if (runtime?.entriesByUsername?.has?.(name)) return true;
    return World.getPlayerByName?.(name)?.isPlayerBot?.() === true;
  };

  const deleteOwnedAt = (username, loot) => {
    let removed = 0;
    for (const groundItem of ItemOnGroundManager.ownedBy(username)) {
      const position = groundItem.getPosition?.();
      if (!position) continue;
      if (position.getZ() !== loot.z) continue;
      if (Math.abs(position.getX() - loot.x) > 1 || Math.abs(position.getY() - loot.y) > 1) continue;
      ItemOnGroundManager.deregister(groundItem);
      removed++;
    }
    return removed;
  };

  const sweep = (nowMs) => {
    if (nowMs < nextSweepAt) return;
    nextSweepAt = nowMs + SWEEP_INTERVAL_MS;
    for (const groundItem of [...(World.getItems?.() ?? [])]) {
      if (!groundItem || groundItem.isPendingRemoval?.()) continue;
      const owner = groundItem.getOwner?.();
      if (!owner || !isBotName(owner)) continue;
      if (keepsLoot(World.getPlayerByName?.(owner))) continue;
      if (Number(groundItem.getTick?.() ?? 0) < SWEEP_MAX_AGE_TICKS) continue;
      ItemOnGroundManager.deregister(groundItem);
    }
  };

  api.onPlayerDefeated((event) => {
    const killer = event?.killer;
    const victim = event?.victim;
    if (killer?.isPlayerBot?.() !== true || !victim || killer === victim) return;
    if (keepsLoot(killer)) return;
    const location = victim.getLocation?.();
    const username = killer.getUsername?.();
    if (!location || !username) return;
    // Server custom (kofi, 2026-11-09): the winner is topped up (full setup) once out of combat.
    const killerState = runtime?.entriesByUsername?.get?.(username)?.state;
    if (killerState?.pvp) killerState.pvp.loadoutPending = true;
    pendingLoot.set(username, {
      x: location.getX(),
      y: location.getY(),
      z: location.getZ(),
      startedAt: Date.now(),
      walkRequested: false,
    });
  });

  onEveryBotTick(api, ({ player }) => {
    if (player?.isPlayerBot?.() !== true) return;
    const nowMs = Date.now();
    sweep(nowMs);
    const username = player.getUsername?.();
    const loot = username ? pendingLoot.get(username) : null;
    if (!loot) return;
    const elapsed = nowMs - loot.startedAt;
    if (elapsed < LOOT_WALK_DELAY_MS) return;
    if (elapsed >= LOOT_TIMEOUT_MS || (player.getHitpoints?.() ?? 0) <= 0) {
      cancelLootWalk(player);
      deleteOwnedAt(username, loot);
      pendingLoot.delete(username);
      return;
    }
    const here = player.getLocation?.();
    const onLoot = here && here.getZ() === loot.z &&
      Math.abs(here.getX() - loot.x) <= 0 && Math.abs(here.getY() - loot.y) <= 0;
    if (onLoot) {
      cancelLootWalk(player);
      deleteOwnedAt(username, loot);
      pendingLoot.delete(username);
      return;
    }
    const combat = player.getCombat?.();
    if (combat?.getTarget?.() || combat?.getAttacker?.() || player.getCombatFollowing?.()) {
      // A new fight comes first: give up the walk; the timeout still deletes the loot.
      cancelLootWalk(player);
      return;
    }
    if (!loot.walkRequested) {
      loot.walkRequested = true;
      const entry = runtime?.entriesByUsername?.get?.(username);
      requestMovement(player, loot.x, loot.y, { z: loot.z, state: entry?.state, nowMs, reason: LOOT_WALK_REASON });
    }
  });

  api.onPlayerLogout?.(({ username }) => {
    if (username) pendingLoot.delete(username);
  });
}

module.exports = {
  registerBotLooting,
};
