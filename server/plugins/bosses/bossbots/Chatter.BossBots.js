/**
 * Server custom: the boss bots' life chat, the same at every boss (docs/boss-bots.md).
 *
 * - Pre-boss mode: before a kill, a bot asks something on a topic (TopicsA/TopicsB: ice-breakers,
 *   hobbies, travel, deep questions, food, films, bucket lists, dreams, life experiences, curiosities);
 *   half the time a teammate hands it back (PONDER), the asker gives its own answer (its `reply` lines answer its own
 *   `open` lines, in order), and a teammate reacts to that (REACT) - every line in its speaker's voice,
 *   and each one fits whoever it follows.
 * - Post-boss mode: after a kill, a bot says something on how it went, what's next or winding down
 *   (Post), and one or two teammates answer it (AFTER), each in its own voice.
 *
 * No conversation comes up again within 20 kills of any boss (Memory.BossBots, section "all"), so the
 * bots don't repeat themselves as they move from boss to boss. A boss's bot code calls
 * `conversation(mode, starter, others)` with personalities and queues the lines it gets back.
 */
const Memory = require("./Memory.BossBots");
const Bosses = require("./Bosses.BossBots");
/**
 * Every personality's topics from each file, merged (TopicsC and PostB add 20 more of each). A topic
 * in two files (both have "unwind") keeps both sets of lines, each question still in line with its answer.
 */
function merged(...tables) {
  const out = {};
  for (const table of tables) {
    for (const [persona, topics] of Object.entries(table)) {
      const mine = (out[persona] = out[persona] ?? {});
      for (const [topic, value] of Object.entries(topics)) {
        if (Array.isArray(value)) mine[topic] = [...(mine[topic] ?? []), ...value];
        else if (mine[topic]) mine[topic] = { open: [...mine[topic].open, ...value.open], reply: [...mine[topic].reply, ...value.reply] };
        else mine[topic] = { open: [...value.open], reply: [...value.reply] };
      }
    }
  }
  return out;
}
const PRE = merged(require("./TopicsA.BossBots"), require("./TopicsB.BossBots"), require("./TopicsC.BossBots"));
const POST = merged(require("./Post.BossBots"), require("./PostB.BossBots"));

const SHARED = Memory.chatMemory("all");

/**
 * A teammate handing the question back, by personality: every line asks the asker for their answer,
 * so the answer that follows reads as a reply to it, never as talking to itself. Said in many ways,
 * so "you first" isn't in every chat (kofi's call).
 */
const PONDER = {
  joker: ["tough crowd, what's yours?", "plot twist: and you?", "i need time for a punchline, go on", "i'll steal your answer, let's hear it", "depends. what's yours?", "trick question? what's yours", "hold that thought, you answer", "ooh. you tell me", "my answer's classified. yours?"],
  scholar: ["an interesting question. what's your view?", "i must consider that. and you?", "a fine question, what's yours?", "fascinating. do share yours", "let me think. you go on", "i'd like your answer first", "hmm. what do you reckon?", "a question worth pondering. thoughts?"],
  grump: ["why me?", "you asked, you answer", "dunno. you?", "go on then", "pass. yours?", "hm. what's yours", "ask someone else. fine, yours?", "you first."],
  sweetheart: ["ooh, i want to hear yours!", "what a lovely question, what's yours?", "aww, tell me yours!", "ooh, you go!", "i'd love to hear yours first!", "hmm, what about you?", "that's so sweet, and you?", "tell me tell me!"],
  sweat: ["good question, yours?", "optimising my answer, go on", "data needed, what's yours?", "hm, and you?", "need a sample size. yours?", "let me calculate. you go", "good one. your answer first?", "interesting. thoughts?"],
  rookie: ["ooh, i don't know! what about you?", "what's yours?", "hmm, tell me yours!", "uhh, you go?", "i'm still thinking, what about you?", "ooh good one, you?", "i never thought about it! you?", "you first, please!"],
  veteran: ["good question, what's yours?", "i've got too many stories, go on", "tell me yours, kid", "seen it all, but what about you?", "go on, i'm listening", "heh. and you?", "you go, kid", "let's hear yours"],
  chill: ["nice one, what's yours?", "hm, and you?", "oh, good q. you?", "dunno, you?", "go on", "ooh. yours?", "hmm. what about you", "you go first"],
  hype: ["OOH WHAT'S YOURS", "GO ON THEN", "TELL ME TELL ME", "SPILL", "OH GOOD ONE, YOU?", "WHAT ABOUT YOU", "YOU GO", "HYPED FOR THIS, GO"],
  ironman: ["good question, yours?", "hm, what's yours?", "go on", "and you?", "tough one, you?", "had to earn that answer. yours?", "dunno yet, you?", "you go first"],
  flipper: ["what's yours? i'll price it", "good question, yours?", "go on, i'll match it", "invest in an answer, go", "hm, and you?", "yours first, i'll undercut it", "tell me yours", "what's the going rate? you?"],
  pker: ["idk, you?", "you go", "go on then, yours?", "nah, you", "whatever, yours?", "pass. you?", "lol. what's yours", "you first"],
  skiller: ["lovely question, what's yours?", "hm, and you?", "ooh, tell me yours", "how nice, go on", "let me think... you?", "what about you?", "that's a lovely one, yours?", "you go first"],
  roleplayer: ["pray tell, what sayest thou?", "a worthy question, speak, friend", "thou askest, thou answerest", "i would hear thy answer", "speak, companion", "what of thee?", "verily, thy thoughts?", "thou first, friend"],
  dad: ["great question, what's yours?", "ooh, go on champ", "tell me yours, kiddo", "you go, champ", "hmm, what about you?", "dad's thinking. you?", "good one, yours?", "you first, kiddo"],
};
/**
 * How often a teammate hands the question back before the asker answers (the asker never answers its
 * own question unprompted - that read as talking to itself, kofi's call). Otherwise a teammate answers it
 * (ANSWER_CHANCE): every question handed back was a wall of "you first" (kofi).
 */
