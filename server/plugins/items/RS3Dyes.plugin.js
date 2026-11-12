/**
 * RS3 weapon dyes for the ported RS3 weapons (scripts/rs3-port).
 *
 * Using a dye (Barrows, shadow, blood, ice, Third Age, Aurora, Soul) on a plain ported weapon
 * consumes the dye and turns the weapon into its dyed version, as in RS3. Already-dyed weapons
 * cannot be dyed again. Pairs come from plugins/items/data/rs3-dyes.json, written by
 * scripts/rs3-port/port_items.py.
 *
 * ::rs3 (developer) spawns one of each plain ported weapon and one of each dye (inventory, then bank).
 * ::necro (developer) spawns the Omni guard, Soulbound lantern and their dyed versions.
 * ::rs3bank (developer) puts every RS3 item, dyed versions included, in the bank.
 */
const fs = require("fs");
const path = require("path");

let data = { dyes: [], pairs: [], spawn: [] };
const byDyeAndBase = new Map();
const dyeNames = new Map();

function load() {
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "rs3-dyes.json"), "utf8"));
  byDyeAndBase.clear();
  dyeNames.clear();
  for (const dye of data.dyes ?? []) dyeNames.set(Number(dye.dye), dye.name);
  for (const pair of data.pairs ?? []) byDyeAndBase.set(`${pair.dye}|${pair.base}`, Number(pair.result));
}

function applyDye(event) {
  const used = Number(event.usedItemId);
  const usedWith = Number(event.usedWithItemId);
  let dyeId, weapon;
  if (dyeNames.has(used)) {
    dyeId = used; weapon = event.usedWithItem;
  } else if (dyeNames.has(usedWith)) {
    dyeId = usedWith; weapon = event.usedItem;
  } else {
    return;
  }
  const { player } = event;
  event.handled = true;
  const result = weapon ? byDyeAndBase.get(`${dyeId}|${Number(weapon.getId?.())}`) : undefined;
  if (result === undefined) {
    player.sendMessage("You can only use this dye on an undyed RS3 weapon.");
    return;
  }
  player.getInventory().deleteNumber(dyeId, 1);
  weapon.setId(result);
  player.getInventory().refreshItems();
  player.sendMessage(`You dye the weapon with the ${dyeNames.get(dyeId).toLowerCase()}.`);
}

let core = null;

function toBank(player, id) {
  const { Bank, Item } = core;
  player.getBank(Bank.getTabForItem(player, id)).add(new Item(id, 1), false);
}

/** ::rs3 - every plain ported weapon and one of each dye: free inventory slots first, the rest to the bank. */
function spawnAll(event) {
  const { player } = event;
  const ids = data.spawn ?? [];
  const inventory = player.getInventory();
  let held = 0, banked = 0;
  for (const id of ids) {
    if (inventory.getFreeSlots() > 0) { inventory.adds(id, 1); held++; }
    else { toBank(player, id); banked++; }
  }
  player.sendMessage(`Spawned ${ids.length} RS3 items: ${held} in your inventory` + (banked ? `, ${banked} in your bank.` : "."));
  return true;
}

/** ::necro - the Omni guard and Soulbound lantern with all their dyed versions: inventory first, then the bank. */
function spawnNecro(event) {
  const { player } = event;
  const ids = data.necro ?? [];
  const inventory = player.getInventory();
  let held = 0, banked = 0;
  for (const id of ids) {
    if (inventory.getFreeSlots() > 0) { inventory.adds(id, 1); held++; }
    else { toBank(player, id); banked++; }
  }
  player.sendMessage(`Spawned ${ids.length} necromancy items: ${held} in your inventory` + (banked ? `, ${banked} in your bank.` : "."));
  return true;
}

/** ::rs3bank - every RS3 item (plain weapons, dyes and every dyed weapon) into the bank. */
function bankAll(event) {
  const { player } = event;
  const ids = [...new Set([...(data.spawn ?? []), ...(data.pairs ?? []).map((pair) => Number(pair.result))])];
  for (const id of ids) toBank(player, id);
  player.sendMessage(`Put ${ids.length} RS3 items in your bank (weapons, dyes and dyed weapons).`);
  return true;
}

module.exports = {
  name: "RS3Dyes",
  _test: { load, applyDye, spawnAll },
  register(api) {
    load();
    api.onItemOnItem(applyDye, { noted: false });
    core = api.core;
    api.registerCommand("rs3", spawnAll, api.core.PlayerRights.DEVELOPER,
      "Spawn every ported RS3 weapon and one of each RS3 dye (inventory first, then bank)");
    api.registerCommand("necro", spawnNecro, api.core.PlayerRights.DEVELOPER,
      "Spawn the Omni guard and Soulbound lantern with all their dyed versions");
    api.registerCommand("rs3bank", bankAll, api.core.PlayerRights.DEVELOPER,
      "Put every RS3 item, dyed versions included, in your bank");
    api.log("registered", { dyes: dyeNames.size, pairs: byDyeAndBase.size });
  },
};
