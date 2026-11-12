# Boss bots (server custom)

Bot teammates that fight bosses with the player. Not OSRS. Nex was first (`server/plugins/bosses/nex/Bots.Nex.js`);
every later boss uses the same bots, personalities and memory from `server/plugins/bosses/bossbots/`.

## What is shared (`bossbots/`)

| File | What it holds |
| --- | --- |
| `Roster.BossBots.js` | The 100 bots and their personalities (15, six or seven bots each). A name is one personality for life, at every boss. |
| `Memory.BossBots.js` | The drop book (`data/saves/boss-bot-drops.json`) and chat memory (`boss-bot-chats.json`). |
| `Chatter.BossBots.js` | Pre-boss and post-boss life chat, the same at every boss, worded for the boss they're at. |
| `Bosses.BossBots.js` | Every boss the bots go to, by memory key (`nex`, `tob`, `cox`, `toa`): its name and dream drop, for `{boss}` / `{unique}` in shared lines and naming where a bot died. |
| `Kit.BossBots.js` | Picking a free bot (`freeName`: never one already in another fight) and saying a line as a player does (`speak`). |
| `Crowd.BossBots.js` | Group lines worded for who's there: "you all" one-to-one with one other, "you two" with two. |
| `TopicsA/B/C.BossBots.js` | Pre-boss topics per personality: ice-breakers, hobbies, travel, deep questions, food, films, bucket lists, dreams, life experiences, curiosities. |
| `Post/PostB.BossBots.js` | Post-boss topics per personality: how the kill went, what's next, winding down. |
| `Deaths.BossBots.js` | Death talk per personality: a line as it dies, its excuse before the next kill (owning it), teammates' replies, lines on its human's death, and deaths remembered from earlier trips. |

The drop book keeps each bot's last 100 kills per boss section (a boss key, or a key and a team size:
`nex`, `nex [duo]`). Dry and lucky are judged over every boss together (the bot's `overall` section), so a bot
that got a rare at one boss is not dry at the next. `Memory.lastRare(bot)` gives its latest rare and where.

Deaths (`boss-bot-deaths.json`): each bot's last 20 deaths at every boss (`Memory.recordDeath`, `lastDeath`), and
every death of its human it was there for (`recordHumanDeath`, `lastHumanDeath(bot, human, boss)`), so it can bring
them up the next time. A boss records what killed someone (Nex: `Fight.noteHit`'s last hit) and talks about it first
thing before the next kill (Nex: `Team.deathTalk`).

Chat memory: each boss's own chats don't repeat within 20 kills of that boss; the life chat (section `all`)
doesn't repeat within 20 kills of any boss.

Shared lines never name one boss: `{boss}` is the boss they're at, `{BOSS}` the same shouted, `{unique}` /
`{UNIQUE}` its dream drop (`Bosses.BossBots`). A line that only fits one boss starts with its tag
(`"[nex] who stood in the smoke again?"`) and only comes up there. `tests/boss-bots.test.cjs` plays a bot
through Nex and the Theatre of Blood and checks all of this.

What each boss keeps for itself: its gear and supplies (Nex: `KITS`), its fight code and tactics for every
mechanic (and for a raid, every room's boss), and its own talk table for its specials.

## Adding bots to a new boss

1. Add the boss to `Bosses.BossBots` (key, name, dream drop). Make the boss's bot file (`Bots.<Boss>.js`),
   following `Bots.Nex.js`: `Kit.init(api)` in its attach, a bot from `Kit.freeName("<Boss> Helper")`, every
   line said with `Kit.speak`. Personalities from `Roster.BossBots` (`BOT_PERSONAS`); never a list of its own.
   Its own gear sets for the boss.
2. Start the boss's loot memory: `const DROPS = Memory.dropBook("<boss key>")`, and a rare test of its own
   (its uniques, like Nex's `RARE_DROP`). On each kill: `DROPS.record(bot, items, rare, variant)`. Use
   `DROPS.dryFor(bot)` / `DROPS.luckyFor(bot)` for moaning and bragging.
3. Its own chat memory: `const CHATS = Memory.chatMemory("<boss key>")`; `CHATS.fresh(list, key)` picks a line
   not had lately, `CHATS.kill()` after each kill, with `Chatter.kill()` too.
4. Pre-boss mode, before the kill: `Chatter.conversation("pre", starter.persona, others.map((bot) => bot.persona), "<boss key>")`
   and queue the lines (`who` -1 is the starter, else the index in `others`). Post-boss mode, after the loot talk:
   the same with `"post"`.
5. Deaths: name what killed someone the boss's way, call `Memory.recordDeath` (and `recordHumanDeath` for each bot
   there when its human dies), and talk about it first in the next pre-boss chat with `Deaths.BossBots` lines.
6. The boss's own talk table (like `Talk.Nex.js` and `Voices.Nex.js`): one entry for every personality in
   `Roster.BossBots.PERSONAS` - lines, solo, open, reply, follow, loot, dry, lucky, rareSelf, rareSeen, plus its
   heal, hit, prison and banter reactions where the boss has them. Check every personality has every list.
7. A new personality: add it to `PERSONAS` and give it bots in `BOT_PERSONAS`, then a talk entry at every boss and
   in `TopicsA/B`, `Post` and `Deaths`.

## Rules every boss team follows (kofi, 2026-11-02)

- **Fully charged on spawn.** Every item a bot makes (worn or carried) goes through `Kit.charge(name, item)`
  (bossbots/Kit): scythes, Tumeken's shadow, Sanguinesti, tridents, serpentine helms, toxic staff,
  obligator, blood fury, blowpipe (darts and scales). A new charged item goes in `FULL_CHARGES`.
- **One bot, one place.** `Kit.freeName(helper, preferred)` never hands out a name already logged in
  anywhere; `preferred` is a boss's own bot (King of TOB), used only when free.
- **Drops talked about once.** The drop book is shared by every boss. A rare is bragged about once and a
  dry streak moaned about once - the boss calls `DROPS.told(bot, "lucky" | "dry")` right after the line -
  then it's forgotten (the rare's name dropped, the dry count started afresh).
