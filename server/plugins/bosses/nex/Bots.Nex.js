/**
 * Nex bot team (server custom, not OSRS): whoever starts a private fight gets four bot teammates -
 * two melee (Osmumten's fang, Torva) and two rangers (Twisted bow, a Zaryte crossbow with ruby
 * dragon bolts (e) for its special) - who walk in behind them and kill Nex the way the OSRS Wiki's
 * Nex/Strategies page teaches a small team to:
 *
 *   - prayers by phase: Protect from Magic (smoke, blood, ice, Zaros), Protect from Missiles
 *     (shadow), Protect from Melee while she is meleeing them; Piety or Rigour throughout;
 *   - rangers keep their distance (the shadow shots hurt less far away, the shadow phase at 9-10
 *     tiles) and away from Glacies in the ice phase; melee stand on her sides, spread out;
 *   - the called mage dies first, every time;
 *   - Blood Siphon: off Nex (hits heal her) and onto the reavers, who heal whoever hits them;
 *   - out of the dash's aisle, off the shadow under them, out of the darkness (melee), out of the
 *     5x5 before Containment, 7+ tiles away when marked for a sacrifice, away from anyone coughing
 *     or marked, out of Wrath's 5x5 when she dies;
 *   - melee break a teammate (or the owner) out of an Ice Prison with their stab weapon;
 *   - Deflect Melee in the Zaros phase: the melee hold their hits;
 *   - a Zaryte crossbow special while Nex is high (ruby's Blood Forfeit takes 22% of her hitpoints,
 *     up to 110), the fang's special when the energy is there;
 *   - brews and anglerfish to stay up, super restores for prayer and the brews' drain, a combat
 *     or ranging potion when the boost runs out; restocked between kills.
 *
 * They are players, not perfect: each reacts a tick or three late, and now and then (FUMBLE_CHANCE)
 * misses a dodge altogether, so a bot can die. A dead bot leaves the instance (logged out) and a new
 * one runs in before the next kill. Nobody is left behind: when the last real player leaves, the
 * bots log out and the instance ends (Instance.Nex). Bots only come into private fights, never the
 * public chamber.
 *
 * Fight.Nex records each special as it starts (`fight.cues`): what a player sees - the aisle she
 * turns to, the red mark, the shadows under everyone.
 */
const Common = require("./Common.Nex");
const { TALK, MORE_HEAL_LINES, MORE_HIT_LINES, MORE_PRISON_LINES, MORE_BANTER, EXTRA_HEAL, EXTRA_HIT, EXTRA_PRISON, EXTRA_BANTER, SHARED_HIT_LINES, OWN_ANSWERS } = require("./Talk.Nex");
// The boss-bot roster and memory every boss shares (bossbots/, docs/boss-bots.md).
const Roster = require("../bossbots/Roster.BossBots");
const Scam = require("../bossbots/Scam.BossBots");
const Memory = require("../bossbots/Memory.BossBots");
const Chatter = require("../bossbots/Chatter.BossBots");
const Deaths = require("../bossbots/Deaths.BossBots");
const Kit = require("../bossbots/Kit.BossBots");
const Bosses = require("../bossbots/Bosses.BossBots");
const { NO_ESCAPE_LINES } = require("./Escape.Nex");
const { BOT_PERSONAS } = Roster;
const Attacks = require("./Attacks.Nex");
const Specials = require("./Specials.Nex");
const { createBotPlayer } = require("../../bots/behaviours/spawn/PlayerFactory.PlayerBots");
// The Theatre's Grand Exchange trip (kofi): a lone or duo bot's rare is sold and split there the same way.
const { GeTrip } = require("../bossbots/GeTrip.BossBots");
/**
 * The Theatre's store of shares owed to an owner who logged out mid-trip, when the Theatre's bots are on this
 * server: they log the seller back in to pay (Split.Payback). Without them a logged-out owner's share is lost.
 */
let oweLater = null;
try {
  oweLater = require("../../minigames/tob/Split.TheatreOfBlood").owe ?? null;
} catch {
  oweLater = null;
}
const { ATTR_SKIP_PERSISTENCE } = require("../../bots/runtime/PersistenceConstants.PlayerBots");

/**
 * The teams picked at the Ancient Barrier (Instance.Nex chooseTeam): four (two of each), a duo (one of
 * each) or a lone bot - a melee bot with the full ranged switch, the Zaryte crossbow and a blowpipe (pickerInventory).
 */
// The lone bot is a ranger (kofi's call): no melee switch, beside Umbra like a melee bot, then back
// beside Nex stalling her.
const TEAMS = { four: ["melee", "melee", "ranged", "ranged"], duo: ["melee", "ranged"], solo: ["ranged"] };
const TEAM_MESSAGES = {
  four: "Four Nex veterans follow you in.",
  duo: "Two Nex veterans follow you in: two perfect rangers.",
  solo: "A lone Nex veteran follows you in: a perfect ranger, with a Zaryte crossbow for ruby bolt specs.",
};
const BOT_ATTRIBUTE = "nex:bot";
const RIGOUR_UNLOCKED_ATTRIBUTE = "prayer:rigour-unlocked";
const ZEAL_UNLOCKED_ATTRIBUTE = "prayer:zeal-unlocked";
/** The rune pouch's contents (RunePouch): a greater thrall's 5 blood, 10 fire and 1 cosmic, many times over. */
const RUNE_POUCH_ATTRIBUTE = "rune-pouch:runes";
const POUCH_RUNES = [["BLOOD_RUNE", 2000], ["FIRE_RUNE", 4000], ["COSMIC_RUNE", 400]];
/** The summoner's live thrall (ArceuusThralls). */
const THRALL_ATTRIBUTE = "arceuus:thrall";

// How long a bot takes to react to what it sees, in ticks, and how often it doesn't react at all.
const REACTION_TICKS = [1, 3];
const FUMBLE_CHANCE = 0.05;
// Eating: below a share of their hitpoints rolled per bot; prayer below these points.
const EAT_AT = [0.45, 0.62];
const PANIC_AT = 0.28;
const PRAYER_AT = [18, 32];
const BREWS_BEFORE_RESTORE = 2;
const CONSUME_EVERY_TICKS = 2;
// Ranged distances from her body, by phase; melee keep this far away in the darkness.
// Shadow shots fall off with distance (up to ~21 at 7 tiles, ~2 at 10): her range's edge for that phase.
const RANGED_BAND = { normal: [4, 8], shadow: [9, 10], ice: [3, 6] };
/** The bows' reach (Twisted bow, Zaryte crossbow): past it a ranger has to move to shoot. */
const RANGED_REACH = 10;
/** Bots to each reaver: the team spreads over them rather than all on the nearest. */
const REAVER_SHARE = 2;
/** Melee stop hitting Cruor at this many hitpoints while reavers are still alive. */
const CRUOR_HOLD_HITPOINTS = 80;
const DARKNESS_DISTANCE = 3;
const WRATH_DISTANCE = 3;
const SACRIFICE_DISTANCE = 9;
const GLACIES_AVOID = 5;
// The Zaryte crossbow special: Blood Forfeit's 22% reaches its 110 cap at 500 hitpoints.
const ZCB_SPEC_MIN_HITPOINTS = 600;
const ZCB_SPEC_ENERGY = 75;
// The melee bots' spec weapons, each half the bar: claws' four hits, or Voidwaker's magic hit that
// never misses (50-150% of the max) - the pick for finishing her or after a run of misses.
const SWAP_SPEC_ENERGY = 50;
const VOIDWAKER_FINISH_HITPOINTS = 400;
const SWAP_BACK_TICKS = 6;
/** Ticks after a special's shot before a bot drinks anything (it lands in two or three). */
const SPEC_LAND_TICKS = 3;
/** Ticks after swapping to the fang before its first stab at an ice prison, so its attack bonus counts. */
const FANG_SETTLE_TICKS = 1;
/** Anti-venom+, most doses first: each bot carries one (Potions: a full cure and 15 minutes' immunity). */
const ANTI_VENOM_PLUS = ["ANTI_VENOM_4__3", "ANTI_VENOM_3__3", "ANTI_VENOM_2__3", "ANTI_VENOM_1__3"];
/** A bot's attack stats are never left under this in a fight: under it, it pots straight back up. */
const BOOST_FLOOR = 105;
/** A bot sips its surge potion with its special bar at this or under (never over 75%). */
const SURGE_AT = 75;
/** When the surge potion's cooldown ends (Potions' attribute). */
const SURGE_ATTRIBUTE = "potions:surge:until";
const WALK_EVERY_TICKS = 2;
const RESTOCK_AFTER_KILL_TICKS = 8;

/** The 100 boss bots, each name tied to one personality for life (Roster.BossBots). */
const NAMES = Roster.NAMES;
const CHATTER = {
  start: ["gl all", "lets go", "ez kc", "pray mage", "ready", "gl"],
  siphon: ["reavers!", "off nex", "siphon", "kill reavers"],
  sacrifice: ["running", "brb", "marked"],
  prison: ["im stuck", "help ice", "break me out"],
  // As she dies: about the kill only - the gz waits for the loot (afterKillChat).
  kill: ["nex down", "she's down", "ez nex", "bye nex", "dead bird", "down she goes", "nice kill", "clean kill", "zaros can't save you",
    "rip nex", "another one", "wings clipped", "get rekt nex", "that's a kill", "sit down nex", "and stay down", "night night nex"],
  death: ["rip", "oops", "f"],
  bank: ["bank", "restock", "brb"],
  back: ["back", "ready", "go again", "rdy"],
  gz: ["gz", "gz!!", "gzzz", "huge gz", "gz man", "nice drop gz", "gz!"],
  lucky: ["OMG", "LETS GOOO", "NO WAY", "YESSSS", "finally!!!", "WOOOO", "ty nex <3", "im shaking"],
};
















/** Typing: a short line about 2 seconds, a long one up to 6. */
function typingTicks(text) {
  return Math.max(3, Math.min(10, 2 + Math.ceil(String(text).length / 14)));
}
/** Ticks of quiet after a conversation's last line before the next topic. */
const CHAT_GAP = [10, 22];

/** How a bot talks: the joker, the lore nerd, the grump, the sweetheart and the sweat. */
// (Not the scammers: only the four named ones are, kofi.)
const PERSONAS = Object.keys(Roster.PERSONAS).filter((persona) => persona !== "scammer");

/** The voice a bot talks in: a scammer the pker's (Roster.voiceOf), its scams its own (`scammer`). */
function personaOf(name) {
  if (BOT_PERSONAS[name]) return Roster.voiceOf(BOT_PERSONAS[name]);
  let hash = 0;
  for (const letter of String(name)) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
  return PERSONAS[hash % PERSONAS.length];
}








/** A line waits until its speaker is back above this share of their hitpoints. */
const SAFE_TO_TYPE = 0.6;
/** A special's hit under this much isn't worth a word (an ice prison's shatter always is). */
const HIT_TALK_MIN = 15;
const SPECIAL_NAMES = { darkness: "darkness", dash: "no escape", smash: "shadow smash", sacrifice: "blood sacrifice", containment: "containment", prison: "ice prison" };

/** Hit by one of her specials, each personality: what the one hit says (self), and what a teammate says (seen, {name}). */
const HIT_LINES = {
  joker: {
    self: ["ow. that one had my name on it", "i meant to do that", "{special}? more like {special} me in the face", "i'm fine, my pride isn't",
      "that's going in the blooper reel", "i was testing her max hit, it's high", "nex 1, my face 0", "who put that {special} there",
      "i dodged it. emotionally", "note to self: don't stand there"],
    seen: ["{name} caught that {special} with their face", "nice tank, {name}", "{name} just volunteered as tribute", "that {special} loved you, {name}",
      "10/10 landing, {name}", "{name} said 'hit me' and she did", "someone get {name} a plaster", "{name} is collecting specials now",
      "{name}, that's not how you dodge", "rip {name}'s hp bar"],
  },
  scholar: {
    self: ["{special} - i misread the tell", "should have moved on her animation", "{special} hits harder than the wiki makes it sound", "lesson noted: {special} has a wider area",
      "i underestimated the range on that", "fascinating mechanic, painful in practice", "her tell was clear, my reaction wasn't", "that's the {special} the generals taught her",
      "i'll study her animation more closely", "an error of positioning, not knowledge"],
    seen: ["{name}, that {special} has a tell - watch her animation", "{special} reaches further than people think, {name}", "classic {special} placement error", "{name}, stand outside the area next time",
      "the {special} always comes after her chant, {name}", "it's all in the timing, {name}", "{name} learned the {special} the hard way", "textbook {special}, {name}",
      "the wiki warns about that one, {name}", "{name}, read the room - and the special"],
  },
  grump: {
    self: ["of course it hit me", "lovely. fantastic.", "this boss is rigged", "who designed this {special}", "i hate this phase",
      "i was standing there first", "every single time", "my brews are crying", "can she not", "why is it always me"],
    seen: ["{name}, move.", "how did you not see that, {name}", "{name}, the floor is telling you to leave", "come on {name}", "that's on you {name}",
      "{name} standing in {special} again", "i'm not healing you {name}", "{name}, pay attention", "that was avoidable, {name}", "sigh. {name}."],
  },
  sweetheart: {
    self: ["ouch, but i'm okay!", "don't worry about me, i'm fine", "that hurt a little, i'll be careful", "i'm alright, keep going everyone",
      "oops! my fault", "just a scratch", "i'll eat up, no worries", "thank you for waiting", "i'm okay, really", "lesson learned, sorry everyone"],
    seen: ["{name}, are you okay?", "eat up {name}, you'll be fine", "it's alright {name}, it happens", "sending you heals {name}", "you've got this {name}",
      "don't worry {name}, she's tricky", "careful {name}!", "{name}, shake it off", "we've got you {name}", "proud of you anyway {name}"],
  },
  sweat: {
    self: ["{special} - that's a positioning error on me", "that cost me a brew, unacceptable", "-1 to my pb pace", "i'll fix my tile",
      "should've pre-moved", "lost a tick of dps to that", "my bad, adjusting", "that won't happen twice", "logging that for review", "unoptimal. moving on"],
    seen: ["{name}, that's dps lost", "{name}, pre-move for {special}", "that's a brew wasted, {name}", "{name}, you need to be on your tile", "tighten up {name}",
      "{special} is free damage if you're slow, {name}", "{name}, that's a pb killer", "watch her tells, {name}", "{name}, react faster", "we can't afford that, {name}"],
  },
};

/** A failed ice prison: the one trapped, and the one who went to free them ({name}: who was trapped). */
const PRISON_LINES = {
  joker: {
    trapped: ["brrr. thanks for nothing", "i've become a popsicle", "ice ice baby", "i'm cool. literally", "frozen and furious", "that's one way to chill out"],
    rescuer: ["sorry {name}, my fang slipped", "i was SO close", "the ice won this round", "in my defence, it was very icy", "sorry {name}, i tripped over a nihil", "i'll bring a hairdryer next time"],
  },
  scholar: {
    trapped: ["the stalagmites shattered before anyone reached them", "glacies's prison, as documented", "a freeze lasts only so long - then it hurts", "i should have stood further out",
      "the prison follows its target, avoidance is key", "noted: prison shatters on a timer"],
    rescuer: ["sorry {name}, i misjudged the distance", "the stalagmites need a stab or crush - i was too slow", "i calculated poorly, apologies {name}", "my route was inefficient, sorry",
      "the ice was further than i thought", "a timing failure on my part, {name}"],
  },
  grump: {
    trapped: ["great, nobody saved me", "thanks for the help, everyone", "i'll free myself next time", "typical", "do i have to do everything", "fantastic teamwork"],
    rescuer: ["i was coming, alright", "too slow. my bad, {name}", "the pathing hates me", "fine, my fault", "i'm not a speedrunner", "i'll be quicker next time, {name}"],
  },
  sweetheart: {
    trapped: ["it's okay, i'm alright!", "don't worry, it didn't hurt much", "you tried, that's what matters", "thank you for trying to save me", "no harm done", "next time for sure"],
    rescuer: ["i'm so sorry {name}!", "i tried my best, sorry {name}", "oh no {name}, are you okay?", "i'll be faster next time, promise", "sorry sorry sorry {name}", "that's on me {name}, i'm sorry"],
  },
  sweat: {
    trapped: ["prison not broken in time, that's a damage leak", "expected a break by tick 4", "rescue timing needs work", "-hp, -pace", "the closest person should be on it instantly", "logging that"],
    rescuer: ["sorry {name}, a tick late", "should've started running earlier", "my path was suboptimal, sorry", "i'll pre-position near the prison next time", "inexcusable, sorry {name}", "that was my break to make, my bad"],
  },
};

/** A little back-and-forth after: a teammate's answer (reply) and the first speaker's comeback. */
const HIT_BANTER = {
  joker: { reply: ["at least you're consistent", "do it again, i wasn't recording", "top 10 nex moments", "peak gameplay"],
    comeback: ["i'll be here all week", "you're just jealous", "it was a tactical hit", "my face, my rules"] },
  scholar: { reply: ["the mechanic is well documented", "it's in the strategy guide", "a common mistake", "worth studying"],
    comeback: ["i'll read up on it", "an educational experience", "knowledge acquired, painfully", "noted for future reference"] },
  grump: { reply: ["again?", "brilliant", "unbelievable", "of course"],
    comeback: ["yeah yeah", "not now", "leave it", "i know"] },
  sweetheart: { reply: ["you'll get it next time", "it's okay, we're all learning", "you're doing great", "no worries at all"],
    comeback: ["thank you", "you're the best", "aw, thanks", "i'll try harder"] },
  sweat: { reply: ["that's a brew down", "watch the tiles", "focus up", "we lost a tick there"],
    comeback: ["i know, i know", "fixing it", "won't happen again", "adjusting"] },
};

/** A big heal on Nex ({amount}: how much): reavers dying into her, a siphon fed; and the answers. */
const HEAL_LINES = {
  reavers: ["she just healed {amount}!", "nooo the reavers healed her", "big heal on nex, {amount} back", "the reavers got to her, +{amount}",
    "that's {amount} hp she didn't have a second ago", "cruor died with the reavers up, ugh", "and there goes our progress", "who left the reavers alive",
    "she healed {amount}, that hurts", "reaver heal. classic."],
  siphon: ["she siphoned {amount}!", "stop hitting her in the siphon!", "that siphon healed her {amount}", "who hit her during the siphon",
    "{amount} back from the siphon, oof", "the siphon fed her nicely", "big siphon heal, off nex next time", "she drank {amount} off us"],
  replies: ["it's fine, we go again", "rip our dps", "unlucky", "happens to the best of us", "we'll get it back", "pain",
    "deep breaths", "next time kill the reavers first", "ok that one hurt", "she's just teasing us", "back to work", "we've got this"],
};

/** The same, in each personality's voice: what it says first (reavers / siphon), and how it answers. */
const PERSONA_HEAL_LINES = {
  joker: {
    reavers: ["the reavers just gave nex a spa day, +{amount}", "nex: 'thanks for the snacks'", "free healing for nex, nobody asked", "reaver smoothie, {amount} hp worth"],
    siphon: ["we just fed her {amount} like a buffet", "nex is drinking us like a brew", "siphon goes brrr, +{amount}", "who ordered the all-you-can-heal"],
    replies: ["she's speedrunning full hp", "at least someone's eating well", "should've charged her for that", "nex 1, us 0"],
  },
  scholar: {
    reavers: ["the reavers return their life to her when cruor falls, {amount}", "blood magic: whatever the reavers held goes back to her", "classic zarosian blood siphon, {amount} restored", "that's why you clear reavers before cruor dies"],
    siphon: ["during the siphon every hit heals her, {amount} in all", "blood siphon turns our damage into her health", "{amount} siphoned. the mechanic is brutal but elegant", "she kneels and drinks the blood of the battle"],
    replies: ["noted for the next kill", "textbook blood phase mistake", "lore accurate at least", "a lesson in reaver priority"],
  },
  grump: {
    reavers: ["great. {amount} back. brilliant", "who left the reavers up. again.", "that's it, i'm logging. (i'm not)", "+{amount} for nex, -{amount} for my patience"],
    siphon: ["WHO hit her in the siphon", "{amount}. we gave her {amount}. unbelievable", "every single time", "stop. hitting. her. in. the. siphon."],
    replies: ["typical", "of course it did", "this is why i hate the blood phase", "i'm not angry, just disappointed"],
  },
  sweetheart: {
    reavers: ["oh no, she healed {amount}, it's okay though!", "that's alright, we'll get it back together", "don't worry about the heal, you're all doing great", "{amount} back, but we've got this"],
    siphon: ["it's okay, the siphon is tricky", "she healed {amount} but nobody's in trouble", "we'll do better on the next siphon, together", "deep breaths everyone, it's fine"],
    replies: ["you're all amazing anyway", "no blame, just love", "we're still on track", "let's keep going, team"],
  },
  sweat: {
    reavers: ["+{amount} on nex, that's about 20 seconds of dps lost", "reaver heal: {amount}. kill order needs fixing", "unacceptable, {amount} healed", "pb's gone with that heal"],
    siphon: ["{amount} siphoned, someone's not switching off", "siphon heal {amount}, that's a wipe on the pb", "hit the reavers, not her, every tick matters", "logging that siphon: {amount} lost"],
    replies: ["reset the timer, we go again", "we'll make it up on glacies", "tighten it up", "next siphon, nobody touches her"],
  },
};

// The rookie, the veteran and the chill one's heal, hit, prison and banter lines (Talk.Nex).
Object.assign(PERSONA_HEAL_LINES, MORE_HEAL_LINES);
Object.assign(HIT_LINES, MORE_HIT_LINES);
Object.assign(PRISON_LINES, MORE_PRISON_LINES);
Object.assign(HIT_BANTER, MORE_BANTER);
for (const [persona, extra] of Object.entries(EXTRA_HEAL)) for (const kind of Object.keys(extra)) PERSONA_HEAL_LINES[persona][kind].push(...extra[kind]);
for (const [persona, extra] of Object.entries(EXTRA_HIT)) for (const kind of Object.keys(extra)) HIT_LINES[persona][kind].push(...extra[kind]);
for (const [persona, extra] of Object.entries(EXTRA_PRISON)) for (const kind of Object.keys(extra)) PRISON_LINES[persona][kind].push(...extra[kind]);
for (const [persona, extra] of Object.entries(EXTRA_BANTER)) for (const kind of Object.keys(extra)) HIT_BANTER[persona][kind].push(...extra[kind]);




