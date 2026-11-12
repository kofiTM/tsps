/**
 * Deadman Tournament spectating. A real player who is eliminated (or logs in mid-tournament)
 * watches the rest: invisible (drawn as AdminCommands' model-less NPC, and `admin:invisible`, so
 * NPCs and bosses ignore them), unattackable and unable to attack, they ride along a few tiles
 * from a fighter - their killer first, then whoever they pick:
 *   ::watch            the fighter with the most kills
 *   ::watch next/prev  the next or previous fighter still in
 *   ::watch <name>     that fighter
 * (::spec is AdminCommands' special-attack command.)
 * In the bracket they follow their fighter into the arena copy their duel is in.
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");

const { state } = State;
const INVISIBLE_NPC = 11858;
/** Spectators carry the Spectator orb (custom item 50009, custom-items.json): "Next fight" is ::n, "Top killer" ::w. */
const ORB = 50009;
const ORB_NAME = "Spectator orb";
let orbClicksLogged = 0;
let spectatorClicksLogged = 0;
const SPECTATOR_CLICKS = 10;
const FOLLOW_EVERY = 2;
const FOLLOW_GAP = 3;
/** Spectators walk where they like; only this far from their fighter are they brought back. */
const LEASH = 15;
const following = new Map();

/** Who's worth watching: in the bracket, the fighters in a duel right now (else everyone still in). */
function candidates() {
  if (state.phase === "bracket" && state.duelOf) {
    const dueling = [...state.alive].filter((player) => state.duelOf(player)?.live);
    if (dueling.length) return dueling;
  }
  return [...state.alive];
}

function topKiller() {
  let best = null;
  for (const player of candidates()) {
    if (!best || (state.kills.get(player) ?? 0) > (state.kills.get(best) ?? 0)) best = player;
  }
  return best;
}

/** The automatic pick: a fight going on right now (a live duel in the bracket), at random; else the top killer. */
function aFight(except = null) {
  const fighting = candidates().filter((player) => {
    if (player === except) return false;
    if (state.phase === "bracket") return Boolean(state.duelOf?.(player)?.live);
    const combat = player.getCombat();
    return Common.alive(combat.getTarget?.()) || Common.alive(combat.getAttacker?.());
  });
  return fighting.length ? Common.pick(fighting) : topKiller();
}

/** The top killer among those fighting right now (::w, the orb's "Top killer"); else the top killer. */
function topFighter() {
  const fighting = candidates().filter((player) => {
    if (state.phase === "bracket") return Boolean(state.duelOf?.(player)?.live);
    const combat = player.getCombat();
    return Common.alive(combat.getTarget?.()) || Common.alive(combat.getAttacker?.());
  });
  let best = null;
  for (const player of fighting) {
    if (!best || (state.kills.get(player) ?? 0) > (state.kills.get(best) ?? 0)) best = player;
  }
  return best ?? topKiller();
}

function become(player, target = null) {
  if (!player?.isRegistered?.() || State.isBot(player)) return;
  state.spectators.add(player);
  player.setAttribute(Common.ATTRIBUTES.spectator, true);
  player.setAttribute(Common.ATTRIBUTES.invisible, true);
  player.setNpcTransformationId?.(INVISIBLE_NPC);
  player.getCombat?.().reset?.();
  // The death task froze them and left the unfreezing to the respawn, which a handled death skips.
  player.getMovementQueue().setBlockMovement(false).reset?.();
  player.setUntargetable?.(true);
  player.getUpdateFlag?.().flag(Common.core.Flag.APPEARANCE);
  giveButtons(player);
  // The survivors / kills / fog overlay: the death (or ::s, or a login mid-tournament) closes or skips it.
  require("./Tournament.DeadmanTournament").openHud(player);
  watch(player, target && state.alive.has(target) ? target : aFight());
  player.sendMessage("<col=ef1020>You're out - spectating. ::n (or the orb's Next fight) for another fight, ::w (or the orb's Top killer) for the top killer in a fight, ::w <name> for someone.</col>");
}

function giveButtons(player) {
  const { Item } = Common.core;
  const inventory = player.getInventory();
  if (!inventory.contains(ORB) && inventory.getFreeSlots() > 0) inventory.add(new Item(ORB, 1), true);
}

function takeButtons(player) {
  const inventory = player.getInventory();
  while (inventory.contains(ORB)) inventory.delete(ORB, 1);
  inventory.refreshItems?.();
}

