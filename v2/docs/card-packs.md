# Card-table world packs

The card table's shore is a hub. Black pond is its crossing point, and each
world the player can find from it is a **world pack** joined by a **bridge**.
Finding a new path is the game, so a new path should cost a pack, a bridge and
some art, not new engine rules.

The Steam Clock clearing (`badger-forest`) is the reference pack. Copy its
shape for the next spoke.

## Files

| File                                | Owns                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `v2/worlds/card-table.json`         | The hub's own places, avatars and items, the player id, and the list of mounted packs.                    |
| `v2/content/<pack>/card-world.json` | The reusable world: places, residents, fixtures. It never names the hub or another pack.                  |
| `v2/worlds/<pack>/card-bridge.json` | How the pack meets the hub: crossings, their conditions and signals, and how residents value hub objects. |
| `v2/card-game/assets/<pack>/*.png`  | The pack's art. Every media path in the source must point here.                                           |
| `v2/card-game/packs.json`           | Generated. All mounted packs with their bridges, validated. Do not edit by hand.                          |

```sh
npm run v2:card:pack:build   # regenerate v2/card-game/packs.json
npm run v2:card:pack:check   # fail if it is stale or invalid (part of v2:worldpack)
```

The browser imports `packs.json`, and the Rust text route embeds the same file
for profiles, so ids and seeds cannot drift between them. Each avatar has one
`seed` sentence, a name and a role such as "The Swede, a traveller on the
river.", and no `persona` or `voice` ([seed sentences](card-table/seed-sentences.md)). One validator
(`v2/card-game/pack-schema.mjs`) runs in the build and again when the table
loads. It rejects unknown fields, unknown condition kinds, dangling ids and
missing art with a reason naming the field.

Packs can also supply `topics`: facts a resident tells through Talk.

### Starter quests

Each resident can name its starter quest as `want`: `{"kind": "item" |
"place" | "person", "target": id}`, with a target in the pack or the hub. The
pack schema checks it. After the starter quest is met, the world rules draw the
resident's next quest from what it can reach, so a pack authors no quest
chains. The mounted packs no longer carry `storyQuests` or `situations`; the
schema still accepts them so older pack files load.

### Conditions

| Kind                                  | Holds when                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `{ "kind": "sound", "at": [places] }` | A sound is audible at any listed place: the hand bell ringing uncovered there, or a pack fixture sounding there. |

`{ "kind": "item_present", "item": "cloth", "place": "attic" }` checks an
item's physical place. It follows custody through covered items and their
carrier. Hub and pack items can use this crossing condition. An item on the
floor and an item held by someone in that room satisfy the same condition.

`{ "kind": "tag_held", "tag": "scarf", "place": "attic" }` holds while someone
in the place carries an active pack thing whose `tags` list names that tag,
or has an upgrade of that name. A human must be present. Things on the floor
do not count. A pack item may list
up to four `tags`. Lonely Forest tags its eight sewn scarves `scarf`, so any
traveler's scarf opens the lit attic stairs, as the Black cloth does, and a
traveler who wears their scarf (the `scarf` upgrade) still opens them.

`{ "kind": "pack_item_present", "pack": "hoppycat-archive", "place": "greek-ship" }`
holds while any thing from that pack is in the place: resting there, or
carried by someone present there.

`{ "kind": "daylight", "phase": "night" }` holds during the night blocks of
the saved world clock (`daylight.mjs`: every other block of 24 turns), and
`"phase": "day"` during the others.
`{ "kind": "weather", "place": "greek-ship", "condition": "mist" }` holds
while that place's regional weather (`weather.mjs`) is the named condition:
`clear`, `cloud`, `rain` or `mist`.
`{ "kind": "ship_at", "transport": "greek-ship", "dock": "pond" }` holds
while that transport is docked at, or has just arrived at, that dock (not at
sea). `"dock": "@sea"` holds while it sails between ports.
`{ "kind": "chance", "key": "otter", "odds": 12, "lasts": 2 }` holds for one
window of `lasts` turns in about `odds`, picked by a FNV-1a hash of the run
seed, the key and the window, so every table agrees. A place's state
`backdrops` use it for things that simply happen, such as the otter and the
boatman at the Willows landing.
`{ "kind": "any", "conditions": [ ... ] }` holds while any of two to four
conditions holds (nested at most two deep, like `not`). The Willows
crossings use all of these, so the island appears from the ship's rail only
on a misty night while the ship lies at Black Pond or is at sea.

