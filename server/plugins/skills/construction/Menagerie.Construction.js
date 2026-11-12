"use strict";

const { api, CacheDefinitions, PluginManager, MapObjects, Item, ItemDefinition, PlayerStatus, PathFinder, RegionManager, Location, HitDamage, HitMask, Animation, World } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const PetForms = require("./PetForms.Construction");
const { examineItem } = require("../../../src/main/typescript/elvarg/game/content/ExaminePrice");

// The menagerie (rsprox captures, cache scripts 639-643): using a pet on menagerie furniture
// stores it; the pet house's View opens interface 211, whose list shows slot i of enum 985 when
// bit i of varps 864 / 1416 / 4718 is set, and a click takes the pet back. Toggle sets varbit
// 2013 (poh_menagerie_closed); stored pets roam the menagerie rooms while it is 0 and the house
// isn't in building mode.
const MENAGERIE_INTERFACE = Ids.iface("poh_menagerie");
const LIST = 7;
const ROAM_TOGGLE = 9;
const PET_ENUM = 985;
// Which pets are stored, from slot 0, 32 and 63 of the enum on.
const STORED_VARPS = [["prayer20", 0], ["menagerie_contents2", 32], ["menagerie_contents3", 63]].map(([name, first]) => [Ids.varp(name), first]);
const CLOSED_VARBIT = Ids.varbit("poh_menagerie_closed");
const STORED_ATTRIBUTE = "construction:menagerie";
const CLOSED_ATTRIBUTE = "construction:menagerie-closed";
const FORMS_ATTRIBUTE = "construction:menagerie-forms";
const MULTIFORM_ENUM_PARAM = 446;
const MENAGERIE_ROOMS = new Set(["MENAGERIE_INDOORS", "MENAGERIE_OUTDOORS"]);
const MENAGERIE_FURNITURE = /HOUSE$|HABITAT$|SCRATCHING_POST$|ARENA$|FEEDER$|PET_LIST$/;
// Stored pets walk around the whole house, not just the menagerie (RS wiki, Menagerie: pets left
// in the pet house "will walk around the house"). The default NPC random walk leashes an NPC to a
// few tiles of its spawn and steps in straight lines, so it never finds a doorway; menagerie pets
// spawn unleashed (wanderRadius 0) and path around the house themselves (roamPet).
// Per idle tick, the same roll the NPC random walk uses (osrs-docs random-walk, ~26%).
const ROAM_CHANCE = 0.26;
// Share of walks that head into another room on the pet's floor; the rest are short strolls.
const ROAM_OTHER_ROOM = 0.35;
const ROAM_NEARBY = 4;
const ROAM_TRIES = 6;
// NPC.WALK_THROUGH_ENTITIES_FLAG: like a follower pet, not stopped by players or other NPCs.
const WALK_THROUGH_ENTITIES = "movement:walk-through-entities";
// Pet arena: two roaming pets at a time are teleported into the ring for a 30 second to 2 minute
// scrap (in ticks of 0.6s), then swapped for two others; hits show but nobody loses HP.
const ARENA_MIN_TICKS = 50;
const ARENA_MAX_TICKS = 200;
const ARENA_BREAK_TICKS = 3;
/** house -> { fighters, endsAt, nextAt, last } */
const arenaState = new WeakMap();
const arenaCycle = new WeakMap();
const ARENA_SWING_TICKS = 4;
const ARENA_MAX_HIT = 3;
const ARENA_SHOUT_CHANCE = 0.15;
const ARENA_SHOUTS = ["Grrr!", "Take that!", "Is that all you've got?", "Come here!", "Rawr!"];
// NpcDefinition's fallbacks (a human punch and block), which pets without their own anims report.
const DEFAULT_ATTACK_ANIM = 422;
const DEFAULT_DEFENCE_ANIM = 424;
const MAX_ROAMING = 20;

let petsBySlot = null;
/** house -> Map(npc -> slot) */
const roaming = new WeakMap();
const pending = new WeakMap();

