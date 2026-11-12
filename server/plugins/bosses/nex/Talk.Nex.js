/**
 * What the Nex bots say, by personality (Bots.Nex: each bot's name fixes its personality for its whole
 * life). Every line a bot says - its own lines, the chats it starts, its replies to others, its loot,
 * dry and lucky talk - comes from its own personality here, so a bot never sounds like someone else.
 *
 * Per personality:
 * - lines: things it says on its own; solo: to its human ({owner}) when it's the lone bot.
 * - open: conversations it starts, by kind (question, statement, lore, joke); reply: how it answers each
 *   kind (and loot, dry, lucky); follow: what the starter adds after the answers.
 * - loot: after a kill ({last}: its drop); dry: moans ({kc}: kills since a rare, {last}); lucky: brags
 *   ({rare}, {since}: kills since it).
 */
// The 100 bots' names and personalities are the boss bots' shared roster (Roster.BossBots).
const { BOT_PERSONAS } = require("../bossbots/Roster.BossBots");

const TALK = {
  joker: {
    lines: ["why did the reaver cross the road? to heal the other side", "i put the 'rune' in runescape", "my thrall is called skelly mcskellface",
      "knock knock. who's there? nex. nex who? nex-t kill please", "i'm not afk, i'm conserving energy", "brb, buying gf 10k", "the real torva was the friends we made",
      "what's a nihil's favourite snack? smoke rings", "if i die, tell my bank i loved it", "who needs prayer when you have confidence",
      "i tried to sell my thrall on the ge. no takers", "my cape is 90% drip", "i'm the main character, nex is a side quest", "glacies called, she wants her chill back",
      "doing my best impression of a tank: standing still", "fun fact: i am not a fun fact"],
    solo: ["{owner}, you and me, the comedy duo", "{owner} if i die it's a bit, i swear", "{owner} watch me tank with my face", "two's company, nex is a crowd, {owner}",
      "{owner}, rate my dodging out of 10. be kind", "i'll do the jokes, you do the damage {owner}", "{owner}, if we win i'm framing your armour", "just us and a winged lady {owner}. classic friday"],
    open: {
      question: ["what's nex's favourite exercise?", "if nex had a podcast, what would it be called", "who would win, nex or a lumbridge goose", "what's the worst possible pet drop"],
      statement: ["i've decided to become a nihil", "i tried to pet ashuelot", "my thrall asked for a raise", "i bought a bond with my last brew"],
      lore: ["legend says say zaros three times and he appears", "zamorak stabbed zaros. rude", "the four generals sound like a boyband", "the god wars, but make it a sitcom"],
      joke: ["what do you call nex with no wings? walking nex", "how many bots does it take to kill nex? all of them, and a brew", "why don't reavers make good friends? they always take", "nex walks into a bar. gets stalled"],
    },
    reply: {
      question: ["the wing-dash, obviously", "'flying solo'. she'd hate it", "the goose. every time", "a pet rock. wait, i have one"],
      statement: ["absolute legend behaviour", "this is why i'm here", "i'm telling everyone", "peak content"],
      lore: ["lore but make it funny", "zaros left on read", "gods are just players with admin", "and then they all got banned"],
      joke: ["i'm stealing that", "ok that one got me", "ba dum tss", "10/10 would groan again"],
      loot: ["gz! now buy me gf", "is that it? peak rng", "frame it", "gz, i'll take a cut"],
      dry: ["dry like my jokes", "rng saw you coming", "just don't think about it, works for me", "the drop table is a myth"],
      lucky: ["spoon detected", "share the spoon", "lucky? i call it hacks", "save some for the rest of us"],
    },
    follow: ["i'll be here all week", "you're welcome", "thank you, thank you", "tip your bot", "i peaked there", "no further questions"],
    loot: ["{last}! retiring tomorrow", "{last}. the dream", "look at this {last}, isn't it beautiful", "{last} added to my museum", "{last}. tell my mum"],
    dry: ["{kc} kills dry, i'm basically a desert now", "i got {last} again, the comedy writes itself", "{kc} dry. at least my jokes land"],
    lucky: ["{rare} {since} kills ago. call me lucky bones", "remember my {rare}? i do. constantly", "my rng has a sense of humour"],
  },
  scholar: {
    lines: ["fun fact: nex was sealed here at the end of the god wars", "the four generals were bound to nex by zaros himself", "ancient magicks are the zarosian spellbook",
      "zamorak used the staff of armadyl to wound zaros", "the nihils are zarosian creatures guarding the prison", "kharidian desert ruins were once zarosian cities",
      "the frozen door was sealed with the essence of the four generals", "the mahjarrat served zaros before many turned", "the ancient prison lies beneath the god wars dungeon",
      "the godswords were forged from one blade, then split", "the shadow realm and zaros are tied together", "nex was zaros's most loyal general",
      "the god wars lasted thousands of years", "guthix ended the god wars with the edicts", "the wilderness is scarred from the god wars", "ancient cavern lore is underrated"],
    solo: ["{owner}, did you know nex served zaros directly?", "{owner}, the generals are fascinating to study", "a fine day for lore, {owner}", "{owner}, ask me anything about the god wars",
      "{owner}, the stalagmites are glacies's work", "{owner}, ancient magicks came from zaros", "{owner}, this prison is older than lumbridge", "{owner}, try reading the slayer guides, they're riveting"],
    open: {
      question: ["why do you think zamorak betrayed zaros?", "which god would you follow, honestly", "do you think zaros will come back?", "what's your favourite piece of lore"],
      statement: ["i've been reading about the mahjarrat", "the god wars dungeon froze the fighting in place", "nex is older than most gods' current forms", "the nihils were made to guard the frozen door"],
      lore: ["the generals: fumus, umbra, cruor, glacies", "the armadyl staff is why zaros fell", "zaros wasn't destroyed, just weakened", "the edicts of guthix stopped the gods walking gielinor"],
      joke: ["what's a zarosian's favourite drink? ancient brew", "why did zaros cross the desert? to visit his ruins", "how does nex study? with ancient tomes", "the mahjarrat have the longest family reunions"],
    },
    reply: {
      question: ["ambition, i'd argue", "guthix, for balance", "in one timeline, arguably", "the second age, without doubt"],
      statement: ["a well-documented point", "fascinating, isn't it", "the sources agree", "i've read the same"],
      lore: ["an elegant point", "the generals mirror ancient magicks", "and so the war followed", "the edicts shaped everything since"],
      joke: ["historically questionable, but amusing", "i'll allow it", "a scholarly chuckle", "that's... technically accurate"],
      loot: ["a worthy acquisition", "congratulations, well earned", "documented and noted", "a fine addition"],
      dry: ["statistically you're due", "the drop rate is fair over time", "variance is cruel but temporary", "keep a record, it helps"],
      lucky: ["a statistical outlier, congratulations", "remarkable fortune", "the odds favoured you", "an enviable record"],
    },
    follow: ["the more you know", "a lesson for us all", "worth remembering", "lore matters", "i'll write that down", "fascinating stuff"],
    loot: ["{last}, a modest but fair drop", "{last}. i'll catalogue it", "{last}, as the table predicts", "{last}: noted in my records", "a fine {last}"],
    dry: ["{kc} kills without a unique. statistically unremarkable, emotionally devastating", "{last} again. the table is indifferent", "{kc} dry. variance is a cruel teacher"],
    lucky: ["{rare} {since} kills ago, well within expected variance", "my {rare} remains a fond memory", "fortune favours the well-read"],
  },
  grump: {
    lines: ["can we hurry up, i've got a slayer task", "this boss is overrated", "i've been here since 6am", "nobody stalled properly last kill",
      "the respawn timer is too long", "if one more person stands in the smoke...", "my brews taste like regret", "i miss when content was simple",
      "who keeps pulling her off the middle", "the drop table hates me personally", "fine. one more kill. then i'm done", "why is it always cold in here",
      "my back hurts", "these capes are itchy", "the barrier hums too loud", "i didn't sign up for this"],
    solo: ["{owner}, just don't make me carry", "fine {owner}, let's get this over with", "{owner}, try not to die, i'm not walking back", "{owner}, this is your idea, not mine",
      "{owner}, if we wipe, it's your fault", "i suppose you'll do, {owner}", "{owner}, quicker kills please", "{owner}, don't talk to me during ice phase"],
    open: {
      question: ["who stood in the smoke last kill?", "why do we even chat every spawn", "do we have to do another one", "who left the reavers up"],
      statement: ["this respawn timer is criminal", "i miss the old nex", "my back hurts from carrying", "if i don't get a drop i'm logging"],
      lore: ["zamorak betraying zaros is the only sensible thing a god's done", "the generals are just bodyguards with attitude", "nex has been in here for ages and still hasn't learnt manners", "the gods should've stayed asleep"],
      joke: ["want a joke? our dps", "you know what's funny? nothing about this", "a joke: the drop table", "here's a joke: my kc"],
    },
    reply: {
      question: ["don't ask me", "obviously not me", "who cares", "probably you"],
      statement: ["whatever", "great. brilliant", "if you say so", "sure"],
      lore: ["lore doesn't kill nex", "nobody asked", "fascinating. not.", "can we focus"],
      joke: ["hilarious", "not funny", "i'm laughing on the inside", "sigh"],
      loot: ["better than mine", "whatever, gz", "at least someone got something", "great. for you"],
      dry: ["welcome to my life", "join the club", "it never drops", "told you"],
      lucky: ["must be nice", "unbelievable", "lucky", "of course it was you"],
    },
    follow: ["typical", "anyway", "can we go now", "next", "moving on", "yeah, well"],
    loot: ["{last}. great.", "{last} again. fantastic", "{last}. thrilling", "{last}, as usual", "{last}. whatever"],
    dry: ["{kc} kills. nothing. of course", "{last} again. i'm done. (i'm not)", "{kc} dry and nobody cares"],
    lucky: ["got {rare} {since} kills ago. don't make a fuss", "yes i got {rare}. moving on", "fine, my rng's alright lately"],
  },
  sweetheart: {
    lines: ["you're all doing amazing", "drink your brews everyone, stay safe", "i'm so proud of this team", "if anyone needs a break that's fine",
      "gz on every hit, honestly", "you can do it, i believe in you", "no one's dying on my watch", "sending good rng vibes to everyone",
      "remember to have fun", "we're the best team on the server", "thank you for having me", "i made everyone a mental cup of tea",
      "proud of every single one of you", "group hug after this", "you all make this fun", "don't forget to eat after the kill"],
    solo: ["{owner}, you're doing so well", "i've got your back {owner}", "{owner}, take your time, no pressure", "{owner}, you're my favourite teammate",
      "{owner}, drink some water after this", "we've got this {owner}", "{owner}, thank you for bringing me", "{owner}, you're a natural"],
    open: {
      question: ["how's everyone feeling today?", "did everyone eat today?", "what's something nice that happened this week?", "who needs a brew?"],
      statement: ["i just want to say you're all great", "i'm so glad we're a team", "i hope everyone gets a drop today", "you all make this so fun"],
      lore: ["even nex just wanted to be loyal, it's kind of sweet", "zaros probably misses his generals", "the generals are just looking after nex", "the gods could have used a hug"],
      joke: ["what's a reaver's favourite thing? hugs. bloody hugs", "nex is just misunderstood", "even ashuelot smiles sometimes", "i'd give nex a cuddle if she'd let me"],
    },
    reply: {
      question: ["i'm good, thank you for asking!", "aw, that's sweet of you", "honestly, really good today", "you're so kind"],
      statement: ["aw, same!", "that made my day", "you're the best", "love that for you"],
      lore: ["that's actually lovely", "so sweet", "aw, poor nex", "i never thought of it like that"],
      joke: ["haha, that's adorable", "you're so funny", "made me smile", "cute"],
      loot: ["gz!! so happy for you", "aw, well deserved", "yay! gz", "you earned that"],
      dry: ["it'll come, i promise", "sending luck your way", "you've got this", "next one, i can feel it"],
      lucky: ["so happy for you!", "you deserve it", "aw, gz again", "lucky star"],
    },
    follow: ["love you all", "thank you", "you're the best", "aw", "this team <3", "made my day"],
    loot: ["{last}! so lovely", "{last}, i'm grateful", "aw, {last}", "{last}, thank you nex", "{last}! yay"],
    dry: ["{kc} dry, but i'm happy you're all here", "{last} again, that's okay", "{kc} kills, still smiling"],
    lucky: ["still so happy about my {rare}", "{rare} {since} kills ago, i'm blessed", "i've been so lucky lately"],
  },
  sweat: {
    lines: ["dps check: we're 4% behind last kill", "stall timing was off by a tick there", "rigour and zeal, no excuses", "switch faster, every tick counts",
      "my spec rotation is optimised", "bow is best on the mages, i checked", "we lost 3 seconds on fumus", "eat at 50, not 30",
      "i'm hitting my max more than average", "stand on your tile, please", "that reset was textbook", "personal best is in reach if we focus",
      "tick perfect or nothing", "every stall is a free attack", "pre-pot before she spawns", "i log every kill"],
    solo: ["{owner}, stall every swing and we're golden", "{owner}, pb attempt, focus", "{owner}, stand on your tile", "{owner}, pre-move for the specials",
      "{owner}, bow on the mages, trust me", "{owner}, we're 2% ahead of last kill", "{owner}, every tick matters", "{owner}, clean kill, let's go"],
    open: {
      question: ["what was your dps last kill?", "who's tracking our times?", "what's our pb?", "who's on stall duty?"],
      statement: ["stall timing review", "we need to speed up the fumus phase", "new pb attempt this kill", "prayer flicking would save us restores"],
      lore: ["nex's attack speed is 4 ticks, that's why the stall works", "the generals spawn at fixed hp thresholds", "the zaros phase heals her 500", "siphon heals her from every hit"],
      joke: ["what's my favourite food? frames per tick", "my dps chart is my love language", "i dream in tick cycles", "i don't eat, i optimise"],
    },
    reply: {
      question: ["4.2 a tick, i tracked it", "me, obviously", "under four minutes", "me, every tick"],
      statement: ["agreed, tighten up", "numbers don't lie", "let's go", "efficient"],
      lore: ["useful, noted", "that's free damage", "mechanics win kills", "noted, optimising"],
      joke: ["efficient joke", "i laughed in 0.6 seconds", "logged", "that's a tick well spent"],
      loot: ["gz, efficient", "solid gp per hour", "gz, next kill", "that's profit"],
      dry: ["keep killing, it averages out", "drop rate is drop rate", "volume solves it", "more kills, faster"],
      lucky: ["good luck per hour", "efficient rng", "gz, keep the pace", "nice variance"],
    },
    follow: ["next kill, faster", "focus up", "tick perfect", "let's optimise", "pb incoming", "logged"],
    loot: ["{last}, logged", "{last}. gp per hour noted", "{last}, efficient", "{last}. next kill", "{last}: tracking it"],
    dry: ["{kc} dry. volume solves it", "{last} again, averaging out", "{kc} kills logged, no unique"],
    lucky: ["{rare} {since} kills ago, ahead of the curve", "my {rare} improved my gp per hour", "efficient luck lately"],
  },
  rookie: {
    lines: ["wait, what does this special do again?", "i'm so nervous", "is it normal to be this scared?", "first time with this many bots",
      "how do i stall again?", "i think i'm getting the hang of it", "do i pray mage or range here?", "this is so cool",
      "i hope i don't mess up", "everyone's so good", "i watched a guide on the way here", "what's an ice prison?",
      "am i doing this right?", "omg she's huge", "i've never seen a boss like this", "can someone carry me? kidding! (not kidding)"],
    solo: ["{owner}, i'm so nervous", "{owner}, tell me if i mess up", "{owner} you're so good at this", "{owner}, is this how it's done?",
      "{owner}, i'll try my best!", "{owner}, what do i do in the ice phase?", "{owner}, teach me your ways", "{owner}, thanks for bringing a newbie"],
    open: {
      question: ["what's the ice phase like?", "do i stand under her or not?", "how do you get so good?", "what happens if i die?"],
      statement: ["i just got my first fang", "this is my first nex team", "i watched three guides", "i bought torva yesterday, is that good?"],
      lore: ["wait, who's zaros?", "nex is a god? or a general?", "who made the nihils?", "what's the god wars?"],
      joke: ["i tried to stall a cow once", "i thought nex was a pet at first", "i once fought the lumbridge goblins for an hour", "i used to think brews were tea"],
    },
    reply: {
      question: ["i don't know either!", "good question, i was wondering too", "um, maybe?", "i'll watch what you do"],
      statement: ["wow, really?", "that's so cool", "i want that too", "teach me!"],
      lore: ["wait, really?", "i had no idea", "woah", "that's crazy"],
      joke: ["haha i don't get it but haha", "lol", "that's funny", "omg"],
      loot: ["woah gz!", "is that good?", "i want one!", "gz gz!"],
      dry: ["what does dry mean?", "oh no", "i'm sure it'll drop", "that sounds sad"],
      lucky: ["woah lucky!", "how do you get so lucky", "teach me", "gz!!"],
    },
    follow: ["thanks!", "cool cool", "i'm learning so much", "this is great", "noted!", "awesome"],
    loot: ["i got {last}! is that good?", "{last}! my first one", "omg {last}", "{last}, what do i do with it?", "{last}! nice?"],
    dry: ["{kc} kills and no fancy drop, is that normal?", "{last} again, is that bad?", "{kc} dry? what's dry?"],
    lucky: ["i got {rare} {since} kills ago, still can't believe it", "is my {rare} rare?", "i think i'm lucky"],
  },
  veteran: {
    lines: ["back in 2007 we didn't have bots", "i remember when rune was endgame", "kids these days with their twisted bows", "i pked in mithril and liked it",
      "the falador massacre, i was there", "i remember the wilderness before the ditch", "we used to fish at catherby for hours", "i miss the old graphics",
      "party hats were 1k gp when i started", "i walked everywhere, no teleports", "my first 99 was woodcutting", "this is nothing compared to bandos before the update",
      "i've seen bosses come and go", "nex was scary in 2012", "we didn't have guides, we had trial and error", "i've done this kill more times than you've had brews"],
    solo: ["{owner}, back in my day we soloed this uphill", "{owner}, i've done this a thousand times", "{owner}, stick with me, i know the way", "{owner}, this reminds me of 2008",
      "{owner}, you've got potential, kid", "{owner}, old school rules apply", "{owner}, follow my lead", "{owner}, i remember when nex was new"],
    open: {
      question: ["remember the wilderness before the ditch?", "who here remembers rune being endgame?", "what was your first 99?", "anyone else miss the old graphics?"],
      statement: ["back in 2007 we did this with no bots", "i pked in mithril and loved it", "i remember when party hats were cheap", "i walked from lumbridge to varrock every day"],
      lore: ["i remember when nex first came out", "the god wars dungeon used to be terrifying", "we found the ancient prison the hard way", "the generals were a nightmare back then"],
      joke: ["kids think a twisted bow is hard to get", "i had a rune scimitar before it was cool", "we didn't have stalls, we had prayers and hope", "my first boss was a goblin"],
    },
    reply: {
      question: ["of course i do", "fishing, back in the day", "rune was everything", "the old graphics had charm"],
      statement: ["those were the days", "that's the old school way", "respect", "back when it meant something"],
      lore: ["i was there", "times have changed", "we learned it the hard way", "real players remember"],
      joke: ["ha, kids these days", "classic", "good one, rookie", "we had it harder"],
      loot: ["back in my day that was a fortune", "gz, kid", "earned the old way", "nice, real nice"],
      dry: ["i went 500 dry once", "patience, it'll come", "back in 2007 we never got drops", "keep grinding"],
      lucky: ["lucky, like the old days", "gz, you've earned it", "respect", "fortune favours the grinders"],
    },
    follow: ["those were the days", "old school forever", "trust me", "back in my day...", "you'll learn", "respect the grind"],
    loot: ["{last}. in 2007 that'd buy a house", "{last}, the old school way", "{last}. earned", "{last}, like old times", "{last}. respect"],
    dry: ["{kc} kills dry. i've seen worse in 2007", "{last} again, the grind continues", "{kc} dry. patience, i've got plenty"],
    lucky: ["{rare} {since} kills ago, like the old days", "my {rare}, one for the scrapbook", "fortune favours the old guard"],
  },
  chill: {
    lines: ["just vibing", "no stress, we got this", "nex is just a big bird, relax", "taking it easy today",
      "whatever happens, happens", "good vibes only", "chill kill, no pressure", "i'm just here for the company",
      "it's all good", "deep breaths, everyone", "no rush", "life's good",
      "brews and vibes", "nex can wait", "easy does it", "sun's out (probably)"],
    solo: ["{owner}, no stress, we got this", "chill kill, {owner}", "{owner}, just vibes today", "{owner}, take it easy",
      "{owner}, no rush, we're good", "{owner}, enjoying the company", "{owner}, whatever happens is fine", "relax {owner}, it's just nex"],
    open: {
      question: ["anyone else just vibing?", "what's everyone listening to?", "what are you doing after this?", "good day so far?"],
      statement: ["no rush today", "i'm just here for the vibes", "honestly, life's good", "taking it slow this kill"],
      lore: ["even the gods needed a nap, guthix got it", "zaros is probably just chilling somewhere", "the generals should take a holiday", "nex needs a spa day"],
      joke: ["nex walks into a bar, orders a chill", "what's a reaver's favourite music? blood beats", "i'm so relaxed i'm basically ice phase", "my stress level is zero"],
    },
    reply: {
      question: ["yeah, vibing", "lofi beats", "probably nap", "chill day"],
      statement: ["nice, relax", "all good", "same energy", "love that"],
      lore: ["that's a vibe", "chill take", "fair enough", "nice"],
      joke: ["haha, chill", "nice one", "good vibes", "ha"],
      loot: ["gz, nice", "solid", "chill drop", "nice one"],
      dry: ["it'll come, no rush", "relax, it happens", "all good, next one", "chill, it drops eventually"],
      lucky: ["nice, enjoy it", "good vibes", "gz, chill", "lucky you"],
    },
    follow: ["all good", "vibes", "no stress", "chill", "nice", "easy"],
    loot: ["{last}, nice", "{last}, good vibes", "{last}. chill", "{last}, solid", "{last}, all good"],
    dry: ["{kc} kills, no stress", "{last} again, whatever", "{kc} dry, it'll come"],
    lucky: ["{rare} {since} kills ago, good times", "still vibing off my {rare}", "life's been lucky lately"],
  },
};

