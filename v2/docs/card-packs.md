# Card-table world packs

The card table's shore is a hub. Black pond is its crossing point, and each
world the player can find from it is a **world pack** joined by a **bridge**.
Finding a new path is the game, so a new path should cost a pack, a bridge and
some art, not new engine rules.

The Steam Clock clearing (`badger-forest`) is the reference pack. Copy its
shape for the next spoke.

Fresh `/make` visits open Lantern Shore from `authoring-sample.mjs`: three
places, two avatars and three items. Returning the bell to its keeper opens
the garden. The first draft save stores the eight existing paintings with
the edited source and launch place. Saved local drafts reopen by their key;
a missing explicit draft link offers the sample through the descriptor.

`installWorldDesigner` in `authoring-designer.mjs` joins the card tree, fields,
Undo and draft saves in one workspace. Inject tools, verified art and scene callbacks.

`authoring-accepted.mjs` prepares accepted avatars as guarded source edits plus
immutable output JSON and image assets. Adopt the result, then pass its full asset
Map to `store.write` with the expected generation. Earlier bytes support Undo.

The authoring card index is `buildAuthoringTree({pack, bridge})` in
`authoring-tree.mjs`. It returns ordered `cards`, `roots`, and `children`.
Each card has its source array path, a parent `holder`, a `kind`, and a `role`. Reference
cards point to a canonical card through `ref`; external targets keep their ID.
Contents boxes show initial placement. Elsewhere keeps external holders in reach.
Quest, road, and transport records retain their source order and nested paths.
Each place and avatar has Contents and Quests boxes. Incoming road conditions
live under the destination's Quests box; outgoing links stay in Contents.
The index leaves the source intact. Edit commands use those paths separately.
The designer projects this index through `authoring-collections.mjs`: World
opens Items, Avatars and Locations. Contents references lead to canonical cards.
`chooseWorld()` and `chooseTools()` expose the two views to existing header controls;
Tools holds source details and maintenance cards. Collection navigation keeps an armed box.
Each entity keeps its common fields and operation boxes in view; a Details stack
holds its further source fields with their original IDs and paths.
Names, text, art paths and custom fields sit below their entity or world card.
Nested objects and arrays keep their branches. Identity fields use the field
editor's read-only rules, and generated paths keep their hidden markers.

`authoring-controller.mjs` owns local selection, box targeting, edit sequence,
and the last 50 inverse edits. `createAuthoringState(source)` copies the source;
`reduceAuthoring(state, event)` accepts `select`, `arm`, `cancel`, `apply`,
`edit`, `setLaunch`, and `undo`. `authoringAction(state)` supplies a label and
an edit preview; pass its `sequence` and `key` with `apply`. Selecting a location
sets the launch sidecar. While a box is armed, that selection becomes its target
and branch navigation keeps the box armed. The workspace owns expansion.
A location's Quests box takes three selections: its box, the approach location,
and the required item. The action replaces the direct walk with an item opening;
the return path stays as authored. Choosing another approach clears the item.
Existing openings keep their condition cards, and ships use dock and lane cards.
Source changes clear the selection; Undo restores the exact source and advances
the local sequence. Server draft revisions stay with persistence.

`authoring-fields.mjs` adapts scalar field cards for the descriptor.
`authoringField(source, card)` captures its path, type, displayed value and
action label. `authoringFieldEdit(source, field, text)` returns one expected-value
source edit for Save; a boolean uses the same call with no text for Enable or
Disable. Integer fields keep safe whole numbers; decimal fields keep finite
numbers. Nulls, identities, type tags and reference lists stay read-only.
Filter cards and branches with `authoringFieldHidden(card)` before rendering;
this checks paths once and keeps internal text out of accessible names.
Identity and type fields (`id`, `namespace`, `packId`, `schemaVersion`, `kind`,
and `type`) stay in the source while their field cards are hidden. Entity names
in the places, avatars, items, and transports collections remain visible.
Condition and reward parent cards keep their readable labels.
Internal generation fields also have `hidden: true`. The controller applies the
returned command and records its inverse. Pack compilation checks game meaning.

Open `/make` to edit a local draft, import a world, and choose its starting place.
Source, Save, Undo and Reload use the card table and its descriptor.

