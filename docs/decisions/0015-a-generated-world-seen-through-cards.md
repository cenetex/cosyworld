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

| Term        | Meaning                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| entity      | A persistent avatar, item, or place with a stable id, tags, and history.             |
| card        | A view of one entity.                                                                |
| table       | The row of every card an avatar can reach now.                                       |
| pair        | Two raised cards that resolve to one offer.                                          |
| play        | One certified act. It commits, then residents within reach act.                      |
| target hand | A goal: Hold these items, At this place, With these avatars.                         |
| quest       | An ordered list of target hands, made by the quest generator or authored content.    |
| XP, level   | A quest's XP is fixed when it is made. XP only goes up; each level needs more.       |
| resident    | An avatar no person controls. It plans with the same offers as players.              |
| promise     | A latent item or place a quest will create. Other quests may require it first.       |
| knowledge   | What one avatar has seen: places visited, and recent sightings of items and avatars. |
| clue        | For a goal's unseen target, the known place nearest to it.                           |

"Action hand" names the `/classic` surface only. New documents say "table" for
the row and "target hand" for a goal.

### Core verbs

The rules offer travel, take, put down, give, ask, trade, talk, search, and
wait. Talk also trades news, and search finds hidden items. Any
avatar can threaten another over an item, which opens a standoff with guard and
attack (#1073). Ask, give, and trade need the other avatar's consent. Consent comes from that
avatar's current goals: it keeps what its goals need and offers its spares.
Trades are atomic two-holder swaps. New verbs need a general rule over tags,
never a rule for one entity.

### Every avatar finds the world out

The world is not an open book to anyone, players or residents:

- **Knowledge.** Each avatar knows only what it has seen: the places it has
  visited and their ways out, and where it last saw items and avatars. Places
  are never forgotten. Sightings of items and avatars fade after a while.
  Knowledge is saved state, so replays agree.
- **Residents plan from knowledge, not from the world.** A resident routes only
  over places it knows. It looks for an item where it last saw it. When it does
  not know, it asks whoever is there, searches, follows its quest's clue, and
  explores. Residents are fair rivals and can be wrong.
- **Hidden items.** An item can lie hidden in a place. Only an avatar that
  searches there sees it, until someone picks it up. Seeds and tables can hide
  items, and a newly opened place hides one find.
- **Discovery pays.** A first visit to a place earns XP. The first avatar ever
  to stand in a place earns more and is remembered as its finder. Each hidden
  find earns XP.
- **Quests give clues.** A goal names only what its avatar has seen. Anything
  else is told by a clue: "something near the pond", "a place past the signal
  box", "what the forge makes next". Goals lean toward unseen things. From level
  2, every fourth goal follows a rumor of an unseen item anywhere in the world.
- **Talk shares news.** Talking shares every place both avatars have been and
  only recent sightings, so old knowledge stays private.

### Many players share one world

Solo play is the shared world with one player. The same rules serve any number
of players:

- **Residents keep one player's pace.** A resident acts once for every play by
  each awake player within reach. Three players near one resident do not make
  it act three times as often.
- **Plays are checked as they arrive.** The rules check a play against the world
  when it is applied, not against the revision the player last saw. Another
  player's move refuses a play only when it is no longer legal.
- **Players exchange by consent.** Players swap items by an offer and an
  acceptance, two plays. An offer lapses when either player leaves, either item
  moves, or it grows old. Gifts need no answer.
- **A threatened player answers first.** No one can attack a player that has not
  answered a threat. An unanswered standoff ends after a set number of turns,
  with nothing lost.
- **Absent players sleep.** The runtime journals a rest when a session ends. A
  sleeping avatar keeps its place and items. No one can threaten, ask, or trade
  with it, and new goals leave its items alone. It wakes when it plays. After a
  long absence it goes on alone as a resident; see Generators.
- **Players join a running world.** A new player arrives at a place with a
  generated goal.
- **Stalls count an avatar's own acts,** so a crowded world does not age one
  avatar's goal faster than another's.

### Generators

- **Quests.** Every avatar's next goal comes from the quest generator. It reads
  nearby entities, their holders, and other avatars' wants. It builds hands that
  overlap with those wants and avoids hands that would deadlock them. #1062
  added the first liveness rules.
- **Growth through quests.** The world grows only as a quest reward, and each
  kind of entity has one source:
  - **Places make items.** A place with a `makes` table has a quest of its own:
    put these items down here. When they are all here, it makes a new item from
    that table. The inputs stay, so anyone present can take them back or race
    for the new item. Each make asks for more inputs.
  - **Avatars open doorways.** A step of an avatar's quest can open a doorway
    from a place with a `beyond` table to a new place. The key is an item some
    place made, so new places follow new items.
  - **Abandoned players become residents.** A player asleep for a long time goes
    on alone as an autonomous resident. This is the only source of new avatars.
    The runtime can hand the avatar back to its player.
- **Promises.** Each reward exists before it is earned, as a latent item with no
  holder or a latent place with no exits. Other quests can require a promise:
  bring the item the forge will make, or carry a key through a doorway that does
  not exist yet. So requirements chain recursively, and the chains deepen with
  level.
- **XP and levels.** A quest is worth XP for each hand, each item it asks for,
  and each step of travel, plus a bonus when it asks for an item not yet made or
  opens a doorway. Its XP is fixed when the quest is made. XP only goes up:
  nothing takes it away, not a fight and not a season. Level n needs n times a
  set amount more XP to reach level n + 1, and quests grow with level: from
  level 4 they go to the farthest places in reach, and from level 5 they carry
  more items. So early levels come quickly and later ones slowly.
- **A budget follows XP.** Each new item or place needs a set amount of XP
  earned across the world, so the world grows slowly, as its avatars grow,
  faster with more players, and more for bigger quests.
- **Text.** AI writes bounded descriptions and dialogue through
  `POST /card-game/text`. It never chooses a reward, a goal, or a change of
  custody.

Growth follows the existing constraints:

- play causes every new entity (ADR 0011);
- background work never changes sanctuary (ENG invariant 7);
- generated places last for the current world (ADR 0013);
- generated ids follow ADR 0003;
- claim keys make every make and every doorway happen once.

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
2. Grow the world through quest rewards and measure whether it stays alive and
   keeps growing.
3. Record a golden trace of the general rules as the parity oracle.
4. Port the general rules into the kernel, with actions that create places,
   exits, items, and residents, and a plan for its fixed capacities.
5. Serve the table from the shared runtime and retire the local save.

## Disposition of earlier decisions

| ADR  | Disposition                                                                                 |
| ---- | ------------------------------------------------------------------------------------------- |
| 0001 | Keep as superseded. Its surviving rule (a card presents an entity) is restated here.        |
| 0002 | Superseded for the card table. Remains the `/classic` contract.                             |
| 0003 | Keep. Local tables are non-canonical installations. The shared world must satisfy it.       |
| 0004 | Classic-scoped.                                                                             |
| 0005 | Keep. Gates and stocking are general tag rules a site can use, not core requirements.       |
| 0006 | Keep. A linked avatar enters the world as an avatar with generated goals.                   |
| 0007 | Keep. Item devices are optional content over tags.                                          |
| 0008 | Keep. Quests, completions, levels, and growth land as declared-write projection mutations.  |
| 0009 | Keep. A quest is a solo Venture. "With" proves co-presence, not membership.                 |
| 0010 | Keep.                                                                                       |
| 0011 | Keep. Generated quests and growth are deterministic rules output, never batch-minted state. |
| 0012 | Keep. Talking to an avatar card is talk, not Notice.                                        |
| 0013 | Keep. Generated places last for the current world.                                          |
| 0014 | Keep. A level-up is not a voice refresh trigger until the world is shared.                  |
| 001  | Superseded as the table's action substrate. Its entity and item model and code rule stand.  |

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
- Quest rewards grow the world through play and replay to the same entities.
- Two players at one place see the same custody, and resident trades commit
  atomically.
- The world replays from the journal and round-trips through a snapshot.
- AI never changes custody, goals, or growth outside a certified offer.
- The JavaScript golden trace replays to the same digest in C.
