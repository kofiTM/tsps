"use strict";

/**
 * A hot/cold flower host, the way OSRS gambling hosts ran it with mithril seeds: the player
 * trades the host a bet (coins or platinum tokens), then says "hot" or "cold" in public chat.
 * The host plants a mithril seed (a flower appears on its tile and it steps aside, as planting
 * did), and the colour decides it: hot is red/orange/yellow, cold is blue/purple/assorted,
 * anything else (mixed, black, white) is the house's. A right call is paid `multiplier` x the
 * bet by trade straight back; then the host walks back to its spot and advertises again.
 * Winnings owed are kept in bot-flowers-payouts.json until traded. A bet with no call within
 * `callSeconds` is refunded the same way.
 *
 * ::flowerbot (owner) puts the host on your tile (saved to bot-flowers-spot.json);
 * ::flowerbot off removes it; ::flowerbot status shows what it's doing.
 * Settings in data/definitions/bot-flowers.json.
 */

const fs = require("fs");
const path = require("path");
const SRC = "../../../src/main/typescript/elvarg";
const { Location } = require(`${SRC}/game/model/Location`);
const { Item } = require(`${SRC}/game/model/Item`);
const { Equipment } = require(`${SRC}/game/model/container/impl/Equipment`);
const { Flag } = require(`${SRC}/game/model/Flag`);
const { Animation } = require(`${SRC}/game/model/Animation`);
const { ItemIdentifiers } = require(`${SRC}/util/ItemIdentifiers`);
const { MapObjects } = require(`${SRC}/game/entity/impl/object/MapObjects`);
const { attachBrain } = require("../brain/AttachBrain.PlayerBots");
const { applyLevels } = require("../brain/SiteSpawner.PlayerBots");
const { gp } = require("./DiceBot.PlayerBots");

const DEFINITIONS = path.join(process.cwd(), "data", "definitions");
const CONFIG_PATH = path.join(DEFINITIONS, "bot-flowers.json");
// Saved under data/saves: nodemon ignores it there, where a write to data/definitions restarts the server.
const SAVES = path.join(process.cwd(), "data", "saves");
const SPOT_PATH = path.join(SAVES, "bot-flowers-spot.json");
const PAYOUTS_PATH = path.join(SAVES, "bot-flowers-payouts.json");
const LOG_PATH = path.join(process.cwd(), "logs", "flower-bot.log");
const COINS = ItemIdentifiers.COINS ?? 995;
const PLATINUM_TOKEN = ItemIdentifiers.PLATINUM_TOKEN ?? 13204;
const TOKEN_VALUE = 1000;
const MAX_STACK = 2147483647;
const PLANT_ANIMATION = 827;
const CHEER_EMOTE = 862;
const FLOWER_OBJECT_TYPE = 10;

const OUTFIT_SLOTS = Object.freeze({
  head: Equipment.HEAD_SLOT,
  cape: Equipment.CAPE_SLOT,
  amulet: Equipment.AMULET_SLOT,
  weapon: Equipment.WEAPON_SLOT,
  body: Equipment.BODY_SLOT,
  shield: Equipment.SHIELD_SLOT,
  legs: Equipment.LEG_SLOT,
  hands: Equipment.HANDS_SLOT,
  feet: Equipment.FEET_SLOT,
  ring: Equipment.RING_SLOT,
});

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

function fileLog(botApi, event, data = {}) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
  } catch {
    // logging must never break the host
  }
  try {
    botApi?.log?.(event, data);
  } catch {
    // ignore
  }
}

function startFlowerBot(options = {}) {
  try {
    return startFlowerBotUnsafe(options);
  } catch (error) {
    fileLog(options.botApi, "flowers_register_failed", { error: String(error?.stack ?? error) });
    return null;
  }
}

