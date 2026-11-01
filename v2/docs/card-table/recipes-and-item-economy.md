# Recipes and the item economy

Status: design, 2026-11-01. No code yet. Line numbers refer to `main` at
`7f92ff1b9`. Refs #1581, #1540, #1629, #1726, #1744.

The owner asked for an extensible "give X, get Y" vocabulary for packs, with
Dione's bread as the first case: the bread, the figs and the wine skin make
Travel Provisions; the provisions sail to Piraeus and are used up there; and
each spent input comes back somewhere in the world. The notebook in the Willows
(3 pages make a chapter, 3 chapters make the book) uses the same vocabulary.

Two owner decisions (2026-11-01) are already fixed here:

- **Combining is a card at a place.** A *combine card* lives at a place, like
  a fixture. You bring the inputs there and play it.
- **Renewal is seeded and scattered.** When an item is used up, the items it
  names come back at a random place from a set, or in the hands of a random
  resident at a set of places.

## What exists today

| Piece | Where | What it gives us |
| --- | --- | --- |
| `on` triggers `meet`, `wait`, `depart` and `give` | `pack-schema.mjs:1093-1103`, runtime in `pack-registry.mjs:460-547` | Verb-bound story deeds. Each choice fires **once per world**: `choiceFeasible` refuses a choice that has a receipt (`pack-registry.mjs:392-396`). |
| Effects `choose`, `set_flag`, `place_item`, `hide_item`, `give_item` and `retire_item` | `pack-schema.mjs:1119-1167`, `pack-registry.mjs:549-610` | `retire_item` puts an item back at its authored holder with an empty history (`:567-570`). It is only hidden if its own `requires` hide it. |
| `CONDITION_KINDS` | `pack-schema.mjs:62` | 21 closed kinds, including `holding`, `item_at`, `item_present` and `ship_at`. There is no "actor is at place" kind. |
| Items are single instances | `world.items[id]`, one `holder` each | There are no counts and no minting. An item's holder can be a place, an avatar or another item (`want.mjs:259`). |
| Hands hold three things | `hasSpace`, `world.mjs:528` | Three inputs fill a hand, so a three-input recipe uses a full hand. |
| Oil refuels the lamp | `refuelCarried`, `world.mjs:935-958`; `forest.json` `refuels`/`returnsTo` | This is the one repeatable transform today: it runs when one avatar holds both, writes a rule caption, and sends the flask back to its home. It is the pattern this design generalizes. |
| Fixtures | `pack-schema.mjs:583`, `fixtureOffers` in `pack-rules.mjs:360` | Place-bound pack things with one verb (`ring`). The combine card copies this shape. |
| Ship gate on provisions | `worlds/greek-drama/card-bridge.json` lane `greek-harbor`↔`greek-piraeus`, `opensWith: item_present greek-provisions greek-ship`; `laneGate`, `pack-transport.mjs:112` | The lane opens while the provisions are aboard. Nothing uses them up. |
| Arrival event | `sailTransports`, `pack-transport.mjs:381-399` | `{kind: "arrive", dock}` is the hook for spending cargo. |
| Thebes pilot (#1744, open) | `greek-return-water-jar` with `on: "give"` | Giving Dione the jar places it at the courtyard and sets `greek-water-returned`. That flag reveals `greek-bread`. It works once. |
| Lonely Forest scarves | `forest-sew-scarf-*` (`on: "give"` with `retire_item` and `give_item`) | This is already "give X get Y" as data, written out eight times, one-shot, with two flags per traveller. |
| Items | `greek-water-jar` (well), `greek-bread` (courtyard, flag-gated), `greek-provisions` (harbour, in play from the start), `greek-provision-basket` (Piraeus, a separate Open Door item) | Provisions are also spent by Helen's passage choices (`place_item` at the tomb), which takes them out of the economy for good. |
| Item levels (#1726, open) | `startLevel` on items | It sets the tier only. No rule reads it. |
| Wants (#1700, #1704, #1721) | `want.mjs`; quest card `quest-card.mjs` | A stack of up to three wants per avatar (#1831): Hold, Be at, Talk with, Introduce. The quest card shows the target's art, or the card back while the target is unseen. |

Missing: repetition (receipts make choices one-shot), a real out-of-play
state (a retired thing needs a flag to hide), and renewal.

## 1. Recipes: the combine card

**Decided:** a combine card at a place. The alternatives stay on record.

| Trigger | For | Against |
| --- | --- | --- |
| Automatic when one actor holds all inputs (the oil pattern) | No new verb | Happens by accident. Gives no sense of place. Recipes that share inputs fire in a surprising order. |
| Automatic when all inputs lie at one place | Workbench feel | Same surprise. Putting things down for any other reason crafts. |
| A Wait or a "Give to yourself" | Reuses a verb | Overloads Wait (rest and signs already use it). A gift to yourself is not a real verb. |
| **A combine card at a place (chosen)** | Deliberate, placed and visible. Mystery stays on the card's face. | Needs one new card kind and one new verb. |

**The card.** A pack defines `combines`, a map of place-bound cards. Each one
has a name, an `at` place, one to four `recipes` and optional `requires`. It
appears in the place's part of the hand next to the things lying there, like
any card. A place may hold at most two combine cards, to keep small districts
uncluttered.

**The play.** `combine` is a fixed verb, like `ring`. The action row reads
**Combine**, a rules label (`cards.mjs:313` gains `combine: "Combine"`), never
an authored line. It is offered when the human player:

1. stands at the card's place and the card's `requires` hold;
2. can reach every input of one recipe: the input is carried by them (root
   holder, so a page tucked inside another counts), or it lies at this place.
   An input in someone else's hands does not count;
3. and that recipe's output is out of play (section 3). Only human players
   combine for now.

Selecting the combine card alone offers Combine. So does pairing it with any
one of its inputs, which is the natural gesture. Order never matters, because
inputs are a set. A partial set offers nothing and shows no text, only the
mini cards (below).

**The result.** The inputs leave play. The output goes to the player who
played the card. If their hand is full (inputs from the floor do not free a
slot), the output lands at the place, and the caption says so. In shared play
the action is checked against the table when it runs, so if two players race,
the second gets the usual "no longer available".

**What the card shows.** It uses the quest-card pane logic:

- The face is the output's art, with the output's tier border (#1726), and
  the combine card's name small ("Dione's Table").
- Up to three mini cards along the bottom show the inputs. A mini card is
  face up while the player reaches that input, and shows the card back
  otherwise. That is the only progress display: no list and no words.
- The whole card shows the back while the player reaches none of its inputs.
  This reads current reach only, so it needs no saved state and is
  presentation only.
- With several recipes, the face shows the first recipe (in authored order)
  whose output is out of play and that has the most inputs within reach.

**Caption and glow.** The rules write the World line from names alone:
"At Dione's Table, Vale puts the Courtyard Bread, the Dried Figs and the Wine
Skin together: Travel Provisions." The output card glows once in its tier
colour as it enters the hand (the shared shine from `card-level-up.mjs`). The
input cards leave with the normal card exit.

**Shared inputs.** Two recipes may share inputs, but not the same input set
(the schema rejects that). On one card the face rule above picks the recipe.
Across cards, the player picks by choosing the card.

**Owner.** The player who plays it. **Level.** The output's own `startLevel`. The schema requires it to be at
least the highest input level, so combining never downgrades. Suggested:
pages 1, chapters 10 (Uncommon), book 30 (Epic), provisions 10.

**Discoverable or hidden.** Hidden by default. The card face is the hint:
seeing a mini card flip face up when you hold one input is the clue. Item
`text` can carry more ("Bread, dried figs and a small wine skin are packed for
a short voyage."). There are no authored recipe lines in Talk. Residents learn
of a combine from the committed log line, like any other deed.

**Nested recipes** follow on their own: a chapter is an out-of-play item until
its recipe makes it, and the book recipe takes chapters. **Reverse.** No splitting. A chapter does not come apart. Splitting would
need a verb, would invite farming, and would add nothing the renewal loop
does not already give.

## 2. Event triggers

Keep the verb-bound `on` triggers for one-shot story deeds: `give`, `wait`,
`talk` (#1611) and `drop` (#1581, step 5), plus `meet` and `depart`. Add
**no new `on` kinds.**

- **"On arrive at a place"** is not needed. Using up cargo is a property of
  the voyage, so it goes on the lane: `"spends": true` retires the lane's
  `opensWith` items aboard when the ship arrives over that lane (the `arrive`
  branch of `sailTransports`). An arriving actor carrying something gives no
  story case yet that a lane or a combine card cannot express.
- **"On hold"** is replaced by the combine card, which the owner chose so
  that holding never crafts by accident.
- **"On drop"** stays as #1581 plans it. **"On retire"** is the renewal hook
  (section 3), an item property rather than a choice trigger.

These do not replace the remaining `on` choices. Choices set flags and
choices, and fire once. They tell the story. The new vocabulary moves things
and repeats. It replaces the item-for-item subset: the jar choice in #1744,
the eight scarf-sewing choices, and the provisions deposits in Helen's
passage.

## 3. Using up and renewal

**Out of play.** Add the holder `"@retired"`, a sentinel like `@sea`
(`AT_SEA`, `pack-schema.mjs:86`). An item at `@retired` is not active, cannot
be seen or wanted, and is in no one's hands. A pack item may start there with
`"retired": true`. Its authored `holder` stays its home. `retire_item` now
moves an item to `@retired`, so "retired" has one meaning. One shared
function, `retireItem`, is used by every route out of play: `retire_item`,
combining, a trade with `uses`, and a lane that `spends`. That function runs
the renewals.

**Renewal.** An item lists what comes back when it is used up:

```json
"renews": [
  { "item": "greek-figs", "places": ["greek-road-thebes", "greek-sanctuary", "greek-well"] },
  { "item": "greek-wine-skin", "residentsAt": ["greek-gate", "greek-palace", "greek-harbor"] }
]
```

- `places` puts the item at one active place from the set.
- `residentsAt` gives it to one resident standing at one of those places,
  chosen among residents who are not human-controlled and have room in their
  hands. You then get it from them by any verb: trade, ask, threaten. A Hold
  want covers it.
- The pick is an FNV-1a hash of the run seed, the item id and a saved
  world-wide counter `renewSeq` (incremented on each renewal), taken over the
  sorted candidates. This is the same idea as `hidingPlace`
  (`pack-registry.mjs:447`) and `chance`. Every table and every replay agree.
- If no resident qualifies, the renewal waits in the saved list `renewals`
  and is retried at each round's end. There is no other fallback.

**Guards against duplication and farming.**

1. Items are single instances. A renewal only moves an item that is at
   `@retired`. One that is already in play is never touched, and never taken
   out of anyone's hands.
2. A combine needs its output to be out of play. So while one Travel
   Provisions exists, none can be made.
3. Renewal happens only on being used up, never on a timer. Combining gives
   no XP; only wants do, and a loop costs many plays per lap.

**The economy is circular.** Each item cycles between `@retired` and play.
Nothing is minted. An effect that parks a loop item for good (Helen's
`place_item greek-provisions`) should become `retire_item`, so the loop
continues.

**Captions.** Using up an item is told where it happens ("The voyage uses up
the Travel Provisions."). A renewal is logged only at the place where it
lands, so only witnesses there see it ("Creon has a Wine Skin."). The traveller
far away is not told: mystery over reachability.

## 4. "Give X, get Y" as data

**Recommended:** an avatar field `trades` handles the repeatable exchanges.
Story deeds stay as `on: "give"` choices.

```json
"trades": [{ "takes": "greek-water-jar", "pays": "greek-bread", "uses": true }]
```

- A Give of `takes` to this resident, while `pays` is out of play or in the
  resident's hands, is always accepted. `pays` moves to the giver.
- With `uses`, the taken item is retired after wants settle, so the
  resident's Hold want for it still counts. Without `uses`, the resident keeps
  it.
- The optional `for` limits the trade to one human avatar, as on choices.
- If `pays` is in play somewhere else, the entry does not apply, and the
  ordinary gift rules decide.
- Caption, from the rules: "Vale gives Dione the Water Jar. Dione gives Vale
  the Courtyard Bread."

**How a character wants and pays.** The want is the ordinary one-want record
(a starter `want` of Hold `takes`, or one drawn later). The payment is the
trade. `values` still drive ordinary trades. So an agreement is an item quest:
the resident wants X, and meeting the want pays Y.

**Alternative:** `"repeats": true` on `on: "give"` choices, with no receipt.
It is rejected: the choice's authored `text` would become a repeated authored
line, and receipts would lose their meaning.

## 5. Fit with quests

- A crafted output is a Hold target like any item. It can be a starter
  `want` (for example, the Swede wants the Traveller's Notebook). While it is
  out of play, the quest card shows the card back with "Hold …". The progress
  line reads "Not made yet", a rules caption.
- Level-quest steps (#1721) and drawn wants use active items only, so an item
  that has not been made is never drawn. The quest card stays a simple pane:
  it never lists inputs. The combine card's mini cards are where inputs show,
  so a recipe is a composite step only in the player's head.

## 6. Shared play and replay

- **Where.** A new rules module, `v2/card-game/recipes.mjs`, imported by
  `world.mjs`, holds `combineOffers`, `applyCombine`, `retireItem`,
  `settleRenewals` and `applyTrade`. It runs inside the authored rules, so
  shared play runs it in C QuickJS at the authority boundary. Rust only sees
  plays and events.
- **Order within a play.** The play's effects, then the trade or combine,
  then `retireItem` and renewals, then `settleWants`, then the `uses`
  retirement, then `refuelCarried`. At round end: `sailTransports`, then lane
  `spends`, then retrying pending `renewals`. Recipes, holders and places are
  walked in sorted order, with no clock and no `Math.random`.
- **Journal.** One new play, `{kind: "combine", actor, target: <combine id>,
  recipe: n}`. Everything else is derived. Log entries use the verbs
  `combine`, `spend`, `renew` and `trade-pay`, with `itemIds` and
  `locationId`, so the client knows what to glow and who witnessed it.
- **Save.** Item holder `@retired`, plus `renewSeq` and `renewals` at the
  top level. `validateWorld` accepts `@retired` for pack items. Pack
  revisions: Greek (after #1744), Willows and Lonely Forest. Alpha saves may
  be dropped. The upgrade moves flag-hidden homed items to `@retired` and
  drops the replaced flags and receipts. Released bundles replay unchanged.

## 7. Worked examples

### Dione's bread loop (Greek pack)

1. The jar is at the Market Well.
2. Give it to Dione. She takes the jar and pays the bread.
3. At Dione's Table, the bread, the figs (on the Theban countryside) and the
   wine skin (in a city resident's hands) make the Travel Provisions. The
   bread is used up, so the jar is back at the well.
4. The provisions aboard open Harbour→Piraeus. Arrival spends them, so the
   figs and wine skin renew, scattered.

```json
"items": {
  "greek-water-jar": { "name": "Water Jar", "text": "A filled clay jar with a repaired handle. Dione needs it at the common table.", "holder": "greek-well", "persona": "…", "art": "assets/greek-drama/water-jar.png" },
  "greek-bread": { "name": "Courtyard Bread", "text": "A round loaf from Dione's oven.", "holder": "greek-courtyard", "retired": true, "persona": "…", "art": "assets/greek-drama/bread.png",
    "renews": [{ "item": "greek-water-jar", "places": ["greek-well"] }] },
  "greek-figs": { "name": "Dried Figs", "text": "A string of dried figs from the Theban countryside.", "holder": "greek-sanctuary", "persona": "…", "art": "assets/greek-drama/figs.png" },
  "greek-wine-skin": { "name": "Wine Skin", "text": "A small stoppered skin of watered wine.", "holder": "greek-shipmaster", "persona": "…", "art": "assets/greek-drama/wine-skin.png" },
  "greek-provisions": { "name": "Travel Provisions", "text": "Bread, dried figs and a small wine skin are packed for a short voyage.", "holder": "greek-harbor", "retired": true, "startLevel": 10, "persona": "…", "art": "assets/greek-drama/provisions.png",
    "renews": [
      { "item": "greek-figs", "places": ["greek-road-thebes", "greek-sanctuary", "greek-well"] },
      { "item": "greek-wine-skin", "residentsAt": ["greek-gate", "greek-palace", "greek-harbor"] }
    ] }
},
"avatars": {
  "greek-baker": { "…": "…", "want": { "kind": "item", "target": "greek-water-jar" },
    "trades": [{ "takes": "greek-water-jar", "pays": "greek-bread", "uses": true }] }
},
"combines": {
  "greek-dione-table": { "name": "Dione's Table", "at": "greek-courtyard",
    "recipes": [{ "inputs": ["greek-bread", "greek-figs", "greek-wine-skin"], "output": "greek-provisions" }] }
}
```

In `worlds/greek-drama/card-bridge.json`, the lane gains one field:

```json
{ "from": "greek-harbor", "to": "greek-piraeus", "spends": true,
  "opensWith": [{ "kind": "item_present", "item": "greek-provisions", "place": "greek-ship" }] }
```

Deleted: the choice `greek-return-water-jar` and the flag
`greek-water-returned`. Helen's two passage choices change `place_item
greek-provisions` to `retire_item`. The `figs.png` and `wine-skin.png` art is
new. The place ids follow `main`; #1732's quarter names may rename them.

The invariant: at most one of the jar or the bread is in play, the figs and
the skin are in play exactly while the provisions are not, and at most one
Travel Provisions exists.

### The Willows notebook

There are nine pages, `willows-page-1` to `willows-page-9`, scattered per run
by the specials draw (#1622), each with a home for the schema. There are
three chapters and the book, all out of play, and one combine card at camp.
The page art cycles through canoe, willow and hollows (#1658), so each chapter
has one of each.

```json
"items": {
  "willows-page-1": { "name": "Notebook Page: the Canoe", "text": "A loose page of pencilled field notes.", "holder": "willows-landing", "persona": "…", "art": "assets/willows/notebook-page-1.png" },
  "willows-chapter-1": { "name": "Notebook Chapter I", "text": "Three leaves stitched with thread.", "holder": "willows-camp", "retired": true, "startLevel": 10, "persona": "…", "art": "assets/willows/notebook-chapter.png" },
  "willows-notebook": { "name": "The Traveller's Notebook", "text": "A worn oilcloth notebook tied with string.", "holder": "willows-camp", "retired": true, "startLevel": 30, "persona": "…", "art": "assets/willows/notebook-book.png" }
},
"combines": {
  "willows-stitching": { "name": "The Camp Stitching", "at": "willows-camp", "recipes": [
    { "inputs": ["willows-page-1", "willows-page-2", "willows-page-3"], "output": "willows-chapter-1" },
    { "inputs": ["willows-page-4", "willows-page-5", "willows-page-6"], "output": "willows-chapter-2" },
    { "inputs": ["willows-page-7", "willows-page-8", "willows-page-9"], "output": "willows-chapter-3" },
    { "inputs": ["willows-chapter-1", "willows-chapter-2", "willows-chapter-3"], "output": "willows-notebook" }
  ] }
}
```

Pages 2 to 9 and chapters 2 and 3 follow the same pattern. Nothing renews:
the notebook is made once per run. You can leave chapters on the camp floor,
because inputs lying at the place count. The Swede's starter want could be
Hold the Traveller's Notebook. Reading (#1629's `writing` field) is separate.

### Lonely Forest scarves

RATi's eight `forest-sew-scarf-*` choices and sixteen flags become one field.
The buttons and scarves start out of play. `forest-hide-button-*` (on meet)
still hides each button. `hide_item` takes it from `@retired`.

```json
"forest-button-vale": { "name": "Vale's Black Button", "text": "A small black button with four thread holes.", "holder": "forest-cottage", "retired": true, "persona": "…", "art": "assets/lonely-forest/button-vale.png" },
"forest-scarf-vale": { "name": "Vale's White Scarf", "text": "A soft white knitted scarf fastened with a black button.", "holder": "forest-cottage", "retired": true, "startLevel": 50, "persona": "…", "art": "assets/lonely-forest/scarf-white.png" },
"rati": { "…": "…", "trades": [
  { "takes": "forest-button-vale", "pays": "forest-scarf-vale", "uses": true, "for": "vale" },
  { "takes": "forest-button-mara", "pays": "forest-scarf-mara", "uses": true, "for": "mara" }
] }
```

## 8. Minimal engine surface (one rules version)

| Kind | Addition |
| --- | --- |
| Holder sentinel | `"@retired"` (`RETIRED` in `pack-schema.mjs`). Not active, never wanted, accepted by `validateWorld`. |
| Item fields | `retired: true`; `renews: [{item, places[1-4]} or {item, residentsAt[1-4]}]`, at most 3 entries. |
| Pack map | `combines: {id: {name, at, recipes[1-4]: {inputs[1-3] distinct, output}, requires?}}`, at most 2 per place. The output must be `retired`, its level at least the inputs' levels, and no two recipes may share an input set. |
| Avatar field | `trades: [{takes, pays, uses?, for?}]`, at most 4. `pays` must be `retired` or held by the avatar. |
| Lane field | `spends: true`, only on a lane with `opensWith` items. |
| Verb | `combine` (play), with log verbs `combine`, `spend`, `renew` and `trade-pay`. |
| Effect change | `retire_item` moves an item to `@retired` and runs renewals. |
| Conditions | None new. `requires` on a combine card uses the saved kinds plus `ship_at`, `daylight` and `chance`. |
| Saved state | `renewSeq` (integer) and `renewals` (pending list, bounded by the item count). |

Tests to add:

- **Schema** (`test/card-packs.test.mjs`): every bound and reference above.
- **Rules** (`test/card-recipes.test.mjs`): Combine is offered only with the
  full set, in any order, from hand or floor, and never while the output
  exists; the output goes to the player, or to the floor when the hand is
  full; trades accept, `uses` retires after the want, `for` is respected;
  `spends` retires on arrival only; renewal places and holders are fixed by
  the seed and change with `renewSeq`; a pending renewal settles when a
  resident arrives; a renewal never moves an item in play.
- **Economy long run:** three laps of the bread loop, then 500 random shared
  plays. Each loop item has one holder, the invariant above holds every turn,
  and journal replay equals the live world.
- **Agreement:** browser rules against the bundled QuickJS rules for the same
  journal (the `card-hoppycat` pattern). Released bundles replay unchanged.
- **Client:** the combine card's face, back and mini cards; the one glow; and
  the quest card's "Not made yet".

Landing: engine prep branches (vocabulary, then the combine card and client)
land on one batch branch, minted once, with the `engine` label and a short
design note in `docs/design/` linking here. Pack data (Greek, Willows, Lonely
Forest) follows as data-only PRs.

## 9. Open owner decisions

| Question | Recommendation |
| --- | --- |
| The return voyage Piraeus→Harbour is the same gated lane, so it needs a second load of provisions. | Keep it. The way back is by road or the olive-branch lane, and an empty ship already returns home by itself (`settleEmpty`). Otherwise split the lane into two one-way lanes. |
| Can residents play combine cards? | Not yet. Add it after the loop is proven. |
| Chapters as fixed page sets, or any three pages? | Fixed sets. Each chapter is a known thing a want can name. |
| Where the notebook is stitched | The Willows camp, so the pages are carried home. |
| Should a renewal tell the traveller who used the item up? | No. It is told only where it lands. |
| Should Helen's passage spend provisions (`retire_item`)? | Yes, so the loop continues. |
| Should oil and the lamp move to `renews`/`places` later? | Yes, in a later rules batch. It is the same pattern. |
| Should combining give XP? | No. Only wants give XP. |

## 10. Later: collectors, property and other worlds

Planning, not built. Each reuses wants, `makes` and doorways.

- **Collector (pack data).** A resident with a standing want for one of each
  kind of item in a set (Animal Crossing's museum). Each item given is kept on
  display at its home; meeting the whole want opens a doorway from a `beyond`
  table. It needs a set-shaped want kind if `want.mjs` lacks one (engine,
  small).
- **Property (pack data).** A reward place that makes items: a quest reward
  can be a place with a `makes` table whose output lands there on the world
  clock (rent). Clock-driven production is cut for now, so property waits for
  it.
- **Other worlds' items (pack data).** A want can name an item native to
  another world, so players trade and bring companions along. It is never the
  only path for a solo player: the same want must also be met by something
  the solo world can make or find. Cross-references
  [ship voyages](../../../docs/design/ship-voyages-and-scattered-things.md).
