/**
 * Deadman Tournament staff commands (owner):
 *   ::dmstart [bots] [time]  open the lobby now (that many bots, a countdown like 2m / 90s / 1m30s);
 *                    in the lobby, ::dmstart skips the countdown and ::dmstart <time> sets it
 *   ::dmstop          call it off: everyone's things back, bots and bosses gone (no shutdown)
 *   ::dmskip          straight to the 1v1 bracket: bots out until `bracket.at` are left
 *   ::dmkill <n>      n random bots out, as if they'd died (real players are spared)
 *   ::dmbots <n>      bots for the next lobby (or more now, in the lobby)
 *   ::dmboss [name]   a boss now (a random one, or the one whose name contains [name])
 *   ::dmstatus        phase, alive, bots, the fog, tick timing
 * Everyone: ::watch (Spectate), ::dmclan and ::dmrecruit (Clans).
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");
const Tournament = require("./Tournament.DeadmanTournament");
const Bosses = require("./Bosses.DeadmanTournament");
const { PlayerRights } = require("../../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

const { state } = State;
let nextBotCount = null;

function number(parts, index) {
  const value = Number(parts[index]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/** A countdown like "90s", "2m", "1m30s" (or "2:30") as ticks, else null. */
function duration(text) {
  const t = String(text ?? "").toLowerCase();
  let seconds = null;
  const clock = /^(\d+):(\d{1,2})$/.exec(t);
  const units = /^(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (clock) seconds = Number(clock[1]) * 60 + Number(clock[2]);
  else if (units && (units[1] || units[2])) seconds = Number(units[1] ?? 0) * 60 + Number(units[2] ?? 0);
  return seconds == null ? null : Math.max(1, Math.round(seconds / 0.6));
}

function start({ player, parts }) {
  // Any order: a plain number is the bots, one with m/s (or m:ss) is the countdown.
  let botCount = null;
  let ticks = null;
  for (const part of parts.slice(1)) {
    const asTime = duration(part);
    if (asTime != null) ticks = asTime;
    else if (botCount == null && /^\d+$/.test(part)) botCount = Number(part);
  }
  if (state.phase === "idle") {
    const bots = botCount ?? nextBotCount ?? Number(Common.config(Common.CONFIG.botCount, 300));
    Tournament.openLobby(bots, ticks);
    player.sendMessage(`Deadman Tournament lobby open with ${bots} bots, starting in ${Common.timeText(state.countdown)}. ::dmstart again to skip the countdown (or ::dmstart 2m for a new one).`);
  } else if (state.phase === "lobby") {
    if (ticks != null) {
      state.countdown = ticks;
      Common.broadcast(`<col=ef1020>The Deadman Tournament now begins in ${Common.timeText(ticks)}!</col>`);
      player.sendMessage(`Countdown set to ${Common.timeText(ticks)}.`);
    } else {
      state.countdown = 0;
      player.sendMessage(`Countdown skipped: the battle starts once the bots are in (${state.botsSpawned}/${state.botTarget}).`);
    }
  } else {
    player.sendMessage(`The tournament is already in its ${state.phase}.`);
  }
  return true;
}

function stop({ player }) {
  player.sendMessage(Tournament.stop() ? "Deadman Tournament called off." : "No tournament is running.");
  return true;
}

function skip({ player }) {
  player.sendMessage(Tournament.skipToBracket() ? `Skipped to the bracket: ${state.alive.size} left.` : "Only a lobby or a battle can skip to the bracket.");
  return true;
}

function kill({ player, parts }) {
  const count = number(parts, 1);
  if (count == null || count < 1) {
    player.sendMessage("Usage: ::dmkill <how many bots>");
    return true;
  }
  if (state.phase !== "battle" && state.phase !== "bracket") {
    player.sendMessage("No battle or bracket is running.");
    return true;
  }
  const removed = Tournament.killBots(count);
  player.sendMessage(`${removed} bot${removed === 1 ? "" : "s"} eliminated; ${state.alive.size} left.`);
  return true;
}

function bots({ player, parts }) {
  const count = number(parts, 1);
  if (count == null) {
    player.sendMessage("Usage: ::dmbots <how many>");
    return true;
  }
  if (state.phase === "lobby") {
    state.botTarget = Math.max(state.botsSpawned, count);
    player.sendMessage(`This lobby now wants ${state.botTarget} bots.`);
  } else {
    nextBotCount = count;
    Common.nextBotCount = count;
    player.sendMessage(`The next lobby gets ${count} bots.`);
  }
  return true;
}

function boss({ player, parts }) {
  if (state.phase !== "battle") {
    player.sendMessage("Bosses only spawn during the battle.");
    return true;
  }
  const name = parts.slice(1).join(" ").trim() || null;
  player.sendMessage(Bosses.spawnBoss(name) ? "A boss has spawned." : `No boss${name ? ` matching "${name}"` : ""} could spawn.`);
  return true;
}

function status({ player }) {
  const fog = state.fog ? `fog radius ${Math.round(state.fog.radius)} at ${state.fog.cx},${state.fog.cy}` : "no fog";
  const perf = state.perf ? `ticks avg ${state.perf.average}ms, worst ${state.perf.max}ms` : "no tick timing yet";
  player.sendMessage(`Deadman Tournament: ${state.phase}, ${state.alive.size} alive (${State.aliveBots().length} bots, ${State.aliveReal().length} players), ${state.spectators.size} spectating.`);
  player.sendMessage(`${fog}; ${Bosses.liveBosses().length} bosses up; ${perf}.`);
  return true;
}

function attachCommands(api) {
  api.registerCommand("dmstart", start, PlayerRights.OWNER, "Deadman Tournament: open the lobby / skip the countdown");
  api.registerCommand("dmstop", stop, PlayerRights.OWNER, "Deadman Tournament: call it off");
  api.registerCommand("dmskip", skip, PlayerRights.OWNER, "Deadman Tournament: skip to the 1v1 bracket");
  api.registerCommand("dmkill", kill, PlayerRights.OWNER, "Deadman Tournament: eliminate N random bots");
  api.registerCommand("dmbots", bots, PlayerRights.OWNER, "Deadman Tournament: bots for the lobby");
  api.registerCommand("dmboss", boss, PlayerRights.OWNER, "Deadman Tournament: spawn a boss");
  api.registerCommand("dmstatus", status, PlayerRights.OWNER, "Deadman Tournament: status and tick timing");
}

module.exports = { attachCommands };