/** Slot -> { itemId, npcId } from the cache enum and the Pets plugin's definitions. */
function pets() {
  if (petsBySlot) return petsBySlot;
  const request = { pets: [] };
  api.emitCustomEvent("pets:definitions", request);
  const npcByItem = new Map(request.pets.map(pet => [pet.itemId, pet.houseNpcId ?? pet.petId]));
  petsBySlot = new Map([...CacheDefinitions.getEnumValues(PET_ENUM)].map(([slot, itemId]) => {
    const forms = new Map(request.pets.filter(pet => pet.familyItemId === itemId)
      .map(pet => [pet.itemId, {itemId: pet.itemId, npcId: pet.houseNpcId ?? pet.petId}]));
    const enumId = CacheDefinitions.getItem(itemId).params?.get(MULTIFORM_ENUM_PARAM);
    const formVarbit = PetForms.varbitForEnum(enumId);
    return [slot, { itemId, npcId: npcByItem.get(itemId) ?? -1, forms, enumId, formVarbit }];
  }));
  return petsBySlot;
}

function slotOf(itemId) {
  for (const [slot, pet] of pets()) if (pet.itemId === itemId || pet.forms.has(itemId)) return slot;
  return -1;
}

function stored(player) {
  return new Set(player.getAttribute(STORED_ATTRIBUTE) ?? []);
}

function storedPet(player, slot) {
  const base = pets().get(slot);
  return base?.forms.get(player.getAttribute(FORMS_ATTRIBUTE)?.[slot]) ?? base;
}

function sendStored(player) {
  const slots = stored(player);
  for (const [varp, first] of STORED_VARPS) {
    let value = 0;
    for (let bit = 0; bit < 32; bit++) if (slots.has(first + bit)) value |= 1 << bit;
    player.getPacketSender().sendConfig(varp, value);
  }
  player.getPacketSender().sendVarbit(CLOSED_VARBIT, player.getAttribute(CLOSED_ATTRIBUTE) ? 1 : 0);
  for (const [slot, pet] of pets()) {
    if (!pet.forms.size || !Number.isInteger(pet.enumId) || !Number.isInteger(pet.formVarbit)) continue;
    const itemId = storedPet(player, slot).itemId;
    const form = [...CacheDefinitions.getEnumValues(pet.enumId)].find(([, id]) => id === itemId)?.[0] ?? 0;
    player.getPacketSender().sendVarbit(pet.formVarbit, form);
  }
  if (player.getInterfaceId() === MENAGERIE_INTERFACE) {
    // Script641 creates children by enum slot; script2266's onOp is only cosmetic.
    player.getPacketSender().sendInterfaceFlagsRange((MENAGERIE_INTERFACE << 16) | LIST, 0, 71, (1 << 1) | (1 << 10));
  }
}

function inMenagerie(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const room = furniture && house.getRoom(house.getRoomPositionAt(event.location));
  return room && MENAGERIE_ROOMS.has(room.roomKey) && MENAGERIE_FURNITURE.test(furniture.buildableKey) ? house : null;
}

function view(event) {
  if (!inMenagerie(event)) return false;
  event.player.getPacketSender().sendInterface(MENAGERIE_INTERFACE);
  sendStored(event.player);
  return true;
}

function storePet(event) {
  const slot = slotOf(event.itemId);
  const house = slot >= 0 && inMenagerie(event);
  if (!house) return;
  event.handled = true;
  const player = event.player;
  if (house.owner !== player) return player.sendMessage("You can only keep pets in your own menagerie.");
  if (house.buildingMode) return player.sendMessage("You can't spawn pets unless they're permitted to roam the house, which they can't do in building mode.");
  const context = {player, house, slot, event, origin: player.getLocation().clone()};
  pending.set(player, context);
  storeNow(context);
}

function safe(context) {
  const {player, house, origin} = context;
  return player.isRegistered() && player.getHitpoints() > 0 && player.getStatus() === PlayerStatus.NONE && !house.buildingMode &&
    house.owner === player && House.houseFor(player) === house &&
    player.getLocation().equals(origin) && !player.isNeedsPlacement() &&
    !player.isTeleportingReturn() && !player.getForceMovement();
}

function storeNow(context) {
  const {player, house, slot, event} = context;
  if (pending.get(player) !== context || !safe(context) || player.busy()) return;
  const inventory = player.getInventory();
  if (inventory.getItems()[event.itemSlot] !== event.item || event.item.getId() !== event.itemId ||
      event.item.getAmount() < 1 || inMenagerie(event) !== house ||
      !MapObjects.stillStands(player, event.objectId, event.object.getLocation(), event.object)) return;
  const pin = {player, feature: "poh-menagerie", resume: () => storeNow(context)};
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || pending.get(player) !== context || !safe(context)) return;
  pending.delete(player);
  const slots = stored(player);
  if (slots.has(slot)) return player.sendMessage("You already have that pet in your menagerie.");
  inventory.deletedItem(new Item(event.itemId, 1), event.itemSlot, true);
  player.setAttribute(FORMS_ATTRIBUTE, {...player.getAttribute(FORMS_ATTRIBUTE), [slot]: event.itemId});
  slots.add(slot);
  player.setAttribute(STORED_ATTRIBUTE, [...slots]);
  sendStored(player);
  refreshPets(house);
}

