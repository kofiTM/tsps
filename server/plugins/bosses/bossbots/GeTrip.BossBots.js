"use strict";

/**
 * A boss bot's rare, sold and split (kofi): moved out of the Theatre of Blood's Split.TheatreOfBlood.js so any
 * boss's bot team can use it (the Nex bots first). The bots go straight out from where they are with a house
 * tablet, come out by their house's jewellery box at the Grand Exchange one by one, and the bot with the unique
 * private messages the team's owner, sells it to a Grand Exchange clerk (20-30 seconds) and, once the owner is in
 * sight, trades them their share - a real trade. Then it hands the other bots their shares (simulated, with
 * thanks), and each teleports out and logs off. King of TOB's share counts towards his cash made (Memory.addCash).
 * The Theatre's own copy (with its vault crystal and Ver Sinhaza bank route) stays in Split.TheatreOfBlood.js.
 * Tiles: the clerks' (3164-3165, 3488/3491, npc-spawns), Rimmington's house portal. The price is the item's
 * Grand Exchange value.
 */

const Memory = require("./Memory.BossBots");
const Scam = require("./Scam.BossBots");

/** Ticks after the last chest is opened before the first bot leaves, and between each leaving. */
// Straight off once the gz and kc are said (kofi: 1-5 ticks).
const LEAVE_AFTER = [1, 5];
// The rest close behind the first out of the vault (kofi: 1-2 ticks).
const LEAVE_GAP = [1, 2];
/** Where a house teleport lands (Rimmington's portal): the bot is unseen there, "inside" (no house is built for it). */
const HOUSE = { x: 2953, y: 3222, z: 0 };
/** Ticks for the house tablet's teleport to land. */
const HOUSE_LAND = 4;
/** Unseen while it's inside its house: the invisible NPC ::invis uses (AdminCommands). */
const INSIDE_HOUSE_NPC = 11858;
// Inside the house, the run to its jewellery box (kofi: a little delay).
const HOUSE_TICKS = [6, 10];
/** Where they land at the Grand Exchange (south of the clerks), and the clerks' booths. */
const GE = { minX: 3161, maxX: 3168, minY: 3477, maxY: 3482 };
const CLERKS = [
  { stand: { x: 3164, y: 3486 }, clerk: { x: 3164, y: 3488 } }, { stand: { x: 3165, y: 3486 }, clerk: { x: 3165, y: 3488 } },
  { stand: { x: 3164, y: 3493 }, clerk: { x: 3164, y: 3491 } }, { stand: { x: 3165, y: 3493 }, clerk: { x: 3165, y: 3491 } },
];
/** Ticks: after landing before the private message, at the clerk (kofi: 20-30 s), and walking anywhere at most. */
const PM_DELAY = [3, 8];
const SELL_TICKS = [33, 50];
const WALK_GIVE_UP = 30;
/** The owner in sight (tiles), a trade request again after this long, a reminder after this long, giving up after. */
const SIGHT = 12;
/** At the Grand Exchange the seller trades from its spot to anyone this near (kofi: it waited for 12 tiles). */
const GE_REACH = 20;
/**
 * The coins offered as a person would (kofi): a moment after the trade screen opens, then typed in - a tick
 * for every two digits of the amount - and accepted a moment after that, never with nothing offered.
 */
const OFFER_DELAY = [2, 4];
const ACCEPT_DELAY = [2, 4];
/** Ticks the seller keeps facing a bot it's handing a cut to. */
const FACE_TICKS = 5;
/** Where the others stand round the seller's trade spot (kofi: the team together by the Grand Exchange). */
const AROUND = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }];
const REQUEST_EVERY = 25;
const REMIND_EVERY = 150;
const GIVE_UP = 1500;
/** Between each bot's cut, and between each one teleporting out at the end. */
const SPLIT_GAP = [6, 12];
const BYE_GAP = [4, 10];
/** Where they teleport out to before logging off. */
const AWAY = { x: 3222, y: 3218, z: 0 };
const MAX_COINS = 2147483647;
const SHARES = 5;
/** King of TOB's persona (King.TheatreOfBlood.js PERSONA): his share goes to his cash made. */
const KING_PERSONA = "king";

