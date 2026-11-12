"use strict";

/**
 * Server custom (kofi, 2026-11-08): the Fractured staff of Armadyl's special (custom items 50005 and its seven dyes,
 * data/definitions/custom-items.json), after RuneScape 3's. Its passives (Ancient Magicks, cast speed) are in
 * plugins/items/FracturedStaffOfArmadyl.plugin.js.
 *
 * 50% energy, instant - no attack of its own (skipAttack, so it goes through CombatSpecial.activate: the duel rule and
 * every disabled-special hook apply). For 30 seconds every magic hit of the staff that lands may be followed by a hit
 * more a tick later, and that one by another, as the original's chained criticals (kofi 23:25): 50% for one more,
 * then 33% for a second, then 17% for a third. Each is 50-100% of the hit before it, whatever spell is cast, and is
 * the caster's (kill credit, drops, PvP).
 */
const ID = "fractured_staff_of_armadyl";
const SPECIAL_UNTIL_ATTRIBUTE = "fractured-staff:special-until";

const FRACTURED_STAFF = 50005;
/** Its dyes: Barrows, shadow, blood, ice, Third Age, Aurora, Soul. */
const FRACTURED_STAFF_DYED = [50035, 50036, 50037, 50038, 50039, 50040, 50041];
const FRACTURED_STAFF_IDS = Object.freeze([FRACTURED_STAFF, ...FRACTURED_STAFF_DYED]);

const DRAIN = 50;
const DURATION_TICKS = 50;
const CHAIN_CHANCES = [0.5, 0.33, 0.17];
const CHAIN_SHARE = [0.5, 1];
const LOOK = { CAST: 1167, CASTING: 1730, EXTRA_HIT: 160 };
const STARTED_MESSAGE = "<col=4f9e3b>The staff fractures with the power of the skies - your spells may strike again for 30 seconds.</col>";
const FADED_MESSAGE = "<col=4f9e3b>The Fractured staff of Armadyl's power fades - your special has ended.</col>";

let core = null;

function asPlayer(character) {
  return character?.isPlayer?.() ? character.getAsPlayer() : null;
}

function wieldingFracturedStaff(player) {
  const id = player?.getEquipment?.()?.getItems?.()[core.Equipment.WEAPON_SLOT]?.getId?.();
  return FRACTURED_STAFF_IDS.includes(id);
}

function now() {
  return core.World.getProcessCycle();
}

/** Whether the player's 30 seconds of chained hits are running. */
function specialActive(player) {
  return Number(player?.getAttribute?.(SPECIAL_UNTIL_ATTRIBUTE) ?? -1) >= now();
}

function isMagic(combatType) {
  // The enum, or its name - whichever the hook hands over (kofi 02:04: the special never fired).
  return combatType === core.CombatType.MAGIC || String(combatType?.name?.() ?? combatType?.name ?? combatType).toUpperCase().includes("MAGIC");
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), "fractured-staff", ticks <= 0);
    }

    execute() {
      this.stop();
      try {
        action();
      } catch (error) {
        console.error("[fractured staff] delayed effect failed", error);
      }
    }
  })());
}

function extraHit(player, target, previous, step) {
  if (step >= CHAIN_CHANCES.length || Math.random() >= CHAIN_CHANCES[step]) return;
  const [low, high] = CHAIN_SHARE;
  const damage = Math.max(1, Math.floor(previous * (low + Math.random() * (high - low))));
  later(1, () => {
    if (!player.isRegistered?.() || player.getHitpoints() <= 0) return;
    if (!target?.isRegistered?.() || target.getHitpoints() <= 0) return;
    const { Graphic, HitDamage, HitMask } = core;
    target.performGraphic(new Graphic(LOOK.EXTRA_HIT));
    target.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED).setSource(player)]);
    extraHit(player, target, damage, step + 1);
  });
}

/** A landed magic hit of the staff during the special may chain (never throws into combat). */
function chainHits(event) {
  try {
    const player = asPlayer(event.attacker);
    if (!player || !isMagic(event.combatType) || !wieldingFracturedStaff(player) || !specialActive(player)) return;
    const dealt = event.damage?.getDamage?.() ?? 0;
    if (dealt <= 0) return;
    extraHit(player, event.target, dealt, 0);
  } catch (error) {
    console.error("[fractured staff] chain failed", error);
  }
}

function announceFaded(player) {
  if (player.isRegistered?.() && !specialActive(player)) player.sendMessage(FADED_MESSAGE);
}

module.exports = function registerFracturedStaffOfArmadylSpecialAttack(api) {
  core = api.core;
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic } = api.core;

  class FracturedStaffOfArmadylCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character) {
      const player = asPlayer(character);
      if (!player) return;
      CombatSpecial.drain(player, DRAIN);
      // Recasting restarts the 30 seconds.
      player.setAttribute(SPECIAL_UNTIL_ATTRIBUTE, now() + DURATION_TICKS);
      player.performAnimation(new Animation(LOOK.CAST));
      player.performGraphic(new Graphic(LOOK.CASTING));
      player.sendMessage(STARTED_MESSAGE);
      // The tick after it runs out, unless it was renewed meanwhile.
      later(DURATION_TICKS + 1, () => announceFaded(player));
    }
  }

  api.registerCombatSpecial({
    id: ID,
    itemIds: [...FRACTURED_STAFF_IDS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new FracturedStaffOfArmadylCombatMethod(),
  });
  api.onCombatHitDamage(chainHits);
};

// For the staff's passives (plugins/items/FracturedStaffOfArmadyl.plugin.js).
module.exports.FRACTURED_STAFF_IDS = FRACTURED_STAFF_IDS;
module.exports.specialActive = (player) => core !== null && specialActive(player);
