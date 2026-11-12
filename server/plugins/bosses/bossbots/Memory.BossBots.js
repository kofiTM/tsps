/**
 * Server custom: what the boss bots remember, shared by every boss (docs/boss-bots.md). Both live in
 * data/saves and outlast despawns and restarts.
 *
 * - The drop book (boss-bot-drops.json): each bot's last DROP_MEMORY kills at each boss, by section -
 *   the boss's key, or the key and a team-size variant ("nex [duo]") -
 *   { bot: { section: { kills, lastRare, dryAt, drops: [{ kill, items, rare? }] } } }. A bot carries
 *   its book from boss to boss: everywhere() is all of it. Dry and lucky are judged over every boss
 *   (its "overall" section: every kill anywhere, its last rare and where): a bot with a rare at one
 *   boss isn't dry at the next. Each is talked about once (kofi): a rare is bragged about the next time
 *   it can be, a dry streak moaned about once, then forgotten (told) - a rare's name dropped, the streak
 *   counted afresh - so the next mention is of the next rare or a whole new dry spell.
 * - The chat memory (boss-bot-chats.json): which chats were had at each boss, by kill -
 *   { boss: { kills, used: { list: { chat: kill } } } }. None comes up again within CHAT_REPEAT_KILLS
 *   kills of that boss.
 *
 * A new boss: `dropBook("key")` and `chatMemory("key")` (one line each), and a rare-drop test of its
 * own when it records drops.
 */
const fs = require("fs");
const path = require("path");

const SAVES = path.join(process.cwd(), "data", "saves");
const DROP_FILE = path.join(SAVES, "boss-bot-drops.json");
const CHAT_FILE = path.join(SAVES, "boss-bot-chats.json");
const DEATH_FILE = path.join(SAVES, "boss-bot-deaths.json");
/** Deaths kept per bot (every boss): { bot: [{ boss, cause, at }] }, newest last. */
const DEATH_MEMORY = 20;
/** Kills of drops kept per bot, per section. */
const DROP_MEMORY = 100;
/** A bot with no rare in this many kills (rolled from the range after each rare) is dry. */
const DRY_KILLS = [20, 80];
/** Kills of a boss before one of its chats can come up again. */
const CHAT_REPEAT_KILLS = 20;

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
/** The section counting a bot's kills and rares at every boss together. */
const OVERALL = "overall";
const files = new Map();

function load(file) {
  if (files.has(file)) return files.get(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") data = {};
  files.set(file, data);
  return data;
}

/**
 * A change is saved a moment later (SAVE_DELAY_MS), once for everything changed meanwhile, and
 * written in the background: a full drop book (100 bots, 100 kills, several bosses) runs to about
 * 10 MB, and writing it for every bot's drop, in the middle of a game tick, made a lag spike (kofi).
 * Anything still unsaved is written at once as the server stops (flush).
 */
const SAVE_DELAY_MS = 1000;
const pending = new Set();
let timer = null;
const writing = new Map();

function save(file) {
  pending.add(file);
  if (!timer) timer = setTimeout(writeSoon, SAVE_DELAY_MS);
}

function writeSoon() {
  timer = null;
  for (const file of [...pending]) {
    pending.delete(file);
    // One write at a time per file: a change made while one is going waits for the next round.
    if (writing.get(file)) {
      save(file);
      continue;
    }
    writing.set(file, true);
    const text = JSON.stringify(load(file), null, 1);
    fs.promises.mkdir(path.dirname(file), { recursive: true })
      .then(() => fs.promises.writeFile(`${file}.tmp`, text))
      .then(() => fs.promises.rename(`${file}.tmp`, file))
      .catch((error) => console.warn(`[boss-bots] ${path.basename(file)} not saved: ${error?.message ?? error}`))
      .finally(() => writing.set(file, false));
  }
}

/** Everything unsaved, written now (the server stopping, a test). */
function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  for (const file of [...pending]) {
    pending.delete(file);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(load(file), null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
      console.warn(`[boss-bots] ${path.basename(file)} not saved: ${error?.message ?? error}`);
    }
  }
}

