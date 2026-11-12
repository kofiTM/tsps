"use strict";

/**
 * Gathering bots around the map: woodcutters, miners and rune essence runners who walk a route
 * between a bank and their trees or rocks, as players do. Each data/definitions/bot-gather-*.json
 * holds one area's routes; every route starts on its own (one failing never touches the others,
 * the GE or the bank skillers). Logs: logs/gather-bots.log. ::gatherbots (owner) shows them.
 *
 * A route's cycle: bank (stand at a booth or chest a few seconds), the "out" steps (walks, a
 * wizard's teleport, a ladder), gather at a real tree or rock until a full inventory, the "back"
 * steps (the mine portal, a ladder, walks), and round again. The bots carry nothing: nobody sees
 * another player's inventory, so a trip is counted (items per inventory, seconds per item) and
 * shown with the tool's animation - no item churn on the server. Trees, rocks, banks, ladders and
 * portals are found on the live map at startup from the ids or names in the file.
 *
 * Steps (in "out" and "back"):
 *   { "walk": { "x", "y", "z"?, "radius"? } }
 *   { "wizard": { "npc": "Aubury", "x", "y", "to": { "x", "y", "z" } } }   the essence teleport
 *   { "portal": { "ids": [34825], "to": { "x", "y", "z" } } }              the essence mine exit
 *   { "climb": { "ids": [28857], "x", "y", "z", "toZ": 1, "animation": 828 } }
 */

const fs = require("fs");
const path = require("path");
const SRC = "../../../src/main/typescript/elvarg";
const { Location } = require(`${SRC}/game/model/Location`);
const { Item } = require(`${SRC}/game/model/Item`);
const { Equipment } = require(`${SRC}/game/model/container/impl/Equipment`);
const { Flag } = require(`${SRC}/game/model/Flag`);
const { Skill } = require(`${SRC}/game/model/Skill`);
const { Animation } = require(`${SRC}/game/model/Animation`);
const { Graphic } = require(`${SRC}/game/model/Graphic`);
const { ItemIdentifiers } = require(`${SRC}/util/ItemIdentifiers`);
const { MapObjects } = require(`${SRC}/game/entity/impl/object/MapObjects`);
const { isUsableBankBooth } = require("../lib/BankBooths.PlayerBots");
const { attachBrain } = require("../brain/AttachBrain.PlayerBots");
const { applyLevels, applyOutfit } = require("../brain/SiteSpawner.PlayerBots");
const { requestMovement, clearMovementRequest } = require("../behaviours/navigation/Navigation.PlayerBots");
const { realisticName } = require("../ai/Names.PlayerBots");

const DEFINITIONS = path.join(process.cwd(), "data", "definitions");
const LOG_PATH = path.join(process.cwd(), "logs", "gather-bots.log");
const TICK_MS = 600;
const MODE = "gather_life";
const BANKER_NAME = /banker/i;
const BANK_OBJECT_NAME = /^bank (chest|booth)$/i;
// The essence teleport (Runecrafting.plugin): the wizard's Curse, then the landing 4 ticks later.
const WIZARD_LINE = "Senventior Disthine Molenko!";
const CURSE_CASTING = 108;
const CURSE_IMPACT = 110;
const TELEPORT_OUT = { animation: 714, graphic: 111 };

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const range = (value, fallback) => (Array.isArray(value) && value.length === 2 ? value.map(Number) : fallback);
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const tileKey = (tile) => `${tile.x},${tile.y},${tile.z ?? 0}`;
const itemId = (name) => (name == null ? null : ItemIdentifiers[name] ?? null);

function fileLog(botApi, event, data = {}) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
  } catch {
    // logging never breaks the bots
  }
  try {
    botApi?.log?.(event, data);
  } catch {
    // ignore
  }
}

