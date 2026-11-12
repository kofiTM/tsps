/**
 * Developer commands for Nex: Angel of Death.
 *  ::aod1 [nex]   the idle arena: her standing in the middle (or OSRS Nex), the pillars and the AoD Fans.
 *  ::aod          the fight arena: the pillars only, for her spawn, her fight and testing.
 *  ::aodspawn     (in ::aod) her spawn: she falls from the sky and the pillars power her up.
 *  ::aodend       (in ::aod) ends the fight and takes her away, ready for another ::aodspawn.
 *  ::aodphase <n> / ::phase <n>  (in ::aod, once she is fighting) skips to phase n: her hp goes to that phase's start
 *                 (phase 2: 5000) and the phase begins on the next tick.
 *  ::aodbots      (in ::aod) two test bots that follow you around and never attack (kofi); they
 *                 leave with the arena.
 *  ::aodpet [angel|reeves]  gives her pets, Lil' Angel (50331) and Reeves (50332); drop one to summon it.
 */
const Common = require("./Common.AngelOfDeath");
const Arena = require("./Arena.AngelOfDeath");
const Fight = require("./Fight.AngelOfDeath");
const Intro = require("./Intro.AngelOfDeath");
const Fans = require("./Fans.AngelOfDeath");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");

/** Lil' Angel (her model) and Reeves (a blood reaver): scripts/rs3-port/aod_pet.py, custom-items.json. */
const PET_ITEMS = { angel: 50331, reeves: 50332 };

function aod1(event) {
  const { player } = event;
  Arena.open(player, "idle");
  player.sendMessage("Angel of Death arena (idle): Nex: Angel of Death with Nex beside her, both idle. Teleport away or log out to leave.");
  return true;
}

function aod(event) {
  const { player } = event;
  Arena.open(player, "fight");
  player.sendMessage("Angel of Death arena (fight). ::aodspawn brings her in; ::aodend takes her away again.");
  return true;
}

function aodspawn(event) {
  const { player } = event;
  const area = Arena.arenaOf(player);
  if (!area || area.mode !== "fight") {
    player.sendMessage("Use ::aod first: her spawn is for the fight arena.");
    return true;
  }
  if (area.fight && !area.fight.stopped) {
    player.sendMessage("She's already here. ::aodend first.");
    return true;
  }
  Intro.start(Fight.open(area));
  return true;
}

function aodend(event) {
  const { player } = event;
  const area = Arena.arenaOf(player);
  if (!area?.fight) {
    player.sendMessage("No Angel of Death fight here.");
    return true;
  }
  area.fight.end(false);
  player.sendMessage("Fight ended. ::aodspawn for another.");
  return true;
}

function aodpet(event) {
  const { player } = event;
  const which = (event.parts ?? [])[1];
  const pets = Object.entries(PET_ITEMS).filter(([name]) => !which || name === which);
  if (pets.length === 0) {
    player.sendMessage("::aodpet, ::aodpet angel or ::aodpet reeves.");
    return true;
  }
  if (player.getInventory().getFreeSlots() < pets.length) {
    player.sendMessage(`You need ${pets.length} free inventory slot${pets.length > 1 ? "s" : ""}.`);
    return true;
  }
  for (const [, itemId] of pets) player.getInventory().add(new Item(itemId, 1), true);
  player.sendMessage("Pet" + (pets.length > 1 ? "s" : "") + " in your bag. Drop one to summon it.");
  return true;
}

function aodphase(event) {
  const { player } = event;
  const n = Number((event.parts ?? [])[1]);
  const fight = Arena.arenaOf(player)?.fight;
  const phases = Object.keys(Common.data.phases ?? {}).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  if (!Number.isInteger(n) || !phases.includes(n) || n < 2) {
    player.sendMessage(`::aodphase <n>, n is one of: ${phases.filter((p) => p >= 2).join(", ")}.`);
    return true;
  }
  if (!fight || fight.stopped || fight.stage !== "fighting") {
    player.sendMessage("She has to be fighting first: ::aod, then ::aodspawn and wait for her line.");
    return true;
  }
  if (n <= fight.phase) {
    player.sendMessage(`She's already in phase ${fight.phase}. ::aodend and ::aodspawn to start over.`);
    return true;
  }
  const hitpoints = Common.data.phases[String(n)].below;
  fight.boss.setHitpoints(Math.min(fight.boss.getHitpoints(), hitpoints));
  // the current phase's minion and every phase skipped over count as consumed (2x speed, no Lockdown)
  const current = Common.data.phases[String(fight.phase)]?.minion;
  if (current) require("./Minions.AngelOfDeath").skip(fight, current);
  for (let p = fight.phase + 1; p < n; p++) fight.enterPhase(p, { skipped: true });
  player.sendMessage(`Skipping to phase ${n}: her hitpoints are now ${fight.boss.getHitpoints()}.`);
  return true;
}

function aodbots(event) {
  const { player } = event;
  const area = Arena.arenaOf(player);
  if (!area || area.mode !== "fight") {
    player.sendMessage("Use ::aod first: the bots are for the fight arena.");
    return true;
  }
  if ((area.bots ?? []).some((bot) => bot?.isRegistered?.())) {
    player.sendMessage("The bots are already here.");
    return true;
  }
  Fans.spawnFans(area, { quiet: true, count: 2, test: true });
  player.sendMessage("Two bots are following you. They never attack; they leave with the arena.");
  return true;
}

module.exports = { aod1, aod, aodspawn, aodend, aodpet, aodphase, aodbots };