/** Nex's uniques: worth stopping for a "gz". */
const RARE_DROP = /torva|zaryte|nihil horn|ancient hilt|nexling/i;
const PICKUP_ANIMATION = 832;
// Emotes: cheer, jump for joy, dance.
const CHEER_ANIMATIONS = [862, 2109, 866];

/** The corner of the mage she'll call next: this phase's while it lives, else the next phase's. */
function upcomingMageTile(fight, instance) {
  const phases = Common.data.fight.phases;
  for (let index = fight.phaseIndex; index < phases.length; index++) {
    const name = phases[index].mage;
    if (!name) continue;
    if (index === fight.phaseIndex && fight.mages.get(name) && !alive(fight.mages.get(name))) continue;
    return instance.tile(Common.data.chamber.mages[name].tile);
  }
  return null;
}

/** Where Nex's altar stands in this chamber (found once, by the object on the map). */
function altarOf(instance) {
  if (instance.__altar !== undefined) return instance.__altar;
  const { box } = Common.data.chamber;
  const altarId = Common.data.objects.altar;
  instance.__altar = null;
  // A private chamber is a copy: its objects are the instance's own (Instance.allObjects, as its
  // safe-room copies are found), which the map lookup below never saw - so the bots skipped the
  // altar and teleported out instead.
  const copied = instance.allObjects?.().find((object) => object.getId?.() === altarId);
  if (copied) return (instance.__altar = copied.getLocation());
  // It stands by the chamber's west wall, just outside the fight's box: look 10 tiles around it.
  for (let x = box.minX - 10; x <= box.maxX + 10 && !instance.__altar; x++) {
    for (let y = box.minY - 10; y <= box.maxY + 10 && !instance.__altar; y++) {
      const at = instance.tile([x, y, box.z ?? 0]);
      const object = core.MapObjects.get(altarId, at, instance.area ?? null);
      if (object) instance.__altar = object.getLocation();
    }
  }
  return instance.__altar;
}

/** Ashuelot Reis, the banker ghost in the safe room, if he's near. */
function bankerNear(player) {
  const id = Common.data.npcs.ashuelot;
  // The safe room is the real world (not the instance), whichever area the bot's just teleported from.
  return core.World.getNpcsNear(player.getLocation(), 15, null).find((npc) => npc.getId() === id)
    ?? core.World.getNpcsNear(player.getLocation(), 15, player.getPrivateArea?.() ?? null).find((npc) => npc.getId() === id) ?? null;
}

/** The safe room, beside Ashuelot Reis's bank (real tiles: the prison is not part of the instance). */
function bankTile() {
  const room = Common.data.prison.safeRoom;
  return new core.Location(randomInt(room.minX + 2, room.maxX - 2), randomInt(room.minY + 4, room.maxY - 4), room.z ?? 0);
}

let api = null;
let core = null;
/** Instance -> its team. */
const teams = new Map();
/** Lone and duo bots on their way to sell a rare at the Grand Exchange once their owner left (TripTeam). */
const trips = new Set();
/**
 * Four bots (kofi): the drops are free for all - each keeps its own. Said once at the start, and to a rare;
 * a lone or duo bot's rare is sold at the Grand Exchange and split with the owner instead (SALE_LINES).
 */
const FFA_LINES = {
  start: ["drops are ffa btw, keep what you get", "ffa loot this trip, everyone keeps their own", "loot's ffa, no splits",
    "just so we're clear, drops are ffa", "ffa drops, good luck all", "keep your own loot, it's ffa"],
  agree: ["ffa works for me", "yep ffa", "sounds good", "ffa it is", "fair enough", "deal"],
  rare: ["ffa, it's all yours", "ffa, enjoy it", "gz, ffa so that's yours", "all yours, ffa rules", "keep it, ffa"],
};
const SALE_LINES = {
  self: ["i'll sell it at the ge after and we split it {ways} ways", "splitting this {ways} ways at the ge later",
    "we're splitting this, i'll sell it at the ge when we're done", "this gets split {ways} ways, i'll pm you from the ge"],
};

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
/** With Nex due within this many ticks, a bot at the bank skips the banker and heads straight back. */
const SPAWN_MARGIN = 20;
const randomBetween = ([min, max]) => min + Math.random() * (max - min);
const chance = (p) => Math.random() < p;
const chebyshev = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
const alive = (player) => player?.isRegistered?.() && player.getHitpoints() > 0;

function maybeSay(player, lines, p = 0.35) {
  if (!chance(p)) return;
  say(player, Common.pick(lines));
}

/** Said as a player says it (Kit.BossBots), and kept in the bot log so a fight's chat can be checked. */
function say(player, text) {
  note(`  CHAT ${player.getUsername()}: ${Kit.speak(player, text)}`);
}

// ------------------------------------------------------------------ kit

function item(name) {
  const id = core.ItemIdentifiers[name];
  if (!Number.isInteger(id)) throw new Error(`[nex bots] no item ${name}`);
  return id;
}

/** Every dose of a potion, highest first: SARADOMIN_BREW -> its (4) to (1) ids. */
function doses(prefix) {
  return [4, 3, 2, 1].map((dose) => core.ItemIdentifiers[`${prefix}_${dose}_`]).filter(Number.isInteger);
}

const KITS = {
  melee: {
    equipment: {
      HEAD_SLOT: "TORVA_FULL_HELM", BODY_SLOT: "TORVA_PLATEBODY", LEG_SLOT: "TORVA_PLATELEGS", CAPE_SLOT: "INFERNAL_MAX_CAPE_2",
      AMULET_SLOT: "AMULET_OF_RANCOUR", WEAPON_SLOT: "OSMUMTENS_FANG", SHIELD_SLOT: "AVERNIC_DEFENDER",
      HANDS_SLOT: "FEROCIOUS_GLOVES", FEET_SLOT: "AVERNIC_TREADS_MAX_", RING_SLOT: "ULTOR_RING",
      // Worn already, for the ranged switch's bow: no inventory slot spent on them.
      AMMUNITION_SLOT: ["DRAGON_ARROW", 1000],
    },
    // A full maxed ranged switch for the shadow phase and Deflect Melee, one slot left free for the
    // defender when the two-handed bow goes on. (The 5-tick stall saves supplies.)
    // A surge potion and an anti-venom+ in two brews' places: special energy back for more specs (surge),
    // and Fumus's poison cured on the spot (antipoison).
    inventory: [["SUPER_COMBAT_POTION_4_", 1], ["RANGING_POTION_4_", 1], ["SUPER_RESTORE_4_", 5], ["SARADOMIN_BREW_4_", 6], ["SURGE_POTION_4_", 1], ["ANTI_VENOM_4__3", 1],
      ["DRAGON_CLAWS", 1], ["VOIDWAKER", 1], ["RUNE_POUCH", 1], ["BOOK_OF_THE_DEAD", 1], ["TWISTED_BOW", 1],
      ["MASORI_MASK_F_", 1], ["MASORI_BODY_F_", 1], ["MASORI_CHAPS_F_", 1], ["DIZANAS_MAX_CAPE", 1], ["NECKLACE_OF_RUPTURE", 1],
      ["ZARYTE_VAMBRACES", 1], ["VENATOR_RING", 1]],
    boost: "SUPER_COMBAT_POTION",
    prayer: "ZEAL",
    thrall: "resurrect greater skeleton",
  },
  ranged: {
    equipment: {
      HEAD_SLOT: "MASORI_MASK_F_", BODY_SLOT: "MASORI_BODY_F_", LEG_SLOT: "MASORI_CHAPS_F_", CAPE_SLOT: "DIZANAS_MAX_CAPE",
      AMULET_SLOT: "NECKLACE_OF_RUPTURE", WEAPON_SLOT: "TWISTED_BOW", AMMUNITION_SLOT: ["DRAGON_ARROW", 2000],
      HANDS_SLOT: "ZARYTE_VAMBRACES", FEET_SLOT: "AVERNIC_TREADS_MAX_", RING_SLOT: "VENATOR_RING",
    },
    // The ruby bolts are in the quiver (QUIVER_AMMO), not here: their slot is an eleventh brew.
    inventory: [["ZARYTE_CROSSBOW", 1], ["TWISTED_BUCKLER", 1], ["RANGING_POTION_4_", 2],
      ["SUPER_RESTORE_4_", 8], ["SARADOMIN_BREW_4_", 9], ["SURGE_POTION_4_", 1], ["ANTI_VENOM_4__3", 1], ["ANGLERFISH", 2], ["BOOK_OF_THE_DEAD", 1], ["RUNE_POUCH", 1],
      // A stab weapon for breaking a teammate out of an Ice Prison (a two-handed bow can't).
      ["OSMUMTENS_FANG", 1]],
    boost: "RANGING_POTION",
    prayer: "RIGOUR",
    thrall: "resurrect greater ghost",
  },
};

/** What a melee bot puts on for the shadow phase, the bow first (it takes the fang and defender off). */
const RANGED_SWITCH = ["TWISTED_BOW", "DRAGON_ARROW", "MASORI_MASK_F_", "MASORI_BODY_F_", "MASORI_CHAPS_F_",
  "DIZANAS_MAX_CAPE", "NECKLACE_OF_RUPTURE", "ZARYTE_VAMBRACES", "VENATOR_RING"];
/** ...and back after Umbra: the fang first, then the defender into the hand the bow freed. */
const MELEE_SWITCH = ["OSMUMTENS_FANG", "AVERNIC_DEFENDER", "TORVA_FULL_HELM", "TORVA_PLATEBODY", "TORVA_PLATELEGS",
  "INFERNAL_MAX_CAPE_2", "AMULET_OF_RANCOUR", "FEROCIOUS_GLOVES", "ULTOR_RING"];
// In the ice phase everyone stays high: the prison shatters for up to 75 and Containment hits 60.
const ICE_EAT_AT = 0.8;
const COMBAT_SKILLS = ["ATTACK", "STRENGTH", "DEFENCE", "HITPOINTS", "RANGED", "PRAYER", "MAGIC"];
/** Level 99's experience; 99 in every combat skill is combat level 126. */
const LEVEL_99_EXPERIENCE = 13034431;

/** 99 in everything: the max capes they swap back to need every skill at 99 to be worn. */
function maxStats(player) {
  const skills = player.getSkillManager();
  for (const skill of core.Skill.values()) {
    skills.setMaxLevels(skill, 99, false);
    skills.setExperiences(skill, LEVEL_99_EXPERIENCE, false);
    skills.setCurrentLevel(skill, 99, false);
  }
  player.setSpecialPercentage(100);
  player.setAttribute(RIGOUR_UNLOCKED_ATTRIBUTE, true);
  player.setAttribute(ZEAL_UNLOCKED_ATTRIBUTE, true);
}

/**
 * The lone bot's inventory: the melee kit with the Zaryte crossbow and ruby bolts in the claws' place -
 * its ruby bolt special is the most damage a lone bot can do while she's high.
 */
/**
 * The duo melee bot's and the lone bot's inventory: the melee kit with the Zaryte crossbow (their one
 * special: ruby bolts on Nex) in the claws' place and the blowpipe (for her mages) in Voidwaker's.
 * The lone bot wears the Lightbearer, so no Venator ring: an extra brew instead.
 */
function pickerInventory(solo) {
  return KITS.melee.inventory.flatMap((entry) => {
    if (entry[0] === "DRAGON_CLAWS") return [["ZARYTE_CROSSBOW", 1]];
    if (entry[0] === "VOIDWAKER") return [["TOXIC_BLOWPIPE", 1]];
    if (solo && entry[0] === "VENATOR_RING") return [];
    if (solo && entry[0] === "SARADOMIN_BREW_4_") return [["SARADOMIN_BREW_4_", entry[1] + 1]];
    return [entry];
  });
}
/**
 * The duo's first bot (its "melee" seat): a ranger from the start, as it went to range the moment the
 * fight began (kofi's call). The ranger's gear worn, its melee kit swapped for brews and restores; the
 * fang stays for breaking an ice prison, the blowpipe for her mages. It still plays the melee seat:
 * beside the mages, on its side of her, stalling and walking her home (rangedOnly).
 */
const DUO_FIRST_INVENTORY = [["ZARYTE_CROSSBOW", 1], ["TWISTED_BUCKLER", 1], ["TOXIC_BLOWPIPE", 1], ["OSMUMTENS_FANG", 1],
  ["RANGING_POTION_4_", 2], ["SUPER_RESTORE_4_", 7], ["SARADOMIN_BREW_4_", 11], ["SURGE_POTION_4_", 1], ["ANTI_VENOM_4__3", 1],
  ["BOOK_OF_THE_DEAD", 1], ["RUNE_POUCH", 1]];

/** The duo's first bot: the melee seat, played on range (DUO_FIRST_INVENTORY). */
function rangedOnly(role, team) {
  return role === "melee" && team === "duo";
}

/** The lone bot's ring: the Lightbearer, special energy back twice as fast (Wiki) for more ruby bolts. */
const SOLO_RING = "LIGHTBEARER";

/**
 * The quiver's ammo (DizanasQuiver: a second ammo slot, worn or carried; the weapon fires the ammo
 * slot's if it can, otherwise the quiver's): ruby dragon bolts (e) for whoever carries the Zaryte
 * crossbow, so the crossbow fires them while the bow's dragon arrows stay worn.
 */
const QUIVER_ATTRIBUTE = "dizanas-quiver";
const QUIVER_AMMO = ["RUBY_DRAGON_BOLTS_E_", 300];

function stock(player, role, solo = false, team = solo ? "solo" : "four") {
  player.setAttribute(RUNE_POUCH_ATTRIBUTE, [...POUCH_RUNES.map(([name, amount]) => [item(name), amount]), null]);
  // The picking bots (a duo's melee bot, the lone bot) carry the crossbow and the blowpipe too.
  const picker = role === "melee" && team !== "four";
  const crossbow = role === "ranged" || picker;
  player.setAttribute(QUIVER_ATTRIBUTE, crossbow ? { id: item(QUIVER_AMMO[0]), amount: QUIVER_AMMO[1] } : null);
  const inventory = player.getInventory();
  inventory.resetItems();
  const kit = rangedOnly(role, team) ? DUO_FIRST_INVENTORY : picker ? pickerInventory(solo) : KITS[role].inventory;
  for (const [name, amount, stack] of kit) {
    if (stack) {
      inventory.add(new core.Item(item(name), amount), false);
      continue;
    }
    for (let i = 0; i < amount; i++) {
      // Full charges on everything (Kit.charge): the blowpipe full of dragon darts and scales.
      inventory.add(Kit.charge(name, new core.Item(item(name), 1)), false);
    }
  }
  inventory.refreshItems();
}

