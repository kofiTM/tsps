/**
 * Deadman Tournament loot:
 * - a death in the battle drops everything the fallen carried and wore where they fell, the
 *   killer's to take first (then anyone's), so the killer can loot an upgrade;
 * - every kill gives the killer a bloody key (a bloodier key once `keys.bloodierAtOrBelow` or
 *   fewer are left); a key opens one loot chest, and keys drop on death like anything else, so
 *   they can be PK'd off whoever carries them;
 * - loot chests (`chests.count`, LMS's chest loc) stand on random tiles inside the safe zone; one
 *   opened is gone, and another appears elsewhere `chests.respawnTicks` later;
 * - an index of the Wilderness's floor items, rebuilt every few ticks, that bots search for upgrades
 *   and supplies near them (Bots).
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");
const Gear = require("./Gear.DeadmanTournament");

const { state } = State;
const INDEX_EVERY = 3;
const CELL = 16;
const OPEN_ANIMATION = 832;
/** Floor items in the Wilderness by 16x16 cell ("cx,cy" -> ItemOnGround[]). */
let index = new Map();
/** Chests standing: GameObject -> true. */
const chests = new Set();
let chestId = null;

function keyIds() {
  return [Common.data.keys.bloody[0], Common.data.keys.bloodier[0]];
}

function hasKey(player) {
  return keyIds().some((id) => player.getInventory().contains(id));
}

/** How long tournament drops stay (`loot.despawnTicks`): piles must never outgrow what the client can be sent. */
function despawnTicks() {
  return Common.data.loot.despawnTicks ?? 100;
}

/** Items onto the floor at `where`, `owner`'s to see first, then everyone's. */
function dropAt(owner, items, where) {
  const { ItemOnGroundManager } = Common.core;
  for (const item of items) {
    try {
      ItemOnGroundManager.registerLocation(owner, item, where.clone(), owner.getPrivateArea?.() ?? null, { goesGlobal: true, despawnDelay: despawnTicks() });
    } catch (error) {
      Common.log(`drop failed: ${error?.message ?? error}`);
    }
  }
}

/** Items onto the floor at `where` that everyone can see and take straight away (a bot's chest haul, for its clan to share). */
function dropForAll(owner, items, where) {
  const { ItemOnGround, ItemOnGroundState, ItemOnGroundManager } = Common.core;
  for (const item of items) {
    try {
      const ground = new ItemOnGround(ItemOnGroundState.SEEN_BY_EVERYONE, owner.getUsername(), where.clone(), item, false, -1, owner.getPrivateArea?.() ?? null);
      ground.setDespawnDelay?.(despawnTicks());
      ItemOnGroundManager.register(ground);
    } catch (error) {
      Common.log(`public drop failed: ${error?.message ?? error}`);
      dropAt(owner, [item], where);
    }
  }
}

/** Into the inventory if there's room, else onto the floor beside them. */
function give(player, items) {
  const { Item } = Common.core;
  const leftover = [];
  for (const item of items) {
    if (player.getInventory().getFreeSlots() > 0 || (item.getDefinition?.()?.isStackable?.() && player.getInventory().contains(item.getId()))) {
      player.getInventory().add(new Item(item.getId(), item.getAmount()), true);
    } else {
      leftover.push(item);
    }
  }
  if (leftover.length) dropAt(player, leftover, player.getLocation());
}

// ---------------------------------------------------------------- deaths and keys

function eliminated(victim, killer, where) {
  if (state.phase !== "battle" || !where) return;
  const items = Gear.belongings(victim);
  Gear.empty(victim);
  victim.getInventory().refreshItems?.();
  victim.getEquipment().refreshItems?.();
  // Seen and takeable by everyone straight away (not the killer's first): upgrades get spread round.
  const owner = killer && killer.isRegistered?.() ? killer : victim;
  dropForAll(owner, items, where);
}

function killed(killer) {
  if (state.phase !== "battle") return;
  const { Item } = Common.core;
  const [bloody, bloodier] = keyIds();
  const key = state.alive.size <= Common.data.keys.bloodierAtOrBelow ? bloodier : bloody;
  give(killer, [new Item(key, 1)]);
  if (!State.isBot(killer)) killer.sendMessage(`<col=ef1020>You take a ${Common.itemName(key).toLowerCase()} from your kill. Find a chest to open it!</col>`);
}

// ---------------------------------------------------------------- chests

/** A chest's haul: `chests.rolls` picks from each part of the key's tables (a bloody key now and then rolls a bloodier one). */
function roll(tier) {
  const { Item } = Common.core;
  const { rolls, upgradeChance } = Common.data.chests;
  const items = [];
  for (const part of ["offensive", "defensive", "supplies"]) {
    for (let i = 0; i < (rolls?.[part] ?? 1); i++) {
      const table = tier === "bloody" && Math.random() < (upgradeChance ?? 0) ? Common.data.loot.bloodier : Common.data.loot[tier];
      for (const [id, , amount] of Common.pick(table[part])) items.push(new Item(id, amount ?? 1));
    }
  }
  return items;
}

