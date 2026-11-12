# Deadman Tournament

Server custom (kofi, 2026-11-09). A Deadman-style battle royale across the whole Wilderness for
every real player online plus N bots, then a 1v1 bracket for the last 100 in copies of the Deadman
finale arena. Once there's a winner, the server saves everyone and shuts down.

The plugin is `server/plugins/minigames/DeadmanTournament.plugin.js`. Its units are in
`server/plugins/minigames/deadman/` and its data is in
`server/plugins/minigames/data/deadman-tournament.json`.

## World config (`world.json` → `pluginConfig`)

| Key | Default | What |
| --- | --- | --- |
| `DeadmanTournament:enabled` | `false` | Opens a lobby on its own after server start. `::dmstart` works either way. |
| `DeadmanTournament:botCount` | `300` | Bots per tournament. 499 + 1 player has been load tested at a 600ms tick. |
| `DeadmanTournament:autoStart` | `true` | With `enabled`, opens the lobby `lobby.startDelayTicks` after startup. |
| `DeadmanTournament:shutdownOnEnd` | `true` | Saves everyone and shuts the server down once there's a winner. |
| `DeadmanTournament:countdownTicks` | `lobby.countdownTicks` (200) | Length of the lobby countdown. |

## How a tournament runs

1. **Lobby.** Every real player online, and anyone who logs in, is entered and moved to Edgeville.
   The bots spawn round Edgeville, 10 a tick. They walk about and chat about Deadman, and can't
   fight. The chat counts the start down (2:00 … 10, 9 … 1). Real players count down overhead from
   10, then say "GO!". `::dmclan` / `::dmrecruit` build a clan in the lobby.
2. **Start.** Each real player's own items and stats go into Last Man Standing's Stash, which
   returns them afterwards, or on the next login after a crash. Everyone gets 99 in every combat
   skill (combat level 126) and a starter kit drawn by `kitWeights`: the basic melee, ranged and
   magic kits, or the LMS-style max/med setups. Every kit fills 28 inventory slots. Everyone
   scatters to random Wilderness tiles: walkable ground only, never water or Ferox Enclave. A
   player's recruits start beside them. The server's regional Wilderness roamers are paused while
   the tournament runs.
3. **Battle.** Anyone can fight anyone who isn't a clanmate. A death is final:
   - The fallen drop everything they carried, for the killer first.
   - The killer gets a bloody key, or a bloodier key at 150 or fewer alive.
   - A bot logs out. A real player spectates.
   - Keys open the loot chests scattered inside the safe zone (LMS chest loc, `chests.count`).
     Chests roll real items from the `loot` tables.
4. **Fog.** A square safe zone around a random centre closes from the whole Wilderness to
   `fog.finalRadius` over `fog.battleTicks`. Outside it you take a hit every 2 ticks from the first
   tick. The base hit grows from 1 to 10 as the zone shrinks, plus 1 for every 8 tiles deep, capped
   at 25. A hint arrow points real players to the zone, and the LMS overlay shows survivors, kills
   and the fog status.
5. **Bosses.** Bosses spawn Deadman-style every 200–300 ticks (the first at 150), up to 4 alive.
   They spawn anywhere in the Wilderness; half land near the safe zone's edge. A boss the fog
   reaches stays where it is.
   - Every spawn, kill and big drop is broadcast.
   - Every kill also gives one guaranteed unique from the boss's `uniques`: a whole godsword,
     never shards or a hilt. It goes to whoever it helps most among the killer and their clan
     within 25 tiles. A bot wears it at once.
   - Adding a boss means adding one `bosses.pool` entry: `name`, `npc`, `guards`, `uniques`.