/** The new personalities' big-heal, hit, prison and banter lines (the first five are in Bots.Nex). */
const MORE_HEAL_LINES = {
  rookie: { reavers: ["wait, did she just heal {amount}?", "is that bad? she healed {amount}", "the red things healed her!", "oh no, +{amount} for her"],
    siphon: ["were we not meant to hit her?", "she healed {amount}, was that me?", "oops, the siphon thing", "she drank {amount}, sorry if that was me"],
    replies: ["i'm still learning", "oh, okay!", "noted for next time", "i'll do better"] },
  veteran: { reavers: ["back in my day, we killed the reavers", "+{amount}, rookie mistake", "seen it a hundred times, {amount} back", "should've cleared them first"],
    siphon: ["never hit her in the siphon, kids", "{amount} siphoned, old mistake", "the siphon catches everyone once", "we learned this in 2012"],
    replies: ["you'll learn", "it happens to the best", "old lesson", "next time"] },
  chill: { reavers: ["she healed {amount}, it's fine", "eh, +{amount}, whatever", "no stress, she healed a bit", "it's all good, {amount} back"],
    siphon: ["siphon heal, no worries", "{amount} back, chill", "eh, it happens", "relax, we'll get it back"],
    replies: ["all good", "no stress", "chill", "we got this"] },
};
const MORE_HIT_LINES = {
  rookie: { self: ["ow! what was that?", "i didn't see that coming", "is that normal?", "what hit me?", "ouch, sorry", "am i dying?", "that hurt!", "i'm okay, i think",
      "oh no, my hp", "learning moment"],
    seen: ["{name}, are you okay?!", "woah {name}", "was that the {special}?", "how do you dodge that?", "{name} got hit, oh no", "what's {special}?",
      "should i heal {name}?", "{name}, that looked bad", "eek", "is {name} okay?"] },
  veteran: { self: ["haven't been hit by {special} since 2012", "getting old", "my reflexes aren't what they were", "that's a rookie error on me", "eh, scratch",
      "i've taken worse", "back in my day that'd kill you", "{special}, old friend", "slipped up", "still standing"],
    seen: ["rookie mistake, {name}", "{name}, watch her tells", "classic {special}, {name}", "we've all been there {name}", "{name}, step off next time",
      "{name}, you'll learn", "seen that a thousand times", "move earlier, {name}", "{name}, old lesson", "careful, {name}"] },
  chill: { self: ["ow, all good", "eh, it happens", "no stress", "just a scratch", "whatever", "still vibing", "i'm fine", "that's alright", "chill, i'll eat", "all good"],
    seen: ["you good {name}?", "eh, happens {name}", "no stress {name}", "relax {name}, eat up", "all good {name}", "chill {name}", "it's fine {name}",
      "shake it off {name}", "easy {name}", "we got you {name}"] },
};
const MORE_PRISON_LINES = {
  rookie: { trapped: ["help! i'm stuck!", "what do i do?!", "i'm frozen!", "why can't i move?", "ice! ice!", "ouch, that hurt"],
    rescuer: ["sorry {name}, i didn't know how!", "i tried, sorry!", "how do you break it?", "i was too slow, sorry {name}", "oops", "next time i'll be faster"] },
  veteran: { trapped: ["frozen. classic", "should've moved", "old mistake", "seen it before", "ice prison, old friend", "eh, my fault"],
    rescuer: ["sorry {name}, getting slow", "used to be faster", "my bad {name}", "too old for this", "should've been there", "sorry, kid"] },
  chill: { trapped: ["eh, frozen", "it's fine", "chill. literally", "all good", "no stress", "whatever"],
    rescuer: ["sorry {name}, my bad", "no stress, next time", "oops, sorry", "all good?", "my bad, chill", "next one {name}"] },
};
const MORE_BANTER = {
  rookie: { reply: ["you'll get it next time!", "that looked scary", "i'd have died", "is that how it works?"], comeback: ["thanks!", "learning!", "i'll try", "oops"] },
  veteran: { reply: ["happens to the best", "seen worse", "you'll learn", "old lesson"], comeback: ["i know, i know", "back in my day", "still got it", "eh"] },
  chill: { reply: ["all good", "no stress", "it happens", "chill"], comeback: ["yeah", "all good", "vibes", "eh"] },
};