function equip(player, role, solo = false, team = solo ? "solo" : "four") {
  const equipment = player.getEquipment();
  equipment.resetItems();
  // The duo's first bot wears the ranger's gear from the start (rangedOnly).
  const worn = rangedOnly(role, team) ? KITS.ranged.equipment : KITS[role].equipment;
  for (const [slot, entry] of Object.entries(worn)) {
    const [name, amount] = solo && slot === "RING_SLOT" ? [SOLO_RING, 1] : Array.isArray(entry) ? entry : [entry, 1];
    equipment.getItems()[core.Equipment[slot]] = Kit.charge(name, new core.Item(item(name), amount));
  }
  equipment.refreshItems();
  core.WeaponInterfaceManager.assign(player);
  core.BonusManager.update(player);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

// ------------------------------------------------------------------ a teammate

class NexBot {
  constructor(team, player, role, slot, index) {
    // Its personality in chat (PERSONAS), fixed by its name so the same name is always the same person.
    this.persona = personaOf(player.getUsername());
    this.scammer = BOT_PERSONAS[player.getUsername()] === "scammer";
    this.team = team;
    this.player = player;
    this.role = role;
    // The duo's first bot: the melee seat, always on range (rangedOnly).
    this.rangedOnly = rangedOnly(role, team.size);
    // What it fights with right now: a melee bot is a ranger through the shadow phase.
    this.style = this.rangedOnly ? "ranged" : role;
    this.slot = slot;
    this.index = index;
    this.styleChangeAt = null;
    this.entered = false;
    this.reaction = randomInt(REACTION_TICKS[0], REACTION_TICKS[1]);
    this.eatAt = randomBetween(EAT_AT);
    this.prayerAt = randomInt(PRAYER_AT[0], PRAYER_AT[1]);
    this.seenCues = 0;
    this.pending = [];
    this.plan = null;
    this.spot = null;
    this.nextWalk = 0;
    this.nextConsume = 0;
    this.nextPrayer = 0;
    this.nextSpecCheck = 0;
    this.nextBreak = 0;
    this.brewsSinceRestore = 0;
    this.boostedAt = -Infinity;
    this.swap = null;
    this.lastFight = null;
    this.tick = 0;
    // On arrival each takes its own moment to look around before heading for its spot.
    this.moveAfter = randomInt(1, 4) + index * randomInt(1, 3);
  }

  get instance() {
    return this.team.instance;
  }

  // ---------------------------------------------------------------- each tick

  process() {
    this.tick++;
    const { player } = this;
    if (!alive(player) || !this.entered || !this.instance.players.has(player)) return;
    const fight = this.instance.fight;
    if (fight !== this.lastFight) this.newFight(fight);
    this.consume(fight);
    if (fight && fight.stage === "fighting") this.antipoison();
    if (!fight || fight.stopped || fight.stage === "ended") {
      this.idle();
      return;
    }
    this.readCues(fight);
    if (fight.stage === "dying") {
      this.setPrayers(fight, null);
      this.keepAway(fight, WRATH_DISTANCE);
      return;
    }
    if (fight.stage === "spawning") {
      // Pot up while she calls her mages, as everyone does: the boost is fresh for her first attack.
      if (fight.tick >= 3 + this.index && this.tick - this.boostedAt > 50 && this.tick >= this.nextConsume) {
        if (this.use(doses(KITS[this.style].boost))) {
          this.boostedAt = this.tick;
          think(this, "Nex is spawning - potting up at my station");
        }
      }
      if (fight.tick >= Common.data.spawn.fillTick - this.reaction) this.setPrayers(fight, "magic");
      this.goToStation();
      return;
    }
    this.setPrayers(fight, this.protection(fight));
    // A teammate in an ice prison comes first (it shatters in 8 ticks): no spec swap, stall or anything
    // else holds the rescue up (kofi: the rescuer drank, started a spec, and the ice shattered on him).
    if (this.isRescuer(fight)) {
      if (this.swap) {
        if (this.player.isSpecialActivated()) core.CombatSpecial.activate(this.player);
        this.swap = null;
      }
      if (this.breakIce(fight)) return;
    }
    if (this.swapping(fight)) return;
    this.stallResult(fight);
    this.iceCheck(fight);
    if (this.followPlan(fight)) return;
    if (this.inPrison(fight)) return;
    // A gear swap and a stall can share a tick (the swap is instant): don't miss her swing for it.
    const swapped = this.switchStyle(fight);
    if (swapped) {
      this.stall(fight);
      return;
    }
    if (this.pushToMiddle(fight)) return;
    if (this.stall(fight)) return;
    if (this.breakIce(fight)) return;
    this.fight(fight);
    this.special(fight);
    this.surge(fight);
    this.thrall(fight);
  }

  newFight(fight) {
    // A fresh count of misses each kill (it was carrying over and skewing the first spec to Voidwaker).
    this.misses = 0;
    this.rangedUntil = 0;
    this.icePending = null;
    this.stallTick = null;
    this.stalls = 0;
    this.stallHits = 0;
    // The lone bot's style comparison starts over each kill (dpsChoice).
    this.dps = null;
    this.wdps = null;
    this.mdps = null;
    this.lastFight = fight;
    this.seenCues = 0;
    this.pending = [];
    this.plan = null;
    this.spot = null;
    if (fight) maybeSay(this.player, CHATTER.start, 0.2);
  }

  /** Between kills: prayers off, then (after a kill) the bank trip; otherwise a stroll. */
  idle() {
    const { player } = this;
    // Kill over: a sip of its anti-venom+, so Fumus's poison can't finish off a bot walking out on low
    // hp (cured outright if it has none left).
    if (player.isPoisoned?.() && !this.antipoison()) {
      player.setPoisonDamage(0);
      think(this, "kill's over - out of anti-venom, curing the poison");
    }
    const combat = player.getCombat();
    if (combat.getTarget?.()) combat.reset();
    core.PrayerHandler.deactivatePrayers(player);
    if (this.loot && this.tripAt != null && this.tick >= this.tripAt - RESTOCK_AFTER_KILL_TICKS + 2) {
      this.pickUp();
      return;
    }
    if (this.team.celebrate && this.team.tick < this.team.celebrate.until) {
      this.cheer();
      return;
    }
    if (this.tripAt != null && this.tick >= this.tripAt) {
      this.tripAt = null;
      this.goBank("kill");
      return;
    }
    this.goToStation();
  }

  /**
   * Where this bot waits for her, by her spawn tile: the melee on her west and east sides, the
   * rangers 7 tiles south and north. Everyone is in place before her first attack.
   */
  station() {
    if (this.stationTile) return this.stationTile;
    const [x, y, z] = Common.data.chamber.nexTile;
    const offsets = this.role === "melee" ? [[-1, 1], [3, 1]] : [[1, -6], [1, 8]];
    // A duo's ranger waits where the second melee bot would: beside her east side as she spawns.
    const [dx, dy] = this.team.size === "duo" && this.role === "ranged" ? [3, 1] : offsets[this.slot % 2];
    const wanted = this.instance.tile([x + dx, y + dy, z]);
    this.stationTile = this.walkable(wanted) ? wanted : this.nearestTile(wanted, () => true, 3) ?? wanted;
    return this.stationTile;
  }

  goToStation() {
    if (this.tick < this.moveAfter) return;
    // Rangers come in through the middle (past her west side) before splitting to their spots,
    // not round the outside of the pools.
    if (this.role === "ranged" && !this.throughMiddle) {
      const [x, y, z] = Common.data.chamber.nexTile;
      const middle = this.instance.tile([x - 2, y + (this.slot % 2 === 0 ? 0 : 2), z]);
      if (chebyshev(this.player.getLocation(), middle) > 1) {
        this.walk(middle);
        return;
      }
      this.throughMiddle = true;
      this.nextWalk = 0;
    }
    const tile = this.station();
    if (this.player.getLocation().equals(tile)) return;
    this.walk(tile);
  }

  // ---------------------------------------------------------------- what they see

  readCues(fight) {
    // By number (Fight.cue), never by position: the list only keeps the last 16.
    for (const cue of fight.cues) {
      if (cue.seq <= this.seenCues) continue;
      this.seenCues = cue.seq;
      // A cue older than this bot's view of the fight (a bot that ran in late) is history.
      if (fight.tick - cue.tick > 8) continue;
      const dodge = ["dash", "smash", "containment", "sacrifice"].includes(cue.name);
      if (dodge && chance(FUMBLE_CHANCE)) {
        think(this, `FUMBLED - didn't react to her ${cue.name} (a human mistake, 1 in 20)`);
        continue;
      }
      // A bot's own sacrifice mark is too loud to miss, and faster: it has six ticks.
      // The shadow under them erupts 4 ticks in: anyone half-awake has stepped off by then.
      const late = cue.name === "sacrifice" && cue.marked === this.player ? Math.min(this.reaction, 2)
          : cue.name === "smash" ? Math.min(this.reaction, 2)
            // Containment closes 5 ticks in: anyone beside her is already watching for it.
            : cue.name === "containment" ? Math.min(this.reaction, 1) : this.reaction;
      const hesitate = cue.name === "smash" ? 0 : (chance(0.2) ? 1 : 0);
      this.pending.push({ cue, at: cue.tick + late + hesitate });
    }
    const due = this.pending.filter((entry) => fight.tick >= entry.at);
    this.pending = this.pending.filter((entry) => fight.tick < entry.at);
    for (const { cue } of due) this.react(fight, cue);
  }

  react(fight, cue) {
    const { player } = this;
    const me = player.getLocation();
    switch (cue.name) {
      case "dash": {
        if (!this.inZone(me, cue.zone)) return;
        const tile = this.nearestTile(me, (tile) => !this.inZone(tile, cue.zone, 1), 4);
        if (tile) this.setPlan(tile, cue.tick + 10);
        think(this, tile ? "in her dash lane - stepping out of it" : "in her dash lane - no room to step out!");
        return;
      }
      case "smash": {
        const shadows = cue.tiles ?? [];
        // Everyone's shadows, kept off by the whole team until they erupt (walkable).
        this.team.shadows = { tiles: shadows, until: cue.tick + Common.data.specials.smash.eruptTicks + 1 };
        if (!shadows.some((tile) => tile.equals(me))) return;
        const safe = (tile) => !shadows.some((shadow) => shadow.equals(tile));
        const near = this.style === "melee"
          ? this.nearestTile(me, (tile) => safe(tile) && this.meleeSpot(fight, tile), 3)
          : null;
        const tile = near ?? this.nearestTile(me, safe, 2);
        if (tile) this.setPlan(tile, cue.tick + 6);
        think(this, tile ? "standing on a smash shadow - moving off it" : "on a smash shadow with nowhere to go!");
        return;
      }
      case "darkness":
        this.darkUntil = fight.tick + Common.data.specials.darkness.ticks;
        think(this, this.style === "melee" ? "darkness - can't see well, holding off melee unless something's in reach" : "darkness - keep shooting from range, protect from missiles");
        return;
      case "siphon":
        // Not when the reavers are already gone (Cruor's death took them as they rose): no call to make.
        if (!fight.reavers.some(alive) || fight.phase().key !== "blood") return;
        maybeSay(player, CHATTER.siphon, 0.25);
        think(this, "blood siphon - stop hitting Nex, kill the reavers");
        return;
      case "sacrifice": {
        if (cue.marked === player && this.pushing) {
          // Walking her home: it keeps her going to the middle and takes the sacrifice rather than
          // leave her off-centre (server custom: kofi's call).
          think(this, "marked for blood sacrifice while walking her home - keeping her going to the middle");
        } else if (cue.marked === player) {
          maybeSay(player, CHATTER.sacrifice, 0.3);
          const tile = this.awayFrom(fight, SACRIFICE_DISTANCE);
          if (tile) this.setPlan(tile, cue.tick + Common.data.specials.sacrifice.resolveTicks + 2, { run: true });
          think(this, "I'm marked for blood sacrifice - running away from everyone");
        } else if (alive(cue.marked) && chebyshev(cue.marked.getLocation(), me) <= 2) {
          const marked = cue.marked.getLocation();
          const tile = this.nearestTile(me, (tile) => chebyshev(tile, marked) >= 3, 4);
          if (tile) this.setPlan(tile, cue.tick + Common.data.specials.sacrifice.resolveTicks + 1);
          think(this, `${cue.marked.getUsername()} is marked and next to me - backing off`);
        }
        return;
      }
      case "containment": {
        if (fight.distanceTo(player) > 1) return;
        const { placeTicks, clearTicks } = Common.data.specials.containment;
        // Straight out from where it stands (the nearest tile 2+ from her body), never round her.
        const tile = this.awayFrom(fight, 2);
        if (tile) this.setPlan(tile, cue.tick + placeTicks + 1, { run: true });
        // The icicles keep melee off her until they melt: shoot her from out here meanwhile. The swap
        // happens as it runs out (gear swaps don't stop a run), so it's shooting the moment it's clear.
        // Decided once it's out (iceCheck): a moment after it's clear it swaps; caught, it stays melee.
        if (this.role === "melee") this.icePending = { placedAt: cue.tick + placeTicks, until: cue.tick + placeTicks + clearTicks, clearAt: null };
        think(this, "containment - stepping 2+ tiles away from her body");
        return;
      }
      case "prison":
        // Trapped, a bot waits for a melee teammate to break the ice (breakIce).
        if (cue.target === player) {
          maybeSay(player, CHATTER.prison, 0.3);
          think(this, "stuck in ice prison - waiting for a teammate to break me out");
        }
        return;
      case "wrath":
        maybeSay(player, CHATTER.kill, 0.6);
        // Out to the bank once she's gone and the loot's down, each in their own time.
        this.tripAt = this.tick + RESTOCK_AFTER_KILL_TICKS + randomInt(0, 6);
        return;
      default:
    }
  }

  // ---------------------------------------------------------------- moving

  /** Somewhere to be until `until` (a fight tick): no attacking meanwhile. */
  setPlan(tile, until, options = {}) {
    this.plan = { tile, until, ...options };
    this.player.getCombat().reset();
    this.walk(tile, true);
  }

  followPlan(fight) {
    const plan = this.plan;
    if (!plan) return false;
    if (fight.tick >= plan.until) {
      this.plan = null;
      this.spot = null;
      return false;
    }
    // Re-planned only once it has stopped short: a fresh route every couple of ticks made it stutter.
    if (!this.player.getLocation().equals(plan.tile) && !this.player.getMovementQueue().isMovings()) this.walk(plan.tile, true);
    return true;
  }

  walk(tile, now = false) {
    const { player } = this;
    if (!now && this.tick < this.nextWalk) return;
    this.nextWalk = this.tick + WALK_EVERY_TICKS;
    player.setRunning(true);
    core.PathFinder.calculateWalkRoute(player, tile.getX(), tile.getY());
  }

  walkable(tile) {
    return this.instance.inChamber(tile) && !core.RegionManager.blocked(tile, this.instance.area) && !this.onShadow(tile);
  }

  /** A Shadow Smash shadow not yet erupted (anyone's): no bot picks it to stand on or walk to. */
  onShadow(tile) {
    const shadows = this.team.shadows;
    const fight = this.instance.fight;
    if (!shadows || !fight || fight.tick > shadows.until) return false;
    return shadows.tiles.some((shadow) => shadow.equals(tile));
  }

  bodyDistance(fight, tile) {
    return Common.distanceToBody(tile, fight.boss.getLocation(), 3);
  }

  inZone(tile, zone, margin = 0) {
    const [x, y] = this.instance.real(tile);
    return x >= zone.minX - margin && x <= zone.maxX + margin && y >= zone.minY - margin && y <= zone.maxY + margin;
  }

  /** The nearest walkable tile within `radius` that `ok` accepts, fewest steps first. */
  nearestTile(from, ok, radius) {
    let best = null;
    let bestDistance = Infinity;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const tile = from.transform(dx, dy);
        if (!this.walkable(tile) || !ok(tile)) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy)) + (Math.abs(dx) + Math.abs(dy)) * 0.01;
        if (distance < bestDistance) {
          best = tile;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /** A tile at least `distance` from her body, nearest first (a sacrifice run, Wrath). */
  awayFrom(fight, distance) {
    const me = this.player.getLocation();
    for (let radius = 1; radius <= 14; radius++) {
      const tile = this.nearestTile(me, (tile) => this.bodyDistance(fight, tile) >= distance, radius);
      if (tile) return tile;
    }
    return null;
  }

  keepAway(fight, distance) {
    const { player } = this;
    if (player.getCombat().getTarget?.()) player.getCombat().clearInteraction();
    if (this.bodyDistance(fight, player.getLocation()) >= distance) return;
    if (player.getMovementQueue().isMovings()) return;
    const tile = this.awayFrom(fight, distance);
    if (tile) this.walk(tile, true);
  }

  /** A side tile next to her body (her melee and ours both reach it), not a corner. */
  meleeSpot(fight, tile) {
    return this.sideOf(fight, tile) != null;
  }

  /** Which side of her body a tile is on (west, east, south, north), or null if not beside a side. */
  sideOf(fight, tile) {
    const base = fight.boss.getLocation();
    if (Common.distanceToBody(tile, base, 3) !== 1) return null;
    const alongX = tile.getX() >= base.getX() && tile.getX() < base.getX() + 3;
    const alongY = tile.getY() >= base.getY() && tile.getY() < base.getY() + 3;
    if (alongY) return tile.getX() < base.getX() ? "west" : "east";
    if (alongX) return tile.getY() < base.getY() ? "south" : "north";
    return null;
  }

  /**
   * Each melee bot keeps to its own two sides, so one ice prison can never take both. In the Zaros
   * phase the whole team rings her, one side each: the melee west and east, the rangers south and north.
   */
  ownSide(fight, tile) {
    const side = this.sideOf(fight, tile);
    if (side == null) return false;
    if (fight.phase().key === "zaros") return side === (this.role === "melee" ? ["west", "east"] : ["south", "north"])[this.slot % 2];
    // A duo's ranger takes the second melee bot's sides (east, north), the melee bot keeping west and south.
    const slot = this.team.size === "duo" && this.role === "ranged" ? 1 : this.slot;
    return (slot === 0 ? ["west", "south"] : ["east", "north"]).includes(side);
  }

  others() {
    return this.instance.present().filter((other) => other !== this.player);
  }

  crowded(tile, gap = 1) {
    return this.others().some((other) => chebyshev(other.getLocation(), tile) <= gap);
  }

  /** Anyone coughing, or marked for a sacrifice, is given room. */
  hazards(fight) {
    const virus = fight.effects?.virus;
    return this.others().filter((other) => virus?.has(other));
  }

  // ---------------------------------------------------------------- fighting

  /**
   * The team spreads over the reavers, two to each: it keeps the one it's on while no more than one
   * teammate shares it, otherwise takes the one with the fewest teammates on it, the nearest of those.
   */
  pickReaver(reavers) {
    const { player } = this;
    const on = (reaver) => this.team.bots.filter((bot) => bot !== this && bot.reaver === reaver).length;
    if (this.reaver && reavers.includes(this.reaver) && on(this.reaver) < REAVER_SHARE) return this.reaver;
    const near = (reaver) => chebyshev(reaver.getLocation(), player.getLocation());
    const pick = reavers.reduce((best, reaver) => {
      const [a, b] = [on(reaver), on(best)];
      return a < b || (a === b && near(reaver) < near(best)) ? reaver : best;
    });
    if (pick !== this.reaver) think(this, `onto a reaver with ${on(pick)} teammate${on(pick) === 1 ? "" : "s"} on it`);
    this.reaver = pick;
    return pick;
  }

  target(fight) {
    const { player } = this;
    const reavers = fight.reavers.filter(alive);
    const siphoning = fight.tick < fight.siphonUntil + 2;
    // Reavers alive when Cruor dies heal her their hitpoints (Wiki): clear them before he goes.
    const cruor = fight.mages.get("cruor");
    const cruorCalled = fight.vulnerable.has("cruor") && alive(cruor);
    // With Cruor called, the rangers take the reavers and the melee stay on him - but hold off a
    // nearly dead Cruor while reavers live, or his death heals her their hitpoints.
    // The lone bot stays on Cruor once he can be hit and lets every reaver be, even through a Blood
    // Siphon (server custom: kofi's call for the solo).
    if (cruorCalled && this.team.solo) {
      this.reaver = null;
      return cruor;
    }
    const rangerHere = this.team.bots.some((bot) => bot.role === "ranged" && alive(bot.player) && !bot.away);
    if (cruorCalled && reavers.length > 0 && this.style === "melee" && rangerHere) {
      this.reaver = null;
      return cruor.getHitpoints() > CRUOR_HOLD_HITPOINTS ? cruor : null;
    }
    if (reavers.length > 0 && (siphoning || cruorCalled || player.getHitpoints() < player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) * 0.7)) {
      return this.pickReaver(reavers);
    }
    this.reaver = null;
    if (siphoning) return null;
    const phase = fight.phase();
    const mage = phase.mage ? fight.mages.get(phase.mage) : null;
    if (mage && fight.vulnerable.has(phase.mage) && alive(mage)) return mage;
    if (this.style === "melee") {
      if (fight.form() === Common.data.npcs.deflect) return null;
      if (fight.tick < (this.darkUntil ?? 0) && fight.effects?.darkness) return null;
    }
    // At the phase's floor she takes nothing until the mage dies: wait for the call.
    if (phase.mage && fight.boss.getHitpoints() <= Math.floor(Common.data.fight.hitpoints * phase.floor)) return null;
    return fight.boss;
  }

  fight(fight) {
    const { player } = this;
    const combat = player.getCombat();
    if (this.style === "melee") this.defenderOn();
    if (this.weaponChoice(fight)) return;
    if (this.besideMage(fight)) return;
    const target = this.target(fight);
    const nex = target === fight.boss;
    // Out of the darkness - unless there's a mage or a reaver to go and hit instead.
    if (this.style === "melee" && !target && fight.tick < (this.darkUntil ?? 0) && fight.effects?.darkness) {
      this.keepAway(fight, DARKNESS_DISTANCE);
      return;
    }
    if (this.style === "melee" && !target) {
      // Holding hits (Deflect, a floor): stay close, off her corners.
      if (combat.getTarget?.()) combat.reset();
      return;
    }
    if (nex && this.style === "ranged" && this.crowded(player.getLocation(), 0)) this.spot = null;
    const holding = this.role === "melee" && fight.tick < (this.rangedUntil ?? 0);
    if (nex && !holding && this.position(fight)) return;
    // A ranger on a reaver (they rise right beside her) keeps out of her melee reach. On a mage it
    // just runs through to it: stepping back from her on the way only sent it back and forth.
    const reaver = fight.reavers.includes(target);
    if (reaver && this.style === "ranged" && !this.staysClose(fight) && fight.boss && this.bodyDistance(fight, player.getLocation()) <= 2) {
      this.keepAway(fight, 4);
      return;
    }
    if (!target) {
      if (combat.getTarget?.()) combat.reset();
      if (this.style === "ranged" && !this.staysClose(fight)) this.holdSpot(fight);
      return;
    }
    // Rangers don't stay stacked on a teammate's tile: a step to a free tile beside it now and then,
    // between shots.
    // Not while both are on a minion: then sharing ground is fine.
    const onMinion = !nex;
    const stacked = onMinion ? this.crowded(player.getLocation(), 0) : this.crowded(player.getLocation(), 1);
    // Not in the Zaros phase, where the rangers ring her beside the melee (position keeps them apart).
    if (this.style === "ranged" && fight.phase().key !== "zaros" && !this.staysClose(fight) && this.tick >= (this.nextUnstack ?? 0) && stacked) {
      this.nextUnstack = this.tick + 5;
      const minDistance = fight.phase().key === "shadow" ? RANGED_BAND.shadow[0] : 3;
      const free = this.nearestTile(player.getLocation(), (tile) => !this.crowded(tile, onMinion ? 0 : 1) && this.bodyDistance(fight, tile) >= minDistance, 3);
      if (free) this.walk(free, true);
    }
    if (combat.getTarget?.() === target) return;
    const permission = core.CombatFactory.canAttackPermission(player, target, false, core.CombatFactory.getMethod(player));
    if (permission !== core.CanAttackResponse.CAN_ATTACK) return;
    combat.attack(target);
  }

  /** Gets into place against Nex; true while walking there (not attacking). */
  position(fight) {
    const { player } = this;
    const me = player.getLocation();
    const hazards = this.hazards(fight);
    const coughing = fight.effects?.virus?.has(player);
    const tooClose = (tile) => (coughing ? this.crowded(tile, 1) : hazards.some((other) => chebyshev(other.getLocation(), tile) <= 1));
    // The Zaros phase: everyone beside her on their own side (ownSide), rangers too - and the lone bot
    // on its bow by choice (dpsChoice), so its 5-tick stalls go on.
    // Never in the shadow phase: that's fought from range.
    const besideHer = this.picksStyle() && fight.phase().key !== "shadow" && this.style === "ranged" && this.dps?.current === "ranged" && this.rangedFor === "more damage on range";
    if (this.style === "melee" || fight.phase().key === "zaros" || besideHer || this.staysClose(fight)) {
      // A shuffle that isn't working (the tile's out of reach) is given up for a while: keep hitting.
      if (this.tick < (this.shuffleOffUntil ?? 0)) return false;
      const blood = fight.phase().key === "blood";
      // Never on someone else's tile (one ice prison would take both), and spread in the blood phase.
      const taken = (tile) => this.others().some((other) => other.getLocation().equals(tile));
      // No touching in the smoke phase either: the cough spreads to anyone beside a coughing player.
      // Nor in the ice phase: a step apart, so one ice prison can never shut in two (kofi: both were
      // caught when one stalled onto the other's tile).
      const spread = blood || fight.phase().key === "smoke" || fight.phase().key === "ice";
      const fine = (tile) => this.ownSide(fight, tile) && !taken(tile) && !tooClose(tile) && !(spread && this.crowded(tile, 1));
      const reachable = this.ownSide(fight, me) && !taken(me);
      if (fine(me) || (reachable && this.shuffles === 0 && !spread && !coughing && !tooClose(me))) {
        this.shuffles = 0;
        return false;
      }
      // In the Zaros phase a ranger may start from its spot 8-10 tiles out: look that far for its side.
      // So may the lone bot on its bow by choice, back from shooting a mage.
      // A small team's bot back from a mage or the shadow phase may be well out too: look far for its side.
      const far = fight.phase().key === "zaros" || besideHer || this.staysClose(fight);
      const tile = this.nearestTile(me, fine, far ? 12 : 6);
      // Only a shuffle beside her that isn't working is given up on, not the run back to her.
      const beside = this.bodyDistance(fight, me) <= 1;
      if (!tile || (beside && (this.shuffles = (this.shuffles ?? 0) + 1) > 6)) {
        this.shuffles = 0;
        this.shuffleOffUntil = this.tick + 15;
        return false;
      }
      // A bow coming back keeps shooting her: it fires each time its attack is ready and runs between.
      // Not a small team's bot (staysClose): it's needed beside her for the stalls, so straight back in
      // (stopping to shoot every few ticks left it standing well out, after Umbra, say).
      const close = this.staysClose(fight);
      if (this.style === "ranged" && !close && !beside && player.getCombat().getAttackDelay() <= 0 && this.bodyDistance(fight, me) <= RANGED_REACH) return false;
      if (!beside && player.getMovementQueue().isMovings() && this.runningBack?.equals?.(tile)) return true;
      this.runningBack = tile;
      player.getCombat().reset();
      this.walk(tile, close && !beside);
      return true;
    }
    // The ice phase keeps the team close: a prison needs a melee teammate there fast.
    const band = RANGED_BAND[fight.phase().key] ?? RANGED_BAND.normal;
    const distance = this.bodyDistance(fight, me);
    const glacies = fight.phase().key === "ice" ? fight.mages.get("glacies") : null;
    const nearGlacies = (tile) => glacies && alive(glacies) && chebyshev(glacies.getLocation(), tile) < GLACIES_AVOID;
    if (distance >= band[0] && distance <= band[1] && !this.crowded(me, 1) && !tooClose(me) && !nearGlacies(me)) {
      this.spot = null;
      return false;
    }
    // Damage first: only a real danger stops the shooting (beside her, out of the bow's reach, by a
    // coughing teammate, Glacies). Otherwise it keeps firing and steps towards its spot now and then.
    // In the shadow phase being close is the danger itself (her shots hit up to ~41 at 4 tiles).
    const shadow = fight.phase().key === "shadow";
    const mustMove = distance <= 2 || distance > RANGED_REACH || (shadow && distance < band[0]) || tooClose(me) || nearGlacies(me);
    if (!mustMove && this.tick < (this.nextDrift ?? 0)) return false;
    // A move that isn't getting anywhere (the spot's out of reach, people in the way): give it up
    // for a while and shoot from here.
    if (this.tick < (this.moveOffUntil ?? 0)) return false;
    const moving = player.getMovementQueue().isMovings();
    if (mustMove) {
      // Stuck means standing still without getting further out, not running round her.
      if (distance > (this.lastMoveDistance ?? -1) || moving) this.moveStuck = 0;
      else if (++this.moveStuck >= 4) {
        this.moveStuck = 0;
        if (shadow) {
          // Never settle near her in the shadow phase: the nearest reachable tile far enough out instead.
          this.spot = this.awayFrom(fight, band[0]);
          if (this.spot) think(this, "can't get to my spot - heading for the nearest safe tile instead");
        } else {
          this.spot = null;
          this.moveOffUntil = this.tick + 10;
          think(this, "can't get to my spot - shooting from here for now");
          return false;
        }
      }
      this.lastMoveDistance = distance;
    }
    if (!this.spot || !this.walkable(this.spot) || me.equals(this.spot)) this.spot = this.rangedSpot(fight, band, nearGlacies, tooClose);
    if (!this.spot) return false;
    if (!mustMove) {
      // One step's worth between shots, then back to attacking.
      this.nextDrift = this.tick + randomInt(4, 6);
      this.walk(this.spot, true);
      return false;
    }
    player.getCombat().clearInteraction(); // Not reset(): that wipes the route too, so it ran in stops and starts.
    // One run all the way: the route is planned again only for a new spot or once it has stopped
    // (re-planning every couple of ticks made it stop and start).
    if (!this.runningTo || !this.runningTo.equals(this.spot) || !moving) {
      this.runningTo = this.spot;
      this.walk(this.spot, true);
    }
    return true;
  }

  /** A spot in the band on this ranger's side of her, clear of teammates (and Glacies). */
  rangedSpot(fight, band, nearGlacies, tooClose) {
    const centre = fight.centre();
    const me = this.player.getLocation();
    // Each teammate has a side of her: west, east, south, north.
    const preferred = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][this.index % 4];
    const upcoming = upcomingMageTile(fight, this.instance);
    let best = null;
    let bestScore = -Infinity;
    for (let radius = band[0] + 1; radius <= band[1] + 1; radius++) {
      for (let step = 0; step < 24; step++) {
        const angle = (step / 24) * Math.PI * 2;
        const tile = centre.transform(Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius));
        if (!this.walkable(tile)) continue;
        const distance = this.bodyDistance(fight, tile);
        if (distance < band[0] || distance > band[1] || nearGlacies(tile) || tooClose(tile)) continue;
        // Teammates' spots count as taken too: two rangers choosing at once used to pick the same tile.
        if (this.team.bots.some((bot) => bot !== this && bot.spot && chebyshev(bot.spot, tile) <= 1)) continue;
        const room = Math.min(6, ...this.others().map((other) => chebyshev(other.getLocation(), tile)));
        const turn = Math.abs(Math.atan2(Math.sin(angle - preferred), Math.cos(angle - preferred)));
        // Ready for the next mage: a spot that already reaches its corner.
        const ready = upcoming && chebyshev(tile, upcoming) <= RANGED_REACH - 1 ? 4 : 0;
        const score = room * 2 - turn * 2 - chebyshev(tile, me) * 0.3 + ready;
        if (score > bestScore) {
          best = tile;
          bestScore = score;
        }
      }
    }
    return best;
  }

  /** Before her first attack, and while there's nothing to hit: rangers wait at range. */
  holdSpot(fight) {
    if (this.style !== "ranged" || !fight.boss) return;
    const me = this.player.getLocation();
    const distance = this.bodyDistance(fight, me);
    if (distance >= RANGED_BAND.normal[0] && distance <= RANGED_BAND.normal[1]) return;
    if (!this.spot) this.spot = this.rangedSpot(fight, RANGED_BAND.normal, () => false, () => false);
    if (this.spot) this.walk(this.spot);
  }

  // ---------------------------------------------------------------- the ice prison

  inPrison(fight) {
    return fight.effects?.prison?.inside?.includes(this.player) === true;
  }

  /** A melee bot with a stab weapon breaks a stalagmite of someone else's prison (Wiki). */
  /**
   * The reset (Wiki: Nex/Strategies), any phase: once she's off the middle and after this bot, it
   * stands under her on the side away from the middle. She steps off it (away from it, so towards
   * the middle), it steps under her again, and she can't attack it there - so after her idle time she
   * flies home. No attacking meanwhile.
   */
  /**
   * After a rush at this bot (any phase), sometimes (TAKE_HIT_CHANCE) it waits for her one melee hit
   * before the reset, shooting meanwhile; true while it waits.
   */
  takeTheHit(fight) {
    const rush = fight.rush ?? this.lastRush;
    // Only her rush (not her walk-in after a flight): then sometimes it takes the hit.
    if (fight.rush && !fight.rush.flight && fight.rush.target === this.player && fight.rush !== this.lastRush) {
      this.lastRush = fight.rush;
      this.lastRushFight = fight;
      this.waitHit = chance(TAKE_HIT_CHANCE) ? { since: fight.rush.startedAt, until: fight.tick + 14 } : null;
      if (this.waitHit) think(this, "she's running at me - I'll take a hit, then walk her back");
    }
    const wait = this.waitHit;
    if (!wait || !rush) return false;
    const hit = fight.lastMelee && fight.lastMelee.target === this.player && fight.lastMelee.tick >= wait.since;
    // Beside it she may shoot her shadow attack instead of the melee hit (it hits hard up close): any
    // attack of hers once she's here ends the wait, as does the rush running out, and it walks her
    // back (it stood there taking shadow shots until it died).
    const attacked = fight.lastAttackTick > wait.since && fight.target === this.player && fight.distanceTo(this.player) <= 1;
    if (hit || attacked || !fight.rush || fight.tick >= wait.until) {
      this.waitHit = null;
      return false;
    }
    const combat = this.player.getCombat();
    if (combat.getTarget?.() !== fight.boss) combat.attack(fight.boss);
    return true;
  }

  /**
   * Poisoned (Fumus's smoke): a dose of its anti-venom+ (Wiki: cures poison and venom at once, then 15
   * minutes' immunity to poison), as a player sips one the moment the green splat shows. True when it
   * drank.
   */
  antipoison() {
    const { player } = this;
    if (!player.isPoisoned?.() && !player.isVenomed?.()) return false;
    if (this.tick < (this.nextConsume ?? 0) || this.specInFlight()) return false;
    if (!this.use(ANTI_VENOM_PLUS.map(item))) return false;
    think(this, "poisoned - sipping my anti-venom+");
    return true;
  }

  /** Onto her centre tile once she's at `base` (her south-west tile), walking: she walks too. */
  walkUnder(base) {
    const movement = this.player.getMovementQueue();
    this.player.setRunning(false);
    movement.reset();
    movement.addSteps(base.transform(1, 1));
  }

  /** Done walking her home: back to running, as it moves everywhere else. */
  stopPushing() {
    this.pushing = false;
    this.player.setRunning(true);
  }

  pushToMiddle(fight) {
    // No target only while a special holds her (Blood Siphon's kneel): the walk is paused, not over,
    // so it carries on after (kofi's call) - leaving it had the walk start again from the beginning.
    if (!fight.target && this.pushing && (fight.tick < fight.busyUntil || fight.tick < fight.siphonUntil)) return false;
    if (fight.target !== this.player) {
      if (this.pushing) think(this, "she switched targets - leaving the reset");
      this.stopPushing();
      return false;
    }
    if (fight.tick < fight.busyUntil || fight.tick < fight.siphonUntil) return false;
    // She's running over to melee it (a rush, any phase): now and then it stands and takes the one
    // hit, still shooting, before getting under her - as players do.
    if (this.takeTheHit(fight)) return true;
    const [hx, hy] = Common.data.chamber.nexTile;
    const home = this.instance.tile([hx, hy, 0]);
    const at = fight.boss.getLocation();
    const offX = at.getX() - home.getX();
    const offY = at.getY() - home.getY();
    const off = Math.max(Math.abs(offX), Math.abs(offY));
    if (off <= 1) {
      if (this.pushing) think(this, "Nex is back in the middle - reset done");
      this.stopPushing();
      return false;
    }
    // Her centre tile (kofi's call): she can't hit it there, and every step she takes off it is a step
    // home (Fight.stepAwayFrom); stepping on she leaves it on her trailing edge, still under her.
    const tile = at.transform(1, 1);
    if (!this.pushing) think(this, `Nex is ${off} tiles off the middle and on me - getting under her to walk her back`);
    this.pushing = true;
    this.player.getCombat().clearInteraction();
    // She moves first; it sees where she went and steps back under her (it ticks before her, so
    // reacting now is a tick late already). Getting in under her it takes 1-2 ticks; once it's walking
    // her (under her already), it keeps up every tick, as she walks a tile a tick - a tick behind and
    // it would be left beside her for her swing.
    const seen = `${at.getX()},${at.getY()}`;
    if (this.pushSeen !== seen) {
      this.pushSeen = seen;
      // Under her last tick (walking her): it follows her step at once - left a random tick behind, she
      // waited for it each step and walked home at half speed. Getting in from outside: 0-1 ticks.
      this.pushReactAt = fight.tick + (fight.distanceTo(this.player) === 0 || this.underLastTick ? 0 : randomInt(0, 1));
    }
    this.underLastTick = fight.distanceTo(this.player) === 0;
    if (!this.player.getLocation().equals(tile) && fight.tick >= this.pushReactAt) {
      // A direct step in (pathfinding treats her tiles as blocked) once it's beside her.
      if (fight.distanceTo(this.player) <= 1) this.walkUnder(at);
      // Running in from further out: one route, kept, planned again only if she's moved or it has
      // stopped (a fresh route every tick reset its run, so getting to her took far too long).
      else if (this.pushRouteTo !== seen || !this.player.getMovementQueue().isMovings()) {
        this.pushRouteTo = seen;
        this.walk(tile, true);
      }
    }
    return true;
  }

  /**
   * The 5-tick stall (Wiki: Nex/Strategies): the melee bot she's meleeing steps one tile under her on
   * the tick before her swing, so she can't hit it then and swings a tick later, then it attacks again.
   * Her 4-tick attacks fall in line with its 5-tick fang. Not in the shadow phase (ranged there).
   */
  /**
   * After dodging Containment: once clear of her (2+ tiles), a tick or two later the melee bot swaps to
   * full range and shoots until the icicles melt. Caught in it instead (beside her when they land),
   * it stays on melee for when they melt.
   */
  iceCheck(fight) {
    const pending = this.icePending;
    if (!pending) return;
    if (fight.tick >= pending.until) {
      this.icePending = null;
      return;
    }
    const clear = fight.distanceTo(this.player) >= 2;
    if (fight.tick >= pending.placedAt && !clear) {
      this.icePending = null;
      think(this, "caught in the icicles - staying on melee");
      return;
    }
    if (!clear) return;
    if (pending.clearAt == null) pending.clearAt = fight.tick + randomInt(1, 2);
    if (fight.tick < pending.clearAt) return;
    this.icePending = null;
    this.rangedUntil = pending.until;
    if (this.style !== "ranged") {
      if (this.player.isSpecialActivated()) core.CombatSpecial.activate(this.player);
      for (const name of RANGED_SWITCH) this.equipFromInventory(name);
      this.style = "ranged";
      this.styleChangeAt = null;
      this.spot = null;
      think(this, "clear of the icicles - switching to full ranged gear");
    }
  }

  /** Whether the last stall delayed her swing; run every tick so a busy tick can't leave it pending. */
  stallResult(fight) {
    if (this.stallTick == null) return;
    // The tick after stepping under: back out to where it stood (a bow could shoot from under her,
    // and staying there makes her step off), attacking from there.
    if (fight.tick === this.stallTick + 1 && this.stallFrom && fight.distanceTo(this.player) === 0) {
      // Never back onto a tile a teammate has stepped onto meanwhile (one ice prison would take
      // both): the nearest free tile beside her instead.
      let back = this.stallFrom;
      if (this.others().some((other) => other.getLocation().equals(back))) {
        back = this.nearestTile(back, (tile) => this.bodyDistance(fight, tile) === 1 && !this.others().some((other) => chebyshev(other.getLocation(), tile) <= 1), 2) ?? back;
      }
      this.player.getMovementQueue().reset();
      this.player.getMovementQueue().addSteps(back);
    }
    if (fight.tick < this.stallTick + 2) return;
    if (fight.tick === this.stallTick + 2) {
      this.stalls = (this.stalls ?? 0) + 1;
      if (fight.nextAttackTick === fight.tick + 1 || fight.nextAttackTick === fight.tick) {
        this.stallHits = (this.stallHits ?? 0) + 1;
        if (this.stallHits === 1 || this.stallHits % 5 === 0) think(this, `5-tick stall worked - her swing was delayed (${this.stallHits}/${this.stalls} this fight)`);
      }
    }
    this.stallTick = null;
  }

  stall(fight) {
    const { player } = this;
    // The rangers too in the Zaros phase, when they're beside her - and in a duo or alone, every bot
    // stalls whenever it's beside her (fewer hands: every swing delayed counts).
    const anyone = fight.phase().key === "zaros" || this.team.size !== "four";
    if ((this.role !== "melee" && !anyone) || fight.target !== player || fight.stage !== "fighting") return false;
    if (fight.phase().key === "shadow") return false;
    // The bots' turn comes before hers in each game tick: her swing "due next tick" by her count is 2
    // ticks off by the count seen here, and stepping then puts it under her as she goes to swing.
    if (this.stallTick != null || fight.nextAttackTick - fight.tick !== 2 || fight.distanceTo(player) !== 1) return false;
    // One tile under her: the edge of her body nearest to it.
    const at = fight.boss.getLocation();
    const me = player.getLocation();
    const clamp = (v, lo) => Math.max(lo, Math.min(lo + 2, v));
    const tile = new core.Location(clamp(me.getX(), at.getX()), clamp(me.getY(), at.getY()), at.getZ());
    this.stallFrom = me.clone();
    player.getCombat().reset();
    // A direct one-tile step (as a click under her): pathfinding treats her tiles as blocked.
    player.getMovementQueue().reset();
    player.getMovementQueue().addSteps(tile);
    this.stallTick = fight.tick;
    this.stallTries = (this.stallTries ?? 0) + 1;
    if (this.stallTries <= 2) think(this, `5-tick stall: stepping under her (her swing due tick ${fight.nextAttackTick}, now ${fight.tick})`);
    return true;
  }

  /** True when a teammate is in an ice prison and this is the bot that should break it (breakIce). */
  isRescuer(fight) {
    const prison = fight?.effects?.prison;
    const stalagmites = (prison?.stalagmites ?? []).filter((object) => object?.getLocation);
    if (!prison || prison.inside.length === 0 || stalagmites.length === 0) return false;
    if (prison.inside.includes(this.player) || !this.canBreakIce()) return false;
    const reach = (bot) => Math.min(...stalagmites.map((object) => chebyshev(object.getLocation(), bot.player.getLocation())));
    const able = this.team.bots.filter((bot) => !bot.away && alive(bot.player) && !prison.inside.includes(bot.player) && bot.canBreakIce());
    if (able.length === 0) return false;
    return able.reduce((best, bot) => (reach(bot) < reach(best) ? bot : best)) === this;
  }

  /** A bot that can break ice: a fang worn, or one in the pack to swap to. */
  canBreakIce() {
    const fang = item("OSMUMTENS_FANG");
    return this.player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getId?.() === fang || this.slotOf([fang]) >= 0;
  }

  /**
   * An Ice Prison: the one bot closest to it that can break ice (melee with their fang, rangers with
   * the fang they carry) goes and breaks it; everyone else keeps fighting. A ranger swaps back to its
   * bow once the prison is gone.
   */
  breakIce(fight) {
    const { player } = this;
    const prison = fight.effects?.prison;
    const stalagmites = (prison?.stalagmites ?? []).filter((object) => object?.getLocation);
    if (!prison || prison.inside.length === 0 || stalagmites.length === 0) {
      if (this.iceSwap) {
        this.iceSwap = false;
        this.equipFromInventory("TWISTED_BOW");
        this.equipFromInventory("DRAGON_ARROW");
        think(this, "prison's gone - back to my bow");
      }
      return false;
    }
    const nearestTo = (location) => stalagmites.reduce((best, object) =>
      (chebyshev(object.getLocation(), location) < chebyshev(best.getLocation(), location) ? object : best));
    const reach = (bot) => chebyshev(nearestTo(bot.player.getLocation()).getLocation(), bot.player.getLocation());
    const able = this.team.bots.filter((bot) => !bot.away && alive(bot.player) && !prison.inside.includes(bot.player) && bot.canBreakIce());
    if (able.length === 0) return false;
    const rescuer = able.reduce((best, bot) => (reach(bot) < reach(best) ? bot : best));
    if (rescuer !== this) return false;
    const me = player.getLocation();
    const nearest = nearestTo(me);
    const at = nearest.getLocation();
    // Remembered from the moment it's picked: if the prison shatters before it gets there, this is
    // the one who says sorry (hitWatch) - it used to be set only once it started walking.
    this.team.rescuer = { bot: this, prison };
    // The fang in hand: a ranger (or a melee bot on its bow) swaps to it first.
    const fang = item("OSMUMTENS_FANG");
    if (player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getId?.() !== fang) {
      if (this.equipFromInventory("OSMUMTENS_FANG")) {
        this.iceSwap = true;
        // The first stab waits for the fang's attack bonus to count: stabbing on the swap's own tick
        // rolled with next to no bonus (a 25% chance) and missed, so freeing them took two goes (kofi).
        // Only when it's already beside the ice: a run there takes those ticks anyway, so no delay then (kofi).
        if (chebyshev(at, me) <= 1) this.nextBreak = Math.max(this.nextBreak ?? 0, this.tick + FANG_SETTLE_TICKS);
        think(this, "closest to the prison - swapping to my fang to break it");
      }
    }
    if (chebyshev(at, me) > 1) {
      // One run all the way there: the spot beside the ice is chosen once, and the route is only
      // planned again if the bot has stopped (re-planning every few ticks made it stop and start).
      if (this.iceTarget?.prison !== prison || this.iceTarget.at !== at) {
        const tile = this.nearestTile(at, (tile) => chebyshev(tile, at) === 1 && !prison.inside.some((p) => p.getLocation().equals(tile)), 1);
        this.iceTarget = { prison, at, tile };
        // Remembered: if the prison shatters on them anyway, this is the one who says sorry (hitWatch).
        this.team.rescuer = { bot: this, prison };
        player.getCombat().reset();
        if (tile) this.walk(tile, true);
      } else if (this.iceTarget.tile && !player.getMovementQueue().isMovings()) {
        this.walk(this.iceTarget.tile, true);
      }
      return true;
    }
    this.iceTarget = null;
    // Looking at the ice it's hitting, every tick it's there (kofi): let go of Nex first, as facing
    // her wins over facing a spot, and force the turn, as the plain one is skipped when it faced
    // this spot before and walking has since turned it away.
    if (player.getInteractingMobile?.()) player.setMobileInteraction(null);
    if (player.forcePositionToFace) player.forcePositionToFace(at);
    else player.setPositionToFace?.(at);
    if (this.tick >= this.nextBreak) {
      if (!this.nextBreak || this.tick - this.nextBreak > 8) think(this, `breaking the ice prison to save ${prison.inside.map((p) => p.getUsername()).join(", ")}`);
      this.nextBreak = this.tick + 4;
      player.getCombat().reset();
      Specials.attackStalagmite({ player, object: nearest });
    }
    return true;
  }

  // ---------------------------------------------------------------- prayers

  protection(fight) {
    const { player } = this;
    // The lone bot out of food: Redemption in place of a protection prayer once it's low (outOfFood).
    if (this.redeeming && player.getHitpoints() < player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) * REDEMPTION_AT) return "redemption";
    if (fight.target === player && Attacks.inMeleeReach(fight, player) && !fight.noMeleeNext) return "melee";
    if (fight.phase().key !== "shadow") return "magic";
    // Shadow phase: her shots barely hurt from 9+ tiles, but a called Umbra casts magic (up to 29).
    const umbra = fight.mages.get("umbra");
    const umbraUp = fight.vulnerable.has("umbra") && alive(umbra);
    return umbraUp && fight.distanceTo(player) >= RANGED_BAND.shadow[0] ? "magic" : "ranged";
  }

  setPrayers(fight, style) {
    const { player } = this;
    const { PrayerHandler } = core;
    if (this.tick < this.nextPrayer) return;
    const want = style === "melee" ? PrayerHandler.PROTECT_FROM_MELEE
      : style === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES
        : style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC
          : style === "redemption" ? PrayerHandler.REDEMPTION : null;
    // A change of mind waits for this bot's reaction time; Zeal/Rigour stay on.
    if (want !== this.wantedPrayer) {
      this.wantedPrayer = want;
      this.prayerChangeAt = this.tick + (want === PrayerHandler.PROTECT_FROM_MELEE || want === PrayerHandler.REDEMPTION ? 0 : randomInt(0, this.reaction));
    }
    if (this.tick < (this.prayerChangeAt ?? 0)) return;
    if (player.getSkillManager().getCurrentLevel(core.Skill.PRAYER) <= 0) return;
    const offensive = PrayerHandler[KITS[this.style].prayer];
    if (style && !PrayerHandler.isActivated(player, offensive)) PrayerHandler.activatePrayerPrayerId(player, offensive);
    if (want == null) {
      for (const prayer of PrayerHandler.PROTECTION_PRAYERS) if (PrayerHandler.isActivated(player, prayer)) PrayerHandler.deactivatePrayer(player, prayer);
      return;
    }
    if (!PrayerHandler.isActivated(player, want)) {
      if (!player.getCombat().getPrayerBlockTimer().finished()) return;
      PrayerHandler.activatePrayerPrayerId(player, want);
      this.nextPrayer = this.tick + 1;
    }
  }

  // ---------------------------------------------------------------- supplies

  slotOf(ids) {
    const items = this.player.getInventory().getItems();
    for (let slot = 0; slot < items.length; slot++) if (ids.includes(items[slot]?.getId?.())) return slot;
    return -1;
  }

  use(ids) {
    const slot = this.slotOf(ids);
    if (slot < 0) return false;
    const id = this.player.getInventory().getItems()[slot].getId();
    core.ItemActionPacketListener.handleAction(this.player, core.Inventory.INTERFACE_ID, id, slot, 1);
    this.nextConsume = this.tick + CONSUME_EVERY_TICKS;
    return true;
  }

  /**
   * The lone bot with no food left (server custom; the duo and four never do this): with restores, it
   * prays Redemption when low (Wiki: under 10% hitpoints it heals a quarter of the Prayer level and
   * drains prayer to 0) and drinks a restore to put it back up; with none, it teleports out. True when
   * it acted this tick.
   */
  outOfFood(fight) {
    if (!this.team.solo || !fight || fight.stage !== "fighting") return false;
    const { player } = this;
    if (this.slotOf(doses("SUPER_RESTORE")) >= 0) {
      if (!this.redeeming) {
        this.redeeming = true;
        think(this, "out of food - praying Redemption when low, restores to put it back up");
      }
      return false;
    }
    if (this.away) return true;
    think(this, "out of food and restores - teleporting out");
    say(player, Common.pick(OUT_OF_SUPPLIES).replace(/\{owner\}/g, this.team.owner?.getUsername?.() ?? "mate"));
    this.redeeming = false;
    this.teleportToBank("supplies");
    return true;
  }

  consume(fight) {
    const { player } = this;
    if (this.swap) return;
    const skills = player.getSkillManager();
    const { Skill } = core;
    const hp = player.getHitpoints();
    const maxHp = skills.getMaxLevel(Skill.HITPOINTS);
    const panic = hp < maxHp * PANIC_AT;
    if (this.tick < this.nextConsume && !panic) return;
    // Nothing drunk with a special in the air (only a panic brew): a sip straight after the shot lost the
    // ruby bolts' guaranteed effect, so the 110 hit came out as a normal one (or a 0).
    if (!panic && this.specInFlight()) return;
    // Racing to break a teammate's ice prison: no sip holds it up unless it's in real danger itself.
    if (!panic && this.isRescuer(fight)) return;
    const eatAt = fight?.phase?.().key === "ice" ? Math.max(this.eatAt, ICE_EAT_AT) : this.eatAt;
    if (hp < maxHp * eatAt || panic) {
      if (this.use(doses("SARADOMIN_BREW"))) {
        this.brewsSinceRestore++;
        think(this, `${panic ? "PANIC " : ""}hp ${hp}/${maxHp} - sipping a brew`);
        return;
      }
      if (this.use([item("ANGLERFISH")])) {
        think(this, `hp ${hp}/${maxHp}, out of brews - eating an anglerfish`);
        return;
      }
      if (this.outOfFood(fight)) return;
    }
    const offence = this.style === "ranged" ? Skill.RANGED : Skill.STRENGTH;
    // Below its own level: a brew's drain, or the smoke phase's cough (it drains the best style's
    // levels and prayer, Specials.Nex) - restored whatever drained it, then a fresh boost.
    const drained = skills.getCurrentLevel(offence) < skills.getMaxLevel(offence) - 6;
    if (skills.getCurrentLevel(Skill.PRAYER) < this.prayerAt || this.brewsSinceRestore >= BREWS_BEFORE_RESTORE || drained) {
      if (this.use(doses("SUPER_RESTORE"))) {
        think(this, drained && this.brewsSinceRestore === 0 ? `stats drained (${skills.getCurrentLevel(offence)}/${skills.getMaxLevel(offence)}) - drinking a restore`
          : `prayer ${skills.getCurrentLevel(Skill.PRAYER)} / stats drained - drinking a restore`);
        if (drained) this.repot = true;
        this.brewsSinceRestore = 0;
        this.prayerAt = randomInt(PRAYER_AT[0], PRAYER_AT[1]);
        return;
      }
    }
    // Never under BOOST_FLOOR in its attack stats (kofi's call): below it - a boost worn down, a cough, a
    // brew - straight back up, whatever took it there; a few levels off above it are left alone.
    const low = (this.style === "ranged" ? [Skill.RANGED] : [Skill.ATTACK, Skill.STRENGTH]).some((skill) => skills.getCurrentLevel(skill) < BOOST_FLOOR);
    if (fight && fight.stage !== "ended" && (low || this.repot)) {
      if (this.use(doses(KITS[this.style].boost))) {
        this.boostedAt = this.tick;
        think(this, fight.stage === "spawning" ? "Nex is spawning - potting up" : this.repot ? "drained - potting back up" : `under ${BOOST_FLOOR} - re-potting`);
        this.repot = false;
      }
    }
    this.eatAt = this.eatAt || randomBetween(EAT_AT);
  }

  // ---------------------------------------------------------------- the bank trip

  /**
   * A normal teleport to the safe room's bank (Ashuelot Reis), a restock there, then a normal
   * teleport back in. After a kill it is straight back for the next one; after a death the bot
   * waits for the fight on in there to end, as a player can't join one in progress.
   */
  goBank(reason) {
    const { player } = this;
    this.away = { stage: reason === "death" ? "respawning" : "leaving", at: this.tick, reason };
    this.plan = null;
    this.swap = null;
    if (reason === "death") return;
    maybeSay(player, CHATTER.bank, 0.3);
    // Out the way a player goes: over to Nex's altar and its Teleport, then a walk to the bank.
    this.away = { stage: "toAltar", at: this.tick, reason };
    think(this, "kill done - heading to the altar to teleport out");
  }

  /** Over to the loot pile and its share picked up (its drops never touch the floor). */
  pickUp() {
    const { player } = this;
    const { where, drops } = this.loot;
    if (chebyshev(player.getLocation(), where) > 1 && this.tick - this.loot.at < 20) {
      this.walk(where);
      return;
    }
    player.getMovementQueue().reset();
    player.performAnimation(new core.Animation(PICKUP_ANIMATION));
    const names = drops.filter((drop) => drop.amount > 0).map(describeDrop);
    think(this, names.length ? `picked up my loot: ${names.join(", ")}` : "nothing for me this kill");
    this.loot = null;
  }

  /** A rare in the team: a few seconds of "gz" before anyone leaves; the lucky one goes wild. */
  cheer() {
    const { player } = this;
    const party = this.team.celebrate;
    if (this.tick < (this.nextCheer ?? 0)) return;
    const lucky = party.player === player;
    this.nextCheer = this.tick + (lucky ? randomInt(2, 3) : randomInt(3, 6));
    // In its own voice: the lucky one about its drop, the others congratulating them.
    const talk = TALK[this.persona] ?? TALK.chill;
    const fill = (text) => text.replace(/\{item\}/g, String(party.item ?? "it").toLowerCase()).replace(/\{name\}/g, party.player.getUsername?.() ?? "mate");
    if (lucky) {
      // Never the same line twice in one celebration (kofi saw "dad of the year" twice running).
      if (this.cheerFor !== party) {
        this.cheerFor = party;
        this.cheerSaid = new Set();
      }
      const lines = talk.rareSelf ?? CHATTER.lucky;
      const unsaid = lines.filter((line) => !this.cheerSaid.has(line));
      const line = Common.pick(unsaid.length ? unsaid : lines);
      this.cheerSaid.add(line);
      say(player, fill(line));
      player.performAnimation(new core.Animation(Common.pick(CHEER_ANIMATIONS)));
    } else if (!this.saidGz || chance(0.3)) {
      this.saidGz = true;
      say(player, fill(Common.pick(talk.rareSeen ?? CHATTER.gz)));
    }
  }

  /** The old way out, if the altar can't be reached: a normal teleport straight to the bank. */
  teleportToBank(reason) {
    this.away = { stage: "leaving", at: this.tick, reason };
    // Out of combat first: a bot still fighting can't teleport.
    this.player.getCombat().reset();
    this.player.getMovementQueue().reset();
    core.TeleportHandler.teleport(this.player, bankTile(), core.TeleportType.NORMAL, false, () => {
      if (this.away?.stage === "leaving") this.away = { stage: "banking", at: this.tick + randomInt(5, 10), reason };
    });
  }

  /** The trip itself, ticked by the team while the bot is out of the instance. */
  processAway() {
    this.tick++;
    const { player } = this;
    const away = this.away;
    if (!player.isRegistered()) return;
    if (away.stage === "respawning") {
      // The death's own respawn first, then the walk... teleport... to the bank.
      if (player.getHitpoints() <= 0 || this.tick - away.at < 8 || player.isTeleportingReturn?.()) return;
      player.moveTo(bankTile());
      this.away = { stage: "banking", at: this.tick + randomInt(6, 12), reason: away.reason };
      return;
    }
    if (away.stage === "toAltar") {
      const altar = altarOf(this.instance);
      if (!altar || this.tick - away.at > 40) {
        think(this, !altar ? "couldn't find the altar - teleporting out instead" : "couldn't reach the altar - teleporting out instead");
        this.altarSeen = false;
        this.teleportToBank(away.reason);
        return;
      }
      if (!this.altarSeen) {
        this.altarSeen = true;
        think(this, `walking to the altar at ${altar.getX()},${altar.getY()}`);
      }
      if (chebyshev(player.getLocation(), altar) > 1) {
        const tile = this.nearestTile(altar, (tile) => chebyshev(tile, altar) === 1, 2);
        this.walk(tile ?? altar);
        return;
      }
      player.getMovementQueue().reset();
      player.setPositionToFace?.(altar);
      think(this, "using the altar's Teleport");
      this.altarSeen = false;
      const Instance = require("./Instance.Nex");
      if (!Instance.leave(player)) Common.fadeMove(player, Common.toLocation(Common.data.prison.altarExit));
      // Straight into the safe room by the banker (kofi: quicker than the walk round from outside its
      // door, which got them back after she'd risen).
      player.moveTo(bankTile());
      this.away = { stage: "banking", at: this.tick + randomInt(1, 3), reason: away.reason };
      return;
    }
    if (away.stage === "walkingBank") {
      const near = chebyshev(player.getLocation(), away.bank) <= 1;
      if (!near && this.tick - away.at < 30) {
        if (this.tick - away.at > 3) this.walk(away.bank);
        return;
      }
      if (!near) player.moveTo(away.bank);
      this.away = { stage: "banking", at: this.tick + randomInt(1, 3), reason: away.reason };
      return;
    }
    if (away.stage === "leaving") {
      // A teleport that never went through (the game refused it): straight to the bank, so it never
      // "banks" where it stands and then tries to walk in from inside the chamber.
      if (this.tick - away.at > 8) {
        player.moveTo(bankTile());
        this.away = { stage: "banking", at: this.tick + randomInt(2, 4), reason: away.reason };
      }
      return;
    }
    if (away.stage === "banking") {
      if (this.tick < away.at) return;
      // Over to the banker ghost (Ashuelot Reis), facing him for a few seconds as a player banks.
      const banker = bankerNear(player);
      // Just arrived: the safe room's NPCs show a tick or two after the move - a moment to find him.
      if (!banker && !away.atBanker && this.tick - away.at < 4) return;
      // She rises soon (Instance.riseAt): no time for the banker, restocked where it stands.
      const left = (this.instance.riseAt ?? Infinity) - core.World.getProcessCycle();
      if (banker && !away.atBanker && left > SPAWN_MARGIN) {
        if (chebyshev(player.getLocation(), banker.getLocation()) > 1 && this.tick - away.at < 15) {
          if (!away.walking || !player.getMovementQueue().isMovings()) {
            const tile = this.nearestTile(banker.getLocation(), (tile) => chebyshev(tile, banker.getLocation()) === 1, 1);
            if (tile) this.walk(tile, true);
            away.walking = true;
          }
          return;
        }
        player.getMovementQueue().reset();
        player.setPositionToFace?.(banker.getLocation());
        away.atBanker = true;
        away.doneAt = this.tick + randomInt(2, 4);
        think(this, "talking to Ashuelot Reis - banking");
        return;
      }
      if (away.atBanker && this.tick < away.doneAt) return;
      this.restock();
      // Each sets off back in on its own moment, a couple of ticks apart (kofi: staggered, as on arrival).
      this.away = { stage: "ready", at: this.tick, goAt: this.tick + 1 + 2 * (this.index % 4) + randomInt(0, 1), reason: away.reason };
      return;
    }
    if (away.stage === "ready") {
      // Into the instance only between fights (Nex is down, or not up yet).
      // A moment late after a kill is fine while she is still rising; after a death, the next kill.
      const fight = this.instance.fight;
      const rising = fight && fight.stage === "spawning" && away.reason === "kill";
      if (this.instance.ended || (fight && !fight.stopped && !rising)) return;
      if (this.tick < (away.goAt ?? 0)) return;
      // Back the way a player goes: across the safe room to the Ancient Barrier and through it.
      this.away = { stage: "returning", at: this.tick, reason: away.reason };
      think(this, "restocked - walking to the Ancient Barrier");
      return;
    }
    if (away.stage === "returning") {
      // Already inside somehow (a refused teleport): nothing to walk through.
      if (this.instance.inChamber?.(player.getLocation()) && this.instance.players.has(player)) {
        this.away = null;
        this.dead = false;
        return;
      }
      const [bx, by, bz] = Common.data.chamber.barrierTile;
      const front = new core.Location(bx - 1, by + (this.index % 3) - 1, bz);
      const me = player.getLocation();
      // Anywhere close to the barrier will do (its front tile may be taken by a teammate).
      const atBarrier = chebyshev(me, new core.Location(bx, by, bz)) <= 2 && me.getX() < bx;
      if (!atBarrier && this.tick - away.at < 12) {
        this.walk(front);
        return;
      }
      if (this.instance.ended) return;
      // The barrier won't let anyone through once a fight is on: wait in the safe room for the next.
      const fightOn = this.instance.fight;
      if (fightOn && !fightOn.stopped && !(fightOn.stage === "spawning" && away.reason === "kill")) {
        this.away = { stage: "ready", at: this.tick, reason: away.reason };
        return;
      }
      this.away = null;
      this.dead = false;
      player.getMovementQueue().reset();
      player.setPositionToFace?.(new core.Location(bx, by, bz));
      think(this, "passing through the Ancient Barrier");
      this.instance.enter(player);
      maybeSay(player, CHATTER.back, 0.25);
      return;
    }
  }

  /** Banked: the kit and supplies fresh, hitpoints, prayer and special full, stats back to normal. */
  restock() {
    const { player } = this;
    const skills = player.getSkillManager();
    equip(player, this.role, this.team.solo, this.team.size);
    stock(player, this.role, this.team.solo, this.team.size);
    this.style = this.rangedOnly ? "ranged" : this.role;
    for (const name of COMBAT_SKILLS) skills.setCurrentLevel(core.Skill[name], skills.getMaxLevel(core.Skill[name]), true);
    player.setSpecialPercentage(100);
    player.setPoisonDamage?.(0);
    player.setVenomDamage?.(0);
    this.brewsSinceRestore = 0;
    this.boostedAt = -Infinity;
    this.eatAt = randomBetween(EAT_AT);
    this.redeeming = false;
    this.weapon = "bow";
  }

  // ---------------------------------------------------------------- gear switches

  /**
   * A melee bot goes ranged for the shadow phase (Wiki: fight it from max range) and back to melee
   * once Umbra dies. Returns true on the tick it switches (no attack that tick).
   */
  /**
   * The style the lone bot or a duo's melee bot fights her in when nothing forces one: whichever it
   * does more by DAMAGE_TABLE (the bow), still beside her, tried otherwise only after a bad streak (streak).
   */
  dpsChoice(fight) {
    if (this.rangedOnly) return "ranged";
    this.dps = this.dps ?? this.newBook("nex", ["melee", "ranged"]);
    const book = this.dps;
    const next = this.streak(fight, book);
    if (!next) {
      if (!book.trial) book.pending = null;
      return book.current;
    }
    if (this.commit(book, next)) think(this, `on Nex: going ${next}${next === book.best ? " (my main)" : ""}`);
    return book.current;
  }

  /**
   * Whether this bot picks its style on Nex by the damage it does (dpsChoice): the lone bot, and a
   * duo's melee bot - both carry the full ranged switch. The four-bot team keeps its fixed roles.
   */
  picksStyle() {
    return this.role === "melee" && this.team.size !== "four";
  }

  /**
   * A duo or a lone bot keeps her close all fight, every bot beside her (the ranger shooting from
   * there) so each of her swings can be stalled and she's walked back to the middle - all but the
   * shadow phase, fought from range (kofi's call for the small teams).
   */
  staysClose(fight) {
    return this.team.size !== "four" && fight.phase().key !== "shadow";
  }

  /**
   * A player's choice of style or weapon (`book`: { kind: "nex"|"mage", options, current, best,
   * recent, trial, tries, committedUntil }): the best by DAMAGE_TABLE, kept through ordinary bad
   * luck; after a bad streak (STREAK) sometimes a few hits of something else, then back unless that
   * did clearly better. Gives the option to move to, or null to stay.
   */
  streak(fight, book) {
    const table = DAMAGE_TABLE[book.kind];
    // Only in a calm moment: not with her swing about to land on it.
    const calm = fight.target !== this.player || fight.tick - (fight.lastAttackTick ?? 0) <= 1;
    if (book.trial) {
      book.trial.ticks++;
      if (book.trial.ticks < book.trial.length || !calm) return null;
      const perTick = book.trial.damage / Math.max(1, book.trial.ticks);
      const keep = perTick >= table[book.best][1] * STREAK.keep;
      const option = book.trial.option;
      book.trial = null;
      book.recent = [];
      if (keep) {
        book.committedUntil = this.tick + randomInt(COMMIT_TICKS[0], COMMIT_TICKS[1]);
        think(this, `${option} did ${perTick.toFixed(1)}/tick - sticking with it a while`);
        return null;
      }
      return book.best;
    }
    if (book.current !== book.best) return this.tick >= (book.committedUntil ?? 0) && calm ? book.best : null;
    const recent = book.recent.slice(-STREAK.hits);
    if (recent.length < STREAK.hits || !calm || book.tries >= STREAK.perKill) return null;
    const mean = recent.reduce((sum, hit) => sum + hit, 0) / recent.length;
    if (mean >= table[book.current][0] * STREAK.low) return null;
    book.recent = [];
    if (!chance(STREAK.chance)) return null;
    const option = Common.pick(book.options.filter((each) => each !== book.current));
    book.tries++;
    book.trial = { option, damage: 0, ticks: 0, length: randomInt(STREAK.trialTicks[0], STREAK.trialTicks[1]) };
    think(this, `${book.current} hitting low (${mean.toFixed(1)} a hit over ${STREAK.hits}) - trying ${option} for a bit`);
    return option;
  }

  /** A hit for a book: the main choice's run of hits, or the trial's damage. */
  bookHit(book, option, damage) {
    if (!book) return;
    if (book.trial && book.trial.option === option) book.trial.damage += damage;
    else if (option === book.current) book.recent.push(damage);
    if (book.recent.length > 10) book.recent.shift();
  }

  /** A new book of `kind` over `options`: the best by DAMAGE_TABLE is the main choice. */
  newBook(kind, options) {
    const best = options.reduce((a, b) => (DAMAGE_TABLE[kind][b][1] > DAMAGE_TABLE[kind][a][1] ? b : a));
    return { kind, options, best, current: best, recent: [], trial: null, tries: 0, committedUntil: 0 };
  }

  /** Acting on a call a moment later (DECIDE_DELAY), as a player does. True once it's made. */
  commit(book, next) {
    if (!book.pending || book.pending.to !== next) {
      book.pending = { to: next, at: this.tick + randomInt(DECIDE_DELAY[0], DECIDE_DELAY[1]) };
      return false;
    }
    if (this.tick < book.pending.at) return false;
    book.pending = null;
    book.current = next;
    if (chance(0.3) && SWITCH_LINES[next]) say(this.player, Common.pick(SWITCH_LINES[next]));
    return true;
  }

  /** The four-bot team's rangers weigh the bow against the crossbow (weaponChoice). */
  picksWeapon() {
    return this.role === "ranged" && this.team.size === "four";
  }

  /**
   * A four-bot ranger on Nex: the Twisted bow or the Zaryte crossbow and buckler (ruby bolts from the
   * quiver): the bow (DAMAGE_TABLE), the crossbow tried only after a bad streak (streak) -
   * each ranger on its own luck, so the two rarely swap together. True on the tick it swaps.
   */
  weaponChoice(fight) {
    if (!this.picksWeapon() || this.swap || this.style !== "ranged") return false;
    const { player } = this;
    if (player.getCombat().getTarget?.() !== fight.boss) return false;
    this.wdps = this.wdps ?? this.newBook("nex", ["bow", "crossbow"]);
    const book = this.wdps;
    const next = this.streak(fight, book);
    if (!next) {
      if (!book.trial) book.pending = null;
      return false;
    }
    if (!this.commit(book, next)) return false;
    think(this, `on Nex: the ${next}${next === book.best ? " again (my main)" : ""}`);
    for (const name of WEAPON_SETS[next]) this.equipFromInventory(name);
    this.weapon = next;
    player.getCombat().attack(fight.boss);
    return true;
  }

  /**
   * A bot that picks its style (picksStyle), on one of her mages: the fang, the blowpipe or the bow -
   * the bow by DAMAGE_TABLE, the others tried after a bad streak (streak, its own book) - always next to
   * the mage, as players do; the blowpipe and bow worn with the full ranged switch.
   */
  mageChoice(fight) {
    this.mdps = this.mdps ?? this.newBook("mage", this.rangedOnly ? ["blowpipe", "bow"] : ["melee", "blowpipe", "bow"]);
    const book = this.mdps;
    const next = this.streak(fight, book);
    if (!next) {
      if (!book.trial) book.pending = null;
      return book.current;
    }
    if (this.commit(book, next)) think(this, `on the mage: going ${next}${next === book.best ? " (my main)" : ""}`);
    return book.current;
  }

  /** What it's hitting a mage with now: melee, blowpipe or bow (by the worn weapon). */
  mageWeapon() {
    if (this.style === "melee") return "melee";
    const weapon = this.player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getId?.();
    return weapon === item("TOXIC_BLOWPIPE") ? "blowpipe" : "bow";
  }

  /** On its ranged switch, the right bow: the blowpipe on a mage by choice, the Twisted bow otherwise. */
  rangedWeapon(fight, mageStyle) {
    if (this.style !== "ranged" || this.swap) return;
    const want = mageStyle === "blowpipe" ? "TOXIC_BLOWPIPE" : "TWISTED_BOW";
    const worn = this.player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getId?.();
    if (worn === item(want) || worn === item("ZARYTE_CROSSBOW")) return;
    if (this.equipFromInventory(want)) think(this, want === "TOXIC_BLOWPIPE" ? "blowpipe on for the mage" : "back to the twisted bow");
  }

  /** Next to the mage it's hitting, whatever it hits it with (players stand beside her mages). */
  besideMage(fight) {
    // In the four-bot team's shadow phase, three of them stand by Umbra, out of Nex's range; the first
    // ranger stays within it, her target, shooting Umbra from there.
    // The lone ranger does the same, as a melee bot would: right beside Umbra, out of Nex's reach.
    const byUmbra = fight.phase().key === "shadow" && (this.team.solo || (this.team.size === "four" && !(this.role === "ranged" && this.slot === 0)));
    if (!this.picksStyle() && !byUmbra) {
      this.mageSpot = null;
      return false;
    }
    // The mage it should be on first: still locked on Nex, the old target hid a newly called mage for
    // a tick or more, so it shot her (or the mage from where it stood) before setting off (kofi).
    const isMage = (mob) => !!mob && [...fight.mages.values()].includes(mob);
    const wanted = this.target(fight);
    const target = isMage(wanted) ? wanted : this.player.getCombat().getTarget?.() ?? wanted;
    if (!isMage(target)) {
      this.mageSpot = null;
      return false;
    }
    const me = this.player.getLocation();
    const size = target.getSize?.() ?? 1;
    const at = target.getLocation();
    // On the fang, a side tile: melee can't hit diagonally (each mage has one diagonal tile free).
    const side = (tile) => tile.getX() >= at.getX() && tile.getX() < at.getX() + size || tile.getY() >= at.getY() && tile.getY() < at.getY() + size;
    // Never on a teammate's tile, nor one a teammate is heading for: a mage has only 3 beside it.
    const others = this.others();
    const claimed = (tile) => others.some((other) => other.getLocation().equals(tile))
      || this.team.bots.some((bot) => bot !== this && bot.mageSpot?.equals?.(tile));
    const sharing = others.some((other) => other.getLocation().equals(me));
    // Out of reach of her spells from the middle of the room (more than her 10 tiles from her body
    // there), so standing by the mage keeps it out of them.
    const home = this.instance.tile([...Common.data.chamber.nexTile.slice(0, 2), 0]);
    const safe = (tile) => Common.distanceToBody(tile, home, 3) > Common.data.fight.magicRange;
    const fits = (reach, out) => (tile) => Common.distanceToBody(tile, at, size) === reach && this.walkable(tile) && !claimed(tile)
      && (reach > 1 || this.style !== "melee" || side(tile)) && (!out || safe(tile));
    // Beside it, out of her reach, if a tile's free; then one further out; then any beside it.
    const best = this.nearestTile(at, fits(1, true), 3) ?? this.nearestTile(at, fits(2, true), 4);
    if (Common.distanceToBody(me, at, size) <= (best && !safe(me) ? 0 : 1) && (this.style !== "melee" || side(me)) && !sharing) {
      this.mageSpot = me.clone();
      return false;
    }
    // One unbroken run there: out of combat on the way (combat stopped it to shoot each time it was in
    // range, so it ran in stops and starts), and the route kept, not planned again, while it's moving.
    const stopFighting = () => this.player.getCombat().getTarget?.() && this.player.getCombat().clearInteraction();
    if (this.player.getMovementQueue().isMovings() && this.mageSpot && !claimed(this.mageSpot)) {
      stopFighting();
      return true;
    }
    const tile = best ?? this.nearestTile(at, fits(1, false), 3) ?? this.nearestTile(at, fits(2, false), 4);
    this.mageSpot = tile ?? null;
    if (tile && !tile.equals(me)) {
      stopFighting();
      this.walk(tile, true);
    }
    // One tile further out it can still shoot; on the fang it walks in when a side frees up.
    return !!tile && !tile.equals(me);
  }


  /** One of her mages called and still standing. */
  mageUp(fight) {
    return [...fight.vulnerable].some((name) => alive(fight.mages.get(name)));
  }

  switchStyle(fight) {
    if (this.role !== "melee") return false;
    // The shadow phase, and Deflect Melee in the Zaros phase (shooting from beside her), are ranged.
    const deflecting = fight.phase().key === "zaros" && fight.form() === Common.data.npcs.deflect;
    const iced = fight.tick < (this.rangedUntil ?? 0);
    // A bot that picks its style takes her mages on with the fang, the blowpipe or the bow (mageChoice).
    const mageUp = this.picksStyle() && this.mageUp(fight);
    // Umbra too: beside her in her corner (far from Nex's shadow shots), with whichever weapon it picks.
    const mageStyle = mageUp && !iced ? this.mageChoice(fight) : null;
    const forced = (fight.phase().key === "shadow" && !mageStyle) || deflecting || iced;
    // Otherwise it fights her in whichever style is doing more (dpsChoice), still beside her. Only that
    // free-choice damage on her counts towards it (not the shadow phase's, nor a mage's).
    this.dpsCounting = !forced && !mageStyle;
    // The duo's first bot never goes melee (rangedOnly).
    const want = forced || this.rangedOnly ? "ranged"
      : mageStyle ? (mageStyle === "melee" ? "melee" : "ranged")
        : this.picksStyle() && this.dpsChoice(fight) === "ranged" ? "ranged" : "melee";
    this.rangedWeapon(fight, mageStyle);
    if (want === this.style) {
      this.styleChangeAt = null;
      // Already on its bow (a mage, the shadow phase) when the damage check picks range: it's on its
      // bow by choice now, beside her.
      if (want === "ranged" && !forced && !mageStyle && this.picksStyle()) this.rangedFor = "more damage on range";
      return false;
    }
    if (this.styleChangeAt == null) this.styleChangeAt = this.tick + (fight.phase().key === "ice" ? 0 : this.reaction);
    if (this.tick < this.styleChangeAt) return false;
    this.styleChangeAt = null;
    this.player.getCombat().clearInteraction();
    if (this.player.isSpecialActivated()) core.CombatSpecial.activate(this.player);
    // Always the full set: maxed range (shadow phase, Deflect Melee, the icicles), full Torva back.
    for (const name of want === "ranged" ? RANGED_SWITCH : MELEE_SWITCH) this.equipFromInventory(name);
    this.style = want;
    this.spot = null;
    this.rangedWeapon(fight, mageStyle);
    const why = mageStyle ? "a mage to shoot" : !forced ? "more damage on range" : fight.phase().key === "zaros" ? "deflect melee" : fight.phase().key === "shadow" ? "shadow phase" : "icicles";
    const wasMage = this.rangedFor === "a mage to shoot";
    const wasDps = this.rangedFor === "more damage on range";
    this.rangedFor = want === "ranged" ? why : null;
    think(this, want === "ranged"
      ? `${why} - switching to full ranged gear`
      : `${wasMage ? "the mage is down" : wasDps ? "more damage on melee" : fight.phase().key === "zaros" ? "deflect's down" : fight.phase().key === "ice" ? "icicles melted" : "Umbra's dead"} - back to full melee gear`);
    return true;
  }

  // ---------------------------------------------------------------- thralls

  /**
   * A greater thrall (Wiki: Thralls) - a skeleton for the melee, a ghost for the rangers - cast from
   * the Arceuus spellbook with the Book of the dead in the inventory, kept up all fight: re-cast a
   * moment after the last one fades (one at a time, 10 seconds between casts, 6 prayer points).
   */
  thrall(fight) {
    const { player } = this;
    if (this.tick < (this.nextThrall ?? 0) || !player.getCombat().getTarget?.()) return;
    if (fight.tick < fight.siphonUntil) return;
    const current = player.getAttribute(THRALL_ATTRIBUTE);
    if (current?.isRegistered?.()) return;
    if (player.getSkillManager().getCurrentLevel(core.Skill.PRAYER) < 12) return;
    this.nextThrall = this.tick + randomInt(2, 8);
    core.ArceuusSpells.handleSpell(player, KITS[this.role].thrall);
    think(this, `casting ${KITS[this.role].thrall.replace("resurrect ", "")}`);
  }

  // ---------------------------------------------------------------- specials

  /**
   * A sip of its surge potion (Potions: 25% special energy, once every five minutes) whenever its bar
   * is at SURGE_AT or under and the cooldown's over - straight after a special, or building to the
   * next one - so it specs more often (kofi's call).
   */
  surge(fight) {
    const { player } = this;
    if (fight.stage !== "fighting" || this.tick < this.nextConsume || this.specInFlight()) return;
    const energy = player.getSpecialPercentage();
    if (energy > SURGE_AT || Date.now() < Number(player.getAttribute(SURGE_ATTRIBUTE) ?? 0)) return;
    if (this.use(doses("SURGE_POTION"))) think(this, `special at ${energy}% - sipping a surge potion`);
  }

  special(fight) {
    const { player } = this;
    if (this.tick < this.nextSpecCheck || this.isRescuer(fight)) return;
    this.nextSpecCheck = this.tick + randomInt(3, 6);
    const target = player.getCombat().getTarget?.();
    if (!target || player.isSpecialActivated()) return;
    const energy = player.getSpecialPercentage();
    const nex = target === fight.boss;
    // A duo's melee bot and the lone bot spec only with the crossbow's ruby bolts, on Nex, whenever
    // their bar allows (kofi's call; the lone bot's Lightbearer refills it twice as fast).
    if (this.picksStyle()) {
      if (nex && energy >= ZCB_SPEC_ENERGY && fight.tick >= fight.siphonUntil) this.startSwap(fight);
      return;
    }
    if (this.style === "melee") {
      this.meleeSpecial(fight, target, energy);
      return;
    }
    const hp = fight.boss.getHitpoints();
    // The rangers carry the Zaryte crossbow; a four-bot melee bot on its bow just shoots.
    if (this.role !== "ranged" || !nex || energy < ZCB_SPEC_ENERGY || hp < ZCB_SPEC_MIN_HITPOINTS || fight.tick < fight.siphonUntil) return;
    if (player.getHitpoints() < player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) * 0.55 || !chance(0.75)) return;
    this.startSwap(fight);
  }

  /** Fang, claws or Voidwaker, picked on what she's at and how the bot's hits have gone. */
  meleeSpecial(fight, target, energy) {
    const { player } = this;
    const nex = target === fight.boss;
    const hurt = player.getHitpoints() < player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) * 0.55;
    // Claws or Voidwaker only (never the fang's special), and only on Nex herself: the bar is saved
    // for her while it's on a mage or reaver, while hurt, or during a siphon.
    if (!nex || hurt || energy < SWAP_SPEC_ENERGY || fight.tick < fight.siphonUntil) return;
    if (!chance(0.75)) return;
    const hp = fight.boss.getHitpoints();
    // The lone bot saves its bar for the crossbow's ruby bolts (its ranged phases) while she's high,
    // and only Voidwakers to finish her or in the last phase.
    if (this.team.solo && hp >= VOIDWAKER_FINISH_HITPOINTS && fight.phase().key !== "zaros") return;
    let pick;
    if (hp < VOIDWAKER_FINISH_HITPOINTS) pick = "VOIDWAKER";
    else if (this.misses >= 3) pick = chance(0.7) ? "VOIDWAKER" : "DRAGON_CLAWS";
    else {
      const roll = Math.random();
      pick = roll < 0.55 ? "DRAGON_CLAWS" : "VOIDWAKER";
    }
    // The lone bot carries the crossbow in the claws' place.
    if (this.team.solo) pick = "VOIDWAKER";
    if (!this.equipFromInventory(pick)) return;
    // Voidwaker is one-handed: the defender stays (or goes back) on with it.
    if (pick === "VOIDWAKER") this.defenderOn();
    core.CombatSpecial.activate(player);
    player.getCombat().attack(fight.boss);
    this.swap = { until: this.tick + SWAP_BACK_TICKS, back: ["OSMUMTENS_FANG", "AVERNIC_DEFENDER"] };
    think(this, `spec with ${pick === "VOIDWAKER" ? "Voidwaker" : "dragon claws"} (Nex ${hp} hp, ${energy}% energy${this.misses >= 3 ? ", after " + this.misses + " misses" : ""})`);
  }

  /** The avernic defender back on beside a one-handed fang or Voidwaker, if the shield slot's empty. */
  defenderOn() {
    const worn = this.player.getEquipment().getItems();
    const weapon = worn[core.Equipment.WEAPON_SLOT]?.getId?.();
    const shield = worn[core.Equipment.SHIELD_SLOT]?.getId?.();
    if (shield > 0 || ![item("OSMUMTENS_FANG"), item("VOIDWAKER")].includes(weapon)) return;
    if (this.equipFromInventory("AVERNIC_DEFENDER")) think(this, "avernic defender back on");
  }

  equipFromInventory(name) {
    const id = item(name);
    const slot = this.slotOf([id]);
    if (slot < 0) return false;
    core.EquipPacketListener.equip(this.player, id, slot, core.Inventory.INTERFACE_ID);
    return true;
  }

  /** Zaryte crossbow, ruby bolts and buckler on, the special queued, the shot at her. */
  startSwap(fight, target = fight.boss) {
    const { player } = this;
    // What it holds now, for the way back (read before the crossbow goes on).
    const holding = this.style === "melee" ? "melee" : this.mageWeapon?.() ?? "bow";
    if (!this.equipFromInventory("ZARYTE_CROSSBOW")) return;
    this.equipFromInventory("RUBY_DRAGON_BOLTS_E_");
    this.equipFromInventory("TWISTED_BUCKLER");
    // Its ruby bolts are in the quiver, which only feeds the crossbow while Dizana's cape is worn:
    // a melee bot in its Infernal cape had no bolts, so its special never fired.
    if (holding === "melee") this.equipFromInventory("DIZANAS_MAX_CAPE");
    core.CombatSpecial.activate(player);
    player.getCombat().attack(target);
    // Back to the weapon it was using: a four-bot ranger's bow or crossbow, or a picking bot's fang
    // (and defender), blowpipe or bow.
    const back = holding === "melee" ? ["OSMUMTENS_FANG", "AVERNIC_DEFENDER", "INFERNAL_MAX_CAPE_2"]
      : holding === "blowpipe" ? ["TOXIC_BLOWPIPE"]
        : WEAPON_SETS[this.weapon ?? "bow"];
    this.swap = { until: this.tick + SWAP_BACK_TICKS, back, target };
    const name = target === fight.boss ? "Nex" : target.getCurrentDefinition?.()?.getName?.() ?? "the mage";
    think(this, `${name} at ${target.getHitpoints()} hp - swapping to the Zaryte crossbow for a ruby bolt spec`);
  }

  /** A special swap on, or its shot fired within SPEC_LAND_TICKS: no drinking until it has landed. */
  specInFlight() {
    return !!this.swap || this.tick < (this.specLandsAt ?? 0);
  }

  /** Back to the bow once the special is spent (or it never went). */
  swapping(fight) {
    const swap = this.swap;
    if (!swap) return false;
    const { player } = this;
    if (player.isSpecialActivated() && this.tick < swap.until && fight.tick >= fight.siphonUntil) {
      // On her until the special's shot goes: an attack turned down (she can't be hit yet, as when
      // she's still spawning) was left at that, and the swap ran out with the special unspent.
      const combat = player.getCombat();
      if (alive(swap.target) && combat.getTarget?.() !== swap.target) combat.attack(swap.target);
      return true;
    }
    if (player.isSpecialActivated()) core.CombatSpecial.activate(player);
    for (const name of swap.back) this.equipFromInventory(name);
    this.swap = null;
    this.specLandsAt = this.tick + SPEC_LAND_TICKS;
    player.getCombat().clearInteraction();
    return false;
  }
}

