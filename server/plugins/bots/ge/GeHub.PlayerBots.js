"use strict";

/**
 * Grand Exchange life: bots bank-standing at the GE booths, skillers in a ring around them
 * (alching, glassblowing, cutting gems, fletching and stringing bows) who walk to a booth to
 * restock, a Forester's campfire the bonfire bots tend, groups of bots chatting, and visitors
 * who teleport in at the GE landing, bank, step away and teleport out (then despawn), as if
 * between boss trips. Stationary bots also leave now and then (teleport out) and a fresh bot
 * teleports in to take their place.
 *
 * Everything tunable is in data/definitions/bot-ge.json. Each bot runs one brain action
 * ("geLife") that drives its role; the hub's own tick spawns visitors and replacements, runs
 * the conversations and the odd chat line. Items the bots use are conjured onto non-persistent
 * bots and vanish with them, so nothing reaches the economy.
 */

const fs = require("fs");
const path = require("path");
const SRC = "../../../src/main/typescript/elvarg";
const { Location } = require(`${SRC}/game/model/Location`);
const { Item } = require(`${SRC}/game/model/Item`);
const { Equipment } = require(`${SRC}/game/model/container/impl/Equipment`);
const { Skill } = require(`${SRC}/game/model/Skill`);
const { Flag } = require(`${SRC}/game/model/Flag`);
const { Animation } = require(`${SRC}/game/model/Animation`);
const { Graphic } = require(`${SRC}/game/model/Graphic`);
const { Appearance } = require(`${SRC}/game/model/Appearance`);
const { ItemIdentifiers } = require(`${SRC}/util/ItemIdentifiers`);
const { SkillManager } = require(`${SRC}/game/content/skill/SkillManager`);
const { MapObjects } = require(`${SRC}/game/entity/impl/object/MapObjects`);
const { isUsableBankBooth } = require("../lib/BankBooths.PlayerBots");
const { attachBrain } = require("../brain/AttachBrain.PlayerBots");
const { applyLevels } = require("../brain/SiteSpawner.PlayerBots");
const { requestMovement, clearMovementRequest } = require("../behaviours/navigation/Navigation.PlayerBots");
const { realisticName } = require("../ai/Names.PlayerBots");
const Firemaking = require("../../skills/Firemaking.plugin");

const CONFIG_PATH = path.join(process.cwd(), "data", "definitions", "bot-ge.json");
const CRAFTING_DATA = path.join(__dirname, "..", "..", "skills", "data", "crafting.json");
const FLETCHING_DATA = path.join(__dirname, "..", "..", "skills", "data", "fletching.json");
const TICK_MS = 600;
const MODE = "ge_life";
const STATIONARY_ROLES = ["bankstander", "alcher", "glassblower", "gemcutter", "fletcher", "stringer", "bonfire", "social"];
const SKILLER_ROLES = new Set(["alcher", "glassblower", "gemcutter", "fletcher", "stringer"]);

const OUTFIT_SLOTS = Object.freeze({
  head: Equipment.HEAD_SLOT,
  cape: Equipment.CAPE_SLOT,
  amulet: Equipment.AMULET_SLOT,
  weapon: Equipment.WEAPON_SLOT,
  body: Equipment.BODY_SLOT,
  shield: Equipment.SHIELD_SLOT,
  legs: Equipment.LEG_SLOT,
  hands: Equipment.HANDS_SLOT,
  feet: Equipment.FEET_SLOT,
  ring: Equipment.RING_SLOT,
});

// Standard body kits and colours (male / female), as the character creator offers them.
const LOOKS = Object.freeze({
  male: { head: [0, 8], beard: [10, 17], chest: [18, 25], arms: [26, 31], hands: [33, 34], legs: [36, 40], feet: [42, 43] },
  female: { head: [45, 54], beard: [57, 57], chest: [56, 60], arms: [61, 65], hands: [67, 68], legs: [70, 77], feet: [79, 80] },
});

// Teleport spells: cast animation and graphic (TeleportType.ts), then gone 3 ticks later.
const TELEPORTS = Object.freeze({
  standard: { animation: 714, graphic: [111, 0, 92] },
  ancient: { animation: 1979, graphic: [392] },
  lunar: { animation: 1816, graphic: [747] },
  arceuus: { animation: 3865, graphic: [1296] },
});
const TELEPORT_VANISH_MS = 3 * TICK_MS;

// ---------------------------------------------------------------------------------- helpers

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const range = (value, fallback) => (Array.isArray(value) && value.length === 2 ? value : fallback);
const randRange = (value, fallback) => {
  const [min, max] = range(value, fallback);
  return rand(min, max);
};
const key = (x, y, z = 0) => `${x},${y},${z}`;
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** The dicing host's tile (plugins/bots/gamble), which the GE crowd keeps clear of. */
/** The gambling hosts' tiles (plugins/bots/gamble), which the GE crowd keeps clear of. */
const HOST_SPOT_PATHS = ["bot-dice-spot.json", "bot-flowers-spot.json"].map((file) => path.join(process.cwd(), "data", "saves", file));
function hostSpots() {
  const spots = [];
  for (const file of HOST_SPOT_PATHS) {
    try {
      const spot = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Number.isInteger(spot?.x) && Number.isInteger(spot?.y)) spots.push(spot);
    } catch {
      // no host placed
    }
  }
  return spots;
}
/** The placed gambling hosts by game: [{ game: "dice" | "flowers", spot }]. */
function gamblingHosts() {
  const hosts = [];
  for (const [game, file] of [["dice", "bot-dice-spot.json"], ["flowers", "bot-flowers-spot.json"]]) {
    try {
      const spot = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "saves", file), "utf8"));
      if (Number.isInteger(spot?.x) && Number.isInteger(spot?.y)) hosts.push({ game, spot: { x: spot.x, y: spot.y, z: spot.z ?? 0 } });
    } catch {
      // that host isn't placed
    }
  }
  return hosts;
}

/** The nearest gambling host to `tile`, or null when none is placed. */
function diceSpot(tile = null) {
  const spots = hostSpots();
  if (!tile || spots.length <= 1) return spots[0] ?? null;
  return spots.reduce((best, spot) => (cheb(tile, spot) < cheb(tile, best) ? spot : best));
}

function weightedPick(weights) {
  const entries = Object.entries(weights ?? {}).filter(([, weight]) => Number(weight) > 0);
  if (entries.length === 0) return null;
  let roll = Math.random() * entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  for (const [name, weight] of entries) {
    roll -= Number(weight);
    if (roll < 0) return name;
  }
  return entries[entries.length - 1][0];
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function itemId(name) {
  if (Number.isInteger(name)) return name;
  const id = ItemIdentifiers[name];
  return Number.isInteger(id) ? id : null;
}

function locOf(player) {
  const loc = player.getLocation();
  return { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
}

// ---------------------------------------------------------------------------------- the hub

const LOG_PATH = path.join(process.cwd(), "logs", "ge-bots.log");

/** Every GE hub event goes to logs/ge-bots.log (and the bot log). */
function fileLog(botApi, event, data = {}) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
  } catch {
    // logging must never break the hub
  }
  try {
    botApi?.log?.(event, data);
  } catch {
    // ignore
  }
}

function startGeHub(options = {}) {
  try {
    return startGeHubUnsafe(options);
  } catch (error) {
    fileLog(options.botApi, "ge_hub_register_failed", { error: String(error?.stack ?? error) });
    return null;
  }
}

