"use strict";

/**
 * A 55x2 dicing host, the way OSRS gambling hosts ran it: the player trades the host a bet
 * (coins or platinum tokens), the host takes it, rolls percentile dice (1-100) and announces
 * the roll; above `winAbove` the player wins `multiplier` x the bet and the host trades it
 * straight back, otherwise the house keeps it. This one always pays: winnings it owes are kept
 * in data/definitions/bot-dice-payouts.json until they are traded, through restarts.
 *
 * ::dicebot (owner) puts the host on the tile you stand on and saves it (bot-dice-spot.json);
 * ::dicebot off removes it. Settings in data/definitions/bot-dice.json.
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
const { attachBrain } = require("../brain/AttachBrain.PlayerBots");
const { applyLevels } = require("../brain/SiteSpawner.PlayerBots");

const DEFINITIONS = path.join(process.cwd(), "data", "definitions");
const CONFIG_PATH = path.join(DEFINITIONS, "bot-dice.json");
// Saved under data/saves: nodemon ignores it there, where a write to data/definitions restarts the server.
const SAVES = path.join(process.cwd(), "data", "saves");
const SPOT_PATH = path.join(SAVES, "bot-dice-spot.json");
const PAYOUTS_PATH = path.join(SAVES, "bot-dice-payouts.json");
const OLD_SPOT_PATH = path.join(DEFINITIONS, "bot-dice-spot.json");
const OLD_PAYOUTS_PATH = path.join(DEFINITIONS, "bot-dice-payouts.json");
const LOG_PATH = path.join(process.cwd(), "logs", "dice-bot.log");
const COINS = ItemIdentifiers.COINS ?? 995;
const PLATINUM_TOKEN = ItemIdentifiers.PLATINUM_TOKEN ?? 13204;
const TOKEN_VALUE = 1000;
const MAX_STACK = 2147483647;
const THINK_EMOTE = 857;
const CHEER_EMOTE = 862;

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

/** 100000 -> "100k", 25000000 -> "25m", 1500000000 -> "1.5b", as players write it. */
function gp(amount) {
  const short = (value, unit) => `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (amount >= 1e9) return short(amount / 1e9, "b");
  if (amount >= 1e6) return short(Math.floor(amount / 1e5) / 10, "m");
  if (amount >= 1e3) return short(Math.floor(amount / 1e2) / 10, "k");
  return String(amount);
}

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

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

function startDiceBot(options = {}) {
  try {
    return startDiceBotUnsafe(options);
  } catch (error) {
    fileLog(options.botApi, "dice_register_failed", { error: String(error?.stack ?? error) });
    return null;
  }
}

function startDiceBotUnsafe(options) {
  const { api, botApi, runtime, registry, world, resetMovementState } = options;
  const log = (event, data) => fileLog(botApi, event, data);
  const config = readJson(CONFIG_PATH, null);
  if (!config || config.enabled !== true || !runtime) {
    log("dice_off", { enabled: config?.enabled });
    return null;
  }
  const core = api.core;
  const game = config.game ?? {};
  const winAbove = Number(game.winAbove ?? 55);
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
  const tradeSettings = config.trade ?? {};
  const settleMs = Number(tradeSettings.settleSeconds ?? 1.2) * 1000;
  const timeoutMs = Number(tradeSettings.timeoutSeconds ?? 90) * 1000;
  const retryMs = Number(tradeSettings.payoutRetrySeconds ?? 20) * 1000;
  const chat = config.chat ?? {};

  let bot = null;
  // From the old place (data/definitions) once, if it isn't in data/saves yet.
  let spot = readJson(SPOT_PATH, null) ?? readJson(OLD_SPOT_PATH, null);
  // Winnings owed, by lower-case player name: { name, amount }. Saved on every change.
  const owed = new Map(Object.entries(readJson(PAYOUTS_PATH, null) ?? readJson(OLD_PAYOUTS_PATH, {}) ?? {}));
  let session = null; // the trade on now: { partner, kind: "bet"|"payout", amount, opened, changedAt, agreed, offered, complained }
  let rolling = null; // { name, bet, at }
  let nextAdAt = 0;
  let nextPayoutAskAt = 0;
  let lastSaid = { key: null, at: 0 };

  const TradeState = () => core.TradeState;
  const World = () => api.getWorld?.() ?? core.World;

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

  /** A line from chat[key], filled in; the same complaint isn't repeated within a few seconds. */
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
    const name = String(config.name ?? "55x2 Dicing");
    let spawned = null;
    try {
      spawned = runtime.spawnPvpBot(new Location(spot.x, spot.y, spot.z ?? 0), { mode: "dice_host", username: name });
    } catch (error) {
      log("dice_spawn_failed", { error: String(error?.message ?? error) });
    }
    if (!spawned) {
      log("dice_spawn_refused", { name, spot });
      return false;
    }
    bot = spawned;
    applyLevels(bot, { all: 99 });
    replenish();
    dress();
    bot.getTradingInteraction = () => interaction;
    attachHoldStill();
    nextAdAt = Date.now() + 4000;
    log("dice_spawned", { name: bot.getUsername?.(), spot, owed: owed.size });
    return true;
  }

  /** A brain whose one action keeps the host on its tile (and does nothing else). */
  function attachHoldStill() {
    const action = {
      id: "diceHost",
      madeProgress: () => true,
      update() {
        if (!bot || !spot || session || rolling) return "running";
        const loc = bot.getLocation();
        const away = loc.getX() !== spot.x || loc.getY() !== spot.y;
        if (away && (bot.getMovementQueue?.()?.size?.() ?? 0) === 0) {
          try {
            core.PathFinder.calculateWalkRoute(bot, spot.x, spot.y);
          } catch {
            bot.moveTo?.(new Location(spot.x, spot.y, spot.z ?? 0));
          }
        }
        return "running";
      },
      stop() {},
    };
    const activity = {
      id: "dice_host", resolver: false, resolves: null, mode: "dice_host", capacity: 1, repeat: true,
      ephemeral: false, manual: true, failureCooldownMs: 0, requires: [], setup: [], actions: [action],
      produces: [], site: null,
    };
    attachBrain({ runtime, registry, world, bot, activity, home: spot, resetMovementState, chooseNext: () => activity });
  }

  function despawn() {
    if (!bot) return;
    try {
      bot.getTrading?.()?.closeTrade?.();
    } catch {
      // nothing open
    }
    try {
      bot.getForcedLogoutTimer?.()?.start?.(0);
      bot.requestLogout?.();
    } catch {
      // gone anyway
    }
    bot = null;
    session = null;
    rolling = null;
  }

  // ------------------------------------------------------------------------------ trading

  function trading() {
    return bot.getTrading();
  }

  function partnerPlayer() {
    return trading().getInteract?.() ?? null;
  }

  function snapshot(container) {
    return container.getValidItems().map((item) => `${item.getId()}x${item.getAmount()}`).sort().join(",");
  }

  function currentSnapshot() {
    const partner = partnerPlayer();
    if (!partner) return null;
    return `${snapshot(trading().getContainer())}|${snapshot(partner.getTrading().getContainer())}`;
  }

  /** What the partner put up: its coin value, and whether it's all coins / platinum tokens. */
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

  function onRequest(player) {
    const name = player.getUsername();
    const key = name.toLowerCase();
    const debt = owed.get(key);
    log("dice_trade_request", { name, state: String(trading().getState()), busy: !!(rolling || session), owed: debt ? stakeText(stakeOf(debt)) : 0 });
    // Owed winnings: this trade is the payout, whatever else is going on with others.
    if (!debt && (rolling || (session && session.partner !== name))) {
      // Busy: they go in the line and get a trade request when it's their turn.
      enqueue(player);
      return;
    }
    session = {
      partner: name,
      kind: debt ? "payout" : "bet",
      stake: debt ? stakeOf(debt) : { coins: 0, tokens: 0 },
      opened: false,
      openedAt: Date.now(),
      changedAt: Date.now(),
      agreed: null,
      offered: false,
      complained: null,
    };
    // Answering a request is requesting back (Trading.requestTrade opens it for both).
    setTimeout(() => {
      try {
        if (bot && session?.partner === name) {
          trading().requestTrade(player);
          log("dice_trade_accept_sent", { name, botState: String(trading().getState()), theirState: String(player.getTrading().getState()) });
        }
      } catch (error) {
        log("dice_accept_request_failed", { name, error: String(error?.message ?? error) });
      }
    }, 600);
  }

  function onOpened(partner) {
    const name = partner?.getUsername?.();
    if (!session || session.partner !== name) {
      // A trade we didn't agree to (shouldn't happen): back out.
      trading().closeTrade();
      return;
    }
    session.opened = true;
    session.openedAt = Date.now();
    session.changedAt = Date.now();
    log("dice_trade_opened", { name, kind: session.kind });
  }

  /** The payout's coins go in once both trade screens are open. */
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

  /** Every tick while a trade is on: check the offer, accept both screens, give up on stale ones. */
  function followTrade(nowMs) {
    if (!session) return;
    const state = trading().getState();
    const { NONE, REQUESTED_TRADE, TRADE_SCREEN, ACCEPTED_TRADE_SCREEN, CONFIRM_SCREEN } = TradeState();
    if (!session.opened) {
      if (nowMs - session.openedAt > 30000) session = null; // they never opened it
      return;
    }
    if (state === NONE || state === REQUESTED_TRADE) {
      // Closed without completing (declined or walked off). A payout stays owed.
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
    if (state === ACCEPTED_TRADE_SCREEN) return; // waiting on them
    if (state === CONFIRM_SCREEN) {
      // Second screen: only exactly what was agreed on the first.
      if (session.agreed && currentSnapshot() === session.agreed) trading().acceptTrade();
      else trading().closeTrade();
    }
  }

  /** The trade went through: a bet starts a roll, a payout clears what was owed. */
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
      log("dice_paid", { name, ...finished.stake });
      return;
    }
    const bet = { coins: 0, tokens: 0 };
    for (const item of received ?? []) {
      if (item.getId() === COINS) bet.coins += item.getAmount();
      else if (item.getId() === PLATINUM_TOKEN) bet.tokens += item.getAmount();
    }
    if (emptyStake(bet)) return;
    rolling = { name, bet, at: Date.now() + Number(game.rollSeconds ?? 2.4) * 1000 };
    bot.performAnimation?.(new Animation(THINK_EMOTE));
    sayLine("accepted", { name, bet: stakeText(bet) });
    log("dice_bet", { name, bet });
  }


  /** A bot (the GE crowd) stood next to the host: within 3 tiles, same floor. */
  function nearHost(player) {
    if (!bot || !player) return false;
    const a = bot.getLocation();
    const b = player.getLocation();
    return a.getZ() === b.getZ() && Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) <= 3;
  }

  /**
   * "gamble:npc-round" { game, player, stake, accepted }: a GE bot plays one round. The host
   * takes it only when free (no real player trading or rolling) and the bot is beside it; the
   * round is played out in chat, and a bot's win is paid on the spot (no trade, nothing owed).
   */
  function onNpcRound(event) {
    if (event?.game !== "dice" || !bot || rolling || busyWithPlayers() || !nearHost(event.player)) return;
    const name = event.player.getUsername();
    rolling = { name, bet: stakeOf(event.stake), npc: event.player, at: Date.now() + Number(game.rollSeconds ?? 2.4) * 1000 };
    bot.performAnimation?.(new Animation(THINK_EMOTE));
    sayLine("accepted", { name, bet: stakeText(rolling.bet) });
    event.accepted = true;
    log("dice_npc_bet", { name, bet: rolling.bet });
  }


  // ---- players first: no bot rounds while a player trades, plays or waits, nor just after ----
  let playerQuietUntil = 0;

  function busyWithPlayers() {
    // A player's own round (not a bot's) counts too.
    return !!session || queue.length > 0 || Date.now() < playerQuietUntil || (!!rolling && !rolling.npc);
  }

  /** "gamble:host-status" { game, busy }: whether a bot may come and play now. */
  function onHostStatus(event) {
    if (event?.game !== "dice") return;
    if (!bot || busyWithPlayers() || rolling) event.busy = true;
  }

  function quietForPlayers() {
    playerQuietUntil = Date.now() + Number(game.playerQuietSeconds ?? 15) * 1000;
  }

  function roll() {
    const { name, bet, npc } = rolling;
    if (!npc) quietForPlayers();
    rolling = null;
    const result = 1 + Math.floor(Math.random() * 100);
    const won = result > winAbove;
    const payout = scaleStake(bet, multiplier);
    const player = World()?.getPlayerByName?.(name) ?? null;
    if (won) {
      if (npc) {
        // A bot's win: paid on the spot.
        // The payout "trade" to a bot takes a few seconds, as a real one does.
        setTimeout(() => sayLine("paid", { name, payout: stakeText(payout) }), 4000 + Math.random() * 3000);
      } else {
        addOwed(name, payout);
      }
      bot.performAnimation?.(new Animation(CHEER_EMOTE));
      sayLine("win", { name, roll: result, payout: stakeText(payout) });
      player?.sendMessage?.(`The host rolled ${result} on the percentile dice. You win ${stakeText(payout)}!`);
      nextPayoutAskAt = 0; // ask them to trade straight away
    } else {
      sayLine("lose", { name, roll: result });
      player?.sendMessage?.(`The host rolled ${result} on the percentile dice. The house wins.`);
    }
    log("dice_roll", { name, bet, roll: result, won, npc: !!npc, payout: won ? payout : null });
    // A gap before the next advert, so the result (and a win's "paid") reads on its own.
    // (5 s after the result; after a win, 5 s after the "paid" line, which comes up to 7 s later.)
    nextAdAt = Date.now() + 5000 + (won ? 7000 : 0);
    if (npc) api.emitCustomEvent?.("gamble:npc-round-done", { player: npc, game: "dice", won, payout });
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
    if (session || rolling || queue.length === 0 || nowMs < nextQueueAt) return;
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
        session = { partner: player.getUsername(), kind: "bet", stake: { coins: 0, tokens: 0 }, opened: false, openedAt: nowMs, changedAt: nowMs, agreed: null, offered: false, complained: null };
        sayLine("next", { name: player.getUsername() });
        player.sendMessage?.("It's your turn - accept the host's trade request.");
        log("queue_serve", { name, left: queue.length });
      } catch (error) {
        log("queue_serve_failed", { name, error: String(error?.message ?? error) });
      }
      return;
    }
  }

  /** Owed winnings: send the winner a trade request (again every so often) while they're about. */
  function askToPay(nowMs) {
    if (session || rolling || owed.size === 0 || nowMs < nextPayoutAskAt) return;
    nextPayoutAskAt = nowMs + retryMs;
    for (const { name } of owed.values()) {
      const player = World()?.getPlayerByName?.(name);
      if (!player?.isRegistered?.()) continue;
      const here = bot.getLocation();
      const there = player.getLocation();
      if (here.getZ() !== there.getZ() || Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY())) > 15) continue;
      try {
        trading().requestTrade(player);
        session = { partner: player.getUsername(), kind: "payout", stake: stakeOf(owed.get(name.toLowerCase())),
          opened: false, openedAt: nowMs, changedAt: nowMs, agreed: null, offered: false, complained: null };
      } catch (error) {
        log("dice_payout_request_failed", { name, error: String(error?.message ?? error) });
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
      log("dice_bot_gone", { username });
      bot = null;
      session = null;
      return;
    }
    const nowMs = Date.now();
    try {
      followTrade(nowMs);
      if (rolling && nowMs >= rolling.at) roll();
      askToPay(nowMs);
      serveQueue(nowMs);
      if (!session && !rolling && nowMs >= nextAdAt) {
        const [min, max] = chat.adSeconds ?? [14, 28];
        nextAdAt = nowMs + rand(min, max) * 1000;
        if (chat.ads?.length) say(pick(chat.ads));
      }
    } catch (error) {
      log("dice_tick_failed", { error: String(error?.stack ?? error) });
    }
  }

  class DiceHostTick extends core.Task {
    constructor() {
      super(1, "dice-host", false);
    }
    execute() {
      tick();
    }
  }

  api.onTradeCompleted?.((event) => {
    try {
      onTradeCompleted(event);
    } catch (error) {
      log("dice_trade_completed_failed", { error: String(error?.stack ?? error) });
    }
  });

  api.onCustomEvent?.("gamble:npc-round", onNpcRound);
  api.onCustomEvent?.("gamble:host-status", onHostStatus);

  api.onPlayerLogout?.(({ player }) => {
    if (player === bot) {
      bot = null;
      session = null;
      rolling = null;
    }
  });

  api.registerCommand?.("dicebot", ({ player, parts }) => {
    const arg = String(parts?.[1] ?? "").toLowerCase();
    log("dice_command", { by: player.getUsername?.(), parts });
    if (arg === "status") {
      try {
        if (!bot) {
          player.sendMessage(`Dicing host: not spawned (spot ${spot ? `${spot.x}, ${spot.y}` : "not set"}).`);
          return;
        }
        const safe = (fn) => {
          try {
            return String(fn());
          } catch (error) {
            return `error: ${error?.message ?? error}`;
          }
        };
        const info = {
          busy: safe(() => bot.busy()),
          interfaceId: safe(() => bot.getInterfaceId()),
          status: safe(() => bot.getStatus()),
          trade: safe(() => trading().getState()),
          session: session ? `${session.kind} with ${session.partner}${session.opened ? " (open)" : ""}` : "none",
          rolling: rolling ? rolling.name : "no",
          owed: owed.size,
        };
        player.sendMessage(`Dicing host: busy ${info.busy}, interface ${info.interfaceId}, status ${info.status}, trade ${info.trade}`);
        player.sendMessage(`session ${info.session}, rolling ${info.rolling}, owed ${info.owed}`);
        log("dice_status", info);
      } catch (error) {
        player.sendMessage(`Dicing host status failed: ${error?.message ?? error}`);
        log("dice_status_failed", { error: String(error?.stack ?? error) });
      }
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
      player.sendMessage("The dicing host is gone.");
      return;
    }
    const loc = player.getLocation();
    spot = { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
    writeJson(SPOT_PATH, spot);
    if (bot) {
      bot.moveTo?.(new Location(spot.x, spot.y, spot.z));
      player.sendMessage(`The dicing host moved to ${spot.x}, ${spot.y}. Step off the tile so it can stand there.`);
    } else if (spawn()) {
      player.sendMessage(`The dicing host is at ${spot.x}, ${spot.y} (saved for restarts).`);
    } else {
      player.sendMessage("Couldn't spawn the dicing host - see logs/dice-bot.log.");
    }
    log("dice_spot_set", { by: player.getUsername(), spot });
  }, core.PlayerRights?.OWNER, "Put the 55x2 dicing host on your tile (::dicebot off removes it)");

  api.onServerStartup?.(() => {
    (api.getTaskManager?.() ?? core.TaskManager).submit(new DiceHostTick());
    setTimeout(() => {
      if (spot) spawn();
    }, Math.max(0, Number(config.startDelaySeconds ?? 12)) * 1000);
  });
  log("dice_registered", { spot, owed: owed.size });
  return { spawn, despawn };
}

module.exports = { startDiceBot, gp };
