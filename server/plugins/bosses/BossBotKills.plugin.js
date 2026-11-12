/**
 * Server custom (kofi, 2026-11-08): the boss bots' drop log gets kills from every boss in the game,
 * not only the ones they fight beside you (Nex, the Theatre, the Tombs, Chambers).
 *
 * Now and then one of the 104 boss bots (Roster.BossBots) gets a kill at a random boss: the loot is
 * rolled from that boss's real drop table (NpcDrops "npc-drops:roll-unattended", nobody there) and
 * written into the bot's drop book (Memory.BossBots, section = the boss's name, "vorkath"), so its
 * kill counts, rares, dry streaks and brags count every boss ("{rare}" can be a dragon pickaxe from
 * the Kalphite Queen). It's only the log: nothing spawns or drops in the world.
 *
 * The bosses the bots fight with you keep their own sections and are never picked here (BOSSES).
 * At startup every bot without a kill from here yet gets one; then one random bot gets one every
 * KILL_EVERY_MS (rolled). ::botkill [bot name] (owner) gives one now and says what it got.
 * Log: logs/boss-bot-kills.log.
 */
const fs = require("fs");
const path = require("path");
const Memory = require("./bossbots/Memory.BossBots");
const Roster = require("./bossbots/Roster.BossBots");
const { BOSSES } = require("./bossbots/Bosses.BossBots");
const { ItemDefinition } = require("../../src/main/typescript/elvarg/game/definition/ItemDefinition");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

/** Wait after startup before the first kills (the drop tables load on first use). */
const START_DELAY_MS = 60 * 1000;
/** Gap between kills after that: one random bot each time. */
const KILL_EVERY_MS = [3 * 60 * 1000, 8 * 60 * 1000];
/** Rare-flagged drops that aren't worth a brag. */
const NOT_A_RARE = /clue scroll|scroll box|ensouled|totem|key \(|brimstone key|larran/i;
const LOG_FILE = path.join(process.cwd(), "logs", "boss-bot-kills.log");

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Names (lowercase) the boss bots' own bosses use: never a section of this plugin's. */
const OWN = new Set(Object.entries(BOSSES).flatMap(([key, boss]) => [key, boss.name, boss.place].filter(Boolean).map((v) => String(v).toLowerCase())));

let api = null;
let bosses = null;

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // logging is best-effort
  }
}

/** Every boss with a drop table, minus the bots' own: [{ npcId, name, key }]. */
function bossList() {
  if (bosses) return bosses;
  const list = [];
  api.emitCustomEvent("npc-drops:bosses", { list });
  bosses = list
    .map((boss) => ({ ...boss, key: String(boss.name).toLowerCase().replace(/\s+/g, " ").trim() }))
    .filter((boss) => boss.key && !OWN.has(boss.key) && !boss.key.includes("nex"));
  log(`bosses: ${bosses.length} (${bosses.map((boss) => boss.name).join(", ")})`);
  return bosses;
}

function itemName(drop) {
  return ItemDefinition.forId(drop.itemId)?.getName?.() ?? "an item";
}

function describe(drop) {
  const name = itemName(drop);
  return drop.amount > 1 ? `${drop.amount} x ${name}` : name;
}

/** One kill at a random boss for `bot`, in its drop book: { boss, items, rare } (null when nothing's there to kill). */
function giveKill(bot) {
  const list = bossList();
  for (let tries = 0; tries < 5 && list.length; tries++) {
    const boss = pick(list);
    const drops = [];
    try {
      api.emitCustomEvent("npc-drops:roll-unattended", { npcId: boss.npcId, drops });
    } catch (error) {
      log(`roll failed for ${boss.name}: ${error?.message ?? error}`);
      continue;
    }
    const rareDrop = drops.find((drop) => drop.rare && !NOT_A_RARE.test(itemName(drop)));
    const items = drops.map(describe);
    const rare = rareDrop ? itemName(rareDrop) : null;
    Memory.dropBook(boss.key).record(bot, items, rare);
    log(`${bot} killed ${boss.name}: ${items.join(", ") || "nothing"}${rare ? `  RARE: ${rare}` : ""}`);
    return { boss: boss.name, items, rare };
  }
  return null;
}

/** Whether `bot` has a kill from here in its book yet. */
function hasKillHere(bot) {
  const keys = new Set(bossList().map((boss) => boss.key));
  return Object.keys(Memory.everywhere(bot)).some((section) => keys.has(section));
}

function start() {
  setTimeout(() => {
    try {
      let given = 0;
      for (const bot of Roster.NAMES) {
        if (!hasKillHere(bot) && giveKill(bot)) given++;
      }
      log(`startup: ${given} bots given their first random boss kill`);
    } catch (error) {
      log(`startup failed: ${error?.message ?? error}`);
    }
    const next = () => {
      const timer = setTimeout(() => {
        try {
          giveKill(pick(Roster.NAMES));
        } catch (error) {
          log(`kill failed: ${error?.message ?? error}`);
        }
        next();
      }, randomInt(...KILL_EVERY_MS));
      timer.unref?.();
    };
    next();
  }, START_DELAY_MS).unref?.();
}

module.exports = {
  name: "BossBotKills",
  register(pluginApi) {
    api = pluginApi;
    api.onServerStartup(start);
    api.registerCommand("botkill", ({ player, parts }) => {
      const asked = (parts ?? []).slice(1).join(" ").trim().toLowerCase();
      const bot = asked ? Roster.NAMES.find((name) => name.toLowerCase() === asked) : pick(Roster.NAMES);
      if (!bot) {
        player.sendMessage(`No boss bot called "${asked}".`);
        return true;
      }
      const kill = giveKill(bot);
      if (!kill) {
        player.sendMessage("No boss drop tables found.");
        return true;
      }
      player.sendMessage(`${bot} killed ${kill.boss}${kill.rare ? ` - RARE: ${kill.rare}` : ""}.`);
      player.sendMessage(`Loot: ${kill.items.join(", ").slice(0, 200) || "nothing"}`);
      return true;
    }, PlayerRights.OWNER, "Give a boss bot a random boss kill and loot in its drop log (::botkill [bot name])");
  },
};