const PONDER_CHANCE = 0.4;
/** A question answered yes or no ("do you...?", "can we...?"): never handed back with a "what's yours?". */
/** A hand-back that also fits a yes/no question ("and you?", "you?"). */
const YES_NO_BACK = /\b(and )?you\??$|what about you|and thee|what of thee|thou\??$/i;
const YES_NO = /^(can|could|do|does|did|are|is|was|were|would|will|have|has|had|should|shall|may|might|am|any(one|body)?|ever)\b/i;
/**
 * A question's answer said by a teammate rather than the asker - only an answer anyone could give:
 * one naming the asker's own life (an ironman's bank, a flipper's margins, a knight's "thee", a dad's
 * kids, a veteran's 2007, a pker's skull) stays the asker's.
 */
const OWN_ANSWER = /\b(iron(man|men)?|hc(im)?|hardcore|btw|self[- ]made|gp|margins?|flip(ped|ping)?|merch(ing)?|thee|thou|thy|thine|verily|forsooth|huzzah|aye|kiddo|champ|sport|dad|daddy|father|the kids|grandkids|my (kids?|son|daughter|wife|husband|lad|boy|girl|thrall|act|bank|missus)|the wife|2007|back in my day|old days|pk(ing|er)?|skull(ed)?|wildy|wilderness|sit\b|lvl|xp|99s?|levels?|king|crown|throne|court|royal|decree|kingdom|majesty|my theatre)\b/i;

/** `text` said in `persona`'s voice: the hype bots shout, a shouted line from anyone else is spoken. */
function voiced(text, persona) {
  if (persona === "hype") return text.toUpperCase();
  return text === text.toUpperCase() && /[A-Z]/.test(text) ? text.toLowerCase() : text;
}