The vocabulary also includes `light`, bounded `not`, and persistent pack
`choice`, `choice_unset`, `flag`, `holding`, `item_at` and `met`, and
`{ "kind": "daylight", "phase": "night" }`, which reads the saved world clock
(day and night swap every 24 turns). Environmental
senses belong on crossings; entity/choice requirements use persistent kinds.
Entity requirements may also use `item_present`, and `any` or `not` whose
leaves are all persistent kinds. `item_at` may name a hub place. A pack thing
whose own requirements name where it rests (`item_at` on itself) is gated
only while it lies there: the Hoppy Cat spool requires
`any(not item_present oil station, not item_at spool station)`, so it shows at
the station only while no oil is there, and a carried spool stays a normal
thing everywhere. Set down at the station again, it is gated again; saves
accept that, because a disabled thing that is gated on its resting place may
have travelled and come back.
To add another kind, update all three places together:
`CONDITION_KINDS` and its shape check in `pack-schema.mjs`, its evaluation in
`conditionMet` in `pack-rules.mjs`, and a test in `test/card-packs.test.mjs`.
Keep each kind a closed, typed descriptor over shared world state.

### Signals

```jsonc
"signal": {
  "steps": [{ "verb": "ring", "item": "bell" }, { "verb": "ring", "item": "bell" }],
  "consecutive": true,     // any other player play resets progress
  "opens": 3,              // turns the crossing stays open after completion
  "refresh": { "verb": "ring", "item": "bell" },  // a play that extends an open window
  "offer": "{actor} rings the Bell again. …",    // wording for a play that continues it
  "progress": ["…"],       // line logged after each unfinished step
  "hint": "…",             // status on the object the next step uses
  "echo": { "speaker": "echo", "text": "bong" },  // one reply after an unfinished step
  "complete": "…"          // line logged when the signal completes
}
```

A step matches a resolved play by `verb` and optionally `item`, `target` and
`from` (the item's holder before the play; `"from": "lamp"` with
`"verb": "take"` means "uncover the lamp"). Only the player's resolved plays
at the crossing's `from` place count. Inspection, reloads, rejected offers and
generated speech never advance a signal. Leaving the place resets progress.
With `"consecutive": false`, other plays leave progress alone. A refresh
play counts from anyone at the place while the crossing is open.

## Saves

A save keeps `crossings` (per crossing: `discovered`, plus `phase` and
`until` for signals) and `packs` (per pack: `revision` and fixture sound
windows). Residents are ordinary actors; a resident with a temperament also
keeps `awake`, `irritation` and `wakeCause`.

When a save is loaded, any mounted pack missing from it is installed fresh:
its residents join with neutral trust and empty memories, and the shore's
items, positions and history are untouched. A changed pack needs a revision
bump and a deliberate migration; never drop saved state to make it load.
`legacy-saves.mjs` holds migrations that name pack ids, including the
schema 6 `steamClock` record and the Greek ship in pack revision 2.

## Rules the engine keeps

- No engine module names a pack, place, resident, fixture or crossing id.
  `test/card-packs.test.mjs` fails if one does.
- Pack art is served by the dev server automatically. The release binary
  embeds files explicitly. Add new art to `v2/orchestrator-rust/src/card_game.rs`;
  its test fails if a mounted pack's image is missing. `smoke-deployed-card-game.mjs`
  reads the media list from the registry.
- Packs and their state stay in the browser save like the rest of the card
  table. Anything shared or server-persisted still goes through the kernel
  and journal first.

## Adding a spoke

1. Create `v2/content/<pack>/card-world.json` and its art under
   `v2/card-game/assets/<pack>/`.
2. Create `v2/worlds/<pack>/card-bridge.json` with a crossing in and one back.
3. Add the pack id to `v2/worlds/card-table.json` and run
   `npm run v2:card:pack:build`.
4. Embed the new art in `card_game.rs`.
5. Add a test that walks the crossing in and back, through a reload. If the
   pack needs a new condition, signal pattern or resident rule, add it to the
   vocabulary as a general rule with its own test, not as a special case.