function interfaceClick(event) {
  if (event.groupId !== MENAGERIE_INTERFACE) return;
  const player = event.player;
  const house = House.houseFor(player);
  if (!house || house.owner !== player) return;
  event.handled = true;
  if (!player.isRegistered() || player.getHitpoints() <= 0 || house.buildingMode ||
      player.getInterfaceId() !== MENAGERIE_INTERFACE ||
      !player.getPacketSender().isSubInterfaceOpen(MENAGERIE_INTERFACE)) return;
  if (event.childId === ROAM_TOGGLE) {
    if ((event.opId ?? event.action ?? 1) !== 1) return;
    player.setAttribute(CLOSED_ATTRIBUTE, !player.getAttribute(CLOSED_ATTRIBUTE));
    sendStored(player);
    refreshPets(house);
    return;
  }
  const slot = event.slot;
  const slots = stored(player);
  if (event.childId === LIST && slots.has(slot) && (event.opId ?? event.action) === 10) {
    examineItem(player, storedPet(player, slot).itemId, 1);
    return;
  }
  if (event.childId !== LIST || !slots.has(slot) || (event.opId ?? event.action ?? 1) > 1) return;
  const context = {player, house, slot, itemId: storedPet(player, slot).itemId, origin: player.getLocation().clone()};
  pending.set(player, context);
  withdrawNow(context);
}

function resumeWithdrawal(context) {
  const {player} = context;
  if (pending.get(player) !== context || !safe(context) || player.busy()) return;
  player.getPacketSender().sendInterface(MENAGERIE_INTERFACE);
  sendStored(player);
  withdrawNow(context);
}

function withdrawNow(context) {
  const {player, house, slot, itemId} = context;
  const slots = stored(player);
  if (pending.get(player) !== context || !safe(context) || !slots.has(slot) ||
      storedPet(player, slot).itemId !== itemId || player.getInterfaceId() !== MENAGERIE_INTERFACE ||
      !player.getPacketSender().isSubInterfaceOpen(MENAGERIE_INTERFACE)) return;
  const pin = {player, feature: "poh-menagerie", resume: () => resumeWithdrawal(context)};
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || pending.get(player) !== context || !safe(context)) return;
  pending.delete(player);
  if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space.");
  slots.delete(slot);
  player.setAttribute(STORED_ATTRIBUTE, [...slots]);
  player.getInventory().adds(storedPet(player, slot).itemId, 1);
  const forms = {...player.getAttribute(FORMS_ATTRIBUTE)};
  delete forms[slot];
  player.setAttribute(FORMS_ATTRIBUTE, forms);
  sendStored(player);
  refreshPets(house);
}

function clearPending({player}) { pending.delete(player); }

/** Instance.rebuild: stored pets roam the menagerie rooms while the owner lets them. */
function refreshPets(house) {
  const out = roaming.get(house) ?? new Map();
  roaming.set(house, out);
  const owner0 = house.owner;
  const wanted = owner0 && !house.buildingMode && !owner0.getAttribute(CLOSED_ATTRIBUTE) ? [...stored(owner0)].slice(0, MAX_ROAMING) : [];
  // Each occupant's rebuild calls this; leave the pets alone unless what should roam changed.
  if (wanted.length === out.size && [...out].every(([npc, slot]) => npc.isRegistered() && wanted.includes(slot))) return;
  for (const npc of out.keys()) if (npc.isRegistered()) { house.leave(npc, false); PluginManager.removeNpc(npc); }
  out.clear();
  arenaState.delete(house);
  const owner = house.owner;
  if (!owner || house.buildingMode || owner.getAttribute(CLOSED_ATTRIBUTE)) return;
  const tiles = menagerieTiles(house);
  if (!tiles.length) return;
  for (const slot of [...stored(owner)].slice(0, MAX_ROAMING)) {
    const pet = storedPet(owner, slot);
    if (!pet || pet.npcId < 0) continue;
    const at = tiles[Math.floor(Math.random() * tiles.length)];
    const npc = PluginManager.spawnNpc({ id: pet.npcId, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0 });
    if (!npc) continue;
    npc.__skipDefaultRespawn = true;
    npc.setFlag(WALK_THROUGH_ENTITIES);
    house.enter(npc);
    out.set(npc, slot);
  }
}

