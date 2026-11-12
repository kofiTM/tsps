"use strict";

/**
 * Server custom (kofi, 2026-11-11): the Ek-ZekKil's special, Igneous Showdown, after RuneScape 3's
 * (https://runescape.wiki/w/Igneous_Showdown). Custom item 50007 and its seven dyes (custom-items.json).
 *
 * 50% energy. The special marks its target as your Flamebound Rival (one at a time):
 *  - on a target that isn't your rival yet: one huge hit (RS3 260-300% ability damage -> 130-150% of max hit here),
 *    then it becomes your rival;
 *  - on your rival: four hits in the same tick (RS3 initial 260-300% + three of 245-265% -> each 122-140% of max
 *    hit here) and 15% energy back.
 * Ashen Vow (passive, while wielding the sword): +12% melee max hit against your rival, and 12% less damage taken
 * from it. The rival is lost when it dies, logs out, or when you mark another target.
 * Against players every hit is scaled by PVP_SCALE so it doesn't one-shot through full health every time.
 * Damage is RS3 ability % / 200, so "max hit" plays the role of RS3's 200% ability damage.
 */
const ID = "ek_zekkil";

const EK_ZEKKIL = 50007;
/** Its dyes: Barrows, shadow, blood, ice, Third Age, Aurora, Soul. */
const EK_ZEKKIL_DYED = [50028, 50029, 50030, 50031, 50032, 50033, 50034];
const EK_ZEKKIL_IDS = Object.freeze([EK_ZEKKIL, ...EK_ZEKKIL_DYED]);

const DRAIN = 50;
const RIVAL_REFUND = 15;
const ACCURACY = 1.25;
const SLASH = 1;
const FIRST_HIT = { min: 1.3, max: 1.5 };
const RIVAL_HITS = { count: 4, min: 1.22, max: 1.4 };
const PVP_SCALE = 0.6;
const ASHEN_VOW_DAMAGE = 1.12;
const ASHEN_VOW_REDUCTION = 0.12;

// Cache gamevals: zgs_special_player, godwars_godsword_zamorak_spot, vfx_flaming_skull_fire_impact01,
// vfx_vmq4_ennius_fire_explosion.
const LOOK = { SWING: 7638, SWING_GFX: 1205, MARK_GFX: 3251, RIVAL_IMPACT_GFX: 3310 };
const MARKED_MESSAGE = "<col=ff7000>You mark your target as your Flamebound Rival!</col>";
const SHOWDOWN_MESSAGE = "<col=ff7000>Igneous Showdown! Your rival is cut down four times.</col>";

let core = null;
/** Player -> their Flamebound Rival (not saved: a rival is a fight, not an account). */
const rivals = new WeakMap();

function asPlayer(entity) {
  return entity?.isPlayer?.() ? entity.getAsPlayer() : null;
}

function wieldsEkZekKil(player) {
  const id = player?.getEquipment?.()?.getItems?.()?.[core.Equipment.WEAPON_SLOT]?.getId?.();
  return EK_ZEKKIL_IDS.includes(id);
}

function alive(entity) {
  return entity?.isRegistered?.() && entity.getHitpoints() > 0;
}

/** The player's rival, or null once it has died or gone. */
function rivalOf(player) {
  const rival = rivals.get(player) ?? null;
  if (rival && !alive(rival)) {
    rivals.delete(player);
    return null;
  }
  return rival;
}

function isRival(player, target) {
  return target != null && rivalOf(player) === target;
}

function showdownTraits(player) {
  const target = player.getCombat?.()?.getTarget?.() ?? null;
  const scale = target?.isPlayer?.() ? PVP_SCALE : 1;
  const onRival = isRival(player, target);
  const range = onRival ? RIVAL_HITS : FIRST_HIT;
  const count = onRival ? RIVAL_HITS.count : 1;
  return {
    hitCount: count,
    hitDelayTicks: new Array(count).fill(0),
    accuracyMultiplier: ACCURACY,
    meleeDefenceBonusIndex: SLASH,
    minimumDamageMultiplier: range.min * scale,
    maximumDamageMultiplier: range.max * scale,
  };
}

/** Ashen Vow: +12% max hit against the rival while wielding the sword. */
function ashenVowDamage(entity, maxHit) {
  const player = asPlayer(entity);
  if (!player || !wieldsEkZekKil(player)) return maxHit;
  if (!isRival(player, player.getCombat?.()?.getTarget?.())) return maxHit;
  return Math.floor(maxHit * ASHEN_VOW_DAMAGE);
}

/** Ashen Vow: 12% less damage taken from the rival while wielding the sword. */
function ashenVowDefence(entity, hitDamage, context = {}) {
  const player = asPlayer(entity);
  const damage = hitDamage?.getDamage?.() ?? 0;
  if (!player || damage <= 0 || !wieldsEkZekKil(player)) return;
  if (!isRival(player, context.attacker)) return;
  hitDamage.setDamage(Math.max(0, damage - Math.ceil(damage * ASHEN_VOW_REDUCTION)));
}

module.exports = function registerEkZekKilSpecialAttack(api) {
  core = api.core;
  const { Animation, CombatSpecial, Graphic, MeleeCombatMethod, Priority, Sounds } = api.core;
  const swing = new Animation(LOOK.SWING);
  const swingGraphic = new Graphic(LOOK.SWING_GFX, Priority.HIGH);

  class IgneousShowdownCombatMethod extends MeleeCombatMethod {
    start(character, target) {
      const player = asPlayer(character);
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(swing);
      character.performGraphic(swingGraphic);
      Sounds.sendSound(character, character.getAttackSound());
      if (player && isRival(player, target)) {
        // RS3 refunds 15% adrenaline when it lands on the rival.
        player.incrementSpecialPercentage(RIVAL_REFUND);
        CombatSpecial.updateBar(player);
        player.sendMessage(SHOWDOWN_MESSAGE);
        target.performGraphic(new Graphic(LOOK.RIVAL_IMPACT_GFX));
      }
    }

    handleAfterHitEffects(hit) {
      const player = asPlayer(hit.getAttacker());
      const target = hit.getTarget();
      if (!player || !alive(target) || isRival(player, target)) return;
      // Marked after its first hit lands, so only the next special gets the four hits.
      rivals.set(player, target);
      target.performGraphic(new Graphic(LOOK.MARK_GFX));
      player.sendMessage(MARKED_MESSAGE);
      target.sendMessage?.("<col=ff7000>You have been marked as a Flamebound Rival!</col>");
    }
  }

  api.registerCombatSpecial({
    id: ID,
    itemIds: [...EK_ZEKKIL_IDS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY,
    traits: { hitCount: 1, accuracyMultiplier: ACCURACY, meleeDefenceBonusIndex: SLASH },
    traitsFor: showdownTraits,
    combatMethod: new IgneousShowdownCombatMethod(),
  });
  api.registerMeleeHitModifier(ashenVowDamage);
  api.registerIncomingDamageModifier(ashenVowDefence);
};

module.exports.EK_ZEKKIL_IDS = EK_ZEKKIL_IDS;
