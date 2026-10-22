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
- A world budget allows one new item or place for every set amount of XP
  earned across the world, under a hard cap.
- A place opens no doorway once it has three exits. Each make asks for more
  inputs.

Measure with headless play over many seeds and player mixes:

- No world freezes, and every avatar progresses within a bounded number of plays.
- The world grows slowly. The shore goes from 3 places to about 12 in 600 solo
  plays, and to about 23 in 2,000.
- Trades and asks between avatars stay frequent as the world grows.
- Levels slow as quests deepen. A solo player on the shore reaches about level
  10 in 600 plays and level 19 in 2,000, and gains fewer levels in each later
  stretch of play. Before XP, it reached level 62 and level 178.

## Phase 2c: mystery

Built in the card core. The decisions are in ADR 0015, "Every avatar finds the
world out". Measured on the shore with three players over 900 plays:

- Before, every avatar planned with the whole world. Only 3% of quest targets
  were unseen when set, and no one ever searched.
- Now about 47% of quests send an avatar after something it has not seen, with
  a clue. Residents explore, ask, and search: about 150 searches and 160 talks.
- Pace and growth hold: a solo player reaches level 9 to 10 in 600 plays.

Still to decide: whether knowing another avatar's wants also needs talk. Today
residents still read wants directly.

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

- Each player finishes quests with its own plays, at about the same rate per
  play.
- A player who rests keeps every item until it plays again.
- Replays are exact.

Still to decide: whether fighting between players needs an opt-in or a
sanctuary rule, and how rankings work across one world's life. XP only goes up,
so a season can rank XP earned within it but never resets it.

## Loop health carried over

The 2026-10-17 review found five problems. The first, contested goals, was fixed
by #1062. The light problem was a scripted-site problem and leaves with that
site. Three remain, and growth makes each one larger:

1. **Levels came too fast.** Fixed by XP: quests are worth XP by size, each
   level needs more, and quests go farther and carry more with level. Payments
   that pass through a third avatar are still to try.
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

## Living between quests

Status: **Planning**, proposed 2026-10-21 from a design review. Nothing here
is built. It answers three proposals under "Card-table Direction Under Review"
in the [PRD](../../PRD.md): a fulfilled phase, rewards for meaningful novelty,
and a quest cadence.

Today a finished quest is replaced at once: `advanceQuests` clears the quest
and `ensureQuests` generates the next one in the same round. Avatars never sit
with what they won. The proposal is a rhythm of **living, finding a purpose,
pursuing it, and enjoying the result**, so a quest becomes a purpose the avatar
finds through play: "I helped you, we spent time together, and now I know what
I want to do next."

### Stages

Each avatar is always in one stage, saved in its progress record and shown on
its card:

| Stage | Card line (example) | Leaves when |
| --- | --- | --- |
| Settling in | "Pip enjoys the Lamp." | `rules.restActs` own acts pass (about 3) |
| Growing curious | "Pip is thinking about a place to gather. Inspiration 3/5." | Inspiration fills |
| Ready | "Pip wants to make a warm corner at Empty station." | The avatar commits, on its next own act |
| Pursuing a wish | The quest's checklist, as today | The quest completes |
| Content | "Pip likes what you made together." | Settling in follows |

During Settling in and Content the avatar has no standing demand. It still acts
through the existing motives: it uses and keeps what it likes, talks, and
answers asks and trades. Physical upkeep is not a quest.

### Inspiration

A per-avatar meter, separate from XP. Inspiration never becomes XP, and XP
still only goes up. Each experience is a key recorded once, so repeating an act
or passing an item back and forth never refills the meter.

| Experience | Points | Key (once per) |
| --- | --- | --- |
| Help another avatar complete a hand | 2 | helper, helped, quest, step |
| Talk that shares something the listener did not know | 1 | speakers, fact |
| A trade or gift that meets a want | 1 | giver, receiver, item, quest |
| Travel somewhere with another avatar | 1 | companions, destination |
| Enjoy a liked item at rest | 1 | item, rest period |

The first version fills at 5 (`rules.inspirationToWish`). Both sides of an
exchange can gain: giving the Lamp inspires the giver for helping and the
receiver for a want met.

The talk row reuses the knowledge model: a fact counts when `share` moves
something new to the listener. The keys are the same novelty keys the PRD asks
for, so one recorded-experience log serves both proposals.

### Wishes

When the meter fills, `generateQuest` runs with **anchors** drawn from the
experiences that filled it: the avatar who helped most, a place visited
together, an item enjoyed. The generator already picks items, places, and
partners. Anchors bias those picks; they add no new verbs and no item rules.

The wish's name comes from a closed template over its anchors, for example
"Gather at Empty station with Vale". The text service may voice it as dialogue
("I'd like to make a warm place where we can sit together.") but never chooses
it. The checklist appears when the avatar commits.

### Lasting preferences, hopes, and attachments

These live in generic data, never in rules that name an entity:

- **Preference.** One tag the avatar likes, such as `warm`, from its seed
  entry. An item that shares the tag is enjoyed at rest and counts as an
  experience. Pip likes warmth; the Lamp is tagged `warm`. No rule names
  either.
- **Hope.** One long goal per avatar, such as "make Empty station a home": a
  place plus a hope kind from a closed list. Hopes change slowly. Wish anchors
  favour the hope's place, and a major experience may replace the hope, with a
  conversation saying why.
- **Attachment.** A record per held item listing reasons from a closed set:
  needed, liked, a gift from another avatar, or carried through a completed
  quest. Attachment feeds `willingToGive` and `canTrade`: an attached item is
  not a spare. "This is the lamp we brought through the mirror" is the quest
  reason, voiced.
- **Mark.** Each completed wish leaves a lasting fact on its place, shown on the
  place card, such as "Pip's lamp sits here". A mark is presentation and
  memory. It is not new state that other rules read.

Lending and setting an item aside for another avatar (the keeper keeps spare
oil because Pip visits) are later: they need an offer form the core does not
have.

### Rules that still hold

- All of this is saved and validated, survives a save round trip, and replays
  exactly. No randomness, clock, or network.
- Experience keys are claim keys: each event is counted once.
- A quiet world stays still: experiences come only from plays and resident acts
  within reach of a player.
- Players are a role. A player avatar gets the same stages, but its wish waits
  for the player to take it up.
- Liveness wins. An avatar left in Growing curious for `rules.stallActs` own
  acts gets a wish anyway, from the anchors it has, so no one stalls for lack
  of company.

### First slice

1. Stages, with a Settling-in rest after each completion and the card lines.
2. Inspiration from the help, trade-or-gift, and shared-travel rows, with
   experience keys.
3. Wishes: generator anchors from those experiences.

Talk-learned facts, preferences, hopes, attachments, and marks follow once the
slice plays well.

Measure with headless play over many seeds:

- The gap between quests is short: 3 to 8 own acts for most avatars.
- Most quests come from a filled meter, not the liveness fallback.
- Wish anchors repeat partners and places more than today's quests, a sign of
  relationships forming.
- A solo player's level pace changes by under 15%.
- No freezes, and replays are exact.

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
