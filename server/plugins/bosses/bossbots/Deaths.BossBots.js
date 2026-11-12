/**
 * Server custom: what the boss bots say about deaths, by personality, the same at every boss
 * ({cause}: what killed them, said the boss's way - "containment", "her melee").
 *
 * - dying: as it goes down.
 * - excuse: before the next kill, why it died (its own, never blaming a teammate).
 * - reply: a teammate answering an excuse.
 * - mate: a teammate on another bot's death ({name}).
 * - human: on their human's death ({owner}).
 * - past: now and then, a death it remembers from another session ({cause}, {boss}).
 * - humanPast: now and then, its human's death it saw last time at this boss ({owner}, {cause}, {boss}).
 */
const DEATHS = {
  joker: {
    humanPast: ["{owner}, last time we did {boss} you tested {cause}. results were fatal", "remember {cause} at {boss}, {owner}? i do", "{owner}, no dying to {cause} this time, i'm out of jokes"],
    dying: ["i meant to do that", "tell my thrall i loved him", "plot twist", "well, that's my exit"],
    excuse: ["i died to {cause} on purpose, it's called content", "that {cause} was lag, i swear", "i was testing if {cause} still works. it does", "my death was a tactical nap", "{cause} got me but my jokes survived", "i tripped over my own cape"],
    reply: ["sure it was", "classic", "the content we needed", "a legend's exit"],
    mate: ["rip {name}, the {cause} won that round", "{name} discovered {cause} the hard way", "{name}'s grave says 'it was lag'", "moment of silence for {name}... ok done"],
    human: ["{owner} tested the {cause}, it works", "{owner} took one for the team. literally", "rip {owner}, i'll keep your seat warm", "{owner} vs {cause}: {cause} wins"],
    past: ["last time at {boss} {cause} got me, not today", "i still have nightmares about {cause} at {boss}", "{boss} owes me a life after that {cause}"],
  },
  scholar: {
    humanPast: ["{owner}, last time at {boss}, {cause} took you, mind it", "i recall {owner} falling to {cause} at {boss}", "{owner}, history suggests caution with {cause}"],
    dying: ["a historic error", "fascinating... ow", "noted for my studies", "i should have read further"],
    excuse: ["{cause} caught me mid-thought, a lesson learned", "i misjudged the {cause}, entirely my error", "the {cause} was faster than the texts suggest", "i was distracted by the architecture, then {cause}", "my death was educational, {cause} is fierce", "a regrettable miscalculation with {cause}"],
    reply: ["an honest assessment", "we learn from history", "a fair account", "noted"],
    mate: ["{name} fell to {cause}, as many have before", "a moment for {name}, the {cause} was cruel", "{name} met {cause}, a well-documented fate", "{name} will return wiser"],
    human: ["{owner}, the {cause} has claimed better, don't worry", "{owner} fell to {cause}, a noble death", "{owner}, history will be kind", "{owner}, a lesson in {cause}"],
    past: ["i fell to {cause} at {boss} once, i've studied it since", "{boss}'s {cause} taught me humility", "i remember {cause} at {boss}, never again"],
  },
  grump: {
    humanPast: ["{owner}, don't die to {cause} again", "last time {owner} died to {cause}. let's not", "{owner}. {cause}. remember"],
    dying: ["typical", "great", "of course", "ugh"],
    excuse: ["{cause}. whatever", "i died to {cause}, it happens", "my fault, {cause}, moving on", "i stood still, {cause} did the rest", "{cause} got me, don't talk about it", "yes i died. {cause}. next"],
    reply: ["fair", "sure", "yeah", "happens"],
    mate: ["{name} died to {cause}. shocking", "{name}, {cause}, again", "well {name}'s gone", "{name} found the {cause}"],
    human: ["{owner} died to {cause}. great", "{owner}, really?", "{owner}, {cause}. lovely", "nice one {owner}"],
    past: ["{cause} at {boss}. still annoyed", "last time {boss} got me with {cause}", "{boss} and its {cause}, ugh"],
  },
  sweetheart: {
    humanPast: ["{owner}, i'll look after you this time, no {cause}!", "last time {cause} got you at {boss}, not today {owner}!", "{owner}, we've got this, no more {cause}"],
    dying: ["oh no!", "sorry everyone!", "i'll be right back!", "oops, sorry!"],
    excuse: ["sorry about dying to {cause} everyone!", "the {cause} got me, i'll do better!", "i didn't see the {cause} coming, sorry!", "that {cause} was scary, i'm okay now!", "i'm back! sorry for leaving you with {cause}", "i'll dodge the {cause} this time, promise!"],
    reply: ["it's okay, we love you!", "you're back, that's what matters!", "don't worry about it!", "happens to everyone!"],
    mate: ["we miss you {name}, the {cause} was mean", "{name} got caught by {cause}, poor thing", "welcome back soon {name}!", "{name}, that {cause} wasn't fair"],
    human: ["{owner} are you okay? that {cause} was nasty", "{owner}, you did amazing anyway!", "{owner}, we're here for you", "{owner}, that {cause} was so unfair"],
    past: ["{cause} got me at {boss} once, i was so sad", "i remember {boss}'s {cause}, i'm braver now", "{boss} scared me with {cause} before"],
  },
  sweat: {
    humanPast: ["{owner}, last {boss} you died to {cause}, step earlier", "{owner}: {cause} killed you last time, pre-move it", "{owner}, last time's {cause} death cost us, focus"],
    dying: ["misclick", "tick loss", "unacceptable", "that's a reset"],
    excuse: ["died to {cause}, my reaction was a tick slow", "{cause} - i was mid-brew, bad timing", "my positioning for {cause} was off, fixing it", "{cause} death, logging it as a mistake", "lost a tick and ate {cause}, never again", "{cause}: i should've pre-moved"],
    reply: ["fix it", "noted", "pre-move next time", "tick it better"],
    mate: ["{name} died to {cause}, that's a supply loss", "{name}'s {cause} death cost us time", "{name}, pre-move the {cause}", "{name} lost the {cause} timing"],
    human: ["{owner}, {cause} - step a tick earlier", "{owner} died to {cause}, kill time's ruined", "{owner}, review your {cause} timing", "{owner}, that's a reset"],
    past: ["i died to {cause} at {boss}, optimised it since", "{boss}'s {cause} cost me a pb once", "{cause} at {boss}: logged and fixed"],
  },
  rookie: {
    humanPast: ["{owner}, you died to {cause} last time, how do we dodge it?", "remember {cause} at {boss}, {owner}? scary", "{owner}, please don't die to {cause} again!"],
    dying: ["what happened?!", "am i dead?!", "nooo", "help!"],
    excuse: ["i didn't know about {cause}!", "what even is {cause}? i died to it", "i panicked during {cause}", "nobody told me about {cause}", "i tried to dodge {cause}, i really did", "the {cause} came out of nowhere"],
    reply: ["you'll get it next time!", "it took me ages to learn that too", "now you know!", "we all died to it once"],
    mate: ["{name} died?! to {cause}?", "woah, {cause} killed {name}", "is {name} okay?", "how do you dodge {cause}?"],
    human: ["{owner} died?! what was that {cause}?", "{owner}, how did {cause} do that?", "{owner}, are you ok?", "the {cause} got {owner} too?!"],
    past: ["i died to {cause} at {boss} too, it's scary", "{boss} got me with {cause} once", "i'm still learning {boss}'s {cause}"],
  },
  veteran: {
    humanPast: ["{owner}, last time {cause} got you at {boss}, watch for it kid", "{owner}, {cause} caught you before, stay sharp", "we've all died to {cause}, {owner}, even you last time"],
    dying: ["getting old", "seen it coming", "rookie move", "back in a bit"],
    excuse: ["{cause} got me, been a while since that happened", "old reflexes, {cause} punished me", "i've dodged {cause} a thousand times, not that one", "{cause}, my fault, should know better", "happens to the best, {cause} today", "{cause} caught an old dog napping"],
    reply: ["happens to the best", "we've all been there", "shake it off", "back in my day we'd say gg"],
    mate: ["{name} learned about {cause}", "rookie mistake, {name}, {cause}", "{name}, you'll learn {cause}", "{name} fell to {cause}, happens"],
    human: ["{owner}, {cause} gets everyone once", "{owner}, you'll get it, kid", "{owner}, watch for {cause} next time", "{owner}, we've all eaten {cause}"],
    past: ["{cause} at {boss} got me back in the day", "{boss}'s {cause}, i remember it well", "i died to {cause} at {boss} once, never forgot"],
  },
  chill: {
    humanPast: ["{owner}, last time {cause} got you, no stress", "{owner}, {cause} again? nah, we're good", "remember {cause} at {boss}, {owner}? all good"],
    dying: ["eh", "oops", "all good", "brb"],
    excuse: ["{cause} got me, no biggie", "died to {cause}, it's chill", "eh, {cause} happens", "i was vibing too hard, {cause}", "{cause}, my bad", "no stress, {cause} won that one"],
    reply: ["no worries", "all good", "chill", "happens"],
    mate: ["rip {name}, {cause} vibes", "{name} got {cause}'d, all good", "{name}'ll be back", "{cause} got {name}, no stress"],
    human: ["{owner}, all good, {cause} happens", "{owner}, no stress", "{owner}, we'll get it", "{owner}, chill, it's fine"],
    past: ["{cause} got me at {boss} once, all good", "{boss}'s {cause}, eh", "i died at {boss} to {cause}, whatever"],
  },
  hype: {
    humanPast: ["{owner} REVENGE ON {cause} TODAY", "{owner} LAST TIME {cause} GOT YOU, NOT THIS TIME", "{owner} {boss} REDEMPTION ARC"],
    dying: ["NOOO", "I'LL BE BACK", "WORTH IT", "TELL THEM I WAS HYPED"],
    excuse: ["{cause} GOT ME BUT I'M BACK AND HYPED", "DIED TO {cause}, COMEBACK ARC STARTS NOW", "{cause} WAS CRAZY BUT WATCH ME NOW", "I ATE {cause} SO YOU DIDN'T HAVE TO", "{cause} WON ONE ROUND, NOT THE WAR", "BACK FROM {cause} STRONGER"],
    reply: ["COMEBACK ARC", "LETS GOOO", "YOU'RE BACK", "HYPE"],
    mate: ["RIP {name} BUT WE GO AGAIN", "{name} VS {cause} REMATCH TIME", "{name} WILL BE BACK", "{cause} GOT {name}, REVENGE"],
    human: ["{owner} WE RIDE AGAIN", "{owner} {cause} DIDN'T STAND A CHANCE NEXT TIME", "{owner} COMEBACK TIME", "{owner} SHAKE IT OFF"],
    past: ["{cause} GOT ME AT {boss} ONCE, NEVER AGAIN", "{boss} AND ITS {cause}, I REMEMBER", "{cause} AT {boss}, REDEMPTION ARC"],
  },
  ironman: {
    humanPast: ["{owner}, last time {cause} cost you, careful", "{owner}, don't feed {cause} your supplies again", "{owner}, {cause} at {boss} got you, iron rules: move"],
    dying: ["my supplies", "iron pain", "not my gear", "ugh, iron life"],
    excuse: ["died to {cause}, there goes a week of supplies", "{cause} got me, iron tax paid", "lost my brews to {cause}, ironman pain", "{cause} killed me, i'll farm more", "hcim nerves, then {cause}", "{cause}: costly on iron"],
    reply: ["iron pain", "earned the hard way", "you'll farm more", "respect the grind"],
    mate: ["{name} died to {cause}, supplies gone", "{name}, {cause}, iron pain", "{name} paid the iron tax", "rip {name}'s supplies"],
    human: ["{owner}, {cause} - at least you're not iron", "{owner}, eat up next time", "{owner}, {cause} costs", "{owner}, iron tip: move"],
    past: ["{cause} at {boss} cost me a whole bank once", "{boss}'s {cause} - iron pain", "i died to {cause} at {boss}, never forgot the cost"],
  },
  flipper: {
    humanPast: ["{owner}, last time {cause} cost you a trip", "{owner}, no {cause} deaths, bad roi", "{owner}, {cause} at {boss} was a loss, let's profit"],
    dying: ["there goes my profit", "bad trade", "loss", "market crash"],
    excuse: ["{cause} - a costly trade on my part", "died to {cause}, the ledger's in the red", "my {cause} death cost about 500k", "{cause} cost me, i'll make it back", "bad investment, standing in {cause}", "{cause}: worst roi today"],
    reply: ["sunk cost", "you'll make it back", "write it off", "bad trade"],
    mate: ["{name}'s {cause} death cost us", "{name}, {cause}, negative margin", "{name} took a loss there", "rip {name}'s profit"],
    human: ["{owner}, {cause} - costly", "{owner}, that's a loss", "{owner}, you'll make it back", "{owner}, bad trade"],
    past: ["{cause} at {boss} cost me millions once", "{boss}'s {cause}, worst investment", "{cause} at {boss}, a loss i remember"],
  },
  pker: {
    humanPast: ["{owner}, {cause} sat you last time", "{owner}, don't get sat by {cause} again", "{owner}, remember {cause}? lol"],
    dying: ["lag", "sit me", "lucky", "gf"],
    excuse: ["{cause} was lucky", "lag spike, then {cause}", "i'd have dodged {cause} in the wildy", "{cause}, whatever, gf", "got sat by {cause}, rematch", "{cause} got me, i'll get them back"],
    reply: ["sit", "lol", "gf", "excuses"],
    mate: ["{name} got sat by {cause}", "{name}, {cause}, lol", "rip {name}, gf", "{name} ate {cause}"],
    human: ["{owner} got sat by {cause}", "{owner}, lol, {cause}", "{owner}, gf", "{owner}, learn to dodge {cause}"],
    past: ["{cause} at {boss} sat me once", "{boss} got lucky with {cause}", "{cause} at {boss}, lag i swear"],
  },
  skiller: {
    humanPast: ["{owner}, last time {cause} got you, take it slow", "{owner}, oh dear, remember {cause} at {boss}?", "{owner}, careful of {cause} this time"],
    dying: ["oh dear", "oh no", "should've gone fishing", "deep breath"],
    excuse: ["{cause} got me, i should stick to skilling", "oh dear, {cause}, i wasn't watching", "{cause} was too quick for me", "i was daydreaming about fishing, then {cause}", "died to {cause}, a lesson learned", "{cause}, my fault, oh dear"],
    reply: ["oh dear", "you'll be ok", "take it slow", "lovely to have you back"],
    mate: ["oh dear, {name} died to {cause}", "{name}, {cause} got you", "poor {name}", "{name}, take it slow"],
    human: ["oh dear {owner}, {cause}", "{owner}, are you alright?", "{owner}, deep breath", "{owner}, take it slow"],
    past: ["{cause} at {boss} got me once, oh dear", "{boss}'s {cause}, i remember", "i should've been skilling, not at {boss}"],
  },
  roleplayer: {
    humanPast: ["{owner}, last we met here, {cause} felled thee", "my liege {owner}, beware the {cause} once more", "{owner}, we avenge thy fall to {cause} today"],
    dying: ["i fall!", "avenge me!", "my quest ends...", "farewell, companions!"],
    excuse: ["the foul {cause} struck me down, but i return", "{cause} bested me, my honour demands a rematch", "i fell to {cause}, a warrior's death", "the {cause} was dark sorcery", "i was smitten by {cause}, forgive me", "{cause} claimed me, but no more"],
    reply: ["thou art forgiven", "rise, companion", "a valiant fall", "huzzah, thou returnest"],
    mate: ["{name} fell to {cause}, honour to them", "{name}, thy fall shall be avenged", "the {cause} claimed {name}", "{name} fought bravely"],
    human: ["my liege {owner} has fallen to {cause}!", "{owner}, rise again", "{owner}, we shall avenge thee", "{owner}, a noble fall"],
    past: ["{cause} at {boss} once claimed me", "the {cause} of {boss} haunts me", "i fell at {boss} to {cause}, long ago"],
  },
  dad: {
    humanPast: ["{owner}, last time {cause} got you, watch out champ", "{owner}, dad remembers {cause} at {boss}", "{owner}, no dying to {cause} this time, kiddo"],
    dying: ["dad's down", "ow, my back", "tell the kids", "i'm ok, i'm ok"],
    excuse: ["{cause} got me, dad's not as quick as he was", "i was checking on the kids, then {cause}", "{cause}, ow, dad's fine", "my back gave out, then {cause}", "i died to {cause}, don't tell the kids", "{cause} got dad, lesson learned"],
    reply: ["you're fine, champ", "dad's back", "chin up", "happens to dads"],
    mate: ["{name} got caught by {cause}, poor kid", "{name}, {cause}, walk it off", "{name}'ll be back, champ", "{cause} got {name}"],
    human: ["{owner}, {cause} got you, kiddo", "{owner}, walk it off", "{owner}, proud of you anyway", "{owner}, chin up champ"],
    past: ["{cause} at {boss} got dad once", "{boss}'s {cause}, my back still hurts", "i died to {cause} at {boss}, the kids laughed"],
  },
};

// More of each kind (DeathsMore.BossBots), added onto these lists.
for (const [persona, more] of Object.entries(require("./DeathsMore.BossBots"))) {
  for (const [kind, lines] of Object.entries(more)) DEATHS[persona][kind] = [...(DEATHS[persona][kind] ?? []), ...lines];
}

module.exports = DEATHS;
