/**
 * ::comp - completes every quest, achievement diary and combat achievement at once, claims every
 * reward tier, and banks all the reward items (inventory, then the floor, if the bank is full).
 * Each content plugin does its own completing through its "complete-all" event and hands back the
 * items; this plugin only places them.
 */

let core;
let pluginApi;

/** Into the bank tab already holding it, else any free bank slot, else the inventory, else the floor. */
function bankItem(player, id, amount) {
  const { Bank, Item, ItemDefinition, ItemOnGroundManager } = core;
  const bankId = ItemDefinition.forId(id).unNote();
  const tab = Bank.getTabForItem(player, bankId);
  if (player.getBank(tab).contains(bankId) || Bank.freeSlots(player) > 0) {
    player.getBank(tab).add(new Item(bankId, amount), false);
    return "bank";
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() > 0 || (inventory.contains(id) && ItemDefinition.forId(id).isStackable())) {
    inventory.add(new Item(id, amount), false);
    return "inventory";
  }
  ItemOnGroundManager.registers(player, new Item(id, amount));
  return "floor";
}

function completeAll({ player }) {
  const quests = { player };
  const diaries = { player };
  const combat = { player };
  pluginApi.emitCustomEvent("quest:complete-all", quests);
  pluginApi.emitCustomEvent("diary:complete-all", diaries);
  pluginApi.emitCustomEvent("combat-achievements:complete-all", combat);

  const items = [
    ...(quests.items ?? []),
    ...(diaries.items ?? []).map((id) => ({ id, amount: 1 })),
    ...(combat.items ?? []).map((id) => ({ id, amount: 1 })),
  ].filter(({ id, amount }) => Number.isInteger(id) && id >= 0 && amount > 0);
  const placed = { bank: 0, inventory: 0, floor: 0 };
  for (const { id, amount } of items) placed[bankItem(player, id, amount)]++;
  player.getInventory().refreshItems();

  pluginApi.emitCustomEvent("persistence:save", { player, reason: "complete-all" });
  player.sendMessage(`Completed ${quests.quests ?? 0} quests, ${diaries.tasks ?? 0} diary tasks and ${combat.tasks ?? 0} combat achievements.`);
  player.sendMessage(`Rewards: ${placed.bank} put in your bank` +
    (placed.inventory ? `, ${placed.inventory} in your inventory (bank full)` : "") +
    (placed.floor ? `, ${placed.floor} on the floor (bank and inventory full)` : "") + ".");
  return true;
}

module.exports = {
  name: "CompleteAll",
  register(api) {
    core = api.core;
    pluginApi = api;
    api.registerCommand("comp", completeAll, api.core.PlayerRights.ADMINISTRATOR, "Complete every quest, diary and combat achievement; rewards go to your bank");
  },
};
