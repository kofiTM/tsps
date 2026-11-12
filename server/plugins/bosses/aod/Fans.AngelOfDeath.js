/**
 * The AoD Fans (::aod1): four roster bots stroll the idle arena with the player and talk about the
 * Angel of Death's release. Moved unchanged from AngelOfDeath.plugin.js. The fight's own bots are the
 * boss-bots chat's (Bots.AngelOfDeath.js, docs/aod-cues.md).
 */
const Common = require("./Common.AngelOfDeath");
const Kit = require("../bossbots/Kit.BossBots");
const { createBotPlayer } = require("../../bots/behaviours/spawn/PlayerFactory.PlayerBots");
const { ATTR_SKIP_PERSISTENCE } = require("../../bots/runtime/PersistenceConstants.PlayerBots");
const BOT_COUNT = 4;
const BOT_ATTRIBUTE = "aod:prefight-bot";
/** ::aodbots test bots only (not the ::aod1 Fans): they heal back to full when hit (kofi). */
const TEST_BOT_ATTRIBUTE = "aod:test-bot";
const TORVA = { HEAD_SLOT: 26382, BODY_SLOT: 26384, LEG_SLOT: 26386 };
const VIRTUS = { HEAD_SLOT: 26241, BODY_SLOT: 26243, LEG_SLOT: 26245 };
const ANCESTRAL = { HEAD_SLOT: 21018, BODY_SLOT: 21021, LEG_SLOT: 21024 };
const MAGE_EXTRAS = { HANDS_SLOT: 19544, FEET_SLOT: 13235 };          // Tormented bracelet, Eternal boots
const MELEE_EXTRAS = { HANDS_SLOT: 22981, FEET_SLOT: 13239 };         // Ferocious gloves, Primordial boots
const LOADOUTS = [                         // RS3 weapons (scripts/rs3-port) with OSRS armour
  { ...VIRTUS, ...MAGE_EXTRAS, CAPE_SLOT: 21795, WEAPON_SLOT: 50015, SHIELD_SLOT: 50016 },  // praesul + Imperium core, Imbued Zamorak cape
  { ...TORVA, ...MELEE_EXTRAS, CAPE_SLOT: 21295, WEAPON_SLOT: 50007 },                     // Ek-ZekKil, Infernal cape
  { ...ANCESTRAL, ...MAGE_EXTRAS, CAPE_SLOT: 21793, WEAPON_SLOT: 50005 },                  // FSoA, Imbued Guthix cape
  { ...TORVA, ...MELEE_EXTRAS, CAPE_SLOT: 21285, WEAPON_SLOT: 50323, SHIELD_SLOT: 50324 }, // necromancy, Infernal max cape
];
const FOLLOW = { near: 4, far: 6 };       // bots stroll within 4 tiles of the player, and catch up past 6
const WANDER = { lo: 16, hi: 48 };        // arena interior, region-local tiles
const LINES = [
  "Can't wait for the Angel of Death to come out!",
  "So hyped for the Angel of Death",
  "Release day can't come soon enough",
  "Counting down the days till she's out",
  "Gonna be first in line when she's released",
  "Heard she's Nex but twice the size... scary",
  "She's just standing there. Menacingly.",
  "Look at this arena, it's gonna be insane in here",
  "This floor is beautiful, kofi went all out",
  "Blood, Ice, Smoke, Shadow... we'll have to take every pillar down",
  "Those pillars are gonna matter in the fight, watch",
  "Wonder what her special attacks will be",
  "Imagine the drops off the Angel of Death",
  "Bet she one-shots me on release day lol",
  "Saving all my supplies for AoD release",
  "Already practising my prayer flicks for her",
  "Scouting the arena early, gotta be ready",
  "Happy we bots get to fight her with kofi when she's released :)",
  "kofi and us bots vs the Angel of Death, let's go!",
  "Teaming with kofi is gonna be the best part",
  "kofi's gonna carry us through AoD",
  "Can't wait to fight next to kofi in here",
  "When she's out I'm teaming with kofi for sure",
  "Hope kofi releases her soon, I'm ready",
];

function spawnBots(area, { quiet = false, count = BOT_COUNT, test = false } = {}) {
  area.bots = [];
  area.botsQuiet = quiet;
  for (let i = 0; i < count; i++) {
    const tile = randomTile(area);
    const bot = createBotPlayer(Kit.freeName("AoD Fan"), tile, { api: Common.api, loadPersistence: false, saveRandomizedAppearance: false, gender: 0 });
    if (!bot) continue;
    bot.setPlayerBot(true);
    bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
    bot.setAttribute(BOT_ATTRIBUTE, true);
    if (test) bot.setAttribute(TEST_BOT_ATTRIBUTE, true);
    gear(bot, LOADOUTS[i % LOADOUTS.length]);
    maxStats(bot);
    bot.setRunning(false);
    Common.api.emitPlayerLogin({ player: bot, username: bot.getUsername() });
    area.enter(bot);
    bot.moveTo(tile);
    area.bots.push(bot);
  }
  // Re-enter once they have their world index: the area keys players by it, and before it they share a slot.
  Common.later(2, () => {
    for (const bot of area.bots ?? []) if (bot?.isRegistered?.() && bot.getArea?.() === area) area.enter(bot);
  });
  prefightLoop(area);
}

