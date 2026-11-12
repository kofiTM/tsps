/**
 * The Angel of Death's arena: a private copy of region 8260 (TemplatedInstanceArea).
 *  - "idle" (::aod1): her standing idle in the middle, the four pillars and the AoD Fans.
 *  - "fight" (::aod): the pillars only; ::aodspawn brings her in (Intro.AngelOfDeath).
 * The arena contract for the fight is Fight.Nex's: area, tile, players, spawn, ended.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.AngelOfDeath");
const Fans = require("./Fans.AngelOfDeath");
const { defineCombat } = require("./Definitions.AngelOfDeath");

const PILLAR_HITPOINTS = 500;
/** NPCs are sent within 15 tiles by default; the pillars stand ~27 out, so the arena widens it (as Leviathan's 40). */
const NPC_VIEW_DISTANCE = 48;
const VIEW_ATTRIBUTE = "aod:previous-npc-view";
/** Players block NPC steps (OSRS body-blocking); a 5x5 boss in a crowd never got a step in. As Dreadnoth and Akkha. */
const WALK_THROUGH_FLAG = "movement:walk-through-entities";
// loc rotation (90 degree steps clockwise from facing south) -> a tile to face
const FACING = [[0, -8], [-8, 0], [0, 8], [8, 0]];

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { core, REGION } = Common;
  AreaClass = class AngelOfDeathArena extends core.TemplatedInstanceArea {
    constructor(mode) {
      super(REGION.width, REGION.height);
      for (let x = 0; x < REGION.width; x++) {
        for (let y = 0; y < REGION.height; y++) {
          this.setChunk(0, x, y, { sourceChunkX: REGION.chunkX + x, sourceChunkY: REGION.chunkY + y, sourcePlane: 0, rotation: 0 });
        }
      }
      this.mode = mode;
      this.nex = null;
      this.fight = null;
      this.pillars = [];
      this.bots = [];
    }
    getName() { return "Nex: Angel of Death"; }
    isMulti() { return true; }
    allowSummonPet() { return false; }
    /** Nothing here starts a fight: she (and the pillars) only fight back when attacked (kofi, for now). */
    npcAggression() { return false; }
    at([x, y, z]) { return this.tile(x - REGION.chunkX * 8, y - REGION.chunkY * 8, z ?? 0); }
    /** An arena (region-local) tile. */
    local([x, y]) { return this.at(Common.world([x, y])); }
    /** Its arena (region-local) [x, y]. */
    localOf(location) {
      const o = this.local([0, 0]);
      return [location.getX() - o.getX(), location.getY() - o.getY()];
    }
    postEnter(mobile) {
      super.postEnter(mobile);
      // See her and all four pillars from anywhere in the arena (kofi: the pillars vanished at a distance).
      if (mobile.isPlayer?.() && mobile.getAttribute?.(Fans.BOT_ATTRIBUTE) !== true && mobile.setNpcViewDistance) {
        const before = mobile.getNpcViewDistance();
        mobile.setAttribute(VIEW_ATTRIBUTE, before);
        mobile.setNpcViewDistance(Math.max(before, NPC_VIEW_DISTANCE));
      }
    }
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (mobile.isPlayer?.()) this.fight?.playerLeft(mobile);
      if (mobile.isPlayer?.() && mobile.setNpcViewDistance && mobile.getAttribute?.(VIEW_ATTRIBUTE) != null) {
        const before = mobile.getAttribute(VIEW_ATTRIBUTE);
        mobile.setNpcViewDistance(before === 15 ? null : before);
        mobile.setAttribute(VIEW_ATTRIBUTE, null);
      }
      if (logout && mobile.isPlayer?.()) mobile.setLocation(new Common.core.Location(3222, 3218, 0));
      Common.later(2, () => {
        const people = this.getPlayers().filter((p) => p?.getAttribute?.(Fans.BOT_ATTRIBUTE) !== true);
        if (!this.isDestroyed?.() && people.length === 0) close(this);
      });
    }
  };
  return AreaClass;
}

/** Everything in it gone, then the instance. */
function close(area) {
  area.fight?.stop();
  area.fight = null;
  for (const bot of area.bots ?? []) Fans.logoutBot(bot);
  area.bots = [];
  if (area.nex) Common.api.removeNpc(area.nex);
  area.nex = null;
  if (area.osrsNex?.isRegistered?.()) Common.api.removeNpc(area.osrsNex);
  area.osrsNex = null;
  for (const pillar of area.pillars ?? []) Common.api.removeNpc(pillar);
  area.pillars = [];
  area.destroy?.();
}

/** An npc of the arena's at an arena tile (its south-west tile). */
function spawn(area, id, [x, y]) {
  const at = area.local([x, y]);
  const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0 });
  if (!npc) return null;
  npc.__skipDefaultRespawn = true;
  area.add(npc);
  return npc;
}

