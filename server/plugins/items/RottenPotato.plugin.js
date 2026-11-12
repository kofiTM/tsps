"use strict";

/**
 * Rotten potato (https://oldschool.runescape.wiki/w/Rotten_potato): the Jagex staff tool, here for
 * developers. Each option opens a chatbox menu of commands, grouped as on the real potato:
 * - Eat (me): the Theatre of Blood's commands first (kofi), set all stats (one a tick, "setstat <skill> <level>", then "... finished cheating."),
 *   heal me, wipe the inventory but the potato, and toggles.
 * - Slice (world): teleports, and random events (the real Slice's anti-macro events).
 * - Peel (items): the bank, spawning items, gear sets.
 * - Mash (session): save me, kick me out, kill me, transmogrify me - and every command the player may
 *   use, by search or page. (The real Mash's "Keep me logged in" stops the idle logout; this server has
 *   none, so it saves the account instead.)
 * Used on an item it deletes it ("Whee... <item> All gone!"); on a player it shows their inventory; on an
 * NPC or object it offers what a developer wants of them. Server custom: the menus run the server's own
 * commands (api.runCommand), so each does exactly what its command does.
 */
const COMMANDS_PER_PAGE = 4;

let api;
let core;

function isDeveloper(player) {
  return (player.getRights?.()?.getId?.() ?? 0) >= core.PlayerRights.DEVELOPER.getId();
}

function run(player, command) {
  api.runCommand(player, command);
}

/** A typed answer (a name, coordinates, an id and amount), then `then(text)`. */
function ask(player, title, then) {
  player.setEnteredSyntaxAction({ execute: (text) => then(String(text ?? "").trim()) });
  player.getPacketSender().sendEnterInputPrompt(title);
}

function menu(player, title, ...options) {
  api.sendMultiChatboxPrompt(player, title, ...options);
}

/** Only developers can use it (on the real potato, only Jagex staff). */
function guard(player) {
  if (isDeveloper(player)) return true;
  player.sendMessage("Nothing interesting happens.");
  return false;
}

// ------------------------------------------------------------------ Eat: me

/** Every skill to `level`, one a tick, each said as the real potato says it. */
function setAllStats(player, level) {
  const skills = core.Skill.values();
  let index = 0;
  const task = new (class extends core.Task {
    constructor() { super(1, player, false); }
    execute() {
      if (!player.isRegistered() || index >= skills.length) {
        player.sendMessage("... finished cheating.");
        this.stop();
        return;
      }
      const name = skills[index++].getName().toLowerCase();
      run(player, `::setlevel ${name} ${level}`);
      player.sendMessage(`setstat ${name} ${level}`);
    }
  })();
  core.TaskManager.submit(task);
}

function healMe(player) {
  const { Skill } = core;
  const skills = player.getSkillManager();
  for (const skill of [Skill.HITPOINTS, Skill.PRAYER]) skills.setCurrentLevel(skill, skills.getMaxLevel(skill), true);
  player.setPoisonDamage?.(0);
  player.setVenomDamage?.(0);
  run(player, "::spec 100");
  player.setRunEnergy?.(100);
  player.sendMessage("You feel brand new.");
}

function wipeInventory(player, potato) {
  const inventory = player.getInventory();
  const keep = potato ?? inventory.getItems().find((entry) => entry?.getId?.() === core.ItemIdentifiers.ROTTEN_POTATO);
  inventory.resetItems();
  if (keep) inventory.add(new core.Item(core.ItemIdentifiers.ROTTEN_POTATO, 1), false);
  inventory.refreshItems();
  player.sendMessage("Your inventory has been wiped, all but the potato.");
}

function eat({ player, item }) {
  if (!guard(player)) return true;
  // The Theatre of Blood first (kofi): its testing is what the potato is mostly for now.
  menu(player, "Eat: me",
    "Theatre of Blood...", () => theatreMenu(player),
    // The Tombs of Amascut under it (kofi): its bot team and testing commands.
    "Tombs of Amascut...", () => tombsMenu(player),
    // The Chambers of Xeric under them (kofi 22:14); Set all stats moved into More to make room.
    "Chambers of Xeric...", () => chambersMenu(player),
    // The Fractured Archive under the Chambers (kofi 22:49); Toggles moved into More to make room.
    "The Fractured Archive...", () => archiveMenu(player),
    // Heal me moved here to make room for the Tombs (five to a menu).
    "More...", () => menu(player, "Eat: more",
      "Toggles...", () => menu(player, "Toggles",
        "Infinite prayer", () => run(player, "::infpray"),
        "Invulnerable", () => run(player, "::infhp"),
        "Infinite run", () => run(player, "::infrun"),
        "Invisible", () => run(player, "::invis"),
        "Click teleport", () => run(player, "::tele")),
      "Set all stats", () => ask(player, "Set every skill to what level? (1-99)", (text) => {
        const level = Math.max(1, Math.min(99, Number.parseInt(text, 10) || 99));
        setAllStats(player, level);
      }),
      "Max my stats", () => run(player, "::master"),
      "Heal me", () => healMe(player),
      "Wipe inventory", () => wipeInventory(player, item)));
  return true;
}