function orbNext({ player }) {
  if (!state.spectators.has(player)) return false;
  nextFight(player);
  return true;
}

function orbTop({ player }) {
  if (!state.spectators.has(player)) return false;
  watch(player, topFighter());
  return true;
}

/** The fights going on right now, each once (a duel, or a fighter and who they're fighting), in a steady order. */
function fights() {
  const seen = new Set();
  const list = [];
  for (const player of candidates()) {
    let key;
    if (state.phase === "bracket") {
      const duel = state.duelOf?.(player);
      if (!duel?.live) continue;
      key = duel;
    } else {
      const combat = player.getCombat();
      const foe = Common.asPlayer(combat.getTarget?.()) ?? Common.asPlayer(combat.getAttacker?.());
      if (!foe || !Common.alive(foe)) continue;
      key = [player.getUsername(), foe.getUsername()].sort().join("|");
    }
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({ key, player });
  }
  return list.sort((a, b) => a.player.getUsername().localeCompare(b.player.getUsername()));
}

/** The next fight in the list after the one being watched (never the same fight again). */
function nextFight(player) {
  const list = fights();
  if (list.length === 0) {
    // Nothing to watch (the looting head start, a lull): someone else each time - the top killer
    // once anyone has a kill, else anyone at random.
    const current = following.get(player);
    const top = topKiller();
    const others = candidates().filter((p) => p !== current);
    const pickTop = top && top !== current && (state.kills.get(top) ?? 0) > 0;
    const next = pickTop ? top : Common.pick(others.length ? others : candidates());
    if (!next) return;
    player.sendMessage(pickTop ? "No fights are going on right now - watching the top killer." : "No fights are going on right now - watching someone at random.");
    watch(player, next);
    return;
  }
  const current = following.get(player);
  const currentFoe = Common.asPlayer(current?.getCombat?.().getTarget?.()) ?? Common.asPlayer(current?.getCombat?.().getAttacker?.());
  const at = list.findIndex(({ key, player: p }) => p === current || p === currentFoe
    || (state.phase === "bracket" && key === state.duelOf?.(current)));
  const next = list[(at + 1) % list.length];
  watch(player, next.player);
  player.sendMessage(`Fight ${((at + 1) % list.length) + 1} of ${list.length}.`);
}

function nextFightCommand({ player }) {
  if (!state.spectators.has(player)) {
    player.sendMessage("You can only spectate once you're out of the Deadman Tournament.");
    return true;
  }
  nextFight(player);
  return true;
}

function unbecome(player) {
  if (!state.spectators.has(player) && !player.getAttribute(Common.ATTRIBUTES.spectator)) return;
  state.spectators.delete(player);
  following.delete(player);
  player.setAttribute(Common.ATTRIBUTES.spectator, null);
  player.setAttribute(Common.ATTRIBUTES.invisible, null);
  player.setNpcTransformationId?.(-1);
  takeButtons(player);
  player.setUntargetable?.(false);
  player.getMovementQueue().setBlockMovement(false);
  player.getUpdateFlag?.().flag(Common.core.Flag.APPEARANCE);
  leaveInstance(player);
}

function watch(spectator, target) {
  if (!target) return;
  atBoss.delete(spectator);
  const changed = following.get(spectator) !== target;
  following.set(spectator, target);
  if (changed) spectator.sendMessage(`Now watching ${target.getUsername()} (${state.kills.get(target) ?? 0} kills).`);
  follow(spectator, true);
}

function leaveInstance(player) {
  const area = player.getArea?.();
  if (area && area instanceof Common.core.TemplatedInstanceArea) area.leave?.(player, false);
}