/** A teammate's reaction to the asker's own answer, by personality (8 each, so replies vary). */
const REACT = {
  joker: ["haha, love it", "that's going in my act", "iconic", "fair enough, legend", "ha, stealing that", "that's a bit, honestly", "okay that's good", "10/10, no notes"],
  scholar: ["how fascinating", "a fine answer", "interesting", "i appreciate that", "a thoughtful answer", "i hadn't considered that", "well reasoned", "that tells me a lot"],
  grump: ["fair", "could be worse", "hm. ok", "sure", "hm. fine answer", "not the worst", "could've been worse, yeah", "eh, i'll allow it"],
  sweetheart: ["aww, i love that", "that's so lovely", "that's beautiful", "aww", "that's so you, i love it", "aww that made me smile", "ooh that sounds lovely", "you have the best answers"],
  sweat: ["solid answer", "efficient", "good stuff", "good one", "solid pick", "optimal, honestly", "good choice", "that checks out"],
  rookie: ["woah, cool!", "that's so cool", "i want that too!", "nice!", "wow, really?", "i didn't know that!", "that's awesome", "ooh, good one!"],
  veteran: ["good answer", "wise", "that's the way", "can't argue with that", "spoken like a pro", "that's a good one", "heh, fair", "i'd say the same"],
  chill: ["nice", "vibes", "same honestly", "love that", "oh nice", "yeah, that's fair", "love that for you", "cool cool"],
  hype: ["LOVE IT", "LETS GOOO", "SO GOOD", "HUGE", "YESSS", "THAT'S SO GOOD", "LOVE THAT", "BIG ANSWER"],
  ironman: ["respect", "earned answer", "solid", "nice one", "earned that one", "fair play", "honest answer", "good shout"],
  flipper: ["good value", "solid answer", "i'd invest in that", "nice", "solid return on that", "worth it", "good margin on that answer", "i'd buy that"],
  pker: ["ez", "fair", "based", "not bad, actually", "lol fair", "respect", "ok that's decent", "not bad"],
  skiller: ["lovely", "how nice", "that's lovely", "nice and calm", "that sounds peaceful", "how lovely", "what a nice answer", "that's sweet"],
  roleplayer: ["huzzah", "well spoken", "a noble answer", "verily", "a fine tale", "well answered, friend", "thy words ring true", "most noble"],
  dad: ["proud of you", "that's my kid", "love that", "good answer, champ", "that's a great answer, champ", "love that, kiddo", "proud of that one", "good answer, sport"],
};
/** A teammate's answer to something said after a kill, by personality (8 each). */
const AFTER = {
  joker: ["gg, comedy gold", "same, honestly", "10/10 kill", "we're legends", "gg, nobody tripped", "good show, encore later", "that went better than my jokes", "gg, i'm retiring on top"],
  scholar: ["agreed, well fought", "indeed", "a fine kill", "well said", "a well-run kill", "agreed, it went smoothly", "an efficient fight", "gg, well executed"],
  grump: ["yeah", "fine", "if you say so", "gg i suppose", "sure, gg", "fine, it went ok", "yeah yeah, gg", "could've been worse"],
  sweetheart: ["you're all wonderful", "aww, gg everyone", "yes! so fun", "love this team", "that was so fun!", "yay, we did it!", "gg, so proud!", "that was lovely"],
  sweat: ["agreed, next one faster", "gg, good numbers", "efficient", "gg, logged", "gg, clean kill", "agreed, tidy kill", "gg, on pace", "good kill, next"],
  rookie: ["yes! gg!", "that was awesome", "i agree!", "can't wait for the next", "gg! that was so cool", "we did it!", "that was my favourite one yet", "gg, i'm learning!"],
  veteran: ["gg, well done", "that's the way", "good work, team", "aye", "gg, nice and steady", "good fight", "well fought", "that's how it's done"],
  chill: ["gg", "chill", "same", "vibes", "gg, nice", "yeah, good one", "smooth", "nice one"],
  hype: ["GG!!!", "LETS GOOO", "AGREED", "WE'RE SO BACK", "GG GG GG", "WHAT A KILL", "LETS GO AGAIN", "INSANE"],
  ironman: ["gg, earned", "agreed", "good one", "iron gg", "gg, worth the supplies", "good kill", "agreed, solid", "gg, earned it"],
  flipper: ["gg, profitable", "agreed", "good returns", "nice", "gg, worth the time", "profitable kill", "agreed, good trip", "nice, gp well spent"],
  pker: ["gf", "ez", "yeah", "sit", "gg", "ez kill", "yeah gg", "clean"],
  skiller: ["lovely, gg", "agreed", "nice one", "how nice", "gg, that was nice", "lovely kill", "agreed, nice and calm", "what a nice fight"],
  roleplayer: ["huzzah", "aye, well fought", "verily", "glory to us", "victory is ours", "well fought, friend", "a tale for the tavern", "huzzah, gg"],
  dad: ["gg, champ", "proud of you all", "agreed, kiddo", "good stuff", "gg, proud of you", "great job, champ", "good work, kiddo", "that's my team"],
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);

/**
 * A conversation in `mode` ("pre" or "post") started by personality `starter`, answered by one or two
 * of `others` (personalities, in the order given): [{ who, text }], `who` -1 for the starter or the
 * index in `others`; null when the starter has nothing fresh to say. `boss` is the key of the boss
 * they're at (Bosses.BossBots): its lines are worded for it, and lines tagged for another boss skipped.
 * `noLoot` (the Theatre of Blood till its chest, kofi: its loot only comes once Verzik's dead): no talk of
 * drops or loot - off by default, so every other boss (Nex) talks as before.
 */
function conversation(mode, starter, others = [], boss = null, { noLoot = false } = {}) {
  for (let tries = 0; tries < LOOT_TRIES; tries++) {
    const lines = talk(mode, starter, others, boss, noLoot);
    if (!noLoot || !lines || !lines.some((line) => LOOT_TALK.test(line.text))) return lines;
  }
  return null;
}

/** Drop and loot talk, kept out of a conversation with `noLoot`. */
const LOOT_TALK = /\b(loot|drops?|dropped|purple|rng|chest|unique|pet)\b/i;
const LOOT_TRIES = 6;

