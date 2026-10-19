# Generated world core

Status: **Planning**. Law: [ADR 0015](../decisions/0015-a-generated-world-seen-through-cards.md).
Prototype design: [Avatars, items, and locations](../design/avatar-simulation-redesign.md).

CosyWorld's core is a world players live in, built from general rules and
generators and seen through the card table. This document plans how the card
prototype becomes that core and then moves into the shared runtime.

## Starting facts

The prototype (`v2/card-game/`, surveyed 2026-10-18 at 1.0.226):

- **General rules, about 700 lines.** Holder chains, reach, take, put down,
  give, ask, trade, travel, talk, target hands (`hold`, `at`, `withAvatars`,
  `sequence`, `either`), consent from goals (`needed`, `willingToGive`,
  `canTrade`), the cast planner `plan()`, the generator `generateProgram`,
  levels, and stall refresh.
- **Scripted site, about 500 lines.** The three places, three avatars, and four
  items, the opening, the authored `questPrograms` and `restingHands`, and the
  powers: lamp fuel, oil refills, the bell, the cloth cover, and the light-gated
  attic–pond path. Planner branches, card hints, the validator, and most tests
  name these entities.
- **Fixed entity sets.** `ids` and `actorIds` are computed when the module
  loads. `validateWorld` requires exactly those keys, so nothing can be created
  during play.
- **One player.** Only Vale plays. `accepts`, `willingToGive`, `canTrade`, and
  `valeStalled` special-case Vale, and the generator favours Vale's items.