/** The tiles the pet arena's pieces cover (their full footprints); null without an arena. */
function arenaRing(house) {
  let box = null;
  for (const entry of house.furnitureEntries()) {
    if (entry.furniture.hotspotKey !== "ARENA" || !MENAGERIE_ROOMS.has(entry.room.roomKey)) continue;
    const at = entry.location;
    let sizeX = 1, sizeY = 1;
    for (const id of [entry.furniture.sourceObjectId, entry.furniture.displayObjectId]) {
      const definition = Number.isInteger(id) ? CacheDefinitions.getObject(id) : null;
      if (!definition) continue;
      sizeX = Math.max(sizeX, ((entry.face & 1) ? definition.sizeY : definition.sizeX) ?? 1);
      sizeY = Math.max(sizeY, ((entry.face & 1) ? definition.sizeX : definition.sizeY) ?? 1);
    }
    box = box ?? { minX: at.getX(), maxX: at.getX(), minY: at.getY(), maxY: at.getY(), z: at.getZ() };
    box.minX = Math.min(box.minX, at.getX()); box.maxX = Math.max(box.maxX, at.getX() + sizeX - 1);
    box.minY = Math.min(box.minY, at.getY()); box.maxY = Math.max(box.maxY, at.getY() + sizeY - 1);
  }
  return box;
}

/** The arena ring with one tile of margin, which roaming pets are kept out of; null without one. */
function arenaBox(house) {
  const box = arenaRing(house);
  return box && { ...box, minX: box.minX - 1, maxX: box.maxX + 1, minY: box.minY - 1, maxY: box.maxY + 1 };
}

/** Where arena pets stand: the ring's walkable tiles, or its middle if the whole piece blocks. */
function arenaTiles(house) {
  const ring = arenaRing(house);
  if (!ring) return [];
  const inRoom = (x, y) => { const position = house.getRoomPositionAt({ x, y, z: ring.z }); return position && house.getRoom(position); };
  // The footprint's outer tiles sit outside the ropes; fighters only stand on the ones inside them.
  const inset = (min, max) => max - min >= 2 ? [min + 1, max - 1] : [min, max];
  const [minX, maxX] = inset(ring.minX, ring.maxX), [minY, maxY] = inset(ring.minY, ring.maxY);
  const open = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
    if (inRoom(x, y) && !RegionManager.blocked(new Location(x, y, ring.z), house)) open.push(new Location(x, y, ring.z));
  }
  if (open.length) return open;
  const cx = Math.floor((minX + maxX) / 2), cy = Math.floor((minY + maxY) / 2);
  return [new Location(cx, cy, ring.z), new Location(cx + 1 <= maxX ? cx + 1 : cx, cy, ring.z)];
}

/**
 * Open floor in the menagerie, where pets appear and where arena fighters go back to: never on
 * furniture or inside the pet arena's ring, which they couldn't walk out of.
 */
function menagerieTiles(house) {
  const arena = arenaBox(house);
  const corners = new Map();
  for (const entry of house.furnitureEntries()) {
    if (!MENAGERIE_ROOMS.has(entry.room.roomKey)) continue;
    const at = entry.location;
    const cx = at.getX() - ((at.getX() - house.allocation.baseX) & 7), cy = at.getY() - ((at.getY() - house.allocation.baseY) & 7);
    corners.set(`${cx}:${cy}:${at.getZ()}`, { x: cx, y: cy, z: at.getZ() });
  }
  const tiles = [];
  for (const corner of corners.values()) for (let dx = 1; dx <= 6; dx++) for (let dy = 1; dy <= 6; dy++) {
    if (openTile(house, corner.x + dx, corner.y + dy, corner.z, arena)) tiles.push(new Location(corner.x + dx, corner.y + dy, corner.z));
  }
  return tiles;
}

const pick = list => list[Math.floor(Math.random() * list.length)];

/**
 * Arena match-maker, once per tick per house: while the ring is empty and at least two pets roam,
 * two random ones (not the last pair when others are free) are teleported in and fight for
 * ARENA_MIN_TICKS-ARENA_MAX_TICKS (30 seconds to 2 minutes), then both go back to roaming and,
 * ARENA_BREAK_TICKS later, the next two go in.
 */
