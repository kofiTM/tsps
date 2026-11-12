/**
 * Deadman Tournament clans. At the start `clans.share` of the bots are put in clans of
 * `clans.size`; a clan shares one clan-chat channel (attribute `clan-chat:channel`), so the bot
 * runtime's own clan rules apply (clanmates never pick each other, and help a clanmate who's
 * attacked), and the tournament never lets clanmates fight (Tournament.sameClan).
 *
 * Bosses: every `decideEveryTicks` each clan without a boss looks at the live ones and decides,
 * once per boss, whether to go for it - likelier the more of them are alive, the nearer it is
 * (within `bossRange`), and if it's in the safe zone rather than out in the fog. Once they have,
 * its members go for the boss between fights (Bots) until it dies.
 *
 * A real player can lead a clan of their own: ::dmclan makes it, ::dmrecruit brings in up to
 * `clans.playerRecruits` unclanned bots within `clans.recruitRange` tiles. Recruits follow their
 * leader and attack whatever boss the leader attacks.
 */
const Common = require("./Common.DeadmanTournament");
const State = require("./State.DeadmanTournament");
const { FriendsChatManager } = require("../../interface/FriendsChatManager");

/** The clan chat a player's tournament clan talks in, when they have no chat-channel of their own. */
const DEFAULT_CHANNEL_NAME = "Deadman";

const { state } = State;
/** name -> { name, members: Set, target: NPC|null, considered: Map<NPC, tick last weighed>, leader: Player|null } */
const clans = new Map();
let bosses = () => [];
let serial = 0;

function clanOf(player) {
  const name = player?.getAttribute?.(Common.ATTRIBUTES.team);
  return name != null ? clans.get(name) ?? null : null;
}

/**
 * Into a tournament clan. A bot clan shares its name as the bots' clan-chat channel (the bot
 * runtime's clan rules read it); a player's clan is their real chat-channel, so they see their
 * recruits in it and can talk to them.
 */
function join(player, clan) {
  player.setAttribute(Common.ATTRIBUTES.team, clan.name);
  clan.members.add(player);
  if (!clan.leader) {
    player.setAttribute(Common.ATTRIBUTES.clan, clan.name);
    return;
  }
  try {
    if (player === clan.leader) {
      if (!player.getRelations().getFriendsChatChannelName()) FriendsChatManager.setOwnChannelName(player, DEFAULT_CHANNEL_NAME);
      else FriendsChatManager.join(player, player.getUsername(), true);
    } else if (!FriendsChatManager.join(player, clan.leader.getUsername(), false)) {
      FriendsChatManager.recruitBot(clan.leader, player);
    }
  } catch (error) {
    Common.log(`clan chat for ${player.getUsername()} failed: ${error?.message ?? error}`);
  }
}

function make(name, leader = null) {
  const clan = { name, members: new Set(), target: null, considered: new Map(), leader };
  clans.set(name, clan);
  return clan;
}

/** A clan size, drawn by weight from `clans.sizes` ([size, weight]). */
function drawSize() {
  const sizes = Common.data.clans.sizes ?? [[5, 1]];
  let roll = Math.random() * sizes.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [size, weight] of sizes) {
    roll -= weight;
    if (roll < 0) return size;
  }
  return sizes[0][0];
}

/** Who a clan member keeps close to: its leader, or (a bot clan) its first member still in. */
function anchorOf(bot) {
  const clan = clanOf(bot);
  if (!clan) return null;
  if (clan.leader) return state.alive.has(clan.leader) && clan.leader !== bot ? clan.leader : null;
  for (const member of clan.members) {
    if (state.alive.has(member)) return member === bot ? null : member;
  }
  return null;
}

/** Called by the start, before everyone is scattered (so a clan starts together). */
/** Clans are formed once a tournament: in the lobby once the bots are in (or at the start). */
let formed = false;

function form() {
  if (formed) return;
  formed = true;
  const { share, special = [] } = Common.data.clans;
  // A player's recruits (made in the lobby) keep their clan.
  const bots = Common.shuffle([...state.alive].filter((bot) => State.isBot(bot) && !clanOf(bot)));
  const inClans = Math.floor(bots.length * share);
  let next = 0;
  // Special teams first (a 40, a 50...), then ordinary clans of drawn sizes.
  for (const team of special) {
    if (next >= inClans) break;
    const clan = make(team.name ?? `DM Clan ${++serial}`);
    for (const bot of bots.slice(next, Math.min(next + team.size, inClans))) join(bot, clan);
    next += team.size;
  }
  const sizes = new Map();
  while (next < inClans) {
    const size = drawSize();
    const clan = make(`DM Clan ${++serial}`);
    for (const bot of bots.slice(next, Math.min(next + size, inClans))) join(bot, clan);
    sizes.set(size, (sizes.get(size) ?? 0) + 1);
    next += size;
  }
  const made = [...sizes].map(([size, count]) => `${count} of ${size}`).join(", ");
  Common.log(`clans: ${clans.size} clans (${special.length} special; ${made}), ${bots.length - inClans} bots alone`);
}