/** A few tiles off the fighter, in the same arena copy if they're in one. */
function follow(spectator, force = false) {
  const boss = atBoss.get(spectator);
  if (boss) {
    if (Common.alive(boss)) return;
    atBoss.delete(spectator);
  }
  const target = following.get(spectator);
  // Gone, or (in the bracket) waiting while others fight: on to a live duel.
  const idle = target && state.phase === "bracket" && state.duelOf && !state.duelOf(target)?.live && candidates().some((p) => state.duelOf(p)?.live);
  if (!target || !state.alive.has(target) || idle) {
    const next = aFight(target);
    if (next && next !== target) watch(spectator, next);
    return;
  }
  const there = target.getLocation();
  const here = spectator.getLocation();
  const targetArea = target.getArea?.();
  const instance = targetArea instanceof Common.core.TemplatedInstanceArea ? targetArea : null;
  const own = spectator.getArea?.();
  const sameInstance = (own instanceof Common.core.TemplatedInstanceArea ? own : null) === instance;
  if (!force && sameInstance && here.getZ() === there.getZ() && Common.distance(here, there) <= LEASH) return;
  if (!sameInstance) {
    leaveInstance(spectator);
    if (instance) instance.enter(spectator);
  }
  // A free tile near them, never their own: an invisible spectator on a fighter's tile hides them.
  const { Location } = Common.core;
  const offsets = [[FOLLOW_GAP, 0], [-FOLLOW_GAP, 0], [0, FOLLOW_GAP], [0, -FOLLOW_GAP], [2, 2], [-2, -2], [2, -2], [-2, 2], [1, 0], [0, 1]];
  for (const [dx, dy] of offsets) {
    const x = there.getX() + dx;
    const y = there.getY() + dy;
    if (!Common.standable(x, y, there.getZ(), instance)) continue;
    // On their side of any fence or wall (the arena's pen, not the walkway outside it).
    if (!walkable(there.getX(), there.getY(), x, y, there.getZ(), instance)) continue;
    if ([...state.alive].some((p) => p.getLocation().getX() === x && p.getLocation().getY() === y)) continue;
    spectator.moveTo(new Location(x, y, there.getZ()));
    return;
  }
}

/** Whether (tx, ty) can be walked to from (fx, fy) within a few steps (nothing between them). */
const WALK_STEPS = 8;

