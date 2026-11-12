/**
 * Server custom: what every boss's bot code does the same way (docs/boss-bots.md) - picking a bot
 * from the roster that isn't already somewhere else, and saying a line as a player says it. Each boss
 * calls `init(api)` once, from its own attach.
 *
 * One roster, one bot in one place: a name already logged in (at Nex, say) is never picked for
 * another boss's team, so the same bot can't be in two fights at once.
 */
const Roster = require("./Roster.BossBots");
const Crowd = require("./Crowd.BossBots");

let api = null;

function init(pluginApi) {
  api = pluginApi;
}

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

/**
 * A roster name nobody is using now (online or logging in), or "<helper> N" once all of them are out.
 * `preferred` (a boss's own bot, King of TOB) first, when nobody is using it - in another party's
 * instance, say - so one bot is never in two places.
 */
function freeName(helper = "Boss Helper", preferred = null) {
  const { World } = api.core;
  const taken = (name) => World.getPlayerByName(name) || World.getAddPlayerQueue().some((queued) => queued?.getUsername?.() === name);
  if (preferred && !taken(preferred)) return preferred;
  for (const name of [...Roster.NAMES].sort(() => Math.random() - 0.5)) if (!taken(name)) return name;
  for (;;) {
    const name = `${helper}${randomInt(1, 9999)}`;
    if (!taken(name)) return name;
  }
}

/** How many others share the speaker's instance (bots and players), not counting invisible watchers. */
function othersHere(player) {
  const area = player.getPrivateArea?.();
  if (!area) return null;
  let count = 0;
  for (const other of api.core.World.getPlayers()) {
    if (!other || other === player || other.getPrivateArea?.() !== area) continue;
    const query = { player: other, invisible: false };
    api.emitCustomEvent("admin:is-invisible", query);
    if (query.invisible !== true) count++;
  }
  return count;
}

/**
 * Said as a player says it: over its head and in the public chat of the real players who can see it,
 * worded for who's there (Crowd.BossBots: "you all" one-to-one with one other, "you two" with two).
 * The line as said, for the boss's own log.
 */
function speak(player, text) {
  text = Crowd.fit(text, othersHere(player));
  // Its chat icons (an ironman bot's helmet) before its name, as a player's chat shows them.
  const icons = (player.getChatIcons?.() ?? []).map((icon) => `<img=${icon}>`).join("");
  player.forceChat(`${icons}${text}`);
  const at = player.getLocation();
  for (const viewer of api.core.World.getPlayers()) {
    if (!viewer || viewer.isPlayerBot?.() || viewer.getPrivateArea?.() !== player.getPrivateArea?.()) continue;
    if (!viewer.getLocation().isViewableFrom?.(at)) continue;
    viewer.getPacketSender().sendPublicChat(text, `${icons}${player.getUsername()}`, player.getIndex());
  }
  return text;
}

/**
 * Every boss bot spawns with its charged gear full (kofi: the rule for every boss team, Nex, the
 * Theatre of Blood and all after). Each item keeps its charges as its own plugin does
 * (plugins/items/*.plugin.js); an item made without them goes uncharged on first use - the ToB tank's
 * scythe did, and its swings were single hits. A new charged item a bot carries goes in here.
 */
const FULL_CHARGES = {
  SCYTHE_OF_VITUR: ["scythe-of-vitur-charges", 20000],
  HOLY_SCYTHE_OF_VITUR: ["scythe-of-vitur-charges", 20000],
  SANGUINE_SCYTHE_OF_VITUR: ["scythe-of-vitur-charges", 20000],
  TUMEKENS_SHADOW: ["tumekens-shadow-charges", 20000],
  SANGUINESTI_STAFF: ["sanguinesti-staff-charges", 20000],
  HOLY_SANGUINESTI_STAFF: ["sanguinesti-staff-charges", 20000],
  TRIDENT_OF_THE_SEAS: ["trident-charges", 2500],
  TRIDENT_OF_THE_SWAMP: ["trident-charges", 2500],
  TOXIC_STAFF_OF_THE_DEAD: ["toxic-staff-charges", 11000],
  SERPENTINE_HELM: ["serpentine-helm", 11000],
  TANZANITE_HELM: ["serpentine-helm", 11000],
  MAGMA_HELM: ["serpentine-helm", 11000],
  OBLIGATOR: ["obligator-charges", 20000],
  AMULET_OF_BLOOD_FURY: ["blood-fury", { charges: 30000 }],
  // Full of scales and dragon darts.
  TOXIC_BLOWPIPE: ["toxic-blowpipe", (ids) => ({ scales: 16383, dartId: ids.DRAGON_DART, dartAmount: 16383 })],
};

/** Fills a newly made bot item (worn or carried) to its full charges, if it has any; returns it. */
function charge(name, item) {
  const full = FULL_CHARGES[name];
  if (!full || !item?.setMetaValue) return item;
  const [key, value] = full;
  item.setMetaValue(key, typeof value === "function" ? value(api.core.ItemIdentifiers) : structuredClone(value));
  return item;
}

module.exports = { init, freeName, othersHere, speak, charge, FULL_CHARGES };
