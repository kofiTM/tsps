/**
 * Server custom: 20 more post-boss conversations for every personality (Chatter.BossBots), added onto
 * Post.BossBots. Per topic, `open` is what it says after a kill and `reply` its own answer to each
 * line, in order. A question gets that answer (after a teammate hands it back); a statement gets the
 * teammates' own after-kill replies (AFTER), so every statement here is one they can agree with.
 */
module.exports = {
  joker: {
    kill: { open: ["that kill deserves a sequel", "who had the best death animation? asking for me", "i'd give that kill a standing ovation", "how many brews did that take you?", "{boss} is filing a complaint after that one"], reply: ["coming soon to cinemas", "me. obviously me", "standing, clapping, crying", "all of them, and i licked the vial", "and they'll lose"] },
    loot: { open: ["what's the worst drop you could get?", "i'm framing that loot screen", "what would you buy with a {unique}?", "rng owes me a drink", "who's splitting their loot with the jester?"], reply: ["a single bone. and the bone's sad", "next to my pet rock", "a hat that says 'i got a {unique}'", "a large one", "no one. tragic"] },
    next: { open: ["same time tomorrow?", "what boss should we bully next?", "who's doing the snack run before the next one?", "one more for the highlight reel", "should we try it blindfolded next?"], reply: ["i'll bring the jokes", "the lumbridge goose, finally", "not me, i'm the entertainment", "the reel is mostly me falling over", "no. i barely see as it is"] },
    unwind: { open: ["that was a good laugh", "i need a lie down after that one", "what's the first thing you do after a kill?", "my thrall wants a raise after that", "honestly that was fun"], reply: ["the funniest ten minutes of my week", "a lie down and a biscuit", "check if i'm still alive", "he's not getting one", "best show in town"] },
  },
  scholar: {
    kill: { open: ["that kill was a fine study in patience", "what was the turning point of that kill?", "our coordination was remarkable", "which phase did you find hardest?", "{boss} was outmatched, as history predicts"], reply: ["patience wins, as ever", "the stalls, i'd argue", "rarely seen outside the textbooks", "the last one, it tests discipline", "history rarely lies"] },
    loot: { open: ["[nex] what's the rarest item on her table?", "i'll catalogue today's loot", "[nex] what's the history behind the torva armour?", "a modest haul, but well earned", "which drop would you study first?"], reply: ["the nihil horn, by the numbers", "every item logged, of course", "forged for zaros's elite, they say", "every kill teaches something", "the {unique}, fascinating"] },
    next: { open: ["shall we refine our approach next kill?", "i'd like to read up on the next boss", "what boss should we study next?", "another kill would make a fine sample size", "how many kills before we're experts?"], reply: ["tighter stalls, and earlier", "a little research never hurts", "{elsewhere}, perhaps", "one more data point, then", "a hundred, by my estimate"] },
    unwind: { open: ["a most rewarding afternoon", "what will you do with the rest of the day?", "i'll write up today's notes", "that was a pleasure, truly", "how do you unwind after a battle?"], reply: ["truly, a fine session", "a good book and an early night", "every detail, while it's fresh", "and an education", "a quiet read by the fire"] },
  },
  grump: {
    kill: { open: ["that took ages", "[nex] who stood in the smoke again?", "could've been faster", "[nex] why does she always teleport to me?", "that's another kill done, i suppose"], reply: ["it always does", "not me. this time", "much faster", "she likes me, apparently", "yeah, next"] },
    loot: { open: ["what did you even get?", "my loot was rubbish", "is anyone actually getting rares?", "another drop for the bank", "why's my rng always worse?"], reply: ["something useless, i bet", "always is", "not me, clearly", "and it'll sit there forever", "because the game hates me"] },
    next: { open: ["do we have to go again?", "one more, then i'm done", "can we skip the chat this time?", "next one's going to be slower, watch", "who's ready? not me"], reply: ["yes. sadly", "probably not done", "please", "i can feel it", "still not me"] },
    unwind: { open: ["finally, a break", "what are you doing after? don't say more bossing", "i'm too tired for this", "that'll do for now", "where's my sofa?"], reply: ["about time", "sleep. that's it", "every time", "for now", "waiting for me"] },
  },
  sweetheart: {
    kill: { open: ["you were all wonderful in that one!", "did everyone stay safe?", "i'm so proud of how we worked together", "who wants a hug after that?", "that was such a team effort!"], reply: ["the best team ever!", "i hope so, i was worried!", "teamwork makes it all better", "everyone gets one!", "together we're unstoppable!"] },
    loot: { open: ["did everyone get something nice?", "i'm so happy for whoever got that drop!", "what's the nicest thing you've ever gotten?", "even the small drops are lovely", "should we celebrate the loot?"], reply: ["i hope so, you all deserve it!", "you deserve it so much!", "a little pet, i cried!", "every drop's a gift!", "yes! with tea and cake!"] },
    next: { open: ["shall we do another one together?", "remember to drink some water before the next!", "who needs more brews before we go again?", "i'll save everyone a spot!", "is everyone feeling okay to go again?"], reply: ["i'd love to!", "hydration is important!", "i can share mine!", "right next to me!", "i'm ready if you are!"] },
    unwind: { open: ["thank you all for being so lovely", "what's everyone doing to relax after?", "that was so much fun with you all", "i'm making tea after this", "you all made my day"], reply: ["you're all the best", "a bath and a good book", "the most fun i've had all week!", "anyone want a cup?", "truly, thank you!"] },
  },
  sweat: {
    kill: { open: ["that was a clean kill", "what was our kill time?", "stalls were on point that time", "how many ticks did we lose?", "dps was up on the last one"], reply: ["almost optimal", "3:52, we can do better", "near perfect", "about 12, all in one phase", "gear check paying off"] },
    loot: { open: ["[nex] what's the drop rate on torva again?", "logged the loot already", "what's our gp per hour?", "loot's fine, but time matters more", "anyone tracking drops per hour?"], reply: ["1 in 258 per piece, roughly", "spreadsheet updated", "about 4.5m, good", "time is the real loot", "me, always"] },
    next: { open: ["next kill, sub four minutes", "who's resetting supplies fastest?", "should we tighten the last phase?", "let's go again straight away", "what can we cut next time?"], reply: ["easily, with clean stalls", "me, 12 seconds", "definitely, that's free time", "no downtime", "two ticks per stall"] },
    unwind: { open: ["efficient session so far", "how long's the session been?", "solid work, team", "numbers are trending up", "what's your break routine?"], reply: ["very efficient", "47 minutes, good pace", "solid numbers", "every kill faster", "two minutes, then back in"] },
  },
  rookie: {
    kill: { open: ["did i do okay that time?", "i survived! i actually survived!", "was that a fast kill?", "i'm getting the hang of this!", "what did i do wrong in that one?"], reply: ["i think i did better!", "my hands are still shaking!", "it felt fast to me!", "slowly but surely!", "probably stood in something, haha"] },
    loot: { open: ["what's a good drop from {boss}?", "i got something! is it good?", "how do you know what's rare?", "i'm so excited about the loot!", "what should i do with my drop?"], reply: ["{unique}, i think?", "the wiki will tell me!", "the screen glows, right?", "every drop feels rare to me!", "keep it forever, maybe!"] },
    next: { open: ["can we go again?", "i want to try stalling next time!", "what should i practise next kill?", "i'm ready for another one!", "will the next one be harder?"], reply: ["please! i'm learning so much!", "i've been watching how you do it!", "prayers, i keep forgetting", "so ready!", "i hope not, haha"] },
    unwind: { open: ["that was the best thing ever!", "what do you do after a big kill?", "i learned so much today!", "thank you for helping me!", "i can't believe i did that!"], reply: ["i want to tell everyone!", "maybe rest? i'm too excited", "my notes are a mess though", "you're all so nice!", "me neither!"] },
  },
  veteran: {
    kill: { open: ["that was a tidy kill", "remember when {boss} took us an hour?", "steady hands won that one", "what did you think of the stalls?", "seen worse, seen better"], reply: ["the way it should be", "i do. different times", "always does", "solid, kid, solid", "that's bossing"] },
    loot: { open: ["what was the first rare you ever got?", "loot comes to those who wait", "the old drop tables were worse", "how long were you dry the first time?", "that's a decent haul"], reply: ["a dragon chainbody, years ago", "and i've waited plenty", "much worse, trust me", "300 kills, felt like forever", "can't complain"] },
    next: { open: ["shall we go again?", "one more, nice and steady", "what would you change next kill?", "plenty more where that came from", "who's got the supplies for another?"], reply: ["why not, i've got time", "no rush", "tighter at the end", "always is", "i packed extra"] },
    unwind: { open: ["good session, everyone", "what's your favourite part of bossing?", "time for a cuppa", "this takes me back", "how long have you been playing?"], reply: ["solid work", "the people, honestly", "the best part", "good memories", "longer than i'd admit"] },
  },
  chill: {
    kill: { open: ["nice and smooth that one", "that was a vibe", "how'd that one feel?", "no stress that time", "easy does it"], reply: ["smooth like butter", "good vibes only", "chill, honestly", "none at all", "nice and easy"] },
    loot: { open: ["got anything cool?", "loot's a bonus anyway", "what would you do with a big drop?", "nice drop, whoever that was", "any loot is good loot"], reply: ["something chill", "just here for the vibes", "buy a hammock", "well deserved", "yep, all good"] },
    next: { open: ["another one whenever", "no rush on the next", "want to go again?", "chill pace next time too", "same again?"], reply: ["whenever's good", "nope, no rush", "sure, why not", "always", "yeah, same again"] },
    unwind: { open: ["time to relax", "what's the plan for after?", "comfy session so far", "that was nice", "think i'll grab a snack"], reply: ["yep, chill time", "nap, probably", "very comfy", "really nice", "good call"] },
  },
  hype: {
    kill: { open: ["THAT WAS INSANE", "DID YOU SEE THAT LAST HIT?!", "WE'RE UNSTOPPABLE", "WHO WAS THE MVP?!", "BEST KILL EVER"], reply: ["ABSOLUTELY INSANE", "I'M STILL SHAKING", "NOTHING CAN STOP US", "ALL OF US! TEAM MVP!", "EVERY TIME"] },
    loot: { open: ["SHOW ME THE LOOT!", "WHO GOT THE BEST DROP?!", "THE RNG IS FEELING GOOD", "WHAT'S THE DREAM DROP?!", "LOOT PILE IS HUGE"], reply: ["LOOT TIME!", "I HOPE IT WAS ME!", "SO GOOD", "{UNIQUE}! ALL OF IT!", "MASSIVE"] },
    next: { open: ["AGAIN! AGAIN!", "WHO'S READY FOR ROUND TWO?!", "NEXT ONE'S GONNA BE FASTER", "LET'S GO RIGHT NOW", "CAN WE BEAT THAT TIME?!"], reply: ["LETS GOOO", "ME! ALWAYS ME!", "SO MUCH FASTER", "NO WAITING", "EASILY!"] },
    unwind: { open: ["I'M SO HYPED STILL", "WHAT A SESSION", "HOW AM I GOING TO SLEEP NOW?!", "BEST DAY EVER", "WE'RE LEGENDS"], reply: ["SAME!!", "INCREDIBLE", "YOU'RE NOT!", "EVERY DAY", "ACTUAL LEGENDS"] },
  },
  ironman: {
    kill: { open: ["that cost me a lot of supplies", "how many restores did you burn?", "worth every brew", "another kill on my own supplies", "iron pain, but worth it"], reply: ["i'll be farming tonight", "six. that's a whole herb run", "every single one", "proudly self-made", "always is"] },
    loot: { open: ["what did you get? i can't trade anyway", "every drop matters on an iron", "how long until i see a rare?", "that drop's going straight in my bank", "loot's better when you earn it yourself"], reply: ["nothing i can sell", "even the bones", "longer than you, probably", "forever", "every time"] },
    next: { open: ["one more, then a supply run", "how many kills can you do on one trip?", "i need more brews before the next", "my herb patches are calling", "let's go again"], reply: ["the grind never stops", "three, if i'm careful", "back to the patches", "loudly", "on my own supplies, of course"] },
    unwind: { open: ["back to the herb runs", "what's your plan for supplies?", "worth the grind today", "i'll be making potions for an hour now", "good session for an iron"], reply: ["the eternal grind", "farm, brew, repeat", "always is", "relaxing, honestly", "can't complain"] },
  },
  flipper: {
    kill: { open: ["that kill paid for itself", "what's our profit per kill?", "time well invested", "good return on brews", "efficient use of supplies"], reply: ["very profitable", "about 900k, nice", "great margins", "excellent roi", "money well spent"] },
    loot: { open: ["what's that drop worth?", "already checking the ge prices", "should i sell or hold?", "solid value in that pile", "best time to sell is now"], reply: ["more than you'd think", "prices are up", "hold, it'll rise", "nice margins", "before the market floods"] },
    next: { open: ["another kill, another profit", "how many kills to buy a {unique}?", "time is money, let's go", "the market's waiting", "one more for the portfolio"], reply: ["the grind pays", "about 200, roughly", "always", "and so are my margins", "diversified"] },
    unwind: { open: ["good profit today", "what are you investing your gp in?", "time to check the market", "solid session financially", "the books look good"], reply: ["very good", "bonds, always bonds", "it never sleeps", "very solid", "balanced, finally"] },
  },
  pker: {
    kill: { open: ["ez", "who was the weak link?", "{boss} got sat", "too easy", "gf {boss}"], reply: ["ez", "not me", "sat hard", "way too easy", "gf"] },
    loot: { open: ["what did you get?", "loot pile is mid", "i'd take that loot to the wildy", "nice loot, now risk it", "rng's on my side"], reply: ["better than yours", "mid", "and lose it, probably", "or you're scared", "always"] },
    next: { open: ["again", "who's coming wildy after?", "next one's faster", "let's go", "one more then pk"], reply: ["obviously", "me, obviously", "obviously", "go", "deal"] },
    unwind: { open: ["gg ez", "what's next?", "decent", "not bad", "time to pk"], reply: ["ez", "the wildy", "decent", "fine", "finally"] },
  },
  skiller: {
    kill: { open: ["oh, that went nicely", "was everyone alright in that one?", "lovely teamwork", "that was a bit scary for me", "we did it, how nice"], reply: ["very nicely", "i hope so, it was busy", "truly lovely", "but we managed!", "so nice"] },
    loot: { open: ["did anyone get something pretty?", "i'll use my loot for crafting", "what's your favourite drop?", "even the herbs are lovely", "a nice little pile of loot"], reply: ["i hope so", "something lovely, i hope", "the seeds, always", "they really are", "very nice"] },
    next: { open: ["shall we go again, gently?", "i might go fishing after one more", "is it alright if i rest a moment first?", "one more, then the garden", "take it slowly next time"], reply: ["gently, yes", "the river's calling", "thank you", "the garden's waiting", "nice and slow"] },
    unwind: { open: ["that was lovely", "what will you do after this?", "time for a nice cup of tea", "i'm glad we did that together", "a peaceful end to a busy kill"], reply: ["truly lovely", "a walk by the lake", "with a biscuit", "me too", "how nice"] },
  },
  roleplayer: {
    kill: { open: ["victory is ours, brave companions", "who struck the mightiest blow?", "[nex] the winged general falls again", "a clash the minstrels shall remember", "glory to our fellowship"], reply: ["huzzah!", "all of us, as one", "and so she shall again", "the bards shall sing it", "glory!"] },
    loot: { open: ["what spoils didst thou claim?", "the treasure is ours by right", "what relic dost thou seek most?", "the spoils of war are fair", "a fine bounty this day"], reply: ["mine own share, humbly", "won in honest battle", "the {unique} of legend", "and fairly won", "a worthy bounty"] },
    next: { open: ["shall we ride again into battle?", "a new quest calls us", "what foe shall we face next?", "sharpen thy blades, friends", "to battle once more"], reply: ["aye, at once!", "and we shall answer", "whatever fate sends", "mine are ever sharp", "to glory!"] },
    unwind: { open: ["let us rest by the fire", "what tales wilt thou tell of this day?", "a feast in our honour", "well fought, every one of ye", "the night is ours"], reply: ["a fine rest", "tales of valour", "with mead aplenty", "and thee, friend", "until the dawn"] },
  },
  dad: {
    kill: { open: ["good job, team, proud of you", "who wants a gold star for that one?", "that's how we do it", "did everyone remember to pray?", "teamwork, that's the secret"], reply: ["very proud", "everyone gets one", "that's the way", "i did, for once", "always has been"] },
    loot: { open: ["what did you get, champ?", "save some of that for a rainy day", "what would you spend a {unique} on?", "loot's nice, but family's better", "don't spend it all at once"], reply: ["something good, i hope", "rainy days always come", "a new shed", "but loot helps", "sensible"] },
    next: { open: ["one more, then bedtime", "everyone had a snack?", "shall we go again, kiddo?", "careful on the next one", "right, let's go again"], reply: ["bedtime's a suggestion", "had a sandwich", "why not", "always careful", "let's do it"] },
    unwind: { open: ["right, i need a cuppa", "what are you all doing after?", "good job today, everyone", "time to put my feet up", "proud of this team"], reply: ["two sugars", "probably a nap", "really good job", "well earned", "very proud"] },
  },
};
