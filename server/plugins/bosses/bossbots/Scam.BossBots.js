"use strict";

/**
 * Server custom: the scammer bots (kofi). Four bots with the "scammer" personality: shady, always asking if
 * it's free for all, and openly hinting they won't split a rare. Everywhere else they talk in the pker's voice
 * (VOICE_OF in Roster.BossBots), so every table without scammer lines still has an answer for them.
 *
 * - SCAM_TALK: a scammer brings up splitting (open), each teammate answers in its own voice (respond, every
 *   personality - so the reply always fits who said it), and the scammer gets the last word (back).
 * - A scammer with a rare goes to the Grand Exchange like any seller, but when the owner opens the trade he
 *   cancels it (SCAMMED), says so and teleports out with it; the rest are angry for about 30 seconds (ANGRY,
 *   each in its own voice), then teleport off themselves. A normal seller's trade is never touched.
 */

/** What a scammer brings up, in a chat or out of nowhere. {owner} is the team's player. */
const OPEN = [
  "this is ffa right?",
  "wait, loot's ffa here yeah?",
  "if i get a rare i'm keeping it btw",
  "splits are optional right? asking for a friend",
  "ffa or split? just so i know",
  "honestly if i get the purple, finders keepers",
  "imagine splitting a rare lol",
  "{owner} you trust me with the ge trade right?",
  "i always pay out. eventually",
  "if i get the drop i'll split it. probably",
];

/** The scammer's last word after the others have answered. */
const BACK = [
  "relax, i'm joking. mostly",
  "lol chill, i always split. trust",
  "ok ok, split. 100%. promise",
  "you guys are so serious",
  "fine, i'll split. maybe",
  "jk... unless?",
  "trust me bro",
  "when have i ever scammed anyone. dont answer that",
];

/** Every personality's answer to a scammer's split talk, in its own voice. */
const RESPOND = {
  joker: ["the only thing you'll split is the bill, and you'll dodge that too", "ffa? free for absolutely nobody", "you split rares like i split jokes. never",
    "if you get the purple i'm putting a tracker on you"],
  scholar: ["the team agreed to split before we entered", "history is not kind to those who break a split", "splits have always been the custom in group bossing",
    "i'd prefer we honour the agreement"],
  grump: ["it's a split. stop asking", "split it or don't come back", "no. split", "every time with you", "we split. end of"],
  sweetheart: ["we always split, it's only fair!", "aww, you'd never scam us, right?", "sharing is caring! we split it", "i trust you'll do the right thing!"],
  sweat: ["split, it's in the team rules", "5 way split, that's the deal", "the maths only works if we split", "it's split. we discussed this"],
  rookie: ["wait, is it not a split?", "i thought we always split?", "is that allowed?", "oh no, are we not splitting?"],
  veteran: ["seen your type since 2007. we split", "back in my day scammers got reported. split it", "we split, kid. always have", "don't make me tell the story of the last scammer"],
  chill: ["it's a split man, easy", "no stress, we just split it", "split, vibes stay good", "chill, just split it"],
  hype: ["SPLIT IT", "WE SPLIT, NO SCAMS", "NO FFA, SPLIT", "SPLITTING IS HYPE"],
  ironman: ["can't trade anyway, but you're splitting with them", "i'm iron and even i know you split", "split it, scammer", "the only team rule that matters: split"],
  flipper: ["you split the gp, i'll check the price", "i know what it sells for. split it", "i'll be watching the ge prices", "split, and i'll know the margin"],
  pker: ["sit, scammer", "try it and i'll find you in the wildy", "split it or get skulled", "it's a split. scam and you get smited"],
  skiller: ["we split, that's the nice thing to do", "a split keeps the team happy", "let's just split it, please", "it's a split, friend"],
  roleplayer: ["thou shalt split, knave", "honour demands a fair split", "the code of the raid is a split, rogue", "split it, or face my blade"],
  dad: ["young man, we share", "i'll ground you if you don't split", "sharing, champ. it's the rule", "dad says split"],
  scammer: ["yeah he's right, ffa", "lol same", "trust us"],
  // King of TOB (his personality key).
  king: ["in my theatre we split. royal law", "scam the crown and you're banished", "the king's court splits. always", "try it and you'll never raid here again"],
};

