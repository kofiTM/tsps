/**
 * Deadman Tournament gear: everyone at 99 combat (level 126), a starter kit, and the gear score
 * bots use to decide whether something on the floor is an upgrade over what they wear.
 *
 * Bonus layout (BonusManager): 0-4 attack stab/slash/crush/magic/ranged, 5-9 defence, 10 melee
 * strength, 11 ranged strength, 12 magic damage, 13 prayer.
 */
const Common = require("./Common.DeadmanTournament");
const state = () => require("./State.DeadmanTournament").state;

const STYLES = ["melee", "ranged", "magic"];
const COMBAT_SKILLS = ["ATTACK", "STRENGTH", "DEFENCE", "HITPOINTS", "RANGED", "MAGIC", "PRAYER"];

function bonusesOf(id) {
  const bonuses = Common.core.ItemDefinition.forId(id)?.getBonuses?.() ?? [];
  return Array.from({ length: 14 }, (_, i) => Number(bonuses[i]) || 0);
}

function slotOf(id) {
  return Common.core.ItemDefinition.forId(id)?.getEquipmentType?.()?.getSlot?.() ?? -1;
}

function isTwoHanded(id) {
  return Common.core.ItemDefinition.forId(id)?.isDoubleHanded?.() === true;
}

/**
 * The style a weapon is for. By its kind first - a staff's crush and strength bonuses would read
 * as melee (the ancient staff has +50 strength, +15 magic) - then by its biggest attack bonus.
 */
const MAGIC_WEAPON = /staff|wand|sceptre|trident|sanguinesti|tumeken/i;
const RANGED_WEAPON = /bow|ballista|blowpipe|knife|dart|javelin|chinchompa|thrownaxe|crossbow/i;

function weaponStyle(id) {
  const name = Common.itemName(id);
  if (MAGIC_WEAPON.test(name)) return "magic";
  if (RANGED_WEAPON.test(name)) return "ranged";
  const b = bonusesOf(id);
  const melee = Math.max(b[0], b[1], b[2]) + b[10];
  const ranged = b[4] + b[11];
  const magic = b[3] + b[12] * 5;
  if (ranged > melee && ranged >= magic) return "ranged";
  if (magic > melee && magic > ranged) return "magic";
  return "melee";
}

/** How much one item is worth to a fighter of `style`. */
function score(id, style) {
  if (!id || id <= 0) return 0;
  const b = bonusesOf(id);
  const defence = (b[5] + b[6] + b[7] + b[8] + b[9]) * 0.2;
  const prayer = b[13] * 0.3;
  if (style === "ranged") return b[4] + b[11] * 1.5 + defence + prayer;
  if (style === "magic") return b[3] + b[12] * 6 + defence + prayer;
  return Math.max(b[0], b[1], b[2]) + b[10] * 1.5 + defence + prayer;
}

function styleOf(player) {
  return player.getAttribute(Common.ATTRIBUTES.style) ?? "melee";
}

function setLevels(player) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  for (const name of COMBAT_SKILLS) {
    const level = Common.data.stats[name] ?? 99;
    const skill = Skill[name];
    if (!skill) continue;
    skills.setMaxLevels(skill, level, false);
    skills.setExperiences(skill, 0, false);
    skills.setCurrentLevel(skill, level, true);
  }
  player.getUpdateFlag().flag(Common.core.Flag.APPEARANCE);
}

function refresh(player) {
  const { BonusManager, Flag, WeaponInterfaceManager, CombatSpecial } = Common.core;
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  try {
    WeaponInterfaceManager.assign(player);
  } catch (_error) {
    // A bot has no weapon interface to redraw.
  }
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  try {
    CombatSpecial.updateBar(player);
  } catch (_error) {
    // Nothing to redraw.
  }
}

function heal(player) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  for (const name of COMBAT_SKILLS) {
    const skill = Skill[name];
    if (skill) skills.setCurrentLevel(skill, skills.getMaxLevel(skill), true);
  }
  player.setRunEnergy?.(100);
  player.setSpecialPercentage?.(100);
  try {
    Common.core.CombatSpecial?.updateBar?.(player);
  } catch (_error) {
    // No bar to redraw (a bot).
  }
  player.setPoisonDamage?.(0);
  player.setVenomed?.(false);
}

function empty(player) {
  const { Item } = Common.core;
  for (const container of [player.getInventory(), player.getEquipment()]) {
    container.getItems().forEach((_, slot) => container.setItem(slot, new Item(-1, 0)));
  }
}