/** One route: its bots, its map lookups and its cycle. */
function startRoute(options, area, route) {
  const { api, botApi, runtime, registry, world, resetMovementState } = options;
  const core = api.core;
  const RegionManager = api.getRegionManager?.() ?? core.RegionManager;
  const id = `${area}:${route.id}`;
  const log = (event, data = {}) => fileLog(botApi, event, { route: id, ...data });
  const records = new Set();
  let map = null;
  let started = false;
  const replaceAt = [];

  // ------------------------------------------------------------------ the map

  function loadAround(x, y, radius) {
    for (const [dx, dy] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) RegionManager.loadMapFiles?.(x + dx * radius, y + dy * radius);
  }

  function blocked(x, y, z) {
    try {
      return RegionManager.blocked(new Location(x, y, z), null) === true;
    } catch {
      return true;
    }
  }

  function objectName(object) {
    try {
      return String(core.ObjectDefinition?.forId?.(object.getId())?.getName?.() ?? "");
    } catch {
      return "";
    }
  }

  /** Objects within `radius` of (x, y, z) whose id is in `ids` or whose name matches `name`. */
  function findObjects({ x, y, z = 0, radius = 10, ids = null, name = null, test = null }) {
    loadAround(x, y, radius);
    const idSet = ids ? new Set(ids.map(Number)) : null;
    const found = [];
    for (let tx = x - radius; tx <= x + radius; tx++) {
      for (let ty = y - radius; ty <= y + radius; ty++) {
        const objects = MapObjects.mapObjects?.get?.(MapObjects.getHash(tx, ty, z)) ?? [];
        for (const object of objects) {
          const loc = object?.getLocation?.();
          if (!loc || loc.getX() !== tx || loc.getY() !== ty || loc.getZ() !== z) continue;
          const oid = object.getId();
          const match = (idSet && idSet.has(oid)) || (name && name.test(objectName(object))) || (test && test(oid));
          if (!match) continue;
          let sizeX = 1;
          let sizeY = 1;
          try {
            const def = core.ObjectDefinition?.forId?.(oid);
            sizeX = Math.max(1, Number(def?.getSizeX?.() ?? 1));
            sizeY = Math.max(1, Number(def?.getSizeY?.() ?? 1));
          } catch {
            // 1x1
          }
          const face = Number(object.getFace?.() ?? 0);
          if (face === 1 || face === 3) [sizeX, sizeY] = [sizeY, sizeX];
          found.push({ id: oid, x: tx, y: ty, z, sizeX, sizeY });
          break;
        }
      }
    }
    return found;
  }

  /** Open tiles touching an object's footprint (edges first, corners last). */
  function standTiles(object) {
    const tiles = [];
    const { x, y, z, sizeX, sizeY } = object;
    for (let tx = x - 1; tx <= x + sizeX; tx++) {
      for (let ty = y - 1; ty <= y + sizeY; ty++) {
        const inside = tx >= x && tx < x + sizeX && ty >= y && ty < y + sizeY;
        if (inside || blocked(tx, ty, z)) continue;
        const corner = (tx === x - 1 || tx === x + sizeX) && (ty === y - 1 || ty === y + sizeY);
        tiles.push({ x: tx, y: ty, z, corner });
      }
    }
    return tiles.sort((a, b) => Number(a.corner) - Number(b.corner));
  }

  function centerOf(object) {
    return { x: object.x + (object.sizeX - 1) / 2, y: object.y + (object.sizeY - 1) / 2, z: object.z };
  }

  function npcsNear(x, y, z, radius) {
    const World = api.getWorld?.() ?? core.World;
    try {
      return World?.getNpcsNear?.(new Location(x, y, z), radius, null) ?? [];
    } catch {
      return [];
    }
  }

  const npcName = (npc) => String(npc?.getDefinition?.()?.getName?.() ?? npc?.getName?.() ?? "");

  /** The bank's booths (players' side, away from the banker) or chest, as tiles to stand on. */
  function findBank(bank) {
    const z = bank.z ?? 0;
    const radius = Number(bank.radius ?? 8);
    const objects = findObjects({
      x: bank.x, y: bank.y, z, radius,
      ids: bank.ids ?? null,
      name: BANK_OBJECT_NAME,
      test: (oid) => isUsableBankBooth(oid),
    });
    const bankers = npcsNear(bank.x, bank.y, z, radius + 2).filter((npc) => BANKER_NAME.test(npcName(npc)));
    const spots = [];
    for (const object of objects) {
      let tiles = standTiles(object).filter((tile) => !tile.corner);
      const banker = bankers.find((npc) => {
        const loc = npc.getLocation?.();
        return loc && Math.abs(loc.getX() - object.x) + Math.abs(loc.getY() - object.y) === 1;
      });
      if (banker) {
        const loc = banker.getLocation();
        const out = { x: object.x - (loc.getX() - object.x), y: object.y - (loc.getY() - object.y) };
        tiles = tiles.filter((tile) => tile.x === out.x && tile.y === out.y);
      }
      for (const tile of tiles) spots.push({ tile, face: centerOf(object) });
    }
    return spots;
  }

  function buildMap() {
    const bankSpots = findBank(route.bank);
    const resource = route.resource;
    const objects = findObjects({
      x: resource.x, y: resource.y, z: resource.z ?? 0, radius: Number(resource.radius ?? 10),
      ids: resource.ids ?? null,
      name: resource.name ? new RegExp(resource.name, "i") : null,
    });
    // spotArea { minX, maxX, minY, maxY } and near { x, y, radius } keep the bots where players
    // stand: the magic cutters on the middle path, the redwood cutters by the ladder.
    const area = resource.spotArea ?? null;
    const near = resource.near ?? null;
    const allowed = (tile) => (!area || (tile.x >= (area.minX ?? -Infinity) && tile.x <= (area.maxX ?? Infinity)
      && tile.y >= (area.minY ?? -Infinity) && tile.y <= (area.maxY ?? Infinity)))
      && (!near || cheb(tile, near) <= Number(near.radius ?? 3));
    const spots = [];
    for (const object of objects) {
      for (const tile of standTiles(object).filter(allowed).slice(0, Number(resource.spotsPerObject ?? 2))) {
        spots.push({ tile, face: centerOf(object), object });
      }
    }
    log("gather_map", {
      bank: bankSpots.map((spot) => tileKey(spot.tile)),
      objects: objects.map((object) => `${object.id}@${object.x},${object.y},${object.z}`),
      spots: spots.length,
    });
    if (bankSpots.length === 0 || spots.length === 0) return null;
    return { bankSpots, spots };
  }

  // ------------------------------------------------------------------ moving

  function here(player) {
    const loc = player.getLocation();
    return { x: loc.getX(), y: loc.getY(), z: loc.getZ() };
  }

  function moving(player) {
    return (player.getMovementQueue?.()?.size?.() ?? 0) > 0;
  }

  function stopWalking(player) {
    try {
      clearMovementRequest?.(player);
    } catch {
      // nothing queued
    }
  }

  function face(player, tile) {
    if (!tile) return;
    const target = new Location(Math.round(tile.x), Math.round(tile.y), tile.z ?? 0);
    if (typeof player.forcePositionToFace === "function") player.forcePositionToFace(target);
    else player.setPositionToFace?.(target);
  }

  function teleport(player, tile) {
    stopWalking(player);
    player.getMovementQueue?.()?.reset?.();
    player.moveTo(new Location(tile.x, tile.y, tile.z ?? 0));
  }

  /**
   * Walks toward `tile`; true once within `radius`. Short hops path exactly (PathFinder), long ones
   * go through the bots' segmented navigation. A walk that takes far too long ends on the tile.
   */
  function walkTo(record, tile, nowMs, radius = 0) {
    const { player } = record;
    const at = here(player);
    if (at.z === (tile.z ?? 0) && cheb(at, tile) <= radius) {
      stopWalking(player);
      return true;
    }
    record.walkStartAt ??= nowMs;
    const limit = 25000 + cheb(at, tile) * 900;
    if (at.z !== (tile.z ?? 0) || nowMs - record.walkStartAt > limit) {
      log("gather_walk_gave_up", { from: tileKey(at), to: tileKey(tile) });
      teleport(player, tile);
      return true;
    }
    if (!moving(player) && nowMs >= (record.walkRetryAt ?? 0)) {
      stopWalking(player);
      if (cheb(at, tile) <= 20 && typeof core.PathFinder?.calculateWalkRoute === "function") {
        core.PathFinder.calculateWalkRoute(player, tile.x, tile.y);
      } else {
        requestMovement(player, tile.x, tile.y, { reason: "gather_walk", z: tile.z ?? 0, nowMs });
      }
      record.walkRetryAt = nowMs + 1800;
    }
    return false;
  }

  // ------------------------------------------------------------------ the cycle

  function cycle() {
    return [{ bank: route.bank }, ...(route.out ?? []), { gather: route.resource }, ...(route.back ?? [])];
  }

  function nextStep(record, nowMs) {
    record.stepIndex = (record.stepIndex + 1) % record.steps.length;
    record.step = null;
    record.walkStartAt = null;
    record.walkRetryAt = 0;
    record.nextAt = nowMs + rand(200, 900);
  }

  function bestTool(player) {
    const tools = route.tools ?? [];
    const skill = String(route.toolSkill ?? "").toUpperCase();
    let level = 99;
    try {
      level = player.getSkillManager().getMaxLevel(Skill[skill]);
    } catch {
      // any tool
    }
    const usable = tools.filter((tool) => Number(tool.minLevel ?? 1) <= level);
    if (usable.length === 0) return tools[0] ?? null;
    // Mostly the best they can use, sometimes the one below it.
    const sorted = usable.sort((a, b) => Number(b.minLevel ?? 1) - Number(a.minLevel ?? 1));
    return Math.random() < 0.8 || sorted.length < 2 ? sorted[0] : sorted[1];
  }

  function spotInUse(spot) {
    for (const record of records) if (record.spot === spot) return true;
    return false;
  }

  function updateStep(record, nowMs) {
    const { player } = record;
    const step = record.steps[record.stepIndex];
    record.step ??= {};
    const state = record.step;

    if (step.bank) {
      state.spot ??= pick(map.bankSpots);
      if (!state.arrived) {
        if (!walkTo(record, state.spot.tile, nowMs, 0)) return;
        state.arrived = true;
        face(player, state.spot.face);
        state.doneAt = nowMs + randRange(step.bank.seconds, [2, 5]) * 1000;
        return;
      }
      if (nowMs < state.doneAt) return;
      if (nowMs >= record.leaveAt) {
        leave(record, nowMs);
        return;
      }
      record.carried = 0;
      nextStep(record, nowMs);
      return;
    }

    if (step.walk) {
      if (walkTo(record, { x: step.walk.x, y: step.walk.y, z: step.walk.z ?? 0 }, nowMs, Number(step.walk.radius ?? 2))) nextStep(record, nowMs);
      return;
    }

    if (step.wizard) {
      const w = step.wizard;
      if (!state.cast) {
        const npc = npcsNear(w.x, w.y, w.z ?? 0, 8).find((candidate) => npcName(candidate) === w.npc);
        const near = npc ? { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: w.z ?? 0 } : { x: w.x, y: w.y, z: w.z ?? 0 };
        if (!walkTo(record, near, nowMs, 2)) return;
        face(player, near);
        if (npc) {
          npc.forceChat?.(WIZARD_LINE);
          npc.setPositionToFace?.(player.getLocation());
          npc.performGraphic?.(new Graphic(CURSE_CASTING, 0, 92));
        }
        player.performGraphic?.(new Graphic(CURSE_IMPACT, 100, 124));
        state.cast = true;
        state.landAt = nowMs + 4 * TICK_MS;
        return;
      }
      if (nowMs < state.landAt) return;
      teleport(player, { x: w.to.x + randInt(-1, 1), y: w.to.y + randInt(-1, 1), z: w.to.z ?? 0 });
      nextStep(record, nowMs);
      return;
    }

    if (step.portal) {
      const p = step.portal;
      if (!state.portal) {
        const at = here(player);
        const portals = findObjects({ x: at.x, y: at.y, z: at.z, radius: Number(p.radius ?? 40), ids: p.ids ?? null });
        state.portal = portals.sort((a, b) => cheb(a, at) - cheb(b, at))[0] ?? { x: at.x, y: at.y, z: at.z, sizeX: 1, sizeY: 1 };
        state.tile = standTiles(state.portal)[0] ?? at;
      }
      if (!state.stepped) {
        if (!walkTo(record, state.tile, nowMs, 0)) return;
        face(player, state.portal);
        player.performGraphic?.(new Graphic(CURSE_IMPACT, 30, 124));
        state.stepped = true;
        state.leaveAt = nowMs + 2 * TICK_MS;
        return;
      }
      if (nowMs < state.leaveAt) return;
      teleport(player, { x: p.to.x, y: p.to.y, z: p.to.z ?? 0 });
      nextStep(record, nowMs);
      return;
    }

    if (step.climb) {
      const c = step.climb;
      if (!state.ladder) {
        const ladders = findObjects({ x: c.x, y: c.y, z: c.z ?? 0, radius: Number(c.radius ?? 4), ids: c.ids ?? null });
        const at = here(player);
        state.ladder = ladders.sort((a, b) => cheb(a, at) - cheb(b, at))[0] ?? { x: c.x, y: c.y, z: c.z ?? 0, sizeX: 1, sizeY: 1 };
        state.tile = standTiles(state.ladder)[0] ?? { x: c.x, y: c.y, z: c.z ?? 0 };
      }
      if (!state.climbing) {
        if (!walkTo(record, state.tile, nowMs, 0)) return;
        face(player, state.ladder);
        player.performAnimation(new Animation(Number(c.animation ?? 828)));
        state.climbing = true;
        state.upAt = nowMs + 2 * TICK_MS;
        return;
      }
      if (nowMs < state.upAt) return;
      const toZ = Number(c.toZ ?? 0);
      const landing = standTiles({ ...state.ladder, z: toZ })[0] ?? { x: state.tile.x, y: state.tile.y, z: toZ };
      teleport(player, landing);
      nextStep(record, nowMs);
      return;
    }

    if (step.gather) {
      const g = step.gather;
      if (!state.spot) {
        const free = map.spots.filter((spot) => !spotInUse(spot));
        state.spot = pick(free.length ? free : map.spots);
        record.spot = state.spot;
        record.carried ??= 0;
      }
      if (!state.arrived) {
        if (!walkTo(record, state.spot.tile, nowMs, 0)) return;
        state.arrived = true;
        face(player, state.spot.face);
        state.animAt = nowMs;
        state.itemAt = nowMs + itemSeconds(record, g) * 1000;
        return;
      }
      if (nowMs >= state.animAt) {
        face(player, state.spot.face);
        if (record.tool?.animation != null) player.performAnimation(new Animation(Number(record.tool.animation)));
        state.animAt = nowMs + Number(record.tool?.animationTicks ?? g.animationTicks ?? 4) * TICK_MS;
      }
      if (nowMs < state.itemAt) return;
      record.carried = (record.carried ?? 0) + 1;
      if (g.xp && route.toolSkill) {
        try {
          player.getSkillManager().addExperiences(Skill[String(route.toolSkill).toUpperCase()], Number(g.xp));
        } catch {
          // experience is cosmetic here
        }
      }
      if (record.carried >= Number(g.items ?? 27)) {
        record.spot = null;
        log("gather_full", { bot: player.getUsername?.(), items: record.carried });
        nextStep(record, nowMs);
        return;
      }
      state.itemAt = nowMs + itemSeconds(record, g) * 1000;
      return;
    }

    nextStep(record, nowMs);
  }

  function randRange(value, fallback) {
    const [min, max] = range(value, fallback);
    return rand(min, max);
  }

  /** Seconds for the next item: the tool's rate if it has one, else the resource's. */
  function itemSeconds(record, g) {
    return randRange(record.tool?.secondsPerItem ?? g.secondsPerItem, [8, 16]);
  }

  // ------------------------------------------------------------------ bots

  function freshName() {
    const World = api.getWorld?.() ?? core.World;
    for (let attempt = 0; attempt < 30; attempt++) {
      const name = realisticName();
      if (runtime.entriesByUsername?.has?.(name)) continue;
      if (World?.getPlayerByName?.(name)) continue;
      return name;
    }
    return null;
  }

  function spawn(atGather) {
    const start = atGather ? pick(map.spots) : pick(map.bankSpots);
    RegionManager.loadMapFiles?.(start.tile.x, start.tile.y);
    const username = freshName();
    let bot = null;
    try {
      bot = runtime.spawnPvpBot(new Location(start.tile.x, start.tile.y, start.tile.z ?? 0), { mode: MODE, ...(username ? { username } : {}) });
    } catch (error) {
      log("gather_spawn_failed", { error: String(error?.message ?? error) });
      return false;
    }
    if (!bot) return false;
    bot.getInventory?.()?.resetItems?.();
    bot.getInventory?.()?.refreshItems?.();
    applyLevels(bot, route.levels ?? { all: [20, 60] });
    applyOutfit(bot, route.outfit ?? "mid");
    const record = {
      player: bot,
      steps: cycle(),
      stepIndex: 0,
      step: null,
      nextAt: Date.now() + rand(0, 4000),
      carried: 0,
      leaveAt: Date.now() + randRange(route.lifetimeMinutes, [30, 90]) * 60000,
      gone: false,
    };
    record.tool = bestTool(bot);
    const toolId = itemId(record.tool?.item);
    if (toolId != null) {
      const equipment = bot.getEquipment?.();
      equipment?.set?.(Equipment.WEAPON_SLOT, new Item(toolId, 1));
      equipment?.refreshItems?.();
      bot.getUpdateFlag?.()?.flag?.(Flag.APPEARANCE);
    }
    if (atGather) {
      // Already out at the trees or rocks, part-way through an inventory.
      record.stepIndex = record.steps.findIndex((step) => step.gather);
      record.step = { spot: start, arrived: false };
      record.spot = start;
      record.carried = randInt(0, Math.max(0, Number(route.resource.items ?? 27) - 3));
    }
    const action = {
      id: "gatherLife",
      madeProgress: () => true,
      update(ctx) {
        if (record.gone) return "running";
        const nowMs = ctx.nowMs ?? Date.now();
        if (nowMs < record.nextAt) return "running";
        try {
          updateStep(record, nowMs);
        } catch (error) {
          log("gather_bot_error", { step: record.stepIndex, error: String(error?.message ?? error) });
          record.nextAt = nowMs + 3000;
        }
        return "running";
      },
      stop() {},
    };
    const activity = {
      id: `gather_${route.id}`,
      resolver: false,
      resolves: null,
      mode: MODE,
      capacity: 100000,
      repeat: true,
      ephemeral: false,
      manual: true,
      failureCooldownMs: 0,
      requires: [],
      setup: [],
      actions: [action],
      produces: [],
      site: null,
    };
    const attached = attachBrain({ runtime, registry, world, bot, activity, home: start.tile, resetMovementState, chooseNext: () => activity });
    if (!attached) {
      despawn(record);
      return false;
    }
    records.add(record);
    return true;
  }

  function despawn(record) {
    if (record.gone) return;
    record.gone = true;
    records.delete(record);
    try {
      record.player.getForcedLogoutTimer?.()?.start?.(0);
      record.player.requestLogout?.();
    } catch {
      // gone anyway
    }
    replaceAt.push(Date.now() + randRange(route.replaceAfterSeconds, [30, 120]) * 1000);
  }

  /** Session over: teleports out from the bank and a new bot turns up a little later. */
  function leave(record, nowMs) {
    record.player.performAnimation(new Animation(TELEPORT_OUT.animation));
    record.player.performGraphic?.(new Graphic(TELEPORT_OUT.graphic, 0, 92));
    record.nextAt = nowMs + 3 * TICK_MS + 200;
    record.steps = [{ vanish: true }];
    record.stepIndex = 0;
    record.step = null;
    setTimeout(() => despawn(record), 3 * TICK_MS);
  }

  function start() {
    if (started) return;
    try {
      map = buildMap();
    } catch (error) {
      log("gather_map_failed", { error: String(error?.stack ?? error) });
      return;
    }
    if (!map) {
      log("gather_no_map", {});
      return;
    }
    started = true;
    const count = Math.max(0, Number(route.count ?? 1));
    const startAt = Date.now();
    for (let index = 0; index < count; index++) replaceAt.push(startAt + index * 1200);
    let first = count;
    const TaskBase = core.Task;
    class GatherTick extends TaskBase {
      constructor() {
        super(2, `gather-${id}`, false);
      }
      execute() {
        try {
          const nowMs = Date.now();
          for (let index = replaceAt.length - 1; index >= 0; index--) {
            if (nowMs < replaceAt[index]) continue;
            replaceAt.splice(index, 1);
            // The first crowd starts spread over the cycle: about half already out gathering.
            const atGather = first > 0 ? Math.random() < 0.5 : false;
            if (first > 0) first--;
            if (!spawn(atGather)) replaceAt.push(nowMs + 30000);
          }
        } catch (error) {
          log("gather_tick_failed", { error: String(error?.message ?? error) });
        }
      }
    }
    (api.getTaskManager?.() ?? core.TaskManager).submit(new GatherTick());
    log("gather_started", { count });
  }

  api.onPlayerLogout?.(({ player }) => {
    for (const record of records) {
      if (record.player === player && !record.gone) despawn(record);
    }
  });

  return {
    id,
    title: route.title ?? route.id,
    start,
    get count() {
      return records.size;
    },
    get started() {
      return started;
    },
  };
}

