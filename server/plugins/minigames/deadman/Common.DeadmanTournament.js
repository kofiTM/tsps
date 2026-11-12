/**
 * Deadman Tournament: what the units share - the plugin api, plugins/minigames/data/
 * deadman-tournament.json, the world config, tick helpers, broadcasts and item lookups.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;

/** World config keys (world.json "pluginConfig"). */
const CONFIG = {
  enabled: "DeadmanTournament:enabled",
  botCount: "DeadmanTournament:botCount",
  autoStart: "DeadmanTournament:autoStart",
  shutdownOnEnd: "DeadmanTournament:shutdownOnEnd",
  countdownTicks: "DeadmanTournament:countdownTicks",
};

/** Attributes, kebab-case and namespaced; none are saved (the tournament lives for one server run). */
const ATTRIBUTES = {
  participant: "deadman-tournament:participant",
  bot: "deadman-tournament:bot",
  style: "deadman-tournament:style",
  runes: "deadman-tournament:runes",
  spectator: "deadman-tournament:spectator",
  // Generic PlayerBots switch (BotLooting / PvpLoadoutPolicy): the bot keeps what it wears and
  // carries, and its floor loot isn't cleaned up.
  fixedLoadout: "player-bots:fixed-loadout",
  // Generic PlayerBots switch (PvpCombat action): while on, the PvP loop leaves the bot alone - set
  // while a bot is busy with a boss, so the brain never resets that attack (Bots.holdPvp).
  holdPvp: "player-bots:hold-pvp",
  // Generic PlayerBots switch (PvpCombatExecutionNode.usesProtectionPrayers): the bot's own combat
  // brain keeps protection prayers up instead of switching overheads off.
  protectionPrayers: "player-bots:protection-prayers",
  // The tournament clan a fighter is in (its name).
  team: "deadman-tournament:clan",
  // Shared with the bot runtime's clan rules (AvengeOpponentPolicy, RegisterBotEvents); for a
  // real clan chat (FriendsChatManager) it holds the channel itself.
  clan: "clan-chat:channel",
  // AdminCommands' ::invis: NPCs and bosses that ask leave the player alone.
  invisible: "admin:invisible",
};

const LOG_FILE = path.join(process.cwd(), "logs", "deadman-tournament.log");

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "deadman-tournament.json"), "utf8"));
}

function config(key, fallback) {
  const value = api.getPluginConfig(key, fallback);
  return value == null ? fallback : value;
}

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, text);
  } catch (_error) {
    // Logging must never break the tournament.
  }
  console.info(`[deadman] ${line}`);
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      try {
        action();
      } catch (error) {
        log(`later() failed: ${error?.stack ?? error}`);
      }
    }
  })());
}

/** Runs `action` every tick until it returns false. */
function every(action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      let keep = true;
      try {
        keep = action() !== false;
      } catch (error) {
        log(`every() failed: ${error?.stack ?? error}`);
      }
      if (!keep) this.stop();
    }
  })());
}

function players() {
  const list = [];
  for (const player of core.World.getPlayers()) {
    if (player && player.isRegistered?.() !== false) list.push(player);
  }
  return list;
}

function realPlayers() {
  return players().filter((player) => player.isPlayerBot?.() !== true);
}

/** A broadcast line to every real player online. */
function broadcast(line) {
  for (const player of realPlayers()) {
    player.getPacketSender().sendTypedMessage(core.ChatType.BROADCAST, line);
  }
}

/** A filtered (spam) line to every real player: the kill feed. */
function feed(line) {
  for (const player of realPlayers()) {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, line);
  }
}

const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Clipping: a loc on the tile, floor decoration that blocks it, and a blocked tile. */
const LOC_ON_TILE = 0x100;
const FLOOR_BLOCKED = 0x40000;

/**
 * Whether a tile can be stood on. On the open map its region is loaded first (an unloaded region
 * reads as clear everywhere, water included) and water is refused.
 */
function standable(x, y, z, area) {
  const { RegionManager, Location } = core;
  try {
    if (!area) {
      const region = RegionManager.getRegion(x, y);
      if (!region?.isLoaded?.()) RegionManager.loadMapFiles(x, y, false);
      if (!RegionManager.getRegion(x, y)?.isLoaded?.()) return false;
      if (RegionManager.isWater(new Location(x, y, z))) return false;
    }
    return (RegionManager.getClipping(x, y, z, area) & (LOC_ON_TILE | FLOOR_BLOCKED | RegionManager.BLOCKED_TILE)) === 0;
  } catch (_error) {
    return false;
  }
}