// ------------------------------------------------------------------ the team

class Team {
  constructor(instance, owner, size = "four") {
    this.instance = instance;
    this.owner = owner;
    this.size = TEAMS[size] ? size : "four";
    this.roles = TEAMS[this.size];
    this.solo = this.size === "solo";
    this.bots = [];
  }

  /** Fills the empty seats (all four at the start, a fallen bot's before the next kill). */
  fill() {
    if (this.instance.ended) return;
    const roles = [...this.roles];
    for (const bot of this.bots) roles.splice(roles.indexOf(bot.role), 1);
    for (const role of roles) {
      const slot = this.bots.filter((bot) => bot.role === role).length;
      const used = new Set(this.bots.map((bot) => bot.index));
      const index = [0, 1, 2, 3].find((each) => !used.has(each)) ?? 0;
      const player = spawnBot(this.instance, role, this.solo, this.size);
      if (player) this.bots.push(new NexBot(this, player, role, slot, index));
    }
  }

  process() {
    this.tick = (this.tick ?? 0) + 1;
    if (this.instance.ended || !this.instance.players.has(this.owner)) {
      // However the owner went (a teleport too), a lone or duo bot's rare still goes to the Grand Exchange.
      if (this.sales?.length && this.size !== "four" && this.owner.isRegistered?.()) this.startTrip();
      else this.disband();
      return;
    }
    for (const bot of [...this.bots]) {
      if (!bot.entered) {
        if (bot.player.isRegistered()) {
          bot.entered = true;
          this.instance.enter(bot.player);
        }
        continue;
      }
      try {
        if (bot.away) bot.processAway();
        else bot.process();
      } catch (error) {
        console.error("[nex bots] bot tick failed", error);
      }
    }
    this.healWatch();
    this.hitWatch();
    this.speakFightLines();
    this.chatter();
    this.logStatus();
    // A seat only empties if a bot was logged out some other way: refilled while she is down.
    if (!this.instance.fight && this.bots.length < this.roles.length) this.fill();
  }