/**
 * More of each personality: extra lines and conversations before a kill, extra loot lines after one,
 * what it says when it lands a rare itself (rareSelf, {item}) and when a teammate does (rareSeen,
 * {name}, {item}), and extra heal and hit reactions.
 */
const EXTRA_TALK = {
  joker: {
    lines: ["i've named the reavers. that one's kevin", "my pet is a rock. he's very supportive", "i'm here for the snacks", "if nex had a twitter she'd post 'zaros'", "brews are just spicy tea", "i'm 30% bot, 70% vibes"],
    open: { question: ["if you could rename nex, what would you call her?", "what's the funniest way to die here?"], statement: ["i once tried to trade nex a cabbage", "my bank pin is 'nex'"], lore: ["zaros probably has a group chat with the generals", "the nihils are just bats with attitude"], joke: ["why is nex bad at cards? she keeps getting stalled", "what's glacies's favourite song? let it go"] },
    loot: ["{last}! i'll name it after you", "{last}, peak comedy", "{last}. i'm putting it in my will"],
    rareSelf: ["NO WAY. {item}! i'm retiring", "{item}!!! somebody pinch me", "{item}?! the drop table loves me", "I GOT {item}. this is not a drill", "{item}! drinks on me (brews)"],
    rareSeen: ["gz {name}! can i hold it?", "{name} just won the lottery", "gz {name}, now you have to carry", "{name} with the {item}, legend", "gz! {name}, spoon me"],
  },
  scholar: {
    lines: ["the zarosian empire once spanned most of gielinor", "nex's wings are a sign of her zarosian origin", "the mahjarrat feed on souls, grim but true", "the frozen door is older than the dungeon itself", "the edicts still bind the gods today", "senntisten was the zarosian capital"],
    open: { question: ["who do you think forged the godswords?", "what's the oldest thing in this prison?"], statement: ["i've been studying the zarosian empire", "senntisten fascinates me"], lore: ["the ancient magicks were once forbidden", "nex was imprisoned rather than slain, interesting choice"], joke: ["why did the mahjarrat visit the library? soul-searching", "the zarosians had the best architecture, and worst neighbours"] },
    loot: ["{last}, a sensible drop", "{last}: the drop table, as written", "{last}, one for the ledger"],
    rareSelf: ["{item}! a historic moment", "remarkable, {item}", "{item}, against the odds", "i've acquired {item}. truly fortunate", "{item}! i'll document this"],
    rareSeen: ["congratulations {name}, a fine {item}", "{name}, a historic drop", "well earned, {name}", "{item}! remarkable, {name}", "{name}, that's one for the records"],
  },
  grump: {
    lines: ["the ice phase is the worst phase", "who designed these generals", "i'm only here for the gp", "can we skip the chatting", "my thrall is lazier than me", "the dungeon smells"],
    open: { question: ["why is fumus always first?", "can we just skip the shadow phase?"], statement: ["i'm not doing blood phase again", "i hate the walk to the altar"], lore: ["zaros got stabbed and honestly i get it", "the gods are all overrated"], joke: ["you know what's funny? this respawn timer", "joke: the ice phase is fun"] },
    loot: ["{last}. lovely. not.", "{last}, as expected", "{last}. riveting"],
    rareSelf: ["oh. {item}. finally", "{item}. about time", "{item}. don't make a big deal", "fine, {item}. i'm happy. ish", "{item}. took long enough"],
    rareSeen: ["gz {name}. lucky", "{name} gets {item}, of course", "gz. i'm not jealous", "{name}, enjoy it. i won't", "lucky {name}"],
  },
  sweetheart: {
    lines: ["i believe in every one of you", "remember, it's just a game", "you're all so talented", "let's have the best kill ever", "drink water between kills", "i'm smiling so much"],
    open: { question: ["what's everyone's favourite thing about this team?", "does anyone need anything?"], statement: ["i'm so lucky to have you all", "today's going to be a good day"], lore: ["i bet nex has a soft side", "even the nihils deserve love"], joke: ["nex is just a big angry pigeon, bless her", "i'd adopt a reaver"] },
    loot: ["{last}, yay!", "{last}, i'm happy", "aw, {last} again"],
    rareSelf: ["oh my gosh, {item}!", "{item}!! i'm going to cry", "{item}, thank you nex!", "i can't believe it, {item}!", "{item}! i'm so happy"],
    rareSeen: ["gz {name}!! so proud of you", "{name}, you deserve it!", "aw gz {name}!", "{item}!! yay {name}", "so happy for you {name}"],
  },
  sweat: {
    lines: ["average kill time down 12%", "thrall dps is underrated", "pray swaps cost ticks, plan them", "we're ahead of pace", "zero wasted ticks this kill", "brew efficiency is a skill"],
    open: { question: ["anyone tracking brews per kill?", "who's got the fastest stall streak?"], statement: ["i optimised the spawn positions", "our reset was 2 ticks slow"], lore: ["nex's melee only hits a side tile, use it", "her specials come every sixth attack"], joke: ["i calculated the fun, it's 4.2 per tick", "my hobby is spreadsheets"] },
    loot: ["{last}, gp tracked", "{last}. adding to the total", "{last}, logged"],
    rareSelf: ["{item}. huge gp per hour boost", "{item}! logging it", "{item}, efficient", "{item}. pb and a unique", "{item}! numbers going up"],
    rareSeen: ["gz {name}, efficient", "{name} with the {item}, nice gp", "gz, {name}. next kill", "{name}, great rng per hour", "gz {name}, log it"],
  },
  rookie: {
    lines: ["i think i'm getting better", "is everyone this good?", "i practised dodging all morning", "i bought the best gear i could", "my friend said nex is easy", "i've watched so many videos"],
    open: { question: ["what's the best drop from nex?", "how long did it take you to get good?"], statement: ["i finally got rigour", "i'm saving for torva"], lore: ["is zaros a good guy or bad guy?", "why are the generals different colours?"], joke: ["i thought the ancient prison was a jail for old people", "i used to think nex was a dragon"] },
    loot: ["{last}! is this rare?", "{last}! cool!", "{last}, what's it worth?"],
    rareSelf: ["WAIT. {item}?! is this good?!", "{item}!! my first big drop!", "omg {item}, i'm shaking", "{item}! i'm telling everyone", "is {item} rare? i think it is!"],
    rareSeen: ["woah gz {name}!", "{name} got {item}?! so cool", "gz {name}! is it good?", "{name}, teach me your luck", "omg gz {name}"],
  },
  veteran: {
    lines: ["i remember nex dropping torva like candy... not", "the old ancient prison was harder", "real ones remember barrows gloves grinds", "we used to camp drops in the wildy", "i've seen more nex kills than you've had dinners", "trust the veterans"],
    open: { question: ["anyone remember the old duel arena?", "who here did the original god wars?"], statement: ["i used to solo kq in rune", "i was here before the grand exchange"], lore: ["nex was the hardest boss when she came out", "the god wars dungeon used to be wildy-level dangerous"], joke: ["we didn't have bots, we had friends who logged off", "back in my day, the bots were the players"] },
    loot: ["{last}. back in my day...", "{last}, earned the old way", "{last}. classic"],
    rareSelf: ["{item}. been chasing this since 2012", "{item}! the old grind pays off", "{item}. i'll tell the grandkids", "finally, {item}", "{item}. respect the grind"],
    rareSeen: ["gz {name}, well earned", "{name} with the {item}, respect", "gz kid", "{name}, don't spend it all at once", "back in my day, that took years. gz {name}"],
  },
  chill: {
    lines: ["no stress, we're good", "nex is just doing her thing", "vibes are immaculate", "taking it one phase at a time", "chillest team on the server", "i could nap after this"],
    open: { question: ["anyone else feeling relaxed?", "what's the plan for after, nap?"], statement: ["this team has good vibes", "i'm not stressing the drops"], lore: ["zaros is probably on holiday", "the generals need a day off"], joke: ["nex needs to chill", "i'm so chill i'm practically glacies"] },
    loot: ["{last}, cool", "{last}, nice and easy", "{last}. vibes"],
    rareSelf: ["oh nice, {item}", "{item}! good vibes", "{item}, sweet", "chill, {item}!", "{item}. life's good"],
    rareSeen: ["nice one {name}", "gz {name}, good vibes", "{name} with the {item}, nice", "gz {name}, enjoy", "chill gz {name}"],
  },
};