function startFlowerBotUnsafe(options) {
  const { api, botApi, runtime, registry, world, resetMovementState } = options;
  const log = (event, data) => fileLog(botApi, event, data);
  const config = readJson(CONFIG_PATH, null);
  if (!config || config.enabled !== true || !runtime) {
    log("flowers_off", { enabled: config?.enabled });
    return null;
  }
  const core = api.core;
  const game = config.game ?? {};
  const multiplier = Number(game.multiplier ?? 2);
  // Coins 100k-1b and platinum tokens 1-1b by default; a win pays multiplier x each, in kind.
  const coinLimits = {
    min: Number(game.coins?.min ?? game.minBet ?? 100000),
    max: Math.min(Number(game.coins?.max ?? game.maxBet ?? 1000000000), Math.floor(MAX_STACK / multiplier)),
  };
  const tokenLimits = {
    min: Number(game.tokens?.min ?? 1),
    max: Math.min(Number(game.tokens?.max ?? 1000000000), Math.floor(MAX_STACK / multiplier)),
  };
  const callMs = Number(game.callSeconds ?? 60) * 1000;
  const flowers = (config.flowers ?? []).filter((flower) => Number.isInteger(flower.object) && Number(flower.weight) > 0);
  const tradeSettings = config.trade ?? {};
  const settleMs = Number(tradeSettings.settleSeconds ?? 1.2) * 1000;
  const timeoutMs = Number(tradeSettings.timeoutSeconds ?? 90) * 1000;
  const retryMs = Number(tradeSettings.payoutRetrySeconds ?? 20) * 1000;
  const chat = config.chat ?? {};

  let bot = null;
  let spot = readJson(SPOT_PATH, null);
  const owed = new Map(Object.entries(readJson(PAYOUTS_PATH, {}) ?? {}));
  let session = null; // the trade on now
  let round = null; // { name, bet, stage: "call"|"planting"|"reveal"|"home", call, at, flower }
  let planted = null; // { object, until }
  let nextAdAt = 0;
  let nextPayoutAskAt = 0;
  let lastSaid = { key: null, at: 0 };

  const TradeState = () => core.TradeState;
  const World = () => api.getWorld?.() ?? core.World;
  const ObjectManager = () => api.getObjectManager?.() ?? core.ObjectManager;

  function saveOwed() {
    writeJson(PAYOUTS_PATH, Object.fromEntries(owed));
  }

  function say(text) {
    if (!bot || !text) return;
    try {
      if (core.ChatPacketListener?.handleText) {
        core.ChatPacketListener.handleText(bot, text);
        return;
      }
    } catch {
      // overhead text instead
    }
    bot.forceChat?.(text);
  }

  function sayLine(key, values = {}, { once = false } = {}) {
    const lines = chat[key] ?? [];
    if (!lines.length) return;
    if (once && lastSaid.key === key && Date.now() - lastSaid.at < 6000) return;
    lastSaid = { key, at: Date.now() };
    say(fill(pick(lines), values));
  }

  // ------------------------------------------------------------------------------ the host

  function dress() {
    const equipment = bot.getEquipment?.();
    if (!equipment) return;
    equipment.resetItems?.();
    for (const [slotName, slot] of Object.entries(OUTFIT_SLOTS)) {
      const list = config.outfit?.[slotName];
      if (!Array.isArray(list) || list.length === 0) continue;
      const id = ItemIdentifiers[pick(list)];
      if (Number.isInteger(id)) equipment.set(slot, new Item(id, 1));
    }
    equipment.refreshItems?.();
    try {
      core.WeaponInterfaceManager?.assign?.(bot);
    } catch {
      // stance follows the next appearance update
    }
    bot.getUpdateFlag?.()?.flag?.(Flag.APPEARANCE);
  }

  function spawn() {
    if (bot || !spot) return false;
    api.getRegionManager?.()?.loadMapFiles?.(spot.x, spot.y);
    const name = String(config.name ?? "HotCold Host");
    let spawned = null;
    try {
      spawned = runtime.spawnPvpBot(new Location(spot.x, spot.y, spot.z ?? 0), { mode: "flower_host", username: name });
    } catch (error) {
      log("flowers_spawn_failed", { error: String(error?.message ?? error) });
    }
    if (!spawned) {
      log("flowers_spawn_refused", { name, spot });
      return false;
    }
    bot = spawned;
    applyLevels(bot, { all: 99 });
    replenish();
    dress();
    bot.getTradingInteraction = () => interaction;
    attachHoldStill();
    nextAdAt = Date.now() + 4000;
    log("flowers_spawned", { name: bot.getUsername?.(), spot, owed: owed.size });
    return true;
  }

  function atSpot() {
    const loc = bot.getLocation();
    return loc.getX() === spot.x && loc.getY() === spot.y;
  }

  function walkHome() {
    if (!bot || !spot || atSpot()) return;
    try {
      core.PathFinder.calculateWalkRoute(bot, spot.x, spot.y);
    } catch {
      bot.moveTo?.(new Location(spot.x, spot.y, spot.z ?? 0));
    }
  }

  /** A brain whose one action keeps the host on its tile between rounds. */
  function attachHoldStill() {
    const action = {
      id: "flowerHost",
      madeProgress: () => true,
      update() {
        if (!bot || !spot || session || round) return "running";
        if (!atSpot() && (bot.getMovementQueue?.()?.size?.() ?? 0) === 0) walkHome();
        return "running";
      },
      stop() {},
    };
    const activity = {
      id: "flower_host", resolver: false, resolves: null, mode: "flower_host", capacity: 1, repeat: true,
      ephemeral: false, manual: true, failureCooldownMs: 0, requires: [], setup: [], actions: [action],
      produces: [], site: null,
    };
    attachBrain({ runtime, registry, world, bot, activity, home: spot, resetMovementState, chooseNext: () => activity });
  }

  /**
   * The client keeps one object per layer on a tile, so the flower replaced the tile's own map
   * object (the GE floor pattern); taking the flower away left the tile bare. After removing it,
   * the tile's map objects are sent again to everyone who can see it.
   */
  function clearFlower() {
    if (!planted) return;
    const object = planted.object;
    planted = null;
    try {
      ObjectManager()?.deregister?.(object, true);
    } catch {
      // already gone
    }
    try {
      restoreTile(object.getLocation());
    } catch (error) {
      log("flowers_restore_failed", { error: String(error?.message ?? error) });
    }
  }

  function restoreTile(loc) {
    const x = loc.getX();
    const y = loc.getY();
    const z = loc.getZ();
    const originals = (MapObjects.mapObjects?.get?.(MapObjects.getHash(x, y, z)) ?? []).filter((original) => {
      const at = original?.getLocation?.();
      return at && at.getX() === x && at.getY() === y && at.getZ() === z && !flowers.some((flower) => flower.object === original.getId());
    });
    if (originals.length === 0) return;
    const players = World()?.getPlayers?.() ?? [];
    for (const player of players) {
      if (!player || player.isPlayerBot?.() === true) continue;
      const there = player.getLocation?.();
      if (!there || there.getZ() !== z || Math.max(Math.abs(there.getX() - x), Math.abs(there.getY() - y)) > 32) continue;
      for (const original of originals) player.getPacketSender?.()?.sendObject?.(original);
    }
    log("flowers_tile_restored", { x, y, objects: originals.map((original) => `${original.getId()}/${original.getType()}`) });
  }

  function despawn() {
    if (!bot) return;
    try {
      bot.getTrading?.()?.closeTrade?.();
    } catch {
      // nothing open
    }
    clearFlower();
    try {
      bot.getForcedLogoutTimer?.()?.start?.(0);
      bot.requestLogout?.();
    } catch {
      // gone anyway
    }
    bot = null;
    session = null;
    round = null;
  }

  // ------------------------------------------------------------------------------ trading

  const trading = () => bot.getTrading();
  const partnerPlayer = () => trading().getInteract?.() ?? null;
  const snapshot = (container) => container.getValidItems().map((item) => `${item.getId()}x${item.getAmount()}`).sort().join(",");

  function currentSnapshot() {
    const partner = partnerPlayer();
    if (!partner) return null;
    return `${snapshot(trading().getContainer())}|${snapshot(partner.getTrading().getContainer())}`;
  }

  function betOffered(partner) {
    let coins = 0;
    let tokens = 0;
    let onlyCoins = true;
    for (const item of partner.getTrading().getContainer().getValidItems()) {
      if (item.getId() === COINS) coins += item.getAmount();
      else if (item.getId() === PLATINUM_TOKEN) tokens += item.getAmount();
      else onlyCoins = false;
    }
    return { coins, tokens, onlyCoins };
  }

  // ---- stakes: coins and platinum tokens are kept apart, and paid back in the same kind ----

  /** An owed entry or bet as { coins, tokens } (older saves held { amount } in coins). */
  function stakeOf(entry) {
    return { coins: Math.max(0, Number(entry?.coins ?? entry?.amount ?? 0)), tokens: Math.max(0, Number(entry?.tokens ?? 0)) };
  }

  const emptyStake = (stake) => !(stake.coins > 0) && !(stake.tokens > 0);
  const scaleStake = (stake, by) => ({ coins: Math.min(MAX_STACK, stake.coins * by), tokens: Math.min(MAX_STACK, stake.tokens * by) });
  const addStakes = (a, b) => ({ coins: Math.min(MAX_STACK, a.coins + b.coins), tokens: Math.min(MAX_STACK, a.tokens + b.tokens) });

  /** "250m", "40m plat", or "10m + 5m plat". */
  function stakeText(stake) {
    const parts = [];
    if (stake.coins > 0) parts.push(gp(stake.coins));
    if (stake.tokens > 0) parts.push(`${gp(stake.tokens)} plat`);
    return parts.join(" + ") || "0";
  }

  function addOwed(name, stake) {
    const key = name.toLowerCase();
    owed.set(key, { name, ...addStakes(stakeOf(owed.get(key)), stake) });
    saveOwed();
  }

  /** The host's bankroll: a full stack of coins and of platinum tokens, topped up after every game. */
  function replenish() {
    const inventory = bot?.getInventory?.();
    if (!inventory) return;
    inventory.resetItems?.();
    inventory.adds(COINS, MAX_STACK);
    inventory.adds(PLATINUM_TOKEN, MAX_STACK);
    inventory.refreshItems?.();
  }

  /** Clears the bankroll so a bet's coins have room to land (a stack can't pass 2,147m). */
  function makeRoomForBet() {
    const inventory = bot?.getInventory?.();
    if (!inventory) return;
    inventory.resetItems?.();
    inventory.refreshItems?.();
  }

  const interaction = {
    acceptTradeRequest: (player) => onRequest(player),
    addItemsToTrade: (_container, partner) => onOpened(partner),
    offerChanged: (partner) => {
      if (session && partner?.getUsername?.() === session.partner) {
        session.changedAt = Date.now();
        session.agreed = null;
      }
    },
    acceptTrade: () => {},
    receivedItems: () => {},
  };

  function newSession(name, kind, stake, nowMs = Date.now()) {
    return { partner: name, kind, stake: stake ?? { coins: 0, tokens: 0 }, opened: false, openedAt: nowMs, changedAt: nowMs, agreed: null, offered: false, complained: null };
  }

  function onRequest(player) {
    if (!bot) return;
    const name = player.getUsername();
    const debt = owed.get(name.toLowerCase());
    log("flowers_trade_request", { name, state: String(trading().getState()), busy: !!(round || session), owed: debt ? stakeText(stakeOf(debt)) : 0 });
    if (!debt && (round || (session && session.partner !== name))) {
      // Busy: they go in the line and get a trade request when it's their turn.
      enqueue(player);
      return;
    }
    session = newSession(name, debt ? "payout" : "bet", debt ? stakeOf(debt) : null);
    setTimeout(() => {
      try {
        if (bot && session?.partner === name) {
          trading().requestTrade(player);
          log("flowers_trade_accept_sent", { name, botState: String(trading().getState()) });
        }
      } catch (error) {
        log("flowers_accept_request_failed", { name, error: String(error?.message ?? error) });
      }
    }, 600);
  }

  function onOpened(partner) {
    const name = partner?.getUsername?.();
    if (!session || session.partner !== name) {
      trading().closeTrade();
      return;
    }
    session.opened = true;
    session.openedAt = Date.now();
    session.changedAt = Date.now();
    log("flowers_trade_opened", { name, kind: session.kind });
  }

  function offerPayout() {
    if (session.offered) return;
    const partner = partnerPlayer();
    if (!partner || partner.getTrading().getState() !== TradeState().TRADE_SCREEN) return;
    // Out of the full bankroll: coins and tokens each as they're owed.
    replenish();
    const inventory = bot.getInventory();
    for (const [id, amount] of [[COINS, session.stake.coins], [PLATINUM_TOKEN, session.stake.tokens]]) {
      if (!(amount > 0)) continue;
      const slot = inventory.getSlotForItemId?.(id) ?? inventory.getItems().findIndex((item) => item?.getId?.() === id);
      if (slot < 0) continue;
      trading().handleItem(id, amount, slot, inventory, trading().getContainer());
    }
    session.offered = snapshot(trading().getContainer()) !== "";
    session.changedAt = Date.now();
  }

  function followTrade(nowMs) {
    if (!session) return;
    const state = trading().getState();
    const { NONE, REQUESTED_TRADE, TRADE_SCREEN, ACCEPTED_TRADE_SCREEN, CONFIRM_SCREEN } = TradeState();
    if (!session.opened) {
      if (nowMs - session.openedAt > 30000) session = null;
      return;
    }
    if (state === NONE || state === REQUESTED_TRADE) {
      replenish();
      session = null;
      return;
    }
    if (nowMs - session.openedAt > timeoutMs) {
      trading().closeTrade();
      return;
    }
    const partner = partnerPlayer();
    if (!partner) return;
    if (state === TRADE_SCREEN) {
      if (session.kind === "payout") {
        offerPayout();
        const theirs = partner.getTrading().getContainer().getValidItems().length;
        // Their stack can't pass 2,147m: they bank some first, the winnings stay owed.
        const held = partner.getInventory();
        if (held.getAmount(COINS) + session.stake.coins > MAX_STACK || held.getAmount(PLATINUM_TOKEN) + session.stake.tokens > MAX_STACK) {
          if (!session.warnedRoom) {
            session.warnedRoom = true;
            sayLine("roomFirst", { name: session.partner });
            partner.sendMessage?.("Your coin or platinum token stack is too big to take this payout - bank some first, it stays owed.");
          }
          return;
        }
        if (session.offered && theirs === 0 && nowMs - session.changedAt >= settleMs) {
          session.agreed = currentSnapshot();
          trading().acceptTrade();
        }
        return;
      }
      const offer = betOffered(partner);
      if (offer.onlyCoins && offer.coins <= 0 && offer.tokens <= 0) return;
      let problem = null;
      if (!offer.onlyCoins) problem = "coinsOnly";
      else if ((offer.coins > 0 && offer.coins < coinLimits.min) || (offer.tokens > 0 && offer.tokens < tokenLimits.min)) problem = "tooLow";
      else if (offer.coins > coinLimits.max || offer.tokens > tokenLimits.max) problem = "tooHigh";
      const key = `${problem}:${offer.coins}:${offer.tokens}`;
      if (problem) {
        if (nowMs - session.changedAt >= settleMs && session.complained !== key) {
          session.complained = key;
          sayLine(problem, { min: gp(coinLimits.min), max: gp(coinLimits.max), maxTokens: gp(tokenLimits.max) });
        }
        return;
      }
      if (nowMs - session.changedAt >= settleMs) {
        session.stake = { coins: offer.coins, tokens: offer.tokens };
        // Room for the bet's coins to land: the bankroll goes back after the trade.
        makeRoomForBet();
        session.agreed = currentSnapshot();
        trading().acceptTrade();
      }
      return;
    }
    if (state === ACCEPTED_TRADE_SCREEN) return;
    if (state === CONFIRM_SCREEN) {
      if (session.agreed && currentSnapshot() === session.agreed) trading().acceptTrade();
      else trading().closeTrade();
    }
  }

  function onTradeCompleted({ player, partner, received }) {
    if (!bot || player !== bot || !session) return;
    const name = partner.getUsername();
    const finished = session;
    session = null;
    // Every game ends with the bankroll full again.
    replenish();
    if (finished.kind === "payout") {
      owed.delete(name.toLowerCase());
      saveOwed();
      sayLine("paid", { name, payout: stakeText(finished.stake) });
      log("flowers_paid", { name, ...finished.stake });
      return;
    }
    const bet = { coins: 0, tokens: 0 };
    for (const item of received ?? []) {
      if (item.getId() === COINS) bet.coins += item.getAmount();
      else if (item.getId() === PLATINUM_TOKEN) bet.tokens += item.getAmount();
    }
    if (emptyStake(bet)) return;
    // Now the player calls it: "hot" or "cold" in public chat.
    round = { name, bet, stage: "call", at: Date.now() + callMs, call: null };
    sayLine("askCall", { name, bet: stakeText(bet) });
    log("flowers_bet", { name, bet });
  }

  // ------------------------------------------------------------------------------ the round

  /** Public chat: the bettor's "hot" or "cold" call. */
  function onPublicChat(event) {
    if (!bot || !round || round.stage !== "call") return;
    if (event?.packet?.type !== "public_chat") return;
    const speaker = event.player;
    if (!speaker || speaker.getUsername?.() !== round.name) return;
    const text = String(event.packet.text ?? "").toLowerCase();
    const hot = /\bhot\b/.test(text);
    const cold = /\bcold\b/.test(text);
    if (hot === cold) return; // neither, or both
    round.call = hot ? "hot" : "cold";
    heardCall();
    log("flowers_call", { name: round.name, call: round.call });
  }

  function rollFlower() {
    let roll = Math.random() * flowers.reduce((sum, flower) => sum + Number(flower.weight), 0);
    for (const flower of flowers) {
      roll -= Number(flower.weight);
      if (roll < 0) return flower;
    }
    return flowers[flowers.length - 1];
  }

  /** Plants on the host's own tile, as a mithril seed does, then steps aside off the flower. */
  function plant() {
    clearFlower();
    const flower = rollFlower();
    const loc = bot.getLocation();
    bot.getMovementQueue?.()?.reset?.();
    bot.performAnimation?.(new Animation(PLANT_ANIMATION));
    try {
      const object = new core.GameObject(flower.object, loc.clone(), FLOWER_OBJECT_TYPE, 0, null);
      ObjectManager().register(object, true);
      planted = { object, until: Date.now() + Number(game.flowerSeconds ?? 25) * 1000 };
    } catch (error) {
      log("flowers_plant_failed", { error: String(error?.message ?? error) });
    }
    // Step aside: west first, as planting did, else any open side.
    const RegionManager = api.getRegionManager?.() ?? core.RegionManager;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const next = new Location(loc.getX() + dx, loc.getY() + dy, loc.getZ());
      let blocked = false;
      try {
        blocked = RegionManager.blocked(next, null) === true;
      } catch {
        blocked = true;
      }
      if (!blocked) {
        try {
          core.PathFinder.calculateWalkRoute(bot, next.getX(), next.getY());
        } catch {
          bot.moveTo?.(next);
        }
        break;
      }
    }
    return flower;
  }


  /** A bot (the GE crowd) stood next to the host: within 3 tiles, same floor. */
  function nearHost(player) {
    if (!bot || !player) return false;
    const a = bot.getLocation();
    const b = player.getLocation();
    return a.getZ() === b.getZ() && Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) <= 3;
  }

  /** "gamble:npc-round": a GE bot bets; it then calls hot or cold ("gamble:npc-call"), as a player would in chat. */
  function onNpcRound(event) {
    if (event?.game !== "flowers" || !bot || round || busyWithPlayers() || !nearHost(event.player)) return;
    const name = event.player.getUsername();
    round = { name, bet: stakeOf(event.stake), stage: "call", at: Date.now() + callMs, call: null, npc: event.player };
    sayLine("askCall", { name, bet: stakeText(round.bet) });
    event.accepted = true;
    log("flowers_npc_bet", { name, bet: round.bet });
  }

  /** "gamble:npc-call" { player, call }: the bot's hot or cold. */
  function onNpcCall(event) {
    if (!round || round.stage !== "call" || round.npc !== event?.player) return;
    if (event.call !== "hot" && event.call !== "cold") return;
    round.call = event.call;
    heardCall();
  }

  /** A host isn't instant: it reads the call a moment later, says so, then plants a moment after. */
  function heardCall() {
    const [min, max] = game.reactSeconds ?? [1.5, 3];
    round.stage = "heard";
    round.at = Date.now() + rand(min, max) * 1000;
  }


  // ---- players first: no bot rounds while a player trades, plays or waits, nor just after ----
  let playerQuietUntil = 0;

  function busyWithPlayers() {
    // A player's own round (not a bot's) counts too.
    return !!session || queue.length > 0 || Date.now() < playerQuietUntil || (!!round && !round.npc);
  }

  /** "gamble:host-status" { game, busy }: whether a bot may come and play now. */
  function onHostStatus(event) {
    if (event?.game !== "flowers") return;
    if (!bot || busyWithPlayers() || round) event.busy = true;
  }

  function quietForPlayers() {
    playerQuietUntil = Date.now() + Number(game.playerQuietSeconds ?? 15) * 1000;
  }

  function reveal() {
    const { name, bet, call, flower, npc } = round;
    if (!npc) quietForPlayers();
    const won = flower.side === call;
    round.won = won;
    const payout = scaleStake(bet, multiplier);
    const player = World()?.getPlayerByName?.(name) ?? null;
    const values = { name, call, colour: flower.name, side: flower.side === "house" ? "house" : flower.side, payout: stakeText(payout) };
    if (won) {
      if (npc) {
        // The payout "trade" to a bot takes a few seconds, as a real one does.
        setTimeout(() => sayLine("paid", { name, payout: stakeText(payout) }), 4000 + Math.random() * 3000);
      } else {
        addOwed(name, payout);
      }
      bot.performAnimation?.(new Animation(CHEER_EMOTE));
      sayLine("win", values);
      player?.sendMessage?.(`${flower.name} flowers - ${flower.side}! You called ${call} and win ${stakeText(payout)}.`);
      nextPayoutAskAt = 0;
    } else {
      sayLine(flower.side === "house" ? "house" : "lose", values);
      player?.sendMessage?.(`${flower.name} flowers - ${flower.side === "house" ? "the house's" : flower.side}. You called ${call}.`);
    }
    log("flowers_reveal", { name, bet, call, flower: flower.name, side: flower.side, won, npc: !!npc, payout: won ? payout : null });
    if (npc) api.emitCustomEvent?.("gamble:npc-round-done", { player: npc, game: "flowers", won, payout });
  }

  /** A bet nobody called in time goes back, through the payout trade. */
  function refundUncalled() {
    const { name, bet, npc } = round;
    if (!npc) quietForPlayers();
    if (npc) {
      // A bot that never called just walks off; nothing changed hands.
      api.emitCustomEvent?.("gamble:npc-round-done", { player: npc, game: "flowers", won: false, payout: null });
      return;
    }
    addOwed(name, bet);
    sayLine("noCall", { name, bet: stakeText(bet) });
    log("flowers_refund", { name, bet });
    nextPayoutAskAt = 0;
  }

  function followRound(nowMs) {
    if (!round) return;
    if (round.stage === "call") {
      if (nowMs >= round.at) {
        refundUncalled();
        round = null;
      } else if (!round.reminded && nowMs >= round.at - callMs / 2) {
        round.reminded = true;
        sayLine("askCall", { name: round.name, bet: stakeText(round.bet) });
      }
      return;
    }
    if (round.stage === "heard" && nowMs >= round.at) {
      sayLine("called", { name: round.name, call: round.call });
      const [min, max] = game.plantSeconds ?? [1.5, 3];
      round.stage = "planting";
      round.at = nowMs + rand(min, max) * 1000;
      return;
    }
    if (round.stage === "planting" && nowMs >= round.at) {
      round.flower = plant();
      round.stage = "reveal";
      round.at = nowMs + 1800;
      return;
    }
    if (round.stage === "reveal" && nowMs >= round.at) {
      reveal();
      round.stage = "home";
      round.at = nowMs + 2400;
      return;
    }
    if (round.stage === "home" && nowMs >= round.at) {
      // The game's over: the flower goes as the host heads back to its spot.
      clearFlower();
      walkHome();
      // A gap before the next advert, so the result (and a win's "paid") reads on its own.
      // (5 s after the result; after a win, 5 s after the "paid" line, which comes up to 7 s later.)
      nextAdAt = nowMs + 2600 + (round.won ? 4600 : 0);
      round = null;
    }
  }


  // ---- the line: players who traded while the host was busy, taken one by one afterwards ----

  const queue = []; // player names, oldest first
  let nextQueueAt = 0;

  function enqueue(player) {
    const name = player.getUsername();
    if (!queue.some((queued) => queued.toLowerCase() === name.toLowerCase())) queue.push(name);
    const position = queue.findIndex((queued) => queued.toLowerCase() === name.toLowerCase()) + 1;
    sayLine("queued", { name, position }, { once: true });
    player.sendMessage?.(`The host is busy - you're #${position} in line. It will send you a trade request when it's your turn.`);
    log("queue_add", { name, position });
  }

  /** Free again: the next player in line who's still about gets a trade request. */
  function serveQueue(nowMs) {
    if (session || round || queue.length === 0 || nowMs < nextQueueAt) return;
    nextQueueAt = nowMs + 2000;
    while (queue.length > 0) {
      const name = queue.shift();
      const player = World()?.getPlayerByName?.(name);
      if (!player) continue;
      const here = bot.getLocation();
      const there = player.getLocation();
      if (here.getZ() !== there.getZ() || Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY())) > 15) continue;
      try {
        trading().requestTrade(player);
        session = newSession(player.getUsername(), "bet", null, nowMs);
        sayLine("next", { name: player.getUsername() });
        player.sendMessage?.("It's your turn - accept the host's trade request.");
        log("queue_serve", { name, left: queue.length });
      } catch (error) {
        log("queue_serve_failed", { name, error: String(error?.message ?? error) });
      }
      return;
    }
  }

  function askToPay(nowMs) {
    if (session || round || owed.size === 0 || nowMs < nextPayoutAskAt) return;
    nextPayoutAskAt = nowMs + retryMs;
    for (const { name } of owed.values()) {
      const player = World()?.getPlayerByName?.(name);
      if (!player) continue;
      const here = bot.getLocation();
      const there = player.getLocation();
      if (here.getZ() !== there.getZ() || Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY())) > 15) continue;
      try {
        trading().requestTrade(player);
        session = newSession(player.getUsername(), "payout", stakeOf(owed.get(name.toLowerCase())), nowMs);
      } catch (error) {
        log("flowers_payout_request_failed", { name, error: String(error?.message ?? error) });
      }
      return;
    }
  }

  // ------------------------------------------------------------------------------ the tick

  function tick() {
    if (!bot) return;
    // Bots don't always report isRegistered(); gone means the bot runtime no longer has it.
    const username = bot.getUsername?.();
    if (username && runtime.entriesByUsername?.has && !runtime.entriesByUsername.has(username)) {
      log("flowers_bot_gone", { username });
      bot = null;
      session = null;
      round = null;
      return;
    }
    const nowMs = Date.now();
    try {
      followTrade(nowMs);
      followRound(nowMs);
      askToPay(nowMs);
      serveQueue(nowMs);
      if (planted && nowMs >= planted.until) clearFlower();
      if (!session && !round && nowMs >= nextAdAt) {
        const [min, max] = chat.adSeconds ?? [14, 28];
        nextAdAt = nowMs + rand(min, max) * 1000;
        if (chat.ads?.length) say(pick(chat.ads));
      }
    } catch (error) {
      log("flowers_tick_failed", { error: String(error?.stack ?? error) });
    }
  }

  class FlowerHostTick extends core.Task {
    constructor() {
      super(1, "flower-host", false);
    }
    execute() {
      tick();
    }
  }

  api.onTradeCompleted?.((event) => {
    try {
      onTradeCompleted(event);
    } catch (error) {
      log("flowers_trade_completed_failed", { error: String(error?.stack ?? error) });
    }
  });

  api.onSocialPacket?.((event) => {
    try {
      onPublicChat(event);
    } catch (error) {
      log("flowers_chat_failed", { error: String(error?.message ?? error) });
    }
  });

  api.onCustomEvent?.("gamble:npc-round", onNpcRound);
  api.onCustomEvent?.("gamble:host-status", onHostStatus);
  api.onCustomEvent?.("gamble:npc-call", onNpcCall);

  api.onPlayerLogout?.(({ player }) => {
    if (player === bot) {
      clearFlower();
      bot = null;
      session = null;
      round = null;
    }
  });

  api.registerCommand?.("flowerbot", ({ player, parts }) => {
    const arg = String(parts?.[1] ?? "").toLowerCase();
    log("flowers_command", { by: player.getUsername?.(), parts });
    try {
      if (arg === "status") {
        if (!bot) {
          player.sendMessage(`Flower host: not spawned (spot ${spot ? `${spot.x}, ${spot.y}` : "not set"}).`);
          return;
        }
        const safe = (fn) => {
          try {
            return String(fn());
          } catch (error) {
            return `error: ${error?.message ?? error}`;
          }
        };
        player.sendMessage(`Flower host: busy ${safe(() => bot.busy())}, trade ${safe(() => trading().getState())}, ` +
          `session ${session ? `${session.kind} with ${session.partner}` : "none"}`);
        player.sendMessage(`round ${round ? `${round.stage} for ${round.name} (${stakeText(round.bet)})` : "none"}, owed ${owed.size}`);
        return;
      }
      if (arg === "off") {
        despawn();
        spot = null;
        try {
          fs.unlinkSync(SPOT_PATH);
        } catch {
          // already gone
        }
        player.sendMessage("The hot/cold host is gone.");
        return;
      }
      const loc = player.getLocation();
      spot = { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
      writeJson(SPOT_PATH, spot);
      if (bot) {
        bot.moveTo?.(new Location(spot.x, spot.y, spot.z));
        player.sendMessage(`The hot/cold host moved to ${spot.x}, ${spot.y}. Step off the tile so it can stand there.`);
      } else if (spawn()) {
        player.sendMessage(`The hot/cold host is at ${spot.x}, ${spot.y} (saved for restarts).`);
      } else {
        player.sendMessage("Couldn't spawn the hot/cold host - see logs/flower-bot.log.");
      }
      log("flowers_spot_set", { by: player.getUsername(), spot });
    } catch (error) {
      player.sendMessage(`Flower host command failed: ${error?.message ?? error}`);
      log("flowers_command_failed", { error: String(error?.stack ?? error) });
    }
  }, core.PlayerRights?.OWNER, "Put the hot/cold flower host on your tile (::flowerbot off / status)");

  api.onServerStartup?.(() => {
    (api.getTaskManager?.() ?? core.TaskManager).submit(new FlowerHostTick());
    setTimeout(() => {
      if (spot) spawn();
    }, Math.max(0, Number(config.startDelaySeconds ?? 14)) * 1000);
  });
  log("flowers_registered", { spot, owed: owed.size, flowers: flowers.length });
  return { spawn, despawn };
}

module.exports = { startFlowerBot };