// ------------------------------------------------------------------ Slice: world

function slice({ player }) {
  if (!guard(player)) return true;
  menu(player, "Slice: world",
    "Teleport menu", () => run(player, "::teleports"),
    "Teleport to player", () => ask(player, "Teleport to which player?", (name) => name && run(player, `::teleto ${name}`)),
    "Bring player to me", () => ask(player, "Bring which player to you?", (name) => name && run(player, `::teletome ${name}`)),
    "Teleport to coordinates", () => ask(player, "Coordinates: x y [plane]", (text) => text && run(player, `::tele ${text}`)),
    "More...", () => menu(player, "Slice: more",
      "Random events (AMEs)", () => ask(player, "Random event number (blank for a random one)", (text) => run(player, `::randevt ${text}`.trim()))));
  return true;
}

/** The Theatre of Blood's testing commands, every one (kofi), five to a menu. */
function theatreMenu(player) {
  menu(player, "Theatre of Blood",
    "Enter with my bot team", () => run(player, "::tobenter"),
    "Go to a boss...", () => theatreRooms(player),
    "Skip to the next phase", () => run(player, "::tobphase"),
    "Kill the boss", () => run(player, "::tobkillboss"),
    "More...", () => menu(player, "Theatre of Blood: more",
      "Cross the boss barrier", () => run(player, "::tobcross"),
      "Complete this room", () => run(player, "::tobcomplete"),
      "Kill one of my bots", () => ask(player, "Kill which bot? (blank for a random one)", (name) => run(player, `::tobkillbot ${name}`.trim())),
      "Max points and a purple", () => run(player, "::tobmaxpoints"),
      "To Ver Sinhaza", () => run(player, "::tob")));
}

/**
 * The Tombs of Amascut's commands (kofi), as the Theatre's: in with a bot team (how many, then which raid -
 * Bots.TombsOfAmascut ::toaenter), and the raid's own skips (Commands.TombsOfAmascut).
 */
function tombsMenu(player) {
  menu(player, "Tombs of Amascut",
    "Enter with my bot team...", () => menu(player, "How many bots?",
      "7 bots", () => tombsRaid(player, 7),
      "4 bots", () => tombsRaid(player, 4),
      "2 bots", () => tombsRaid(player, 2)),
    "Go to a boss (puzzle skipped)...", () => menu(player, "Which path's boss?",
      "Zebak (Crondis)", () => run(player, "::toaboss crondis"),
      "Akkha (Het)", () => run(player, "::toaboss het"),
      "Kephri (Scabaras)", () => run(player, "::toaboss scabaras"),
      "Ba-Ba (Apmeken)", () => run(player, "::toaboss apmeken")),
    "Skip this puzzle", () => run(player, "::toaskippuzzle"),
    "Skip this boss", () => run(player, "::toaskipboss"),
    "More...", () => menu(player, "Tombs of Amascut: more",
      "Skip to the Wardens", () => run(player, "::toaskiptowarden"),
      "End the raid and go to the chest", () => run(player, "::toaskiptoreward"),
      "To the Tombs of Amascut lobby", () => run(player, "::toa")));
}

/**
 * The Chambers of Xeric's commands (kofi 22:14), as the Tombs' and the Theatre's: in with a bot team, to the Olm,
 * kill a room, the next floor, and the loot with a purple (Commands.ChambersOfXeric).
 */
function chambersMenu(player) {
  menu(player, "Chambers of Xeric",
    "Enter with my bot team...", () => menu(player, "How many bots?",
      "5 bots", () => run(player, "::coxenter 5"),
      "3 bots (under construction)", () => run(player, "::coxenter 3"),
      "2 bots (under construction)", () => run(player, "::coxenter 2")),
    "Go to the Great Olm", () => run(player, "::coxolm"),
    "Kill this room's monsters", () => run(player, "::coxkillroom"),
    "Skip to the next floor", () => run(player, "::coxnext"),
    "More...", () => menu(player, "Chambers of Xeric: more",
      "End the raid and go to the chest (a purple)", () => run(player, "::coxloot"),
      "Show the raid's layout", () => run(player, "::coxlayout"),
      "Give me 50,000 points", () => run(player, "::coxpoints 50000"),
      "To Mount Quidamortem", () => run(player, "::cox")));
}