/** The four pillars (Blood, Ice, Smoke, Shadow): attackable npcs that stand still and never hit back. */
function spawnPillars(area) {
  const file = path.resolve(process.cwd(), "data", "definitions", "aod-pillars.json");
  const out = [];
  for (const row of JSON.parse(fs.readFileSync(file, "utf8"))) {
    const npc = spawn(area, row.npc, [row.x, row.y]);
    if (!npc) continue;
    npc.setFlag?.("combat:no-retaliate");
    const hp = Common.data.pillarHitpoints ?? PILLAR_HITPOINTS;   // aod.json (1 while kofi tests)
    npc.setMaxHitpoints?.(hp);
    npc.setHitpoints(hp);
    const at = npc.getLocation();
    const [dx, dy] = FACING[row.rot & 3];
    const half = row.size / 2;
    npc.setPositionToFace?.(new Common.core.Location(Math.floor(at.getX() + half + dx), Math.floor(at.getY() + half + dy), at.getZ()));
    npc.__aodPillar = Object.keys(Common.PILLARS).find((k) => Common.PILLARS[k] === row.npc);
    out.push(npc);
  }
  return out;
}

/** Her, standing in the middle: `id` 17000, centred on CENTRE. */
function spawnBoss(area, id) {
  const size = id === Common.NEX_ID ? 3 : Common.SIZE;
  const npc = spawn(area, id, [Common.CENTRE[0] - (size >> 1), Common.CENTRE[1] - (size >> 1)]);
  if (!npc) return null;
  npc.setAggressive?.(false);
  npc.setFlag?.(WALK_THROUGH_FLAG);   // walks through players and bots (kofi: she couldn't walk over anything)
  area.nex = npc;
  return npc;
}

/** Puts `player` in a new arena: "idle" (::aod1) or "fight" (::aod). */
function open(player, mode, { nex = false } = {}) {
  const { core } = Common;
  const earlier = player.getArea?.();
  if (earlier instanceof core.TemplatedInstanceArea) earlier.leave?.(player, false);
  // The client only receives replaced regions around the player's real tile, and an instance
  // lives elsewhere, so stream the arena's region to them before building the copy.
  const regions = core.MapRegionReplacementManager;
  if (!regions.getRegionIds().includes(Common.OSRS_REGION)) regions.replaceMapRegion(Common.OSRS_REGION, "data/regions/8260.pack");
  regions.sendReplacementToPlayer(player, Common.OSRS_REGION);
  defineCombat(Common.api, Common.AOD_NPCS);   // their npc-combat-defs.json rows (never the engine's human defaults)
  const area = new (areaClass())(mode);
  area.enter(player);
  player.moveTo(area.local(Common.PLAYER_START));
  area.owner = player;
  area.pillars = spawnPillars(area);
  if (mode === "idle") {
    // kofi 2026-11-11: her and normal Nex side by side (Nex a tile to her west), neither fighting
    const angel = spawnBoss(area, Common.ANGEL_OF_DEATH);
    const h = Common.SIZE >> 1;
    const nexAt = [Common.CENTRE[0] - h - 1 - 3, Common.CENTRE[1] - 1];   // 3x3, one tile clear of her body
    const osrsNex = spawn(area, Common.NEX_ID, nexAt);
    for (const npc of [angel, osrsNex]) {
      if (!npc) continue;
      npc.setAggressive?.(false);
      npc.setAttackable?.(false);
      npc.setFlag?.("combat:no-retaliate");
      npc.getCombat?.().reset?.();
      npc.getMovementQueue().setBlockMovement(true).reset();
      npc.faceTile?.(area.local(Common.PLAYER_START));
    }
    if (angel) area.nex = angel;
    area.osrsNex = osrsNex;
    // no Fans in ::aod1 any more (kofi 2026-11-11); ::aodbots still uses them in the fight arena
  }
  return area;
}

/** The AoD arena `player` is in, if any. */
function arenaOf(player) {
  const area = player?.getArea?.();
  return AreaClass && area instanceof AreaClass ? area : null;
}

module.exports = { open, arenaOf, spawn, spawnBoss, close, WALK_THROUGH_FLAG };

/** The arena's scenery definitions (aod-locs.json: walls, spikes, the painted floor, the pillars' npcs). */
function installScenery() {
  const { api, core } = Common;
  const file = path.resolve(process.cwd(), "data", "definitions", "aod-locs.json");
  if (!fs.existsSync(file)) return;
  const bundle = JSON.parse(fs.readFileSync(file, "utf8"));
  const others = core.CacheDefinitions.getDefinitionArchiveBundles().filter((b) => b.id !== bundle.id);
  const request = { bundles: [...others, bundle], handled: false, error: null };
  api.emitCustomEvent("definition-archives:install", request);
  if (!request.handled) console.warn("[aod] scenery definitions not installed:", request.error ?? "no handler");
  else console.info(`[aod] installed ${bundle.definitions.length} arena scenery definitions`);
  if (request.handled) defineCombat(api, Common.AOD_NPCS);
}

function startup() {
  try { installScenery(); } catch (e) { console.warn("[aod] scenery install failed:", e?.message ?? e); }
}

module.exports.startup = startup;
