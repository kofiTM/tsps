"use strict";

/**
 * World news for a rare drop (kofi: as RuneScape 3 broadcasts them), seen by everyone online:
 * "News: <name> received a drop: <item> from <source>!". A bot's names whose team it was with (kofi):
 * "... (in kofi's raid)". Used by the boss drops (NpcDrops), Nex and the Theatre of Blood's chests.
 */

const COLOUR = "ef1020";

/** `item` the item's name, `amount` its count, `source` where from, `owner` the human a bot was with, `group` "raid"/"team". */
function announce(core, { player, item, amount = 1, source, owner = null, group = "team" }) {
  if (!player || !item) return;
  const name = player.getUsername();
  const what = amount > 1 ? `${amount} x ${item}` : item;
  const from = source ? ` from ${source}` : "";
  const bot = player.isPlayerBot?.() === true;
  const whose = bot && owner && owner !== player ? ` (in ${owner.getUsername()}'s ${group})` : "";
  core.World.sendMessage(`<col=${COLOUR}>News: ${name} received a drop: ${what}${from}!${whose}</col>`);
}

/** The human a bot was with among `players` (the first real player), or null. */
function humanOf(players) {
  return [...(players ?? [])].find((each) => each && each.isPlayerBot?.() !== true) ?? null;
}

module.exports = { announce, humanOf };