## Shared opening-release extensions

`signal.while` must hold before and after a counted resolved play.
`opens: null` retains a completed signal while conditions hold; numeric
windows retain Forest behavior. Only the player can advance a signal.
Neither phase nor hint/progress text is exposed by the normal interface.

Crossing scenery may name `overlay`, `cardArt`, `cardName`, and a `focus` for
its replacement backdrop; an optional
`travelLabel` names the immediate action. These use the same open predicate.
Media can be PNG, SVG or WebP under the owning pack folder and is checked
against actual file signatures and both server allowlists.

Packs can own items, internal conditional routes, and typed choices.
A conditional route is a gate: the first time its `requires` hold, the world
records it in `openedRoutes` and it stays open for everyone there (rules 86).
`"live": true` keeps a route a toggle, open only while its condition holds,
like Oak's charm shortcut. `{"kind":"gate_open","from":"a","to":"b"}` holds
once that gate has opened, for a painting that follows it. A pack's
`hiding.pool` lists where a world's hidden avatar may stand
(`{"id":"place","depth":"plain"|"door"|"night"}`, #1936).
A choice can require custody from its acting avatar with
`{"kind":"holding","item":"pack-item","role":"actor"}`. The command actor
supplies this role. A condition with an explicit `actor` keeps that named
character as its subject. Choices can supply `textTemplate` with `{actor}`
for the acting avatar's name; ordinary `text` remains literal.

Effects are choose, set_flag, custody-checked place_item, and three item
moves. `give_item` hands a pack item to the acting avatar. `retire_item`
needs the actor to hold the item; it returns the item, unseen, to its
authored holder with an empty history. `hide_item` belongs only to a
meeting choice. `{"kind":"upgrade","upgrade":"scarf"}`, on a choice with
`for`, adds a one-way cosmetic upgrade to the acting traveler's `upgrades`
set. `{"kind":"upgraded","upgrade":"scarf","role":"actor"}` holds while the
acting traveler has it. Upgrades follow the traveler into every world, per
passkey ([cosmetic upgrades](../../docs/design/cosmetic-upgrades.md)).

A choice with `"for": "<human avatar>"` is offered only to that traveler.
A choice with `"on": "meet"` is never offered as a card. The rules apply it
the first time its traveler shares a room with the choice's subject, unless
a choice receipt already holds that turn; then it waits for the next play
in the room. Its `hide_item` effect places the item in any active place in
the world except the traveler's room. The pick is a stable FNV-1a hash of
the choice, traveler and turn over the sorted place ids. There is no
reachability test. The hidden item becomes the traveler's want, so finding
it is their quest. A choice with `"on": "give"` is also never a card. It is the effect
of the actor giving its subject the item the choice needs them to hold. The
Give is accepted, the choice text is the outcome, and nothing else moves.
A choice with `"on": "hold"` names a pack item as its subject, needs `for`
and requires `{"kind":"holding","item":<subject>,"role":"actor"}`. It
commits after any play once the item's holder is the traveler it is for,
wherever they stand and however the item came to them: a take, a gift, a
trade, or an item held from before the choice existed. It waits a play when
a choice receipt already holds that turn. Its text is logged as narration
and, since it can happen anywhere, it is not a scene fact of its `at` place.
RATi's `forest-wear-scarf-*` choices use it to upgrade a scarf's owner and
retire the scarf.
A choice with `"on": "talk"` is the effect of a human traveler's Talk with its
subject, a person, where the choice's requirements hold. The choice text is
the Talk's outcome. RATi's welcome, `forest-stay-for-tea`, works this way.
The Lonely Forest buttons and welcome use these rules (see
`v2/content/lonely-forest/OPENING.md`).

A choice with `"on": "wait"` is a sign a place shows to a human who
Waits there (the `wait` play). Each Wait commits at most one feasible
sign at the observer's place; its text is the World line. A FNV-1a hash of
the run seed, the place and the pack's receipt count picks among the
feasible signs, so each run notices them in its own order.

A resident with `"travels": false` may list `stayUntil` conditions. While
they hold, it travels like any traveller and can be invited along; when
they stop holding, it keeps to wherever it is (the Swede and his kit).

A choice with `"on": "depart"` has a resident as its subject. It commits when
that resident takes a way out of the pack from the choice's place, and what it
carries stays behind there. Its flag should hide the resident through its own
`requires`: the resident has left the world for good, while the save, journal
and shared views keep its record. A departure waits while the pack already
has a receipt this turn. The Swede leaves this way when he takes the canoe.

Canonical
person identities prevent incompatible embodiments being active together.
Ordered receipts recompute saved choices/flags on loading.

An optional `release` lists opening places, avatars, items and choices.
Fresh saves use opening scope; migrated old Greek games retain full scope.
The allowlist sets which authored content belongs to the current release.

An optional `sections` list groups released places behind lasting story events:

```json
{
  "id": "greek-open-door",
  "name": "The Open Door",
  "places": [
    "greek-athens",
    "greek-piraeus",
    "greek-colonus",
    "greek-eleusis",
    "greek-marathon"
  ],
  "requires": [{ "kind": "flag", "key": "greek-open-door-open", "value": true }]
}
```

Each place belongs to at most one section. Requirements use recorded choices
or flags set permanently to `true`. The schema checks that an authored action
can satisfy them. The gate covers travel, the local cast, objects, fixtures,
and story actions. Held objects keep their section through their authored
home. Saved receipts must place the opening event before section actions.
Older full-scope worlds keep their travel access. Authored action requirements
still apply to their later scenes.

The Open Door uses Greek pack revision 3. Its save upgrade adds the exact new
resident and object IDs while preserving earlier state. The shared interpreter
records this upgrade under rules version 11.

## Observable states in dialogue

A pack can add `observations` to its `card-world.json`. The hub uses the same
field in `card-table.json`. Each definition names an entity, a state source,
and the meaning of its two boolean values. The compiler validates these
records and includes them in `packs.json` for both the browser and the server.

```json
{
  "id": "gate-open",
  "entity": "iron-gate",
  "subjects": ["iron gate"],
  "source": { "kind": "item_flag", "field": "open" },
  "values": {
    "true": { "fact": "The iron gate is open.", "claims": ["is open"] },
    "false": { "fact": "The iron gate is closed.", "claims": ["is closed"] }
  }
}
```

The source reads an existing runtime field. `item_flag` and `actor_flag` read
booleans. `item_positive` checks whether a number is greater than zero.
`covered` checks whether another item rests on the named item. The pack's
existing rules own changes to those fields.

The browser records observations after the whole turn, including autonomous
actions and resource use. It includes states for the entities in the resolved
outcome. The server supplies the authored facts as `direction.observations_now`.
An optional `note` explains how an action relates to the state. For existing
browser tabs, an optional `legacyToken` reads an exact semicolon-separated
field from the older entity facts.

The shared checker compares direct present-tense statements against the pack's
`subjects` and `claims`. It chooses the longest matching phrase. It preserves
questions, wishes and recalled speech. This bounded phrase check covers the
wording a pack declares; the final-state facts guide other wording. Conflicting
character replies receive one rewrite attempt. A second conflict uses the
existing retry UI. Publication follows validation. The Lamp and Badger provide
item and avatar examples of the same path.

### Transport and lamp signals

A bridge can declare `transports`. Each named transport supplies `place` (a
pack place with an empty static exit list), its `docks`, `lanes`, and `at`
(its first dock). A crossing from each dock names it with `transport`.
`travelers` controls who can board. `any` lets hub avatars and residents of
that pack travel between the shores.

`lanes` is the sea: a list of `{ "from", "to" }` pairs between docks. A lane is
two-way unless it has `"oneWay": true`. Each dock has at most four lanes and at
least one lane out; the pack check rejects more. The order of the list decides
each dock's first lane. A new world's dock should join a port that still has a
free lane, so the sea grows outward. A dock may be another pack's place: the
Signal Jetty is Hoppy Cat's, with one lane from Piraeus Quays.

Course cards show only lanes the person knows. A lane can instead list
`opensWith` conditions: such a gated lane is open, both ways, only while they
hold, for everyone aboard, and knowing it opens nothing. The Piraeus–Signal
Jetty lane opens with `pack_item_present` while a Hoppy Cat thing is aboard.
Myrto knows every lane; through Talk she tells a gated lane together with its
condition. A retired crossing closes in every loaded save, including one that
had already found it (shared rules 63), and anyone who had been in Hoppy Cat
learns the jetty lane as knowledge. In a new game every Hoppy Cat thing starts inside Hoppy Cat, so the
jetty waits for things scattered into other worlds.

The ship place uses the existing place cards. At a dock, the ship card offers
Board. Boarding keeps the ship at its harbour. Aboard a docked ship, the other
place cards are course cards: that dock's open lanes, never the dock itself.
The first person to play one sets the course for everyone aboard. The ship
spends the next world round at sea, with no course or Disembark cards. On
arrival the only Disembark card is that port, and only for people who sailed
in. Anyone still aboard can stay for the next course. A ship left docked with
passengers and no course for three world rounds sails its first lane. An empty
ship stays where it was left; a traveller waiting to board at a port brings it
one lane closer each round. The same saved ship serves every actor.
Every place uses the same stage layout, and no CSS is written for a single
place. An optional place `stage` object holds the per-place differences as
data. All of its values are whole percentages of the painting:

- `focus: {x, y}` is the point of the painting kept in view when the screen
  crops it.
- `mark` is where a lone figure stands on wide screens.
- `lamp: {x, y}` marks a dim place. A lamp lit there warms the place, with the
  light pooling at that point.
- `player: false` leaves the player's own avatar off the stage.
- `resident` with `alt` and `sprite` (`left`/`top`/`width`) anchors one
  resident that never travels to the painting itself. The painting moves only
  as far as keeps that resident whole and standing above the hand. Other
  visitors still stand on the floor.

The hub's places in `forest.json` use the same `stage` data.

An optional place `art` supplies its card face separately from its backdrop.

An optional place `music` supplies an ordered playlist of `{file, title}`
records. Each file is an MP3 in `assets/music/`. The room music player uses
the same saved volume and one-second fades for pack locations. Tracks repeat
in order while the player stays in that place.

`musicMode: "random-per-visit"` chooses one track whenever the player enters
the place. That track repeats for the visit. Card plays, pause, and volume
changes keep the same choice. The ship uses this mode for each crossing.

A transport signal uses `opens: null`. Completion summons the transport to
that crossing's `from` dock. The dock remains saved through waits, reloads,
lamp changes, and later sound. If passengers are aboard, the recall waits
until the last passenger finishes the current trip. Then the empty ship
travels to the requested dock.

`signal.while` contains conditions maintained through the sequence. The
Greek bridge requires a burning lamp and quiet throughout
cover → uncover. The lamp needs enough oil for both plays. Each completed signal recalls the ship to Black pond. The ship keeps
waiting after the lamp goes out.

Saves include `transports`, keyed by transport id, at version 3: `phase`
(`docked`, `course`, `sea` or `arrived`), `dock`, `destination`, `riders` (the
people who may step ashore after an arrival), `since` (the round the current
wait began) and `recall`. Save validation checks these against the lanes and
the passengers. Version 2 ships upgrade on load: an occupied ship that had not
landed waits docked for a course, and one that had landed has arrived. Greek revision 1 saves retain partial signals and gain
a ship at the pond when their old sequence includes the second uncover.

## The Willows

The Willows is a four-place horror pack based on Algernon Blackwood's 1907
story. River mist beside the Greek ship's rail opens onto the island. Its places
speak as the landscape; the Swede is its one resident. A place may carry an
optional `voice` (short text) that replaces the one-sentence caption: it then
speaks in its own first person, in up to three sentences, and its scene facts
add `Discoveries recorded so far: N`, the count of plain discoveries (choices
that only set flags) its pack has seen. The rules supply the count; the voice
says how the reasons wear thin as it grows. The landing keeps a
path back to the ship. See [the pack guide](../content/willows/README.md) for the story
choices, source text and art.
[Making the Willows creepier](card-table/willows-horror.md) is the design for
its next horror pass.

### Source lore

Characters speak from world state alone; authored source text is never placed
in a speech prompt. A pack keeps exact source passages as lore files beside
its world, such as `v2/content/willows/lore/readings.json`, for a later pass
to turn into readable books and inscriptions found in play. Rules 60 removed
the older `readings` field, which handed revealed passages to a resident's
dialogue; the Willows choices, flags and receipts that revealed them are
unchanged.