/**
 * The Fractured Archive's commands (kofi 22:49), as the other raids': in to the Guardian, straight to a boss (each
 * before it beaten - ::tfaroom), win the challenge, set the boss's hitpoints, and the rest (Commands.FracturedArchive).
 */
function archiveMenu(player) {
  menu(player, "The Fractured Archive",
    "Enter (the Archive Guardian)", () => run(player, "::tfaguardian"),
    "Go to a boss...", () => menu(player, "Go to which boss?",
      "Bork", () => run(player, "::tfaroom BORK"),
      "Ezekiel", () => run(player, "::tfaroom EZEKIEL"),
      "Dreadnoth", () => run(player, "::tfaroom DREADNOTH"),
      "Xarth", () => run(player, "::tfaroom XARTH"),
      "Ocellus", () => run(player, "::tfaroom OCELLUS")),
    "Win this challenge", () => run(player, "::tfacomplete"),
    "Set the boss's hitpoints", () => ask(player, "Set the boss's hitpoints to?", (text) => text && run(player, `::tfahp ${text}`)),
    "More...", () => menu(player, "The Fractured Archive: more",
      "To the vault (raid won)", () => run(player, "::tfaroom VAULT"),
      "Back to the hub", () => run(player, "::tfaroom HUB"),
      "Replay the opening cutscene", () => run(player, "::tfaintro"),
      "Fade the boss...", () => ask(player, "Fade to? (0 opaque - 255 invisible)", (text) => text && run(player, `::tfafade ${text}`)),
      "To the Fractured Archive lobby", () => run(player, "::tfa")));
}

function tombsRaid(player, count) {
  menu(player, "Which raid?",
    "Entry mode (no invocations)", () => run(player, `::toaenter ${count} entry`),
    "All invocations", () => run(player, `::toaenter ${count} all`),
    "Testing: all boss invocations", () => run(player, `::toaenter ${count} testing`));
}

/** ::tobroom: the party to a boss past the Maiden (kofi), and ::tobloot to Verzik's vault. */
function theatreRooms(player) {
  menu(player, "Go to which boss?",
    "The Pestilent Bloat", () => run(player, "::tobroom BLOAT"),
    "The Nylocas", () => run(player, "::tobroom NYLOCAS"),
    "Sotetseg", () => run(player, "::tobroom SOTETSEG"),
    "Xarpus", () => run(player, "::tobroom XARPUS"),
    "More...", () => menu(player, "Go to which boss?",
      "Verzik Vitur", () => run(player, "::tobroom VERZIK"),
      "The loot room", () => run(player, "::tobloot")));
}

// ------------------------------------------------------------------ Peel: items

function peel({ player }) {
  if (!guard(player)) return true;
  menu(player, "Peel: items",
    "Bank", () => run(player, "::bank"),
    "Spawn item", () => ask(player, "Item id and amount (e.g. 4151 1), or blank for the item spawner", (text) => {
      run(player, /^\d/.test(text) ? `::item ${text}` : `::items ${text}`.trim());
    }),
    "Gear...", () => menu(player, "Gear",
      "Nex gear", () => run(player, "::nexgear"),
      "Max gear", () => run(player, "::maxgear")),
    "Special energy", () => run(player, "::spec 100"),
    "100m cash", () => run(player, "::cash"));
  return true;
}

// ------------------------------------------------------------------ Mash: session, and every command

function killMe(player) {
  player.setHitpoints(0);
  player.appendDeath();
}

function mash({ player }) {
  if (!guard(player)) return true;
  menu(player, "Mash: session",
    "Save my account", () => run(player, "::save"),
    "Kick me out", () => player.requestLogout(),
    "Kill me", () => killMe(player),
    "Transmogrify me", () => ask(player, "Become which NPC id? (-1 to be yourself)", (text) => text && run(player, `::pnpc ${text}`)),
    "All commands...", () => commandsMenu(player));
  return true;
}

/** Every command this player may use: a search, or a page at a time. */
function commandsMenu(player) {
  menu(player, "All commands",
    "Search commands", () => ask(player, "Search commands for...", (text) => showCommands(player, matching(player, text), 0, text)),
    "Browse every command", () => showCommands(player, matching(player, ""), 0, ""),
    "Type a command", () => ask(player, "Command to run (without ::)", (text) => text && run(player, `::${text}`)));
}

function matching(player, text) {
  const search = String(text ?? "").toLowerCase();
  return api.getRegisteredCommands(player).filter(({ command, description }) =>
    !search || command.includes(search) || description.toLowerCase().includes(search));
}