function startGeHubUnsafe(options = {}) {
  const { api, botApi, runtime, registry, world, resetMovementState } = options;
  const log = (event, data = {}) => fileLog(botApi, event, data);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(options.configPath ?? CONFIG_PATH, "utf8"));
  } catch (error) {
    log("ge_hub_config_failed", { error: String(error?.message ?? error) });
    return null;
  }
  if (!config || config.enabled !== true || !runtime || !registry) {
    log("ge_hub_off", { enabled: config?.enabled, runtime: !!runtime, registry: !!registry });
    return null;
  }
  const core = api.core;
  const RegionManager = api.getRegionManager?.() ?? core.RegionManager;
  // A count may be a [min, max] range: rolled once per server start.
  for (const [role, value] of Object.entries(config.counts ?? {})) {
    if (Array.isArray(value) && value.length === 2) config.counts[role] = randInt(Number(value[0]), Number(value[1]));
  }
  log("ge_hub_registered", { startDelaySeconds: config.startDelaySeconds, counts: config.counts });

  const records = new Map(); // player -> record
  const posts = []; // stationary spots: { role, tile, face, group, slot, record, vacantSince }
  let layout = null;
  let started = false;
  let nextVisitorAt = 0;
  let recipes = null;

  // ------------------------------------------------------------------------------ recipes

  function loadRecipes() {
    const crafting = JSON.parse(fs.readFileSync(CRAFTING_DATA, "utf8"));
    const fletching = JSON.parse(fs.readFileSync(FLETCHING_DATA, "utf8"));
    const seqId = (name) => {
      try {
        return core.CacheDefinitions.getSeqId(name);
      } catch {
        return null;
      }
    };
    const glass = crafting.glassblowing;
    const glassRecipes = glass.recipes
      .map((recipe) => ({ level: recipe.level, xp: recipe.xp, output: itemId(recipe.item) }))
      .filter((recipe) => recipe.output != null);
    const gems = crafting.gems.recipes
      .map((gem) => ({ level: gem.level, xp: gem.xp, input: itemId(gem.uncut), output: itemId(gem.cut), animation: gem.seq }))
      .filter((gem) => gem.input != null && gem.output != null);
    const bows = (group) =>
      fletching.recipes
        .filter((recipe) => recipe.group === group && /(SHORTBOW|LONGBOW)/.test(recipe.output) && !/COMP|CROSS/.test(recipe.output))
        .map((recipe) => ({
          level: recipe.level,
          xp: recipe.xp,
          output: itemId(recipe.output),
          inputs: recipe.materials.map(([name, amount]) => [itemId(name), amount]),
          animation: seqId(recipe.animation ?? fletching.groups[group]?.animation ?? "human_fletching"),
        }))
        .filter((recipe) => recipe.output != null && recipe.inputs.every(([id]) => id != null));
    const fletchGroup = fletching.groups.logs ?? {};
    const stringGroup = fletching.groups.stringing ?? {};
    const alching = config.alching ?? {};
    return {
      glassblower: {
        skill: Skill.CRAFTING,
        intervalMs: 3 * TICK_MS,
        tool: itemId("GLASSBLOWING_PIPE"),
        list: glassRecipes.map((recipe) => ({ ...recipe, inputs: [[itemId("MOLTEN_GLASS"), 1]], animation: glass.seq })),
      },
      gemcutter: {
        skill: Skill.CRAFTING,
        intervalMs: 2 * TICK_MS,
        tool: itemId("CHISEL"),
        list: gems.map((gem) => ({ ...gem, inputs: [[gem.input, 1]] })),
      },
      fletcher: {
        skill: Skill.FLETCHING,
        intervalMs: Number(fletchGroup.ticks ?? 3) * TICK_MS,
        tool: itemId("KNIFE"),
        list: bows("logs"),
      },
      stringer: {
        skill: Skill.FLETCHING,
        intervalMs: Number(stringGroup.ticks ?? 2) * TICK_MS,
        tool: null,
        list: bows("stringing"),
      },
      alcher: {
        skill: Skill.MAGIC,
        intervalMs: Number(alching.intervalTicks ?? 5) * TICK_MS,
        tool: null,
        graphic: Number(alching.graphic ?? 113),
        list: (alching.items ?? [])
          .map(itemId)
          .filter((id) => id != null)
          .map((id) => ({
            level: Number(alching.spellLevel ?? 55),
            xp: Number(alching.xp ?? 65),
            inputs: [[id, 1], [itemId("NATURE_RUNE"), 1]],
            output: null,
            animation: Number(alching.animation ?? 713),
          })),
      },
    };
  }

  // ------------------------------------------------------------------------------ layout

  function blocked(x, y, z) {
    try {
      return RegionManager.blocked(new Location(x, y, z), null) === true;
    } catch {
      return true;
    }
  }

  function findBooths(center, radius) {
    const booths = [];
    for (let dx = -radius; dx <= radius; dx += 32) {
      for (let dy = -radius; dy <= radius; dy += 32) {
        RegionManager.loadMapFiles?.(center.x + dx, center.y + dy);
      }
    }
    RegionManager.loadMapFiles?.(center.x + radius, center.y + radius);
    for (let x = center.x - radius; x <= center.x + radius; x++) {
      for (let y = center.y - radius; y <= center.y + radius; y++) {
        const objects = MapObjects.mapObjects?.get?.(MapObjects.getHash(x, y, center.z)) ?? [];
        for (const object of objects) {
          const loc = object?.getLocation?.();
          if (!loc || loc.getX() !== x || loc.getY() !== y || loc.getZ() !== center.z) continue;
          if (isUsableBankBooth(object.getId())) {
            booths.push({ x, y, z: center.z, id: object.getId() });
            break;
          }
        }
      }
    }
    return booths;
  }

  /**
   * The GE's bankers stand behind its booths in the middle building: the booth is the tile
   * past each banker, away from the middle, and players bank from the tile past that.
   */
  function findBankerBooths(center, radius) {
    const World = api.getWorld?.() ?? core.World;
    let npcs = [];
    try {
      npcs = World?.getNpcsNear?.(new Location(center.x, center.y, center.z), radius, null) ?? [];
    } catch (error) {
      log("ge_hub_npc_scan_failed", { error: String(error?.message ?? error) });
    }
    const nameOf = (npc) => String(npc?.getDefinition?.()?.getName?.() ?? npc?.getName?.() ?? "");
    const bankers = npcs.filter((npc) => /banker/i.test(nameOf(npc)));
    const middle = { x: center.x + 0.5, y: center.y + 1.5 };
    const booths = [];
    for (const banker of bankers) {
      const loc = banker.getLocation();
      const dx = loc.getX() - middle.x;
      const dy = loc.getY() - middle.y;
      // Step straight out from the middle (diagonally on the corner sides).
      const sx = Math.abs(dx) >= Math.abs(dy) * 0.5 ? Math.sign(dx) : 0;
      const sy = Math.abs(dy) >= Math.abs(dx) * 0.5 ? Math.sign(dy) : 0;
      if (sx === 0 && sy === 0) continue;
      const booth = { x: loc.getX() + sx, y: loc.getY() + sy, z: center.z, id: -1, banker: true, out: { sx, sy } };
      if (!booths.some((other) => other.x === booth.x && other.y === booth.y)) booths.push(booth);
    }
    log("ge_hub_bankers", {
      npcsNear: npcs.length,
      bankers: bankers.length,
      names: [...new Set(npcs.map(nameOf))].slice(0, 15),
      booths: booths.map((booth) => `${booth.x},${booth.y}`),
    });
    return booths;
  }

  /** Last resort: the Grand Exchange clerks' booths the loot split uses (Split.TheatreOfBlood). */
  function clerkBooths(z) {
    return [
      { x: 3164, y: 3487, z, id: -1, clerk: true, out: { sx: 0, sy: -1 } },
      { x: 3165, y: 3487, z, id: -1, clerk: true, out: { sx: 0, sy: -1 } },
      { x: 3164, y: 3492, z, id: -1, clerk: true, out: { sx: 0, sy: 1 } },
      { x: 3165, y: 3492, z, id: -1, clerk: true, out: { sx: 0, sy: 1 } },
    ];
  }

  function buildLayout() {
    const approx = config.approxCenter ?? { x: 3164, y: 3488, z: 0 };
    const z = approx.z ?? 0;
    const center = { x: approx.x, y: approx.y, z };
    let booths = findBooths(center, Number(config.boothSearchRadius ?? 18));
    let source = "booth_objects";
    if (booths.length === 0) {
      booths = findBankerBooths(center, 12);
      source = "bankers";
    }
    if (booths.length === 0) {
      booths = clerkBooths(z);
      source = "clerk_tiles";
    }
    // The configured booth rows fill in any booths the scans missed.
    for (const row of config.extraBooths ?? []) {
      const ys = Array.isArray(row.y) ? row.y : [row.y, row.y];
      const xs = Array.isArray(row.x) ? row.x : [row.x, row.x];
      for (let x = xs[0]; x <= xs[1]; x++) {
        for (let y = ys[0]; y <= ys[1]; y++) {
          if (booths.some((booth) => booth.x === x && booth.y === y)) continue;
          booths.push({ x, y, z, id: -1, out: { sx: row.out?.[0] ?? 0, sy: row.out?.[1] ?? 0 } });
        }
      }
    }
    // The GE counter is a wall on the bankers' own tile, so the tile one step out from a banker is
    // where players stand: the booth is the banker's tile and players stand right against it.
    if (config.standAgainstCounter !== false) {
      for (const booth of booths) {
        if (!booth.out || booth.clerk || booth.shifted) continue;
        booth.x -= booth.out.sx;
        booth.y -= booth.out.sy;
        booth.shifted = true;
      }
    }
    log("ge_hub_booths", { source, count: booths.length, booths: booths.map((booth) => `${booth.x},${booth.y}`) });
    const centroid = {
      x: booths.reduce((sum, booth) => sum + booth.x, 0) / booths.length,
      y: booths.reduce((sum, booth) => sum + booth.y, 0) / booths.length,
    };
    const boothKeys = new Set(booths.map((booth) => key(booth.x, booth.y, z)));
    const nearestBooth = (tile) => booths.reduce((best, booth) => (!best || cheb(tile, booth) < cheb(tile, best) ? booth : best), null);
    const outward = (tile, booth) => dist2(tile, centroid) > dist2(booth, centroid);
    const settings = config.layout ?? {};
    const hosts = hostSpots();
    const keepAway = Number(config.keepAwayFromDice ?? 4);
    const nearDice = (tile, extra = 0) => hosts.some((host) => (tile.z ?? z) === (host.z ?? 0) && cheb(tile, host) <= keepAway + extra);
    const maxBeyond = Number(settings.maxFromCenterBeyondBooths ?? 8);
    const boothRadius = Math.max(...booths.map((booth) => Math.sqrt(dist2(booth, centroid))));
    const insidePlaza = (tile) => Math.sqrt(dist2(tile, centroid)) <= boothRadius + maxBeyond;

    // Booth fronts: the open tile on the plaza side of each booth, where a player banks.
    const fronts = [];
    for (const booth of booths) {
      // Against the counter first; one further out only if that tile turns out to be blocked.
      const directions = booth.out
        ? (blocked(booth.x + booth.out.sx, booth.y + booth.out.sy, z)
          ? [[booth.out.sx * 2, booth.out.sy * 2]]
          : [[booth.out.sx, booth.out.sy]])
        : [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of directions) {
        const tile = { x: booth.x + dx, y: booth.y + dy, z };
        if (boothKeys.has(key(tile.x, tile.y, z)) || blocked(tile.x, tile.y, z) || !outward(tile, booth) || nearDice(tile)) continue;
        if (fronts.some((front) => front.x === tile.x && front.y === tile.y)) continue;
        fronts.push({ ...tile, booth });
      }
    }
    const frontKeys = new Set(fronts.map((front) => key(front.x, front.y, z)));

    // Every open plaza tile around the booths, with its distance to the nearest booth.
    const area = [];
    const reach = maxBeyond + 2;
    const minX = Math.min(...booths.map((booth) => booth.x)) - reach;
    const maxX = Math.max(...booths.map((booth) => booth.x)) + reach;
    const minY = Math.min(...booths.map((booth) => booth.y)) - reach;
    const maxY = Math.max(...booths.map((booth) => booth.y)) + reach;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const tile = { x, y, z };
        if (boothKeys.has(key(x, y, z)) || blocked(x, y, z) || !insidePlaza(tile) || nearDice(tile)) continue;
        const booth = nearestBooth(tile);
        if (!outward(tile, booth)) continue;
        area.push({ ...tile, booth, fromBooth: cheb(tile, booth) });
      }
    }
    const open = new Set(area.map((tile) => key(tile.x, tile.y, z)));
    const clearAround = (tile, radius) => {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (!open.has(key(tile.x + dx, tile.y + dy, z))) return false;
        }
      }
      return true;
    };
    const facingBooth = (tile) => ({ x: tile.booth.x, y: tile.booth.y, z });
    const used = new Set();
    const take = (tile) => used.add(key(tile.x, tile.y, z));
    const free = (tile) => !used.has(key(tile.x, tile.y, z));
    for (const front of fronts) take(front); // fronts stay open for banking

    const counts = config.counts ?? {};
    const newPosts = [];

    // Bonfire: a clear spot a few tiles out, bots on the tiles around it.
    let bonfire = null;
    if (Number(counts.bonfire ?? 0) > 0) {
      const [bmin, bmax] = range(settings.bonfireDistance, [5, 8]);
      const configured = config.bonfire?.x != null && config.bonfire?.y != null
        ? { x: config.bonfire.x, y: config.bonfire.y, z }
        : null;
      const candidates = configured
        ? [configured]
        : shuffle(area.filter((tile) => tile.fromBooth >= bmin && tile.fromBooth <= bmax && clearAround(tile, 1)
          && !nearDice(tile, 2)));
      for (const tile of candidates) {
        let fireBlocked = false;
        try {
          fireBlocked = Firemaking.isFireTileBlocked?.(new Location(tile.x, tile.y, z), null) === true;
        } catch {
          fireBlocked = true;
        }
        if (fireBlocked) continue;
        bonfire = { x: tile.x, y: tile.y, z };
        break;
      }
      if (bonfire) {
        take(bonfire);
        const ring = shuffle([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]);
        const count = Math.min(Number(counts.bonfire), ring.length);
        for (let slot = 0; slot < count; slot++) {
          const tile = { x: bonfire.x + ring[slot][0], y: bonfire.y + ring[slot][1], z };
          if (!open.has(key(tile.x, tile.y, z))) continue;
          take(tile);
          newPosts.push({ role: "bonfire", tile, face: bonfire, slot });
        }
        // Keep a tile clear around the fire's neighbours so tenders are not walled in.
        for (const tile of area) if (cheb(tile, bonfire) <= 2) take(tile);
      }
    }

    // Social groups: small circles on clear patches, away from the fire and each other.
    const groups = [];
    if (Number(counts.social ?? 0) > 0) {
      const [smin, smax] = range(settings.socialDistance, [4, 7]);
      const wanted = Math.max(1, Number(config.social?.groups ?? 3));
      const candidates = shuffle(area.filter((tile) => tile.fromBooth >= smin && tile.fromBooth <= smax && clearAround(tile, 2)));
      for (const center of candidates) {
        if (groups.length >= wanted) break;
        if (groups.some((group) => cheb(group.center, center) < 7)) continue;
        if (bonfire && cheb(bonfire, center) < 6) continue;
        if (nearDice(center, 2)) continue;
        if (!free(center)) continue;
        groups.push({ center: { x: center.x, y: center.y, z }, members: [] });
      }
      const ringSpots = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]];
      const total = Number(counts.social);
      for (let index = 0; index < total && groups.length > 0; index++) {
        const groupIndex = index % groups.length;
        const group = groups[groupIndex];
        const spot = ringSpots.find(([dx, dy]) => free({ x: group.center.x + dx, y: group.center.y + dy }) && open.has(key(group.center.x + dx, group.center.y + dy, z)));
        if (!spot) continue;
        const tile = { x: group.center.x + spot[0], y: group.center.y + spot[1], z };
        take(tile);
        newPosts.push({ role: "social", tile, face: null, group: groupIndex, slot: index });
      }
      for (const group of groups) take(group.center);
    }

    // Bank-standers: on booth fronts, but leave plenty free for real players.
    const share = Math.max(0, Math.min(1, Number(settings.bankstanderMaxShareOfBoothFronts ?? 0.45)));
    const standerFronts = shuffle([...fronts]).slice(0, Math.min(Number(counts.bankstander ?? 0), Math.floor(fronts.length * share)));
    for (const front of standerFronts) {
      newPosts.push({ role: "bankstander", tile: { x: front.x, y: front.y, z }, face: facingBooth(front), bankFront: true });
    }

    // Skillers: as close to the bank as they can get. Free booth fronts first (keeping a
    // share open for real players), then the tiles right behind and beside the bankers,
    // one step further out at a time. Only once every close tile is taken do they share one.
    const keepFree = Math.max(0, Math.min(1, Number(settings.keepBoothFrontsFree ?? 0.25)));
    const standerKeys = new Set(standerFronts.map((front) => key(front.x, front.y, z)));
    const openFronts = shuffle(fronts.filter((front) => !standerKeys.has(key(front.x, front.y, z))));
    const skillerFronts = openFronts.slice(0, Math.max(0, openFronts.length - Math.ceil(fronts.length * keepFree)));
    const reservedFronts = new Set(openFronts.slice(skillerFronts.length).map((front) => key(front.x, front.y, z)));
    const nearTiles = shuffle(area.filter((tile) => tile.fromBooth >= 1 && tile.fromBooth <= 4 && !frontKeys.has(key(tile.x, tile.y, z))))
      .sort((a, b) => a.fromBooth - b.fromBooth);
    const closest = [
      ...skillerFronts.map((front) => ({ x: front.x, y: front.y, z, booth: front.booth, front })),
      ...nearTiles,
    ];
    const skillerRoles = shuffle(
      STATIONARY_ROLES.filter((name) => SKILLER_ROLES.has(name)).flatMap((role) => Array(Number(counts[role] ?? 0)).fill(role))
    );
    const skillerUse = new Map(); // tile key -> how many skillers stand there
    for (const role of skillerRoles) {
      let tile = closest.find((candidate) => {
        const k = key(candidate.x, candidate.y, z);
        return !skillerUse.has(k) && (candidate.front ? !reservedFronts.has(k) : free(candidate));
      });
      if (!tile) {
        // Everything close is taken: share the least crowded of the closest tiles.
        let fewest = Infinity;
        for (const candidate of closest) {
          const uses = skillerUse.get(key(candidate.x, candidate.y, z)) ?? 0;
          if (uses < fewest) {
            fewest = uses;
            tile = candidate;
          }
        }
      }
      if (!tile) break;
      const k = key(tile.x, tile.y, z);
      skillerUse.set(k, (skillerUse.get(k) ?? 0) + 1);
      take(tile);
      newPosts.push({
        role,
        tile: { x: tile.x, y: tile.y, z },
        face: facingBooth(tile),
        // On a booth front: banks right there without walking.
        bankFront: tile.front ? { x: tile.x, y: tile.y, z, booth: tile.booth } : null,
      });
    }

    return { z, booths, centroid, fronts, bonfire, groups, posts: newPosts };
  }

  // ------------------------------------------------------------------------------ dressing

  function rollLooks(bot) {
    if (config.randomLooks === false) return;
    const appearance = bot.getAppearance?.();
    if (!appearance?.getLook) return;
    const male = !(Math.random() < Number(config.femaleChance ?? 0.28));
    const look = [...appearance.getLook()];
    if (male) {
      const kits = LOOKS.male;
      look[Appearance.GENDER] = 0;
      look[Appearance.HEAD] = randInt(...kits.head);
      look[Appearance.BEARD] = randInt(...kits.beard);
      look[Appearance.CHEST] = randInt(...kits.chest);
      look[Appearance.ARMS] = randInt(...kits.arms);
      look[Appearance.HANDS] = randInt(...kits.hands);
      look[Appearance.LEGS] = randInt(...kits.legs);
      look[Appearance.FEET] = randInt(...kits.feet);
    } else {
      // The server's own female body (Appearance.set), which the client draws whole; only the
      // hairstyle varies. Random female body kits left the chest blank.
      look[Appearance.GENDER] = 1;
      look[Appearance.HEAD] = randInt(...LOOKS.female.head);
      look[Appearance.CHEST] = 57;
      look[Appearance.ARMS] = 65;
      look[Appearance.HANDS] = 68;
      look[Appearance.LEGS] = 77;
      look[Appearance.FEET] = 80;
      look[Appearance.BEARD] = 57;
    }
    look[Appearance.HAIR_COLOUR] = randInt(0, 11);
    look[Appearance.TORSO_COLOUR] = randInt(0, 15);
    look[Appearance.LEG_COLOUR] = randInt(0, 15);
    look[Appearance.FEET_COLOUR] = randInt(0, 4);
    look[Appearance.SKIN_COLOUR] = randInt(0, 7);
    appearance.setLookArray?.(look);
  }

  function combatOf(player) {
    try {
      return Number(player.getSkillManager?.()?.getCombatLevel?.() ?? 3);
    } catch {
      return 3;
    }
  }

  /**
   * An outfit for the role that fits the bot's combat level: boss gear needs 90+, mid gear 50+
   * (a level 81 isn't in torva); fashion and skilling outfits suit anyone.
   */
  function pickOutfitName(role, player) {
    let group = weightedPick(config.roles?.[role]?.outfits ?? { low: 1 });
    const combat = player ? combatOf(player) : 126;
    const minimum = config.outfitMinCombat ?? { boss: 90, midgear: 50 };
    if (group === "boss" && combat < Number(minimum.boss ?? 90)) group = "midgear";
    if (group === "midgear" && combat < Number(minimum.midgear ?? 50)) group = "low";
    // And no high level in low gear (a level 121 in mithril): above lowMaxCombat it's mid gear.
    if (group === "low" && combat > Number(minimum.lowMaxCombat ?? 59)) group = "midgear";
    const names = config.outfitGroups?.[group] ?? [];
    return names.length ? pick(names) : null;
  }

  function dress(bot, outfitName, extra = {}) {
    const equipment = bot.getEquipment?.();
    if (!equipment) return;
    const owner = records.get(bot);
    if (owner) owner.outfit = outfitName;
    equipment.resetItems?.();
    const outfit = config.outfits?.[outfitName] ?? {};
    const pieces = { ...outfit, ...extra };
    for (const [slotName, slot] of Object.entries(OUTFIT_SLOTS)) {
      const list = pieces[slotName];
      if (!Array.isArray(list) || list.length === 0) continue;
      const id = itemId(pick(list));
      if (id != null) equipment.set(slot, new Item(id, 1));
    }
    // A two-handed weapon never shows with a shield.
    const weapon = equipment.getItems?.()?.[Equipment.WEAPON_SLOT];
    try {
      if (weapon?.getId?.() > 0 && weapon.getDefinition?.()?.isDoubleHanded?.()) {
        equipment.set(Equipment.SHIELD_SLOT, new Item(-1, 0));
      }
    } catch {
      // definition lookups are best-effort
    }
    equipment.refreshItems?.();
    try {
      core.WeaponInterfaceManager?.assign?.(bot);
    } catch {
      // the stance follows the next appearance update anyway
    }
    bot.getUpdateFlag?.()?.flag?.(Flag.APPEARANCE);
  }

  function setLevelAtLeast(bot, skill, min) {
    const manager = bot.getSkillManager?.();
    if (!manager) return;
    const current = manager.getMaxLevel?.(skill) ?? manager.getCurrentLevel?.(skill) ?? 1;
    if (current >= min) return;
    const level = Math.min(99, randInt(min, Math.min(99, min + 15)));
    manager.setCurrentLevel(skill, level, false).setMaxLevels(skill, level, false)
      .setExperience(skill, SkillManager.getExperienceForLevel(level));
    bot.getUpdateFlag?.()?.flag?.(Flag.APPEARANCE);
  }

  // ------------------------------------------------------------------------------ spawning

  // ------------------------------------------------------------------------------ pets

  let petPool = null;

  /** Skilling and boss pets from the Pets plugin's own list (no cats, kittens or dogs). */
  function pets() {
    if (petPool) return petPool;
    const request = { pets: null };
    try {
      api.emitCustomEvent?.("pets:definitions", request);
    } catch {
      // no pets plugin
    }
    const skip = new RegExp(config.pets?.excludePattern ?? "KITTEN|CAT$|^CAT|DOG|HOUND", "i");
    petPool = (request.pets ?? []).filter((pet) => Number.isInteger(pet?.itemId) && !skip.test(String(pet.enumName ?? "")));
    log("ge_hub_pets", { available: petPool.length });
    return petPool;
  }

  /** The Pets plugin's skilling pets (its SKILLING_PETS); every other pet is a boss pet. */
  const SKILLING_PET = /^(HERON|BEAVER|[A-Z_]*CHINCHOMPA|ROCK_GOLEM[A-Z_0-9]*|GIANT_SQUIRREL|TANGLEROOT|ROCKY|SOUP|[A-Z_]*RIFT_GUARDIAN)$/;
  const isSkillingPet = (pet) => pet?.skill != null || SKILLING_PET.test(String(pet?.enumName ?? ""));

  /**
   * Now and then a bot has a pet following it: summoned by the Pets plugin as any follower.
   * Boss pets only on bots of bossPetMinCombat or more; lower bots only ever have skilling pets.
   */
  function maybeGivePet(record, chance) {
    if (!(Math.random() < chance)) return;
    const strong = combatOf(record.player) >= Number(config.pets?.bossPetMinCombat ?? 90);
    const pool = pets().filter((pet) => strong || isSkillingPet(pet));
    if (pool.length === 0) return;
    const pet = pick(pool);
    const request = { player: record.player, itemId: pet.itemId, summoned: false };
    try {
      api.emitCustomEvent?.("pets:summon", request);
    } catch (error) {
      log("ge_hub_pet_failed", { pet: pet.enumName, error: String(error?.message ?? error) });
    }
  }

  function freshName() {
    const World = api.getWorld?.() ?? core.World;
    for (let attempt = 0; attempt < 30; attempt++) {
      const name = realisticName();
      if (runtime.entriesByUsername?.has?.(name)) continue;
      if (World?.getPlayerByName?.(name)) continue;
      return name;
    }
    return null;
  }

  function spawnBot(role, at) {
    RegionManager.loadMapFiles?.(at.x, at.y);
    const username = freshName();
    let bot = null;
    try {
      bot = runtime.spawnPvpBot(new Location(at.x, at.y, at.z ?? 0), { mode: MODE, ...(username ? { username } : {}) });
    } catch (error) {
      log("ge_hub_spawn_failed", { role, error: String(error?.message ?? error) });
      return null;
    }
    if (!bot) {
      log("ge_hub_spawn_refused", { role, username });
      return null;
    }
    bot.getInventory?.()?.resetItems?.();
    bot.getInventory?.()?.refreshItems?.();
    const archetype = weightedPick(config.roles?.[role]?.archetypes ?? { midlevel: 1 }) ?? "midlevel";
    applyLevels(bot, config.archetypes?.[archetype]?.levels ?? { all: [20, 60] });
    rollLooks(bot);
    const outfit = pickOutfitName(role, bot);
    const record = {
      player: bot,
      role,
      archetype,
      outfit,
      state: "idle",
      stateAt: Date.now(),
      nextAt: 0,
      post: null,
      gone: false,
    };
    const extra = {};
    if (role === "alcher") {
      setLevelAtLeast(bot, Skill.MAGIC, Number(config.alching?.spellLevel ?? 55));
      extra.weapon = config.alching?.staffs ?? ["STAFF_OF_FIRE"];
      extra.shield = [];
    }
    dress(bot, outfit, extra);
    const activity = {
      id: `ge_${role}`,
      resolver: false,
      resolves: null,
      mode: MODE,
      capacity: 100000,
      repeat: true,
      ephemeral: false,
      manual: true,
      failureCooldownMs: 0,
      requires: [],
      setup: [],
      actions: [createGeLifeAction(record)],
      produces: [],
      site: null,
    };
    const attached = attachBrain({
      runtime,
      registry,
      world,
      bot,
      activity,
      home: at,
      resetMovementState,
      chooseNext: () => activity,
    });
    if (!attached) {
      despawn(record, "attach_failed");
      return null;
    }
    records.set(bot, record);
    return record;
  }

  function despawn(record, reason) {
    if (record.gone) return;
    record.gone = true;
    records.delete(record.player);
    if (record.post && record.post.record === record) {
      record.post.record = null;
      record.post.vacantSince = Date.now();
    }
    const player = record.player;
    try {
      player.getForcedLogoutTimer?.()?.start?.(0);
      player.requestLogout?.();
    } catch (error) {
      log("ge_hub_despawn_failed", { reason, error: String(error?.message ?? error) });
    }
  }

  function landingTile() {
    const spots = config.teleporters?.landingSpots ?? [];
    const spot = spots.length ? pick(spots) : { x: 3163, y: 3478, z: 0, radius: 2 };
    const radius = Number(spot.radius ?? 2);
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = spot.x + randInt(-radius, radius);
      const y = spot.y + randInt(-radius, radius);
      if (hostSpots().some((host) => cheb({ x, y }, host) <= Number(config.keepAwayFromDice ?? 4))) continue;
      if (!blocked(x, y, spot.z ?? 0)) return { x, y, z: spot.z ?? 0 };
    }
    return { x: spot.x, y: spot.y, z: spot.z ?? 0 };
  }

  /** A stationary bot for `post`: on its tile at startup, or teleporting in and walking there. */
  function fillPost(post, { arriving }) {
    const at = arriving ? landingTile() : post.tile;
    const record = spawnBot(post.role, at);
    if (!record) {
      log("ge_hub_post_spawn_failed", { role: post.role, at });
      return false;
    }
    record.post = post;
    post.record = record;
    post.vacantSince = 0;
    const life = range(config.stationary?.lifetimeMinutes, [25, 70]);
    record.leaveAt = Date.now() + rand(life[0], life[1]) * 60000;
    if (arriving) {
      record.state = "walkToPost";
      record.stateAt = Date.now();
      maybeSay(record, "teleporter_arrive", 0.15);
    } else {
      record.state = "atPost";
    }
    // Each bot starts at its own moment, so they never begin in step.
    record.nextAt = Date.now() + rand(0, 6000);
    stock(record);
    maybeGivePet(record, Number(config.pets?.chance ?? 0.12));
    return true;
  }

  function spawnVisitor() {
    const record = spawnBot("teleporter", landingTile());
    if (!record) return false;
    record.state = "arrived";
    record.stateAt = Date.now();
    record.nextAt = Date.now() + rand(600, 1500);
    maybeSay(record, "teleporter_arrive", 0.3);
    maybeGivePet(record, Number(config.pets?.teleporterChance ?? config.pets?.chance ?? 0.15));
    return true;
  }

  // ------------------------------------------------------------------------------ inventory

  function chooseRecipe(record) {
    const book = recipes?.[record.role];
    if (!book || book.list.length === 0) return null;
    const level = record.player.getSkillManager?.()?.getCurrentLevel?.(book.skill) ?? 1;
    const unlocked = book.list.filter((recipe) => recipe.level <= level);
    if (unlocked.length === 0) {
      const lowest = book.list.reduce((best, recipe) => (!best || recipe.level < best.level ? recipe : best), null);
      setLevelAtLeast(record.player, book.skill, lowest.level);
      return lowest;
    }
    // Mostly the best few they can make, sometimes anything.
    const sorted = [...unlocked].sort((a, b) => b.level - a.level);
    return Math.random() < 0.8 ? pick(sorted.slice(0, 3)) : pick(sorted);
  }

  /** Fresh supplies from the "bank": the tool, then as many sets of inputs as fit. */
  function stock(record) {
    const inventory = record.player.getInventory?.();
    if (!inventory) return;
    inventory.resetItems?.();
    if (SKILLER_ROLES.has(record.role)) {
      const book = recipes?.[record.role];
      const recipe = chooseRecipe(record);
      record.recipe = recipe;
      if (!book || !recipe) return;
      // Mimicked: nobody sees a bot's inventory, so it carries no items. It counts how many a
      // real inventory holds (28 slots, one for the tool), plays one action per item and banks
      // when the count runs out - no item churn on the server.
      let slots = 28;
      if (book.tool != null) slots -= 1;
      // Runes stack: one slot whatever the amount. Everything else is a slot per item.
      const stackable = new Set([itemId("NATURE_RUNE")]);
      const perSet = Math.max(1, recipe.inputs.filter(([id]) => !stackable.has(id)).reduce((sum, [, amount]) => sum + amount, 0));
      const stackSlots = recipe.inputs.filter(([id]) => stackable.has(id)).length;
      const sets = Math.max(1, Math.floor((slots - stackSlots) / perSet));
      record.setsLeft = sets;
      record.setsStocked = sets;
    } else if (record.role === "bonfire") {
      const logs = (config.bonfire?.logs ?? ["LOGS"])
        .map((name) => itemId(name))
        .filter((id) => id != null && Firemaking.canPlayerBurnLog?.(record.player, id));
      record.logId = logs.length ? (Math.random() < 0.7 ? logs[logs.length - 1] : pick(logs)) : itemId("LOGS");
      inventory.adds(itemId("TINDERBOX"), 1);
      inventory.adds(record.logId, 27);
    }
    inventory.refreshItems?.();
  }

  function hasInputs(record) {
    return !!record.recipe && Number(record.setsLeft ?? 0) > 0;
  }

  function makeOne(record) {
    const { player, recipe } = record;
    const book = recipes?.[record.role];
    if (!book || !recipe || !(record.setsLeft > 0)) return false;
    record.setsLeft -= 1;
    if (recipe.animation != null) player.performAnimation(new Animation(recipe.animation));
    if (book.graphic != null) player.performGraphic?.(new Graphic(book.graphic, 0, 92));
    player.getSkillManager?.()?.addExperiences?.(book.skill, recipe.xp);
    return true;
  }

  // ------------------------------------------------------------------------------ moving

  function at(player, tile) {
    const here = locOf(player);
    return here.x === tile.x && here.y === tile.y && here.z === (tile.z ?? here.z);
  }

  /**
   * A player's own walk (the loot split's GE trip walks the same way): the bot navigation's
   * request can swap a tile against the counter for a "safer" one nearby, and the bot then
   * never lands on its spot and keeps walking.
   */
  function walk(record, tile, nowMs) {
    const { player } = record;
    try {
      clearMovementRequest?.(player);
    } catch {
      // nothing queued
    }
    if (typeof core.PathFinder?.calculateWalkRoute === "function") {
      core.PathFinder.calculateWalkRoute(player, tile.x, tile.y);
      return;
    }
    requestMovement(player, tile.x, tile.y, { reason: "ge_walk", z: tile.z ?? 0, nowMs });
  }

  /** Stops any walk still queued, so a bot that has arrived stays put. */
  function settle(player) {
    try {
      clearMovementRequest?.(player);
    } catch {
      // nothing queued
    }
  }

  function face(player, tile) {
    if (!tile) return;
    const target = new Location(Math.round(tile.x), Math.round(tile.y), tile.z ?? 0);
    if (typeof player.forcePositionToFace === "function") player.forcePositionToFace(target);
    else player.setPositionToFace?.(target);
  }

  /** Stop facing whatever it was told to (the booth), so it doesn't turn back to it. */
  function clearFace(player) {
    try {
      player.setPositionToFace?.(null);
    } catch {
      // older builds: facing just lapses
    }
  }

  function moving(player) {
    return (player.getMovementQueue?.()?.size?.() ?? 0) > 0;
  }

  /** Walks toward `tile`; true once there. Gives up after `timeoutMs` and steps onto it. */
  function walkTo(record, tile, nowMs, timeoutMs = 25000) {
    if (at(record.player, tile)) {
      settle(record.player);
      return true;
    }
    if (nowMs - record.stateAt > timeoutMs) {
      // Couldn't walk there: put it on the tile and drop whatever walk was left.
      settle(record.player);
      record.player.getMovementQueue?.()?.reset?.();
      record.player.moveTo?.(new Location(tile.x, tile.y, tile.z ?? 0));
      return false;
    }
    if (!moving(record.player) && nowMs >= (record.walkRetryAt ?? 0)) {
      walk(record, tile, nowMs);
      record.walkRetryAt = nowMs + 1800;
    }
    return false;
  }

  const frontsInUse = new Map(); // front key -> record

  function claimFront(record) {
    const here = locOf(record.player);
    const fronts = [...(layout?.fronts ?? [])].sort((a, b) => cheb(a, here) - cheb(b, here));
    const busy = new Set(posts.filter((post) => post.bankFront && post.record).map((post) => key(post.tile.x, post.tile.y, post.tile.z)));
    const front = fronts.find((candidate) => {
      const k = key(candidate.x, candidate.y, candidate.z);
      const holder = frontsInUse.get(k);
      return !busy.has(k) && (!holder || holder.gone || holder === record);
    }) ?? fronts[0];
    if (front) frontsInUse.set(key(front.x, front.y, front.z), record);
    record.front = front ?? null;
    return front;
  }

  function releaseFront(record) {
    if (!record.front) return;
    const k = key(record.front.x, record.front.y, record.front.z);
    if (frontsInUse.get(k) === record) frontsInUse.delete(k);
    record.front = null;
  }

  function stepAwayTile(record) {
    const here = locOf(record.player);
    const centroid = layout?.centroid ?? here;
    const [min, max] = range(config.teleporters?.stepAwayTiles, [3, 6]);
    const angle = Math.atan2(here.y - centroid.y, here.x - centroid.x);
    for (let attempt = 0; attempt < 16; attempt++) {
      const distance = randInt(min, max);
      const turn = angle + rand(-0.9, 0.9);
      const x = Math.round(here.x + Math.cos(turn) * distance);
      const y = Math.round(here.y + Math.sin(turn) * distance);
      if (hostSpots().some((host) => cheb({ x, y }, host) <= Number(config.keepAwayFromDice ?? 4))) continue;
      if (!blocked(x, y, here.z)) return { x, y, z: here.z };
    }
    return here;
  }

  function teleportOut(record, nowMs) {
    const type = TELEPORTS[weightedPick(config.teleporters?.teleports ?? { standard: 1 }) ?? "standard"] ?? TELEPORTS.standard;
    const player = record.player;
    player.getMovementQueue?.()?.reset?.();
    clearFace(player);
    player.performAnimation(new Animation(type.animation));
    player.performGraphic?.(new Graphic(...type.graphic));
    record.state = "vanishing";
    record.stateAt = nowMs;
    record.nextAt = nowMs + TELEPORT_VANISH_MS;
  }

  // ------------------------------------------------------------------------------ chat

  function say(record, text) {
    if (!text || record.gone) return;
    try {
      if (core.ChatPacketListener?.handleText) {
        core.ChatPacketListener.handleText(record.player, text);
        return;
      }
    } catch {
      // fall back to overhead text
    }
    record.player.forceChat?.(text);
  }

  /**
   * A line for `list`; arrival and leaving lines come from the band that fits the bot's combat
   * level (chatter.levelLines), so a level 81 in rune talks about slayer, not vorkath.
   */
  function maybeSay(record, list, chance) {
    if (!(Math.random() < chance)) return;
    const bands = config.chatter?.levelLines?.[list];
    let lines = null;
    if (Array.isArray(bands) && bands.length) {
      const combat = combatOf(record.player);
      const band = bands.find((entry) => combat <= Number(entry.maxCombat ?? 126)) ?? bands[bands.length - 1];
      lines = band?.lines ?? null;
    }
    lines ??= config.chatter?.roleLines?.[list] ?? [];
    if (lines.length) say(record, pick(lines));
  }

  // ------------------------------------------------------------------------------ the bot action

  function createGeLifeAction(record) {
    return {
      id: "geLife",
      madeProgress: () => true,
      update(ctx) {
        if (record.gone) return "running";
        const nowMs = ctx.nowMs ?? Date.now();
        try {
          updateRecord(record, nowMs);
        } catch (error) {
          log("ge_hub_bot_error", { role: record.role, state: record.state, error: String(error?.message ?? error) });
          record.nextAt = nowMs + 2000;
        }
        return "running";
      },
      stop() {},
    };
  }

  function updateRecord(record, nowMs) {
    const { player } = record;
    if (record.state === "vanishing") {
      if (nowMs >= record.nextAt) despawn(record, "teleported");
      return;
    }
    if (record.state === "gamble") {
      updateGamble(record, nowMs);
      return;
    }
    if (record.role === "teleporter") {
      updateVisitor(record, nowMs);
      return;
    }
    if (record.state === "tripWait" || record.state === "tripToBank" || record.state === "tripBanking") {
      updateTrip(record, nowMs);
      return;
    }
    // Stationary bots: going home after their session.
    if (record.state === "leaving") {
      // Teleports the moment it stops on its tile (or gives up walking after 8 seconds).
      if (walkTo(record, record.leaveTile, nowMs, 8000) || nowMs - record.stateAt > 8000) {
        maybeSay(record, "teleporter_leave", 0.25);
        teleportOut(record, nowMs);
      }
      return;
    }
    if (record.state === "walkToPost") {
      if (walkTo(record, record.post.tile, nowMs, 30000)) {
        record.state = "atPost";
        record.stateAt = nowMs;
        face(player, record.post.face);
      }
      return;
    }
    const busy = record.state === "toBank" || record.state === "banking" || record.state === "fromBank";
    if (!busy && nowMs >= record.leaveAt && !Firemaking.isFiremakingActive?.(player)) {
      releaseFront(record);
      clearFace(player);
      record.state = "leaving";
      record.stateAt = nowMs;
      record.leaveTile = stepAwayTile(record);
      return;
    }
    if (busy) {
      updateBankTrip(record, nowMs);
      return;
    }
    if (!at(player, record.post.tile) && !record.lighting) {
      record.state = "walkToPost";
      record.stateAt = nowMs;
      return;
    }
    switch (record.role) {
      case "bankstander":
        updateBankstander(record, nowMs);
        break;
      case "social":
        // Just stands and chats (the conversations run from the hub); no turning to each other.
        break;
      case "bonfire":
        updateBonfire(record, nowMs);
        break;
      default:
        updateSkiller(record, nowMs);
        break;
    }
  }

  function startBankTrip(record, nowMs) {
    if (record.post?.bankFront?.booth) {
      // Already standing at a booth: bank where it stands.
      record.front = null;
      record.state = "banking";
      record.stateAt = nowMs;
      record.nextAt = nowMs + randRange(config.stationary?.bankTripSeconds, [2, 4]) * 1000;
      face(record.player, record.post.bankFront.booth);
      return;
    }
    const front = claimFront(record);
    if (!front) {
      stock(record);
      return;
    }
    record.state = "toBank";
    record.stateAt = nowMs;
  }

  function updateBankTrip(record, nowMs) {
    const { player } = record;
    if (record.state === "toBank") {
      if (!record.front || walkTo(record, record.front, nowMs, 20000)) {
        record.state = "banking";
        record.stateAt = nowMs;
        record.nextAt = nowMs + randRange(config.stationary?.bankTripSeconds, [2, 4]) * 1000;
        if (record.front) face(player, record.front.booth);
      }
      return;
    }
    if (record.state === "banking") {
      if (nowMs < record.nextAt) return;
      stock(record);
      releaseFront(record);
      record.state = "fromBank";
      record.stateAt = nowMs;
      return;
    }
    if (record.state === "fromBank") {
      if (walkTo(record, record.post.tile, nowMs, 20000)) {
        record.state = "atPost";
        record.stateAt = nowMs;
        record.nextAt = nowMs + rand(300, 1200) + humanDelay();
        face(player, record.post.face);
      }
    }
  }

  function updateSkiller(record, nowMs) {
    if (nowMs < record.nextAt || moving(record.player)) return;
    const book = recipes?.[record.role];
    if (!book) return;
    if (!hasInputs(record)) {
      // Now and then, a line showing how many it made before banking (should be a full inventory).
      if (Math.random() < 0.15) log("ge_hub_restock", { role: record.role, made: record.setsStocked ?? 0 });
      startBankTrip(record, nowMs);
      return;
    }
    if (record.state !== "working") {
      face(record.player, record.post.face);
      record.state = "working";
    }
    makeOne(record);
    // Make-all skills (fletching, stringing, gems, glass, smithing) run at the game's exact tick
    // speed, as "make all" does. Alching is a click per cast: a little late now and then.
    record.nextAt = nowMs + book.intervalMs + (record.role === "alcher" ? clickDelay() : 0);
  }

  /** A click per action: mostly on the tick or one late, sometimes two, rarely a short pause. */
  function clickDelay() {
    const roll = Math.random();
    if (roll < 0.7) return rand(0, TICK_MS);
    if (roll < 0.95) return rand(TICK_MS, 3 * TICK_MS);
    return rand(3000, 6000);
  }

  /**
   * How late a player clicks the next one: mostly on time or a tick late, sometimes a few
   * ticks, now and then a short pause, rarely an afk. Every bot rolls its own, so a row of
   * alchers drifts apart instead of casting on the same tick.
   */
  function humanDelay() {
    const roll = Math.random();
    if (roll < 0.55) return rand(0, TICK_MS);
    if (roll < 0.82) return rand(TICK_MS, 3 * TICK_MS);
    if (roll < 0.95) return rand(3000, 6000);
    return rand(10000, 25000);
  }

  function updateBankstander(record, nowMs) {
    if (nowMs < record.nextAt) return;
    const roll = Math.random();
    if (roll < 0.06) {
      // Re-gearing at the bank.
      dress(record.player, pickOutfitName(record.role, record.player));
    } else if (roll < 0.5) {
      face(record.player, record.post.face);
    }
    record.nextAt = nowMs + rand(6000, 25000);
  }

  function fireAtBonfire() {
    if (!layout?.bonfire) return null;
    const tile = new Location(layout.bonfire.x, layout.bonfire.y, layout.bonfire.z);
    try {
      return Firemaking.botFireAt?.(tile) ?? null;
    } catch {
      return null;
    }
  }

  const bonfireState = { failures: 0, disabled: false, lighter: null, lightingSince: 0 };

  function updateBonfire(record, nowMs) {
    const { player } = record;
    if (nowMs < record.nextAt) return;
    record.nextAt = nowMs + rand(600, 1800);
    if (bonfireState.disabled || !layout?.bonfire) {
      if (Math.random() < 0.2) face(player, layout?.bonfire ?? record.post.face);
      return;
    }
    if (Firemaking.isFiremakingActive?.(player)) return;
    const inventory = player.getInventory?.();
    if (!inventory || inventory.getAmount(record.logId) <= 0) {
      startBankTrip(record, nowMs);
      return;
    }
    const fire = fireAtBonfire();
    if (fire) {
      // Lit: everyone (the lighter too, once back on its tile) tends it.
      if (record.lighting) {
        record.lighting = false;
        if (bonfireState.lighter === record) {
          bonfireState.lighter = null;
          bonfireState.lightingSince = 0;
        }
        return; // the at-post check walks it back next tick
      }
      face(player, layout.bonfire);
      if (moving(player)) return;
      Firemaking.startBotTending?.(player, fire);
      return;
    }
    // No fire: one bot walks onto the spot and lights it; the others wait.
    const lighter = bonfireState.lighter;
    if (lighter && lighter !== record && !lighter.gone && nowMs - bonfireState.lightingSince < 20000) return;
    if (lighter !== record) {
      if (lighter) lighter.lighting = false;
      bonfireState.lighter = record;
      bonfireState.lightingSince = nowMs;
    }
    record.lighting = true;
    if (nowMs - bonfireState.lightingSince > 20000) {
      // Couldn't get there or it never caught: let someone else try.
      record.lighting = false;
      bonfireState.lighter = null;
      bonfireState.lightingSince = 0;
      bonfireState.failures += 1;
      if (bonfireState.failures >= 4) {
        bonfireState.disabled = true;
        log("ge_hub_bonfire_disabled", { x: layout.bonfire.x, y: layout.bonfire.y });
      }
      return;
    }
    if (!at(player, layout.bonfire)) {
      if (!moving(player)) walk(record, layout.bonfire, nowMs);
      return;
    }
    if (moving(player)) return;
    const started = Firemaking.startBotInventoryFiremaking?.(player, record.logId) !== false;
    if (started) {
      bonfireState.failures = 0;
      record.nextAt = nowMs + 3000;
    }
  }

  function updateVisitor(record, nowMs) {
    const { player } = record;
    const tele = config.teleporters ?? {};
    switch (record.state) {
      case "arrived":
        if (nowMs < record.nextAt) return;
        claimFront(record);
        record.state = "toBank";
        record.stateAt = nowMs;
        return;
      case "toBank":
        if (!record.front || walkTo(record, record.front, nowMs, Number(tele.walkTimeoutSeconds ?? 25) * 1000)) {
          record.state = "banking";
          record.stateAt = nowMs;
          record.nextAt = nowMs + randRange(tele.bankSeconds, [3, 9]) * 1000;
          if (record.front) face(player, record.front.booth);
          record.regeared = false;
        }
        return;
      case "banking":
        if (!record.regeared && nowMs - record.stateAt > 1200) {
          record.regeared = true;
          if (Math.random() < Number(tele.regearChance ?? 0.6)) dress(player, pickOutfitName("teleporter", player));
        }
        if (nowMs < record.nextAt) return;
        releaseFront(record);
        clearFace(player);
        record.state = "stepAway";
        record.stateAt = nowMs;
        record.leaveTile = stepAwayTile(record);
        return;
      case "stepAway":
        // Teleports the moment it stops on its tile, no looking back at the bank.
        if (walkTo(record, record.leaveTile, nowMs, 8000) || nowMs - record.stateAt > 8000) {
          maybeSay(record, "teleporter_leave", 0.2);
          teleportOut(record, nowMs);
        }
        return;
      default:
        record.state = "arrived";
        record.nextAt = nowMs;
    }
  }

  // ------------------------------------------------------------------------------ gambling

  let nextGambleAt = 0;

  function outfitGroupOf(name) {
    for (const [group, names] of Object.entries(config.outfitGroups ?? {})) if (names.includes(name)) return group;
    return null;
  }

  /** How much a bot puts up: maxed bots in boss gear bet the max (1b), the rest less by level. */
  function gambleStake(record) {
    const settings = config.gamble ?? {};
    const combat = combatOf(record.player);
    let coins;
    const ultraRich = isUltraRich(record);
    if (ultraRich) {
      coins = Number((settings.richest ?? {}).coins ?? 1000000000);
    } else {
      const bands = settings.stakes ?? [
        { maxCombat: 49, min: 100000, max: 2000000 },
        { maxCombat: 89, min: 1000000, max: 25000000 },
        { maxCombat: 109, min: 10000000, max: 150000000 },
        { maxCombat: 126, min: 50000000, max: 500000000 },
      ];
      const band = bands.find((entry) => combat <= Number(entry.maxCombat ?? 126)) ?? bands[bands.length - 1];
      const raw = rand(Number(band.min), Number(band.max));
      // Round as players bet: to 100k under 10m, to the million above.
      coins = raw < 10000000 ? Math.round(raw / 100000) * 100000 : Math.round(raw / 1000000) * 1000000;
      coins = Math.max(Number(band.min), coins);
    }
    // Only the ultra-rich ever bet in platinum tokens (1,000 coins each); everyone else bets coins.
    if (ultraRich && Math.random() < Number(settings.tokenChance ?? 0.3)) return { coins: 0, tokens: Math.floor(coins / 1000) };
    return { coins, tokens: 0 };
  }

  /** Maxed (richest.minCombat) and in boss gear: the ones who bet 1b, and gamble most often. */
  function isUltraRich(record) {
    const richest = (config.gamble ?? {}).richest ?? {};
    return combatOf(record.player) >= Number(richest.minCombat ?? 120) && outfitGroupOf(record.outfit) === (richest.outfitGroup ?? "boss");
  }

  /** "250m", "40m plat" - the stake as a bot would type it. */
  function stakeWords(stake) {
    const short = (value) => (value >= 1e9 ? `${+(value / 1e9).toFixed(1)}b` : value >= 1e6 ? `${+(value / 1e6).toFixed(1)}m` : `${Math.round(value / 1e3)}k`);
    return stake.tokens > 0 ? `${short(stake.tokens)} plat` : short(stake.coins);
  }

  /** Who can wander off to gamble: settled stationary bots, or visitors who just landed. */
  function gambleCandidates() {
    return [...records.values()].filter((record) => !record.gone && !record.lighting && (
      (record.role !== "teleporter" && (record.state === "atPost" || record.state === "working")) ||
      (record.role === "teleporter" && record.state === "arrived")));
  }

  /**
   * Each host has its own timer (gamble.hosts.<game>.everySeconds, else gamble.everySeconds):
   * when it's up and no bot is already at that host, one bot goes and plays a round there.
   */
  const nextGambleAtByGame = new Map();

  function gambleInterval(game) {
    const settings = config.gamble ?? {};
    return randRange(settings.hosts?.[game]?.everySeconds ?? settings.everySeconds, [30, 300]) * 1000;
  }

  function maybeStartGamble(nowMs) {
    const settings = config.gamble ?? {};
    if (settings.enabled === false) return;
    for (const host of gamblingHosts()) {
      if (settings.hosts?.[host.game]?.enabled === false) continue;
      if (!nextGambleAtByGame.has(host.game)) nextGambleAtByGame.set(host.game, nowMs + gambleInterval(host.game));
      if (nowMs < nextGambleAtByGame.get(host.game)) continue;
      nextGambleAtByGame.set(host.game, nowMs + gambleInterval(host.game));
      // One bot at a time per host, and none while players are trading or playing there.
      if ([...records.values()].some((record) => record.state === "gamble" && record.gamble?.game === host.game)) continue;
      if (hostBusy(host.game)) continue;
      const candidates = gambleCandidates();
      if (candidates.length === 0) continue;
      // The ultra-rich go far more often (richWeight times as likely as anyone else).
      const richWeight = Math.max(1, Number(settings.richWeight ?? 4));
      const weights = candidates.map((candidate) => (isUltraRich(candidate) ? richWeight : 1));
      let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
      const record = candidates.find((_, index) => (roll -= weights[index]) < 0) ?? candidates[0];
      startGamble(record, host, nowMs);
    }
  }

  function hostBusy(game) {
    const status = { game, busy: false };
    api.emitCustomEvent?.("gamble:host-status", status);
    return status.busy === true;
  }

  function startGamble(record, host, nowMs) {
    // The side of the host its players stand on (gamble.hosts.<game>.standSide, [dx, dy]): east of
    // the flower host, west of the dicer; another side only if that tile is blocked.
    const wanted = config.gamble?.hosts?.[host.game]?.standSide ?? (host.game === "flowers" ? [1, 0] : [-1, 0]);
    const sides = [wanted, ...shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => dx !== wanted[0] || dy !== wanted[1]))];
    const side = sides.find(([dx, dy]) => !blocked(host.spot.x + dx, host.spot.y + dy, host.spot.z)) ?? sides[0];
    record.gamble = {
      game: host.game,
      host: host.spot,
      tile: { x: host.spot.x + side[0], y: host.spot.y + side[1], z: host.spot.z },
      stake: gambleStake(record),
      phase: "toHost",
      at: nowMs,
      returnTo: record.role === "teleporter" ? "arrived" : "walkToPost",
    };
    releaseFront(record);
    clearFace(record.player);
    record.state = "gamble";
    record.stateAt = nowMs;
    log("ge_hub_gamble_start", { bot: record.player.getUsername?.(), game: host.game, stake: record.gamble.stake });
  }

  function endGamble(record, nowMs) {
    const back = record.gamble?.returnTo ?? "walkToPost";
    record.gamble = null;
    clearFace(record.player);
    record.state = back;
    record.stateAt = nowMs;
    record.nextAt = nowMs + rand(600, 1500);
  }

  function updateGamble(record, nowMs) {
    const gamble = record.gamble;
    if (!gamble) {
      endGamble(record, nowMs);
      return;
    }
    const { player } = record;
    switch (gamble.phase) {
      case "toHost":
        if (walkTo(record, gamble.tile, nowMs, 25000)) {
          face(player, gamble.host);
          say(record, pick(config.gamble?.betLines ?? ["{stake}", "{stake} pls", "{stake} on it"]).replace("{stake}", stakeWords(gamble.stake)));
          gamble.phase = "offer";
          // The bet "trade" takes a few seconds, as a real one does.
          gamble.at = nowMs + randRange(config.gamble?.tradeSeconds, [4, 8]) * 1000;
        }
        return;
      case "offer": {
        if (nowMs < gamble.at) return;
        // A player is trading or playing: the bot waits its turn (up to a minute), then bets.
        if (hostBusy(gamble.game)) {
          gamble.waitingSince ??= nowMs;
          if (nowMs - gamble.waitingSince > 60000) endGamble(record, nowMs);
          else gamble.at = nowMs + 1000;
          return;
        }
        const event = { game: gamble.game, player, stake: gamble.stake, accepted: false };
        api.emitCustomEvent?.("gamble:npc-round", event);
        if (!event.accepted) {
          // The host is busy with someone: try another time.
          endGamble(record, nowMs);
          return;
        }
        gamble.phase = "playing";
        gamble.at = nowMs + 90000; // gives up if the round never finishes
        gamble.callAt = nowMs + rand(1500, 4000);
        return;
      }
      case "playing":
        if (gamble.game === "flowers" && !gamble.called && nowMs >= gamble.callAt) {
          gamble.called = true;
          const call = Math.random() < 0.5 ? "hot" : "cold";
          say(record, pick(config.gamble?.callLines ?? ["{call}", "{call}", "{call} pls", "{call} lets go"]).replace("{call}", call));
          api.emitCustomEvent?.("gamble:npc-call", { player, call });
        }
        if (nowMs >= gamble.at) endGamble(record, nowMs);
        return;
      case "after":
        if (nowMs >= gamble.at) endGamble(record, nowMs);
        return;
      default:
        endGamble(record, nowMs);
    }
  }

  /** The host finished the round: a word about it, then the bot goes back to what it was doing. */
  function onNpcRoundDone(event) {
    const record = records.get(event?.player);
    if (!record?.gamble) return;
    const lines = event.won ? config.gamble?.winLines ?? ["ez", "gz me", "lets goo", "ty"] : config.gamble?.loseLines ?? ["rip", "unlucky", "again later", "gg"];
    setTimeout(() => {
      if (!record.gone) say(record, pick(lines));
      if (event.won) record.player.performAnimation?.(new Animation(862));
    }, rand(800, 2000));
    record.gamble.phase = "after";
    // A win waits for the host's payout "trade" before walking off.
    record.gamble.at = Date.now() + (event.won ? randRange(config.gamble?.payoutSeconds, [4, 7]) * 1000 + 1500 : rand(3000, 5000));
  }

  // ------------------------------------------------------------------------------ conversations

  const socialGroups = []; // { posts, convo, line, nextAt, speakers }

  /** A conversation is a list of [speaker, line], or { lines, trip: { boss, goers, outfits } }. */
  function asConversation(entry) {
    return Array.isArray(entry) ? { lines: entry, trip: null } : { lines: entry.lines ?? [], trip: entry.trip ?? null };
  }

  /**
   * Off bossing (a chat group agreed on it): to the bank, into boss gear, a few steps away and
   * teleport out. Its spot gets a new bot teleporting in within `tripReplaceSeconds`.
   */
  function startTrip(record, trip, startAt) {
    record.state = "tripWait";
    record.stateAt = Date.now();
    record.nextAt = startAt;
    record.trip = trip;
  }

  function updateTrip(record, nowMs) {
    const { player } = record;
    if (record.state === "tripWait") {
      if (nowMs < record.nextAt) return;
      claimFront(record);
      record.state = "tripToBank";
      record.stateAt = nowMs;
      return;
    }
    if (record.state === "tripToBank") {
      if (!record.front || walkTo(record, record.front, nowMs, 20000)) {
        record.state = "tripBanking";
        record.stateAt = nowMs;
        record.nextAt = nowMs + rand(2500, 5500);
        record.geared = false;
        if (record.front) face(player, record.front.booth);
      }
      return;
    }
    if (record.state === "tripBanking") {
      if (!record.geared && nowMs - record.stateAt > 1200) {
        record.geared = true;
        const strong = combatOf(player) >= Number((config.outfitMinCombat ?? {}).boss ?? 90);
        const groups = strong ? record.trip?.outfits ?? ["boss"] : ["midgear"];
        const names = groups.flatMap((group) => config.outfitGroups?.[group] ?? []);
        if (names.length) dress(player, pick(names));
      }
      if (nowMs < record.nextAt) return;
      releaseFront(record);
      clearFace(player);
      record.state = "leaving";
      record.stateAt = nowMs;
      record.leaveTile = stepAwayTile(record);
    }
  }

  function directConversations(nowMs) {
    const settings = config.social ?? {};
    const conversations = config.conversations ?? [];
    for (const group of socialGroups) {
      const alive = group.posts.map((post) => post.record).filter((record) => record && !record.gone && record.state === "atPost");
      if (!group.convo) {
        if (nowMs < group.nextAt) continue;
        const tripMin = Number(settings.tripMinCombat ?? 90);
        const allStrong = alive.every((record) => combatOf(record.player) >= tripMin);
        const usable = conversations
          .map(asConversation)
          .filter((convo) => new Set(convo.lines.map(([speaker]) => speaker)).size <= alive.length)
          .filter((convo) => !convo.trip || allStrong);
        if (alive.length < 2 || usable.length === 0) {
          group.nextAt = nowMs + 5000;
          continue;
        }
        // Sized to who's there: with 2 around a 2-person chat, with 4 or more mostly a 4-person one.
        const wantSpeakers = Math.min(alive.length, 4);
        const sized = usable.filter((convo) => new Set(convo.lines.map(([speaker]) => speaker)).size === wantSpeakers);
        group.convo = sized.length && Math.random() < 0.75 ? pick(sized) : pick(usable);
        group.line = 0;
        const cast = shuffle([...alive]);
        group.speakers = new Map();
        for (const [speaker] of group.convo.lines) {
          if (!group.speakers.has(speaker)) group.speakers.set(speaker, cast[group.speakers.size]);
        }
        group.nextAt = nowMs;
      }
      if (nowMs < group.nextAt) continue;
      const [speaker, text] = group.convo.lines[group.line] ?? [];
      const record = group.speakers.get(speaker);
      if (record && !record.gone) {
        say(record, text);
        if (Math.random() < Number(settings.emoteChance ?? 0.25)) {
          const emote = pick(settings.emotes ?? [861, 855, 863]);
          record.player.performAnimation(new Animation(emote));
        }
      }
      group.line += 1;
      if (group.line >= group.convo.lines.length) {
        // A trip agreed on: the ones going gear up at the bank and teleport out together.
        if (group.convo.trip) {
          // The whole group heads out (the ones who said yes first), then a new group forms
          // slowly: the first bot ~5 minutes later, then one at a time.
          const said = (group.convo.trip.goers ?? []).map((letter) => group.speakers.get(letter)).filter(Boolean);
          const goers = [...new Set([...said, ...alive])].filter((record) => !record.gone && record.state === "atPost");
          goers.forEach((record, index) => startTrip(record, group.convo.trip, nowMs + 1500 + index * rand(800, 2500)));
          const [fmin, fmax] = range(settings.tripReplaceSeconds, [240, 360]);
          const [gmin, gmax] = range(settings.joinGapSeconds, [30, 90]);
          let joinAt = nowMs + rand(fmin, fmax) * 1000;
          for (const post of shuffle([...group.posts])) {
            post.replaceAt = joinAt;
            joinAt += rand(gmin, gmax) * 1000;
          }
          group.nextAt = Math.max(group.nextAt, nowMs + fmin * 1000);
          if (goers.length) log("ge_hub_group_trip", { boss: group.convo.trip.boss, bots: goers.length });
          group.convo = null;
          continue;
        }
        group.convo = null;
        group.nextAt = nowMs + randRange(settings.pauseSeconds, [8, 30]) * 1000;
      } else {
        group.nextAt = nowMs + randRange(settings.lineSeconds, [2.5, 5.5]) * 1000;
      }
    }
  }

  // ------------------------------------------------------------------------------ the hub tick

  let lastChatterCheck = 0;

  function hubTick() {
    if (!started) return;
    const nowMs = Date.now();
    // Visitors: one every few seconds, up to the cap.
    const tele = config.teleporters ?? {};
    if (tele.enabled !== false && nowMs >= nextVisitorAt) {
      nextVisitorAt = nowMs + randRange(tele.everySeconds, [5, 12]) * 1000;
      const active = [...records.values()].filter((record) => record.role === "teleporter").length;
      // Sometimes a team lands together (2-4 at once), back from the same trip.
      const [gmin, gmax] = range(tele.groupSize, [2, 4]);
      const arriving = Math.random() < Number(tele.groupChance ?? 0.25) ? randInt(gmin, gmax) : 1;
      const room = Math.max(0, Number(tele.maxActive ?? 14) - active);
      for (let index = 0; index < Math.min(arriving, room); index++) spawnVisitor();
    }
    // Stationary replacements: a vacant post gets a new bot teleporting in after a short gap.
    const [rmin, rmax] = range(config.stationary?.replaceAfterSeconds, [10, 40]);
    for (const post of posts) {
      if (post.record || !post.vacantSince) continue;
      post.replaceAt ??= post.vacantSince + rand(rmin, rmax) * 1000;
      if (nowMs >= post.replaceAt) {
        post.replaceAt = null;
        if (!fillPost(post, { arriving: true })) post.vacantSince = nowMs;
      }
    }
    directConversations(nowMs);
    maybeStartGamble(nowMs);
    // The odd chat line from anyone who isn't in a conversation.
    if (nowMs - lastChatterCheck >= 1000) {
      lastChatterCheck = nowMs;
      const perSecond = Number(config.chatter?.chancePerMinute ?? 0.06) / 60;
      for (const record of records.values()) {
        if (record.role === "social" || record.role === "teleporter" || record.gone) continue;
        if (Math.random() >= perSecond) continue;
        const roleLines = config.chatter?.roleLines?.[record.role] ?? [];
        const lines = roleLines.length && Math.random() < 0.4 ? roleLines : config.chatter?.lines ?? [];
        if (lines.length) say(record, pick(lines));
      }
    }
  }

  function start() {
    try {
      startUnsafe();
    } catch (error) {
      log("ge_hub_start_failed", { error: String(error?.stack ?? error) });
    }
  }

  function startUnsafe() {
    if (started) return;
    log("ge_hub_starting", {});
    try {
      recipes = loadRecipes();
    } catch (error) {
      log("ge_hub_recipes_failed", { error: String(error?.message ?? error) });
      recipes = {};
    }
    layout = buildLayout();
    if (!layout) {
      log("ge_hub_no_booths", { center: config.approxCenter });
      return;
    }
    posts.push(...layout.posts);
    for (let index = 0; index < layout.groups.length; index++) {
      socialGroups.push({
        posts: posts.filter((post) => post.role === "social" && post.group === index),
        convo: null,
        line: 0,
        nextAt: Date.now() + rand(3000, 15000),
      });
    }
    log("ge_hub_dice_clearance", { hosts: hostSpots(), keepAway: Number(config.keepAwayFromDice ?? 4) });
    log("ge_hub_layout", {
      booths: layout.booths.length,
      fronts: layout.fronts.length,
      centroid: { x: Math.round(layout.centroid.x), y: Math.round(layout.centroid.y) },
      bonfire: layout.bonfire,
      socialGroups: layout.groups.map((group) => group.center),
      posts: posts.reduce((counts, post) => ({ ...counts, [post.role]: (counts[post.role] ?? 0) + 1 }), {}),
    });
    started = true;
    nextVisitorAt = Date.now() + 5000;
    // Spawn the stationary crowd a few per tick so the server doesn't hitch.
    const queue = shuffle([...posts]);
    const TaskBase = core.Task;
    class GeHubTick extends TaskBase {
      constructor() {
        super(1, "ge-hub", false);
      }
      execute() {
        try {
          for (let spawned = 0; spawned < 3 && queue.length > 0; spawned++) {
            const post = queue.shift();
            let ok = false;
            try {
              ok = fillPost(post, { arriving: false });
            } catch (error) {
              log("ge_hub_fill_failed", { role: post.role, error: String(error?.stack ?? error) });
            }
            if (!ok) post.vacantSince = Date.now();
            if (queue.length === 0) {
              log("ge_hub_crowd_spawned", { bots: records.size, posts: posts.length });
            }
          }
          hubTick();
        } catch (error) {
          log("ge_hub_tick_failed", { error: String(error?.message ?? error) });
        }
      }
    }
    (api.getTaskManager?.() ?? core.TaskManager).submit(new GeHubTick());
  }

  api.onCustomEvent?.("gamble:npc-round-done", onNpcRoundDone);

  api.onPlayerLogout?.(({ player }) => {
    const record = records.get(player);
    if (record) {
      record.gone = true;
      records.delete(player);
      if (record.post && record.post.record === record) {
        record.post.record = null;
        record.post.vacantSince = Date.now();
      }
      releaseFront(record);
    }
  });

  if (typeof api?.onServerStartup === "function") {
    api.onServerStartup(() => setTimeout(start, Math.max(0, Number(config.startDelaySeconds ?? 8)) * 1000));
  }

  // ::gebots - what the GE hub is doing (owner only).
  try {
    api.registerCommand?.("gebots", ({ player }) => {
      const byRole = {};
      for (const record of records.values()) byRole[record.role] = (byRole[record.role] ?? 0) + 1;
      player.sendMessage(`GE hub: ${started ? "running" : "not started"}, booths ${layout?.booths?.length ?? 0}, bots ${records.size}`);
      player.sendMessage(Object.entries(byRole).map(([role, count]) => `${role} ${count}`).join(", ") || "no bots");
      if (layout?.bonfire) player.sendMessage(`campfire at ${layout.bonfire.x}, ${layout.bonfire.y}`);
      if (!started) start();
    }, core.PlayerRights?.OWNER, "Show the Grand Exchange bots (starts them if they haven't)");
  } catch (error) {
    log("ge_hub_command_failed", { error: String(error?.message ?? error) });
  }
  return {
    start,
    records,
    get layout() {
      return layout;
    },
  };
}

module.exports = { startGeHub };