/**
 * Whether a tile opens onto enough ground to get anywhere (not a fenced pen or a walled-in nook):
 * a walk outwards from it reaches OPEN_TILES tiles. Every tile such a walk reached is open too, so
 * they're remembered and the next check near them is free.
 */
const OPEN_TILES = 300;
const openTiles = new Set();
const closedTiles = new Set();

function openArea(x, y, z) {
  const key = (tx, ty) => `${tx},${ty},${z}`;
  if (openTiles.has(key(x, y))) return true;
  if (closedTiles.has(key(x, y))) return false;
  const { RegionManager } = core;
  const seen = new Set([key(x, y)]);
  const queue = [[x, y]];
  while (queue.length && seen.size < OPEN_TILES) {
    const [cx, cy] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (openTiles.has(k)) {
        for (const tile of seen) openTiles.add(tile);
        return true;
      }
      let can = false;
      try {
        can = RegionManager.canMove(cx, cy, nx, ny, z, 1, 1, null);
      } catch (_error) {
        can = false;
      }
      if (!can) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  const open = seen.size >= OPEN_TILES;
  for (const tile of seen) (open ? openTiles : closedTiles).add(tile);
  return open;
}

function inBox(x, y, box) {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/** Chebyshev distance between two locations (or {x, y}). */
function distance(a, b) {
  const ax = a.getX ? a.getX() : a.x;
  const ay = a.getY ? a.getY() : a.y;
  const bx = b.getX ? b.getX() : b.x;
  const by = b.getY ? b.getY() : b.y;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function asPlayer(mobile) {
  return mobile?.isPlayer?.() ? mobile.getAsPlayer?.() ?? mobile : null;
}

function alive(mobile) {
  return Boolean(mobile) && mobile.isRegistered?.() !== false && (mobile.getHitpoints?.() ?? 0) > 0;
}

function itemName(id) {
  return core.ItemDefinition.forId(id)?.getName?.() ?? `item ${id}`;
}

/** The Wilderness level a tile is in (the core's, else the usual (y - 3520) / 8 + 1). */
function wildernessLevel(x, y) {
  try {
    const level = core.Wilderness?.levelAt?.(x, y);
    if (Number.isFinite(level) && level > 0) return level;
  } catch (_error) {
    // Fall back to the formula below.
  }
  return Math.max(1, Math.floor((y - 3520) / 8) + 1);
}

/** Item ids from the data, checked against the cache's names once (a typo shows in the log). */
function checkItems() {
  const problems = [];
  const visit = (entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "number" || typeof entry[1] !== "string") return;
    const name = core.ItemDefinition.forId(entry[0])?.getName?.();
    if (!name || name.toLowerCase() !== entry[1].toLowerCase()) problems.push(`${entry[0]} is "${name}", data says "${entry[1]}"`);
  };
  const walk = (value) => {
    if (Array.isArray(value)) {
      visit(value);
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(data.kits);
  walk(data.loot);
  walk(data.bosses.pool.map((entry) => entry.uniques ?? []));
  walk(data.bosses.pile?.sets ?? []);
  if (problems.length) log(`item check: ${problems.length} mismatch(es): ${problems.join("; ")}`);
  else log("item check: every kit and loot item matches the cache");
}

/** Ticks as "2 minutes", "30 seconds", "1m 30s". */
function timeText(ticks) {
  const total = Math.max(0, Math.round(Number(ticks) * 0.6));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m && sec) return `${m}m ${sec}s`;
  if (m) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${sec} second${sec === 1 ? "" : "s"}`;
}

module.exports = {
  timeText,
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  get data() {
    return data;
  },
  CONFIG,
  ATTRIBUTES,
  config,
  log,
  later,
  every,
  players,
  realPlayers,
  broadcast,
  feed,
  randomInt,
  pick,
  shuffle,
  standable,
  openArea,
  inBox,
  distance,
  asPlayer,
  alive,
  itemName,
  wildernessLevel,
  checkItems,
};
