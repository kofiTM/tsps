import { CombatPosition } from "../../CombatPosition";
import { CombatMethod } from "../CombatMethod";
import { CombatType } from "../../CombatType";
import { CombatFactory } from "../../CombatFactory";
import { Ammunition, RangedWeapon } from "../../ranged/RangedData";
import { PendingHit } from "../../hit/PendingHit";
import { Mobile } from "../../../../entity/impl/Mobile";
import { Animation } from "../../../../model/Animation";
import { Graphic } from "../../../../model/Graphic";
import { World } from "../../../../World";
import { GraphicHeight } from "../../../../model/GraphicHeight";
import { Projectile } from "../../../../model/Projectile";
import { CrossFloor } from "../../../../CrossFloor";
import { Sound } from "../../../../Sound";
import { Sounds } from "../../../../Sounds";
import { WeaponProfiles } from "../../WeaponProfile";
import type { ProjectileProfile } from "../../WeaponProfile";
export class RangedCombatMethod extends CombatMethod {
    private static readonly DEFAULT_PLAYER_PROJECTILE: ProjectileProfile = { delay: 41, lengthAdjustment: 5, stepMultiplier: 5, startHeight: 43, endHeight: 31 };
    /** Bronze arrow; used when an npc has no projectile configured. */
    private static readonly DEFAULT_NPC_PROJECTILE = 10;
    /**
     * An NPC's shot flies like a bow's arrow (launched at 41, landing at 46 + 5 cycles a tile)
     * and hits when it lands. It used a flat 40 -> 57 with a 1-tick hit, so the player was hit
     * before the arrow left and a long shot crossed its range in a third of a second (#1862).
     */
    private static readonly NPC_PROJECTILE_DELAY = 41;
    private static readonly NPC_PROJECTILE_END_BASE = 46;
    private static readonly NPC_PROJECTILE_CYCLES_PER_TILE = 5;

    type(): CombatType {
        return CombatType.RANGED;
    }

    /** A special attack's own launch sound; the weapon/ammunition sound is used when unset. */
    protected fireSound(_character: Mobile): Sound | undefined {
        return undefined;
    }

    /**
     * Ticks until each shot of a player's attack lands. Wiki (Hit delay): the distance is edge to edge,
     * to the target's nearest tile, in the weapon's own formula (bows 1 + (3 + d) / 6, thrown weapons
     * 1 + d / 6, ...).
     */
    public static landingDelays(character: Mobile, target: Mobile): number[] {
        return RangedCombatMethod.playerHitDelays(
            character,
            target,
            CombatPosition.edgeDistance(character, target),
        );
    }

    hits(character: Mobile, target: Mobile): PendingHit[] {
        const delays = character.isPlayer()
            ? RangedCombatMethod.landingDelays(character, target)
            : [RangedCombatMethod.npcHitDelay(character, target)];
        const hits = delays.map((delay) => new PendingHit(character, target, this, delay));
        return RangedCombatMethod.isChinchompa(character) ? hits.concat(RangedCombatMethod.chinchompaSplash(this, character, target, hits[0])) : hits;
    }

    /** A chinchompa in hand (RangedData's three). */
    private static isChinchompa(character: Mobile): boolean {
        if (!character.isPlayer()) return false;
        const weapon = character.getCombat().getRangedWeapon();
        return weapon === RangedWeapon.CHINCHOMPA || weapon === RangedWeapon.RED_CHINCHOMPA || weapon === RangedWeapon.BLACK_CHINCHOMPA;
    }