/** The scammer as he cancels the trade (kofi: "haha scammed"), and as he goes. */
const SCAMMED = ["haha scammed", "haha scammed, thanks for the {item}", "lol scammed", "haha scammed, should've read the ffa"];
const SCAM_BYE = ["cya suckers", "ffa means ffa", "thanks for the free {item}", "gf"];

/** The others after a scam, each in its own voice: about 30 seconds of it, then they leave. */
const ANGRY = {
  joker: ["well that's one way to end a friendship", "scammed by someone called that. classic", "i'd make a joke but i'm actually mad", "report button go brr"],
  scholar: ["a disgraceful breach of trust", "that will be remembered", "an appalling act", "i shall be reporting that"],
  grump: ["knew it. every time", "unbelievable", "reported", "never raiding with him again"],
  sweetheart: ["i can't believe he'd do that :(", "that's so mean!", "we trusted him!", "i'm so sorry {owner}"],
  sweat: ["that's 0 gp an hour for all of us", "wasted the whole raid", "reported for scamming", "never again"],
  rookie: ["wait, he just took it?", "is that allowed??", "he scammed us?!", "what do we do now?"],
  veteran: ["seen it a hundred times. still annoying", "back in my day we'd hunt him down", "classic scam. report him", "lesson learned, kid"],
  chill: ["damn, that's not chill", "wow. bad vibes", "not cool man", "ugh, that sucks"],
  hype: ["HE SCAMMED US", "WHAT A SCAMMER", "REPORTED", "UNREAL"],
  ironman: ["glad i'm iron honestly", "and that's why i don't trade", "scammers everywhere", "can't be scammed if you can't trade"],
  flipper: ["that was 5 people's money", "i know exactly what that was worth. painful", "worst trade ever", "blacklisted"],
  pker: ["i'll find him in the wildy", "he's getting skulled on sight", "rat", "sit, scammer"],
  skiller: ["that was horrible", "i'm going back to skilling", "people can be so mean", "what a shame"],
  roleplayer: ["a knave and a thief!", "may the gods curse that rogue", "honour lies dead this day", "i shall hunt him"],
  dad: ["that's not how i raised you", "very disappointed", "i'm calling his dad", "that's just wrong"],
  scammer: ["lol he got you", "should've known", "classic"],
  king: ["banished from my theatre forever", "the crown never forgets a scammer", "treason, in my own court", "he will never raid here again"],
};

/** How long the others are angry before leaving (ticks, about 30 seconds), and between their lines. */
const ANGRY_TICKS = 50;
const ANGRY_GAP = [4, 8];

/** How often a chat with a scammer in it is his split talk instead (kofi: he mentions it all the time). */
const TALK_CHANCE = 0.35;

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * A scammer's split talk with his team (bots: { persona, scammer }): his opener, one or two answers each in
 * its own voice (a fellow scammer on his side), and his last word. [{ bot, text }], {owner} filled in.
 */
function talk(scammer, others, owner) {
  const fill = (text) => text.replace(/\{owner\}/g, owner);
  const lines = [{ bot: scammer, text: fill(pick(OPEN)) }];
  const answering = [...others].sort(() => Math.random() - 0.5).slice(0, others.length > 1 && Math.random() < 0.5 ? 2 : 1);
  // Never the same words twice in one chat (two of one personality answering).
  const said = new Set();
  for (const bot of answering) {
    const voice = (bot.scammer ? RESPOND.scammer : RESPOND[bot.persona] ?? RESPOND.chill).filter((line) => !said.has(line));
    const text = pick(voice.length ? voice : RESPOND.chill);
    said.add(text);
    lines.push({ bot, text: fill(text) });
  }
  lines.push({ bot: scammer, text: fill(pick(BACK)) });
  return lines;
}

module.exports = { OPEN, BACK, RESPOND, SCAMMED, SCAM_BYE, ANGRY, ANGRY_TICKS, ANGRY_GAP, TALK_CHANCE, talk };