process.on("exit", flush);

/**
 * A bot's kills at every boss together: { kills, lastRare, dryAt, rare?, rareAt? } - built once from
 * its boss sections when it has none yet (an older book).
 */
function overallOf(bot) {
  const book = load(DROP_FILE);
  const sections = (book[bot] = book[bot] ?? {});
  if (sections[OVERALL]) return sections[OVERALL];
  let kills = 0;
  let since = Infinity;
  let last = null;
  for (const [name, kept] of Object.entries(sections)) {
    kills += kept.kills ?? 0;
    if ((kept.lastRare ?? 0) > 0 && kept.kills - kept.lastRare < since) {
      since = kept.kills - kept.lastRare;
      last = { rare: [...(kept.drops ?? [])].reverse().find((drop) => drop.rare)?.rare, rareAt: name };
    }
  }
  sections[OVERALL] = { kills, lastRare: since === Infinity ? 0 : kills - since, dryAt: randomInt(...DRY_KILLS), ...(last ?? {}) };
  return sections[OVERALL];
}

/** One boss's drop book: `variant` (a team size, say) keeps a separate section under the same bot. */
function dropBook(boss) {
  const section = (variant) => (variant ? `${boss} [${variant}]` : boss);
  const peek = (bot, variant) => load(DROP_FILE)[bot]?.[section(variant)] ?? null;
  const entry = (bot, variant) => {
    const book = load(DROP_FILE);
    const sections = (book[bot] = book[bot] ?? {});
    return (sections[section(variant)] = sections[section(variant)] ?? { kills: 0, lastRare: 0, dryAt: randomInt(...DRY_KILLS), drops: [] });
  };
  return {
    /** The bot's section here, or null before its first kill. */
    peek,
    /** A kill's drops (described as text) and its rare, if any. */
    record(bot, items, rare = null, variant = null) {
      const overall = overallOf(bot);
      overall.kills++;
      if (rare) Object.assign(overall, { lastRare: overall.kills, dryAt: randomInt(...DRY_KILLS), rare, rareAt: section(variant), rareUnsaid: true });
      const kept = entry(bot, variant);
      kept.kills++;
      kept.drops.push({ kill: kept.kills, items, ...(rare ? { rare } : {}) });
      if (kept.drops.length > DROP_MEMORY) kept.drops.splice(0, kept.drops.length - DROP_MEMORY);
      if (rare) {
        kept.lastRare = kept.kills;
        kept.dryAt = randomInt(...DRY_KILLS);
        // Every rare ever, by name, where a book keeps a tally (seed): its last DROP_MEMORY kills alone forget them.
        if (kept.totals) kept.totals[rare] = (kept.totals[rare] ?? 0) + 1;
      }
      save(DROP_FILE);
    },
    /** Every rare it has had here, by name ({ "Scythe of Vitur": 8 }), where its book keeps a tally (seed). */
    totals(bot, variant = null) {
      return peek(bot, variant)?.totals ?? {};
    },
    /**
     * Kills since its last rare at any boss once past its dry spell and not yet moaned about, otherwise
     * 0. Once told, a new spell (dryAt) counts from then.
     */
    dryFor(bot) {
      if (!load(DROP_FILE)[bot]) return 0;
      const overall = overallOf(bot);
      const dry = overall.kills - overall.lastRare;
      const since = overall.kills - Math.max(overall.lastRare, overall.dryToldAt ?? 0);
      return since >= overall.dryAt ? dry : 0;
    },
    /** Kills since its last rare at any boss while it hasn't bragged about it yet, otherwise 0. */
    luckyFor(bot) {
      if (!load(DROP_FILE)[bot]) return 0;
      const overall = overallOf(bot);
      if (overall.lastRare <= 0 || !overall.rareUnsaid) return 0;
      return Math.max(1, overall.kills - overall.lastRare);
    },
    /**
     * It's said it (kofi: once, then forgotten): "lucky" - the rare's bragged about, its name dropped;
     * "dry" - the streak's moaned about, the next only after a whole new dry spell.
     */
    told(bot, kind) {
      if (!load(DROP_FILE)[bot]) return;
      const overall = overallOf(bot);
      if (kind === "lucky") {
        overall.rareUnsaid = false;
        delete overall.rare;
        delete overall.rareAt;
      } else if (kind === "dry") {
        overall.dryToldAt = overall.kills;
        overall.dryAt = randomInt(...DRY_KILLS);
      }
      save(DROP_FILE);
    },
    /**
     * A bot's kill count here raised to at least `kills` (King of TOB starts as a veteran), with `drops`
     * ([{ kill, items, rare? }]) kept in its book; counted in its every-boss total too. Not dry from it.
     */
    seed(bot, kills, drops = [], variant = null, totals = null) {
      const kept = entry(bot, variant);
      // Its rares over the kills before its book (kofi: the King's 5000), counted on from there by record.
      if (totals && !kept.totals) {
        kept.totals = { ...totals };
        save(DROP_FILE);
      }
      if (kept.kills >= kills) return;
      const overall = overallOf(bot);
      overall.kills += kills - kept.kills;
      overall.lastRare = overall.kills;
      kept.kills = kills;
      kept.lastRare = kills;
      kept.drops = [...drops, ...kept.drops].sort((a, b) => a.kill - b.kill).slice(-DROP_MEMORY);
      save(DROP_FILE);
    },
    /**
     * Once only: a boss's old book of its own ({ key: section entry }), each key parsed to
     * [bot, variant] by `parse`, folded in where the shared book has nothing yet.
     */
    importOnce(file, parse) {
      const book = load(DROP_FILE);
      const done = (book.__imported = book.__imported ?? {});
      const name = path.basename(file);
      if (done[name]) return;
      let old = null;
      try {
        old = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        old = null;
      }
      for (const [key, kept] of Object.entries(old ?? {})) {
        const [bot, variant] = parse(key);
        const sections = (book[bot] = book[bot] ?? {});
        sections[section(variant)] = sections[section(variant)] ?? kept;
      }
      done[name] = true;
      save(DROP_FILE);
    },
  };
}