function aliveMembers(clan) {
  return [...clan.members].filter((member) => state.alive.has(member));
}

function centreOf(members) {
  const sum = members.reduce((acc, m) => ({ x: acc.x + m.getLocation().getX(), y: acc.y + m.getLocation().getY() }), { x: 0, y: 0 });
  return { x: sum.x / members.length, y: sum.y / members.length };
}

/** Ticks before a clan looks again at a boss it passed on. */
const RECONSIDER_TICKS = 100;

function decide() {
  const { fullSize: size, bossRange, baseChance } = Common.data.clans;
  const Fog = require("./Fog.DeadmanTournament");
  const live = bosses().filter((npc) => Common.alive(npc));
  for (const clan of clans.values()) {
    if (clan.leader) continue;
    if (clan.target && !Common.alive(clan.target)) clan.target = null;
    if (clan.target) continue;
    const members = aliveMembers(clan);
    if (members.length < 2) continue;
    const middle = centreOf(members);
    for (const boss of live) {
      // A boss a clan passed on is looked at again after RECONSIDER_TICKS (~1 min): one left alone
      // for a while is taken by someone near it.
      if (state.clock - (clan.considered.get(boss) ?? -Infinity) < RECONSIDER_TICKS) continue;
      const distance = Common.distance(middle, boss.getLocation());
      if (distance > bossRange) continue;
      clan.considered.set(boss, state.clock);
      const inFog = Fog.depthAt(boss.getLocation().getX(), boss.getLocation().getY()) > 0;
      // A boss close by is always taken (everyone piles on it); further off it's a chance.
      const pileRange = Common.data.clans.pileRange ?? 40;
      const chance = distance <= pileRange ? 1 : baseChance * (members.length / size) * (1 - distance / (bossRange * 1.5)) * (inFog ? 0.5 : 1);
      if (Math.random() < chance) {
        clan.target = boss;
        // Others already on it (after the head start): help kill it, or third-party - pick its
        // attackers off one by one, then take the boss and its drop.
        const Tournament = require("./Tournament.DeadmanTournament");
        const contested = !Tournament.inGrace() && bossAttackers(boss, clan).length > 0;
        clan.plan = contested && Math.random() < (Common.data.clans.thirdPartyChance ?? 0.5) ? "third-party" : "help";
        for (const member of members) {
          if (!State.isBot(member)) member.sendMessage(`<col=ef1020>${clan.name} is going for ${boss.getDefinition?.()?.getName?.() ?? "a boss"}, ${Math.round(distance)} tiles away - follow your leader!</col>`);
        }
        Common.log(`${clan.name} (${members.length}) goes for ${boss.getDefinition?.()?.getName?.()} ${Math.round(distance)} tiles away (${clan.plan})`);
        break;
      }
    }
  }
}

/** The boss `bot` should be after: its clan's choice, or its leader's target. */
/** Fighters on `boss` right now who aren't in `clan` (its attackers, for a third party to pick off). */
function bossAttackers(boss, clan) {
  const list = [];
  for (const player of state.alive) {
    if (clan?.members?.has(player)) continue;
    if (player.getCombat?.().getTarget?.() === boss && Common.alive(player)) list.push(player);
  }
  return list;
}

/** The plan a bot's clan has for its boss: "help" (kill it) or "third-party" (its attackers first). */
function planFor(bot) {
  const clan = clanOf(bot);
  return clan && !clan.leader ? clan.plan ?? "help" : "help";
}

function bossFor(bot) {
  const clan = clanOf(bot);
  if (!clan) return null;
  if (clan.leader) {
    const target = clan.leader.getCombat?.().getTarget?.();
    return target && !target.isPlayer?.() && Common.alive(target) ? target : null;
  }
  return clan.target && Common.alive(clan.target) ? clan.target : null;
}

function leaderOf(bot) {
  const leader = clanOf(bot)?.leader ?? null;
  return leader && leader !== bot && state.alive.has(leader) ? leader : null;
}

function tick() {
  if (state.phase === "battle" && state.clock % Common.data.clans.decideEveryTicks === 0) decide();
  if ((state.phase === "lobby" || state.phase === "battle") && state.clock % 5 === 0) {
    for (const player of state.alive) {
      if (!State.isBot(player) && followsBot(player)) pointAtLeader(player);
    }
  }
}

// ---------------------------------------------------------------- the player's own clan

function makeClan({ player }) {
  if (!state.alive.has(player)) {
    player.sendMessage("You need to be in the Deadman Tournament to start a clan.");
    return true;
  }
  if (clanOf(player)) {
    player.sendMessage(`You're already in ${clanOf(player).name}.`);
    return true;
  }
  const clan = make(`${player.getUsername()}'s clan`, player);
  join(player, clan);
  player.sendMessage(`<col=ef1020>You lead ${clan.name}. ::dmrecruit near unclanned bots to bring them in.</col>`);
  return true;
}

