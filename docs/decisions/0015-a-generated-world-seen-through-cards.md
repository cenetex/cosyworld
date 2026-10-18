# ADR 0015: a generated world, seen through cards

- Status: Accepted
- Date: 2026-10-18
- Decision owners: CosyWorld maintainers
- Related: #1051, #1052, #1054, #1055, #1056, #1061, #1062, ADR 0001, ADR 0002,
  ADR 0003, ADR 0005, ADR 0009, ADR 0011, ADR 0013, ADR 001

## Context

The card table in `v2/card-game/` is the first CosyWorld surface that plays
well. Since #1056 it is the root page on both Fly apps. The shared-world client
remains at `/classic`.

The table is a prototype. Its first site, three places, three avatars, and four
items, was generated as scaffolding. So were its item powers (lamp fuel, oil,
cloth, bell), the light-gated path between the attic and the pond, its authored
quest programs, and its opening. About 500 of its 1,200 rule lines serve that
script. The rest is general: custody, reach, take, give, ask, trade, travel,
target hands, consent from goals, a cast planner, and a quest generator.

The general part is why the table plays well. Every avatar wants a hand of real
things. Those wants overlap on a few objects, so avatars trade, and the cast
pursues its wants by the same rules as the player. None of that needs a lamp or
an authored quest. Scripted mechanics also do not scale: each site would need
new code, new kernel action codes, and new tests.

The shared runtime already holds pieces of a living world: generated pathways
and places, settlements, loot rolls, discovery slots, lifecycle hooks with claim
keys, resident desires, and a world pulse caused by play. Nothing there creates
a place, an item, or a resident when a condition holds.

## Decision

### The core is a world players live in

CosyWorld's core is one shared, persistent world. It grows from general rules
and deterministic generators, not from authored puzzles. A player lives there
through an avatar, alongside residents who follow the same rules.

### The card table is how a player sees the world

A card is a view of one persistent avatar, item, or place. The table shows every
card the player's avatar can reach now. One card or a pair resolves to one
offer. The table is the interface to the core, not a separate game, and
`/classic` remains a second interface until the table can replace it.

### Story is an optional layer

Authored quests, item powers, and set-piece sites are pack content layered on
top of the core. A world must play without them. The core never depends on a
named entity, and no rule special-cases one.

### Design pillars

1. **Every play moves a visible fact.** A play changes a place, a holder, or a
   condition, and the scene says so.
2. **Wants are hands of real things.** A goal is Hold these items, At this
   place, With these avatars, over entities the avatar can see or reach.
3. **Wants overlap.** Generated goals name nearby items and avatars, including
   players, so goals meet and trades follow.
4. **One rule path for everyone.** Players and residents share reach, consent,
   capacity, and exchange. No avatar is special to the rules.
5. **Generators, not scripts.** New goals, places, items, and residents come from
   deterministic generators over pack vocabularies.
6. **Play drives the world.** Nothing changes without a cause in play. A quiet
   world is still.
7. **A refusal teaches.** An avatar says what it wants and what it offers.

### The core vocabulary

| Term        | Meaning                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| entity      | A persistent avatar, item, or place with a stable id, tags, and history.          |
| card        | A view of one entity.                                                             |
| table       | The row of every card an avatar can reach now.                                    |
| pair        | Two raised cards that resolve to one offer.                                       |
| play        | One certified act. It commits, then residents in that place act.                  |
| target hand | A goal: Hold these items, At this place, With these avatars.                      |
| quest       | An ordered list of target hands, made by the quest generator or authored content. |
| level       | Earned once per completed quest.                                                  |
| resident    | An avatar no person controls. It plans with the same offers as players.           |
| spawn rule  | Pack data: when a condition holds in play, create one entity once.                |

"Action hand" names the `/classic` surface only. New documents say "table" for
the row and "target hand" for a goal.

### Core verbs

