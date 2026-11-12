"use strict";

/**
 * Server custom (kofi, 2026-11-11): the Wand of the praesul's special is RuneScape 3's Sunshine
 * (https://runescape.wiki/w/Sunshine, kofi: "make this special attack do magic sunshine"). Custom item 50015 and its
 * seven dyes. RS3's wand has no special of its own.
 *
 * 100% energy (Sunshine is an ultimate), instant (skipAttack). A sunbeam shines on your tile for 30 seconds; while you
 * stand in its 7x7 area your magic max hit is 50% higher, with any magic weapon. The target you were fighting when you
 * cast it burns for 5-10% of your magic max hit every 3 ticks while it is inside the beam (RS3: 10-20% ability damage).
 */
const PowerZone = require("./PowerZone.SpecialAttack");

const ID = "wand_of_the_praesul";
const ZONE = "sunshine";

const WAND_OF_THE_PRAESUL = 50015;
/** Its dyes: Barrows, shadow, blood, ice, Third Age, Aurora, Soul. */
const WAND_OF_THE_PRAESUL_DYED = [50077, 50078, 50079, 50080, 50081, 50082, 50083];
const WAND_OF_THE_PRAESUL_IDS = Object.freeze([WAND_OF_THE_PRAESUL, ...WAND_OF_THE_PRAESUL_DYED]);

const DRAIN = 100;
const DURATION_TICKS = 50; // 30 seconds
const RADIUS = 3; // 7x7
const MAGIC_BOOST = 1.5;
const BURN = { every: 3, min: 0.05, max: 0.1, floor: 1 };
const BURN_FALLBACK_MAX_HIT = 30;

// Cache gamevals: the cast (as the Fractured staff's), legends_lightbeam on the ground until the RS3 sunbeam is ported.
const LOOK = { CAST: 1167, CAST_GFX: 1730, GROUND: [{ id: 353 }], BURN_GFX: 1242 };
const OPENED_MESSAGE = "<col=ffb000>The sun shines down on you - your magic hits are 50% stronger while you stand in its light.</col>";
const CLOSED_MESSAGE = "<col=ffb000>The sunshine fades.</col>";

let core = null;
/** The player's last magic max hit, for the burn (5-10% of it). */
const lastMagicMaxHit = new WeakMap();

function asPlayer(entity) {
  return entity?.isPlayer?.() ? entity.getAsPlayer() : null;
}

function sunshineMagic(entity, maxHit) {
  const player = asPlayer(entity);
  if (!player) return maxHit;
  lastMagicMaxHit.set(player, maxHit);
  if (!PowerZone.inside(player, ZONE, RADIUS)) return maxHit;
  return Math.floor(maxHit * MAGIC_BOOST);
}

function burn(player, zone) {
  const target = zone.target;
  if (!target?.isRegistered?.() || target.getHitpoints() <= 0) return;
  if (!PowerZone.covers(zone, target.getLocation(), RADIUS)) return;
  const { Graphic, HitDamage, HitMask } = core;
  const maxHit = lastMagicMaxHit.get(player) ?? BURN_FALLBACK_MAX_HIT;
  const low = Math.max(BURN.floor, Math.floor(maxHit * BURN.min));
  const high = Math.max(low, Math.floor(maxHit * BURN.max));
  const damage = low + Math.floor(Math.random() * (high - low + 1));
  target.performGraphic(new Graphic(LOOK.BURN_GFX));
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED).setSource(player)]);
}

module.exports = function registerWandOfThePraesulSpecialAttack(api) {
  core = api.core;
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic } = api.core;
  const cast = new Animation(LOOK.CAST);
  const castGraphic = new Graphic(LOOK.CAST_GFX);

  class SunshineCombatMethod extends CombatMethod {
    hits() {
      return null;
    }

    type() {
      return CombatType.MAGIC;
    }

    start(character, target) {
      const player = asPlayer(character);
      if (!player) return;
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(cast);
      player.performGraphic(castGraphic);
      PowerZone.open(player, ZONE, {
        duration: DURATION_TICKS,
        graphics: LOOK.GROUND,
        graphicInterval: 4,
        // A utility special is started with the player as its own target: the burn takes the one being fought.
        target: player.getCombat?.()?.getTarget?.() ?? null,
        pulseInterval: BURN.every,
        onPulse: burn,
        onEnd: (owner) => owner.sendMessage(CLOSED_MESSAGE),
      });
      player.sendMessage(OPENED_MESSAGE);
    }
  }

  api.registerCombatSpecial({
    id: ID,
    itemIds: [...WAND_OF_THE_PRAESUL_IDS],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { skipAttack: true },
    combatMethod: new SunshineCombatMethod(),
  });
  api.registerMagicHitModifier(sunshineMagic);
};

module.exports.WAND_OF_THE_PRAESUL_IDS = WAND_OF_THE_PRAESUL_IDS;