## Files

The `/make` and `/make/` authoring URLs serve the card-table document with its
`/card-game/` asset base. Those page responses permit GitHub API and raw-file
requests, plus local blob images for imported art. Play URLs retain their
current content security policy. Both the local JavaScript server and the
Rust server use these routes.

Authoring drafts keep the original pack and bridge together with the writer's
document. `card-game/authoring-draft.mjs` reads and exports their version 1
manifest. A draft has its own server ID and revision; imported pack IDs stay
intact. Asset records hold a relative path, MIME type, SHA-256 and byte size.
File bytes go through a separate upload. Source records keep local relative
paths or a GitHub repository, exact commit and path. Drafts accept unfinished
cards; publication checks the compiled pack with the shared pack validator.

Private drafts use `/card-game/authoring/packs` under the passkey account.
`POST /card-game/authoring/generate/avatars` uses that account and same-origin guard.
Send `{sample:{section,start,end,text},excluded:[names]}` from `sampleSource`.
The configured Haiku route returns `{candidate,model,usage}`; candidate is one
`readCharacter` record or `null`. Passages, evidence and prompts stay transient.
Each request gets one provider attempt; the client reviews and saves approved
output fields. The service allows one active request per account, two globally.
Create accepts the seven content fields and optional `launch`; the server supplies
`id` and `revision`. PUT `/:id` accepts the same content plus `expectedRevision`.
It saves source and launch together and returns the nine-field draft. A stale
save returns 409 with the latest `revision`. GET `/:id/launch` returns
`{revision, launch}`; readers compare its revision with their source revision.
Launch is `{schemaVersion:1, place}` with a place ID from the pack. Omission on
save preserves it; `null` clears it. A preserved launch must stay in the new
source. Launch selects the initial location while `pack.entry` and transport
home docks keep their authored meanings. A ship deck is a valid launch place.

`authoring-session.mjs` owns fields, source text, Undo, saves and guarded tools.
Use `stage({document,title})` to keep text, `snapshot({pending:false})` to read it, and `save()` to check and persist the draft.

`importSourcePack({files, packPath, bridgePath, cardRoot, extraPaths, origin})`
in `authoring-source-import.mjs` reads selected raw repository files. It returns
`{draft, assets, sourceFiles, assetSources}` with exact source bytes and digests.
The card directory defaults to the sibling `card-game/` for `content/<pack>/`
sources, or the pack directory. `cardRoot` selects another relative directory.
`extraPaths` adds card-relative lore files. `origin` is `{kind:"file"}` or
`{kind:"github",repo,commit}` with an exact commit. Media keeps its card path;
`assetSources` records each repository path. `sourcePackCandidates(files)`
indexes up to 100,000 file entries; each import reads up to 512 media files.
Extra music files keep their bytes; portable playback also needs the catalog
adapter's room-to-track mapping from `music.mjs`.

| File                                | Owns                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `v2/worlds/card-table.json`         | The hub's own places, avatars and items, the player id, its start and switchable groups, and the list of mounted packs. |
| `v2/content/<pack>/card-world.json` | The reusable world: places, residents, fixtures. It never names the hub or another pack.                                |
| `v2/worlds/<pack>/card-bridge.json` | How the pack meets the hub: entries, crossings, their conditions and signals, and how residents value hub objects.      |
| `v2/card-game/assets/<pack>/*.png`  | The pack's art. Every media path in the source must point here.                                                         |
| `v2/card-game/packs.json`           | Generated. All mounted packs with their bridges, validated. Do not edit by hand.                                        |

```sh
npm run v2:card:pack:build   # regenerate v2/card-game/packs.json
npm run v2:card:pack:check   # fail if it is stale or invalid (part of v2:worldpack)
```

### Portable local drafts

`authoring-local-import.mjs` reads selected browser Files or `{path, file}`
entries from a local adapter. `importLocalDraft({files, manifestPath})` opens
an exported authoring draft, with asset paths relative to its manifest folder.
It returns a fresh local `draft`, an `assets` map of exact file bytes keyed by
manifest path, and `sourceFiles` containing the original manifest bytes and
digest. The helper checks every declared file's size and digest before returning.
Pack and bridge IDs, extra source fields and earlier provenance remain intact.
`localPackCandidates(files)` lists `card-world.json` paths for a later source
pack resolver. The caller chooses an explicit manifest path for portable import.