    /**
     * Wiki (Chinchompa (weapon), Black chinchompa): it explodes on its target, hitting everything in
     * the 3x3 round it - in a multi-combat area, up to 12 targets in all for a black chinchompa and 11
     * for the others (10 and 9 against players). One accuracy roll, the main target's: if it hits,
     * every other target is hit too (each its own damage); if it misses, they all miss.
     */
    private static chinchompaSplash(method: RangedCombatMethod, character: Mobile, target: Mobile, primary: PendingHit): PendingHit[] {
        if (!primary || !primary.isAccurate()) return [];
        const black = character.getCombat().getRangedWeapon() === RangedWeapon.BLACK_CHINCHOMPA;
        const pvp = target.isPlayer();
        const most = (black ? 12 : 11) - (pvp ? 2 : 0) - 1;
        // From the world, not the thrower's local lists: those are a client's view, and empty for a bot.
        const reach = Math.max(1, target.getSize?.() ?? 1) + 2;
        const nearby: Iterable<Mobile> = pvp
            ? [...World.getPlayers()].filter((other) => other && other.getPrivateArea() === target.getPrivateArea()
                && other.getLocation().isWithinDistance(target.getLocation(), reach))
            : World.getNpcsNear(target.getLocation(), reach, target.getPrivateArea());
        const splash: PendingHit[] = [];
        for (const next of nearby) {
            if (splash.length >= most) break;
            if (RangedCombatMethod.footprintGap(target, next) > 1) continue;
            if (!CombatFactory.canAttackSecondaryTarget(character, target, next)) continue;
            const hit = new PendingHit(character, next, method, { delay: primary.getDelay(), rollAccuracy: false });
            // Damage only: the explosion shows on the target thrown at (handleAfterHitEffects).
            (hit as any).__chinSplash = true;
            splash.push(hit);
        }
        return splash;
    }

    /** Tiles between two actors' footprints (0 touching or overlapping): "the 3x3 round" a big target is its edge plus one. */
    private static footprintGap(a: Mobile, b: Mobile): number {
        const at = a.getLocation();
        const bt = b.getLocation();
        const aSize = Math.max(1, a.getSize?.() ?? 1);
        const bSize = Math.max(1, b.getSize?.() ?? 1);
        const dx = Math.max(0, bt.getX() - (at.getX() + aSize - 1), at.getX() - (bt.getX() + bSize - 1));
        const dy = Math.max(0, bt.getY() - (at.getY() + aSize - 1), at.getY() - (bt.getY() + bSize - 1));
        return Math.max(dx, dy);
    }

    /**
     * The chinchompa's explosion on the target it was thrown at (kofi: none showed; then on every one it
     * reached - in OSRS only the target shows it, the rest just take their hits). Spotanim 157
     * (FIREWAVE_IMPACT), the burst players know as the chinchompa explosion - not checked against a
     * capture.
     */
    public handleAfterHitEffects(hit: PendingHit): void {
        if (RangedCombatMethod.isChinchompa(hit.getAttacker()) && !(hit as any).__chinSplash) {
            hit.getTarget().performGraphic(new Graphic(RangedCombatMethod.CHINCHOMPA_EXPLOSION, GraphicHeight.MIDDLE));
        }
    }

    private static readonly CHINCHOMPA_EXPLOSION = 157;

    /** On another floor, keep the splat from resolving before its slower cross-floor shot lands. */
    public static playerHitDelays(character: Mobile, target: Mobile, distance: number): number[] {
        const player = character.getAsPlayer();
        const delays = WeaponProfiles.hitDelays(player, distance);
        const from = CombatPosition.location(character, target);
        const to = CombatPosition.location(target, character);
        if (!CrossFloor.canCross(from, to) || from.getZ() === to.getZ()) return delays;

        const profile = WeaponProfiles.ranged(player);
        const projectiles = profile?.projectiles ?? [RangedCombatMethod.DEFAULT_PLAYER_PROJECTILE];
        const arrivals = projectiles.map((projectile) =>
            Projectile.ticksToLand(RangedCombatMethod.projectileEnd(projectile, distance)));
        return delays.map((delay, index) => Math.max(delay, arrivals[Math.min(index, arrivals.length - 1)] ?? delay));
    }

    /** Ticks until an NPC's shot lands, so its hit shows when the arrow arrives. */
    public static npcHitDelay(character: Mobile, target: Mobile): number {
        return Projectile.arrivalTicks(character, target, RangedCombatMethod.NPC_PROJECTILE_END_BASE, RangedCombatMethod.NPC_PROJECTILE_CYCLES_PER_TILE);
    }

    private static npcProjectileEnd(character: Mobile, target: Mobile): number {
        return Projectile.arrivalCycles(character, target, RangedCombatMethod.NPC_PROJECTILE_END_BASE, RangedCombatMethod.NPC_PROJECTILE_CYCLES_PER_TILE);
    }

    canAttack(character: Mobile, target: Mobile): boolean {
        if (character.isNpc()) {
            return true;
        }

        const p = character.getAsPlayer();

        if (!CombatFactory.checkAmmo(p, WeaponProfiles.ranged(p).ammoRequired ?? 1)) {
            return false;
        }
        return true;
    }

