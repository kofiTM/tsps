"use strict";

/**
 * Server custom (kofi, 2026-11-11): the Zaros godsword's special, Blackhole, after RuneScape 3's
 * (https://runescape.wiki/w/Zaros_godsword): "a melee Sunshine". Custom item 50010 and its seven dyes.
 *
 * 50% energy, instant (no attack of its own; skipAttack, so the duel rule and disabled-special hooks still apply).
 * Opens a black hole on your tile for 20 seconds; while you stand in its 7x7 area your melee max hit is 25% higher,
 * with any melee weapon (switching away from the godsword keeps it, as in RS3). Using it again moves the hole.
 */
const PowerZone = require("./PowerZone.SpecialAttack");

const ID = "zaros_godsword";
const ZONE = "blackhole";

const ZAROS_GODSWORD = 50010;
/** Its dyes: Barrows, shadow, blood, ice, Third Age, Aurora, Soul. */
const ZAROS_GODSWORD_DYED = [50042, 50043, 50044, 50045, 50046, 50047, 50048];
const ZAROS_GODSWORD_IDS = Object.freeze([ZAROS_GODSWORD, ...ZAROS_GODSWORD_DYED]);

const DRAIN = 50;
const DURATION_TICKS = 34; // 20.4 seconds
const RADIUS = 3; // 7x7
const MELEE_BOOST = 1.25;

// Cache gamevals: zgs_special_player, godwars_godsword_zamorak_spot (player); the ground until the RS3 black hole is
// ported: lotg_zanik_light_vortex_two, zaros_teleport.
const LOOK = { SWING: 7638, SWING_GFX: 1205, GROUND: [{ id: 2049 }], OPEN_GFX: 392 };
const OPENED_MESSAGE = "<col=8a2be2>A black hole opens beneath you - your melee hits are 25% stronger while you stand in it.</col>";
const CLOSED_MESSAGE = "<col=8a2be2>The black hole collapses.</col>";

let core = null;

function asPlayer(entity) {
  return entity?.isPlayer?.() ? entity.getAsPlayer() : null;
}

function blackholeMelee(entity, maxHit) {
  const player = asPlayer(entity);
  if (!player || !PowerZone.inside(player, ZONE, RADIUS)) return maxHit;
  return Math.floor(maxHit * MELEE_BOOST);
}

module.exports = function registerZarosGodswordSpecialAttack(api) {
  core = api.core;
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, Priority } = api.core;
  const swing = new Animation(LOOK.SWING);
  const swingGraphic = new Graphic(LOOK.SWING_GFX, Priority.HIGH);

  class BlackholeCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MELEE;
    }

    start(character) {
      const player = asPlayer(character);
      if (!player) return;
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(swing);
      player.performGraphic(swingGraphic);
      player.performGraphic(new Graphic(LOOK.OPEN_GFX));
      PowerZone.open(player, ZONE, {
        duration: DURATION_TICKS,
        graphics: LOOK.GROUND,
        graphicInterval: 4,
        onEnd: (owner) => owner.sendMessage(CLOSED_MESSAGE),
      });
      player.sendMessage(OPENED_MESSAGE);
    }
  }

  api.registerCombatSpecial({
    id: ID,
    itemIds: [...ZAROS_GODSWORD_IDS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new BlackholeCombatMethod(),
  });
  api.registerMeleeHitModifier(blackholeMelee);
};

module.exports.ZAROS_GODSWORD_IDS = ZAROS_GODSWORD_IDS;