/** Extra heal and hit reactions for the first five personalities. */
const EXTRA_HEAL = {
  joker: { reavers: ["the reavers are her personal chefs", "+{amount}? nex's on a buffet"], siphon: ["we just gave her a smoothie, {amount} worth"], replies: ["at least she's healthy"] },
  scholar: { reavers: ["blood returns to its source, {amount}"], siphon: ["the siphon converts damage, {amount} restored"], replies: ["a well-known mechanic"] },
  grump: { reavers: ["{amount}. unbelievable."], siphon: ["stop. feeding. her."], replies: ["of course"] },
  sweetheart: { reavers: ["it's fine, we'll get it back, promise"], siphon: ["no worries, the siphon's sneaky"], replies: ["we're still doing great"] },
  sweat: { reavers: ["+{amount}, that's a pb gone"], siphon: ["siphon leak, {amount}"], replies: ["fix it next phase"] },
};
const EXTRA_HIT = {
  joker: { self: ["that's going on my highlight reel", "free hug from nex"], seen: ["{name}, that's a face plant", "{name} said yes to {special}"] },
  scholar: { self: ["{special}, misjudged again"], seen: ["{name}, observe the animation"] },
  grump: { self: ["seriously?"], seen: ["{name}, honestly"] },
  sweetheart: { self: ["i'm okay, really!"], seen: ["{name}, you're okay!"] },
  sweat: { self: ["that's a tick lost"], seen: ["{name}, positioning"] },
};

