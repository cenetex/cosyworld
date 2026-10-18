# The Shared Card Table

Status: **Planning**. Law: [ADR 0015](../decisions/0015-card-table-is-the-primary-play-loop.md).
Design: [Avatars, items, and locations](../design/avatar-simulation-redesign.md).

The reflected shore runs as a deterministic JavaScript model in the browser.
This document plans how its rules move into the shared runtime so several
players can sit at one table.

## Starting facts

- The card model uses no randomness, clock, or network. `generateProgram`
  rotates on the program index, and `plan()` is a fixed heuristic. The JS model
  can serve as an exact oracle.
- `play(s, action, expectedRevision)` already behaves like ADR 0002's offer
  certificate: an exact action key against a state revision.
- `cards.rs` already projects avatar, item, and location noun cards with
  `offer_ids` and a `state_revision`. Its ranked three-slot story hand differs
  from the table, which shows every reachable card.
- `card_policy_objective.rs` holds one hidden "Hold X" goal per resident. Target
  hands generalize it, and its commit path is where the cast planner plugs in.

## Loop health before scale

A headless review on 2026-10-17 (1.0.220) played the table with the cast
planner, seeded random card plays, and mixes of the two. The core loop holds:
the opening route reaches level 3 in 11 plays, about nine meaningful plays are
available per turn under the planner, and the cast changes the player's options
on about half of all turns. Five problems appear as play runs long. Each grows
with more avatars and items, so fix them before the port or a second site.

1. **Contested goals softlock the world.** Generated programs can give Pip and
   the keeper mirrored needs: each holds one item the other needs and keeps it
   because its own goal needs it. The stall revision picks the same pair again.
   Two cast members can also each wait for the other at different places. Vale
   keeps its program until it completes, so the player locks too. After 600
   turns, no progress was reachable within ten plays in 10 of 30 runs at a 50%
   planner mix, 19 of 30 under random play, and none under the planner alone.
   - Reject a generated hand whose missing items are needed by an actor who
     needs ours. The stall revision drops contested items and companions.
   - Add a liveness test: from any reachable state, someone progresses within N
     plays.
   - Give Vale a way to set a program aside.
2. **Light runs out for good.** Lamp fuel and oil reached zero in every
   600-turn run, closing the reflected path. The cast lights the lamp whenever
   it holds it, even when no goal needs light. Give each consumable a renewal
   source in play, and light only for a goal.
3. **Levels come too fast.** Under the planner a generated program completes
   about every three turns. Under random play the cast passes level 80 while
   Vale stays at level 1. Scale programs with level: more steps, farther places,
   and payments that pass through a third avatar.
4. **The cast needs the player to start and ignores the player later.** With
   Vale only waiting, nobody completes a hand in 400 turns. Later, cast goals
   stop touching Vale. Seed one cast program the cast can finish alone, and keep
   generated cast goals touching a Vale-held item or a meeting with Vale.
5. **Asks and waits are dead weight.** One ask in 47 succeeded under the
   planner, and the planner waits on 49% of turns. Offer Ask only when the
   holder would agree, or fold it into Talk. Let waiting for a companion skip
   ahead. As cards grow, rank them by relevance to visible goals.

## Mutation inventory

Kernel action codes are in `v2/core-c/cosy_kernel.h`. NEW means no equivalent.

| Card mutation                      | Kernel today                  | Gap                                                        |
| ---------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| move along an exit                 | `CW_ACTION_MOVE`              | None.                                                      |
| move through the reflection        | MOVE plus a gated exit        | NEW predicate: a lit, uncovered lamp at either end.        |
| take                               | `PICK_UP_ITEM`                | Uncover-and-take is NEW.                                   |
| put down                           | `DROP_ITEM`                   | A covered bundle must move together.                       |
| give                               | `GIVE_ITEM`                   | Recipient consent is NEW. Bundles are refused today.       |
| ask                                | none                          | NEW consented transfer gated by the holder's goals.        |
| trade                              | `TRADE_ITEM`                  | Consent and slot capacity are NEW. Weight rules differ.    |
| light, snuff, ring, refill, cover  | none                          | NEW. Item state needs a side table.                        |
| lamp burn, bell decay              | none                          | NEW round-end tick.                                        |
| quest step, level, program         | evolution tracks (unrelated)  | NEW. Do not reinterpret evolution tracks.                  |
| talk                               | `SAY` at most                 | No rule state. Rust only.                                  |
| item history, log                  | not kernel state              | Rust projection from events.                               |

New codes start after `ACCOMPANY_MOVE` (42). `GIVE_ITEM` and `TRADE_ITEM` keep
their meaning; consented variants get new codes.

## Ownership

- **C:** custody bundles, slot capacity, item state (lit, fuel, ringing),
  the reflection gate, consent derived from goals, quest capture and advance,
  levels, and validation of an installed program.
- **Rust:** the cast planner and program generator as bounded proposers. Each
  cast act and each generated program is journaled as its own action, so replay
  never re-runs the planner and a planner change cannot rewrite history. Names,
  lines, and history are projections.

## Phases

Each phase is one PR. Kernel phases update the header, C, C tests, the FFI
constants, replay mapping, and Rust integration tests together.

1. **Golden trace.** Refactor `play()` to return the ordered sub-actions it
   applied and add a pure state digest. Check in a trace from the 4,000-turn run
   and the quest-program runs. A Vitest fails when the fixture is stale. No
   behavior change.
2. **Kernel custody and item state.** Side table, bundle-aware custody, light,
   snuff, ring, refill, cover, uncover-take, round-end, and the reflection gate.
   A C test replays the custody part of the trace.
3. **Kernel quests and consent.** Program tracks, desire selection, capture,
   advance, levels, an assign-program action, and consented give, ask, and trade.
   C replays the whole trace and compares digests every turn.
4. **Rust runtime.** A source pack for the site, FFI, journal and snapshot round
   trips, the planner and generator as proposers, and pair-to-offer resolution.
   Rust tests match `plan()` and `generateProgram` on trace states.
5. **Client cut-over.** The table reads server offers and SSE, the local save
   retires, and `world.mjs` keeps projection and offer helpers only. An
   end-to-end smoke covers two players at one table.

## Card sites as pack data

Today the site is hardcoded in `world.mjs`. Packs already express places, exits,
people, items, item desires, and art. Two things have no home: item powers and
quest programs.

A new optional pack resource, `card_sites.json`, references stable pack ids and
holds no logic:

- `power.kind` from a closed set: `light_source`, `fuel`, `sound`, `cover`.
- reveals such as `light_at_either_end` between two locations.
- cast start places, start holders, resting hands, and authored programs.
- generation settings: first generated level and stall turns.
- backdrop and cutout bindings, with transparent cutouts.

The compiler rejects unknown fields, resolves every id within the selected
packs, checks starting loads, and runs copy through `writingRegisterErrors`.
The power vocabulary grows only through new kernel action codes.

The second site should be Ruby High: First Bell. It has six locations, nine
actors with item desires, and existing art. Its goals need At and With parts
authored.

## Open questions

- The model hardcodes Vale as the only player. A shared table needs a rule for
  which avatars humans control and how the cast treats each of them.
- "Each play gives the cast one act" must be restated per partition when several
  players act at once. See [Scene concurrency policy](../concurrency-policy.md).
- Human-to-human trades use the pending offers in
  [transfer consent](../transfer-consent.md). Cast consent stays rule-based.
- How a local save maps to a server actor, if at all.