6. **Bots.** Between fights a bot works down this list:
   1. Get out of the fog.
   2. Loot nearby: upgrades by gear score, food and potions with room for them, only the runes
      it uses, keys. It wears the upgrade and drops what it replaces.
   3. With a key, go to the nearest chest.
   4. Go for its clan's chosen boss.
   5. Follow its leader, if it's a player's recruit.
   6. Fight the nearest non-clanmate who isn't busy.
   7. Drift to the middle of the zone.

   Tournament bots carry `player-bots:fixed-loadout`, so the bot runtime never re-gears them or
   cleans up their floor loot.
7. **Clans.** At the start, 60% of the bots go into clans. Sizes are drawn from `clans.sizes`
   (5s and 10s), after any `clans.special` teams (`{ "name", "size" }`, e.g. a 40 or a 50).
   - Clanmates never fight each other.
   - A clan decides, once per boss, whether to go for it. It's likelier the bigger and nearer
     the clan, and less likely if the boss is in the fog.
   - A player's clan is a real chat-channel: their own, or a new one called "Deadman". Recruits
     join it, follow the leader, and attack the leader's boss.
8. **Bracket.** At `bracket.at` (100) alive, or on `::dmskip`:
   - The fog stops, and chests and bosses go.
   - Everyone waits, healed, in the Deadman finale arena. The cache still has it: loc 56375
     barriers at x 3674 and 3685, y 8607-8608, with the stands on plane 1.
   - Each round pairs everyone at random; an odd one out gets a bye. Every duel runs at once in
     its own copy of the arena (chunks 458-461 × 1074-1076, planes 0-1).
   - Both fighters are healed and resupplied to their kit's food and potions, keeping the gear
     they won. A 5-tick countdown, then FIGHT!
   - After 300 ticks the duel goes to whoever has more hitpoints left.
9. **End.** The winner is broadcast. 50 ticks later everyone's own items come back, the bots
   leave, and (with `shutdownOnEnd`) the server shuts down gracefully.

## Commands

| Command | Who | What |
| --- | --- | --- |
| `::spec` / `::spec next` / `::spec prev` / `::spec <name>` | spectators | Watch the top killer, the next or previous fighter, or one by name |
| `::dmclan` | players in it | Start a clan (a real chat-channel) |
| `::dmrecruit` | clan leaders | Up to 10 unclanned bots within 20 tiles join |
| `::dmstart [bots]` | owner | Open a lobby, or skip the countdown |
| `::dmstop` | owner | Call it off: everyone's items back, no shutdown |
| `::dmskip` | owner | Straight to the bracket |
| `::dmkill <n>` | owner | n random bots out |
| `::dmbots <n>` | owner | Bots for this or the next lobby |
| `::dmboss [name]` | owner | Spawn a boss now |
| `::dmstatus` | owner | Phase, alive, fog, tick timing |
| `::rs [seconds]` | owner | Restart the server (`RestartServer.plugin.js`) |

Tick timing is logged every 100 ticks to `logs/deadman-tournament.log`. This is the load test.

## Changes outside the plugin

- `plugins/bots/runtime/BotLooting.PlayerBots.js` and
  `plugins/bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots.js`: a bot with
  `player-bots:fixed-loadout` keeps its floor loot and gets no generated re-gear.
- `plugins/bots/runtime/Registry.PlayerBots.js`: `pauseRegionalWilderness(key, paused)` pauses the
  regional Wilderness roamers.
- `plugins/commands/RestartServer.plugin.js`: `::rs`.
- `data/definitions/world.json`: the `pluginConfig` above.
- Root `.env` (this copy only): its own ports (client 3101, game 43701, agent MCP 49801).

## Sources

- [OSRS Wiki: Deadman Arenas](https://oldschool.runescape.wiki/w/Deadman_Arenas) and
  [Deadman: All Stars Season 2](https://oldschool.runescape.wiki/w/Deadman:_All_Stars_Season_2).
- Cache (rev 241): the arena's placements via `yarn dump:loc`; item and NPC ids checked against
  the cache at startup.
- Everything else (timings, damage, odds) is this server's own design.
