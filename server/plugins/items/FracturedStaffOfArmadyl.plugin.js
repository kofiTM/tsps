"use strict";

/**
 * Server custom (kofi, 2026-11-08): the Fractured staff of Armadyl (custom item 50005 and its seven dyes,
 * data/definitions/custom-items.json), after RuneScape 3's. Its special (50%, instant: 30 seconds of chained hits) is
 * plugins/combat/specials/FracturedStaffOfArmadyl.SpecialAttack.js; the spec bar draws for it (and its dyes).
 *
 * - Ancient Magicks (kofi 00:10-00:12: "the magic damage didnt feel good"): with the staff and the Ancient spellbook,
 *   its spells hit 30% harder, and 30% of the rolls that would miss land anyway (the hit roll forced accurate).
 *   It autocasts Ancient Magicks (Autocasting.ANCIENT_SPELL_AUTOCAST_STAFFS).
 * - Its spells go every 4 ticks (kofi 02:14), 3 while the special runs.
 * - "Activate" on the staff in the inventory wields it and uses the special; ::fsoa uses it while it's wielded. Both
 *   go through CombatSpecial.activate, so a duel's no-specials rule and every disabled-special hook apply.
 */

const { FRACTURED_STAFF_IDS, specialActive } = require("../combat/specials/FracturedStaffOfArmadyl.SpecialAttack");

const ANCIENTS = { DAMAGE: 1.3, ACCURATE: 0.3 };
const CAST_SPEED_TICKS = 4;
const CAST_SPEED_DURING_SPECIAL_TICKS = 3;
const NOT_WIELDED_MESSAGE = "You need to be wielding the Fractured staff of Armadyl to use its special.";
/** Kofi's developer dagger and shortbow (custom items 50006, 50008): every hit lands for the target's whole health (kofi 02:39). */
const DEVELOPER_WEAPONS = [50006, 50008];

let core = null;

function weaponId(player) {
  return player?.getEquipment?.()?.getItems?.()[core.Equipment.WEAPON_SLOT]?.getId?.();
}

function wielding(player) {
  try {
    return FRACTURED_STAFF_IDS.includes(weaponId(player));
  } catch (error) {
    return false;
  }
}

function asPlayer(character) {
  return character?.isPlayer?.() ? character.getAsPlayer() : null;
}

function isMagic(combatType) {
  // The enum, or its name - whichever this hook hands over (kofi 02:04: the special never fired).
  return combatType === core.CombatType.MAGIC || String(combatType?.name?.() ?? combatType?.name ?? combatType).toUpperCase().includes("MAGIC");
}

function onAncients(player) {
  return player.getSpellbook?.() === core.MagicSpellbook.ANCIENT;
}

/** Ancients: 30% of the misses land anyway. */
function ancientAccuracy(event) {
  const player = asPlayer(event.attacker);
  if (!player || !isMagic(event.combatType) || !wielding(player) || !onAncients(player)) return;
  if (Math.random() < ANCIENTS.ACCURATE) event.forceAccurate = true;
}

/** Ancients: 30% more damage on the staff's magic hits. */
function ancientDamage(event) {
  const player = asPlayer(event.attacker);
  if (!player || !isMagic(event.combatType) || !wielding(player) || !onAncients(player)) return;
  const damage = event.damage;
  if (!damage?.getDamage || damage.getDamage() <= 0) return;
  damage.setDamage(Math.floor(damage.getDamage() * ANCIENTS.DAMAGE));
}

function castSpeed(event) {
  const player = asPlayer(event.attacker);
  if (!player || !isMagic(event.combatType) || !wielding(player)) return;
  event.speed = Math.min(event.speed, specialActive(player) ? CAST_SPEED_DURING_SPECIAL_TICKS : CAST_SPEED_TICKS);
}

function wieldingDeveloperWeapon(character) {
  return DEVELOPER_WEAPONS.includes(weaponId(asPlayer(character)));
}

function developerAccuracy(event) {
  if (wieldingDeveloperWeapon(event.attacker)) event.forceAccurate = true;
}

function developerDamage(event) {
  if (!wieldingDeveloperWeapon(event.attacker) || !event.damage?.setDamage) return;
  event.accurate = true;
  event.damage.setDamage(Math.max(1, event.target?.getHitpoints?.() ?? 1));
}

/** The special, through the normal activation (energy, duel rule, disabled-special hooks). */
function useSpecial(player) {
  if (!wielding(player)) {
    player.sendMessage(NOT_WIELDED_MESSAGE);
    return;
  }
  core.CombatSpecial.activate(player);
}

/** "Activate" on the staff in the inventory: wield it, then use the special. */
function activate({ player, itemId, slot }) {
  if (!wielding(player) && FRACTURED_STAFF_IDS.includes(itemId) && slot >= 0) {
    core.EquipPacketListener.equip(player, itemId, slot, core.Inventory.INTERFACE_ID);
  }
  useSpecial(player);
  return true;
}

function fsoaCommand({ player }) {
  useSpecial(player);
  return true;
}

function addAncientAutocast() {
  for (const id of FRACTURED_STAFF_IDS) core.Autocasting?.ANCIENT_SPELL_AUTOCAST_STAFFS?.add?.(id);
}

/**
 * Every hook here only ever touches the staff's own magic hits, and never throws into combat (kofi 01:30: "make sure
 * it doesnt break the hitroll anywhere else"): anything else returns at once, and an error is logged, not raised.
 */
function guarded(handler) {
  return (event) => {
    try {
      handler(event);
    } catch (error) {
      console.error("[fractured staff] hook failed", error);
    }
  };
}

function guardedAction(handler) {
  return (event) => {
    try {
      return handler(event);
    } catch (error) {
      console.error("[fractured staff] activate failed", error);
      return true;
    }
  };
}

module.exports = {
  name: "FracturedStaffOfArmadyl",
  register(pluginApi) {
    core = pluginApi.core;
    addAncientAutocast();
    pluginApi.onAttackSpeed(guarded(castSpeed));
    pluginApi.onCombatHitRoll(guarded(developerAccuracy));
    pluginApi.onCombatHitDamage(guarded(developerDamage));
    pluginApi.onCombatHitRoll(guarded(ancientAccuracy));
    pluginApi.onCombatHitDamage(guarded(ancientDamage));
    pluginApi.onItemAction("Fractured staff of Armadyl", { Activate: guardedAction(activate) });
    pluginApi.registerCommand("fsoa", guardedAction(fsoaCommand), core.PlayerRights.PLAYER ?? core.PlayerRights.DEVELOPER, "Use the wielded Fractured staff of Armadyl's special");
  },
};
