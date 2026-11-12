/**
 * Server custom: post-boss chat for every personality (Chatter.BossBots), about the kill just done,
 * what's next and winding down - not about any one boss, so every boss's bots use it.
 */
module.exports = {
  joker: {
    fight: { open: ["did anyone else close their eyes for that whole kill?", "rate my performance, be generous"], reply: ["i was too busy laughing", "five stars, would watch again"] },
    plans: { open: ["what's everyone doing after this?", "one more or are we going to bed?"], reply: ["telling everyone i carried", "one more, for the content"] },
    unwind: { open: ["gg team, i'm exhausted from being funny", "anyone else need a nap after that?"], reply: ["nap? i need a holiday", "my thrall needs a nap too"] },
  },
  scholar: {
    fight: { open: ["that kill was very well executed", "what did we learn from that one?"], reply: ["a textbook kill", "patience wins fights"] },
    plans: { open: ["i might read for a bit after this", "anyone studying anything new?"], reply: ["i'll research the next boss", "a little reading, then sleep"] },
    unwind: { open: ["a fine effort, everyone", "a pleasure fighting beside you"], reply: ["likewise, truly", "an honour"] },
  },
  grump: {
    fight: { open: ["that took too long", "who kept missing?"], reply: ["could've been worse", "not me"] },
    plans: { open: ["i'm going to bed after this", "please tell me we're done"], reply: ["bed sounds good", "one more. then done"] },
    unwind: { open: ["gg i guess", "that'll do"], reply: ["fine", "it'll do"] },
  },
  sweetheart: {
    fight: { open: ["you were all amazing!", "i'm so proud of this team"], reply: ["you were amazing too!", "best team ever"] },
    plans: { open: ["what's everyone doing after? something nice i hope", "remember to rest after this!"], reply: ["a cup of tea and a blanket", "rest and a snack"] },
    unwind: { open: ["thank you all so much", "that was so much fun"], reply: ["thank you!", "so much fun"] },
  },
  sweat: {
    fight: { open: ["kill time was decent, we can shave ten seconds", "our dps was up this kill"], reply: ["tighter swaps next time", "good numbers"] },
    plans: { open: ["next kill, faster", "anyone tracking the session?"], reply: ["already logged", "faster next time"] },
    unwind: { open: ["good session so far", "efficient work, team"], reply: ["efficient", "good stats"] },
  },
  rookie: {
    fight: { open: ["did i do okay?", "that was so intense!"], reply: ["you did great!", "so intense!"] },
    plans: { open: ["can we do another? i'm learning!", "what should i practise next?"], reply: ["yes please!", "i'll watch a guide"] },
    unwind: { open: ["thanks for being patient with me", "that was the best fight ever"], reply: ["thank you!", "i loved it"] },
  },
  veteran: {
    fight: { open: ["steady kill, well done", "you're all getting better"], reply: ["good work", "nice and steady"] },
    plans: { open: ["one more then i'm calling it", "i'll be back tomorrow, same time"], reply: ["sounds right", "see you then"] },
    unwind: { open: ["good team, this", "reminds me of the old days"], reply: ["the good old days", "proper team"] },
  },
  chill: {
    fight: { open: ["that was nice and easy", "smooth kill"], reply: ["smooth", "easy"] },
    plans: { open: ["might chill for a bit after", "no rush on the next one"], reply: ["chill sounds good", "no rush"] },
    unwind: { open: ["good vibes, team", "gg, nice and relaxed"], reply: ["vibes", "gg"] },
  },
  hype: {
    fight: { open: ["THAT KILL WAS INSANE", "WE ARE SO GOOD"], reply: ["INSANE!!!", "BEST TEAM EVER"] },
    plans: { open: ["AGAIN AGAIN AGAIN", "WHO'S READY FOR THE NEXT ONE"], reply: ["ME!!!", "ALWAYS READY"] },
    unwind: { open: ["GG GG GG", "WHAT A TEAM"], reply: ["GG!!!", "LOVE YOU ALL"] },
  },
  ironman: {
    fight: { open: ["used fewer supplies that kill", "good kill, saved my brews"], reply: ["supply-efficient", "that helps the iron grind"] },
    plans: { open: ["i need to do a herb run after", "might restock my supplies"], reply: ["farming run time", "restock and back"] },
    unwind: { open: ["gg, every kill counts on iron", "honest work, team"], reply: ["earned", "iron btw"] },
  },
  flipper: {
    fight: { open: ["that kill was profitable", "supplies used versus loot, we're up"], reply: ["in the green", "profit"] },
    plans: { open: ["i'm checking my ge offers after", "time to sell some loot"], reply: ["sell high", "check the margins"] },
    unwind: { open: ["good business, team", "gg, nice returns"], reply: ["good returns", "profit gg"] },
  },
  pker: {
    fight: { open: ["{boss} got sat", "ez kill"], reply: ["sat", "ez"] },
    plans: { open: ["wildy after this?", "who's coming pking?"], reply: ["maybe later", "skull up"] },
    unwind: { open: ["gf", "gg, ez"], reply: ["gf", "ez"] },
  },
  skiller: {
    fight: { open: ["that went nicely", "a good steady kill"], reply: ["lovely", "nice and steady"] },
    plans: { open: ["i'm going fishing after this", "might do a farming run next"], reply: ["fishing sounds lovely", "herbs need picking"] },
    unwind: { open: ["thank you, that was nice", "good fun, everyone"], reply: ["lovely team", "good fun"] },
  },
  roleplayer: {
    fight: { open: ["the beast is slain!", "a battle worthy of song"], reply: ["huzzah!", "a glorious victory"] },
    plans: { open: ["to the tavern, companions?", "another quest awaits"], reply: ["to the tavern!", "onwards"] },
    unwind: { open: ["well fought, all of ye", "honour to this company"], reply: ["honour to thee", "well fought"] },
  },
  dad: {
    fight: { open: ["proud of you all", "great teamwork, champs"], reply: ["thanks dad", "good job everyone"] },
    plans: { open: ["one more then bedtime", "i've got to mow the lawn after"], reply: ["bedtime soon", "classic dad"] },
    unwind: { open: ["good game, kids", "that was fun, team"], reply: ["gg dad", "so fun"] },
  },
};