/** Everything a player carries and wears (the drop on their death). */
function belongings(player) {
  const { Item } = Common.core;
  const items = [];
  for (const container of [player.getInventory(), player.getEquipment()]) {
    for (const item of container.getItems()) if (item && item.getId() > 0) items.push(new Item(item.getId(), item.getAmount()));
  }
  return items;
}

/** A kit's name, drawn by `kitWeights`. */
function pickKit() {
  const weights = Object.entries(Common.data.kitWeights ?? {}).filter(([name]) => Common.data.kits[name]);
  if (weights.length === 0) return Common.pick(STYLES);
  let roll = Math.random() * weights.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [name, weight] of weights) {
    roll -= weight;
    if (roll < 0) return name;
  }
  return weights[0][0];
}

/** Empty inventory and equipment, everyone's 99s, one starter kit, its spellbook. */
function equipKit(player, kitName = pickKit()) {
  const { Item, MagicSpellbook } = Common.core;
  const kit = Common.data.kits[kitName];
  const style = kit.style ?? kitName;
  empty(player);
  setLevels(player);
  const equipment = player.getEquipment();
  for (const [id, , amount] of kit.worn) {
    const slot = slotOf(id);
    if (slot >= 0) equipment.setItem(slot, new Item(id, amount ?? 1));
  }
  const inventory = player.getInventory();
  for (const [id, , amount] of kit.inventory) {
    const definition = Common.core.ItemDefinition.forId(id);
    if (definition?.isStackable?.()) inventory.add(new Item(id, amount ?? 1), false);
    else for (let i = 0; i < (amount ?? 1); i++) inventory.add(new Item(id, 1), false);
  }
  const book = MagicSpellbook[kit.spellbook] ?? MagicSpellbook.NORMAL;
  if (book) {
    player.setSpellbook(book);
    player.getPacketSender().sendTabInterface?.(6, book.getInterfaceId());
  }
  player.getCombat?.().setAutocastSpell?.(null);
  player.setAttribute(Common.ATTRIBUTES.style, style);
  player.setAttribute("deadman-tournament:kit", kitName);
  player.setAttribute(Common.ATTRIBUTES.runes, kit.inventory.map(([id]) => id).filter((id) => isRune(id)));
  heal(player);
  refresh(player);
}

const runeIds = () => new Set(Common.data.supplies.runes.map(([id]) => id));
const supplyIds = () => new Set([...Common.data.supplies.food, ...Common.data.supplies.potions].map(([id]) => id));

function isRune(id) {
  return runeIds().has(id);
}

function isSupply(id) {
  return supplyIds().has(id);
}

function suppliesCarried(player) {
  const supplies = supplyIds();
  return player.getInventory().getItems().filter((item) => item && supplies.has(item.getId())).length;
}

const keyIds = () => [Common.data.keys.bloody[0], Common.data.keys.bloodier[0]];

/**
 * The style a piece of gear is for: a weapon by its attack, armour by its biggest offensive bonus
 * ("any" for gear with none: a helm of pure defence, boots, a cape).
 */
function itemStyle(id) {
  if (slotOf(id) === Common.core.Equipment.WEAPON_SLOT) return weaponStyle(id);
  const b = bonusesOf(id);
  const melee = Math.max(b[0], b[1], b[2]) + b[10];
  const ranged = b[4] + b[11];
  const magic = b[3] + b[12] * 5;
  const best = Math.max(melee, ranged, magic);
  if (best <= 0) return "any";
  return best === magic ? "magic" : best === ranged ? "ranged" : "melee";
}

/** Slots a hybrid carries one piece per style for (switches); the rest hold one piece each. */
let switchSlots = null;
/** Every piece of a set weapon's set (`setWeapons`: Dharok's helm, body, legs). */
let setPieces = null;
function setPieceIds() {
  if (!setPieces) setPieces = new Set(Object.values(Common.data.setWeapons ?? {}).filter(Array.isArray).flat());
  return setPieces;
}

function isSwitchSlot(slot) {
  if (!switchSlots) {
    const { Equipment } = Common.core;
    // Body and legs by a known item's slot (rune platebody, rune platelegs), not a guessed index.
    switchSlots = new Set([Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT, slotOf(1127), slotOf(1079)]);
  }
  return switchSlots.has(slot);
}

/** The role a piece fills: its slot, and for a switch slot the style it's for. */
/** The spec weapons bots use (the bot runtime's list): a bot keeps one, its best. */
let specWeapons = null;
function specIds() {
  if (!specWeapons) {
    try {
      specWeapons = new Set(require("../../bots/behaviours/policies/PvpCombatRuntimeCache.PlayerBots").SUPPORTED_SPEC_WEAPONS ?? []);
    } catch (_error) {
      specWeapons = new Set();
    }
    // The magic shortbow isn't a spec weapon here: it's only a bow, so the spec slot goes to a real one.
    for (const id of BANNED_SPECS) specWeapons.delete(id);
  }
  return specWeapons;
}
/** Magic shortbow, (i) and the other id: never used to spec. */
const BANNED_SPECS = new Set([861, 12788, 20558]);