  /**
   * Every 5 ticks, one line on the fight and each teammate to logs/nex-bots.log (NEX_BOTS_LOG=0 turns
   * it off): what a spectator would want to know when a bot does something odd.
   */
  /** Between kills and while she spawns: the team talks - lone lines, replies and little back-and-forths. */
  chatter() {
    const fight = this.instance.fight;
    const quiet = !fight || fight.stopped || fight.stage === "ended" || fight.stage === "spawning";
    if (!quiet) {
      // A conversation going when she becomes attackable gets to finish (up to ~10 seconds) rather
      // than being cut off before the asker's answer (kofi: "proudest self-made thing?" never got one).
      this.fightTalkFrom = this.fightTalkFrom ?? this.tick;
      if (!this.lines?.length || this.tick - this.fightTalkFrom > 16) {
        this.lines = [];
        return;
      }
    } else {
      this.fightTalkFrom = null;
    }
    const here = this.bots.filter((bot) => !bot.away && bot.entered && alive(bot.player));
    this.lines = this.lines ?? [];
    while (this.lines.length && this.tick >= this.lines[0].at) {
      const { bot, text, anywhere } = this.lines.shift();
      // After-kill lines carry on as they head out to the bank.
      if (here.includes(bot) || (anywhere && this.bots.includes(bot) && alive(bot.player))) say(bot.player, text);
    }
    // Once she's attackable, only that last conversation finishes: nothing new starts.
    if (!quiet) return;
    // Nor does one start in the last seconds of her spawn, only to be cut off as the fight begins.
    if (fight && fight.stage === "spawning" && fight.tick >= Common.data.spawn.fillTick - 8 && !this.lines.length) return;
    if (this.postKill && this.tick >= this.postKill.at && !this.lines.length) {
      this.postKill = null;
      const team = this.bots.filter((bot) => bot.entered && alive(bot.player));
      // A rare has the whole team on gz already (cheer).
      if (team.length >= 1 && !(this.celebrate && this.tick < this.celebrate.until)) this.afterKillChat(team);
      return;
    }
    if (this.lines.length || here.length === 0 || this.tick < (this.nextChat ?? 0)) return;
    // Four bots: the first thing said, that the drops are free for all (kofi).
    if (this.ffaTalk()) return;
    this.nextChat = this.tick + randomInt(6, 14);
    const speaker = Common.pick(here);
    const others = here.filter((bot) => bot !== speaker).sort(() => Math.random() - 0.5);
    let at = this.tick;
    // A reply takes as long to type as it is long (2 to 6 seconds), and the next topic waits a while
    // after the last line is said (CHAT_GAP), so one chat never runs straight into the next.
    const queue = (bot, text) => {
      this.lines.push({ bot, text, at });
      at += typingTicks(text);
      this.nextChat = at + randomInt(CHAT_GAP[0], CHAT_GAP[1]);
    };
    const ownerName = this.owner?.getUsername?.() ?? "mate";
    // A scammer here (kofi): often it's his talk of not splitting, the others each answering in their own voice.
    const scammer = here.find((bot) => bot.scammer);
    if (scammer && others.length && chance(Scam.TALK_CHANCE)) {
      for (const line of Scam.talk(scammer, here.filter((bot) => bot !== scammer), ownerName)) queue(line.bot, line.text);
      return;
    }
    const fill = (bot, text) => this.fillTalk(bot, text, ownerName);
    const talk = (bot) => TALK[bot.persona] ?? TALK.chill;
    // Before anything else: whoever died last kill, and to what (deathTalk).
    if (this.deathTalk(here, queue)) return;
    this.startedAt = this.startedAt ?? Date.now();
    // Now and then, its human's death it saw the last time they were here together (an earlier trip).
    const theirs = Memory.lastHumanDeath(speaker.player.getUsername(), ownerName, "nex");
    if (theirs && theirs.at < this.startedAt && chance(0.08)) {
      const line = fresh((Deaths[speaker.persona] ?? Deaths.chill).humanPast, `${speaker.persona}:death-human-past`);
      if (line) {
        queue(speaker, line.replace(/\{owner\}/g, ownerName).replace(/\{cause\}/g, theirs.cause).replace(/\{boss\}/g, Bosses.bossName(theirs.boss)));
        return;
      }
    }
    // Now and then, a death it remembers from before this trip (Memory.BossBots, any boss).
    const past = Memory.lastDeath(speaker.player.getUsername());
    if (past && past.at < this.startedAt && chance(0.06)) {
      const line = fresh((Deaths[speaker.persona] ?? Deaths.chill).past, `${speaker.persona}:death-past`);
      if (line) {
        queue(speaker, line.replace(/\{cause\}/g, past.cause).replace(/\{boss\}/g, Bosses.bossName(past.boss)));
        // A teammate answers in its own voice, as it would an excuse.
        const mate = others.length ? Common.pick(others) : null;
        if (mate && chance(0.8)) queue(mate, Common.pick((Deaths[mate.persona] ?? Deaths.chill).reply));
        return;
      }
    }
    // A dry one moans or a lucky one brags now and then (in its own voice), and someone answers.
    const dry = here.filter((bot) => dryFor(this.bookName(bot)) > 0);
    const lucky = here.filter((bot) => luckyFor(this.bookName(bot)) > 0);
    if ((dry.length || lucky.length) && chance(0.2) && this.tick >= (this.nextDryMoan ?? 0)) {
      const moan = dry.length > 0 && (!lucky.length || chance(0.5));
      const lead = Common.pick(moan ? dry : lucky);
      const kind = moan ? "dry" : "lucky";
      const line = fresh(talk(lead)[kind], `${lead.persona}:${kind}`);
      if (line) {
        queue(lead, fill(lead, line));
        // Said once, then forgotten (Memory.BossBots told).
        NEX_DROPS.told(splitBookName(this.bookName(lead))[0], kind);
        if (others.length) queue(others[0], fill(others[0], Common.pick(talk(others[0]).reply[kind])));
        this.nextDryMoan = this.tick + randomInt(150, 300);
        return;
      }
    }
    // The lone bot: to its human, or to itself, in its own voice - now and then a life question for
    // them (pre-boss mode, Chatter.BossBots).
    if (!others.length) {
      const life = chance(0.3) ? Chatter.conversation("pre", speaker.persona, [], "nex") : null;
      if (life) {
        queue(speaker, life[0].text);
        return;
      }
      const line = (chance(0.55) ? fresh(talk(speaker).solo, `${speaker.persona}:solo`) : null) ?? fresh(talk(speaker).lines, `${speaker.persona}:lines`);
      if (line) queue(speaker, fill(speaker, line));
      return;
    }
    // Pre-boss mode (Chatter.BossBots, the same at every boss): a life topic it starts - travel, food,
    // films, dreams... - the others answering, each in its own personality.
    if (chance(0.45)) {
      const life = Chatter.conversation("pre", speaker.persona, others.map((bot) => bot.persona), "nex");
      if (life) {
        for (const { who, text } of life) queue(who < 0 ? speaker : others[who], text);
        return;
      }
    }
    // A line of its own, or a conversation it starts: the others answer in theirs, and now and then
    // it has the last word (every line from the speaker's own personality).
    if (chance(0.35)) {
      const line = fresh(talk(speaker).lines, `${speaker.persona}:lines`);
      if (line) {
        queue(speaker, fill(speaker, line));
        return;
      }
    }
    const kinds = ["question", "statement", "lore", "joke"].sort(() => Math.random() - 0.5);
    for (const kind of kinds) {
      const opener = fresh(talk(speaker).open[kind], `${speaker.persona}:open:${kind}`);
      if (!opener) continue;
      queue(speaker, fill(speaker, opener));
      const answering = others.slice(0, others.length > 1 && chance(0.5) ? 2 : 1);
      // A question: a teammate hands it back in its own voice, the asker gives its own answer (written
      // for that very question), and a teammate may react. Never a teammate's answer list: those were
      // written for their own questions ("who are the four generals?" got "correct, and elegantly so").
      const own = kind === "question" ? OWN_ANSWERS[speaker.persona]?.[opener] : null;
      if (kind === "question" && own && others.length) {
        const asked = others[0];
        queue(asked, fill(asked, Common.pick(Chatter.PONDER[asked.persona] ?? Chatter.PONDER.chill)));
        queue(speaker, fill(speaker, own));
        const reactor = Common.pick(others);
        if (chance(0.6)) queue(reactor, fill(reactor, Common.pick(Chatter.REACT[reactor.persona] ?? Chatter.REACT.chill)));
        return;
      }
      // A question with no answer of its own isn't asked at all (no mismatched reply).
      if (kind === "question") continue;
      const said = new Set();
      for (const bot of answering) {
        const options = talk(bot).reply[kind].filter((line) => !said.has(line));
        const answer = Common.pick(options.length ? options : talk(bot).reply[kind]);
        said.add(answer);
        queue(bot, fill(bot, answer));
      }
      if (chance(0.4)) queue(speaker, fill(speaker, Common.pick(talk(speaker).follow)));
      return;
    }
  }