function placeChest() {
  const { GameObject, ObjectManager } = Common.core;
  if (chestId == null) chestId = Common.core.CacheDefinitions.getLocId(Common.data.chests.loc);
  if (chestId == null || !state.fog) return;
  // Well inside the edge (RELOCATE_MARGIN + 2), so a new chest isn't moved again at once.
  const r = Math.max(4, Math.round(state.fog.radius) - (RELOCATE_MARGIN + 2));
  const box = { minX: state.fog.cx - r, maxX: state.fog.cx + r, minY: state.fog.cy - r, maxY: state.fog.cy + r };
  const tile = require("./Tournament.DeadmanTournament").randomWildernessTile(box);
  if (!tile) return;
  const chest = new GameObject(chestId, tile, 10, Common.randomInt(0, 3), null);
  ObjectManager.register(chest, true);
  chests.add(chest);
}

function removeChest(chest) {
  chests.delete(chest);
  try {
    Common.core.ObjectManager.deregister(chest, true);
  } catch (_error) {
    // Already gone.
  }
}

function chestAt(location) {
  for (const chest of chests) {
    const at = chest.getLocation();
    if (at.getX() === location.getX() && at.getY() === location.getY() && at.getZ() === location.getZ()) return chest;
  }
  return null;
}

/** Opens `chest` with the best key `player` has: true if it opened. */
function open(player, chest) {
  if (!chests.has(chest) || !state.alive.has(player)) return false;
  const [bloody, bloodier] = keyIds();
  const inventory = player.getInventory();
  const key = inventory.contains(bloodier) ? bloodier : inventory.contains(bloody) ? bloody : null;
  if (!key) {
    player.sendMessage("You need a bloody key to open this chest. Kill someone for one.");
    return false;
  }
  inventory.delete(key, 1);
  removeChest(chest);
  const items = roll(key === bloodier ? "bloodier" : "bloody");
  player.performAnimation?.(new Common.core.Animation(OPEN_ANIMATION));
  if (State.isBot(player)) {
    // A bot's haul goes on the floor for everyone: the bot and its clan take what each needs
    // (Bots' loot step), and the rest is there for whoever comes by.
    const where = player.getLocation().clone();
    dropForAll(player, items, where);
    // The bots' floor index sees the pile at once (else the opener's next look misses it and it walks off).
    rebuildIndex();
    reportPile(player, items, where);
  } else {
    give(player, items);
    player.sendMessage(`<col=ef1020>You find: ${items.map((item) => Common.itemName(item.getId())).join(", ")}.</col>`);
  }
  Common.later(Common.data.chests.respawnTicks, () => {
    if (state.phase === "battle") placeChest();
  });
  return true;
}

function clickChest(event) {
  const { player, object } = event;
  if (!state.participants.has(player) || !object) return false;
  const chest = chests.has(object) ? object : chestAt(object.getLocation());
  if (!chest) return false;
  open(player, chest);
  return true;
}