function walkable(fx, fy, tx, ty, z, area) {
  const { RegionManager } = Common.core;
  const seen = new Set([`${fx},${fy}`]);
  let frontier = [[fx, fy]];
  for (let step = 0; step < WALK_STEPS && frontier.length; step++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (seen.has(key) || Math.abs(nx - fx) > 4 || Math.abs(ny - fy) > 4) continue;
        let open = false;
        try {
          open = RegionManager.canMove(x, y, nx, ny, z, 1, 1, area ?? null);
        } catch (_error) {
          open = false;
        }
        if (!open) continue;
        if (nx === tx && ny === ty) return true;
        seen.add(key);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return false;
}

/** Whether a fighter stands on the spectator's tile (they'd be hidden under the invisible spectator). */
function sharesTile(spectator) {
  const here = spectator.getLocation();
  return [...state.alive].some((p) => {
    const at = p.getLocation();
    return at.getX() === here.getX() && at.getY() === here.getY() && at.getZ() === here.getZ() && p.getArea?.() === spectator.getArea?.();
  });
}

/** A fighter stepped onto the spectator: just one tile over (a free, reachable neighbour). */
function sidestep(spectator) {
  const here = spectator.getLocation();
  const z = here.getZ();
  const area = spectator.getArea?.();
  const instance = area instanceof Common.core.TemplatedInstanceArea ? area : null;
  const { Location, RegionManager } = Common.core;
  const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  for (let i = neighbours.length - 1; i > 0; i--) {
    const j = Common.randomInt(0, i);
    [neighbours[i], neighbours[j]] = [neighbours[j], neighbours[i]];
  }
  for (const [dx, dy] of neighbours) {
    const x = here.getX() + dx;
    const y = here.getY() + dy;
    if (!Common.standable(x, y, z, instance)) continue;
    let open = false;
    try {
      open = RegionManager.canMove(here.getX(), here.getY(), x, y, z, 1, 1, instance);
    } catch (_error) {
      open = false;
    }
    if (!open) continue;
    if ([...state.alive].some((p) => p.getLocation().getX() === x && p.getLocation().getY() === y && p.getArea?.() === area)) continue;
    spectator.moveTo(new Location(x, y, z));
    return true;
  }
  return false;
}

function tick() {
  // Every tick: a fighter stepping onto a spectator's tile has the spectator moved off it.
  for (const spectator of state.spectators) {
    if (spectator.isRegistered?.() && sharesTile(spectator) && !sidestep(spectator)) follow(spectator, true);
  }
  if (state.clock % FOLLOW_EVERY !== 0) return;
  for (const spectator of [...state.spectators]) {
    if (!spectator.isRegistered?.()) {
      state.spectators.delete(spectator);
      following.delete(spectator);
      continue;
    }
    follow(spectator);
  }
}

function step(spectator, by) {
  const list = candidates();
  if (list.length === 0) return;
  const at = list.indexOf(following.get(spectator));
  watch(spectator, list[(at + by + list.length) % list.length]);
}

function command({ player, parts }) {
  if (!state.spectators.has(player)) {
    player.sendMessage("You can only spectate once you're out of the Deadman Tournament.");
    return true;
  }
  const arg = (parts.slice(1).join(" ") || "").trim().toLowerCase();
  if (!arg) watch(player, topFighter());
  else if (arg === "next") step(player, 1);
  else if (arg === "prev") step(player, -1);
  else {
    const target = [...state.alive].find((other) => other.getUsername().toLowerCase() === arg)
      ?? [...state.alive].find((other) => other.getUsername().toLowerCase().includes(arg));
    if (target) watch(player, target);
    else player.sendMessage(`Nobody still in is called "${arg}".`);
  }
  return true;
}

/**
 * ::s - out of the tournament and straight to spectating (in the lobby, or any time after): no
 * death, no drop; their own things stay stashed and come back at the end like everyone's.
 */
function spectateNow({ player }) {
  if (state.phase === "idle" || state.phase === "done") {
    player.sendMessage("There's no Deadman Tournament to watch right now.");
    return true;
  }
  if (state.spectators.has(player)) {
    player.sendMessage("You're already spectating. ::n for another fight, ::w for the top killer.");
    return true;
  }
  if (state.alive.has(player)) {
    state.alive.delete(player);
    if (state.phase !== "lobby") Common.feed(`<col=ef1020>${player.getUsername()}</col> has left the fight to spectate. ${state.alive.size} remain.`);
  }
  // Their kit off them (it isn't theirs to keep); their own things stay in the stash till the end.
  require("./Gear.DeadmanTournament").empty(player);
  player.getInventory().refreshItems?.();
  player.getEquipment().refreshItems?.();
  require("./Gear.DeadmanTournament").refresh(player);
  player.getCombat?.().reset?.();
  become(player);
  return true;
}

/** Spectators looking at a boss (::b): the fighter-follow leaves them be until ::n or ::w. */
const atBoss = new Map();

/** ::b - to the next live boss, a few tiles off it; again for the one after. */
function bossCommand({ player }) {
  if (!state.spectators.has(player)) {
    player.sendMessage("You can only teleport to bosses while spectating.");
    return true;
  }
  const bosses = require("./Bosses.DeadmanTournament").liveBosses()
    .sort((a, b) => a.getIndex?.() - b.getIndex?.());
  if (bosses.length === 0) {
    player.sendMessage("No bosses are up right now.");
    return true;
  }
  const at = bosses.indexOf(atBoss.get(player));
  const boss = bosses[(at + 1) % bosses.length];
  atBoss.set(player, boss);
  following.delete(player);
  const there = boss.getLocation();
  const { Location } = Common.core;
  let tile = null;
  for (const [dx, dy] of [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [-3, -3]]) {
    if (Common.standable(there.getX() + dx, there.getY() + dy, there.getZ())) {
      tile = new Location(there.getX() + dx, there.getY() + dy, there.getZ());
      break;
    }
  }
  leaveInstance(player);
  player.moveTo(tile ?? there.clone());
  const level = Common.wildernessLevel(there.getX(), there.getY());
  player.sendMessage(`Boss ${((at + 1) % bosses.length) + 1} of ${bosses.length}: ${boss.getDefinition?.()?.getName?.() ?? "a boss"} (level ${level} Wilderness). ::b for the next, ::n or ::w to watch fighters.`);
  return true;
}

function eliminated(victim, killer) {
  if (State.isBot(victim) || !victim.isRegistered?.()) return;
  if (state.phase === "done") return;
  Common.later(1, () => become(victim, killer));
}

function joined({ player }) {
  become(player);
}

function released({ player }) {
  unbecome(player);
}

/** NPCs leave spectators alone (AdminCommands' rule covers `admin:invisible` too, if loaded). */
function canAttack(event) {
  const target = Common.asPlayer(event.target);
  if (target && state.spectators.has(target)) event.allow = false;
}

function ended() {
  for (const spectator of [...state.spectators]) unbecome(spectator);
}

function attachSpectate(api) {
  State.onTick(tick);
  State.onEliminated(eliminated);
  State.onEnd(ended);
  api.onCanAttack(canAttack);
  api.onCustomEvent("deadman-tournament:spectate", joined);
  api.onCustomEvent("deadman-tournament:released", released);
  // ::spec is AdminCommands' (special attack energy): the tournament's is ::watch.
  api.registerCommand("watch", command, undefined, "Deadman Tournament: watch the fighters still in");
  api.registerCommand("b", bossCommand, undefined, "Deadman Tournament: spectators teleport to the next live boss");
  api.registerCommand("s", spectateNow, undefined, "Deadman Tournament: leave the fight and spectate");
  api.registerCommand("w", command, undefined, "Deadman Tournament: watch the top killer (::w <name> for someone)");
  api.registerCommand("n", nextFightCommand, undefined, "Deadman Tournament: watch the next fight");
  api.onItemAction(ORB_NAME, { "Next fight": orbNext, "Top killer": orbTop });
  // By the click itself as well (option 1 "Next fight", 2 "Top killer"), whatever its name lookup
  // makes of the custom item; the first few clicks are logged with what arrived.
  // Earlier still: every interface click reaches plugins as "player:widget-action" before the core
  // resolves an inventory option by name (which drops the orb's options) - the orb is caught there.
  // The inventory widget op is 2 for the first option ("Next fight") and 3 for the second.
  // Diagnostic: the first SPECTATOR_CLICKS clicks from spectators, whatever they are, in full.
  const logSpectatorClick = (kind, player, detail) => {
    if (!player || !state.spectators.has(player) || spectatorClicksLogged >= SPECTATOR_CLICKS) return;
    spectatorClicksLogged++;
    let text = "";
    try {
      text = JSON.stringify(detail, (key, value) => (typeof value === "object" && value && key ? String(value?.getId?.() ?? "[object]") : value));
    } catch (_error) {
      text = String(detail);
    }
    Common.log(`spectator click (${kind}): ${player.getUsername()} ${text.slice(0, 300)}`);
  };
  api.onCustomEvent("player:widget-action", (event) => logSpectatorClick("widget", event?.player, event?.packet));
  api.onItemAction((event) => logSpectatorClick("item", event?.player, { itemId: event?.itemId, clickType: event?.clickType, option: event?.option, interfaceId: event?.interfaceId, slot: event?.slot, handled: event?.handled }));
  api.onCustomEvent("player:widget-action", (event) => {
    const packet = event?.packet;
    const player = event?.player;
    if (!packet || !player) return;
    // The click names the inventory slot, not always the item (this client sends no item id for
    // custom items): the orb is the item in that slot of the main inventory (interface 149).
    const fromSlot = packet.groupId === 149 && Number.isInteger(packet.slot) ? player.getInventory().getItems()[packet.slot]?.getId?.() : null;
    if (Number(packet.itemId ?? fromSlot) !== ORB) return;
    const option = packet.option ?? (packet.buttonNum === 2 ? "Next fight" : packet.buttonNum === 3 ? "Top killer" : null);
    if (orbClicksLogged < 5) {
      orbClicksLogged++;
      Common.log(`orb widget click: ${player.getUsername()} op ${packet.buttonNum}, option ${packet.option ?? "-"}, slot ${packet.slot}, spectating ${state.spectators.has(player)}`);
    }
    if (option === "Next fight" && orbNext({ player }) !== false) event.handled = true;
    else if (option === "Top killer" && orbTop({ player }) !== false) event.handled = true;
  });
  api.onItemAction(function spectatorOrb(event) {
    if (Number(event?.itemId) !== ORB || !event.player) return;
    if (orbClicksLogged < 5) {
      orbClicksLogged++;
      Common.log(`orb click: ${event.player.getUsername()} click ${event.clickType}, option ${event.option ?? "-"}, interface ${event.interfaceId}, already handled ${event.handled === true}, spectating ${state.spectators.has(event.player)}`);
    }
    if (event.handled) return;
    const option = event.option ?? ["Next fight", "Top killer"][Number(event.clickType) - 1];
    if (option === "Next fight" && orbNext(event) !== false) event.handled = true;
    else if (option === "Top killer" && orbTop(event) !== false) event.handled = true;
  });
}

module.exports = { attachSpectate, become, unbecome, following };
