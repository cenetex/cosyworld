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
for personas, so ids and voices cannot drift between them. One validator
(`v2/card-game/pack-schema.mjs`) runs in the build and again when the table
loads. It rejects unknown fields, unknown condition kinds, dangling ids and
missing art with a reason naming the field.

Packs can also supply `storyQuests` and `topics`. The
[story quest guide](card-story-quests.md) covers saved evidence, branches,
spoken clues and ordered knowledge requirements.

### Personal quest situations

`situations` gives visitors generated personal quests that belong to the pack.
`v2/card-game/pack-situation-schema.mjs` checks them in the build and on load.
Each template has:

- `id`, `name` and a `purpose` sentence of at most 200 characters;
- `kind`: `delivery`, `gathering`, `crossing` or `answer`, so hopes count it
  like the hub situations;
- `takers`: `"visitors"` (the player, shared human avatars and pack residents
  with `personalQuests`) or named avatars;
- `requires`: optional pack conditions that must hold before it is offered;
- `roles`: a map with a required `partner`. A role is one of
  `{"item": [ids]}`, `{"avatar": [ids]}`, `{"place": [ids]}`,
  `{"holder": "$itemRole"}` or `{"placeOf": "$role"}`. The first fitting id in
  the list wins;
- `steps`: one to four hands, or `{"any": [hands]}` with two to four hands.
  A hand has `at` (required), `hold` (up to three items), `with` (up to two
  people) and `conditions` (up to three of `heldBy`, `knows` with a pack topic,
  `together`, and `lit`, `ringing` or `covered` with the hub lamp or bell);
- `consequence`: optional `{"kind": "trust", "avatar": ...}` on the last step.

Hands name pack or hub ids directly, or a role as `"$name"`. A template needs
an item, a person and a condition or consequence. A visitor gets a template
only when every place, person and item in it is within reach now; an `any`
step keeps its reachable hands. Steps with `knows` wait for Talk, so only an
avatar with a personal life (whose quiet spells bring a fresh purpose) takes
them. The result is an ordinary saved program, so later template changes do
not change saved quests.

## The pack source

```jsonc
{
  "schemaVersion": 1,
  "id": "badger-forest",            // stable; also the asset folder name
  "packId": "cosyworld.badger-forest",
  "revision": 1,                     // bump only with a save migration
  "name": "The Steam Clock",         // shown as the table's title while inside
  "description": "…",
  "entry": "clearing",               // the place the hub's crossing reaches
  "places": { … },
  "fixtures": { … },                 // optional
  "avatars": { … }
}
```

**Places** have `name`, `text` (card text), `persona` (for generated
description), `exits` (other places in this pack only) and `backdrop`. An
optional `stage` shows one resident as a sprite on the backdrop in place of
the shore's cast row. `sprite` gives left/top/width percentages of the
backdrop. Only a resident that never travels can be staged.

**Fixtures** are things fixed in a place that the player can use from the
place card. Today a fixture can sound:
`"sound": { "label", "text", "turns" }`. A sounding fixture counts as a sound
at its place for crossing conditions and disturbs residents there. `{actor}`
in `text` is replaced with the player's name.

**Avatars** (residents) have `name`, `text`, `place`, `persona`, `voice`
and `tastes` (`likes`, `sore`, `reason`, and optional `noise`, a grievance
recorded when a bell is rung beside them). Residents never receive the
shore's authored quest programs; their interest is their home.

- `"travels": false` keeps a resident at home. It is never invited along
  and the planner leaves it in place.
- `"standoffs": false` means it cannot be threatened.
- `portrait` is its art, unless it has a temperament.
- `presentation: "backdrop"` keeps a fixed resident in the place illustration.
  Its card, dialogue and interactions keep their usual place in the game.
  The stage paints the resident once, through the place art. The default
  `figure` presentation uses the separate portrait.

A **temperament** gives a resident moods that general rules change:

```jsonc
"temperament": {
  "asleep": true,      // starts asleep
  "irritation": 3,     // maximum irritation
  "irritated": 2,      // at or above this, the "irritated" variant applies
  "voice": 1,          // talking to it while asleep wakes it at this irritation
  "sound": 2,          // a sound made where it rests wakes it and adds this
  "calm": 1,           // each player wait beside it removes this, and eases grievances
  "woken": "…",        // narration when talk wakes it
  "disturbed": "…"     // narration when a sound disturbs it
}
```

