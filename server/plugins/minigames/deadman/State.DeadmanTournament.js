/**
 * Deadman Tournament state, shared by every unit, and the hooks they attach to:
 * onStart(), onTick(), onKill(killer, victim), onEliminated(victim, killer, where), onBracket(),
 * onEnd(winner).
 *
 * Phases: idle -> lobby (bots spawn, countdown) -> battle (the Wilderness) -> bracket (1v1s in
 * the Deadman arena) -> done (results, then the server shuts down).
 */
const state = {
  phase: "idle",
  /** Ticks since the phase began. */
  clock: 0,
  /** Ticks left on the lobby countdown. */
  countdown: 0,
  /** Everyone in this tournament (players and bots), and who is still in it. */
  participants: new Set(),
  alive: new Set(),
  kills: new Map(),
  /** Real players out of it, watching. */
  spectators: new Set(),
  /** Bots wanted for this tournament, and spawned so far. */
  botTarget: 0,
  botsSpawned: 0,
  total: 0,
  winner: null,
  /** Usernames the tournament is spawning (its spawn gate lets only these through). */
  ownNames: new Set(),
};

const hooks = { start: [], tick: [], kill: [], eliminated: [], bracket: [], end: [] };

function run(name, ...args) {
  for (const hook of hooks[name]) {
    try {
      hook(...args);
    } catch (error) {
      require("./Common.DeadmanTournament").log(`hook ${name} failed: ${error?.stack ?? error}`);
    }
  }
}

function isParticipant(player) {
  return Boolean(player) && state.participants.has(player);
}

function isAlive(player) {
  return Boolean(player) && state.alive.has(player);
}

function isBot(player) {
  return player?.getAttribute?.("deadman-tournament:bot") === true;
}

function aliveBots() {
  return [...state.alive].filter(isBot);
}

function aliveReal() {
  return [...state.alive].filter((player) => !isBot(player));
}

function reset() {
  state.phase = "idle";
  state.clock = 0;
  state.countdown = 0;
  state.participants.clear();
  state.alive.clear();
  state.kills.clear();
  state.spectators.clear();
  state.botTarget = 0;
  state.botsSpawned = 0;
  state.total = 0;
  state.winner = null;
  state.ownNames.clear();
  state.totals = {};
  state.stats = {};
}

module.exports = {
  state,
  run,
  isParticipant,
  isAlive,
  isBot,
  aliveBots,
  aliveReal,
  reset,
  onStart: (hook) => hooks.start.push(hook),
  onTick: (hook) => hooks.tick.push(hook),
  onKill: (hook) => hooks.kill.push(hook),
  onEliminated: (hook) => hooks.eliminated.push(hook),
  onBracket: (hook) => hooks.bracket.push(hook),
  onEnd: (hook) => hooks.end.push(hook),
};
