/**
 * Nex: Angel of Death - her arena (a port of RS3's, scripts/rs3-port/aod*.py) and her fight.
 * The units are in plugins/bosses/aod/ (docs/aod-fight.md): Common, Arena (the instance, pillars),
 * Fans (::aod1's pre-fight bots), Fight (the fight's tick, cues, HUD), Intro (her spawn), Commands,
 * Definitions (combat rows for the appended npcs). Her npc definition: NexAod.plugin.js.
 */
const Common = require("./aod/Common.AngelOfDeath");
const Arena = require("./aod/Arena.AngelOfDeath");
const Fight = require("./aod/Fight.AngelOfDeath");
const Specials = require("./aod/Specials.AngelOfDeath");
const Commands = require("./aod/Commands.AngelOfDeath");
const Kit = require("./bossbots/Kit.BossBots");

module.exports = {
  name: "AngelOfDeath",
  register(api) {
    Common.init(api);
    Kit.init(api);
    Fight.attachFight(api);
    Specials.attach(api);   // breaking out of her Ice Prison
    require("./aod/Fans.AngelOfDeath").attach(api);   // ::aodbots test bots heal when hit
    api.onServerStartup(Arena.startup);
    api.registerCommand("aod1", Commands.aod1, api.core.PlayerRights.DEVELOPER, "Nex: Angel of Death arena, idle, with Nex beside her");
    api.registerCommand("aod", Commands.aod, api.core.PlayerRights.DEVELOPER, "Nex: Angel of Death fight arena (::aodspawn, ::aodend)");
    api.registerCommand("aodspawn", Commands.aodspawn, api.core.PlayerRights.DEVELOPER, "In ::aod: Nex: Angel of Death's spawn");
    api.registerCommand("aodend", Commands.aodend, api.core.PlayerRights.DEVELOPER, "In ::aod: end her fight");
    api.registerCommand("aodphase", Commands.aodphase, api.core.PlayerRights.DEVELOPER, "In ::aod: skip to phase <n> (her hp to its start)");
    api.registerCommand("phase", Commands.aodphase, api.core.PlayerRights.DEVELOPER, "In ::aod: skip to phase <n> (same as ::aodphase)");
    api.registerCommand("aodbots", Commands.aodbots, api.core.PlayerRights.DEVELOPER, "In ::aod: two test bots that follow you and never attack");
    api.registerCommand("aodpet", Commands.aodpet, api.core.PlayerRights.DEVELOPER, "Gives the Angel of Death pets (::aodpet angel / reeves)");
  },
};
