# CosyWorld product

The current product is a world played through cards, with local saves and shared
worlds. The player chooses an avatar, handles items, travels, meets residents,
and pursues collected quests. Residents use the same world rules.

## Vision

The game's arc is that relationships deepen over time. There is no plot ending.
Big content, such as the Odyssey return and Troy, adds places to go, not finish
lines. A world is worth returning to because the people in it know you better
each time.

The pillars, as agreed with the owner (2026-11-04):

- **The rules own the world; AI only talks.** Every outcome is a rule. A
  character influences the world only by persuading a player.
- **Characters remember what you did, not what you said.** Memory comes from
  committed acts: gifts, refusals, threats, fights, help. Speech never creates an
  obligation.
- **A living world with wants, not quests.** Each avatar wants something, and
  growth comes from wants met.
- **Now, not a log.** Screens and character context show the present. Recalling
  the past is a deliberate choice.
- **Worlds as modules.** Each world pack declares its entries to Black pond or
  to another pack, and can be switched on or off.
- **Many minds.** Any model can voice any character.
- **A cosy-uncanny threshold.** Warm on the surface, strange underneath.
- **Open by design.** Packs, models and code stay open to contributors.

How deepening shows is still being designed. It should show without a log or
text on cards: in what characters say when you meet again, in how they greet
you, and in what they offer, ask or refuse.

Still open: whether solo or shared play is the heart of the game, who writes
worlds, and whether players should notice which model voices a character.

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
