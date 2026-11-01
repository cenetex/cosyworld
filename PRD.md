# CosyWorld product

The current product is a world played through cards, with local saves and shared
worlds. The player chooses an avatar, handles items, travels, meets residents,
and pursues collected quests. Residents use the same world rules.

## Current experience

The reflected shore connects to the Steam Clock and the Wine-Dark Sea. Shared
worlds add eight human avatars and their homes. Character identity comes from
the current catalogs described in the [source map](docs/current-game.md).

Cards show reachable people, things, and places. Selecting cards reveals legal
actions. A committed action changes the saved world. Dialogue follows those
changes. Possession, shared journeys, quest progress, discoveries, and chosen
story accounts survive reload and shared-world replay.

Sharing imports the local world into the authenticated shared service. Each
person claims an available avatar. Room queues and presence keep shared play
ordered. The [shared-world guide](v2/docs/card-table/shared-worlds.md) describes
claims, saves, queues, and upgrades.

## Product principles

- Make each card an honest view of a person, thing, place, or quest.
- Let wants, belongings, encounters, and consequences produce the story.
- Keep character speech grounded in the completed action and its history.
- Give players time to read, browse, and choose.
- Preserve saved progress and each world's accepted history.

## What we avoid

These rules apply to every pack and feature. The
[later ideas](docs/design/later-ideas-from-other-games.md) note records where
they came from.

- **No penalty for absence.** No streaks, daily logins, withering crops,
  residents who leave, relationship decay, guilt messages or pull
  notifications. A world waits for its players.
- **No single good/evil meter.** What residents think of you comes from what
  they witnessed, one person at a time.
- **No paid reputation resets, real-money items or auction house.**
- **No loot floods, stat affixes or pity timers.** Rarity is the level system:
  avatars, items and places level up.
- **No hand-written evolution chains or scripted moral set-pieces.** Growth
  comes from generic rules and wants met.
- **No one-time events.** A festival recurs; a scene that happens once and is
  gone is not built.
- **No trade-only gates for solo players.** Anything another world or player
  can bring must also have a path a solo player can find.

Use the [card guide](v2/card-game/README.md) for current behavior and GitHub
issues for proposed work. Earlier plans are in the
[planning archive](docs/archive/backlog/README.md). Earlier product
requirements are preserved in the [classic archive](docs/archive/classic/PRD.md).