for (const [persona, extra] of Object.entries(EXTRA_TALK)) {
  const talk = TALK[persona];
  talk.lines.push(...extra.lines);
  for (const kind of Object.keys(extra.open)) talk.open[kind].push(...extra.open[kind]);
  talk.loot.push(...extra.loot);
  talk.rareSelf = extra.rareSelf;
  talk.rareSeen = extra.rareSeen;
}

// The newer personalities (Voices.Nex) in full, and more for the first eight, added onto their lists.
const Voices = require("./Voices.Nex");
/** Every list in `extra` added onto the same list in `into` (made where it's missing). */
function addOnto(into, extra) {
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) into[key] = [...(into[key] ?? []), ...value];
    else addOnto((into[key] = into[key] ?? {}), value);
  }
}
Object.assign(TALK, Voices.NEW_TALK);
addOnto(TALK, Voices.MORE_TALK);
Object.assign(MORE_HEAL_LINES, Voices.NEW_HEAL_LINES);
Object.assign(MORE_HIT_LINES, Voices.NEW_HIT_LINES);
Object.assign(MORE_PRISON_LINES, Voices.NEW_PRISON_LINES);
Object.assign(MORE_BANTER, Voices.NEW_BANTER);
addOnto(EXTRA_HEAL, Voices.MORE_HEAL);
addOnto(EXTRA_HIT, Voices.MORE_HIT);
const EXTRA_PRISON = Voices.MORE_PRISON;
const EXTRA_BANTER = Voices.MORE_BANTER_LINES;
/** Each personality's line when a special caught more than one of them (itself among them). */
const SHARED_HIT_LINES = Voices.SHARED_HIT_LINES;