The browser imports `packs.json`, and the Rust text route embeds the same file
for profiles, so ids and seeds cannot drift between them. Each avatar has one
`seed` sentence, a name and a role such as "The Swede, a traveller on the
river.", and no `persona` or `voice` ([seed sentences](card-table/seed-sentences.md)). One validator
(`v2/card-game/pack-schema.mjs`) runs in the build and again when the table
loads. It rejects unknown fields, unknown condition kinds, dangling ids and
missing art with a reason naming the field.

Packs can also supply `topics`: facts a resident tells through Talk.

An item's `text` can carry a piece of a story, such as the words scratched
inside the Willows stew pot. The first 240 characters reach the item's holder
in Talk, thoughts and dreams. Use a short passage that makes sense on its own.
Giving the item passes the passage to the new holder.

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
carrier. Hub and pack items can use this crossing condition, and a pack may
name a thing of another mounted pack (rules 94): the Willows mist beside the
Charybdis's rail names the Greek `greek-provisions` aboard `greek-ship`. An
item on the floor and an item held by someone in that room satisfy the same
condition.

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

### Entries

Each bridge declares `entries`, its ways in, as `{"joins", "at", "arrive",
"via"}`: `joins` is `hub` or another pack, `at` that side's place where this
pack's travelers come out, `arrive` this pack's place where they enter, and
`via` the existing crossing between the two, whose own conditions govern
passage. A pack's `entry` is its start. The hub declares its `start` and
`switchable`, the named groups of packs a world may switch off, in a fixed
order. The build checks that every place is in its pack's release and every
crossing is live, and gathers the entries into the hub as `packEntries`, so
no pack schema changes. [Rules 98](../../docs/design/rules-98-pack-toggle.md) reads them; earlier rules ignore them.

| Pack                                    | Joins: at → arrive (via)                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| The Reflected Shore (`hub`)             | no entries of its own; start: Black pond                                                |
| Cosy Cottage (`lonely-forest`)          | hub: attic → cottage, the lamplit attic with the black cloth or a scarf                 |
| The Wine-Dark Sea (`greek-drama`)       | hub: pond → harbour by the Charybdis; Hoppy Cat: Signal Jetty → Piraeus by its ship     |
| Hoppy Cat Universe (`hoppycat-archive`) | hub: pond ↔ tea garden by the red thread, open only outward; the Sea: Piraeus ↔ jetty |
| The Steam Clock (`badger-forest`)       | hub: pond → clearing, the bell sounding at the pond                                     |
| The Willows (`willows`)                 | hub: pond → landing by canoe; the Sea: the Charybdis's rail → landing on misty nights   |

The hub's entries are its packs' hub entries seen from the other side.
Hoppy Cat has no live way in of its own: the pond's thread into the tea
garden is retired, so travelers enter by the Charybdis from Piraeus. It
stays ship-only: its switchable group is `reachedBy` the Sea's, so it
sleeps while the Sea is off. Boardy's
parlour and the shared homes are mounted outside `packs.json` and declare no
entries.

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

From rules 93 a saved world gains a slot for each new place, dock, item,
crossing, route, lane, topic or transport as it loads. The server repacks
every shared world onto the current content when it loads it, so a change a
saved world cannot take makes every shared world unloadable. A new resident
is one: **do not add a resident to a pack that is already mounted.** Put it
in a new pack, which installs fresh, or bump the pack's `revision` and add a
save upgrade to `legacy-saves.mjs` that adds that resident's actor, trust and
memories (as `upgradeGreekHomecomingSave` did), shipped in a rules release.
Removing a place or a gated route is another: saves keep each opened gate
(`openedRoutes`) and each known step (`routeKnowledge`), and validation
refuses one the content no longer authors. Retire the place with
`retired: true` instead of deleting it, and add a pack revision upgrade that
calls `foldRetiredRoads` and drops gates that no longer latch (as
`upgradeGreekLandRouteSave` did for the Coast Road in rules 94).
Withdrawing a region from the release (a rumour, as Marathon and Troy became
in rules 94) is a third: the pack check needs its choices out of the
release list too, and a world of the release refuses withheld residents or
things that moved and receipts of withheld choices. The upgrade brings
visitors back, sends the region's own people and things home unmet, and
`reconcilePackProgress` forgets the withheld steps and what followed from
them; old full-scope worlds keep the region.
`test/card-content-repack.test.mjs` loads a world saved on main's content
under the branch's rules and content, so the fast check fails such a change
before it merges.

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