  /** A bot's line with its own numbers filled in: {owner}, {last}, {kc}, {rare}, {since}, {name}. */
  fillTalk(bot, text, ownerName) {
    const name = this.bookName(bot);
    const entry = peekBook(name);
    const drops = entry?.drops ?? [];
    const last = (drops[drops.length - 1]?.items?.[0] ?? "nothing").toLowerCase();
    // Its last rare at any boss (Memory.BossBots), and the kills since, all bosses together.
    const [botName] = splitBookName(name);
    const rare = (Memory.lastRare(botName).rare ?? [...drops].reverse().find((drop) => drop.rare)?.rare ?? "a unique").toLowerCase();
    const since = String(Math.max(1, luckyFor(name) || dryFor(name) || (entry?.kills ?? 0) - (entry?.lastRare ?? 0)));
    return String(text).replace(/\{owner\}/g, ownerName).replace(/\{last\}/g, last).replace(/\{kc\}/g, String(dryFor(name)))
      .replace(/\{rare\}/g, rare).replace(/\{since\}/g, since);
  }
  /**
   * The name a bot's drop book is kept under: its own in the four-bot team, and a separate one for
   * duos and for lone fights (each with its own kills, dry spell and last 100 drops).
   */
  bookName(bot) {
    const name = bot.player.getUsername();
    return this.size === "four" ? name : `${name} [${this.size}]`;
  }