function roleOf(bot, id) {
  const slot = slotOf(id);
  // Spec weapons share one role: only the best is carried (a pack of specs leaves no room for food).
  if (specIds().has(id)) {
    const style = itemStyle(id);
    return { key: "spec", slot, style: style === "any" ? "melee" : style };
  }
  if (!isSwitchSlot(slot)) return { key: `${slot}`, slot, style: styleOf(bot) };
  const style = itemStyle(id);
  // Body or legs with no offensive bonus (a rune platebody, Dharok's) is tank armour: a melee piece,
  // not something a mage or ranger wears over their own robes or hide.
  const as = style === "any" ? "melee" : style;
  return { key: `${slot}:${as}`, slot, style: as };
}

/** Everything wearable a bot has, worn or carried, with where it is. */
function gearOf(bot) {
  const { Equipment } = Common.core;
  const gear = [];
  bot.getEquipment().getItems().forEach((item, index) => {
    if (item && item.getId() > 0 && index !== Equipment.AMMUNITION_SLOT) gear.push({ where: "worn", index, id: item.getId(), amount: item.getAmount() });
  });
  bot.getInventory().getItems().forEach((item, index) => {
    const id = item?.getId?.() ?? -1;
    if (id > 0 && slotOf(id) >= 0 && slotOf(id) !== Equipment.AMMUNITION_SLOT) gear.push({ where: "inv", index, id, amount: item.getAmount() });
  });
  return gear;
}

/**
 * How much better `id` is than the bot's best piece in the same role (0: not wanted). A switch
 * for a style the bot has nothing for is wanted if there's room to carry it.
 */
function upgradeGain(bot, id) {
  const { Equipment } = Common.core;
  const slot = slotOf(id);
  if (slot < 0 || slot === Equipment.AMMUNITION_SLOT) return 0;
  const role = roleOf(bot, id);
  if (role.style === "ranged" && slot === Equipment.WEAPON_SLOT && !hasAmmoFor(bot, id)) return 0;
  if (!hasSetFor(bot, id)) return 0;
  let current = null;
  for (const piece of gearOf(bot)) {
    if (piece.id === id || roleOf(bot, piece.id).key !== role.key) continue;
    const value = score(piece.id, role.style);
    if (current === null || value > current) current = value;
  }
  const gain = score(id, role.style) - (current ?? 0);
  // A switch for a style they have nothing for needs room in the pack (and the wear-or-carry rules).
  // (with a full pack it can give up one food for it, while it still has food to spare).
  if (current === null && isSwitchSlot(slot) && role.style !== styleOf(bot) && bot.getInventory().getFreeSlots() < 1
    && (spareFood(bot) == null || !worthFood(id, role.style))) return 0;
  return gain;
}

/** Food a bot can give up to carry a new switch: one food slot, if it keeps at least MIN_FOOD. */
const MIN_FOOD = 6;
function spareFood(bot) {
  const food = new Set(Common.data.supplies.food.map(([id]) => id));
  const slots = bot.getInventory().getItems().map((item, i) => (item && food.has(item.getId()) ? i : -1)).filter((i) => i >= 0);
  return slots.length > MIN_FOOD ? slots[slots.length - 1] : null;
}

/** Worth a food slot: a piece with a real attack bonus for its style (not plain tank armour). */
function worthFood(id, style) {
  if (slotOf(id) === Common.core.Equipment.WEAPON_SLOT) return true;
  const b = bonusesOf(id);
  const offence = style === "ranged" ? b[4] + b[11] : style === "magic" ? b[3] + b[12] * 5 : Math.max(b[0], b[1], b[2]) + b[10];
  return offence >= 10;
}

/** Whether a bot wants this floor item at all: better gear, a supply it has room for, its runes, a key. */
function wants(bot, itemId) {
  if (keyIds().includes(itemId)) return bot.getInventory().getFreeSlots() > 0;
  if (isRune(itemId)) return (bot.getAttribute(Common.ATTRIBUTES.runes) ?? []).includes(itemId);
  if (isSupply(itemId)) return bot.getInventory().getFreeSlots() > 1 && suppliesCarried(bot) < Common.data.supplies.maxSupplies;
  if (isAmmo(itemId)) return rangedWeapons(bot).some((weapon) => ammoFits(weapon, itemId));
  return upgradeGain(bot, itemId) > 0;
}

