/**
 * Server custom: a boss bot's line said to a group ("you all make this so fun", "gg everyone") fits
 * three or more others in the fight: with only one other person there, it is said one-to-one
 * instead ("you make this so fun", "gg") - kofi saw "you all" in a two-bot fight - and with two,
 * "you two" ("you two make this so fun"). The same at every
 * boss: each boss's bot code passes its chat through `fit(text, others)` as it says it.
 *
 * Lines that only talk about people in general ("happens to everyone", "a film everyone should see",
 * "i'm telling everyone") stay as they are.
 */

/** One-to-one wordings, in order: each [pattern, replacement], any case (names in the line kept as they are). */
const ONE_TO_ONE = [
  [/\bwhat's everyone's\b/gi, "what's your"],
  [/\bwhat's everyone\b/gi, "what are you"],
  [/\bhow's everyone\b/gi, "how are you"],
  [/\bdoes everyone\b/gi, "do you"],
  [/\bdid everyone tell their parents where they are\b/gi, "did you tell your parents where you are"],
  [/\bdid everyone\b/gi, "did you"],
  [/\bis everyone\b/gi, "are you"],
  [/\bwas everyone\b/gi, "were you"],
  [/^everyone had\b/gi, "you had"],
  [/\beveryone's so\b/gi, "you're so"],
  [/\bhope everyone gets\b/gi, "hope you get"],
  [/\b(made|save|vibes to) everyone\b/gi, "$1 you"],
  [/\byou're all\b/gi, "you're"],
  [/\byou all\b/gi, "you"],
  [/\b(gg|thanks|thank you|sorry|proud of|love) everyone\b/gi, "$1"],
  // Said to the group at the end of a line ("deep breaths, everyone", "good job everyone"), not
  // about people ("i'm telling everyone", "happens to everyone").
  [/(?<!\b(?:tell|telling|to|with|for|from|gets|catches|loves|but))(,)? everyone(?=[!?.,]|$)/gi, ""],
];

/**
 * With two others (two bots and a player, say), "you all" is "you two" (kofi's call): "you two make
 * this so fun", "you two are great". "everyone" still fits three.
 */
const YOU_TWO = [
  [/\byou're all\b/gi, "you two are"],
  [/\b(?:you all|all of you)\b/gi, "you two"],
];

/** A line still said to a group after ONE_TO_ONE: what the check (tests) looks for. */
const GROUP = /\b(you all|you're all|all of you|y'all|you guys|you lot)\b|(?<!\b(?:tell|telling|to|with|for|from|gets|catches|loves|but))(,)? everyone(?=[!?.,]|$)|\b(what's|how's|did|does|is|was) everyone\b|^everyone had\b|\beveryone's so\b/i;

/**
 * `text` as said with `others` other people in the fight: one-to-one when there's just one, "you
 * two" when there are two, as written for three or more.
 */
function fit(text, others) {
  if (typeof text !== "string" || others == null || others > 2) return text;
  const shouting = /[a-z]/i.test(text) && text === text.toUpperCase();
  let out = text;
  for (const [pattern, replacement] of others === 2 ? YOU_TWO : ONE_TO_ONE) out = out.replace(pattern, replacement);
  if (out === text) return text;
  out = out.replace(/\s{2,}/g, " ").replace(/\s+([!?.,])/g, "$1").replace(/^[,\s]+|[,\s]+$/g, "");
  return shouting ? out.toUpperCase() : out;
}

/** Whether `text` (already through fit) still talks to a group. */
function toGroup(text) {
  return GROUP.test(text);
}

module.exports = { fit, toGroup };
