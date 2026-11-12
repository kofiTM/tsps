/**
 * Nex: Angel of Death - shared ids, the arena's coordinates and small helpers.
 * The arena is region 8260 (RS3 region 3628 ported, scripts/rs3-port/aod.py); arena coordinates are
 * region-local: [32, 32] is her centre tile. Effects reuse Nex's helpers (nex/Common.Nex.js).
 */
const fs = require("fs");
const path = require("path");

const NEX_ID = 11278;
const ANGEL_OF_DEATH = 17000;                                   // NexAod.plugin.js: Nex at 1.7x, 5x5
const SIZE = 5;
const PILLARS = { blood: 17001, ice: 17002, smoke: 17003, shadow: 17004 };   // aod-pillars.json
const AMALGAMATIONS = { smoke: 17007, shadow: 17008, blood: 17009, ice: 17010 };   // aod-amalgamations.json
const MINIONS = { smoke: 17011, shadow: 17012, blood: 17013, ice: 17014 };   // aod-minions.json: Fumus, Umbra, Cruor, Glacies with dyed Wands of the praesul and Imperium cores
const AOD_NPCS = [ANGEL_OF_DEATH, PILLARS.blood, PILLARS.ice, PILLARS.smoke, PILLARS.shadow, ...Object.values(AMALGAMATIONS), ...Object.values(MINIONS)];
const OSRS_REGION = 8260;
const REGION = { chunkX: 256, chunkY: 544, width: 8, height: 8 };   // region 8260 = (32, 68)
const BASE = [2048, 4352];
const CENTRE = [32, 32];                                        // middle of the Zaros circle
const PLAYER_START = [32, 22];

let api = null;
let core = null;
let data = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "aod.json"), "utf8"));
}

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(Math.max(1, ticks), null, false); }
    execute() { this.stop(); try { action(); } catch (e) { console.error("[aod]", e); } }
  })());
}

/** Absolute world tile of an arena (region-local) [x, y]. */
const world = ([x, y], z = 0) => [BASE[0] + x, BASE[1] + y, z];

module.exports = {
  init, later, world,
  NEX_ID, ANGEL_OF_DEATH, SIZE, PILLARS, AMALGAMATIONS, AOD_NPCS, OSRS_REGION, REGION, BASE, CENTRE, PLAYER_START,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