  /**
   * A big heal on her (Fight's "bigheal" cue: reavers dying into her, a siphon fed): one bot says so,
   * now and then a second, and sometimes a teammate answers - in the fight, as players do.
   */
  healWatch() {
    const fight = this.instance.fight;
    if (!fight || fight.stopped) return;
    if (fight !== this.healFight) {
      this.healFight = fight;
      this.healSeen = 0;
    }
    for (const cue of fight.cues) {
      if (cue.seq <= this.healSeen) continue;
      this.healSeen = cue.seq;
      if (cue.name !== "bigheal") continue;
      const here = this.bots.filter((bot) => !bot.away && bot.entered && alive(bot.player)).sort(() => Math.random() - 0.5);
      if (!here.length) continue;
      const amount = String(cue.amount);
      const fill = (text) => text.replace(/\{amount\}/g, amount);
      // Each in its own voice (PERSONA_HEAL_LINES) more often than not, else the plain lines.
      const line = (bot, kind) => {
        const own = PERSONA_HEAL_LINES[bot.persona]?.[kind];
        return fill(Common.pick(own && chance(0.7) ? own : HEAL_LINES[kind]));
      };
      const kind = cue.source === "siphon" ? "siphon" : "reavers";
      let at = this.tick + randomInt(1, 3);
      this.fightLines = this.fightLines ?? [];
      this.fightLines.push({ bot: here[0], text: line(here[0], kind), at });
      if (here.length > 1 && chance(0.35)) {
        at += randomInt(2, 4);
        this.fightLines.push({ bot: here[1], text: line(here[1], kind), at });
      }
      if (here.length > 1 && chance(0.4)) {
        at += randomInt(3, 6);
        const answerer = here[here.length > 2 ? 2 : 1];
        this.fightLines.push({ bot: answerer, text: line(answerer, "replies"), at });
      }
      note(`  BIG HEAL: Nex healed ${amount} (${cue.source})`);
    }
  }

  /** Lines said during the fight itself (healWatch), on their tick. */
  speakFightLines() {
    if (!this.fightLines?.length) return;
    const waiting = [];
    let held = false;
    for (const line of this.fightLines) {
      // A line waits its turn behind one still waiting (a conversation keeps its order).
      if (held || this.tick < line.at) {
        waiting.push(line);
        continue;
      }
      const { bot, text } = line;
      if (!this.bots.includes(bot) || !alive(bot.player)) continue;
      // Hit, a player eats back up before typing: the line waits for safe hitpoints (or gives up).
      const max = bot.player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
      if (line.safe && bot.player.getHitpoints() < max * SAFE_TO_TYPE && this.tick < line.giveUpAt) {
        waiting.push(line);
        held = true;
        continue;
      }
      say(bot.player, text);
      // What comes after waits a moment once this one is said.
      for (const later of this.fightLines) if (later !== line && later.after === line) later.at = Math.max(later.at, this.tick + typingTicks(later.text));
    }
    this.fightLines = waiting;
  }

  /**
   * Her specials landing (Fight's specialHits): sometimes the bot hit says something once it's safe,
   * sometimes a teammate does, in their own voices, and now and then a little back-and-forth. An ice
   * prison that shatters on someone: they react, and whoever went to free them says sorry.
   */
  hitWatch() {
    const fight = this.instance.fight;
    if (!fight || fight.stopped || !fight.specialHits) return;
    if (fight !== this.hitFight) {
      this.hitFight = fight;
      this.hitSeen = 0;
      this.rescuer = null;
    }
    while (this.hitSeen < fight.specialHits.length) {
      // A special's hits all land within a tick or two: wait for them, then take them as one - how
      // many it caught decides who talks (one bot was blaming the other when both had been hit).
      const hit = fight.specialHits[this.hitSeen];
      if (fight.tick < hit.tick + 2) break;
      this.hitSeen++;
      const group = [hit];
      while (this.hitSeen < fight.specialHits.length) {
        const next = fight.specialHits[this.hitSeen];
        if (next.special !== hit.special || next.tick - hit.tick > 3) break;
        group.push(next);
        this.hitSeen++;
      }
      // An ice containment hit always gets a word from whoever it caught, whatever the damage and
      // however soon after the last special talk (kofi: the bot said nothing when it got hit).
      // An ice prison that shattered on someone always gets its lines too (trapped, and the sorry).
      const always = hit.special === "containment" || hit.special === "prison";
      if (!always && this.tick < (this.nextHitTalk ?? 0)) continue;
      const here = this.bots.filter((bot) => !bot.away && bot.entered && alive(bot.player));
      if (!here.length) continue;
      const caught = new Set(group.map((each) => each.player));
      const victim = here.find((bot) => bot.player === hit.player) ?? null;
      // Hit while she rushed it or while it walked her home (her melee, the darkness engulfing it
      // under her): part of the job, not a failed dodge - nobody talks about it (kofi's call).
      // Only this fight's rush counts: a rush remembered from the last kill (its tick from that fight's
      // count) read as just now, and kept the bots quiet about every special early on (kofi: nobody
      // said a word about No Escape).
      const busyWithHer = (bot) => bot && (bot.pushing || (bot.waitHit && fight.rush?.target === bot.player)
        || (bot.lastRush && bot.lastRushFight === fight && fight.tick - bot.lastRush.startedAt < 20));
      if (!always && hit.special !== "prison" && group.some((each) => busyWithHer(here.find((bot) => bot.player === each.player)))) continue;
      const name = hit.player.getUsername?.() ?? "mate";
      const special = SPECIAL_NAMES[hit.special] ?? hit.special;
      const fill = (text, who = name) => text.replace(/\{name\}/g, who).replace(/\{special\}/g, special);
      // Only a teammate who got clear of it says anything about anyone else being hit.
      const others = here.filter((bot) => !caught.has(bot.player)).sort(() => Math.random() - 0.5);
      const lines = [];
      if (hit.special === "prison") {
        // Not freed in time: the one trapped, and the one who went to free them.
        const rescuer = this.rescuer?.bot && this.rescuer.bot !== victim && here.includes(this.rescuer.bot) ? this.rescuer.bot : null;
        if (victim && chance(0.7)) lines.push({ bot: victim, text: fill(Common.pick(PRISON_LINES[victim.persona].trapped)), safe: true });
        // The bot that went to free them always owns not making it in time (kofi: no apology came).
        if (rescuer) lines.push({ bot: rescuer, text: fill(Common.pick(PRISON_LINES[rescuer.persona].rescuer)) });
      } else {
        if (!always && Math.max(...group.map((each) => each.amount)) < HIT_TALK_MIN) continue;
        if (caught.size > 1) {
          // More than one caught: one of the bots in it owns its part, naming another caught (never
          // blaming them); a teammate who got clear may still say what it saw.
          const inIt = here.filter((bot) => caught.has(bot.player));
          const owner = inIt.length ? Common.pick(inIt) : null;
          const mate = [...caught].find((player) => player !== owner?.player);
          const shared = hit.special === "dash" ? NO_ESCAPE_LINES[owner?.persona]?.shared : SHARED_HIT_LINES[owner?.persona];
          if (owner && shared && (always || chance(0.6))) lines.push({ bot: owner, text: fill(Common.pick(shared), mate?.getUsername?.() ?? "mate"), safe: true });
        } else {
          // No Escape has its own lines (Escape.Nex), the other specials share HIT_LINES.
          const said = (bot) => (hit.special === "dash" ? NO_ESCAPE_LINES[bot.persona] : null) ?? HIT_LINES[bot.persona];
          if (victim && (always || chance(0.4))) lines.push({ bot: victim, text: fill(Common.pick(said(victim).self)), safe: true });
          if (others.length && chance(victim ? 0.35 : 0.3)) lines.push({ bot: others[0], text: fill(Common.pick(said(others[0]).seen)) });
        }
      }
      if (!lines.length) continue;
      // Now and then a little back-and-forth after it: an answer (from one who got clear), and once in
      // a while one back.
      const first = lines[0];
      const answerer = here.find((bot) => bot !== first.bot && !lines.some((line) => line.bot === bot) && !caught.has(bot.player));
      if (answerer && chance(0.45)) {
        const banter = (bot) => (hit.special === "dash" ? NO_ESCAPE_LINES[bot.persona] : null) ?? HIT_BANTER[bot.persona];
        lines.push({ bot: answerer, text: fill(Common.pick(banter(answerer).reply)) });
        if (chance(0.4)) lines.push({ bot: first.bot, text: fill(Common.pick(banter(first.bot).comeback)) });
      }
      let at = this.tick + randomInt(2, 4);
      let previous = null;
      this.fightLines = this.fightLines ?? [];
      for (const line of lines) {
        this.fightLines.push({ ...line, at, giveUpAt: this.tick + 25, after: previous });
        previous = this.fightLines[this.fightLines.length - 1];
        at += typingTicks(line.text);
      }
      this.nextHitTalk = this.tick + randomInt(8, 16);
      note(`  SPECIAL HIT: ${group.map((each) => `${each.player.getUsername?.() ?? "?"} took ${each.amount}`).join(", ")} from ${special}`);
    }
  }



  /**
   * The loot's down: one bot says what it got (or moans about being dry, or brags about its luck), in its
   * own voice; the others answer in theirs, and now and then it has the last word.
   */
  afterKillChat(team) {
    const ownerName = this.owner?.getUsername?.() ?? "mate";
    const talk = (bot) => TALK[bot.persona] ?? TALK.chill;
    const lead = Common.pick(team);
    const name = this.bookName(lead);
    const kind = dryFor(name) > 0 && chance(0.5) ? "dry" : luckyFor(name) > 0 && chance(0.4) ? "lucky" : "loot";
    const opener = fresh(talk(lead)[kind], `${lead.persona}:after:${kind}`) ?? Common.pick(talk(lead).loot);
    let at = this.tick;
    const push = (bot, text) => {
      this.lines.push({ bot, text: this.fillTalk(bot, text, ownerName), at, anywhere: true });
      at += typingTicks(text);
    };
    push(lead, opener);
    if (kind !== "loot") NEX_DROPS.told(splitBookName(name)[0], kind);
    const others = team.filter((bot) => bot !== lead).sort(() => Math.random() - 0.5);
    for (const bot of others.slice(0, others.length > 1 && chance(0.5) ? 2 : 1)) push(bot, Common.pick(talk(bot).reply[kind]));
    if (others.length && chance(0.3)) push(lead, Common.pick(talk(lead).follow));
    // Post-boss mode (Chatter.BossBots): now and then the team chats on - how that went, what's next.
    if (team.length > 1 && chance(0.5)) {
      const starter = Common.pick(team);
      const rest = team.filter((bot) => bot !== starter).sort(() => Math.random() - 0.5);
      const after = Chatter.conversation("post", starter.persona, rest.map((bot) => bot.persona), "nex");
      for (const { who, text } of after ?? []) push(who < 0 ? starter : rest[who], text);
    }
    this.nextChat = at + randomInt(CHAT_GAP[0], CHAT_GAP[1]);
  }

  logStatus() {
    if (process.env.NEX_BOTS_LOG === "0") return;
    this.logTick = (this.logTick ?? 0) + 1;
    const fight = this.instance.fight;
    const events = fight ? fight.cues.filter((cue) => cue.tick > (this.loggedCue ?? -1)) : [];
    if (fight && events.length) this.loggedCue = events[events.length - 1].tick;
    // Every tick while she's being walked home or rushing (the walk's steps), else every 5th.
    const walking = fight && (fight.underSince != null || fight.rush);
    if (this.logTick % 5 !== 0 && events.length === 0 && !walking) return;
    const { PrayerHandler } = core;
    const pray = (p) => ["PROTECT_FROM_MAGIC", "PROTECT_FROM_MISSILES", "PROTECT_FROM_MELEE"]
      .find((name) => PrayerHandler.isActivated(p, PrayerHandler[name]))?.split("_").pop() ?? "none";
    const name = (e) => (e ? (e.isNpc?.() ? e.getCurrentDefinition().getName() : e.getUsername()) : "-");
    const state = fight
      ? `${fight.stage}/${fight.phaseName() ?? "-"} nex=${fight.boss?.getHitpoints?.()} target=${name(fight.target)} facing=${name(fight.boss?.getInteractingMobile?.())} reavers=${fight.reavers.length} off=${fight.boss ? fight.homeDistance(fight.boss.getLocation()) : "-"} under=${fight.underSince != null ? fight.tick - fight.underSince + 1 : "-"}${fight.walkedSince != null ? " walking" : ""}${fight.rush ? " rush@" + name(fight.rush.target) : ""}`
      : "between kills";
    const owner = this.owner;
    const mates = this.bots.map((bot) => {
      const p = bot.player;
      const distance = fight?.boss && this.instance.players.has(p) ? fight.distanceTo(p) : "-";
      return `${p.getUsername()}(${bot.role}${bot.style !== bot.role ? "->" + bot.style : ""}) hp${p.getHitpoints()} pr${p.getSkillManager().getCurrentLevel(core.Skill.PRAYER)}`
        + ` ${pray(p)} d${distance} hit=${name(p.getCombat().getTarget?.())}${bot.away ? " away:" + bot.away.stage : ""}${bot.plan ? " dodging" : ""}`;
    }).join(" | ");
    const cues = events.map((cue) => `${cue.name}${cue.marked ? "@" + name(cue.marked) : ""}${cue.target ? "@" + name(cue.target) : ""}`).join(",");
    const line = `${new Date().toISOString().slice(11, 19)} ${state}${cues ? " EVENTS:" + cues : ""} || you(${owner.getUsername()}) hp${owner.getHitpoints()} d${fight?.boss ? fight.distanceTo(owner) : "-"} | ${mates}\n`;
    require("fs").appendFile(require("path").join(process.cwd(), "logs", "nex-bots.log"), line, () => {});
  }

  /** A bot out of the instance: off to the bank (a kill, a death), or gone for good. */
  left(player) {
    const bot = this.bots.find((entry) => entry.player === player);
    if (!bot) return;
    if (bot.away) return;
    if (bot.dead || player.getHitpoints() <= 0) {
      // As it goes down, in its own voice.
      if (chance(0.5)) say(player, Common.pick((Deaths[bot.persona] ?? Deaths.chill).dying));
      bot.goBank("death");
      return;
    }
    this.bots = this.bots.filter((entry) => entry !== bot);
    logout(player);
  }

  died(player) {
    const bot = this.bots.find((entry) => entry.player === player);
    if (!bot) return;
    bot.dead = true;
    // Who died and to what: talked about before the next kill, and kept (every boss) for later.
    const cause = causeOf(this.instance.fight, player);
    this.deaths = [...(this.deaths ?? []), { bot, name: player.getUsername(), cause, at: this.tick }];
    Memory.recordDeath(player.getUsername(), "nex", cause);
    // Everyone in the chamber hears who fell (the real players: the bots don't read chat).
    const phase = this.instance.fight?.phaseName?.();
    const text = `<col=ef1020>${player.getUsername()} has been defeated${phase ? ` (${phase})` : ""}.</col>`;
    for (const viewer of core.World.getPlayers()) {
      if (viewer && !isBot(viewer) && (viewer === this.owner || this.instance.players.has(viewer))) viewer.sendMessage(text);
    }
    note(`  DEATH: ${player.getUsername()} (${bot.role}) died${phase ? ` - ${phase}` : ""}`);
  }

  /** Its human fell: remembered for a word before the next kill. */
  ownerDied() {
    const cause = causeOf(this.instance.fight, this.owner);
    this.deaths = [...(this.deaths ?? []), { owner: true, name: this.owner.getUsername(), cause, at: this.tick }];
    // Each bot there remembers it (Memory.BossBots), to bring up the next time it's here with them.
    for (const bot of this.bots) if (!bot.away) Memory.recordHumanDeath(bot.player.getUsername(), this.owner.getUsername(), "nex", cause);
    note(`  DEATH: ${this.owner.getUsername()} (the human) died to ${cause}`);
  }

  /**
   * The first talk before the next kill, once whoever died is back: the bot that died gives its excuse
   * (its own fault, never a teammate's) and a teammate answers; on its human's death, a bot says
   * something to them - each in its own voice. True when it queued the talk.
   */
  deathTalk(here, queue) {
    const deaths = this.deaths ?? [];
    if (!deaths.length) return false;
    const voice = (bot) => Deaths[bot.persona] ?? Deaths.chill;
    const fill = (text, death) => text.replace(/\{name\}/g, death.name).replace(/\{owner\}/g, death.name).replace(/\{cause\}/g, death.cause);
    // Whoever died back with the team first (a long wait and it's talked about anyway).
    const waiting = deaths.some((death) => death.bot && !here.includes(death.bot)) && this.tick - deaths[deaths.length - 1].at < 120;
    if (waiting) return false;
    this.deaths = [];
    const death = Common.pick(deaths);
    if (death.owner) {
      const speaker = Common.pick(here);
      queue(speaker, fill(Common.pick(voice(speaker).human), death));
      const other = here.find((bot) => bot !== speaker);
      if (other && chance(0.4)) queue(other, fill(Common.pick(voice(other).human), death));
      return true;
    }
    const others = here.filter((bot) => bot !== death.bot).sort(() => Math.random() - 0.5);
    if (here.includes(death.bot)) {
      if (others.length && chance(0.35)) queue(others[0], fill(Common.pick(voice(others[0]).mate), death));
      queue(death.bot, fill(Common.pick(voice(death.bot).excuse), death));
      // A teammate always answers the excuse, so it never hangs there unanswered (kofi's call).
      const answer = others[0];
      if (answer) queue(answer, fill(Common.pick(voice(answer).reply), death));
    } else if (others.length) {
      queue(others[0], fill(Common.pick(voice(others[0]).mate), death));
    }
    return true;
  }

  /**
   * A rare in the team (onLoot; `bot` is null for the owner's): with four bots it's free for all, the bot's
   * to keep (kofi); a lone or duo bot's is kept for the Grand Exchange, sold and split once the owner leaves.
   */
  rareTalk(bot, rare) {
    if (!bot) return;
    const at = this.tick + randomInt(8, 14);
    if (this.size === "four") {
      const mate = Common.pick(this.bots.filter((other) => other !== bot && alive(other.player)));
      if (mate) this.lines.push({ bot: mate, text: Common.pick(FFA_LINES.rare), at, anywhere: true });
      return;
    }
    this.sales = [...(this.sales ?? []), { bot, item: rare.itemId }];
    const ways = String(this.bots.length + 1);
    this.lines.push({ bot, text: Common.pick(SALE_LINES.self).replace(/\{ways\}/g, ways), at, anywhere: true });
    note(`  ${bot.player.getUsername()} keeps its ${describeDrop(rare)} to sell at the grand exchange and split ${ways} ways`);
  }