/** {owner}, {item}, {price}, {share}, {name}, {total} are filled in. */
const LINES = {
  // The seller as they set off (kofi): off to the Grand Exchange now.
  go: ["lets go to the ge now", "ge time, lets go", "lets go sell this at the ge", "right, ge now everyone", "lets head to the ge and split it",
    "off to the ge, follow me", "ge now, lets get this sold"],
  pm: [
    "at the ge, come meet me - selling the {item} and splitting it {ways} ways", "got to the ge, meet me here for your cut of the {item}",
    "ge now, selling the {item}. come get your split", "i'm at the grand exchange, come over and i'll trade you your share",
    "meet me at the ge {owner}, splitting the {item} with everyone",
  ],
  remind: ["still at the ge, come get your cut of the {item}", "waiting at the ge for you {owner}", "{owner} you coming to the ge? got your split"],
  sold: ["sold the {item} for {price}", "{item} sold, {price}. splitting it now", "ka-ching, {price} for the {item}", "{price} for the {item}, not bad"],
  // The split worked out before the owner's trade (kofi): the price over the five of them.
  math: ["{price} split {ways} ways is {share} each", "{price} / {ways} = {share} each", "so that's {share} each, {ways} way split",
    "{ways} ways, {share} a person", "{price} between {ways} of us, {share} each", "works out at {share} each"],
  owner: ["there's your {share} {owner}", "{owner} your cut, {share}", "{share} for you {owner}, gg", "your share {owner}, ty for the raid"],
  give: ["here's yours {name}, {share}", "{name}, your cut", "{share} for you {name}", "{name} here you go"],
  thanks: ["tyfr", "tyfk", "thank you for the raid", "ty for the split", "tyty", "ty! gg", "thanks for the cut", "legend, ty", "ty, great raid", "tysm"],
  kingThanks: ["the treasury thanks you. that's {total} made in my theatre", "a royal tax of {share}. {total} made all time",
    "graciously accepted. the crown has made {total}", "{total} earned in the theatre, and counting"],
  bye: ["tyfks everyone", "gg all, see you next raid", "ty all, cya", "that was fun, gg", "tyfr everyone, gl", "gg, until next time",
    "ty for the raid everyone", "cya at the next raid"],
  kingBye: ["my court is dismissed. until next raid", "the king retires to the throne. tyfks all", "gg, my court. the theatre awaits our return"],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const same = (a, b) => a.x === b.x && a.y === b.y;

// ---------------------------------------------------------------- small map and task helpers (as the Theatre's Shared)

let core = null;

function loc(tile, z) {
  return new core.Location(tile.x, tile.y, z ?? tile.z ?? 0);
}

function tileOf(entity) {
  const location = entity.getLocation();
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

function floorFree(area, tile) {
  return !core.RegionManager.blocked(tile.getX ? tile : loc(tile), area);
}

/** Chebyshev distance from a tile to an actor's footprint (0 when on it). */
function distanceTo(actor, tile) {
  const at = actor.getLocation();
  const size = actor.getSize?.() ?? 1;
  const x = tile.getX ? tile.getX() : tile.x;
  const y = tile.getY ? tile.getY() : tile.y;
  const dx = x < at.getX() ? at.getX() - x : x > at.getX() + size - 1 ? x - (at.getX() + size - 1) : 0;
  const dy = y < at.getY() ? at.getY() - y : y > at.getY() + size - 1 ? y - (at.getY() + size - 1) : 0;
  return Math.max(dx, dy);
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function later(key, ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), key, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/**
 * A free tile to land on at the Grand Exchange (kofi: one landed on a blocked tile and couldn't move): every
 * tile in the GE box is checked once against the map's clipping, and a landing is one of the free ones.
 */
let geFree = null;
function geLanding() {
  if (!geFree) {
    geFree = [];
    const blocked = [];
    for (let x = GE.minX; x <= GE.maxX; x++) {
      for (let y = GE.minY; y <= GE.maxY; y++) (floorFree(null, { x, y, z: 0 }) ? geFree : blocked).push({ x, y, z: 0 });
    }
    if (blocked.length) console.log(`[boss bots] GE landing: ${blocked.length} blocked tiles left out (${blocked.map((t) => `${t.x},${t.y}`).join(" ")})`);
  }
  return { ...pick(geFree.length ? geFree : [{ x: 3164, y: 3480, z: 0 }]) };
}

/** `owner` online and within GE_REACH of `player`, on its floor. */
function nearby(player, owner) {
  return !!owner?.isRegistered?.() && owner.getLocation().getZ() === player.getLocation().getZ()
    && distanceTo(player, tileOf(owner)) <= GE_REACH;
}

/**
 * A bot's side of a trade it's paying into (`trading` its Trading, `share` the coins): the coins put in a
 * little after the screen opens, as if typed (OFFER_DELAY, a tick per two digits), then accepted a moment later
 * (ACCEPT_DELAY) - never accepting while its offer is short. `memo` keeps its timings. True once accepted.
 */
function offerAndAccept(core, memo, tick, player, trading, share) {
  const coins = core.ItemIdentifiers.COINS;
  const offered = trading.getContainer().getItems().reduce((sum, item) => sum + (item?.getId?.() === coins ? item.getAmount() : 0), 0);
  if (offered < share) {
    memo.offerAt ??= tick + randomInt(...OFFER_DELAY) + Math.ceil(String(share).length / 2);
    if (tick < memo.offerAt) return false;
    memo.offerAt = null;
    const inventory = player.getInventory();
    const slot = inventory.getItems().findIndex((held) => held?.getId?.() === coins);
    if (slot >= 0) trading.handleItem(coins, share - offered, slot, inventory, trading.getContainer());
    memo.acceptAt = tick + randomInt(...ACCEPT_DELAY);
    return false;
  }
  if (tick < (memo.acceptAt ?? 0)) return false;
  // Pressed again each tick till it takes (Trading's button delay can refuse a press, kofi: it stalled).
  trading.acceptTrade();
  return trading.getState() !== core.TradeState.TRADE_SCREEN;
}

class GeTrip {
  /**
   * `seller` is the bot with the unique, `item` its id; `tools` the bot file's note and logout and the core api
   * ({ core, note, logout }). `options`: `shares` (the owner and the bots), `ownerAway(owner)` (out of the fight,
   * so the trade can start; required) and `owe(debt)` (keep an unpaid share for later, if the server pays back).
   */
  constructor(team, seller, item, tools, options = {}) {
    this.team = team;
    this.seller = seller;
    this.tools = tools;
    core = tools.core;
    this.item = item;
    this.itemName = (core.ItemDefinition.forId(item)?.getName?.() ?? "unique").replace(/ \(uncharged\)$/i, "").toLowerCase();
    this.price = Math.max(0, Number(core.ItemDefinition.forId(item)?.getGrandExchangeValue?.()) || 0);
    this.shares = options.shares ?? SHARES;
    this.firstStep = "out";
    this.ownerAway = options.ownerAway ?? (() => true);
    this.owe = typeof options.owe === "function" ? options.owe : null;
    this.share = Math.min(MAX_COINS, Math.floor(this.price / this.shares));
    this.started = false;
    this.stage = "travel";
    this.done = false;
  }

  /** The chests are done: the seller says it's off to the GE (kofi), after anything still being said. */
  /** `quiet`: no "lets go to the ge" (King of TOB's pickup line already said it). */
  start({ quiet = false } = {}) {
    if (this.started) return;
    this.started = true;
    this.startedAt = this.team.tick;
    if (!quiet) this.team.lines.push({ bot: this.seller, text: this.fill(pick(LINES.go)) });
    this.tools.note(`  ${this.seller.player.getUsername()} has a ${this.itemName} (${this.price}): off to the grand exchange to split it`);
  }

  fill(text, extra = {}) {
    const coins = (value) => Memory.formatCash(BigInt(value));
    return text.replace(/\{owner\}/g, this.team.owner.getUsername()).replace(/\{item\}/g, this.itemName)
      .replace(/\{price\}/g, coins(this.price)).replace(/\{share\}/g, coins(this.share))
      .replace(/\{ways\}/g, String(this.shares)).replace(/\{name\}/g, extra.name ?? "").replace(/\{total\}/g, extra.total ?? "");
  }

  say(bot, list, extra) {
    this.team.lines.push({ bot, text: this.fill(pick(list), extra) });
  }

  /** A private message to the owner (kofi), or a "From" line in their chat when their private chat won't take it. */
  pm(text) {
    const owner = this.team.owner;
    const sender = this.seller.player;
    const event = { sender, recipient: owner, text: this.fill(text), sent: false };
    core.PluginManager.emitCustomEvent("friends:send-private-message", event);
    if (!event.sent) owner.sendMessage(`<col=00ffff>From ${sender.getUsername()}: ${event.text}</col>`);
    this.tools.note(`  PM ${sender.getUsername()} -> ${owner.getUsername()}: ${event.text}${event.sent ? "" : " (as a chat line)"}`);
  }

  ownerHere() {
    const owner = this.team.owner;
    return owner.isRegistered?.() && this.ownerAway(owner) ? owner : null;
  }

  /** Its line said (kofi: and it goes at once): the seller first, 1-5 ticks on, then the rest in turn. */
  depart() {
    const team = this.team;
    this.departed = true;
    let at = team.tick + randomInt(...LEAVE_AFTER);
    for (const bot of [this.seller, ...shuffle(team.bots.filter((other) => other !== this.seller))]) {
      bot.trip = { step: this.firstStep, at };
      at += randomInt(...LEAVE_GAP);
    }
  }

  tick() {
    if (this.done) return;
    // The owner logged out (kofi): everyone goes at once, the seller back when they are, to pay them.
    if (!this.team.owner.isRegistered?.()) {
      this.abandon();
      return;
    }
    if (!this.departed) {
      if (this.team.lines.length) return;
      this.depart();
    }
    for (const bot of this.team.bots) if (bot.player.isRegistered()) this.travel(bot);
    this.gather();
    this.face();
    if (this.stage === "scammed") {
      this.angry();
      return;
    }
    if (this.seller.trip?.step === "ge") this.sell();
    if (this.stage === "split") this.split();
    if (this.stage === "bye") this.bye();
  }

  // ---------------------------------------------------------------- getting there

  travel(bot) {
    const { core } = this.tools;
    const team = this.team;
    const trip = bot.trip;
    const player = bot.player;
    if (!trip || team.tick < trip.at) return;
    // Straight off from where it is (another boss): its bag emptied for the coins, then a house tablet.
    if (trip.step === "out") {
      player.getMovementQueue().reset();
      this.emptyBag(bot);
      core.TeleportHandler.teleport(player, loc(HOUSE), core.TeleportType.TELE_TAB, false);
      trip.step = "house";
      trip.at = team.tick + HOUSE_LAND;
      trip.since = null;
      bot.think("house teleport - into the house, jewellery box to the grand exchange");
      return;
    }
    // A house tablet lands inside the house (kofi: as in OSRS, its Break), so it's unseen by anyone outside (as
    // ::invis) till it comes out by its jewellery box at the Grand Exchange a while later.
    if (trip.step === "house") {
      player.setNpcTransformationId?.(INSIDE_HOUSE_NPC);
      trip.step = "inside";
      trip.at = team.tick + randomInt(...HOUSE_TICKS);
      bot.think("inside its house");
      return;
    }
    if (trip.step === "inside") {
      player.setNpcTransformationId?.(-1);
      const to = geLanding();
      core.TeleportHandler.teleport(player, loc(to), core.TeleportType.NORMAL, false);
      trip.step = "ge";
      trip.landedAt = team.tick + 3;
      bot.think("at the grand exchange");
    }
  }

  /** A bot's bag emptied for the Grand Exchange: all but the item the seller is taking there to sell. */
  emptyBag(bot) {
    const inventory = bot.player.getInventory();
    const keep = bot === this.seller && inventory.contains?.(this.item);
    inventory.resetItems();
    if (keep) inventory.adds(this.item, 1);
    inventory.refreshItems?.();
  }

  /**
   * Where the seller looks at its spot by the booths (kofi: it stood facing south): at the bot it's paying while
   * it hands over, otherwise at the clerk - not while walking or trading the owner.
   */
  face() {
    const seller = this.seller;
    const player = seller.player;
    if (!this.clerk || !player.isRegistered()) return;
    // Moving, or trading the owner: it turns again once it's still and free (wherever it stands, kofi: a tile off
    // its spot it never turned).
    if (player.getMovementQueue().isMovings?.() || player.getTrading().getState() !== this.tools.core.TradeState.NONE) {
      this.lookingAt = null;
      return;
    }
    // The bot coming over for its cut from the moment it sets off (kofi: before the hand-over), else the clerk.
    const coming = this.stage === "split" ? this.queue?.[0] : null;
    const toward = coming?.player.isRegistered() ? coming
      : this.facing && this.team.tick < this.facing.until && this.facing.bot.player.isRegistered() ? this.facing.bot : null;
    const look = toward ? tileOf(toward.player) : this.clerk.clerk;
    const key = `${look.x},${look.y}`;
    if (this.lookingAt === key) return;
    this.lookingAt = key;
    player.setPositionToFace?.(loc({ x: look.x, y: look.y, z: 0 }));
  }

  /** The others at the Grand Exchange stand round the seller's trade spot (kofi), till each is given its cut. */
  gather() {
    const spot = this.clerk?.stand;
    if (!spot || this.stage === "bye" || this.stage === "scammed") return;
    const others = this.team.bots.filter((bot) => bot !== this.seller && bot.player.isRegistered() && bot.trip?.step === "ge"
      && this.team.tick >= (bot.trip.landedAt ?? 0) && !(this.queue && !this.queue.includes(bot) && this.stage === "split"));
    others.forEach((bot, index) => {
      const offset = AROUND[index % AROUND.length];
      const tile = { x: spot.x + offset.x, y: spot.y + offset.y };
      if (this.stage === "split" && this.queue?.[0] === bot) return;
      if (!floorFree(null, { ...tile, z: 0 })) return;
      if (!same(tileOf(bot.player), tile)) bot.walkTo(tile);
    });
  }

  // ---------------------------------------------------------------- the sale and the owner's cut

  sell() {
    const { core } = this.tools;
    const team = this.team;
    const bot = this.seller;
    const player = bot.player;
    const trip = bot.trip;
    if (team.tick < trip.landedAt) return;
    // Shortly after landing (kofi): a private message to come and meet it.
    if (!this.pmSent) {
      this.pmAt ??= trip.landedAt + randomInt(...PM_DELAY);
      if (team.tick < this.pmAt) return;
      this.pmSent = true;
      this.remindAt = team.tick + REMIND_EVERY;
      // No "come to the ge" to an owner already there with it (kofi).
      if (!nearby(player, team.owner)) this.pm(pick(LINES.pm));
      // Always the south booths (kofi: the far side moved the trade spot), the ones by where they land.
      this.clerk = pick(CLERKS.filter((clerk) => clerk.stand.y < clerk.clerk.y));
      this.walkSince = team.tick;
      this.stage = "clerk";
    }
    if (this.stage === "clerk") {
      // To its spot in front of the clerk's booth (`clerk.stand`; the tile by the clerk is the counter, kofi: it
      // stood stuck where it landed), sells facing the clerk, and trades from there.
      if (!same(tileOf(player), this.clerk.stand) && team.tick - this.walkSince < WALK_GIVE_UP) {
        bot.walkTo(this.clerk.stand);
        return;
      }
      player.setPositionToFace?.(loc({ ...this.clerk.clerk, z: 0 }));
      this.soldAt = team.tick + randomInt(...SELL_TICKS);
      this.stage = "selling";
      bot.think(`selling the ${this.itemName} to the clerk`);
      return;
    }
    if (this.stage === "selling") {
      if (team.tick < this.soldAt) return;
      // Sold (kofi: the item gone with the sale, not before): it leaves its bag, and the owner's fifth goes in
      // for the trade (the bots' fifths are handed over in the split).
      if (player.getInventory().contains?.(this.item)) player.getInventory().delete(this.item, 1);
      player.getInventory().adds(core.ItemIdentifiers.COINS, this.share);
      player.getInventory().refreshItems?.();
      this.tools.note(`  ${player.getUsername()} sold the ${this.itemName} - it's gone from its bag`);
      this.stage = "back";
      this.walkSince = team.tick;
      return;
    }
    // Back to its spot by the booths, the team round it, to trade (kofi).
    if (this.stage === "back") {
      if (!same(tileOf(player), this.clerk.stand) && team.tick - this.walkSince < WALK_GIVE_UP) {
        bot.walkTo(this.clerk.stand);
        return;
      }
      this.stage = "owner";
      return;
    }
    if (this.stage === "owner") this.tradeOwner();
  }

  /** The owner's cut, a real trade (kofi: before any bot gets theirs) - asked for once they're in sight. */
  tradeOwner() {
    const { core } = this.tools;
    const team = this.team;
    const bot = this.seller;
    const player = bot.player;
    const owner = this.ownerHere();
    if (!owner) {
      // Gone (logged out) or not out of the theatre yet: a reminder now and then, and in the end it goes.
      if (!team.owner.isRegistered?.() || team.tick - this.startedAt > GIVE_UP) this.finishWithoutOwner();
      return;
    }
    // The owner in sight (kofi): what it sold for and the split worked out, both said before the trade is asked for.
    const inSight = distanceTo(player, tileOf(owner)) <= GE_REACH && owner.getLocation().getZ() === player.getLocation().getZ();
    if (!this.announced && !inSight) {
      if (team.tick >= this.remindAt) {
        this.remindAt = team.tick + REMIND_EVERY;
        this.pm(pick(LINES.remind));
      }
      if (team.tick - this.startedAt > GIVE_UP) this.finishWithoutOwner();
      return;
    }
    if (!this.announced) {
      this.announced = true;
      this.say(bot, LINES.sold);
      this.say(bot, LINES.math);
      return;
    }
    const coins = player.getInventory().getAmount(core.ItemIdentifiers.COINS);
    const trading = player.getTrading();
    const state = trading.getState();
    const { TradeState } = core;
    // The trade's gone through: the coins are the owner's.
    if (coins < this.share && (state === TradeState.NONE || state === TradeState.REQUESTED_TRADE)) {
      this.say(bot, LINES.owner);
      this.tools.note(`  ${player.getUsername()} traded ${owner.getUsername()} ${this.share} coins`);
      this.ownerPaid = true;
      this.stage = "split";
      this.splitAt = team.tick + randomInt(...SPLIT_GAP);
      this.queue = shuffle(team.bots.filter((other) => other !== bot && other.player.isRegistered()));
      if (bot.persona === KING_PERSONA) this.kingCash(bot);
      return;
    }
    // A scammer (kofi): the moment the owner's in the trade, he cancels it and is off with the lot.
    if (bot.scammer && state === TradeState.TRADE_SCREEN) {
      trading.closeTrade();
      this.scam();
      return;
    }
    // The coins typed in a little late, then accepted (kofi: it accepted a trade with nothing in it).
    if (state === TradeState.TRADE_SCREEN) {
      this.offer ??= {};
      if (offerAndAccept(core, this.offer, team.tick, player, trading, this.share)) this.tools.note(`  ${player.getUsername()} put in ${this.share} coins and accepted`);
      return;
    }
    // The second screen accepted too - pressed each tick till it takes (kofi: stuck on the second screen).
    if (state === TradeState.CONFIRM_SCREEN) {
      trading.acceptTrade();
      return;
    }
    if (state !== TradeState.NONE && state !== TradeState.REQUESTED_TRADE) return;
    this.accepted2 = false;
    this.offer = null;
    // A new request waits for what it's still saying (kofi: a trade already open is never held up by its talk).
    if (team.lines.some((line) => line.bot === bot) && !this.ownerPaid) return;
    const far = distanceTo(player, tileOf(owner)) > GE_REACH || owner.getLocation().getZ() !== player.getLocation().getZ();
    if (far) {
      if (team.tick >= this.remindAt) {
        this.remindAt = team.tick + REMIND_EVERY;
        this.pm(pick(LINES.remind));
      }
      if (team.tick - this.startedAt > GIVE_UP) this.finishWithoutOwner();
      return;
    }
    // In sight (kofi): over to them and a trade request, again now and then till they take it.
    if (team.tick < (this.requestAt ?? 0)) return;
    this.requestAt = team.tick + REQUEST_EVERY;
    this.armTrade(bot);
    player.getMovementQueue().walkToEntity(owner, () => trading.requestTrade(owner));
    bot.think(`trading ${owner.getUsername()} their cut`);
  }

  /** The trade screen's hooks (Trading.ts): the cut put in when it opens, accepted once the owner accepts. */
  armTrade(bot) {
    const { core } = this.tools;
    const player = bot.player;
    player.getTradingInteraction = () => ({
      acceptTradeRequest: () => {},
      // The coins go in a moment later, typed (offerAndAccept).
      addItemsToTrade: () => {},
      offerChanged: () => {
        if (this.offer) this.offer.accepted = false;
        this.accepted2 = false;
      },
      acceptTrade: () => {},
      receivedItems: () => {},
    });
  }

  // ---------------------------------------------------------------- the bots' cuts

  split() {
    const team = this.team;
    const seller = this.seller;
    if (team.tick < this.splitAt) return;
    const next = this.queue[0];
    if (!next) {
      this.stage = "bye";
      this.byeAt = team.tick + randomInt(...BYE_GAP);
      this.byeQueue = shuffle(team.bots.filter((bot) => bot.player.isRegistered()));
      return;
    }
    // Each comes over to the seller for its cut, then thanks (simulated: no trade screen).
    if (next.trip?.step !== "ge" || team.tick < next.trip.landedAt) return;
    const near = distanceTo(next.player, tileOf(seller.player)) <= 1;
    next.splitSince ??= team.tick;
    if (!near && team.tick - next.splitSince < WALK_GIVE_UP) {
      if (!next.player.getMovementQueue().isMovings?.()) next.player.getMovementQueue().walkToEntity(seller.player, () => {});
      return;
    }
    this.queue.shift();
    next.player.setPositionToFace?.(seller.player.getLocation());
    seller.player.setPositionToFace?.(next.player.getLocation());
    // Each other for the hand-over (kofi: it never looked at them), held a few ticks (face()).
    this.facing = { bot: next, until: team.tick + FACE_TICKS };
    this.say(seller, LINES.give, { name: next.player.getUsername() });
    if (next.persona === KING_PERSONA) this.kingCash(next);
    else this.say(next, LINES.thanks);
    this.tools.note(`  ${seller.player.getUsername()} gave ${next.player.getUsername()} ${this.share} coins (simulated)`);
    this.splitAt = team.tick + randomInt(...SPLIT_GAP);
  }

  /**
   * The scam (kofi): "haha scammed", a parting shot and he teleports off with it; the rest are angry for
   * about 30 seconds (Scam.ANGRY, each in its own voice), then teleport off themselves - no cuts for anyone.
   */
  scam() {
    const { core } = this.tools;
    const team = this.team;
    const seller = this.seller;
    const player = seller.player;
    this.stage = "scammed";
    this.say(seller, Scam.SCAMMED);
    this.say(seller, Scam.SCAM_BYE);
    this.tools.note(`  ${player.getUsername()} SCAMMED ${team.owner.getUsername()} out of the ${this.itemName}`);
    later(player, 8, () => {
      if (!player.isRegistered()) return;
      player.getInventory().resetItems().refreshItems();
      core.TeleportHandler.teleport(player, loc(AWAY), core.TeleportType.NORMAL, false, () => this.tools.logout(player));
    });
    this.angryAt = team.tick + 10;
    this.angryUntil = team.tick + 10 + Scam.ANGRY_TICKS;
    this.angryQueue = [];
  }

  /** The others after a scam: angry lines a few ticks apart till ANGRY_TICKS, then off home without a goodbye. */
  angry() {
    const team = this.team;
    if (team.tick < this.angryAt) return;
    const others = team.bots.filter((bot) => bot !== this.seller && bot.player.isRegistered());
    if (team.tick >= this.angryUntil || !others.length) {
      this.stage = "bye";
      this.quietBye = true;
      this.byeAt = team.tick + randomInt(...BYE_GAP);
      this.byeQueue = shuffle(others);
      return;
    }
    // Each in turn, each line of its own said once (kofi: the King said "treason" four times running); a bot out
    // of lines is done, and once they all are, they go.
    this.angrySaid ??= new Map();
    const unsaid = (bot) => (Scam.ANGRY[bot.persona] ?? Scam.ANGRY.chill).filter((line) => !this.angrySaid.get(bot)?.has(line));
    const talking = others.filter((bot) => unsaid(bot).length);
    if (!talking.length) {
      this.angryUntil = team.tick;
      return;
    }
    if (!this.angryQueue.some((bot) => talking.includes(bot))) this.angryQueue = shuffle(talking);
    const bot = this.angryQueue.shift();
    if (!talking.includes(bot)) return;
    const line = pick(unsaid(bot));
    if (!this.angrySaid.has(bot)) this.angrySaid.set(bot, new Set());
    this.angrySaid.get(bot).add(line);
    team.lines.push({ bot, text: this.fill(line) });
    this.angryAt = team.tick + randomInt(...Scam.ANGRY_GAP);
  }

  /** King of TOB's fifth to his cash made (kofi: past 2,147m, said as 1b, 1t, 1qt...). */
  kingCash(bot) {
    this.kingPaid = true;
    const total = Memory.addCash(bot.player.getUsername(), this.share);
    this.say(bot, LINES.kingThanks, { total: Memory.formatCash(total) });
    this.tools.note(`  King of TOB has made ${total} coins in the theatre`);
  }

  // ---------------------------------------------------------------- off home

  bye() {
    const { core } = this.tools;
    const team = this.team;
    if (team.tick < this.byeAt) return;
    const bot = this.byeQueue.shift();
    if (!bot) {
      if (team.tick >= this.byeAt + 6) {
        this.done = true;
        team.disband();
      }
      return;
    }
    this.byeAt = team.tick + randomInt(...BYE_GAP);
    if (!bot.player.isRegistered()) return;
    // After a scam, no cheery goodbye (kofi: they're angry, then they just go).
    if (!this.quietBye) this.say(bot, bot.persona === KING_PERSONA ? LINES.kingBye : LINES.bye);
    const player = bot.player;
    // A moment for the line, then a teleport out and off (kofi: ready to be picked again).
    later(player, 3, () => {
      if (!player.isRegistered()) return;
      const coins = player.getInventory().getAmount(core.ItemIdentifiers.COINS);
      if (coins > 0) player.getInventory().delete(core.ItemIdentifiers.COINS, coins);
      core.TeleportHandler.teleport(player, loc(AWAY), core.TeleportType.NORMAL, false, () => this.tools.logout(player));
    });
  }

  /**
   * The owner logged out (kofi): the trip stops and every bot goes now. Their share, if not yet traded, is
   * owed - the seller logs back in to pay it when they do (options.owe); King of TOB's cut goes to his cash made.
   */
  abandon() {
    if (this.done) return;
    this.done = true;
    const owner = this.team.owner.getUsername();
    if (!this.ownerPaid && this.share > 0 && !this.seller.scammer) {
      if (this.owe) {
        this.owe({ owner, seller: this.seller.player.getUsername(), role: this.seller.role ?? null, itemName: this.itemName,
          price: this.price, share: this.share, shares: this.shares });
        this.tools.note(`  ${owner} logged out - ${this.seller.player.getUsername()} owes them ${this.share} (paid when they're back)`);
      } else this.tools.note(`  ${owner} logged out before the trade - no payback on this server, the share is lost`);
    }
    const king = this.team.bots.find((bot) => bot.persona === KING_PERSONA);
    if (king && !this.kingPaid) {
      this.kingPaid = true;
      Memory.addCash(king.player.getUsername(), this.share);
    }
    this.tools.note(`  ${owner} logged out - the bots all go`);
    this.team.disband();
  }

  /** The owner never came (logged out, or GIVE_UP): the cuts are split among the bots and everyone goes. */
  finishWithoutOwner() {
    if (this.stage === "split" || this.stage === "bye") return;
    this.tools.note(`  ${this.team.owner.getUsername()} didn't come to the grand exchange - the bots go`);
    this.stage = "split";
    this.splitAt = this.team.tick;
    this.queue = shuffle(this.team.bots.filter((other) => other !== this.seller && other.player.isRegistered()));
  }
}

module.exports = { GeTrip, LINES };
