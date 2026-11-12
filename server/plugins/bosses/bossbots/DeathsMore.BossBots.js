/**
 * Server custom: more death talk for every personality (Deaths.BossBots adds these onto its own):
 * excuses ({cause}), replies to anyone's excuse, and lines on a teammate's death ({name}, {cause}).
 */
module.exports = {
  joker: {
    excuse: ["{cause} and i have a complicated relationship", "i was doing a bit, {cause} didn't get it", "died to {cause}, but did you see my hair?", "in my defence, {cause} was very convincing", "that wasn't a death, that was a dramatic pause", "{cause} owed me money, we're even now", "i lay down to show {cause} who's boss", "my respawn was the real speedrun"],
    reply: ["the critics loved it", "comedy gold, as always", "best death of the season", "an award-winning performance", "they'll write songs about that", "at least you died with style", "the ghost of you was funnier", "ten out of ten, no notes"],
    mate: ["{name} took {cause} personally", "{name} speedran the respawn", "{name}'s getting a statue for that", "{name} found {cause}'s hitbox, congrats"],
  },
  scholar: {
    excuse: ["the {cause} exceeded my calculations", "i underestimated {cause}'s reach, an academic error", "{cause} struck before i could reason it out", "i was recording observations when {cause} hit", "a study in mortality, courtesy of {cause}", "i shall annotate this {cause} in my notes", "my theory on dodging {cause} needs revision", "{cause} provided a humbling lesson"],
    reply: ["a learned mistake", "history repeats, but we learn", "an instructive fall", "your notes will help us all", "even scholars fall", "a valuable data point", "knowledge is gained through failure", "well reasoned"],
    mate: ["{name}'s fall to {cause} is now documented", "{name} has been schooled by {cause}", "a lesson in {cause}, from {name}", "{name}'s fate will inform our tactics"],
  },
  grump: {
    excuse: ["{cause}. i was slow. done", "don't make a thing of it, {cause}", "i stood there like an idiot, {cause}", "yes, {cause}. stop looking at me", "my fault. {cause}. moving on", "{cause} got me, happy?", "i'm not talking about the {cause}", "i'll dodge it next time. probably"],
    reply: ["fine", "whatever", "move on", "it happens", "noted", "ok then", "sure", "let's go"],
    mate: ["{name} died. moving on", "{name} found {cause}. great", "{name}, honestly", "{name}, {cause}, figures"],
  },
  sweetheart: {
    excuse: ["i'm so sorry, the {cause} surprised me", "i'll be extra careful of {cause} now!", "sorry for leaving, {cause} was too much!", "i tried my best against {cause}!", "{cause} got me, but i'm happy to be back!", "please forgive me, {cause} was tricky", "i promise no more {cause} deaths!", "aww, {cause}, but i'm okay now!"],
    reply: ["we're just happy you're back!", "no need to say sorry!", "you did your best!", "it's okay, we've got you", "aww, welcome back!", "we missed you!", "don't be hard on yourself!", "you're doing great!"],
    mate: ["{name}, we're here for you!", "poor {name}, {cause} is mean", "{name} will be okay, i know it", "hugs for {name} after that {cause}"],
  },
  sweat: {
    excuse: ["{cause}: i mistimed by a tick, adjusting", "i was optimising dps and ate {cause}", "{cause} death, my prayer flick was late", "lost focus for one tick, {cause} punished it", "{cause}: should have moved two ticks earlier", "i'll log this {cause} death as an outlier", "my reaction to {cause} wasn't optimal", "{cause} - i'm adding it to the review"],
    reply: ["review it and fix it", "one tick, that's all", "adjust and go again", "efficient comeback needed", "noted, optimise it", "next one, cleaner", "data says you'll be fine", "tighten it up"],
    mate: ["{name}'s {cause} death: mistimed", "{name}, review the {cause} timing", "{name} lost ticks to {cause}", "{name}, optimise the {cause} dodge"],
  },
  rookie: {
    excuse: ["i still don't know how to dodge {cause}", "the {cause} happened so fast!", "i'm sorry, i'm still learning {cause}", "i didn't even see the {cause}", "i panicked when {cause} came", "is {cause} always that strong?", "i'll watch a guide on {cause}!", "i thought i was safe from {cause}"],
    reply: ["you'll get it!", "i didn't know either!", "we all start somewhere!", "you're getting better!", "i'm still learning too!", "it took me ages too", "next time for sure!", "you've got this!"],
    mate: ["{name} died?! scary", "how did {cause} get {name}?", "{name}, are you okay?!", "{cause} killed {name}, i'm nervous"],
  },
  veteran: {
    excuse: ["{cause} got me, seen it a hundred times too", "my old reflexes and {cause} don't mix", "{cause}, i should've known better", "back in my day {cause} hit harder, still died", "{cause} reminded me i'm human", "old dog, old mistake, {cause}", "i let my guard down for {cause}", "{cause} happens, even to me"],
    reply: ["happens to everyone", "we've all been there", "shake it off, it's fine", "lesson learned", "steady on", "you'll be right", "experience comes from this", "good to have you back"],
    mate: ["{name} learned {cause} the old way", "{name}, we all eat {cause} once", "{name}, you'll be fine, kid", "{name} met {cause}, a rite of passage"],
  },
  chill: {
    excuse: ["{cause} vibes, it's fine", "eh, {cause}, no biggie", "i was too relaxed for {cause}", "{cause} happens, all good", "chill death, {cause}", "no stress, {cause} got me", "{cause}, my bad, whatever", "{cause} won, i'm back"],
    reply: ["all good", "no stress", "chill", "vibes", "it's fine", "happens", "welcome back", "nice and easy"],
    mate: ["{name}'s fine, {cause} happens", "eh, {name} died", "{name}'ll be back", "no stress {name}"],
  },
  hype: {
    excuse: ["{cause} GOT ME BUT I'M BACK", "DIED TO {cause}, WATCH THE COMEBACK", "{cause} WAS CRAZY, LETS GO AGAIN", "I'LL DESTROY {cause} THIS TIME", "THAT {cause} WAS INSANE BUT I'M HYPED", "{cause} WON ONCE, NEVER AGAIN", "COMEBACK FROM {cause} STARTS NOW", "I'M FUELLED BY {cause} NOW"],
    reply: ["LETS GOOO", "COMEBACK TIME", "YOU'RE BACK BABY", "HYPE HYPE", "WE GO AGAIN", "NO STOPPING US", "REDEMPTION ARC", "LOVE IT"],
    mate: ["{name} WILL COME BACK STRONGER", "{name} VS {cause} REMATCH", "AVENGE {name}", "{name} COMEBACK INCOMING"],
  },
  ironman: {
    excuse: ["{cause} cost me hand-made brews", "died to {cause}, back to farming after", "{cause} - iron mode is pain", "my supplies paid for that {cause}", "i'll have to grind more after {cause}", "{cause} got me, no ge to save me", "hcim nerves, then {cause}", "{cause}: costly on an ironman"],
    reply: ["iron pain", "you'll farm more", "respect the grind", "earned the hard way", "iron btw", "back to the grind", "it's all self-made", "supplies come back"],
    mate: ["{name}'s supplies took a hit", "{name}, {cause}, iron pain", "{name} paid the iron tax", "{name}, eat up next time"],
  },
  flipper: {
    excuse: ["{cause} cost me a fortune", "that {cause} death was a bad trade", "{cause} - i'm in the red now", "my profit died with me to {cause}", "{cause} was the worst investment", "i'll make the gp back after {cause}", "{cause}: costly lesson", "bad roi on that {cause}"],
    reply: ["write it off", "you'll make it back", "sunk cost", "bad trade", "profit next time", "it's just gp", "invest better", "margins recover"],
    mate: ["{name} lost gp to {cause}", "{name}, bad trade", "{name}'s death cost us", "{name}, that's a loss"],
  },
  pker: {
    excuse: ["{cause} got lucky", "lag, then {cause}", "i'd dodge {cause} in the wildy", "{cause} was rng", "whatever, {cause}", "rematch with {cause}", "{cause} sat me, gf", "{cause}, lucky hit"],
    reply: ["sit", "lol", "gf", "excuses", "ez", "lucky", "rng", "sure"],
    mate: ["{name} got sat", "lol {name}", "{name}, gf", "{name} ate {cause}"],
  },
  skiller: {
    excuse: ["oh dear, {cause}", "{cause} was too much for me", "i should stick to skilling after {cause}", "{cause} caught me daydreaming", "deep breath, {cause} got me", "{cause}, i'll be careful", "oh my, {cause}", "{cause}, a lesson learned"],
    reply: ["oh dear", "you're okay", "take it slow", "lovely to have you back", "deep breath", "nice and calm", "it's alright", "all's well"],
    mate: ["oh dear, {name}", "poor {name}", "{name}, take it slow", "{name}, deep breath"],
  },
  roleplayer: {
    excuse: ["the vile {cause} hath bested me", "i fell to {cause}, but i rise again", "{cause} was sorcery most foul", "mine honour demands vengeance on {cause}", "i was smitten by {cause}", "a warrior's death, to {cause}", "{cause} claimed me, but not my spirit", "forgive me, {cause} was cruel"],
    reply: ["rise, companion", "thou art forgiven", "huzzah, thou returnest", "a valiant fall", "honour remains thine", "onward together", "we stand with thee", "well fought"],
    mate: ["{name} fell nobly to {cause}", "avenge {name}!", "{name}, thy fall honours thee", "the {cause} took {name}"],
  },
  dad: {
    excuse: ["{cause} got dad, i'm getting old", "my back gave out, then {cause}", "dad was distracted, {cause} won", "{cause}, don't tell the kids", "{cause}, ow, i'm alright", "dad'll dodge {cause} next time", "i was thinking about the bbq, then {cause}", "{cause} got me, chin up"],
    reply: ["you're fine, champ", "dad's back", "chin up", "proud of you anyway", "walk it off", "good to have you back", "happens to dads", "we've got you"],
    mate: ["{name}, walk it off champ", "poor {name}, {cause}", "{name}'ll be back, kiddo", "{name}, chin up"],
  },
};
