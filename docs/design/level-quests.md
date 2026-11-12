# Level quests replace XP

Status: Proposal for package C of the rules 134 batch
([#2694](https://github.com/cenetex/cosyworld/issues/2694)). Nothing here is
built. Facts were read at `origin/main` commit `fb5d5afbe`; line numbers are
from that commit and will move.

Design sources: [companions and quests](companions-and-quests.md) (owner
decisions 1, 10, 11, 13, 14, 18, 19), [wants and arcs](wants-and-arcs.md),
[sleep](sleep.md), [level curve](level-curve.md) and the
[quest stack](quest-stack.md). Package A (a held stack per player avatar,
newest on top, Discard that sticks) is built separately. This page needs no
change to it.

## The rule in one paragraph

Every avatar, item and place has a level and exactly one level quest. A level
quest is a want in today's vocabulary. When a play makes it true, that entity
gains one level and draws its next level quest. No number is counted. XP is
deleted.

## Where XP is used today

Each use was checked in the code. Section 2 says what replaces it.

| # | Use | Where |
| --- | --- | --- |
| 1 | Level curve, thresholds, gap | `levelFor` `want.mjs:78`, `questXp` `:111`, `levelGap` `:106`, `levelXp` `:119` |
| 2 | Level-up offer | `levelUpQuest` `:206`, offered at `world/offers.mjs:119` |
| 3 | Halfway dream | `halfwayXp` `:120`, `wake` `:215`, `milestones` `:246`, `a.halfwayIssued`, `a.glimpse` |
| 4 | Discard cost | `dropCost` `:168`, `dropQuest` `:176`, `cards.mjs:560`, caption `app.mjs:2911` ("Cost N XP") |
| 5 | Residents level at once | `commitMet` `:616` (`levelFor`), `installWants` `:326-328` |
| 6 | Residents level at home | `levelReturnHome` `:83`, `settleHomeLevels` `:87` (called `world.mjs:3411`), `homeOf` `world/home.mjs:10`, walk-home in `world.mjs:2052, 2822, 2884, 2983` |
| 7 | Authored start level | `startXp` `want.mjs:125`; `startLevel` in `pack-schema.mjs:712, 1313`; items read it directly in `rarity.mjs:8` |
| 8 | World level | `worldPoints` `world-level.mjs:16-33` |
| 9 | Validation cap | `validWant` `want.mjs:799-840` (`most`, `a.xp <= most`, `level <= levelFor(most)`, glimpse and halfway caps) |
| 10 | Box opening pays 1 XP | `creditOpened` `world/boxes.mjs:507-549` (called `world.mjs:942, 3293`), cap term in `validWant` |
| 11 | Helper earns 1 XP | `helped` `want.mjs:598` (called from `settleWants` `:568`) |
| 12 | Every met want pays 1 XP | `commitMet` `want.mjs:616`, log `questXp` in `world.mjs:670-690`, validated `world.mjs:3958-3962` |
| 13 | Carry between worlds | `carryProgress` `shared-world.mjs:97` (writes `xp`, `level`, `carried`), `carryLocalProgress` `legacy-saves.mjs:40-70` |
| 14 | Server progress store | `progress_of` and `save_progress` rank in `bindings.rs:165-260`, `world_list.rs:51` |
| 15 | Quest card and scene payloads | `xp:` in `quest-card.mjs:58` and `scene.mjs:871` |

Also touched: `levelOf` (`want.mjs:79`) falls back to `levelFor(xp)`, and
every card tier reads it (`rarity.mjs:10`, `scene.mjs:870`). Items show
`startLevel || 1`; places have no level today. The level curve page is
stale: a level quest today is the single "Sleep at home" rest step
(`validQuest` allows `left === 1` only).

## 1. Data: what a level quest is

### The record

An entity's level quest is a want: `{kind, target, step?, since}`. It uses
the kinds in `WANT_KINDS` (`item`, `place`, `person`) and the steps in
`STEP_VERBS` (`want.mjs:30-34`). It is worded by `wantWords`
(`world/want-words.mjs`) and shown by the same lock-goal wording
(`world/lock-goals.mjs`). No pack writes a sentence for it.

The subject of an item's or place's level quest is the thing itself. The
words are the same fixed verbs, read about the subject:

| Holder | `kind` | Means | Met when (no actor needed) |
| --- | --- | --- | --- |
| Item | `place` | the item wants to be at P | `itemPlace(item) === P` |
| Item | `person` | the item wants to be with X | `rootHolder(item) === X` |
| Place | `item` | the place wants X in it | `itemPlace(X) === place` |
| Place | `person` | the place wants X there | `actors[X].place === place` |
| Avatar | as today | the avatar wants an item, place or person | `questMet`, `want.mjs:~520` |

The test reads world state only. Any play, by anyone, can make it true. An
item cannot "act", so item and place level quests are state conditions, never
act verbs. Rest, give, eat and lay steps stay avatar-only.

### Where it lives

- Avatar: `actors[id].lq`. For a resident it is its one `want` (a resident
  holds one want, so its want is its level quest and nothing else is added).
  For a player avatar it is a pointer, section 4.
- Item: `items[id].lq`, with `items[id].level`.
- Place: `placeState[id]` is new; it holds `{level, lq}` for a place that has
  drawn one. A place never touched has neither (level 1, no quest yet).

`level` is saved for every entity. It starts at the authored `startLevel` or
1. `startLevel` stays in pack data (`pack-schema.mjs:712, 1313`); only its
meaning loses the XP detour (`startXp` is deleted, section 2).

### Drawn over time

A new level quest is drawn when the old one is met, or when an entity first
becomes active. The draw is a pure function of the world and the run seed, as
`stagedNext` and `nextWant` are (`want.mjs:295, 417`), so replay is the same.

1. A resident with staged `wants` takes the eligible one with the lowest
   seeded hash (`stagedNext`, unchanged). This is authored data, not prose.
2. Otherwise the draw takes from the generator's candidate pool
   (`wantCandidates`, `want.mjs:~345`). For an item or place the pool is
   built about the subject by the table above: places the item can be carried
   to, people who could hold it, items the place could hold.
3. A candidate is skipped if it is already true, if its target is not in the
   world, if the entity just had those terms (`previous`), or if the terms
   were discarded and nothing has changed (section 5).
4. If the pool is empty, the entity has no level quest until the next dawn
   and keeps its level.

No text is added. A card draws only if it is `active` and a traveler has
discovered it. Version one draws one-step wants at every level; harder ones
can come later as a generator weight.

## 2. Levelling without XP

Meeting an entity's level quest raises its `level` by 1. That is the only way
a level rises. The meeting is checked where wants are settled today
(`settleWants`, `want.mjs:568`), plus a new settle for items and places
after every play, since their quests are state tests.

What replaces each use in the table above:

1. Curve, thresholds, gap: removed. Level n takes n minus 1 met quests.
   `levelFor`, `questXp`, `levelGap`, `levelXp`, `QUEST_STEP_LEVELS` and
   `questSteps` are deleted.
2. Level-up offer: removed. The level quest is not offered at a threshold; it
   always stands (sections 3 and 4). `levelUpQuest` and the `level` offer kind
   are deleted.
3. Halfway dream: removed. Package B draws a dream on every long rest, so no
   threshold is needed. `drawGlimpse` takes the current level; `halfwayXp`,
   `milestones`, `a.halfwayIssued` and the glimpse level cap go.
4. Discard cost: removed. See section 5.
5. Residents' instant level: replaced by the same rule as everyone. A resident
   levels the play its want is met. `commitMet` adds 1 to `level`.
6. Residents' level at home: removed. `levelAtHome`, `levelReturnHome`,
   `settleHomeLevels` and the walk-home branches go (section 6).
7. `startXp`: removed. `level = startLevel || 1` is set when the entity is
   installed (`installWants`, `want.mjs:315`).
8. `world-level`: `worldPoints` keeps its formula with
   `levelOf(id) - (startLevel || 1)` in place of `levelOf - levelFor(startXp)`.
   Opened routes, sections and crossings still count. It stays presentation
   and stores nothing. Items and places do not count in version one.
9. The cap: see below.
10. `creditOpened`: removed. Opening a box pays nothing. The opening is its
    own result. The `opened` record stays, because `stood` and the lock UI use
    it (`world/boxes.mjs:~560`).
11. `helped`: the XP half is removed. Its trust half stays: a player whose
    play meets another avatar's want still raises that avatar's trust by 1.
    An item's or place's quest met by a traveler gives that traveler no
    trust (nothing to trust) and no level, except as section 4 says.
12. Per-want pay: removed. The `want_met` log keeps its entry; `questXp` on it
    is dropped (`world.mjs:670-690, 3958-3962`).
13. Carry: see section 7.
14. Server store: see section 7.
15. `xp` in the quest card and scene payloads: dropped. Both already carry
    `level`.

### The validation cap

`validWant` today bounds `xp` by `startXp + carried + turn*8 + boxes opened`
and `level` by `levelFor` of that (`want.mjs:808-823`). The new cap has one
term fewer:

`level <= startLevel + carried + 8 * turn`

where `carried` is the level brought in (section 7). The same bound holds
for items and places. It refuses forged saves; it does not model play. The
glimpse and halfway checks go with section 2.3.

## 3. The attic rule

A new traveler gets no level quest, and so no level, until it has left home.

**Condition.** The traveler's first level quest is drawn only when its
`visited` list holds a place other than `homeOf(actor)`:

`a.visited.some((place) => place !== homeOf(actor))`

`visited` already starts as `[a.place]` (`installWants`, `want.mjs:~331`) and
gains each place on settle (`settleWants`, `:581`). For Vale the home is the
Mirror attic (`shared-cast.json`, id `attic`). Stepping through the mirror
to the pond is the departure. Resting in the attic therefore levels nothing:
there is no quest to meet.

The draw skips any candidate already true when drawn, so the play that
leaves the attic cannot meet the quest it draws. Returning home changes
nothing: `visited` never shrinks.

The rule is for player avatars. A resident's first quest draws when it
becomes active, as now. An avatar carried in from another world with level
above 1 follows the same rule in the new world, since its `visited` there
starts at home.

## 4. Whose stack, and who can meet it

### Item and place quests

An item's or place's level quest is one card in the stack under that card.
It uses the existing card stack, the quest card and the dialogue bar. It is
shown when the traveler has discovered the entity. Its words hide anything the
traveler has not discovered ("something undiscovered", `UNKNOWN` in
`want-words.mjs`), so the rule in owner decision 12 holds.

Anyone can meet it, since it is a state test: a traveler, a resident or a
ship that puts the chalice at the fountain meets it. The entity levels.

### How an avatar comes to hold "bring the chalice to the fountain"

The chalice's quest reads "the chalice wants to be at the fountain". An
avatar's version is the same fact worded for a doer. This is a fixed map to
steps that exist today:

| Entity quest | The avatar's quest | Existing step |
| --- | --- | --- |
| item at P | bring item to P | `bring` with `at` (`world/want-words.mjs`) |
| item with X | give item to X | `give` with `to` |
| place has item Y | bring Y to the place | `bring` with `at` |
| place has person X | bring X to the place | `bring` on a person, `at` |

The map is one function. It makes a `questOffers` entry with `kind: "thing"`
and `source` the entity, beside the existing `box`, `resident`, `home` and
`level` kinds (`world/offers.mjs:~70-125`). It appears when the entity is at
the traveler's place or carried by it, as a box does. Package A holds an offer
the moment it stands, so it needs only the new offer kind. Identity is
`questTerms` (`want.mjs:~135`), so A's "does not return until terms change"
works unchanged.

### The avatar's own level quest

A player avatar has one `lq`. It is a pointer to one card of its held stack,
by terms:

1. If the stack holds a `thing` or `resident` card, `lq` is the newest such
   card. Meeting it levels the avatar and, being the same fact, the entity.
   One play does both because both tests read the same state.
2. If not, the avatar draws its own, as a resident does (section 1), and A's
   stack holds it as an offer from source `self`, at the bottom.
3. If the avatar discards the card its `lq` points at, `lq` moves to the next
   candidate by the same order. A card of source `box` or `home` is held and
   can be met, but it is not a level quest and gives the avatar no level.

So the player always has one level quest, shown under its avatar card, and
changes it by Discard only. A traveler levels only for its own `lq`; helping
another quest levels that entity, not the helper.

## 5. Discard

With XP gone, `dropCost` is gone. Discarding a level quest costs nothing.

- It does not come back until its terms change. Package A already gives
  that: a discarded quest stays off until its source offers different terms.
- Terms change by the draw (section 1): the world moves, a new candidate
  appears, or the entity's own quest is met.
- The avatar's `lq` moves on at once to the next candidate, so it is never
  left without one (after the attic rule).
- `gaveUp` (`want.mjs:176`) is reused: the discarded target stays out of the
  pool for `CONTENT_TURNS` (24) turns, as for residents.
- The "Cost N XP" caption (`app.mjs:2911`) is removed. A held card's button is
  Discard, as package A has it.

## 6. Residents

Today residents level at once on XP (`commitMet`, `levelFor`) except
`levelAtHome` residents (RATi only), who walk to a sanctuary and level on
arriving (`levelReturnHome`, `settleHomeLevels`).

New rule: a resident's `want` is its level quest. When a play meets it,
`level += 1` and `commitMet` draws the next (staged first, else drawn).
There is no waiting, no home trip and no sleep.

- Deleted: `levelAtHome` (`pack-schema.mjs:722, 1258-1264`),
  `levelReturnHome`, `settleHomeLevels`, and the `levelReturnHome` branches
  in `world.mjs` (lines 2052, 2822, 2884, 2983). Residents stop being pulled
  home by a pending level. RATi's `homeOf` stays for other reasons
  (`world/home.mjs:10`).
- Kept: residents' staged `wants`, their dwell and range rules, and
  contentment (`content`, `fillWants`). Content still delays the next draw
  by `CONTENT_TURNS`.
- A companion levels when its want is met, wherever it is. The open question
  on "companion's level-up" in
  [companions and quests](companions-and-quests.md) is closed by this.

Pace: level n takes n minus 1 met wants (level 10 was 44 XP). See section 10.

## 7. Shared worlds and saves

### Saved state

Added: `level` on every actor, item and tracked place; `lq` on items and
places and on a player avatar. Removed: `xp`, `carried` (replaced by
`carriedLevel`, an integer) and `halfwayIssued`. A saved `glimpse` keeps the
level it was drawn for, with no cap.

`SAVE_SCHEMA` goes from 8 to 9 (`legacy-saves.mjs:17`). Alpha saves can be
nuked, so a schema 8 save "needs a fresh start" (`upgradeSave`,
`legacy-saves.mjs:76`) and no XP migration is written. Human avatars keep
their level: `carryLocalProgress` (`legacy-saves.mjs:40`) reads
`from.level ?? levelFor(from.xp)` once, and writes `level` only. `levelFor`
survives in that one function, as a migration helper, and is deleted with it
later.

### Carry between worlds

- `carryProgress` (`shared-world.mjs:97`) accepts `{level, upgrades}`. It
  still accepts `xp` and ignores it. It sets `level` and `carriedLevel =
  level`. The bound `0..1_000_000` stays.
- The host computes `level` from older worlds:
  `progress_of` (`bindings.rs:255`) returns `a.level` if set, else
  `levelFor(a.xp)` (a four-line Rust function), and writes `{level}`.
- `save_progress` ranks by `(level, xp)` (`bindings.rs:165`). With `xp` gone
  the tie-break is level alone. `world_list.rs:51` lists `level` and drops
  `xp` when absent.
- The journaled `claim` records its `progress`. Journals before 134 hold
  `{xp, level}` and replay on their own bundles. Journals from 134 hold
  `{level}`.

### Replay safety and the Rust floor

- The rule change is a new bundle `engine-v134.js` and the version constant
  (`engine.rs:16, 148`). Bundles v2 to v133 are untouched;
  `test/card-released-rules.test.mjs` pins their hashes. Existing shared
  worlds stay on their bundle, as with every rules bump.
- `carries_progress(version)` (`bindings.rs:168`) stays `>= 80`.
- Rust changes: the constant, `progress_of` and its rank, `world_list` keys,
  and fixtures that set `xp` (`bindings_tests.rs`, `full_floor_tests.rs`,
  `full_tests.rs`, `quest_loop_tests.rs`). No new module. The narrator's
  `DREAMS` (`card_narrative.rs:1531`) is package B's.
- The PR needs the `engine` label; this page is its design note.

## 8. UI

No new component, class, id or element; `npm run check:ui` stays green.

- A level quest is the existing quest card in the existing stack under its
  entity's card. Only the top card is the active want.
- One selection gives one button. A held card's button is **Discard**. There
  is no accept button (package A) and no second control. A blocked play's
  reason stays the context button's label.
- Tier colour stays and reads `level`. The "Cost N XP" text and the `level`
  offer card are removed from `app.mjs`, `cards.mjs` and `quest-card.mjs`.
- Item and place quests show once the card is discovered. `wantWords` with
  `known(id)` words unknown targets as "something undiscovered".

## 9. Migration: small PRs onto `rules/134`

Each PR is testable on synthetic worlds (a made-up pack and made-up
entities, per the tests-must-survive-story-changes rule), changes under 400
hand-written lines, and keeps `rules/134` green. Rough sizes are lines of
hand-written change. The tests listed break and are rewritten in that PR.

| # | PR | Size | Tests that break |
| --- | --- | --- | --- |
| 1 | `level` saved on every actor; `levelOf` reads it; `startLevel` sets it; `startXp` deleted. XP still paid but level no longer derived from it (levels rise only through the quest paths that exist: the old level quest). Schema 9. | 150 | `card-world-level`, `card-rarity`, `card-rarity-portraits`, `card-save-retired`, `card-game` fixtures |
| 2 | Entity level quest record and the draw: `lq` for items and places, state-test quests, the pool, the `thing`-to-step map as a pure module (`level-quest.mjs`), with focused synthetic-world tests. No call sites yet. | 250 | none (new) |
| 3 | Residents: want met gives `level += 1`; draw next; delete `levelAtHome`, `levelReturnHome`, `settleHomeLevels` and the walk-home branches. | 200 | `card-resident-level-home` (deleted), `card-world-life`, `card-motives`, `card-ratiradio`, `card-greek-xp` |
| 4 | Item and place quests settle after every play and `level` rises; world-level counts opened ways and resident gains only. | 150 | `card-world-level`, `card-sealed-items` |
| 5 | Player avatar `lq` and the attic rule; `thing` offer kind in `questOffers`; remove `levelUpQuest`, `restStep(quest)` and the level offer. Needs package A for the held stack. | 250 | `card-rest`, `card-rest-destination`, `card-quest-offers`, `card-quest-cards`, `card-quest-card`, `card-home-doors`, `card-pip-landing` |
| 6 | Remove XP economy: `commitMet` pay, `helped` XP, `creditOpened`, `questXp` log field, halfway dream hooks (pair with package B's dream-on-long-rest), `dropCost` and the "Cost N XP" caption. Cap term rewritten. | 200 | `card-boxes-one-want`, `card-boxes`, `card-one-want`, `card-want`, `card-staged-wants`, `card-talk-quest`, `card-pressured-handover`, `card-greek-patroclus`, `card-combat`, `card-opening`, `card-pond-opening` |
| 7 | Carry: `carryProgress`, `carryLocalProgress`, Rust `progress_of`, rank, `world_list`. | 150 | `card-avatar-reset`, `card-avatar-menu-leave`, `bindings_tests`, `world_list` tests |
| 8 | Bundle `engine-v134.js`, version constant, released-rules pin, shared-world doc, and the replay and client/server agreement checks. This is the batch's single bump step. | generated, 40 by hand | `card-released-rules`, `full_floor_tests`, `full_tests`, `quest_loop_tests` |
| 9 | Docs: this page's "Status", [companions and quests](companions-and-quests.md) rows 5 and 10, [level curve](level-curve.md), [resident level home](resident-level-home.md), [sleep](sleep.md). | 100 | `docs:check` |

Order: PR 1 first, so later PRs read `level` and not `xp`. PR 5 needs
package A merged; if A is late it can use the single `want` and A's stack
follows without changing the offer kind. PRs 2 and 7 are independent and can
start at once. The longest chain is 1, 3, 4, 5, 6, 8.

## 10. Open questions for the owner

Only the ones that change the build.

1. **Does a level land on meeting, or at the next long rest?** Companions
   decision 3 has residents sleep at home to level. The brief says "meeting
   your level quest = +1 level". Recommend on meeting. It drops the walk home
   and makes the sleep spec's long rest purely about dreams.
2. **Is "Sleep at home" kept anywhere?** It is today's only level quest.
   Recommend retire it as a level quest. `rest` stays a legal step for pack
   data.
3. **Pace.** Level n now takes n minus 1 met quests, far faster than the
   triangular curve (level 10 was 44 XP). Recommend keep it and slow it by
   harder quests later, since levels are rarity and gates (combat tiers
   compare tiers). The alternative is a per-level cost, which brings a
   counter back.
4. **Does a helper level?** The brief makes the helper's `lq` the borrowed
   quest, so helping levels you only when the helped quest is yours.
   Recommend that, and trust for the helper as now. The alternative pays
   every helper one level, which makes levels cheap to farm.
5. **Free Discard.** Recommend free, with `gaveUp` keeping the target out for
   24 turns. A cost would need a number; there is none left.
6. **Rarity.** An item's or place's tier rises with its level (decision 19).
   Recommend yes, colour only, as decision 18 says. Version one shows the
   tier; nothing else changes.
7. **Existing shared worlds.** Leave them on their bundle (recommended), or
   convert `xp` to `level` in a saved upgrade (needs a replay story).
8. **Who draws for an undiscovered item or place?** Recommend none: a card no
   traveler has discovered draws no quest. Otherwise unseen cards would
   level in the dark and the world level would drift.

## Checks before building

1. `bring` with `at` and no `to` is met by `stepMet` (`want.mjs:~500`); test it
   on a place that is not the item's home.
2. The draw must skip items whose holder cannot move them (`obtainable`).
3. Replay a long journal under the new `8 * turn` cap before PR 6.