- **Text only from AI.** `POST /card-game/text` writes descriptions and
  dialogue (#1061, #1066, #1068, #1070, #1071). Card plays decide changes.
- **Deterministic.** The rules use no randomness, clock, or network, so the
  model can serve as an exact oracle.

The shared runtime (origin/main, 865aa2e6):

- **Generated topology exists.** Journeys create waypoint places between
  existing anchors, and revealed waypoints become generated places with clocks,
  settlements, and jobs. Packs opt in through `x-cosyworld-generation`.
- **Conditions exist, spawns do not.** Lifecycle hooks (`on_enter`, `on_use`,
  `on_give`, `on_clock_fill`, and others) carry claim scopes and effects. No
  effect creates an entity. Discovery slots materialize only authored hidden
  items. The `resident_arrivals` building capability has no behavior behind it.
- **No kernel action creates a place, exit, or resident.** `CREATE_ACTOR` makes
  only a human. Rust writes generated places into the kernel directly and
  silently skips them when an array is full.
- **Fixed capacity.** The kernel holds at most 2,048 actors, items, and places
  and 4,096 exits, compiled into the ABI.
- **Goals are not general.** Resident desires are authored item lists, goals are
  prose, and the typed drive grammar in `residents/drives.rs` is not wired in.
- **Residents already act after players.** Resident acts run as actor jobs after
  a player tick, which matches "play drives the world".

## Phase 1: make the prototype general

One PR, no new mechanics. When it lands, the rules name no entity.

- **Registries in state.** `s.places`, `s.avatars`, and `s.items` hold every
  entity with its id, name, text, tags, and exits. The validator checks ids
  against those registries. Saves migrate.
- **The site becomes data.** A seed file describes the starting places,
  avatars, and items. `createWorld(seed)` builds a world from it.
- **Remove the scripted layer.** Lamp fuel, oil, the bell, the cloth cover, the
  light-gated path, the authored programs, and the resting hands leave the core.
  Every goal comes from the generator. The four objects stay as plain items in
  the seed.
- **Players are a role.** Any avatar can be a player. The consent rules treat
  players the same way: a player can always accept, and offers to a player still
  need the player's play. `valeStalled` becomes a stall rule for every avatar.
- **Turns are local.** A play gives one act to each resident within reach of
  the acting player and leaves the rest of the world still.
- **Tests follow.** Scripted route tests are replaced by property tests over
  random seeds: liveness, consent, custody conservation, determinism, and save
  round trips.

## Phase 2: growth through quests

The world grows only as a quest reward. The full model is in ADR 0015,
"Generators". In short:

| Source                     | Creates | How                                                    |
| -------------------------- | ------- | ------------------------------------------------------ |
| A place's quest            | Item    | Put the asked items down at a place with `makes`.      |
| A doorway step             | Place   | Carry a made key to a place with `beyond`.             |
| A long-abandoned player    | Avatar  | It goes on alone as a resident. The player can reclaim. |

Rules for all growth:

- Every reward is promised first as a latent entity, so quests can require it.
  From level 3, some goals ask for what a place will make next. Some goals open
  a doorway, then carry the key through it.
- Each make and each doorway has a claim key and happens once.
- Promises use reserved ids and seeded table rows, so replay creates the same
  entities.
- Growth happens only at a place where a play happened. A quiet world never
  grows.
- A world budget allows one new item or place for every set number of levels
  gained across the world, under a hard cap.
- A place opens no doorway once it has three exits. Each make asks for more
  inputs.

Measure with headless play over many seeds and player mixes:

- No world freezes, and every avatar progresses within a bounded number of plays.
- The world grows slowly. The shore goes from 3 places to about 9 in 600 solo
  plays, and to about 22 in 2,000.
- Trades and asks between avatars stay frequent as the world grows.
- Levels slow as quests deepen. This is still open; see loop health.

## Phase 2b: many players

Built in the card core after phase 2. The decisions are in ADR 0015, "Many
players share one world":

- residents keep one player's pace;
- plays are checked against the world as they arrive;
- players swap by offer and acceptance;
- a threatened player answers before anyone strikes;
- absent players sleep;
- players join a running world;
- stalls count an avatar's own acts.

Measure with four players on uneven schedules over long runs:

- Each player levels with its own plays, at about the same rate per play.
- A player who rests keeps every item until it plays again.
- Replays are exact.

Still to decide: whether fighting between players needs an opt-in or a
sanctuary rule, and how rankings and seasons work across one world's life.

## Loop health carried over

The 2026-10-17 review found five problems. The first, contested goals, was fixed
by #1062. The light problem was a scripted-site problem and leaves with that
site. Three remain, and growth makes each one larger:

1. **Levels come too fast.** A generated quest completes about every three
   turns. Scale quests with level: more steps, farther places, and payments that
   pass through a third avatar.
2. **Residents need a player to start and later ignore the player.** Generated
   goals should keep naming nearby player-held items and meetings with players,
   and some resident goals must be finishable without a player.
3. **Asks and waits are dead weight.** Offer Ask only when the holder would
   agree, or fold it into Talk. Let waiting for a companion skip ahead. Rank
   cards by relevance to visible goals as the table grows.

## Phase 3: golden trace

`play()` returns the ordered sub-actions it applied, and a pure state digest
covers the world. A checked-in trace of long seeded runs, including growth,
fails a Vitest when it goes stale. #1063 tracks this. It should follow phase 1,
so the oracle records general rules instead of the scripted site.

## Phase 4: the shared runtime

Each step is one PR that updates the kernel header, C, C tests, the FFI, replay
mapping, and Rust integration tests together. New action codes start after
`ACCOMPANY_MOVE` (42). Existing codes keep their meaning.

1. **Create entities.** Kernel actions create a place, an exit, an item, and a
   resident. Ids come from the existing namespaces. A full array fails loudly.
   Decide how the world grows past the fixed capacities before shipping growth.
2. **Consented exchange.** Ask, give, and trade with consent derived from goals,
   as new codes beside `GIVE_ITEM` and `TRADE_ITEM`.
3. **Quests in the kernel.** Target hands, capture, advance, and levels. An
   assign-quest action installs a generated quest, so replay never re-runs the
   generator.
4. **Growth tables in packs.** Places declare `makes` and `beyond` tables in a
   closed-vocabulary resource. The compiler rejects unknown fields and resolves
   every table. Generated places reuse the `x-cosyworld-generation`
   policy.
5. **Residents as proposers.** Rust runs the planner and generator and journals
   each resident act and each assigned quest as its own action. The planner
   matches `plan()` on trace states.

## Phase 5: serve the table from the runtime

The table reads server offers and SSE, and the local save retires. `world.mjs`
keeps projection and offer helpers only. An end-to-end smoke covers two players
at one place.

## Story mode

Authored quests, item powers, and set-piece sites can return as an optional pack
layer once the core plays without them. A story pack adds tagged rules and
authored quests over the same verbs. It never adds a rule that names an entity
to the core.

## Open questions

- How phase 2b's offers map onto the pending offers in
  [transfer consent](../transfer-consent.md), and its pace rule onto the
  [scene concurrency policy](../concurrency-policy.md).
- Whether places, items, or residents ever leave the world, and how history
  survives that.
- Where generated places get art: pack pools, generated images, or plain cards.
- How a local save maps to a server avatar, if at all.