Its `variants` (`asleep`, `awake`, optional `irritated`) supply the portrait,
alt text, greeting (`{actor}`, `{name}`), an optional play label, the current
want, and the note that tells the text model how to play this mood. The
irritated variant inherits the awake portrait and greeting.

## The bridge

```jsonc
{
  "schemaVersion": 1,
  "id": "shore-badger-forest",
  "pack": "badger-forest",
  "description": "…",
  "values": { "badger": { "lamp": 3, "cloth": 7 } },  // unlisted hub items are worth 1
  "crossings": [ … ]
}
```

A **crossing** joins one hub place and one pack place in one direction:

A crossing can also join a place in another mounted pack. The compiler checks
that the external place exists. A passage from a ship keeps the vessel's saved
dock and its other passengers. The last passenger through a side passage
settles any pending recall, and a return to the deck joins its current voyage.

| Field              | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `id`               | Stable id; its saved state is keyed by it.                                             |
| `from`, `to`       | One hub place and one pack place.                                                      |
| `travelers`        | `"player"` (no one else follows or is asked along) or `"any"`.                         |
| `travel`           | Wording after "goes to X": `"through the reflection"`, `"aboard the ship"`.            |
| `requires`         | Conditions that must hold now.                                                         |
| `signal`           | Optional. A sequence of plays that opens the crossing for a few turns.                 |
| `scenery`          | Optional `open` / `closed` sentences appended to the `from` place's text.              |
| `opened`, `closed` | Optional lines logged when the crossing opens or closes while the player is at `from`. |

A crossing is open when its signal window is open (if it has a signal) and
every condition holds. The bridge must have a way in to the entry and a way
back to the hub. A crossing marked `"retired": true` stays open only in saves
that had already found it; new games never open it. Hoppy Cat's red thread
from Black pond is retired this way, so new games reach Hoppy Cat by ship.

### Conditions

| Kind                                  | Holds when                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `{ "kind": "sound", "at": [places] }` | A sound is audible at any listed place: the hand bell ringing uncovered there, or a pack fixture sounding there. |

`{ "kind": "item_present", "item": "cloth", "place": "attic" }` checks an
item's physical place. It follows custody through covered items and their
carrier. Hub and pack items can use this crossing condition. An item on the
floor and an item held by someone in that room satisfy the same condition.

`{ "kind": "pack_item_present", "pack": "hoppycat-archive", "place": "greek-ship" }`
holds while any thing from that pack is in the place: resting there, or
carried by someone present there.

The vocabulary also includes `light`, bounded `not`, and persistent pack
`choice`, `choice_unset`, `flag`, `holding`, `item_at` and `met`. Environmental
senses belong on crossings; entity/choice requirements use persistent kinds.
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

Crossing scenery may name `overlay`, `cardArt`, and `cardName`; an optional
`travelLabel` names the immediate action. These use the same open predicate.
Media can be PNG, SVG or WebP under the owning pack folder and is checked
against actual file signatures and both server allowlists.

Packs can own items, internal conditional routes, and typed choices.
A choice can require custody from its acting avatar with
`{"kind":"holding","item":"pack-item","role":"actor"}`. The command actor
supplies this role. A condition with an explicit `actor` keeps that named
character as its subject. Choices can supply `textTemplate` with `{actor}`
for the acting avatar's name; ordinary `text` remains literal.

Effects remain choose, set_flag and custody-checked place_item. Canonical
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

Course cards show only lanes the person knows. A lane can also list
`opensWith` conditions; while they hold, the lane opens from its `from` port
for everyone aboard. The Piraeus–Signal Jetty lane opens with
`pack_item_present` for a Hoppy Cat thing on deck. Myrto knows every lane and
tells them through Talk. Hoppy Cat revision 2 saves keep a red thread they had
already found, and anyone who had been in Hoppy Cat learns the jetty lane.

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
cover → uncover → cover → uncover. The lamp needs enough oil for all four
plays. Each completed signal recalls the ship to Black pond. The ship keeps
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
speak as the landscape; the Swede is its one resident. The landing keeps a
path back to the ship. See [the pack guide](../content/willows/README.md) for the story
choices, source text and art.

### Source readings

An optional `readings` list gives a resident exact source passages as the story
unfolds. Each record has `id`, `actor`, `after`, `title` and `text`. `after`
names a choice receipt; `null` reveals a passage on first entry. A pack can
hold eight passages of up to 3,000 characters each. The browser sends the
revealed ids and their turns. The server reads the exact text from its own
catalog and gives those passages to that resident's dialogue. Saved receipts
preserve the same knowledge after a reload and shared journal replay.