/** Ammo the data pairs with a ranged weapon (bows with arrows, crossbows with bolts...). */
function ammoFor(weaponId) {
  const name = Common.itemName(weaponId).toLowerCase();
  // Craw's bow (and the Webweaver) fire their own charge, no ammo.
  if (name.includes("craw's bow") || name.includes("webweaver")) return [];
  if (name.includes("karil")) return ["bolt rack"];
  if (name.includes("ballista")) return ["javelin"];
  if (name.includes("crossbow")) return ["bolts"];
  if (name.includes("bow")) return ["arrow"];
  return [];
}

function isAmmo(id) {
  return slotOf(id) === Common.core.Equipment.AMMUNITION_SLOT;
}

function ammoFits(weaponId, ammoId) {
  const name = Common.itemName(ammoId).toLowerCase();
  return ammoFor(weaponId).some((word) => name.includes(word));
}

function rangedWeapons(bot) {
  const { Equipment } = Common.core;
  return gearOf(bot).filter((piece) => slotOf(piece.id) === Equipment.WEAPON_SLOT && ammoFor(piece.id).length > 0).map((piece) => piece.id);
}

/** A set weapon (`setWeapons`: Dharok's greataxe) is only any use with every piece of its set. */
function hasSetFor(bot, weaponId) {
  const pieces = Common.data.setWeapons?.[String(weaponId)];
  if (!Array.isArray(pieces)) return true;
  const owned = new Set(gearOf(bot).map((piece) => piece.id));
  return pieces.every((id) => owned.has(id));
}

function hasAmmoFor(bot, weaponId) {
  if (ammoFor(weaponId).length === 0) return true;
  const carried = [...bot.getInventory().getItems(), bot.getEquipment().getItems()[Common.core.Equipment.AMMUNITION_SLOT]];
  return carried.some((item) => item && item.getId() > 0 && ammoFits(weaponId, item.getId()));
}

/**
 * Sorts a bot's gear after it picks something up (`extra`: a piece straight off the floor that
 * there's no inventory room for - a hybrid's pack is full of food). Per role (one per slot, and
 * one per style for weapon, shield, body and legs - a hybrid's switches) it keeps the best piece
 * and drops the rest. A better piece for the role it's wearing goes on; a switch for another style
 * goes in the pack (in the place of the one it beats) for the bot's own gear switching. Ammo that
 * fits one of its ranged weapons is kept (in the quiver if that's free or holds ammo nothing uses),
 * other ammo is dropped. Returns what came off, for the floor.
 */