  /** Four bots, once at the start (kofi): drops are free for all, and one agrees. */
  ffaTalk() {
    if (this.size !== "four" || this.ffaSaid) return false;
    const here = this.bots.filter((bot) => bot.entered && !bot.away && alive(bot.player));
    if (here.length < 2) return false;
    this.ffaSaid = true;
    const [first, second] = [...here].sort(() => Math.random() - 0.5);
    this.lines.push({ bot: first, text: Common.pick(FFA_LINES.start), at: this.tick });
    this.lines.push({ bot: second, text: Common.pick(FFA_LINES.agree), at: this.tick + 4 });
    this.nextChat = this.tick + 4 + randomInt(CHAT_GAP[0], CHAT_GAP[1]);
    return true;
  }

  /**
   * The owner's gone with a lone or duo bot's rare unsold (kofi): out of the chamber to the Grand Exchange,
   * the seller messages them, sells it, says the price and the split, and trades them their share; the
   * other bot (a duo) gets its cut there too, then they log off. The most valuable rare if there were more.
   */
  startTrip() {
    teams.delete(this.instance);
    const value = (sale) => Number(core.ItemDefinition.forId(sale.item)?.getGrandExchangeValue?.()) || 0;
    const going = this.bots.filter((bot) => bot.player.isRegistered());
    const sale = this.sales.filter((each) => going.includes(each.bot)).sort((a, b) => value(b) - value(a))[0];
    this.bots = [];
    if (!sale) {
      for (const bot of going) logout(bot.player);
      return;
    }
    const trip = new TripTeam(this.owner, going);
    const seller = trip.bots[going.indexOf(sale.bot)];
    trip.trip = new GeTrip(trip, seller, sale.item, { core, note, logout }, {
      shares: going.length + 1,
      ownerAway: (owner) => owner.getAttribute?.(Common.INSTANCE_ATTRIBUTE) !== true,
      owe: oweLater,
    });
    trips.add(trip);
    trip.trip.start();
    note(`${this.owner.getUsername()} left with ${seller.player.getUsername()}'s rare unsold - off to the grand exchange to split it ${going.length + 1} ways`);
  }

  disband() {
    teams.delete(this.instance);
    for (const bot of this.bots) logout(bot.player);
    this.bots = [];
  }
}

function spawnBot(instance, role, solo = false, size = solo ? "solo" : "four") {
  const at = instance.tile(Common.data.chamber.entry);
  // Male for now (kofi, 2026-11-06), as the Theatre's bots - the female look's void top doesn't draw yet.
  const player = createBotPlayer(Kit.freeName("Nex Helper"), at, { api, loadPersistence: false, saveRandomizedAppearance: false, gender: 0 });
  if (!player) return null;
  player.setPlayerBot(true);
  player.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  player.setAttribute(BOT_ATTRIBUTE, true);
  maxStats(player);
  player.setSpellbook(core.MagicSpellbook.ARCEUUS);
  // Ava's assembler on their quiver: 80% of ammo saved, none on the floor.
  player.setAttribute("dizanas-quiver:ava-recovery", 80);
  equip(player, role, solo, size);
  stock(player, role, solo, size);
  player.setRunning(true);
  api.emitPlayerLogin({ player, username: player.getUsername() });
  // After the login, which sets everyone's chat icons: an ironman bot's helmet before its name.
  player.setChatIcons?.(Roster.chatIconsOf(player.getUsername()));
  return player;
}

function logout(player) {
  if (!player?.isRegistered?.()) return;
  player.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  core.PrayerHandler.deactivatePrayers(player);
  // The finished forced timer lets it leave even mid-fight; the request is what queues it to go
  // (without it the bot stayed in the chamber and kept the fight on after its owner left).
  player.getForcedLogoutTimer().start(0);
  player.requestLogout();
}

// ------------------------------------------------------------------ hooks

function isBot(player) {
  return player?.getAttribute?.(BOT_ATTRIBUTE) === true;
}

/** A line in logs/nex-bots.log, for following a team from outside the game. */
/** What a bot decided and why, for the live log. */
function think(bot, text) {
  note(`  ${bot.player.getUsername()} (${bot.role}): ${text}`);
}

function note(text) {
  if (process.env.NEX_BOTS_LOG === "0") return;
  require("fs").appendFile(require("path").join(process.cwd(), "logs", "nex-bots.log"), `${new Date().toISOString().slice(11, 19)} ${text}\n`, () => {});
}

/** Whoever starts a private fight gets the team picked at the barrier; the public chamber has none. */
function onEntered({ player, instance }) {
  if (!player || player.isPlayerBot?.() === true || isBot(player)) return;
  if (instance.public) return;
  const owner = instance.owner;
  note(`${player.getUsername()} entered the private fight`
    + ` (owner ${owner?.getUsername?.() ?? "-"}, team ${teams.has(instance) ? "already here" : "none yet"})`);
  if (owner !== player || teams.has(instance)) return;
  const size = instance.botTeam ?? "none";
  if (size === "none") return;
  const team = new Team(instance, player, size);
  teams.set(instance, team);
  team.fill();
  player.sendMessage(TEAM_MESSAGES[team.size]);
}

function onLeft({ player, instance }) {
  const team = teams.get(instance);
  if (!team) return;
  if (isBot(player)) team.left(player);
  // A lone or duo bot's rare: off to the Grand Exchange to sell and split it with them (kofi).
  else if (player === team.owner) {
    if (team.sales?.length && team.size !== "four" && player.isRegistered?.()) team.startTrip();
    else team.disband();
  }
}

/** What Nex's hits are called when they kill someone (Fight.noteHit's kinds). */
// Bare, with no "a" or "her": the lines put their own words before them ("the {cause}", "{cause} got me").
const CAUSE_NAMES = {
  melee: "melee", smoke: "smoke barrage", shadow: "shadow shots", ice: "ice barrage", zaros: "zaros magic",
  blood: "blood barrage", darkness: "darkness", dash: "no escape", smash: "shadow smash", sacrifice: "blood sacrifice",
  containment: "containment", prison: "ice prison",
};

/** What killed `player` in `fight`: her last hit on them a moment ago, or else (unrecorded) a mage. */
function causeOf(fight, player) {
  const last = fight?.lastHitBy?.get(player);
  if (last && fight.tick - last.tick <= 3) return CAUSE_NAMES[last.kind] ?? last.kind;
  return "mages";
}

/**
 * A bot's death marks it, so leaving the instance sends it to the bank rather than home for good;
 * its human's death is remembered too. Either is talked about before the next kill (Team.deathTalk).
 */
function onDefeated({ victim }) {
  for (const team of teams.values()) {
    if (isBot(victim)) team.died(victim);
    else if (victim === team.owner) team.ownerDied();
  }
}

/** A bot's arrows and bolts are neither spent nor dropped: nothing piles up under her. */
function saveAmmo(request) {
  if (isBot(request?.player)) request.saved = true;
}

function processTeams() {
  for (const team of [...teams.values()]) team.process();
  for (const trip of [...trips]) {
    try {
      trip.process();
    } catch (error) {
      console.error("[nex bots] grand exchange trip failed", error);
    }
  }
}

/**
 * The bots of a lone or duo team out of the chamber, selling a rare (GeTrip.BossBots): the trip's own tick and
 * chat, each bot a light stand-in for its NexBot (player, persona, walkTo, think).
 */
class TripTeam {
  constructor(owner, bots) {
    this.owner = owner;
    this.bots = bots.map((bot) => ({
      player: bot.player,
      persona: bot.persona,
      scammer: bot.scammer,
      walkTo(tile) {
        const at = this.player.getLocation();
        if (at.getX() === tile.x && at.getY() === tile.y) return false;
        if (!this.player.getMovementQueue().isMovings?.() || this.walkingTo !== `${tile.x},${tile.y}`) {
          this.walkingTo = `${tile.x},${tile.y}`;
          this.player.setRunning(true);
          core.PathFinder.calculateWalkRoute(this.player, tile.x, tile.y);
        }
        return true;
      },
      think: (text) => think(bot, text),
    }));
    this.tick = 0;
    this.lines = [];
  }

  process() {
    this.tick++;
    // The owner logged out: the trip stops, every bot goes and the seller pays them when they're back (GeTrip.abandon).
    this.trip.tick();
    const next = this.lines[0];
    if (!next || this.tick < (this.speakAt ?? 0)) return;
    this.lines.shift();
    if (next.bot.player.isRegistered()) say(next.bot.player, next.text);
    this.speakAt = this.tick + Math.max(3, Math.min(10, Math.ceil(next.text.length / 6)));
  }

  disband() {
    trips.delete(this);
    for (const bot of this.bots) logout(bot.player);
    this.bots = [];
  }
}

/** A bot's run of zeros on Nex: after three, its next spec is likelier the Voidwaker that never misses. */
function countMisses({ npc, hit }) {
  const attacker = hit?.getAttacker?.();
  if (!attacker?.isPlayer?.() || !isBot(attacker.getAsPlayer())) return;
  for (const team of teams.values()) {
    const bot = team.bots.find((each) => each.player === attacker);
    const fight = team.instance.fight;
    if (bot && fight && bot.mdps && !bot.swap && [...fight.mages.values()].includes(npc)) bot.bookHit(bot.mdps, bot.mageWeapon(), hit.getTotalDamage());
    if (!bot || npc !== fight?.boss) continue;
    bot.misses = hit.getTotalDamage() > 0 ? 0 : (bot.misses ?? 0) + 1;
    if (bot.picksStyle() && bot.dps && !bot.swap && bot.dpsCounting) bot.bookHit(bot.dps, bot.style, hit.getTotalDamage());
    if (bot.picksWeapon() && bot.wdps && !bot.swap) bot.bookHit(bot.wdps, bot.weapon ?? "bow", hit.getTotalDamage());
  }
}

/**
 * ::nexgear's sets: the full Nex ranger set, the melee set alone, or the melee set with its ranged
 * switch in the inventory (the melee bots' own). What the player wore, carried and had in their
 * quiver goes to the bank first.
 */
/**
 * ::nexgear's inventories, laid out for a player in rows of four (the bots' KITS order their items for
 * the bots): the switch first, specs and utility, then potions, restores and food.
 */
const FREE_SLOT = "FREE_SLOT";
const PLAYER_INVENTORIES = {
  ranged: null, // the ranger kit's own layout
  full: [["TWISTED_BOW", 1], ["MASORI_MASK_F_", 1], ["MASORI_BODY_F_", 1], ["MASORI_CHAPS_F_", 1],
    ["DIZANAS_MAX_CAPE", 1], ["NECKLACE_OF_RUPTURE", 1], ["ZARYTE_VAMBRACES", 1], ["VENATOR_RING", 1],
    ["DRAGON_CLAWS", 1], ["VOIDWAKER", 1], ["RUNE_POUCH", 1], ["BOOK_OF_THE_DEAD", 1],
    // The free slot (where the defender goes when the bow does), just before the potions.
    [FREE_SLOT, 1],
    ["SUPER_COMBAT_POTION_4_", 1], ["RANGING_POTION_4_", 1], ["SUPER_RESTORE_4_", 5], ["SARADOMIN_BREW_4_", 8]],
  melee: [["DRAGON_CLAWS", 1], ["VOIDWAKER", 1], ["RUNE_POUCH", 1], ["BOOK_OF_THE_DEAD", 1],
    ["SUPER_COMBAT_POTION_4_", 2], ["SUPER_RESTORE_4_", 8], ["SARADOMIN_BREW_4_", 12], ["ANGLERFISH", 2]],
};

function giveKit(player, role, message, layout = "ranged") {
  const { Bank } = core;
  const bank = (entry) => {
    if (entry && entry.getId() > 0 && entry.getAmount() > 0) player.getBank(Bank.getTabForItem(player, entry.getId())).add(entry, false);
  };
  for (const entry of player.getEquipment().getCopiedItems()) bank(entry);
  for (const entry of player.getInventory().getCopiedItems()) bank(entry);
  const quivered = player.getAttribute(QUIVER_ATTRIBUTE);
  if (quivered?.id > 0 && quivered.amount > 0) bank(new core.Item(quivered.id, quivered.amount));
  if (player.isSpecialActivated?.()) core.CombatSpecial.activate(player);
  equip(player, role);
  stock(player, role);
  // Laid out from the top, with the rune pouch and the book of the dead always in the last two slots.
  const inventory = PLAYER_INVENTORIES[layout] ?? KITS[role].inventory;
  const items = player.getInventory();
  const slots = items.getItems().map(() => null);
  slots[slots.length - 2] = ["RUNE_POUCH", 1];
  slots[slots.length - 1] = ["BOOK_OF_THE_DEAD", 1];
  let next = 0;
  for (const [name, amount, stack] of inventory) {
    if (name === "RUNE_POUCH" || name === "BOOK_OF_THE_DEAD") continue;
    for (let i = 0; i < (stack ? 1 : amount); i++) slots[next++] = name === FREE_SLOT ? null : [name, stack ? amount : 1];
  }
  items.resetItems();
  slots.forEach((entry, slot) => {
    if (entry) items.setItem(slot, Kit.charge(entry[0], new core.Item(item(entry[0]), entry[1])));
  });
  items.refreshItems();
  if (layout === "melee") {
    // Just the melee set: no arrows in the ammo slot either.
    player.getEquipment().getItems()[core.Equipment.AMMUNITION_SLOT] = new core.Item(-1, 0);
    player.getEquipment().refreshItems();
    core.BonusManager.update(player);
  }
  // The quiver's Ava's assembler upgrade: 80% of shots saved, none dropped.
  player.setAttribute("dizanas-quiver:ava-recovery", Math.max(80, Number(player.getAttribute("dizanas-quiver:ava-recovery")) || 0));
  player.sendMessage(message);
  return true;
}

/** ::nexgear: a choice of set, in the chat menu the Ancient Barrier uses for picking bots. */
function nexGear({ player }) {
  api.sendMultiChatboxPrompt(player, "Which Nex set do you want?",
    "Maxed ranged set", () => giveKit(player, "ranged",
      "You're given a maxed ranged set, with ruby bolts in your quiver. What you had went to your bank."),
    "Maxed melee set", () => giveKit(player, "melee",
      "You're given a maxed melee set. What you had went to your bank.", "melee"),
    "Fully maxed set", () => giveKit(player, "melee",
      "You're given a fully maxed set: melee worn, a full ranged switch in your inventory. What you had went to your bank.", "full"));
  return true;
}

function describeDrop(drop) {
  const name = core.ItemDefinition.forId(drop.itemId)?.getName?.() ?? "an item";
  return drop.amount > 1 ? `${drop.amount} x ${name}` : name;
}

// ---------------------------------------------------------------- chat memory

/**
 * Which chats the bots have had at Nex, by kill, in the boss bots' shared chat memory (Memory.BossBots,
 * section "nex"; the old nex-bot-chats.json taken over once). None comes up again within 20 kills;
 * once a list has none left, fresh() gives null and they talk of something else or not at all.
 */
const NEX_CHATS = Memory.chatMemory("nex");
NEX_CHATS.importOnce(require("path").join(process.cwd(), "data", "saves", "nex-bot-chats.json"));

/** A kill's done: chats had 20 kills ago are free again. */
function chatKill() {
  NEX_CHATS.kill();
  Chatter.kill();
}

/** A pick from `list` the bots haven't had in the last 20 Nex kills, or null. */
function fresh(list, key) {
  return NEX_CHATS.fresh(list, key);
}

// ---------------------------------------------------------------- drop book

/**
 * Each bot's Nex drops, in the boss bots' shared drop book (Memory.BossBots): section "nex" for the
 * four-bot team and "nex [duo]" / "nex [solo]" for the smaller ones (bookName), each with its own
 * kills, dry spell (20 to 80, re-rolled after each rare) and last 100 drops. The old
 * nex-bot-drops.json is taken over once.
 */
const NEX_DROPS = Memory.dropBook("nex");
/** A bookName ("Torva Tom" / "Torva Tom [duo]") as [bot, variant]. */
function splitBookName(name) {
  const match = /^(.*) \[(\w+)\]$/.exec(name);
  return match ? [match[1], match[2]] : [name, null];
}
NEX_DROPS.importOnce(require("path").join(process.cwd(), "data", "saves", "nex-bot-drops.json"), splitBookName);

/**
 * The four-bot team's rangers weigh the Twisted bow against the Zaryte crossbow and buckler (ruby bolt
 * autos) the same way, each on its own clock: a random extra on its sample, hold and decay, so the two
 * never swap in step.
 */
const WEAPON_SETS = { bow: ["TWISTED_BOW", "DRAGON_ARROW"], crossbow: ["ZARYTE_CROSSBOW", "RUBY_DRAGON_BOLTS_E_", "TWISTED_BUCKLER"] };

/**
 * How a bot settles on a style or weapon, as a player would rather than a meter: the best by measured
 * damage (DAMAGE_TABLE), kept through bad luck, with a try of something else only after a bad streak
 * (STREAK); a switch made a moment after the decision (DECIDE_DELAY), kept a while if it worked
 * (COMMIT_TICKS).
 */
/**
 * Measured damage (2,000 real hit rolls each, maxed and boosted, Zeal / Rigour): [per hit, per tick]
 * on Nex and on her mages (their average). The best is each bot's main choice; the rest are tried only
 * after a bad streak (STREAK).
 */
const DAMAGE_TABLE = {
  nex: { melee: [19.5, 3.89], ranged: [18.0, 4.49], bow: [18.0, 4.49], crossbow: [14.6, 2.92] },
  mage: { melee: [18.8, 3.76], bow: [29.3, 7.32], blowpipe: [12.0, 6.0] },
};
/**
 * A bad streak: the main choice's last STREAK.hits hits averaging under STREAK.low of what it should
 * do. Then, a STREAK.chance of trying another for a few hits (STREAK.trialTicks), kept only if it beats
 * the main choice's expected damage by STREAK.keep (and then only for COMMIT_TICKS); at most
 * STREAK.perKill tries a kill. Mostly they just keep hitting: low rolls happen.
 */
const STREAK = { hits: 5, low: 0.4, chance: 0.35, trialTicks: [10, 20], keep: 1.25, perKill: 2 };
const COMMIT_TICKS = [90, 180];
const DECIDE_DELAY = [1, 3];
const SWITCH_LINES = {
  melee: ["fang's hitting harder", "back to melee, bow felt weak", "melee it is", "she's soft to stab today"],
  ranged: ["bow's hitting better today", "trying range for a bit", "tbow time", "range feels better on her"],
  bow: ["bow's doing more", "back to the tbow", "crossbow was meh", "tbow it is"],
  crossbow: ["ruby bolts proccing nicely", "trying the zcb", "crossbow time", "bolts are hitting"],
};

/** How often a bot rushed by Nex takes her one melee hit before the reset. */
const TAKE_HIT_CHANCE = 0.5;

/** The lone bot out of food prays Redemption below this share of its hitpoints (it fires under 10%). */
const REDEMPTION_AT = 0.3;
/** The lone bot out of food and restores too: it says one of these and teleports out ({owner}: its human). */
const OUT_OF_SUPPLIES = [
  "sorry, i'm out", "out of food, i'm off - gl {owner}", "that's me done, sorry {owner}", "no food, no restores, tapping out",
  "sorry {owner}, bailing", "i'm out, don't die", "i have nothing left, teleporting", "brews gone. i'm gone. sorry",
  "{owner} you're on your own, i'm so sorry", "nope, i'm out of here", "dry on food. bye", "out. i'll be back with snacks",
];

/** This bot's Nex section of the drop book, or null before its first kill there. */
function peekBook(name) {
  return NEX_DROPS.peek(...splitBookName(name));
}

function recordDrops(name, drops, rare) {
  const [bot, variant] = splitBookName(name);
  NEX_DROPS.record(bot, drops.map(describeDrop), rare ? describeDrop(rare) : null, variant);
}

/** Kills since this bot's last rare here when it's past its dry spell, otherwise 0. */
function dryFor(name) {
  return NEX_DROPS.dryFor(...splitBookName(name));
}

/** Kills since this bot's last rare here while that's recent, otherwise 0. */
function luckyFor(name) {
  return NEX_DROPS.luckyFor(...splitBookName(name));
}


/** Nex's loot for a team member: a bot's share is its own to pick up; a rare stops the team for a gz. */
function onLoot(share) {
  for (const team of teams.values()) {
    if (team.instance.fight !== share.fight && team.instance.fight != null) continue;
    const bot = team.bots.find((each) => each.player === share.player);
    if (!bot && share.player !== team.owner) continue;
    const rare = share.drops.find((drop) => RARE_DROP.test(core.ItemDefinition.forId(drop.itemId)?.getName?.() ?? ""));
    // Once the loot's down, the team has its say about it (Team.afterKillChat).
    if (team.postKillFor !== share.fight) {
      team.postKillFor = share.fight;
      chatKill();
      team.postKill = { at: (team.tick ?? 0) + randomInt(2, 4) };
    }
    if (bot) {
      bot.loot = { drops: share.drops, where: share.where, at: bot.tick };
      share.taken = true;
      recordDrops(team.bookName(bot), share.drops, rare);
    }
    if (rare) team.rareTalk(bot, rare);
    if (rare) {
      team.celebrate = { player: share.player, item: describeDrop(rare), until: (team.tick ?? 0) + RESTOCK_AFTER_KILL_TICKS + randomInt(8, 12) };
      for (const each of team.bots) each.saidGz = false;
      note(`  RARE DROP: ${share.player.getUsername()} got ${describeDrop(rare)} - the team stops to say gz`);
    }
  }
}

function attachBots(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  Kit.init(pluginApi);
  api.onCustomEvent("nex:instance-entered", onEntered);
  api.onCustomEvent("nex:instance-left", onLeft);
  api.onPlayerDefeated(onDefeated);
  api.onCustomEvent("combat:ammo-saving", saveAmmo);
  api.onCustomEvent("nex:loot", onLoot);
  api.onNpcHitModify(countMisses);
  api.registerCommand("nexgear", nexGear, core.PlayerRights.DEVELOPER, "Pick a Nex set: maxed ranged, maxed melee, or fully maxed (what you had goes to your bank)");
  const task = new core.Task(1);
  task.execute = processTeams;
  core.TaskManager.submit(task);
}

module.exports = { attachBots, NexBot, Team, KITS, isBot, _test: { teams, doses, onEntered, onLeft } };