/** 99 in every skill (as Bots.Nex's maxStats): they used to spawn with 10 hitpoints (kofi). */
function maxStats(bot) {
  try {
    const skills = bot.getSkillManager();
    for (const skill of Common.core.Skill.values()) {
      skills.setMaxLevels(skill, 99, false);
      skills.setExperiences(skill, 13034431, false);
      skills.setCurrentLevel(skill, 99, false);
    }
  } catch (e) { console.warn("[aod] bot stats:", e?.message ?? e); }
}

function gear(bot, loadout) {
  try {
    const equipment = bot.getEquipment();
    equipment.resetItems();
    for (const [slot, id] of Object.entries(loadout)) {
      equipment.getItems()[Common.core.Equipment[slot]] = new Common.core.Item(id, 1);
    }
    equipment.refreshItems();
    Common.core.WeaponInterfaceManager.assign(bot);
    Common.core.BonusManager.update(bot);
    bot.getUpdateFlag().flag(Common.core.Flag.APPEARANCE);
  } catch (e) { console.warn("[aod] bot gear:", e?.message ?? e); }
}

/** A walkable-looking tile in the arena: near `around` (an instance tile) when given, else anywhere. */
function randomTile(area, around = null) {
  const origin = area.at(Common.world([0, 0]));
  for (let i = 0; i < 20; i++) {
    let x, y;
    if (around) {
      x = around.getX() - origin.getX() + Math.round((Math.random() * 2 - 1) * FOLLOW.near);
      y = around.getY() - origin.getY() + Math.round((Math.random() * 2 - 1) * FOLLOW.near);
      x = Math.max(WANDER.lo, Math.min(WANDER.hi - 1, x)); y = Math.max(WANDER.lo, Math.min(WANDER.hi - 1, y));
    } else {
      x = WANDER.lo + Math.floor(Math.random() * (WANDER.hi - WANDER.lo));
      y = WANDER.lo + Math.floor(Math.random() * (WANDER.hi - WANDER.lo));
    }
    const tile = area.at([...Common.world([x, y])]);
    if (Math.hypot(x - 32.5, y - 32.5) > 5) return tile;        // not on top of her
  }
  return area.at(Common.world(Common.PLAYER_START));
}

/** Every 2 ticks: idle bots sometimes stroll somewhere new; every ~8 ticks one of them says a line. */
function prefightLoop(area) {
  let tick = 0, recent = [];
  const step = () => {
    if (area.isDestroyed?.() || !(area.bots ?? []).length) return;
    tick += 2;
    const owner = area.owner?.isRegistered?.() && area.owner.getPrivateArea?.() === area ? area.owner : null;
    for (const bot of area.bots) {
      if (!bot.isRegistered?.()) continue;
      if (bot.getAttribute?.(TEST_BOT_ATTRIBUTE) === true) healFull(bot);   // typeless damage skips the hit hook
      const here = bot.getLocation();
      const far = owner && Math.max(Math.abs(here.getX() - owner.getLocation().getX()), Math.abs(here.getY() - owner.getLocation().getY())) > FOLLOW.far;
      if (far || (!bot.getMovementQueue().isMovings() && Math.random() < 0.3)) {
        if (far) bot.setRunning(true); else bot.setRunning(false);
        const to = randomTile(area, owner ? owner.getLocation() : null);
        try { Common.core.PathFinder.calculateWalkRoute(bot, to.getX(), to.getY()); } catch (_e) { /* next time */ }
      }
    }
    if (!area.botsQuiet && tick % 8 === 0 && Math.random() < 0.8) {
      const live = area.bots.filter((b) => b.isRegistered?.());
      const bot = live[Math.floor(Math.random() * live.length)];
      const choices = LINES.filter((l) => !recent.includes(l));
      const line = choices[Math.floor(Math.random() * choices.length)];
      recent = [line, ...recent].slice(0, 10);
      if (bot) { try { Kit.speak(bot, line); } catch (_e) { bot.forceChat?.(line); } }
    }
    Common.later(2, step);
  };
  Common.later(4, step);
}

function logoutBot(bot) {
  if (!bot?.isRegistered?.()) return;
  bot.setAttribute(ATTR_SKIP_PERSISTENCE, true);
  bot.getForcedLogoutTimer().start(0);
  bot.requestLogout();
}

function healFull(bot) {
  if (!bot?.isRegistered?.()) return;
  const max = bot.getSkillManager().getMaxLevel(Common.core.Skill.HITPOINTS);
  if (bot.getHitpoints() > 0 && bot.getHitpoints() < max) bot.setHitpoints(max);
}

/** A hit on a test bot never kills it, and it is back to full a tick later (kofi). */
function testBotHit({ hit }) {
  const target = hit?.getTarget?.();
  if (!target?.isPlayer?.() || target.getAttribute?.(TEST_BOT_ATTRIBUTE) !== true) return;
  const room = Math.max(0, target.getHitpoints() - 1);
  if (hit.getTotalDamage() > room) {
    let left = room;
    for (const part of hit.getHits()) { const d = Math.min(part.getDamage(), left); part.setDamage(d); left -= d; }
    hit.updateTotalDamage();
  }
  Common.later(1, () => healFull(target));
}

function attach(api) {
  api.onPlayerHitModify(testBotHit);
}

/** Four fans into `area` (the idle arena), strolling and chatting until it closes. */
const spawnFans = spawnBots;

module.exports = { spawnFans, logoutBot, attach, BOT_ATTRIBUTE, TEST_BOT_ATTRIBUTE };