function talk(mode, starter, others, boss, noLoot) {
  const table = mode === "post" ? POST : PRE;
  const mine = table[starter];
  if (!mine) return null;
  for (const topic of shuffle(Object.keys(mine).filter((key) => key !== "follow" && !(noLoot && key === "loot")))) {
    // A line tagged for another boss ("[nex] who stood in the smoke again?") isn't said here.
    const here = mine[topic].open.filter((line) => !Bosses.tagOf(line) || Bosses.tagOf(line) === boss);
    const tagged = SHARED.fresh(here, `${mode}:${starter}:${topic}`);
    if (!tagged) continue;
    const opener = Bosses.untagged(tagged);
    const lines = [{ who: -1, text: opener }];
    // Every line worded for the boss they're at ("{boss} got sat").
    const worded = () => lines.map((line) => ({ ...line, text: Bosses.fillBoss(line.text, boss) }));
    if (!others.length) return worded();
    const said = new Set();
    const say = (who, list) => {
      const options = list.filter((line) => !said.has(line));
      const text = pick(options.length ? options : list);
      said.add(text);
      lines.push({ who, text });
    };
    // A statement (not a question): the others answer it in their own voice - their after-kill lines
    // after a kill, their reactions before one. No "what's yours?" to something that wasn't asked.
    // A prompt with no question mark ("road trip snacks, go", "tell us thy bravest moment") still
    // wants an answer, so it's treated as a question.
    const asks = opener.includes("?") || /(,|\.) (but )?(go|go on)$|^tell (us|me)|^quick, /i.test(opener);
    if (!asks) {
      const answering = others.slice(0, others.length > 1 && Math.random() < 0.5 ? 2 : 1);
      answering.forEach((persona, index) => say(index, (mode === "post" ? AFTER : REACT)[persona] ?? (mode === "post" ? AFTER : REACT).chill));
      return worded();
    }
    // A question, before or after a kill: its own answer is the reply in line with it.
    const answer = mine[topic].reply[mine[topic].open.indexOf(tagged)];
    if (!answer) continue;
    // A teammate answers it (in its own voice) and the asker reacts - unless the answer is the asker's
    // own life (OWN_ANSWER); otherwise it's handed back and the asker gives its own answer.
    // An unsure answer ("something about light?") is the asker's own voice too.
    // A yes/no question ("can we skip the chat this time?") is never handed back with "what's yours?" (kofi:
    // nonsense): a teammate answers it, or - the asker's own life - the others react to it.
    // A choice ("garden or the garage?", "would you rather...") isn't one: anyone can name theirs.
    const yesNo = YES_NO.test(opener) && !/\bor\b|^would you rather/i.test(opener);
    if (yesNo && (OWN_ANSWER.test(answer) || /\?\s*$/.test(answer))) {
      // Only the asker can answer it (its own life): a teammate turns it back as a yes/no ("and you?"), then the answer.
      const back = (PONDER[others[0]] ?? PONDER.chill).filter((line) => YES_NO_BACK.test(line) && !/yours|answer|first/i.test(line));
      say(0, back.length ? back : ["and you?"]);
      lines.push({ who: -1, text: answer });
      return worded();
    }
    if ((yesNo || Math.random() >= PONDER_CHANCE) && !OWN_ANSWER.test(answer) && !/\?\s*$/.test(answer)) {
      const answerer = others.length > 1 && Math.random() < 0.5 ? 1 : 0;
      lines.push({ who: answerer, text: voiced(answer, others[answerer]) });
      say(-1, REACT[starter] ?? REACT.chill);
      const other = answerer === 0 ? 1 : 0;
      if (others.length > 1 && Math.random() < 0.3) say(other, REACT[others[other]] ?? REACT.chill);
      // Never the same words twice in one chat (a chill bot said "vibes", "vibes").
      const follow = (PRE[starter]?.follow ?? []).filter((line) => !lines.some((said) => said.text === line));
      if (follow.length && Math.random() < 0.3) lines.push({ who: -1, text: pick(follow) });
      return worded();
    }
    say(0, PONDER[others[0]] ?? PONDER.chill);
    lines.push({ who: -1, text: answer });
    const reactor = others.length > 1 && Math.random() < 0.5 ? 1 : 0;
    say(reactor, REACT[others[reactor]] ?? REACT.chill);
    if (others.length > 1 && Math.random() < 0.35) say(reactor === 0 ? 1 : 0, REACT[others[reactor === 0 ? 1 : 0]] ?? REACT.chill);
    const follow = (PRE[starter]?.follow ?? []).filter((line) => !lines.some((said) => said.text === line));
    if (follow.length && Math.random() < 0.3) lines.push({ who: -1, text: pick(follow) });
    return worded();
  }
  return null;
}

/** A kill's done (any boss): chats had 20 kills ago are free again. */
function kill() {
  SHARED.kill();
}

module.exports = { conversation, kill, PRE, POST, PONDER, REACT, AFTER };