    shouldRenew(character: Mobile): boolean {
        if (!character.isPlayer()) return true;
        const player = character.getAsPlayer();
        player.getCombat().setRangedWeapon(RangedWeapon.getFor(player));
        player.getCombat().setAmmunition(Ammunition.getFor(player));
        if (player.getCombat().getRangedWeapon() == null) return false;
        return CombatFactory.checkAmmo(player, WeaponProfiles.ranged(player).ammoRequired ?? 1, true);
    }

    start(character: Mobile, target: Mobile) {
        const ammo = character.getCombat().getAmmunition();
        const rangedWeapon = character.getCombat().getRangedWeapon();
        const animation = character.getAttackAnim(target);

        if (animation !== -1) {
            character.performAnimation(new Animation(animation));
        }

        const profile = character.isPlayer() ? WeaponProfiles.ranged(character.getAsPlayer()) : null;
        if (profile?.launchGraphic != null && ammo) {
            character.performGraphic(new Graphic(profile.launchGraphic));
        } else if (ammo?.getStartGraphic() && profile?.startGraphic !== false) {
            character.performGraphic(profile?.doubleStartGraphic ? ammo.getDoubleStartGraphic() : ammo.getStartGraphic());
        }

        if (character.isNpc()) {
            // NPCs have no ranged weapon or ammo. Give them the projectile configured
            // in npc-combat-defs.json, falling back to a generic arrow so the shot is
            // at least visible.
            const configured = character.getAsNpc().getCurrentDefinition().getProjectileId();
            const projectileId = configured >= 0 ? configured : RangedCombatMethod.DEFAULT_NPC_PROJECTILE;
            // An archer draws the arrow on its bow on the shot's tick (#3610). Only npcs whose
            // draw spotanim was captured carry one (npc-combat-defs.json `launchGraphic`).
            const launchGraphic = character.getAsNpc().getCurrentDefinition().getLaunchGraphicId();
            if (launchGraphic >= 0) {
                character.performGraphic(new Graphic(launchGraphic, 0, GraphicHeight.ARCHER_DRAW));
            }
            const end = RangedCombatMethod.npcProjectileEnd(character, target);
            Projectile.createProjectile(character, target, projectileId, RangedCombatMethod.NPC_PROJECTILE_DELAY, end, 43, 31).sendProjectile();
            return;
        }

        if (!rangedWeapon || !ammo) {
            return;
        }

        const projectiles = profile?.projectiles ?? [RangedCombatMethod.DEFAULT_PLAYER_PROJECTILE];
        const distance = CombatPosition.edgeDistance(character, target);
        const processingOrder = target.isNpc() ? 1 : 0;
        const hitDelays = RangedCombatMethod.landingDelays(character, target)
            .map((ticks) => ticks + processingOrder);
        for (let index = 0; index < projectiles.length; index++) {
            const projectile = projectiles[index];
            const end = RangedCombatMethod.projectileEnd(projectile, distance);
            const shot = Projectile.createProjectile(character, target, profile?.projectileId ?? ammo.getProjectileId(), projectile.delay, end, projectile.startHeight, projectile.endHeight);
            if (projectile.angle != null) shot.withAngle(projectile.angle);
            if (projectile.progress != null) shot.withProgress(projectile.progress);
            shot.sendProjectile();
        }
        Sounds.sendSound(character, this.fireSound(character) ?? profile?.fireSound ?? Sound.SHOOT_ARROW);

        if (character.isPlayer()) {
            // The shot's ammo is consumed when its hit lands, like the hitsplat.
            const flightTicks = Math.max(1, ...hitDelays);
            CombatFactory.decrementAmmo(character.getAsPlayer(), target.getLocation(), profile?.ammoRequired ?? 1, flightTicks);
        }
    }

    /**
     * A projectile's landing offset in client cycles, from the OSRS server projanim types:
     * delay + lengthAdjustment + stepMultiplier * distance. Profiles without a step keep
     * their flat speed as the end offset.
     */
    public static projectileEnd(projectile: ProjectileProfile, distance: number): number {
        if (projectile.stepMultiplier != null) {
            return projectile.delay + (projectile.lengthAdjustment ?? 0) + projectile.stepMultiplier * distance;
        }
        return projectile.speed ?? projectile.delay + 1;
    }

    attackDistance(character: Mobile): number {
        return character.isPlayer() ? WeaponProfiles.attackDistance(character.getAsPlayer(), 6) : 6;
    }

}