function wearUpgrades(bot, extra = null) {
  const { Item, Equipment } = Common.core;
  const inventory = bot.getInventory();
  const equipment = bot.getEquipment();
  const dropped = [];
  let changed = false;
  const take = (piece) => {
    if (piece.where === "worn") equipment.setItem(piece.index, new Item(-1, 0));
    else if (piece.where === "inv") inventory.setItem(piece.index, new Item(-1, 0));
  };
  const freeSlot = () => inventory.getItems().findIndex((item) => !item || item.getId() <= 0);
  const pieces = gearOf(bot);
  const extraIsAmmo = extra && isAmmo(extra.getId());
  if (extra && !extraIsAmmo && slotOf(extra.getId()) >= 0) pieces.push({ where: "extra", index: -1, id: extra.getId(), amount: extra.getAmount() });
  // What each slot was wearing, by role, before anything moves.
  const wornRole = new Map();
  equipment.getItems().forEach((item, slot) => {
    if (item && item.getId() > 0 && slot !== Equipment.AMMUNITION_SLOT) wornRole.set(slot, roleOf(bot, item.getId()).key);
  });
  // Best per role; the rest off.
  const roles = new Map();
  for (const piece of pieces) {
    const role = roleOf(bot, piece.id);
    piece.role = role;
    piece.value = hasSetFor(bot, piece.id) ? score(piece.id, role.style) : -1;
    const list = roles.get(role.key) ?? [];
    list.push(piece);
    roles.set(role.key, list);
  }
  for (const list of roles.values()) {
    const rank = { worn: 0, inv: 1, extra: 2 };
    list.sort((a, b) => b.value - a.value || rank[a.where] - rank[b.where]);
    for (const spare of list.slice(1)) {
      take(spare);
      dropped.push(new Item(spare.id, spare.amount));
      changed = true;
    }
    const best = list[0];
    if (best.where === "worn") continue;
    // On it goes if the slot was wearing this role (that piece went above) or was bare and it's their style.
    const before = wornRole.get(best.role.slot);
    const wearIt = before === best.role.key || (before == null && (best.role.style === styleOf(bot) || !isSwitchSlot(best.role.slot)));
    if (!wearIt) {
      // Tank armour (no offensive bonus: rune, Dharok's...) isn't worth carrying as a switch over
      // food - a mage or ranger never changes into it. Off it goes, unless it's a set weapon's piece.
      if (best.role.slot !== Equipment.WEAPON_SLOT && itemStyle(best.id) === "any" && !setPieceIds().has(best.id)) {
        if (best.where !== "extra") take(best);
        dropped.push(new Item(best.id, best.amount));
        changed = true;
        continue;
      }
      if (best.where === "extra") {
        // Into the pack: a free slot, or one food given up for it (it's a new switch).
        let slot = freeSlot();
        if (slot < 0 && spareFood(bot) != null && worthFood(best.id, best.role.style)) {
          slot = spareFood(bot);
          const food = inventory.getItems()[slot];
          dropped.push(new Item(food.getId(), food.getAmount()));
        }
        if (slot >= 0) inventory.setItem(slot, new Item(best.id, best.amount));
        else dropped.push(new Item(best.id, best.amount));
        changed = true;
      }
      continue;
    }
    take(best);
    if (best.role.slot === Equipment.WEAPON_SLOT && isTwoHanded(best.id)) {
      const shield = equipment.getItems()[Equipment.SHIELD_SLOT];
      if (shield && shield.getId() > 0) {
        equipment.setItem(Equipment.SHIELD_SLOT, new Item(-1, 0));
        const slot = freeSlot();
        if (slot >= 0) inventory.setItem(slot, new Item(shield.getId(), shield.getAmount()));
        else dropped.push(new Item(shield.getId(), shield.getAmount()));
      }
    }
    equipment.setItem(best.role.slot, new Item(best.id, best.amount));
    state().stats = state().stats ?? {};
    state().stats.upgrades = (state().stats.upgrades ?? 0) + 1;
    changed = true;
  }
  // Ammo: kept if a ranged weapon of theirs fires it, quivered when the quiver's free or useless.
  const weapons = rangedWeapons(bot);
  const fits = (id) => weapons.some((weapon) => ammoFits(weapon, id));
  const quiverAmmo = (id, amount) => {
    const quiver = equipment.getItems()[Equipment.AMMUNITION_SLOT];
    const quiverId = quiver?.getId?.() ?? -1;
    if (!fits(id)) return false;
    if (quiverId === id) equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(id, quiver.getAmount() + amount));
    else if (quiverId <= 0 || !fits(quiverId)) {
      if (quiverId > 0) dropped.push(new Item(quiverId, quiver.getAmount()));
      equipment.setItem(Equipment.AMMUNITION_SLOT, new Item(id, amount));
    } else return null;
    return true;
  };
  inventory.getItems().forEach((item, index) => {
    const id = item?.getId?.() ?? -1;
    if (id <= 0 || !isAmmo(id)) return;
    const placed = quiverAmmo(id, item.getAmount());
    if (placed === null) return;
    if (placed === false) dropped.push(new Item(id, item.getAmount()));
    inventory.setItem(index, new Item(-1, 0));
    changed = true;
  });
  if (extraIsAmmo) {
    const placed = quiverAmmo(extra.getId(), extra.getAmount());
    if (placed !== true) {
      const slot = placed === null ? freeSlot() : -1;
      if (slot >= 0) inventory.setItem(slot, new Item(extra.getId(), extra.getAmount()));
      else dropped.push(new Item(extra.getId(), extra.getAmount()));
    }
    changed = true;
  }
  if (!changed) return [];
  // A new spell weapon means new runes to look out for.
  const runes = new Set(bot.getAttribute(Common.ATTRIBUTES.runes) ?? []);
  for (const item of inventory.getItems()) if (item && isRune(item.getId())) runes.add(item.getId());
  bot.setAttribute(Common.ATTRIBUTES.runes, [...runes]);
  refresh(bot);
  return dropped;
}

module.exports = {
  BANNED_SPECS,
  STYLES,
  COMBAT_SKILLS,
  score,
  weaponStyle,
  styleOf,
  setLevels,
  heal,
  refresh,
  equipKit,
  empty,
  belongings,
  isRune,
  slotOf,
  isSupply,
  suppliesCarried,
  wants,
  upgradeGain,
  itemStyle,
  isTwoHanded,
  rangedWeapons,
  ammoFor,
  ammoFits,
  hasAmmoFor,
  hasSetFor,
  wearUpgrades,
};