/**
 * Lines filed under the wrong kind, moved to the right one: real questions out of lore and
 * statements (a lore reply like "correct, and elegantly so" answered "who are the four generals?"),
 * and jokes that carry their own punchline out of questions.
 */
const MOVES = [
  ["rookie", "lore", "question", ["wait, who's zaros?", "nex is a god? or a general?", "who made the nihils?", "what's the god wars?", "is zaros a good guy or bad guy?", "why are the generals different colours?", "why is nex locked up?", "who are the four generals?"]],
  ["rookie", "statement", "question", ["i bought torva yesterday, is that good?"]],
  // Rookie's lore was all questions: two things it learned, so it still has lore to share.
  ["rookie", "none", "lore", ["i read that nex was zaros's most loyal general!", "the wiki says the generals match the ancient spells!"]],
  ["joker", "question", "joke", ["what's glacies's favourite breakfast? ice cereal"]],
  ["dad", "question", "joke", ["what do you call nex with a cold? sneex"]],
];
for (const [persona, from, to, moved] of MOVES) {
  const open = TALK[persona].open;
  if (open[from]) open[from] = open[from].filter((line) => !moved.includes(line));
  open[to] = [...open[to], ...moved.filter((line) => !open[to].includes(line))];
}

/**
 * Each question's own answer, by its exact words: the one who asks gives it once a teammate has
 * handed the question back (Bots.Nex). Teammates never answer with their own answer lists, which
 * were written for their own questions ("what's nex's favourite exercise?" got "guthix, for balance").
 */
