/**
 * What the Nex bots say about No Escape (her Smoke Dash: "NO ESCAPE!", the charge down an aisle that
 * throws whoever's in it), by personality - its own lines, as the ice prison has (Bots.Nex hitWatch):
 * - self: the one caught in it; seen ({name}): a teammate who got clear; shared ({name}: another caught
 *   with it): one of several caught, owning its part, never blaming;
 * - reply: a teammate's answer to that; comeback: the first speaker's answer back.
 */
const NO_ESCAPE_LINES = {
  joker: {
    self: ["she said no escape and meant it", "i've been yeeted", "frequent flyer miles: earned", "that was my stunt double", "no escape? no kidding", "she bowled me over. strike!"],
    seen: ["{name} took the express lane", "{name} got the full no escape package", "{name} flew economy", "10/10 airtime, {name}", "{name} heard 'no escape' and believed her", "bye {name}, see you on the other side"],
    shared: ["me and {name} carpooled", "{name} and i flew together, romantic", "group trip with {name}, nobody escaped", "{name} and i, the no escape duo"],
    reply: ["the landing needs work", "do it again, i missed it", "frequent flyer of the year", "that's a highlight"],
    comeback: ["i'll be signing autographs", "i stuck the landing, mostly", "it's called style", "jealous of my airtime"],
  },
  scholar: {
    self: ["i misjudged her aisle", "the dash lane was clear in hindsight", "i stood in her charge, an error", "she telegraphs it - i misread it", "the aisle she faced was mine", "a lesson in reading her turn"],
    seen: ["{name} was in her aisle", "{name} stood in the dash lane", "{name}, watch which way she turns", "{name} missed the tell on that charge", "her charge found {name}", "{name}, the aisle she faces is the one to leave"],
    shared: ["{name} and i both misread the aisle", "we both stood in her lane, {name}", "{name} and i should have moved on her turn", "a shared error with {name}"],
    reply: ["she always faces her aisle first", "the turn is the tell", "a common oversight", "worth noting for next time"],
    comeback: ["i'll watch her turn", "noted, painfully", "an education", "i'll study her facing"],
  },
  grump: {
    self: ["great. thrown again", "i hate that charge", "no escape. yeah, i noticed", "of course it was my aisle", "lovely. flying", "every time"],
    seen: ["{name}, move next time", "{name} stood right in it", "{name}, she literally shouts it", "nice one, {name}", "{name}, the aisle. the aisle", "{name}. really"],
    shared: ["{name} and me. brilliant", "both of us, {name}. great", "me and {name}, flattened", "{name}, we both stood there"],
    reply: ["unbelievable", "again", "great", "obviously"],
    comeback: ["yeah yeah", "don't", "whatever", "fine"],
  },
  sweetheart: {
    self: ["oof, she got me! i'm okay!", "eek, i went flying!", "that was scary but i'm fine!", "oops, wrong aisle, sorry!", "wheee... ow", "i'm okay, don't worry!"],
    seen: ["oh no {name}, are you okay?", "{name}! i hope that didn't hurt too much", "aww {name}, you'll get it next time", "sending you hp, {name}!", "careful {name}, you're doing great!", "{name}, i've got you, eat up!"],
    shared: ["{name} and i both got caught, we're okay!", "oops, me and {name}! sorry!", "we got bowled together, {name}!", "{name}, we're in this together!"],
    reply: ["you're still doing amazing!", "aww, it happens!", "you'll dodge the next one!", "deep breaths, you're okay!"],
    comeback: ["thank you!", "aww, you're the best", "i'll do better!", "you're so sweet"],
  },
  sweat: {
    self: ["misplay, i was in her aisle", "lost ticks to that dash", "should've pre-moved out of the lane", "bad positioning, my fault", "that charge cost me dps", "aisle check failed"],
    seen: ["{name}, you were in the lane", "{name}, pre-move on her turn", "{name}, that's lost dps", "{name}, check her facing", "{name} ate the dash, avoidable", "{name}, step out on the shout"],
    shared: ["{name} and i both misplayed it", "two of us in the lane, {name}, sloppy", "me and {name}, bad spacing", "{name}, we both lost ticks there"],
    reply: ["fix it next phase", "avoidable", "that's dps lost", "tighten it up"],
    comeback: ["fixing it", "won't happen twice", "adjusting", "noted for the run"],
  },
  rookie: {
    self: ["what was that?!", "i didn't know she could do that!", "she ran me over!", "is that what no escape means?", "woah, i flew!", "how do i dodge that one?"],
    seen: ["{name} got run over!", "woah, {name} went flying!", "{name}, are you okay?!", "how did that happen, {name}?", "{name}, that looked scary!", "she threw {name}!"],
    shared: ["{name} and i both went flying!", "me and {name}, wow!", "did {name} get thrown too?!", "{name}, we both got it!"],
    reply: ["step out of the aisle she looks at!", "move when she shouts!", "you'll learn it!", "it gets everyone once"],
    comeback: ["ohh, okay!", "i'll remember!", "thanks!", "got it!"],
  },
  veteran: {
    self: ["got lazy on the aisle", "should've moved on the shout", "been doing this years, still got me", "she caught me napping", "rookie mistake, that one", "the dash, every time i get comfy"],
    seen: ["{name}, watch her facing", "{name}, move on 'no escape'", "{name}, out of the aisle next time", "{name}, she turns first, that's your cue", "easy to do, {name}", "{name}, step sideways, not back"],
    shared: ["{name} and i both got comfy", "me and {name}, a pair of rookies", "{name}, we both should've moved", "caught us both, {name}"],
    reply: ["happens to the best", "move on the shout", "she always turns first", "you'll be fine"],
    comeback: ["aye, i know", "won't happen again", "getting old", "heh, fair"],
  },
  chill: {
    self: ["oop, flew a bit", "she got me, all good", "wee", "no escape, fair", "that's one way to move", "chill, i'm fine"],
    seen: ["{name} went for a ride", "you good {name}?", "{name} got bowled, oof", "eat up {name}", "{name} took the scenic route", "rip {name}"],
    shared: ["me and {name}, oops", "{name} and i flew, it's fine", "both of us, {name}, oh well", "{name}, we vibed in the lane"],
    reply: ["all good", "it happens", "chill", "no worries"],
    comeback: ["yep", "all good", "cheers", "ha"],
  },
  hype: {
    self: ["SHE SENT ME FLYING", "NO ESCAPE?? NO ESCAPE!!", "I'M AIRBORNE", "THAT HIT HARD", "WHAT A CHARGE", "I FLEW SO FAR"],
    seen: ["{name} GOT LAUNCHED", "{name} WENT FLYING", "LOOK AT {name} GO", "{name} TOOK THE WHOLE CHARGE", "WHAT A HIT ON {name}", "{name} YOU OKAY??"],
    shared: ["ME AND {name} FLEW TOGETHER", "{name} AND I GOT BOWLED", "DOUBLE LAUNCH WITH {name}", "{name} WE BOTH FLEW"],
    reply: ["SHAKE IT OFF", "WE GO AGAIN", "STILL HYPED", "LETS GOOO"],
    comeback: ["LETS GO", "I'M FINE", "HYPED ANYWAY", "AGAIN"],
  },
  ironman: {
    self: ["that charge costs supplies", "eating for that dash", "my fault, i was in the aisle", "she earned that one", "no escape, i'll remember it", "there goes a brew"],
    seen: ["{name}, watch the aisle", "{name}, that's a brew gone", "{name} got charged", "{name}, step out on the shout", "careful {name}, supplies", "{name} took the dash"],
    shared: ["{name} and i both pay for that", "me and {name}, two brews down", "{name}, we both earned that one", "caught us both, {name}"],
    reply: ["supplies are earned", "eat up", "lesson learned", "move on her turn"],
    comeback: ["aye", "eating", "fair", "won't waste another"],
  },
  flipper: {
    self: ["that dash cost me a brew, margins", "bad trade, standing there", "no escape, no profit", "that's a loss on supplies", "i'll bill her for that", "terrible return on that tile"],
    seen: ["{name}, that tile was a bad investment", "{name} took a loss there", "{name}, that's a brew in the red", "{name}, poor positioning, poor returns", "{name} paid the dash tax", "{name}, sell that spot"],
    shared: ["{name} and i both took the loss", "me and {name}, joint bad investment", "{name}, we both paid the tax", "split the loss with {name}"],
    reply: ["write it off", "it's a cost of business", "you'll make it back", "cheap lesson"],
    comeback: ["writing it off", "margins hurt", "lesson priced in", "fair"],
  },
  pker: {
    self: ["lol she got me", "ez for her", "rip", "she charged, i didn't care", "whatever, i'm fine", "lagged"],
    seen: ["{name} got bowled lol", "sit {name}", "lol {name}", "{name} got farmed", "nice dodge {name}", "{name}, move lol"],
    shared: ["me and {name} both, lol", "{name} and i got farmed", "rip me and {name}", "both of us, {name}, lol"],
    reply: ["lol", "unlucky", "happens", "ez"],
    comeback: ["lol", "whatever", "sit", "next"],
  },
  skiller: {
    self: ["oh dear, i went flying", "she caught me, how rude", "i was too busy looking at the room", "oops, wrong aisle", "that wasn't very relaxing", "i'll stand somewhere calmer"],
    seen: ["oh dear, {name}, are you alright?", "{name} took a tumble", "careful {name}", "{name}, come stand somewhere quieter", "poor {name}", "{name}, have a nice snack"],
    shared: ["{name} and i both took a tumble", "oh dear, me and {name}", "{name}, we both got bowled over", "we'll be more careful, {name}"],
    reply: ["oh well, have a snack", "it happens", "you're alright", "nice and calm now"],
    comeback: ["thank you", "how kind", "i'll be careful", "lovely, thanks"],
  },
  roleplayer: {
    self: ["she hath charged me down!", "no escape, she spake truly", "i was flung like a common peasant", "her charge was swift as the wind", "alas, i stood in her path", "i shall rise again!"],
    seen: ["{name} was cast aside by her charge!", "rise, {name}, rise!", "{name} hath been flung afar", "her fury found {name}", "stand fast, {name}!", "{name}, she spake no escape and kept her word"],
    shared: ["{name} and i were both cast aside", "together {name} and i were flung", "her charge took {name} and me alike", "we fall together, {name}, and rise together"],
    reply: ["rise, friend!", "a mere setback", "thou shalt prevail", "fear not"],
    comeback: ["verily", "i rise!", "my thanks", "onward!"],
  },
  dad: {
    self: ["dad got bowled over", "no escape? more like no dignity", "i'm okay, just my pride", "she ran me down like a lawnmower", "dad went flying, don't tell mum", "ouch, my back"],
    seen: ["you okay, champ? {name}?", "{name}, step out of the aisle, kiddo", "{name} got the full dash, oof", "brush it off, {name}", "{name}, that's character building", "{name}, eat up, champ"],
    shared: ["me and {name} both got bowled, team effort", "{name} and dad, flying together", "{name}, we'll do better, champ", "both of us, {name}, oops"],
    reply: ["walk it off, champ", "proud of you anyway", "happens to the best of us", "you'll get it, kiddo"],
    comeback: ["thanks, champ", "dad's fine", "back in the game", "good stuff"],
  },
};

module.exports = { NO_ESCAPE_LINES };
