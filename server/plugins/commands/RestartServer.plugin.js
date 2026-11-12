/**
 * Server custom (kofi, 2026-11-09): ::rs [seconds] (owner) restarts the server. Everyone sees the
 * system-update timer (5 seconds unless given), then every player is saved and the server
 * restarts: `yarn start` runs the server under nodemon, which restarts it when a watched file
 * changes, so the command writes data/restart-trigger.json (works on Windows too, where there's
 * no restart signal). Run without nodemon (start:prod), the file changes and nothing restarts.
 */
const fs = require("fs");
const path = require("path");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

const TRIGGER_FILE = path.join(process.cwd(), "data", "restart-trigger.json");
const DEFAULT_SECONDS = 5;
let api = null;
let restarting = false;

function later(ticks, action) {
  const { Task, TaskManager } = api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

async function saveAndRestart(by) {
  const { World, GameConstants } = api.core;
  try {
    const saved = World.savePlayers("restart");
    await GameConstants.PLAYER_PERSISTENCE.flush();
    console.info(`[restart] ${by} restarted the server; saved ${saved?.saved ?? "?"} players.`);
  } catch (error) {
    console.error("[restart] saving failed; not restarting", error);
    restarting = false;
    return;
  }
  fs.writeFileSync(TRIGGER_FILE, JSON.stringify({ restartedBy: by, at: new Date().toISOString() }, null, 2));
}

function restart({ player, parts }) {
  if (restarting) {
    player.sendMessage("The server is already restarting.");
    return true;
  }
  const seconds = Math.max(1, Math.floor(Number(parts[1]) || DEFAULT_SECONDS));
  restarting = true;
  for (const other of api.core.World.getPlayers()) {
    if (other && other.isPlayerBot?.() !== true) other.getPacketSender().sendSystemUpdate(seconds);
  }
  player.sendMessage(`Restarting the server in ${seconds} seconds.`);
  later(Math.ceil(seconds / 0.6), () => void saveAndRestart(player.getUsername()));
  return true;
}

module.exports = {
  name: "RestartServer",
  register(pluginApi) {
    api = pluginApi;
    api.registerCommand("rs", restart, PlayerRights.OWNER, "Restart the server (::rs [seconds])");
  },
};
