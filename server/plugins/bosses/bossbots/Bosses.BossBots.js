/**
 * Server custom: every boss the boss bots go to, by its memory key (Memory.BossBots: drop book, chat
 * memory, deaths) - what the shared chat calls it. A new boss adds its entry here first
 * (docs/boss-bots.md), so the bots can talk about it anywhere: "{boss}" in a shared line is the boss
 * they're at ("verzik got sat"), "{BOSS}" the same shouted, "{unique}" its dream drop, "{elsewhere}" somewhere
 * else to go - never where they are (kofi: "the theatre of blood, perhaps" was said at the theatre).
 *
 * A shared line starting "[key] " is only said at that boss ("[nex] who stood in the smoke again?"):
 * Chatter.BossBots skips it anywhere else and drops the tag.
 *
 * Only what every boss shares lives in bossbots/: who the bots are, their memory and their chat.
 * Each boss keeps its own gear, supplies and fight code (Nex: Bots.Nex KITS and its tactics).
 */
const BOSSES = {
  nex: { name: "nex", place: "nex", unique: "torva" },
  // The raid's memory key (drops, deaths): named as a place. Its rooms' bosses are what they chat about.
  tob: { name: "the theatre", place: "theatre of blood", unique: "scythe" },
  maiden: { name: "maiden", place: "theatre of blood", unique: "scythe" },
  bloat: { name: "bloat", place: "theatre of blood", unique: "scythe" },
  nylocas: { name: "the nylos", place: "theatre of blood", unique: "scythe" },
  sotetseg: { name: "sotetseg", place: "theatre of blood", unique: "scythe" },
  xarpus: { name: "xarpus", place: "theatre of blood", unique: "scythe" },
  verzik: { name: "verzik", place: "theatre of blood", unique: "scythe" },
  cox: { name: "olm", place: "chambers of xeric", unique: "twisted bow" },
  toa: { name: "the wardens", place: "tombs of amascut", unique: "shadow" },
};

/** What the bots call the boss under `key` (an unknown key as it is). */
function bossName(key) {
  return BOSSES[key]?.name ?? key ?? "the boss";
}

/**
 * Every group boss and raid in the game, for "{elsewhere}" (kofi: any of them may come up anywhere - Nex at
 * the Theatre, the Theatre at Nex), as well as the ones the bots go to.
 */
const GROUP_CONTENT = [
  "chambers of xeric", "tombs of amascut", "theatre of blood", "nex", "the nightmare", "corporeal beast",
  "general graardor", "commander zilyana", "kree'arra", "k'ril tsutsaroth", "the royal titans", "the hueycoatl",
  "yama", "the dagannoth kings", "callisto", "vet'ion", "venenatis", "kalphite queen", "king black dragon",
];

/** Another place the bots go than the one under `key` (its rooms count as the same place). */
function elsewhere(key) {
  const here = BOSSES[key]?.place ?? key;
  const places = [...new Set([...Object.values(BOSSES).map((boss) => boss.place ?? boss.name), ...GROUP_CONTENT])].filter((place) => place !== here);
  return places[Math.floor(Math.random() * places.length)] ?? "somewhere new";
}

/** A shared line's blanks filled for the boss under `key`. */
function fillBoss(text, key) {
  const boss = BOSSES[key];
  const name = boss?.name ?? "the boss";
  const unique = boss?.unique ?? "mega rare";
  return String(text)
    .replace(/\{boss\}/g, name)
    .replace(/\{BOSS\}/g, name.toUpperCase())
    .replace(/\{unique\}/g, unique)
    .replace(/\{UNIQUE\}/g, unique.toUpperCase())
    .replace(/\{elsewhere\}/g, () => elsewhere(key));
}

/** The boss a "[key] " tagged line is for, or null for a line said anywhere. */
function tagOf(text) {
  return /^\[(\w+)\] /.exec(String(text))?.[1] ?? null;
}

/** The line without its "[key] " tag. */
function untagged(text) {
  return String(text).replace(/^\[\w+\] /, "");
}

module.exports = { BOSSES, bossName, fillBoss, tagOf, untagged };