The rules offer travel, take, put down, give, ask, trade, talk, and wait. Any
avatar can threaten another over an item, which opens a standoff with guard and
attack (#1073). Ask, give, and trade need the other avatar's consent. Consent comes from that
avatar's current goals: it keeps what its goals need and offers its spares.
Trades are atomic two-holder swaps. New verbs need a general rule over tags,
never a rule for one entity.

### Generators

- **Quests.** Every avatar's next goal comes from the quest generator. It reads
  nearby entities, their holders, and other avatars' wants. It builds hands that
  overlap with those wants and avoids hands that would deadlock them. #1062
  added the first liveness rules.
- **Spawn rules.** A place's pack data can declare rules from a closed set of
  triggers and effects. Triggers include a quest completed here, an item brought
  here, and repeated visits. Effects open a new place off this one, add an item
  from a table, or bring a resident with a fresh goal. A rule has a claim key,
  fires once per key, and records its seed and output.
- **Text.** AI writes bounded descriptions and dialogue through
  `POST /card-game/text`. It never chooses a spawn, a goal, or a change of
  custody.

Spawn rules follow the existing constraints:
- play causes every spawn (ADR 0011);
- background work never changes sanctuary (ENG invariant 7);
- generated places last for the current world (ADR 0013);
- spawned ids follow ADR 0003;
- each spawned item declares a use it adds.

### Authority while the table is local

The table still runs as a deterministic JavaScript model with localStorage
saves. The JavaScript model is the reference behavior while the core rules
settle. New general rules land there with tests in `test/card-*.test.mjs`. A
browser save, including a named `?table=` slot, is a non-canonical installation
under ADR 0003's self-hosted clause, with no accounts, currency, or rewards.

Anything shared, multiplayer, persisted on the server, or reward-bearing crosses
the C kernel and the journal before it ships. Such a change ports the rule with
parity tests in the same change.

### Path to the shared world

[Generated world core](../backlog/generated-world-core.md) holds the plan. In
summary:

1. Make the prototype general:
   - entity registries live in the world state;
   - the scripted site moves to data;
   - no rule names an entity;
   - more than one player avatar can act.
2. Add spawn rules and measure whether the world stays alive and keeps growing.
3. Record a golden trace of the general rules as the parity oracle.
4. Port the general rules into the kernel, with actions that create places,
   exits, items, and residents, and a plan for its fixed capacities.
5. Serve the table from the shared runtime and retire the local save.

## Disposition of earlier decisions

| ADR  | Disposition                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0001 | Keep as superseded. Its surviving rule (a card presents an entity) is restated here.             |
| 0002 | Superseded for the card table. Remains the `/classic` contract.                                  |
| 0003 | Keep. Local tables are non-canonical installations. The shared world must satisfy it.            |
| 0004 | Classic-scoped.                                                                                  |
| 0005 | Keep. Gates and stocking are general tag rules a site can use, not core requirements.            |
| 0006 | Keep. A linked avatar enters the world as an avatar with generated goals.                        |
| 0007 | Keep. Item devices are optional content over tags.                                               |
| 0008 | Keep. Quests, completions, levels, and spawns land as declared-write projection mutations.       |
| 0009 | Keep. A quest is a solo Venture. "With" proves co-presence, not membership.                      |
| 0010 | Keep.                                                                                            |
| 0011 | Keep. Generated quests and spawns are deterministic rules output, never batch-minted state.      |
| 0012 | Keep. Talking to an avatar card is talk, not Notice.                                             |
| 0013 | Keep. Spawned places last for the current world.                                                 |
| 0014 | Keep. A level-up is not a voice refresh trigger until the world is shared.                       |
| 001  | Superseded as the table's action substrate. Its entity and item model and code rule stand.       |

## Consequences

- The prototype's scripted site is scaffolding. Work that deepens it (new item
  powers, new authored quests, fuel balance) is out of scope for the core.
- `CLAUDE.md`, `ENG.md`, `readme.md`, `v2/README.md`, and `docs/index.md` name
  the card table as the interface and the generated world as the core.
- Kernel plans name general actions (create an entity, consented exchange,
  quest capture), never per-item action codes.
- The table needs its own gates: register checks on its copy and a browser smoke
  in `./v2/mvp.sh check`.

## Acceptance for the shared world

- A new world with no authored quests plays: every avatar gets goals, trades
  happen, and some avatar progresses within a bounded number of plays.
- Spawn rules grow the world through play and replay to the same entities.
- Two players at one place see the same custody, and resident trades commit
  atomically.
- The world replays from the journal and round-trips through a snapshot.
- AI never changes custody, goals, or spawns outside a certified offer.
- The JavaScript golden trace replays to the same digest in C.