function arenaManage(house) {
  const cycle = World.getProcessCycle();
  if (arenaCycle.get(house) === cycle) return;
  arenaCycle.set(house, cycle);
  const out = roaming.get(house);
  let state = arenaState.get(house);
  if (!state) arenaState.set(house, state = { fighters: [], endsAt: 0, nextAt: cycle + ARENA_BREAK_TICKS, last: [] });
  const ring = arenaTiles(house);
  if (state.fighters.length) {
    const broken = state.fighters.some(npc => !npc.isRegistered() || !out?.has(npc));
    if (broken || !ring.length || cycle >= state.endsAt) endFight(house, state, cycle);
    return;
  }
  if (!ring.length || !out || cycle < state.nextAt) return;
  const pool = [...out.keys()].filter(npc => npc.isRegistered());
  if (pool.length < 2) return;
  const fresh = pool.filter(npc => !state.last.includes(npc));
  const from = fresh.length >= 2 ? fresh : pool;
  const first = pick(from);
  const second = pick(from.filter(npc => npc !== first));
  const spotA = pick(ring);
  const others = ring.filter(tile => !tile.equals(spotA));
  // A couple of tiles apart inside the ropes, so they square up before the first swing.
  const apart = others.filter(tile => Math.max(Math.abs(tile.getX() - spotA.getX()), Math.abs(tile.getY() - spotA.getY())) === 2);
  const spotB = apart.length ? pick(apart) : others.length ? pick(others) : spotA;
  for (const [npc, spot] of [[first, spotA], [second, spotB]]) {
    npc.moveTo(spot);
    npc.__menagerieArena = true;
    npc.__arenaNextSwing = undefined;
    npc.setHitpointsLocked(true);
    if (npc.getHitpoints() <= 0) npc.setHitpoints(10);
  }
  state.fighters = [first, second];
  state.endsAt = cycle + ARENA_MIN_TICKS + Math.floor(Math.random() * (ARENA_MAX_TICKS - ARENA_MIN_TICKS + 1));
}

/** Time's up: both fighters are teleported back onto open menagerie floor to roam again. */
function endFight(house, state, cycle) {
  const tiles = menagerieTiles(house);
  for (const npc of state.fighters) {
    npc.__menagerieArena = false;
    npc.__arenaNextSwing = undefined;
    if (npc.isRegistered() && tiles.length) npc.moveTo(pick(tiles));
  }
  state.last = state.fighters;
  state.fighters = [];
  state.nextAt = cycle + ARENA_BREAK_TICKS;
}

/**
 * Pet arena (wiki, Pet house: pets placed in the arena "let off steam"; two placed inside attack each
 * other but can never kill each other). Per tick for each arena pet: alone it paces the ring; with a
 * rival it faces it, closes in and swings every ARENA_SWING_TICKS. Hits show but HP is locked.
 */
function arenaTick(house, npc) {
  const out = roaming.get(house);
  const rival = [...out.keys()].find(other => other !== npc && other.__menagerieArena && other.isRegistered());
  const queue = npc.getMovementQueue();
  if (!queue.getMobility().canMove()) return;
  const idle = queue.size() === 0 && !queue.isMovings();
  if (!rival) {
    if (!idle || Math.random() >= ROAM_CHANCE) return;
    const tiles = arenaTiles(house);
    const target = tiles[Math.floor(Math.random() * tiles.length)];
    if (target && !target.equals(npc.getLocation())) PathFinder.calculateWalkRoute(npc, target.getX(), target.getY());
    return;
  }
  const here = npc.getLocation(), there = rival.getLocation();
  npc.setPositionToFace(there);
  const cycle = World.getProcessCycle();
  if (npc.__arenaNextSwing === undefined) npc.__arenaNextSwing = cycle + 1 + Math.floor(Math.random() * ARENA_SWING_TICKS);
  if (cycle < npc.__arenaNextSwing) return;
  const distance = Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY()));
  if (distance > 1) {
    if (idle) PathFinder.calculateWalkRoute(npc, there.getX() + Math.sign(here.getX() - there.getX()), there.getY() + Math.sign(here.getY() - there.getY()));
    return;
  }
  npc.__arenaNextSwing = cycle + ARENA_SWING_TICKS + Math.floor(Math.random() * 2);
  const attack = npc.getDefinition?.()?.getAttackAnim?.();
  if (attack > 0 && attack !== DEFAULT_ATTACK_ANIM) npc.performAnimation(new Animation(attack));
  const block = rival.getDefinition?.()?.getDefenceAnim?.();
  if (block > 0 && block !== DEFAULT_DEFENCE_ANIM) rival.performAnimation(new Animation(block));
  rival.setHitpointsLocked(true);
  if (rival.getHitpoints() <= 0) rival.setHitpoints(10);
  const damage = Math.floor(Math.random() * (ARENA_MAX_HIT + 1));
  rival.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  if (Math.random() < ARENA_SHOUT_CHANCE) npc.forceChat(ARENA_SHOUTS[Math.floor(Math.random() * ARENA_SHOUTS.length)]);
}