function nearestChest(player, range, skip = null) {
  let best = null;
  let bestDistance = range + 1;
  for (const chest of chests) {
    if (skip?.(chest)) continue;
    const d = Common.distance(player.getLocation(), chest.getLocation());
    if (d < bestDistance) {
      best = chest;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * For the first PILE_REPORTS bot chests of a run: PILE_CHECK_TICKS later, how much of the pile is
 * left, how far the opener went, and for each item left whether the opener wanted it - in the log.
 */
const PILE_REPORTS = 10;
const PILE_CHECK_TICKS = 20;
let pileReports = 0;

function reportPile(opener, items, where) {
  if (pileReports >= PILE_REPORTS) return;
  pileReports++;
  Common.later(PILE_CHECK_TICKS, () => {
    const ids = new Set(items.map((item) => item.getId()));
    const left = (Common.core.World.getItems?.() ?? []).filter((ground) => !ground.isPendingRemoval?.()
      && ground.getPosition().getX() === where.getX() && ground.getPosition().getY() === where.getY()
      && ids.has(ground.getItem().getId()));
    const moved = Common.alive(opener) ? `${Common.distance(opener.getLocation(), where)} tiles away` : "dead";
    const why = left.map((ground) => {
      const id = ground.getItem().getId();
      return `${Common.itemName(id)} (${Gear.wants(opener, id) ? "wanted" : "not wanted"}, gain ${Math.round(Gear.upgradeGain(opener, id) ?? 0)})`;
    });
    Common.log(`chest pile by ${opener.getUsername()}: ${left.length} of ${items.length} left after ${PILE_CHECK_TICKS} ticks, opener ${moved}${why.length ? `; left: ${why.join(", ")}` : ""}`);
  });
}

// ---------------------------------------------------------------- the floor index (for bots)

function rebuildIndex() {
  const wild = Common.data.wilderness;
  const next = new Map();
  for (const item of Common.core.World.getItems?.() ?? []) {
    if (!item || item.isPendingRemoval?.()) continue;
    const at = item.getPosition();
    if (at.getZ() !== wild.z || !Common.inBox(at.getX(), at.getY(), wild)) continue;
    const key = `${Math.floor(at.getX() / CELL)},${Math.floor(at.getY() / CELL)}`;
    let list = next.get(key);
    if (!list) next.set(key, (list = []));
    list.push(item);
  }
  index = next;
}

/** The nearest floor item within `range` that `bot` can see and wants. */
function lootNear(bot, range, upgradesOnly = false) {
  const { ItemOnGroundManager } = Common.core;
  const here = bot.getLocation();
  const cx = Math.floor(here.getX() / CELL);
  const cy = Math.floor(here.getY() / CELL);
  const reach = Math.ceil(range / CELL);
  let best = null;
  let bestDistance = range + 1;
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (const item of index.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = Common.distance(here, item.getPosition());
        if (d >= bestDistance || item.isPendingRemoval?.()) continue;
        if (!ItemOnGroundManager.canSee(bot, item)) continue;
        if (!Gear.wants(bot, item.getItem().getId())) continue;
        if (upgradesOnly && !(Gear.upgradeGain(bot, item.getItem().getId()) > 0)) continue;
        best = item;
        bestDistance = d;
      }
    }
  }
  return best;
}

/** Takes a floor item the bot stands on (or beside), wears it if better, drops what came off. */
function take(bot, groundItem) {
  const { ItemOnGroundManager } = Common.core;
  if (!groundItem || groundItem.isPendingRemoval?.() || !ItemOnGroundManager.canSee(bot, groundItem)) return false;
  if (Common.distance(bot.getLocation(), groundItem.getPosition()) > 1) return false;
  const item = groundItem.getItem();
  const id = item.getId();
  const roomy = bot.getInventory().getFreeSlots() > 0 || (item.getDefinition?.()?.isStackable?.() && bot.getInventory().contains(id));
  if (roomy) {
    if (ItemOnGroundManager.transferToInventory(bot, groundItem) <= 0) return false;
    // What a bot casts off is gone, not left on the floor (500 bots' cast-offs crash clients).
    Gear.wearUpgrades(bot);
    return true;
  }
  // A full pack (a hybrid's is full of food): gear and ammo go straight on, or into the place of
  // the piece they beat; whatever comes off goes on the floor.
  const slot = Common.core.ItemDefinition.forId(id)?.getEquipmentType?.()?.getSlot?.() ?? -1;
  if (slot < 0) return false;
  ItemOnGroundManager.deregister(groundItem);
  Gear.wearUpgrades(bot, new Common.core.Item(id, item.getAmount()));
  return true;
}

/**
 * Chests follow the safe zone: every RELOCATE_EVERY ticks a chest the fog has reached, or is within
 * RELOCATE_MARGIN tiles of, goes and a new one is placed inside the zone as it is now (placeChest),
 * at most RELOCATE_PER_PASS a pass (each placement looks for open ground). Without it the chests
 * placed at the start, spread over the whole Wilderness, ended up in the fog as the zone closed.
 */
const RELOCATE_EVERY = 10;
const RELOCATE_MARGIN = 3;
const RELOCATE_PER_PASS = 15;

function relocateChests() {
  if (!state.fog) return;
  let moved = 0;
  for (const chest of [...chests]) {
    if (moved >= RELOCATE_PER_PASS) break;
    const at = chest.getLocation();
    // Tiles between the chest and the fog's edge (negative: in the fog).
    const edge = Math.round(state.fog.radius) - Math.max(Math.abs(at.getX() - state.fog.cx), Math.abs(at.getY() - state.fog.cy));
    if (edge >= RELOCATE_MARGIN) continue;
    removeChest(chest);
    placeChest();
    moved++;
  }
  if (moved) Common.log(`chests moved into the safe zone: ${moved} (radius ${Math.round(state.fog.radius)}, ${chests.size} chests)`);
}

// ---------------------------------------------------------------- lifecycle

function started() {
  for (let i = 0; i < Common.data.chests.count; i++) placeChest();
}

function tick() {
  if (state.phase !== "battle") return;
  if (state.clock % INDEX_EVERY === 0) rebuildIndex();
  if (state.clock % RELOCATE_EVERY === 0) relocateChests();
}

function ended() {
  for (const chest of [...chests]) removeChest(chest);
  index = new Map();
  pileReports = 0;
}

function attachLoot(api) {
  State.onStart(started);
  State.onTick(tick);
  State.onKill(killed);
  State.onEliminated(eliminated);
  State.onBracket(ended);
  State.onEnd(ended);
  const id = Common.core.CacheDefinitions.getLocId(Common.data.chests.loc);
  if (id != null) api.onObjectFirstClick([id], clickChest);
}

module.exports = { attachLoot, dropForAll, hasKey, open, nearestChest, lootNear, take, dropAt, give, roll, rebuildIndex };