/**
 * The coins a bot has made, every boss together (kofi: King of TOB's from his raid splits), kept as a
 * whole-number string so it never stops at the game's 2,147m stack: { bot: { overall: { cash } } }.
 */
function cashOf(bot) {
  const cash = load(DROP_FILE)[bot]?.[OVERALL]?.cash;
  try {
    return BigInt(cash ?? 0);
  } catch {
    return 0n;
  }
}

/** Adds `amount` coins (a number or BigInt) to the bot's cash made; returns the new total. */
function addCash(bot, amount) {
  const overall = overallOf(bot);
  const total = cashOf(bot) + BigInt(Math.max(0, Math.floor(Number(amount) || 0)));
  overall.cash = total.toString();
  save(DROP_FILE);
  return total;
}

/** Coins said as players say them: 950k, 1.2m, 3.4b, 1t, 2.5qt (BigInt or number, any size). */
function formatCash(amount) {
  const value = BigInt(amount);
  const units = [["qn", 10n ** 18n], ["qt", 10n ** 15n], ["t", 10n ** 12n], ["b", 10n ** 9n], ["m", 10n ** 6n], ["k", 10n ** 3n]];
  for (const [unit, size] of units) {
    if (value < size) continue;
    const tenths = (value * 10n) / size;
    const whole = tenths / 10n;
    const rest = tenths % 10n;
    return `${whole}${rest > 0n && whole < 100n ? `.${rest}` : ""}${unit}`;
  }
  return value.toString();
}

/** Everything a bot remembers, every boss: { section: entry } (and "overall"). */
function everywhere(bot) {
  return load(DROP_FILE)[bot] ?? {};
}

