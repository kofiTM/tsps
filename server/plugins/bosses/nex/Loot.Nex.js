/**
 * Nex's loot, rolled on her table in data/definitions/npc-drops.json (the Wiki's) and shared out by
 * damage as the Wiki describes ("Nex", drop mechanics), on the ground under her as captured:
 * - Everyone present with a minimum share of the damage to Nex, her mages and the reavers is owed
 *   loot (the Wiki gives no figure: `loot.minShare` is ours). Those who died or left get nothing.
 * - "Two common drops are guaranteed after each kill": two rolls of her main table make the kill's
 *   lump, and each player gets their share of its quantities.
 * - Uniques: "1/43 ... divided by contribution", so every player rolls the unique entries with their
 *   chance scaled by their share; the separate rolls and tertiaries likewise.
 * - The MVP (most damage) gets +10% quantities, +10% unique chance and the big bones (her table's
 *   always-drop), and is told "You were the MVP for this fight!" (captured).
 */
const Common = require("./Common.Nex");
const DropNews = require("../../npcs/DropNews.NpcDrops");

const isUnique = (entry) => entry.section === "Uniques";
const isTertiary = (entry) => entry.section === "Tertiary";

/** Each present player's share of the damage, the MVP among them. */
function shares(contribution, present) {
  const { minShare } = Common.data.loot;
  let total = 0;
  for (const amount of contribution.values()) total += amount;
  const owed = [];
  let mvp = null;
  for (const player of present) {
    const amount = contribution.get(player) ?? 0;
    const share = total > 0 ? amount / total : 0;
    if (share < minShare) continue;
    owed.push({ player, share });
    if (!mvp || amount > (contribution.get(mvp) ?? 0)) mvp = player;
  }
  return { owed, mvp };
}

function roll(player, entryFilter) {
  const request = { player, npcId: Common.data.npcs.nex, drops: [], entryFilter };
  Common.api.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops;
}

/** The kill's lump: her main table rolled `loot.commonRolls` times. */
function rollCommons(player) {
  const drops = [];
  for (let i = 0; i < Common.data.loot.commonRolls; i++) {
    drops.push(...roll(player, (entry) => !entry.always && !entry.separate_roll && !isTertiary(entry)));
  }
  return drops;
}

/**
 * Everything one kill gives, per player: [{ player, share, mvp, drops }]. `random` decides each
 * share-scaled entry (an entry kept with chance `scale` is then rolled at its own rarity).
 */
function rollLoot(contribution, present, random = Math.random) {
  const { owed, mvp } = shares(contribution, present);
  if (owed.length === 0) return [];
  const { mvpBonus } = Common.data.loot;
  const lump = rollCommons(mvp);
  return owed.map(({ player, share }) => {
    const bonus = player === mvp ? mvpBonus : 1;
    const drops = [];
    if (player === mvp) drops.push(...roll(player, (entry) => entry.always === true));
    for (const drop of lump) {
      const amount = Math.floor(drop.amount * share * bonus);
      if (amount >= 1) drops.push({ ...drop, amount });
    }
    drops.push(...roll(player, (entry) => {
      if (!entry.separate_roll && !isTertiary(entry)) return false;
      const scale = isUnique(entry) ? share * bonus : share;
      return random() < scale;
    }));
    return { player, share, mvp: player === mvp, drops };
  });
}

const DROP_COLOUR = "005f00";
/** Nex's rares by name (as the bots tell them): their drop lines are broadcast after everyone else's. */
const RARE_DROP = /torva|zaryte|nihil horn|ancient hilt|nexling/i;

function describe(drop) {
  const name = Common.core.ItemDefinition.forId(drop.itemId)?.getName?.() ?? "an item";
  return drop.amount > 1 ? `${drop.amount.toLocaleString("en-US")} x ${name}` : name;
}

/** The kill's loot under her, for each player who is owed some; everyone there hears who got what. */
function reward(fight, players, where) {
  const { Item, ItemDefinition } = Common.core;
  const manager = Common.api.getItemOnGroundManager();
  const area = fight.arena.area;
  const damagers = players.filter((player) => (fight.contribution.get(player) ?? 0) > 0);
  // Every "received a drop" line, said once all are rolled: a rare's last, and a bot's rare the very last (kofi).
  const broadcasts = [];
  for (const entry of rollLoot(fight.contribution, players)) {
    const { player } = entry;
    // The kill is counted by the fight's own count(); this roll only logs the loot.
    const request = { player, npc: fight.boss, npcId: Common.data.npcs.nex, drops: entry.drops, damagers, countKill: false };
    Common.api.emitCustomEvent("npc-drops:roll", request);
    // Heard by Bots.Nex: a bot walks over and takes its share itself (`taken`), none left on the floor.
    const share = { player, fight, drops: request.drops, where, taken: false };
    Common.api.emitCustomEvent("nex:loot", share);
    for (const drop of share.taken ? [] : request.drops) {
      if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
      const noteId = ItemDefinition.forId(drop.itemId).getNoteId();
      const itemId = drop.noted && noteId >= 0 && ItemDefinition.forId(noteId).isNoted() ? noteId : drop.itemId;
      if (ItemDefinition.forId(itemId).isStackable()) {
        manager.registerLocation(player, new Item(itemId, drop.amount), where, area);
      } else {
        for (let i = 0; i < drop.amount; i++) manager.registerLocation(player, new Item(itemId, 1), where, area);
      }
    }
    // As the group bosses broadcast (Hueycoatl, the Wilderness lairs): "<name> received a drop: ...".
    for (const drop of request.drops) {
      if (!Number.isInteger(drop.itemId) || drop.amount <= 0) continue;
      const rare = RARE_DROP.test(ItemDefinition.forId(drop.itemId)?.getName?.() ?? "");
      broadcasts.push({ order: rare ? (player.isPlayerBot?.() ? 2 : 1) : 0, text: `<col=${DROP_COLOUR}>${player.getUsername()} received a drop: ${describe(drop)}</col>`,
        news: rare ? { player, item: ItemDefinition.forId(drop.itemId)?.getName?.(), amount: drop.amount } : null });
    }
    if (entry.mvp) player.sendMessage(Common.data.kill.mvp);
  }
  const owner = DropNews.humanOf(players);
  for (const { text, news } of broadcasts.sort((a, b) => a.order - b.order)) {
    for (const other of players) other.sendMessage(text);
    // A rare is news to everyone online too (kofi: as RuneScape 3), a bot's naming whose team it was with.
    if (news) DropNews.announce(Common.core, { ...news, source: "Nex", owner, group: "team" });
  }
}

/** Nex already selects the present, eligible recipient before sending their personal roll. */
function ironmanKeeps(request) {
  const fight = request.npc?.__nexFight;
  if (request.npcId !== Common.data.npcs.nex || !fight || fight.stopped ||
      fight.boss !== request.npc || fight.stage !== "ended") return;
  if (!shares(fight.contribution, fight.players()).owed.some(({ player }) => player === request.player)) return;
  request.keep.push(...request.drops.map((drop) => drop.itemId));
}

function attach(api) {
  api.onCustomEvent("ironman:shared-kill-keeps", ironmanKeeps);
}

module.exports = { attach, reward, rollLoot, shares };