## Content review standard

When a scene says the player chose, reconciled, understood or became
something, the rules must preserve that difference. If the rules keep only
that a deed happened, word the scene as the deed, not as a choice.

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

Effects are choose, set_flag, custody-checked place_item, and four item
moves. `give_item` hands a pack item to the acting avatar. `retire_item`
uses an item up (below); the actor must hold it, or the choice must require
it `item_near` or `item_at` its own place. From rules 98 it uses only the
actor's own item or one lying at the place, never one another person holds.
`drop_item` brings a used-up item
back at the choice's place. `hide_item` belongs only to a
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

### Things used up and coming back (rules 95)

Every item is one record with one id, so a world never holds two of
anything. From rules 95 a used-up item is out of play: its id is listed in
the save's `usedUp`, and it waits unseen, with no history, at its authored
`holder`. Using an item up clears every grievance's link to it, its keepsake
attachments and a standoff's stake, so a regrown loaf cannot answer an old
theft. Item conditions (`item_present`, `item_at`, `item_near`, `holding`) ignore it.

Item fields:

- `home`: a place of the pack where the item belongs.
- `regrow`: `dawn`, `dusk` or `rest`. A used-up item with a `home` and
  `regrow` reappears at home on the next such event: the next light change
  of that kind, or any long rest ending. It never regrows while it is in
  play, and it waits while its home or its own `requires` are inactive.
- `startsUsed: true`: the item starts used up, for a thing someone makes.
- `absentReturn: true`: at dawn the item also leaves an absent traveler's
  hands for home (a human avatar whose holder is not present, from the
  journaled presence). It is off unless a pack marks it, pending the owner's
  decision on absence penalties.

At dawn a homed item lying unheld away from both its home and its starting
`holder` is noted in the save's `astray`; if it still lies there at the next
dawn, it goes home. A kit item may lie anywhere.

```json
"greek-figs": {
  "name": "Dried Figs", "holder": "greek-sanctuary",
  "home": "greek-sanctuary", "regrow": "dawn", ...
},
"greek-provisions": {
  "name": "Travel Provisions", "holder": "greek-harbor",
  "home": "greek-harbor", "startsUsed": true, ...
}
```

A give choice can require a set and repeat. With `"repeats": true`, an
`"on": "give"` choice may fire again whenever its one `drop_item` output is
used up. Its effects are only `retire_item`, `drop_item` and `set_flag`. It
fires when the actor gives the subject any item of the set while holding the
whole set; no new verb. A slot may be an `any` of `holding` conditions: any
one of them fills it, and only the item given is used up. The choice keeps
one receipt, the turn of its latest firing. A resident whose `want` is that output wants it as a
maker: Talk names the set ("I want the Travel Provisions: the Courtyard
Bread, the Dried Figs and the Wine Skin."), and the resident leaves the
output for others to carry.

```json
{
  "id": "greek-pack-provisions",
  "subject": "greek-shipmaster",
  "at": "greek-harbor",
  "on": "give",
  "repeats": true,
  "requires": [
    { "kind": "holding", "item": "greek-bread", "role": "actor" },
    { "kind": "holding", "item": "greek-figs", "role": "actor" },
    { "kind": "holding", "item": "greek-wine-skin", "role": "actor" }
  ],
  "effects": [
    { "kind": "retire_item", "item": "greek-bread" },
    { "kind": "retire_item", "item": "greek-figs" },
    { "kind": "retire_item", "item": "greek-wine-skin" },
    { "kind": "drop_item", "item": "greek-provisions" }
  ]
}
```

A lane with `"spends": true` uses up the cargo that opened it when the ship
arrives: each `item_present` item aboard, the first open alternative of an
`any`, and one homed thing from a `pack_item_present` pack. Only a homed item
is ever spent. A spending lane is one-way with a free lane back, and that
return voyage leaves loose homed things on deck at the quay it sails from.

A pack's `kits` scatter its things. When every item of a kit lies at its
home, the kit's event (`on`: `dawn`, `dusk` or `rest`) moves each item to one
of `places` (any mounted place that is active), each place taking one item
until all have one. The pick hashes the run seed, the kit, its scatter count,
the turn and the item, so every replay agrees. `requires` may hold it back.
The save counts each kit's scatters in `scatters`.

```json
"kits": [{ "id": "willows-kit", "on": "dawn",
  "items": ["willows-paddle", "willows-rope", "willows-sheet"],
  "places": ["greek-harbor", "forest-cottage", "hoppycat-garden"],
  "requires": [{ "kind": "flag", "key": "willows-swede-gone", "value": false }] }]
```

A gated route may show a sealed card. While the route is shut from `from`,
`to` appears as a locked wooden box: the locked lid
(`assets/card-back-locked.webp`) on a red edge, labelled only "Locked", with
no painting and no name. Selecting it
shows `reason` in the context button, and its play, Seek the way, gives the
traveller the route's quest at once, as picking a quest does (no turn
passes). The quest is a story quest: hold or give an item (`to` names who to
give it to), reach a place, or talk with a person. Once the route opens, the
box turns over once, the next time it is in view, and the card is an
ordinary travel card from then on (`locked-box.mjs`).

