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

Status: **First slice built** in the shore card table (`v2/card-game/life.mjs`).
PR #1130 shipped a visible Inspiration meter. The rework described here
replaces it. It answers three proposals under "Card-table Direction Under
Review" in the [PRD](../../PRD.md): a fulfilled phase, rewards for meaningful
novelty, and a quest cadence.

The rhythm is **living, finding a purpose, pursuing it, and enjoying the
result**. A quest becomes a purpose the avatar finds through play: "I helped
you, we spent time together, and now I know what I want to do next."

### Why the meter went

The first version showed a 0/5 bar. Gifts scored 2, talks 1 and lamp care 2.
A six-turn repeat lockout and a two-per-turn cap kept it from filling too
fast. Three problems followed:

- Kindness read as a currency to grind. Players talked to the same avatar until
  the bar filled.
- Experiences counted only after the rest ended, so a gift during rest was
  lost.
- `life.mjs` named the cast, the items and three handwritten hopes. A
  generated avatar had no hope at all.

### Stages

Each avatar is in one stage, saved in its `life` record:

| Stage | Card (third person) | Leaves when |
| --- | --- | --- |
| Pursuing (`active`) | The quest's checklist | The quest completes |
| Heading to rest (`returning`) | "Wants to rest at Empty station." | The avatar reaches a sanctuary |
| Resting (`content`) | "Enjoying what the last quest made." or "Restless since Vale's gift." | `REST_TURNS` (3) rounds pass in a sanctuary |
| Restless (`seeking`) | "Looking for something worth doing." | A meaningful experience, or `STALL_TURNS` (6) quiet rounds |

During rest the avatar has no standing demand. It still acts through motives:
it keeps what it likes, talks, and answers asks and trades.

### Rest needs a sanctuary

A place is a sanctuary when its data says so: `sanctuary: true` on the place
record. No rule names a place. In the shore, Empty station and Mirror attic
are sanctuaries; Black pond and the clearing are not. A world that declares
none lets avatars rest anywhere.

An avatar that finishes a quest away from a sanctuary heads for one: its home
when home is a sanctuary, otherwise the first one declared. Its interest
becomes "Rest at Empty station", and its speech knows "I want to go home and
rest." The walk is itself a seed for play: Vale can accompany it, and that
shared journey is an experience that can seed the next purpose. Rest rounds
count only while the avatar stays in a sanctuary. Leaving sends it back to
Heading to rest with its remaining rest kept.

### Experiences seed purposes

Every meaningful act is remembered as a short record of kind, turn, other
avatar, item and place. The record holds no points. Kinds come from a closed
list:

| Kind | Comes from | Shapes the next quest toward |
| --- | --- | --- |
| `help` | Giving a useful gift | delivery |
| `gift` | Receiving a useful gift | delivery |
| `journey` | An accepted shared trip | crossing |
| `care` | Tending an item (refilling the lamp) | gathering |
| `talk` | A conversation | gathering |
| `trade` | A completed trade | bargain |

Experiences count during rest too. When rest ends, the strongest experience
since the last quest becomes its **spark**. The earliest experience wins a
tie. The spark seeds the next purpose at the end of that round, and the
generator ranks quests toward its kind. A restless avatar with no spark takes
up the next experience the same way. After `STALL_TURNS` with none, a purpose
comes from the hope alone, so no avatar stalls for lack of company.

A repeated exchange refreshes its memory rather than adding a second one.
Nothing accumulates, so there is nothing to grind. The rest length and stall
limit are internal. The card and speech show prose only, never a count.

The spark is saved as `origin` on the active quest. The log says where the
purpose came from: "Pip finds a new purpose: … It began with Vale's gift."

### Hopes come from a generator

`generateHope(world, avatar, profile)` builds one long hope from profile data
(`tastes` in the shore: `home` and `values`):

- **Place:** the profile's home, else the avatar's current place.
- **Favourite:** the item with the highest value, else none. It is kept with
  the reason "Pip's favourite." and weighs in gifts and prices.
- **Milestones:** a fixed order of situations (delivery, gathering, an answer
  or crossing), rotated by a stable hash of the avatar's id.

The hope is saved with the avatar, so it survives reloads and replays exactly.
Titles come from closed templates over the place name, such as "Make Black
pond a place to gather". The next milestone outranks the spark when the
generator picks a quest. A milestone counts by quest kind alone, never by a
named item or effect. A profile with `quests: false` (the badger) gets no
personal quests.

### Gifts and company

Unchanged from the first slice. A received gift is an attachment that names
its giver; the receiver keeps it and values it more. Talking, giving, trading
and accepted trips promise three rounds of company. A grievance still lets an
avatar seek space.

### Two registers

- **Card and Menu prose** is third person and shown to the player:
  "Restless since the keeper's gift."
- **Speech facts** (`lifeFacts`, read by the dialogue context) are the
  avatar's own first-person awareness, short and plain, never labels or
  directives: "I want Black pond to be a place where we gather." / "I'm
  resting after my last quest. I keep thinking about Vale's gift." / "Vale
  gave me this Lamp. I'm keeping it." These lines suit small local models.

### Saves

`life` is version 2. Loading a version 1 save keeps phases, remaining
rest, attachments, company and milestones. It drops the Inspiration number, turns
each old experience key into a record, and generates the hope. A restless
avatar with points keeps its experiences, so its strongest one seeds a purpose
at the next round. One with zero points keeps only memories from before its
rest, so it starts restless with no spark. A resting avatar keeps everything,
because rest experiences now count. A resting avatar away from a sanctuary
starts heading to one at the next round.

### Rules that still hold

- All of this is saved, validated, survives a save round trip, and replays
  exactly. No randomness, clock, or network.
- XP only goes up. Experiences never become XP.
- A quiet world stays still: experiences come only from plays and resident acts
  within reach of a player.
- No rule in `life.mjs` names an avatar, item or place.

### The simulation decides; models only write

Purposes, sparks, rest, sanctuaries, hopes, milestones, attachments and
company are all decided by this deterministic code. Language models only turn
these facts into speech or narration. No decision reads model output, and a
model failure changes nothing in the world.

### Open questions

- Should a spark anchor the quest's partner, place or item (the avatar who
  helped, the place visited together), not just its kind?
- Should a strong experience replace a hope, with a conversation saying why?
- Should players see their own avatar's spark, or only residents'?
- Which places should be sanctuaries? The shore marks the station and the
  attic, so Pip, whose home is the pond, rests at the station.
- Measure with headless play over many seeds: the gap between quests, the share
  of purposes from sparks against the stall fallback, and a solo player's level
  pace.

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