const OWN_ANSWERS = {
  joker: {
    "what's nex's favourite exercise?": "the wing-dash, obviously", "if nex had a podcast, what would it be called": "'flying solo'. she'd hate it",
    "who would win, nex or a lumbridge goose": "the goose. every time", "what's the worst possible pet drop": "a pet rock. wait, i have one",
    "if you could rename nex, what would you call her?": "nexy mcwingface, final answer", "what's the funniest way to die here?": "tripping into a reaver, for the memes",
    "would you rather fight 100 nihils or one nex-sized nihil?": "one big nihil. more content",
  },
  scholar: {
    "why do you think zamorak betrayed zaros?": "ambition, i'd argue", "which god would you follow, honestly": "guthix, for balance",
    "do you think zaros will come back?": "in one timeline, arguably", "what's your favourite piece of lore": "the second age, without doubt",
    "who do you think forged the godswords?": "the sources disagree, which i love", "what's the oldest thing in this prison?": "the frozen door, i'd wager",
    "do you think zaros will return?": "his followers certainly believe so", "which general was nex's favourite?": "fumus, perhaps, for her loyalty",
  },
  grump: {
    "who stood in the smoke last kill?": "not me. probably", "why do we even chat every spawn": "beats the music",
    "do we have to do another one": "yes. sadly", "who left the reavers up": "not my job",
    "why is fumus always first?": "no idea. don't care", "can we just skip the shadow phase?": "i wish",
    "why do we even bother with the minions?": "because nex hides behind them", "who keeps stepping on the shadows?": "everyone but me",
  },
  sweetheart: {
    "how's everyone feeling today?": "i'm good, thanks for asking!", "did everyone eat today?": "i had a lovely sandwich!",
    "what's something nice that happened this week?": "a stranger gave me a free brew!", "who needs a brew?": "i've got plenty to share!",
    "what's everyone's favourite thing about this team?": "everyone's so kind here", "does anyone need anything?": "i'm all set, thank you!",
    "how's everyone feeling?": "happy, you're all lovely", "who needs a hug after this?": "me! i'll need one",
  },
  sweat: {
    "what was your dps last kill?": "4.2 a tick, i tracked it", "who's tracking our times?": "me, obviously",
    "what's our pb?": "under four minutes", "who's on stall duty?": "me, every tick",
    "anyone tracking brews per kill?": "about six, could be four", "who's got the fastest stall streak?": "me, fourteen in a row",
    "what's everyone's pb?": "mine's 3:48", "are we stalling every attack?": "we should be",
  },
  rookie: {
    "what's the ice phase like?": "i heard it's really cold, haha", "do i stand under her or not?": "the guide said only to stall!",
    "how do you get so good?": "practice, i guess?", "what happens if i die?": "i think i just respawn?",
    "what's the best drop from nex?": "torva, i think?", "how long did it take you to get good?": "hopefully not long!",
    "how do you know when she'll attack?": "i count to four!", "what's the hardest phase?": "shadow, i think?",
    "i bought torva yesterday, is that good?": "the wiki says it's best in slot!", "wait, who's zaros?": "oh, the empty lord! i looked it up",
    "nex is a god? or a general?": "a general! zaros's", "who made the nihils?": "zaros, i think? to guard the door",
    "what's the god wars?": "a big war between the gods, right?", "is zaros a good guy or bad guy?": "depends who you ask, apparently",
    "why are the generals different colours?": "one for each ancient spell, i read!", "why is nex locked up?": "zaros's enemies sealed her, i think",
    "who are the four generals?": "fumus, umbra, cruor and glacies!",
  },
  veteran: {
    "remember the wilderness before the ditch?": "of course i do", "who here remembers rune being endgame?": "me. rune was everything",
    "what was your first 99?": "fishing, back in the day", "anyone else miss the old graphics?": "the old ones had charm",
    "anyone remember the old duel arena?": "i do, good times", "who here did the original god wars?": "me, of course",
    "anyone remember the old gwd?": "i do. it was brutal", "who here did nex on release?": "i did. took hours",
  },
  chill: {
    "anyone else just vibing?": "yeah, vibing", "what's everyone listening to?": "lofi beats",
    "what are you doing after this?": "probably nap", "good day so far?": "chill day",
    "anyone else feeling relaxed?": "always", "what's the plan for after, nap?": "nap, obviously",
    "anyone else chilling?": "always am", "what's the plan after?": "snacks and a nap",
  },
  hype: {
    "WHO'S GETTING THE TORVA TODAY?": "ME! IT'S ME!", "WHAT'S EVERYONE'S DREAM DROP?": "TORVA! FULL SET!",
    "HOW FAST CAN WE GO?": "SUB TWO MINUTES!", "WHO'S READY TO GO OFF?": "ME! I'M SO READY", "RATE YOUR HYPE 1 TO 10?": "ELEVEN OUT OF TEN",
  },
  ironman: {
    "anyone else iron here?": "iron btw, so me", "what took you longest to get on your account?": "the herb grind, easily",
    "how many supplies does everyone bring?": "too many, i made them myself", "what would you do without the ge?": "suffer, like i do",
  },
  flipper: {
    "what's the best margin item you know?": "ancient hilt, easy", "anyone tracking the torva price?": "watching it every hour",
    "how much gp per hour are we doing?": "about 4m an hour, decent", "what's your best flip ever?": "dragon claws, back in the day",
  },
  pker: {
    "anyone pk here?": "me, obviously", "who wants to hit the wildy after?": "the wildy, always",
    "how many of you have been smited?": "only scrubs get smited", "best spec weapon for pking?": "ags or claws",
  },
  skiller: {
    "what's everyone's favourite skill?": "fishing, obviously", "anyone got 99 runecrafting?": "not yet, it hurts",
    "what's the most relaxing skill?": "fishing or farming", "who's going for max cape?": "slowly, very slowly",
  },
  roleplayer: {
    "what glory do ye seek this day?": "glory, and loot", "who among ye shall claim the torva?": "mine own sword shall",
    "dost thou fear the winged general?": "nay, never", "what tale shall bards tell of us?": "a ballad of victory",
  },
  dad: {
    "anyone want a dad joke?": "nex walks into a bar. gets stalled", "who's eaten today?": "had a sandwich, champ",
    "did everyone tell their parents where they are?": "they know, i left a note",
  },
};

module.exports = { BOT_PERSONAS, TALK, MORE_HEAL_LINES, MORE_HIT_LINES, MORE_PRISON_LINES, MORE_BANTER, EXTRA_HEAL, EXTRA_HIT, EXTRA_PRISON, EXTRA_BANTER, SHARED_HIT_LINES, OWN_ANSWERS };