```json
{ "from": "greek-gate", "to": "greek-battlefield", "requires": [ ... ],
  "sealed": {
    "reason": "The guard lifts the bar for an order from the palace: the Burial Decree or Creon's writ.",
    "quest": { "kind": "item", "target": "greek-decree", "to": "greek-guard" } } }
```

The pack check proves the loops cannot strand a world. An item used up by
one choice and still needed by another choice, a route, a lane or a
resident's `stayUntil` must renew: it regrows at home, or a repeating give
makes it from items that renew. A repeating give's inputs and a spending
lane's cargo must renew too, and a spending lane needs its free way back.

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
hold, for everyone aboard, and knowing it opens nothing. Cargo is checked
aboard; only a `spends` lane (above) uses it up. The Greek ship is the Charybdis, on the Black Pond
route (rules 94): Black Pond and the Wine-Dark Harbor both ways with no
cargo; harbor to Piraeus and Piraeus to the Signal Jetty one way, each with
one `any` of `item_present` (the Travel Provisions) and `pack_item_present`
(a Hoppy Cat thing) aboard; and a free one-way lane back for each. The
conditions bind only a voyage a human rides: with no human aboard, a
resident aboard sets the course to its own destination along any lane
(rules 96), and an empty ship called to a dock
sails any lane between active docks. A ship idle for `IDLE_ROUNDS` with
someone aboard, at a dock whose cargo lanes are all shut, is stuck: it puts
in at its home port (`at`) and everyone aboard goes ashore (rules 95),
except a player the port has no room for, who stays aboard (rules 98). A ship route should give every dock a
free lane toward home, so a traveler ashore there is never stranded:
`test/card-ship-port-roads.test.mjs` searches every walk, carry and free lane
from every dock the empty ship can be called to. Myrto knows every lane; through
Talk she tells a gated lane together with its condition, an `any` as its
choices ("Travel Provisions or something from Hoppy Cat"). A retired crossing closes in every loaded save, including one that
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

A transport may name the Wait played aboard while it is under way (course set
or at sea), when each round passed carries the voyage on: `waitVerb` is the
button label and `waitSentence` the beat sentence, with `{actor}` once for the
person. The Greek ship uses `"Sail"` and `"{actor} sails on."`. The two come
together; the verb is a capitalised word of up to 24 letters, and the sentence
is plain text of up to 80 characters with no markup. A docked ship keeps Wait,
because a wait there moves nothing, and a transport without the pair keeps
Wait throughout. Only the table's words change: the rules action and journal
stay `wait`. Older rules bundles reject these keys, so the field ships with a
rules version.
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

Import cards list local or GitHub sources, then save the chosen world and its
assets as a fresh local draft. Portable files keep their source document.