/** A page of commands: pick one to run it (asked for its arguments first), or turn the page. */
function showCommands(player, commands, page, search) {
  if (!commands.length) {
    player.sendMessage(`No commands match "${search}".`);
    return;
  }
  const pages = Math.ceil(commands.length / COMMANDS_PER_PAGE);
  const options = [];
  for (const { command, description } of commands.slice(page * COMMANDS_PER_PAGE, (page + 1) * COMMANDS_PER_PAGE)) {
    options.push(`::${command}`, () => {
      if (description) player.sendMessage(`::${command} - ${description}`);
      ask(player, `::${command} - extra words? (blank for none)`, (args) => run(player, `::${command} ${args}`.trim()));
    });
  }
  options.push(pages > 1 ? `Next page (${(page + 1) % pages + 1}/${pages})` : "Back", () => (pages > 1
    ? showCommands(player, commands, (page + 1) % pages, search)
    : commandsMenu(player)));
  menu(player, search ? `Commands: "${search}"` : `All commands (${page + 1}/${pages})`, ...options);
}

// ------------------------------------------------------------------ Use

function isPotato(id) {
  return Number(id) === core.ItemIdentifiers.ROTTEN_POTATO;
}

/** On an item: gone ("Whee... <item> All gone!"). */
function useOnItem(event) {
  const { player, usedItemId, usedWithItem, usedWithItemId, usedItem, usedItemSlot, usedWithItemSlot } = event;
  if (!isPotato(usedItemId) && !isPotato(usedWithItemId)) return;
  event.handled = true;
  if (!guard(player)) return;
  const [target, slot] = isPotato(usedItemId) ? [usedWithItem, usedWithItemSlot] : [usedItem, usedItemSlot];
  const name = core.ItemDefinition.forId(target.getId())?.getName?.() ?? "item";
  player.getInventory().setItem(slot, new core.Item(-1, 0)).refreshItems();
  player.sendMessage(`Whee... ${name} All gone!`);
}

/** On a player: their inventory, and what to do with them. */
function useOnPlayer(event) {
  const { player, target, itemId } = event;
  if (!isPotato(itemId)) return;
  event.handled = true;
  if (!guard(player)) return;
  const name = target.getUsername();
  const items = target.getInventory().getItems().filter((entry) => entry && entry.getId() > 0)
    .map((entry) => `${entry.getAmount() > 1 ? `${entry.getAmount()} x ` : ""}${core.ItemDefinition.forId(entry.getId())?.getName?.() ?? entry.getId()}`);
  player.sendMessage(`${name}'s inventory: ${items.length ? items.join(", ") : "empty"}.`);
  menu(player, name,
    "Bring them to me", () => run(player, `::teletome ${name}`),
    "Teleport to them", () => run(player, `::teleto ${name}`),
    "Kick them", () => run(player, `::kick ${name}`),
    "Nothing", () => player.getPacketSender().sendInterfaceRemoval());
}

/** On an NPC: what it is, or gone. */
function useOnNpc(event) {
  const { player, target, itemId } = event;
  if (!isPotato(itemId)) return;
  event.handled = true;
  if (!guard(player)) return;
  const definition = event.definition ?? target.getDefinition?.();
  const at = target.getLocation();
  player.sendMessage(`${definition?.getName?.() ?? "NPC"} - id ${target.getId()}, at ${at.getX()}, ${at.getY()}, ${at.getZ()}, hp ${target.getHitpoints?.() ?? "-"}.`);
  menu(player, definition?.getName?.() ?? "NPC",
    "Kill it", () => {
      target.setHitpoints?.(0);
      target.appendDeath?.();
    },
    "Remove it", () => api.removeNpc(target),
    "Become it", () => run(player, `::pnpc ${target.getId()}`),
    "Nothing", () => player.getPacketSender().sendInterfaceRemoval());
}

/** On an object: what it is. */
function useOnObject(event) {
  const { player, objectId, itemId, location } = event;
  if (!isPotato(itemId)) return;
  event.handled = true;
  if (!guard(player)) return;
  const name = core.ObjectDefinition?.forId?.(objectId)?.getName?.() ?? "object";
  player.sendMessage(`${name} - id ${objectId}, at ${location.x}, ${location.y}, ${location.z}.`);
}

/** ::rp - a rotten potato into the inventory. */
function givePotato({ player }) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    player.sendMessage("You need a free inventory slot for the rotten potato.");
    return true;
  }
  inventory.add(new core.Item(core.ItemIdentifiers.ROTTEN_POTATO, 1), true);
  player.sendMessage("You spawned a rotten potato!");
  return true;
}

module.exports = {
  name: "RottenPotato",
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.registerCommand("rp", givePotato, core.PlayerRights.DEVELOPER, "Spawn a rotten potato (developer command menus)");
    api.onItemAction("Rotten potato", { Eat: eat, Slice: slice, Peel: peel, Mash: mash });
    api.onItemOnItem(useOnItem);
    api.onItemOnPlayer(useOnPlayer);
    api.onItemOnNpc(useOnNpc);
    api.onItemOnObject(useOnObject);
  },
};