/** Its last rare at any boss and where: { rare, rareAt } (or nothing yet). */
function lastRare(bot) {
  if (!load(DROP_FILE)[bot]) return {};
  const { rare, rareAt } = overallOf(bot);
  return { rare, rareAt };
}

/** One boss's chat memory. */
function chatMemory(boss) {
  const memory = () => {
    const all = load(CHAT_FILE);
    const kept = (all[boss] = all[boss] ?? { kills: 0, used: {} });
    if (typeof kept.kills !== "number" || typeof kept.used !== "object") all[boss] = { kills: 0, used: {} };
    return all[boss];
  };
  return {
    /** A kill's done: chats had CHAT_REPEAT_KILLS kills ago are free again. */
    kill() {
      const kept = memory();
      kept.kills++;
      for (const used of Object.values(kept.used)) {
        for (const [chat, kill] of Object.entries(used)) if (kept.kills - kill >= CHAT_REPEAT_KILLS) delete used[chat];
      }
      save(CHAT_FILE);
    },
    /** A pick from `list` not had in the last CHAT_REPEAT_KILLS kills here (under `key`), or null. */
    fresh(list, key) {
      const kept = memory();
      const used = (kept.used[key] = kept.used[key] ?? {});
      const id = (entry) => (Array.isArray(entry) ? entry.join("|") : entry);
      const unused = (list ?? []).filter((entry) => !(id(entry) in used));
      if (!unused.length) return null;
      const pick = unused[Math.floor(Math.random() * unused.length)];
      used[id(pick)] = kept.kills;
      save(CHAT_FILE);
      return pick;
    },
    /** Once only: a boss's old chat memory ({ kills, used }) taken over where there's none yet. */
    importOnce(file) {
      const all = load(CHAT_FILE);
      if (all[boss]) return;
      try {
        const old = JSON.parse(fs.readFileSync(file, "utf8"));
        if (old && typeof old.kills === "number" && typeof old.used === "object") {
          all[boss] = old;
          save(CHAT_FILE);
        }
      } catch {
        // nothing to take over
      }
    },
  };
}

/** A bot's death at `boss` to `cause` (what killed it, as the boss's talk names it). */
function recordDeath(bot, boss, cause) {
  const deaths = load(DEATH_FILE);
  const list = (deaths[bot] = deaths[bot] ?? []);
  list.push({ boss, cause, at: Date.now() });
  if (list.length > DEATH_MEMORY) list.splice(0, list.length - DEATH_MEMORY);
  save(DEATH_FILE);
}

/**
 * A human's death with this bot there (`human`: their name), kept under the bot:
 * { "humans:<bot>": { human: [{ boss, cause, at }] } } in the same file.
 */
function recordHumanDeath(bot, human, boss, cause) {
  const deaths = load(DEATH_FILE);
  const seen = (deaths[`humans:${bot}`] = deaths[`humans:${bot}`] ?? {});
  const list = (seen[human] = seen[human] ?? []);
  list.push({ boss, cause, at: Date.now() });
  if (list.length > DEATH_MEMORY) list.splice(0, list.length - DEATH_MEMORY);
  save(DEATH_FILE);
}

/** The latest death of `human` this bot saw, at `boss` if given ({ boss, cause, at }), or null. */
function lastHumanDeath(bot, human, boss = null) {
  const list = (load(DEATH_FILE)[`humans:${bot}`]?.[human] ?? []).filter((death) => !boss || death.boss === boss);
  return list.length ? list[list.length - 1] : null;
}

/** Its latest death at any boss ({ boss, cause, at }), or null. */
function lastDeath(bot) {
  const list = load(DEATH_FILE)[bot];
  return list?.length ? list[list.length - 1] : null;
}

module.exports = { dropBook, chatMemory, everywhere, lastRare, recordDeath, lastDeath, recordHumanDeath, lastHumanDeath, flush, cashOf, addCash, formatCash, DROP_MEMORY };