function recruit({ player }) {
  const clan = clanOf(player);
  if (!clan || clan.leader !== player) {
    player.sendMessage("Start a clan first with ::dmclan.");
    return true;
  }
  const { playerRecruits, recruitRange } = Common.data.clans;
  const room = playerRecruits - (clan.members.size - 1);
  if (room <= 0) {
    player.sendMessage(`Your clan is full (${playerRecruits} recruits).`);
    return true;
  }
  const here = player.getLocation();
  const nearby = [...state.alive]
    .filter((bot) => State.isBot(bot) && !clanOf(bot) && Common.distance(here, bot.getLocation()) <= recruitRange)
    .sort((a, b) => Common.distance(here, a.getLocation()) - Common.distance(here, b.getLocation()))
    .slice(0, room);
  for (const bot of nearby) {
    bot.getCombat().reset?.();
    join(bot, clan);
  }
  player.sendMessage(nearby.length
    ? `<col=ef1020>${nearby.map((bot) => bot.getUsername()).join(", ")} joined your clan.</col>`
    : `No unclanned bots within ${recruitRange} tiles.`);
  return true;
}

/**
 * ::dmjoin - a player joins the nearest bot clan instead of leading one: its bot leader decides
 * (chests and bosses through the looting head start, then the fight), the player follows it (a
 * hint arrow over the leader), and the clan defends them like any clanmate.
 */
function joinBotClan({ player }) {
  if (!state.alive.has(player)) {
    player.sendMessage("You need to be in the Deadman Tournament to join a clan.");
    return true;
  }
  if (clanOf(player)) {
    player.sendMessage(`You're already in ${clanOf(player).name}.`);
    return true;
  }
  if (clans.size === 0) {
    player.sendMessage("The bot clans form once every bot is in the lobby - try again in a moment.");
    return true;
  }
  const here = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (const clan of clans.values()) {
    if (clan.leader || clan.hasPlayer) continue;
    const leader = [...clan.members].find((m) => state.alive.has(m));
    if (!leader) continue;
    const d = Common.distance(here, leader.getLocation());
    if (d < bestDistance) {
      best = clan;
      bestDistance = d;
    }
  }
  if (!best) {
    player.sendMessage("There's no bot clan free to join.");
    return true;
  }
  join(player, best);
  best.hasPlayer = true;
  const leader = [...best.members].find((m) => m !== player && state.alive.has(m));
  player.sendMessage(`<col=ef1020>You've joined ${best.name} (${aliveMembers(best).length} strong), led by ${leader?.getUsername() ?? "nobody"}. Follow the arrow: they pick the chests and bosses, then the fights once the head start is over.</col>`);
  pointAtLeader(player, true);
  return true;
}

const pointedAt = new WeakMap();

/** The hint arrow over a player-member's bot leader (moved on if the leader falls). */
function pointAtLeader(player, force = false) {
  const leader = anchorOf(player);
  const clan = clanOf(player);
  if (!leader || !clan || clan.leader) return;
  if (!force && pointedAt.get(player) === leader) return;
  pointedAt.set(player, leader);
  player.getPacketSender().sendEntityHint?.(leader);
  if (!force) player.sendMessage(`<col=ef1020>${leader.getUsername()} leads ${clan.name} now.</col>`);
}

/** Whether a player follows a bot leader (the fog's arrow leaves them to the leader's). */
function followsBot(player) {
  const clan = clanOf(player);
  return Boolean(clan && !clan.leader && anchorOf(player));
}

function ended() {
  for (const clan of clans.values()) {
    for (const member of clan.members) {
      member.setAttribute?.(Common.ATTRIBUTES.team, null);
      if (!clan.leader) member.setAttribute?.(Common.ATTRIBUTES.clan, null);
      else if (State.isBot(member)) {
        try {
          FriendsChatManager.leave(member, false);
        } catch (_error) {
          // Logged out already.
        }
      }
    }
  }
  clans.clear();
  formed = false;
}

function attachClans(api, bossList) {
  bosses = bossList;
  State.onTick(tick);
  State.onEnd(ended);
  api.registerCommand("dmclan", makeClan, undefined, "Deadman Tournament: start a clan of your own (same as ::dmlead)");
  api.registerCommand("dmlead", makeClan, undefined, "Deadman Tournament: lead a clan of your own; ::dmrecruit bots into it");
  api.registerCommand("dmjoin", joinBotClan, undefined, "Deadman Tournament: join the nearest bot clan and follow its leader");
  api.registerCommand("dmrecruit", recruit, undefined, "Deadman Tournament: bring nearby unclanned bots into your clan");
}

module.exports = { attachClans, form, clanOf, bossFor, planFor, bossAttackers, leaderOf, anchorOf, followsBot };
