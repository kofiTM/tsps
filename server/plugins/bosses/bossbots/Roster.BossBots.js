/**
 * Server custom: the boss-bot roster, shared by every boss that brings bot teammates (Nex first; each
 * new boss uses the same 104 bots - see docs/boss-bots.md). A bot's name fixes its personality for
 * its whole life, at every boss, so "Torva Tom" is always the veteran, wherever he turns up.
 *
 * The personalities are kept here; what each one says at a boss is that boss's own talk table
 * (Talk.Nex for Nex), one entry per personality.
 */

/** Every personality, with what it's like (for whoever writes a new boss's talk table). */
const PERSONAS = {
  joker: "jokes and puns about everything, never serious",
  scholar: "RuneScape lore and history, polite and nerdy",
  grump: "complains about everything, dry and short",
  sweetheart: "kind, encouraging, happy for everyone",
  sweat: "efficiency, ticks, gp per hour and numbers",
  rookie: "new to bossing, curious, excited, asks questions",
  veteran: "played since 2007, 'back in my day', calm and wise",
  chill: "relaxed, no stress, good vibes",
  hype: "LOUD energy, caps, celebrates everything, lets gooo",
  ironman: "self-sufficient ironman, mentions it constantly, proud of every drop",
  flipper: "Grand Exchange merchant, prices, margins, gp value of everything",
  pker: "Wilderness pker, edgy banter, skulls, 'sit'",
  skiller: "would rather be skilling, levels, xp and calm hobbies",
  roleplayer: "speaks like a medieval knight, thee and thou, very dramatic",
  dad: "dad jokes, family man, wholesome and a little embarrassing",
  scammer: "shady, always asks if loot is ffa, hints he won't split a rare - and with one, scams the trade (Scam.BossBots)",
};

/**
 * A personality with few lines of its own speaks in another's voice everywhere else (kofi: the scammers in
 * the pker's), so a table without its lines still answers. `voiceOf(persona)` is the one to look up.
 */
const VOICE_OF = { scammer: "pker" };
function voiceOf(persona) {
  return VOICE_OF[persona] ?? persona;
}

/** The 104 bots and their personalities (the ironman ones: five Ironmen, four Hardcore, IRON_MODES). */
const BOT_PERSONAS = {
  "Fang Ur Mum": "joker", "Not A Bot": "joker", "Nexling Pls": "joker", "Spade Steve": "joker", "Cabbage Carl": "joker", "Lol Lumbridge": "joker",
  "Zaros Pilled": "scholar", "Ancient Abs": "scholar", "Nihil Dusty": "scholar", "Ashuelot Fan": "scholar", "Glacies Gg": "scholar", "Edicts Ed": "scholar", "Senntisten Sue": "scholar",
  "Kneel Nex": "grump", "Big Bones": "grump", "Pray Mage Pls": "grump", "Dharok Dan": "grump", "Cruor Cutter": "grump", "Grumpy Gnome": "grump", "Meh Mage": "grump",
  "Umbra Ella": "sweetheart", "Gz Gary": "sweetheart", "Blood Brother": "sweetheart", "Piety Pete": "sweetheart", "Fumus Fumes": "sweetheart", "Hugs N Heals": "sweetheart", "Kind Kate": "sweetheart",
  "Brew Bandit": "sweat", "Spec Daddy": "sweat", "Tick Perfect": "sweat", "Rigour Rob": "sweat", "Masori Mo": "sweat", "Dps Dan": "sweat", "Frame Perfect": "sweat",
  "Noob Nexer": "rookie", "Ice Breaker": "rookie", "Stab Lad": "rookie", "Lumby Legend": "rookie", "Zcb Enjoyer": "rookie", "Fresh Spawn": "rookie", "First Nex": "rookie",
  "Torva Tom": "veteran", "Old School Ollie": "veteran", "Barrows Bro": "veteran", "Varrock Vic": "veteran", "Wildy Wendy": "veteran", "Classic Clive": "veteran", "Rs2 Ron": "veteran",
  "Chill Pill": "chill", "Smoke Signal": "chill", "Shadow Step": "chill", "Rubybolt": "chill", "Zezima Fan": "chill", "Lazy Larry": "chill", "Afk Andy": "chill",
  "Hype Train": "hype", "Lets Gooo": "hype", "Big Energy": "hype", "Max Hype": "hype", "Yell Yell": "hype", "Turbo Tim": "hype",
  "Iron Ivan": "ironman", "Btw Iron": "ironman", "Self Made Sam": "ironman", "No Ge Greg": "ironman", "Iron Isla": "ironman",
  "Hcim Hank": "ironman", "Hc Harry": "ironman", "One Life Lou": "ironman", "Hardcore Hal": "ironman",
  "Ge Gremlin": "flipper", "Margin Mike": "flipper", "Flip Phil": "flipper", "Gp Grinder": "flipper", "Buy Low Lou": "flipper", "Bond Baron": "flipper",
  "Rag Rex": "pker", "Edge Pker": "pker", "Skull Trick": "pker", "Ags Andy": "pker", "Freeze Frank": "pker", "Sit Kid": "pker",
  "Lvl 3 Lily": "skiller", "Fletch Fred": "skiller", "Herb Harriet": "skiller", "Fishin Finn": "skiller", "Woodcut Wes": "skiller", "Rc Rachel": "skiller",
  "Sir Brewsalot": "roleplayer", "Lady Torvana": "roleplayer", "Squire Stab": "roleplayer", "Ser Ancient": "roleplayer", "Dame Glacia": "roleplayer", "Knight Nihil": "roleplayer",
  "Dad Jokes Dave": "dad", "Proud Papa": "dad", "Uncle Rune": "dad", "Bbq Bob": "dad", "Dad Bod Don": "dad", "Lawn Mow Mo": "dad",
  "Trust Me Bro": "scammer", "Ffa Fred": "scammer", "Free Loot Lenny": "scammer", "Legit Lewis": "scammer",
};

/** The ironman bots playing Hardcore Ironman; the rest of the ironman bots are plain Ironmen. */
const IRON_MODES = { "Hcim Hank": "hardcore", "Hc Harry": "hardcore", "One Life Lou": "hardcore", "Hardcore Hal": "hardcore" };
let ironModes = null;

/**
 * The chat icons a bot shows before its name: an ironman bot its mode's helmet, from the Ironman
 * mode's own data (plugins/modes/data/ironman.json). Only the icon - the bot isn't put on Ironman,
 * whose rules (no shared loot, no bank) would stop it fighting as a teammate.
 */
function chatIconsOf(name) {
  if (BOT_PERSONAS[name] !== "ironman") return [];
  if (!ironModes) {
    try {
      const file = require("path").join(__dirname, "..", "..", "modes", "data", "ironman.json");
      ironModes = JSON.parse(require("fs").readFileSync(file, "utf8")).modes ?? {};
    } catch {
      ironModes = {};
    }
  }
  const icon = ironModes[IRON_MODES[name] ?? "ironman"]?.icon;
  return Number.isInteger(icon) ? [icon] : [];
}

module.exports = { PERSONAS, BOT_PERSONAS, NAMES: Object.keys(BOT_PERSONAS), chatIconsOf, VOICE_OF, voiceOf };
