// TODO: ported from xrsps-typescript; untested.
module.exports = function registerDawnbringerSpecialAttack(api) {
  const { Animation, CombatMethod, CombatSpecial, CombatType, Graphic, ItemIdentifiers, PendingHit, Projectile } = api.core;

  const DRAIN = 35;
  // Pulsate is cast from range like a powered staff (kofi): the trident and Sanguinesti staff's cast animation, and
  // the special's three spotanims from the cache (1546 cast, 1547 projectile, 1548 impact - seqs 5460/5462/5461).
  const CAST_ANIMATION = new Animation(1167);
  const SPECIAL_VFX = new Graphic(1546);
  const PROJECTILE_GRAPHIC = 1547;
  const IMPACT_GRAPHIC = new Graphic(1548);
  const RANGE = 10;
  const ATTACK_SPEED = 4;
  const MAXIMUM_DAMAGE = 150;
  const MINIMUM_DAMAGE_MULTIPLIER = 75 / MAXIMUM_DAMAGE;

  class DawnbringerCombatMethod extends CombatMethod {
    hits(character, target) {
      // A magic projectile's delay (Wiki hit delay): 1 + (1 + distance) / 3 ticks, rounded down.
      const from = character.getLocation();
      const to = target.getLocation();
      const distance = Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
      return [new PendingHit(character, target, this, 1 + Math.floor((1 + distance) / 3))];
    }

    attackSpeed(character) {
      return ATTACK_SPEED;
    }

    attackDistance(character) {
      return RANGE;
    }

    type() {
      return CombatType.MAGIC;
    }

    canAttack(character, target) {
      const request = { specialId: "dawnbringer", attacker: character, target, allow: false };
      api.emitCustomEvent("combat-special:can-use", request);
      return request.allow === true;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(CAST_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
      Projectile.createProjectile(character, target, PROJECTILE_GRAPHIC, 0, 20, 43, 31).sendProjectile();
    }

    handleAfterHitEffects(hit) {
      if (hit.isAccurate()) {
        hit.getTarget().performGraphic(IMPACT_GRAPHIC);
      }
    }
  }

  api.registerCombatSpecial({
    id: "dawnbringer",
    itemIds: [ItemIdentifiers.DAWNBRINGER],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      guaranteedHit: true,
      rollAttackType: "magic",
      damageType: "magic",
      maxHitOverride: MAXIMUM_DAMAGE,
      minimumDamageMultiplier: MINIMUM_DAMAGE_MULTIPLIER,
      maximumDamageMultiplier: 1,
    },
    combatMethod: new DawnbringerCombatMethod(),
  });
};
