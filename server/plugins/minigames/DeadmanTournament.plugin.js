/**
 * Server custom (kofi, 2026-11-09): the Deadman Tournament - a Deadman-style battle royale over
 * the whole Wilderness for the real players online and N bots (world config
 * `DeadmanTournament:botCount`, 300 to start), then a 1v1 bracket for the last 100 in copies of
 * the Deadman finale arena, and the server shuts down once there's a winner. Off unless world
 * config `DeadmanTournament:enabled` is true; ::dmstart opens a lobby by hand either way.
 * Docs: docs/deadman-tournament.md. Data: plugins/minigames/data/deadman-tournament.json.
 * Units in ./deadman/:
 * - State: the phases, who's in, and the hooks the units attach to;
 * - Tournament: the lobby, the start, eliminations, the attack rules, the HUD, the end and shutdown;
 * - Gear: 99 combat for everyone, starter kits, the gear score for upgrades;
 * - Fog: the closing safe zone and its damage, worse as it shrinks and deeper in;
 * - Loot: death drops for the killer, bloody/bloodier keys, loot chests, the floor index;
 * - Bosses: Deadman-style boss spawns over the Wilderness, kill and drop broadcasts;
 * - Clans: bot clans that never fight each other and decide on bosses; the player's own clan;
 * - Bots: spawning, and what they go after between fights (fog, loot, chests, bosses, fighters);
 * - Spectate: the eliminated watch the rest;
 * - Bracket: the 1v1s in the Deadman arena;
 * - Commands: ::dmstart, ::dmstop, ::dmskip, ::dmkill, ::dmbots, ::dmboss, ::dmstatus.
 * Needs Last Man Standing (its Stash, chest loc and overlay) and PlayerBots loaded.
 */
const Common = require("./deadman/Common.DeadmanTournament");
const Tournament = require("./deadman/Tournament.DeadmanTournament");
const Fog = require("./deadman/Fog.DeadmanTournament");
const Loot = require("./deadman/Loot.DeadmanTournament");
const Bosses = require("./deadman/Bosses.DeadmanTournament");
const Clans = require("./deadman/Clans.DeadmanTournament");
const Bots = require("./deadman/Bots.DeadmanTournament");
const Spectate = require("./deadman/Spectate.DeadmanTournament");
const Bracket = require("./deadman/Bracket.DeadmanTournament");
const Commands = require("./deadman/Commands.DeadmanTournament");

module.exports = {
  name: "DeadmanTournament",
  register(api) {
    Common.init(api);
    Tournament.attachTournament(api);
    Fog.attachFog(api);
    Loot.attachLoot(api);
    Bosses.attachBosses(api);
    Clans.attachClans(api, Bosses.liveBosses);
    Bots.attachBots(api);
    Spectate.attachSpectate(api);
    Bracket.attachBracket(api);
    Commands.attachCommands(api);
  },
};
