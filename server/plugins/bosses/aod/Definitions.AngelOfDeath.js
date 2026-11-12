/**
 * Combat definitions for the Angel of Death's appended npcs (17000 and the pillars 17001-17004).
 *
 * NpcDefinitionLoader only applies data/definitions/npc-combat-defs.json to ids below the cache's npc
 * count, and NpcDefinition.forId answers every id past it with one shared default (attack 422, block
 * 424, death 836: human animations). Npcs appended through definition archives therefore played
 * human animations on their own models, which tore them apart (kofi saw it, 2026-11-11). Their rows
 * stay in npc-combat-defs.json; this applies them, after each bundle is installed (an install clears
 * the cached definitions of the npcs it changes).
 */
const fs = require("fs");
const path = require("path");

const COMBAT_DEFS = path.join("data", "definitions", "npc-combat-defs.json");
/** Her combat stats come from Nex until her own fight sets them. */
const STATS_FROM = { 17000: 11278, 17011: 11283, 17012: 11284, 17013: 11285, 17014: 11286 };   // her, and her Fumus (OSRS Fumus's stats)

/** Gives each of `ids` its own definition with its npc-combat-defs.json row. Returns the ids done. */
function defineCombat(api, ids) {
  const { NpcDefinition, CacheDefinitions } = api.core;
  const rows = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), COMBAT_DEFS), "utf8")).npcs ?? {};
  const done = [];
  for (const id of ids) {
    const row = rows[String(id)];
    if (!row?.anims) continue;
    const from = STATS_FROM[id];
    const base = from != null ? NpcDefinition.forId(from) : new NpcDefinition();
    const definition = Object.assign(Object.create(Object.getPrototypeOf(base)), base);
    let cached = null;
    try { cached = CacheDefinitions.getNpc(id); } catch (_e) { /* not installed yet */ }
    Object.assign(definition, {
      id,
      name: cached?.name ?? row.name ?? base.name,
      size: cached?.size ?? base.size,
      actions: cached?.actions ? [...cached.actions] : base.actions,
      stats: Array.isArray(base.stats) ? [...base.stats] : base.stats,
      attackAnim: row.anims.attack,
      defenceAnim: row.anims.block,
      deathAnim: row.anims.death,
      cacheHydrated: true,
      // Not aggressive: Nex's own flag came along with her stats, and she charged anyone who came near
      // (kofi: for now she only fights back when attacked).
      aggressive: false,
    });
    if (Number.isInteger(row.projectile)) definition.projectile = row.projectile;
    NpcDefinition.definitions.set(id, definition);
    done.push(id);
  }
  return done;
}

module.exports = { defineCombat };