/** A walkable floor tile in one of the house's rooms, outside the arena ring. */
function openTile(house, x, y, z, arena) {
  const position = house.getRoomPositionAt({ x, y, z });
  if (!position || !house.getRoom(position)) return false;
  if (arena && arena.z === z && x >= arena.minX && x <= arena.maxX && y >= arena.minY && y <= arena.maxY) return false;
  return !RegionManager.blocked(new Location(x, y, z), house);
}

/** A random open tile in one of the house's rooms on `at`'s floor, or null. */
function roamTarget(house, at) {
  const arena = arenaBox(house);
  for (let attempt = 0; attempt < ROAM_TRIES; attempt++) {
    const target = roamPick(house, at);
    if (target && openTile(house, target.x, target.y, at.z, arena)) return target;
  }
  return null;
}

function roamPick(house, at) {
  const here = house.getRoomPositionAt(at);
  if (!here || !house.getRoom(here)) return null;
  const tile = (x, y) => {
    const position = house.getRoomPositionAt({ x, y, z: at.z });
    return position && house.getRoom(position) ? { x, y } : null;
  };
  if (Math.random() < ROAM_OTHER_ROOM) {
    const rooms = [];
    for (let x = 0; x < house.gridSize; x++) for (let y = 0; y < house.gridSize; y++) {
      if ((x !== here.x || y !== here.y) && house.getRoom({ x, y, plane: here.plane })) rooms.push({ x, y });
    }
    if (rooms.length) {
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      // Room tiles run 0-7 from the room's corner; 1-6 keeps clear of its walls.
      const cornerX = at.x - ((at.x - house.allocation.baseX) & 7) + (room.x - here.x) * 8;
      const cornerY = at.y - ((at.y - house.allocation.baseY) & 7) + (room.y - here.y) * 8;
      return tile(cornerX + 1 + Math.floor(Math.random() * 6), cornerY + 1 + Math.floor(Math.random() * 6));
    }
  }
  const offset = () => Math.round(Math.random() * ROAM_NEARBY * 2 - ROAM_NEARBY);
  return tile(at.x + offset(), at.y + offset());
}

/** PlayerHouseInstance.process, per NPC per tick: an idle menagerie pet sometimes sets off somewhere. */
function roamPet(house, npc) {
  if (house.buildingMode || !roaming.get(house)?.has(npc) || !npc.isRegistered()) return;
  arenaManage(house);
  if (npc.__menagerieArena) return arenaTick(house, npc);
  const queue = npc.getMovementQueue();
  if (queue.size() > 0 || queue.isMovings() || npc.getInteractingMobile() != null) return;
  if (!queue.getMobility().canMove() || Math.random() >= ROAM_CHANCE) return;
  const target = roamTarget(house, npc.getLocation());
  if (target && (target.x !== npc.getLocation().x || target.y !== npc.getLocation().y)) {
    PathFinder.calculateWalkRoute(npc, target.x, target.y);
  }
}

/** `pets:held-elsewhere`: a pet kept in the owner's menagerie is still theirs. */
function heldInMenagerie(request) {
  const slot = slotOf(request.itemId);
  if (slot >= 0 && stored(request.player).has(slot)) request.held = true;
}

function attachMenagerie(api) {
  api.persistAttribute(STORED_ATTRIBUTE, []);
  api.persistAttribute(CLOSED_ATTRIBUTE, false);
  api.persistAttribute(FORMS_ATTRIBUTE, {});
  for (const name of ["Oak house", "Teak house", "Mahogany house", "Consecrated house", "Desecrated house", "Nature house"]) {
    api.onObjectInteraction(name, { View: view });
  }
  api.onItemOnObject(storePet, { noted: false });
  api.onInterfaceActionClick(interfaceClick);
  api.onCustomEvent("pets:held-elsewhere", heldInMenagerie);
  api.onPlayerLogout(clearPending);
  api.onPlayerDisconnect(clearPending);
}

Object.assign(module.exports, { attachMenagerie, refreshPets, roamPet });