/** Starts every route in every data/definitions/bot-gather-*.json, each on its own. */
function startGatherers(options = {}) {
  const { api, botApi } = options;
  const routes = [];
  let files = [];
  try {
    files = fs.readdirSync(DEFINITIONS).filter((name) => /^bot-gather-.+\.json$/.test(name)).sort();
  } catch (error) {
    fileLog(botApi, "gather_list_failed", { error: String(error?.message ?? error) });
  }
  for (const file of files) {
    let config = null;
    try {
      config = JSON.parse(fs.readFileSync(path.join(DEFINITIONS, file), "utf8"));
    } catch (error) {
      fileLog(botApi, "gather_config_failed", { file, error: String(error?.message ?? error) });
      continue;
    }
    if (config?.enabled !== true) continue;
    const area = String(config.id ?? file.replace(/^bot-gather-|\.json$/g, ""));
    for (const route of config.routes ?? []) {
      if (route?.enabled === false) continue;
      try {
        routes.push(startRoute(options, area, route));
      } catch (error) {
        fileLog(botApi, "gather_route_failed", { file, route: route?.id, error: String(error?.stack ?? error) });
      }
    }
  }
  fileLog(botApi, "gather_registered", { routes: routes.map((route) => route.id) });
  const startAll = () => {
    for (const route of routes) {
      try {
        route.start();
      } catch (error) {
        fileLog(botApi, "gather_start_failed", { route: route.id, error: String(error?.stack ?? error) });
      }
    }
  };
  if (typeof api?.onServerStartup === "function") api.onServerStartup(() => setTimeout(startAll, 25000));
  try {
    api.registerCommand?.("gatherbots", ({ player }) => {
      for (const route of routes) player.sendMessage(`${route.title}: ${route.started ? `${route.count} bots` : "not started"}`);
      if (routes.length === 0) player.sendMessage("No gathering routes.");
      startAll();
    }, api.core.PlayerRights?.OWNER, "Show the gathering bots (starts any that haven't)");
  } catch (error) {
    fileLog(botApi, "gather_command_failed", { error: String(error?.message ?? error) });
  }
  return routes;
}

module.exports = { startGatherers };
