/**
 * Angel of Death: Nex at 1.7x size, the boss of the Angel of Death arena (::aod1 idle, ::aod fight).
 *
 * npc 17000 is appended after the cache's own npcs (data/definitions/angel-of-death.json, written
 * by scripts/rs3-port/angel_of_death.py): Nex's definition renamed, scaled x1.7 and given a 5x5
 * footprint. She is idle for now; her fight comes later.
 */
const fs = require("fs");
const path = require("path");

const ANGEL_OF_DEATH = 17000;
const BUNDLES = ["angel-of-death.json", "angel-of-death-pet.json", "aod-amalgamations.json", "aod-minions.json"];   // + her amalgamations 17007-17010 (aod_amalgamations.py)
const { defineCombat } = require("./aod/Definitions.AngelOfDeath");
/** Her custom animations (scripts/rs3-port/aod_fall.py: the fall from the sky, seq 60100). */
const SEQS_FILE = path.join("data", "definitions", "custom-seqs.json");
let seqRows = [];

function install(api) {
  const core = api.core;
  // Her (npc 17000) and her pet Lil' Angel (npc 17005, scripts/rs3-port/aod_pet.py; Pets.plugin.js has its row).
  const mine = BUNDLES.map((name) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data", "definitions", name), "utf8")));
  const ids = new Set(mine.map((b) => b.id));
  const others = core.CacheDefinitions.getDefinitionArchiveBundles().filter((b) => !ids.has(b.id));
  const request = { bundles: [...others, ...mine], handled: false, error: null };
  api.emitCustomEvent("definition-archives:install", request);
  if (!request.handled) console.warn("[nexaod] Angel of Death not installed:", request.error ?? "no handler");
  else console.info("[nexaod] installed Angel of Death (npc " + ANGEL_OF_DEATH + ") and Lil' Angel (npc 17005)");
  // Her npc-combat-defs.json row (Nex's attack 9180 / no block / death 9184): appended npcs miss it otherwise.
  if (request.handled) defineCombat(api, [ANGEL_OF_DEATH, 17007, 17008, 17009, 17010, 17011, 17012, 17013, 17014]);   // + the amalgamations (static: no anims)
}

function loadSeqs() {
  const file = path.resolve(process.cwd(), SEQS_FILE);
  seqRows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  console.info(`[nexaod] ${seqRows.length} custom seq(s)`);
}

/** The client's custom sequences (client/custom/seqs, dataset "customSeqs"), as definition archives are sent. */
function sendSeqs({ player }) {
  if (!player.getSession?.() || player.isPlayerBot?.()) return;   // bots render nothing
  player.getPacketSender().sendContentData("server", [{ key: "customSeqs", rows: seqRows }]);
}

module.exports = {
  name: "NexAod",
  ANGEL_OF_DEATH,
  register(api) {
    api.onServerStartup(loadSeqs);
    api.onPlayerLogin(sendSeqs);
    api.onServerStartup(() => {
      try { install(api); } catch (e) { console.warn("[nexaod] install failed:", e?.message ?? e); }
    });
  },
};
