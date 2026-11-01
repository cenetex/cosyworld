# Small worlds, alternates and specials

Status: design, 2026-10-31. No implementation yet. Issue #1622. Related: #1548 (content
outside the engine), #1618 (Hoppy Cat deadlock), #1605 (dead pack data),
[ship voyages and scattered things](ship-voyages-and-scattered-things.md).

## Outcome

Each world is a small map that a player can hold in their head.

- **Core.** A world has a fixed core of two or three places. The core is the
  storybook map. It is the same in every game.
- **Alternates.** A place has several paintings. Committed state picks one:
  time of day, weather, a story choice or flag, who is present, which item is
  present, or visits. Many of today's separate places become alternates of one
  place. Roads become travel paintings, not places.
- **Specials.** Each run (a new game) draws a few extra places, avatars and
  items from the world's pool. The draw uses the game seed. In shared play the
  whole table has one world, so it has one seed and one draw. The journal
  records the draw, so replay never draws again.

The number of specials per world depends on the art we have. Every existing
painting stays in use, as a core painting, an alternate or a special.

## Why

The 2026-10-31 map analysis counted 89 place IDs. With every gate open, 43%
of live places are dead ends and 68% of links are bridges. Every region is a
tree. The Greek world alone has 61 enterable places in 9 communities, joined
by single links. A player sees long corridors of one-exit rooms. Most of the
Athens and Argos rooms have no painting, no resident and, after #1605, no
choice.

## Art audit (origin/main 4f0f86cb)

Counts are source files under `v2/card-game/assets/`, not the optimized
copies. "Unwired" means no pack field, rule or presentation table selects the
file. Template references (`<id>-card.png`, `-uncanny` copies, scarf
portraits) count as wired.

| World         | Place paintings (wired + unwired)   | Portraits            | Item art         | Places without a painting        |
| ------------- | ----------------------------------- | -------------------- | ---------------- | -------------------------------- |
| Forest hub    | 6 + 2 (`attic-lit`, `attic-doused`) | 3 (+ keeper right)   | 4                | 0                                |
| Greek         | 61 + 5                              | 27 + 5               | 26               | 25 of 67, on 10 SVG placeholders |
| Hoppy Cat     | 10 + 0                              | 16 (+16 cutouts)     | 10 (+10 cutouts) | 0                                |
| Willows       | 11 + 4 night                        | 4 poses (+4 uncanny) | 8                | 0                                |
| Lonely Forest | 4 + 0                               | 4                    | 17 + 3           | 0                                |
| Badger Forest | 1                                   | 2 variants           | 0                | 0                                |
| BoardyAI      | 1                                   | 1                    | 1                | 0                                |

Greek place paintings in use: 32 day backdrops, 3 ship-at-berth crossing
backdrops, 23 night backdrops and 3 docked-night backdrops. The Attic road
painting serves 8 IDs and the Ajax camp painting serves 4.

Unwired paintings:

- Greek places: `harbor-day`, `athens-harbor-empty`, `open-door-agora`,
  `city-gate-closed-day`, `city-gate-closed-night`.
- Greek portraits: `book-three-achilles`, `-clytemnestra`, `-iphigenia`,
  `-neoptolemus`, `-philoctetes`. No avatar uses them yet.
- Willows nights: `landing-night`, `camp-dark-night`, `thicket-night`,
  `bank-night`.
- Attic: `attic-lit`, `attic-doused` (the attic README asks for a story
  decision first).
- Lonely Forest items: `dewbright-button`, `story-button`, `watch-bell`.
- Duplicates, not paintings: four root `*-card.jpg` copies and
  `ajax-sources/ajax-camp-day.png`.

The gap is all Greek. These 25 places use SVG placeholders, and none of them
is in the release scope: the six Agora rooms, the Attic Farm, Acharnae, the
Divine Heights, the Hoopoe's Thicket, the Underworld Landing, the Argolid
Crossroads, all four Atreid places, Corinth, Troezen, Delphi, the Scythian Crag
and five roads (Oeta, Sacred Way, Royal, Black Sea, Colonists'). Argos has one
painting (the Argive Shore Sanctuary).

Avatars: four Greek portraits are shared by 10 avatars (Electra and Orestes
three times, Helen and Menelaus twice). Each copy is one account of the same
person, gated by a choice, so they already behave like alternates.

## Per-world proposal

| World         | Core places                                  | Alternates                                                                                                                                                                                   | Specials pool                                                             | Draw per run (place / avatar / item) |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| Forest hub    | Empty station, Mirror attic, Black Pond      | Attic: lit, doused, dark, stairs. Pond: ship overlay                                                                                                                                         | none; Badger Forest and BoardyAI keep their own gates                     | 0 / 0 / 0                            |
| Hoppy Cat     | Halfway Tea Garden, Signal Jetty             | none painted yet                                                                                                                                                                             | 8 places with their residents and items; 13 residents; 7 items            | 2 / 1 / 1                            |
| Willows       | River Landing, River Camp, Crumbling Bank    | Landing: day, night, ship in mist, uncanny. Camp: day, fire lit, fire out, uncanny. Bank: day, night, uncanny. Willow Thicket becomes the Camp-to-Bank travel painting (day, night, uncanny) | none                                                                      | 0 / 0 / 0                            |
| Lonely Forest | Cosy Cottage, Rain-Soft Garden, Old Oak Tree | none painted                                                                                                                                                                                 | Moonlit Trail (with Skull and the charm); 3 unwired item paintings        | 0-1 / 0 / 1                          |
| Greek         | 24 nodes in five cities (below)              | see the merge table                                                                                                                                                                          | 10 far places (9 painted); 5 unwired portraits once they have avatar data | 2 / 0-1 / 0                          |
| Badger Forest | Forest Clearing                              | Badger asleep, awake                                                                                                                                                                         | none                                                                      | 0 / 0 / 0                            |

Notes:

- **Hoppy Cat.** The core gains a direct Tea Garden and Signal Jetty link.
  Hoppy Cat and Tapi Lilt live in the garden and staticwashere lives on the
  jetty. A drawn place brings its own residents and items, so it is never
  empty. Two drawn places form a loop: Garden, first special, second special,
  Jetty, Garden. The avatar special is a resident of an undrawn place. They
  visit the Tea Garden. The item special is a thing from an undrawn place.
  Everything has art, so the draw is limited only by legibility: four places
  on screen.
- **Willows** is already small. Its gain is the four unwired night paintings
  and a loop: Landing, Camp, Bank, back to Landing along the shore. The camp's
  fire-out painting needs a flag. The owner picks it.
- **Lonely Forest.** The trail stays a mystery. Its draw slot has a "nothing"
  weight, so the trail appears in some runs only. The three unwired item
  paintings need item data. Check #1441 first, because it may already plan
  them as buttons.
- **The human cast is never drawn.** The eight shared avatars and their homes
  are fixed. The C session guard depends on their order.

## Greek merge (61 enterable, 67 IDs, to 24 core nodes)

Each city gets a loop with a harbour, a palace, a temple and one strange
place. Two specials per run give 26 nodes. The full pool gives 34.

| Result                 | Count | IDs                                                                                                                                                                             |
| ---------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core node              | 24    | listed below                                                                                                                                                                    |
| Merged as an alternate | 19    | folded into a core node                                                                                                                                                         |
| Travel painting        | 7     | Theban Harbor Road, Athens–Piraeus Road, Sacred Way, Oeta, Royal, Black Sea, Colonists'                                                                                         |
| Already retired        | 7     | `greek-road-athens-harbor` and the six unenterable Attic roads. Delete them from content (alpha).                                                                               |
| Special pool           | 10    | Aulis, Thracian Shore, Taurian Temple, Court at Susa, Sicilian Cave, House at Trachis, Palace of Pherae, Thetis's Sanctuary, Trojan Night Camp, Scythian Crag (no painting yet) |

Core nodes keep a stable ID. An alternate may override the place's `name`
and `text`. "Fold" means saved actors, items, visits and route knowledge on
the old ID move to the node, as `foldRetiredRoads` does for roads today.

### Thebes: 7 nodes

| Node (kept ID)                          | Role    | Merged in        | Paintings by state                                                                              |
| --------------------------------------- | ------- | ---------------- | ----------------------------------------------------------------------------------------------- |
| Wine-Dark Harbor `greek-harbor`         | harbour | none             | open berth day/night; ship at berth day/night; `harbor-day` on first arrival (owner to confirm) |
| Theban Courtyard `greek-courtyard`      | market  | none             | day, night                                                                                      |
| Theban Market Well `greek-well`         | well    | none             | day, night                                                                                      |
| Palace Forecourt `greek-palace`         | palace  | none             | day, night                                                                                      |
| City Gate `greek-gate`                  | gate    | none             | open day/night; closed day/night while the guard holds the decree (#1614)                       |
| Exposed Battlefield `greek-battlefield` | strange | none             | dusk, night                                                                                     |
| Hillside Sanctuary `greek-sanctuary`    | temple  | Cithaeron Slopes | dawn, night; Cithaeron once the Theban response is chosen. The Bacchae work moves here.         |

The Courtyard, Well and Gate loop stays. Aulis becomes a special that hangs
off the Gate. The Harbor Road becomes the harbour-to-courtyard travel
painting.

### Athens and Piraeus: 6 nodes

| Node                                 | Role                   | Merged in                                                                                    | Paintings by state                                                                                                                            |
| ------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Piraeus Quays `greek-piraeus`        | harbour                | Athens Harbor                                                                                | open berth, ship at berth (day/night); Athens Harbor set after the Open Door opens; `athens-harbor-empty` while the ship is away              |
| Athenian Agora `greek-athens`        | civic heart and palace | Assembly Hill, Acropolis Treasury, House of Demos, Thinkery, Juror's House, Women's Festival | grand agora day/night; `open-door-agora` after the Open Door; one civic-event alternate per room, in turn by day period, once each is painted |
| Colonus Grove `greek-colonus`        | grove temple           | Underworld Landing                                                                           | day, night; the descent at night (needs a painting). The Ferryman is present only at night (entity `requires`).                               |
| Eleusinian Sanctuary `greek-eleusis` | temple                 | none                                                                                         | day, night                                                                                                                                    |
| Marathon Altar `greek-marathon`      | altar                  | none                                                                                         | day, night                                                                                                                                    |
| Attic Farm `greek-attic-farm`        | strange                | Acharnae Market, Divine Heights, Hoopoe's Thicket                                            | farm, market, heights, thicket alternates (all need paintings)                                                                                |

Athens Harbor carries no residents or items. Merging it removes a dock and
the Athens Harbor to Piraeus lane. #1601 and #1609 are changing that lane
now, so this merge waits for them and for an owner decision. The six rooms,
the farm group and the Underworld have no items. After #1605 the rooms have
no choices. Only the Ferryman moves. The Athens loop (Agora, Colonus,
Marathon) needs an Agora-to-Marathon link. #1618 left that to the owner,
because of the map rule.

### Argos: 4 nodes

| Node                                           | Role               | Merged in                                            | Paintings by state                                                                                                                                                 |
| ---------------------------------------------- | ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Argolid Crossroads `greek-argolid-road`        | town gate          | none                                                 | needs a painting; it keeps the three Atreid choices                                                                                                                |
| House of Atreus `greek-argos-palace`           | palace             | Agamemnon's Tomb, Mycenaean Palace, Argive Farmhouse | by `greek-atreid-account`: aeschylus shows the tomb, then the Argive palace after the hearing; sophocles shows the Mycenaean palace; euripides shows the farmhouse |
| Argive Shore Sanctuary `greek-argos-sanctuary` | harbour and temple | none                                                 | suppliants day                                                                                                                                                     |
| Corinthian Courtyard `greek-corinth`           | strange            | Troezen Palace                                       | Corinth; Troezen after the Medea work is heard (owner to confirm)                                                                                                  |

The six Electra and Orestes copies already require their account choice, and
so do the three witness tablets. In one place they never meet. Their choices
change only `at`. A new House-to-Sanctuary link makes the Argos loop. The
Sicilian Cave becomes a special at Corinth, through the Colonists' Road
travel painting.

### Troy: 5 nodes

| Node                                     | Role            | Merged in                           | Paintings by state                                                                                                        |
| ---------------------------------------- | --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Trojan Camp Landing `greek-ajax-landing` | harbour         | none                                | Ajax camp day/night                                                                                                       |
| Greek Camp at Troy `greek-greek-camp`    | camp            | Ajax's Household Tent, Ajax's Grave | the same painting today; tent and grave alternates when painted. Tecmessa lives in the camp. The grave choices move here. |
| Trojan Walls `greek-troy`                | city and palace | none                                | day, night                                                                                                                |
| Helen's Shore `greek-troy-beach`         | strange         | Proteus's Tomb in Egypt             | by `greek-helen-account`: egypt shows the tomb, troy shows the beach (day/night)                                          |
| Lemnian Cave `greek-lemnos`              | strange         | none                                | day, night                                                                                                                |

Helen's Shore stays on the Wine-Dark Harbor route, as both places are now.
A Walls-to-Landing link makes the Troy loop. The Night Camp, Thrace, Tauris,
Susa and the Crag become specials off the Walls, along the Royal and Black
Sea travel paintings.

### Delphi and the ship: 2 nodes

Delphic Temple `greek-delphi` keeps the Delphic Attendant and needs a
painting. The Sacred Way is its travel painting from the Agora, and the Oeta
road leads to the northern specials (Trachis, Pherae, Thetis). The Greek ship
deck stays as it is.

### Avatar specials

The five unwired portraits become avatar specials once they have avatar
data: Philoctetes and Neoptolemus at Lemnos, Iphigenia at Aulis or Tauris,
Clytemnestra at the House of Atreus, and Achilles at the Greek Camp. That is
an authoring step, with personas and wants. It is not part of this design.

## Rules and data

### Alternates are presentation

Alternates read committed state only, so local and shared tables show the
same painting. They never change a rule.

- New narrator-side data, `v2/content/<pack>/paintings.json`, compiled into
  `v2/card-game/paintings.json`. It stays out of `content.json`, because no
  rule reads it.
- A place lists `paintings`, in order. The first entry whose `requires` holds
  wins, as resident `poses` do today. An entry has `art`, and may have
  `night`, `name`, `text` and `focus`.
- Conditions reuse `conditionMet`: `flag`, `choice`, `choice_unset`, `day`,
  `night`, `weather`, `item_present`, `actor`, `holding`, `met` and `any`.
  One existing crossing kind, `ship_at`, and one new display-only kind,
  `visits` (it needs the saved visit count).
- Travel paintings: `travel: [{from, to, art, night}]`. The move between two
  places shows the painting.
- `backdrop()` in `scene.mjs` reads `paintings` first. The hard-coded tables
  then become data: `nightBackdrops`, `dockedNightBackdrops` and
  `darkMistBackdrops` in `daylight.mjs`, the `darkAttic` case, and crossing
  `scenery.backdrop`. A parity test proves that every current place and state
  draws the same file before and after.

```json
{
  "greek-gate": {
    "paintings": [
      {
        "art": "city-gate-closed-night.webp",
        "requires": [
          { "kind": "flag", "key": "greek-gate-closed", "value": true },
          { "kind": "night" }
        ]
      },
      {
        "art": "city-gate-closed-day.webp",
        "requires": [
          { "kind": "flag", "key": "greek-gate-closed", "value": true }
        ]
      },
      { "art": "city-gate-day.webp", "night": "city-gate-night.webp" }
    ]
  }
}
```

(The flag key is a placeholder; #1614 names the real one.)

### Later: found variants

Planning, not built (presentation and art, no rule change). When an abandoned
player avatar becomes a resident, a seeded draw from `world.run.seed` and the
avatar id can give it a rare painted variant of its portrait. It is found by
meeting that resident, never farmed, bought or rerolled, and it changes no
rule, level or want.

### Merges and travel roads are content

- A road that becomes a travel painting is marked `retired`, and its ends get
  a direct link. `localRoads` and `foldRetiredRoads` already fold saved
  travellers. This needs no rule change.
- A merged place gets `foldInto: <node>`. It is disabled like a retired road,
  and saves fold onto the node. This is a small, generic rule change. It is
  part of the specials engine step below. Encoding a merge as a fake road is
  not allowed: no interim fallbacks.
- Residents, items and choices move by changing `place`, `holder` and `at`.

### Specials are rules

The pack declares its pool in `card-world.json`:

```json
"specials": {
  "draw": { "places": 2, "avatars": 1, "items": 1 },
  "pool": [
    { "id": "hoppycat-prism-foundry", "rarity": "common", "anchor": "hoppycat-halfway-tea-garden" },
    { "id": "hoppycat-glim-twice", "rarity": "rare", "anchor": "hoppycat-halfway-tea-garden" },
    { "none": true, "rarity": "uncommon" }
  ]
}
```

- **Seed.** `world.run.seed` is a 32-bit integer set once, at create. Shared:
  Rust derives it from the world ID (SHA-256, first four bytes) and passes it
  in the `create` request. Local: the browser makes one at New Game and keeps
  it in the save. Nothing reads a clock or `Math.random` inside the rules.
- **Draw.** For each slot, take a weighted draw without replacement. The
  hash is `seed : packId : kind : slot` (the same kind of hash as the scatter
  design). The weights come from the card tiers: common 8, uncommon 4, rare
  2, epic 1, legendary 0 (legendary is never drawn; it is earned). A `none`
  entry lets a slot stay empty.
- **Record.** The result is saved as `packs[id].specials`, next to the
  planned `packs[id].scattered`. The create row is the seed record, so the
  journal holds the draw. Replay reads it and never draws again.
- **Late packs.** A pack mounted later, by `upgrade` or `repack`, draws in
  that command with the same seed. A repack keeps earlier draws and drops IDs
  that left the pool. It never redraws.
- **Enable.** `entityEnabled` returns false for a pool entity that was not
  drawn. A place entry also brings its residents and items. A drawn place
  links to its anchor through a route with the new condition `drawn`. Pool
  routes between two drawn places make the loop.
- **Shared play.** One world is one run. Every client renders the same
  `packs[id].specials`. The C session guard is unchanged, because humans are
  never drawn.
- **Scatter.** The scatter design (step 4 of the ship voyages note) uses the
  same seed. It chooses items only from the core plus the drawn specials.

### Reachability rule

Every core place must be reachable for every seed. A test runs the
reachability check from the map analysis over 1,000 seeds. A drawn special
may stay out of reach behind a story gate. That is allowed, because mystery
comes before reachability.

### Compatibility

- Released bundles (v2 to the current rules) keep their bytes. Their journals
  replay unchanged.
- Under the specials engine, `upgrade` gives an old world its seed (from the
  world ID), draws, and folds merged places, all in one journal row.
- Alpha local saves may be dropped. A local save without `run` starts a new
  game rather than migrating.

### Engine and content impact under #1548

| Change                                 | Engine bundle              | Content revision | Narrator |
| -------------------------------------- | -------------------------- | ---------------- | -------- |
| Alternates and travel paintings        | no                         | no               | yes      |
| Road to travel painting                | no                         | yes              | yes      |
| Merge (`foldInto`)                     | once, in the specials step | yes, per merge   | yes      |
| Specials (schema, draw, `drawn`, seed) | one bump                   | yes, per pool    | no       |
| Rust: seed in `create` and `upgrade`   | no                         | no               | no       |

After the one engine bump, every world's merges and pools are content-only
PRs.

## Pilot

### Hoppy Cat first

0. **Wait for the #1618 fix.** A separate change starts one Hoppy Cat item
   outside the archive, so the Piraeus-to-Signal-Jetty lane can open.
   Coordinate with it: that item must be a core item and stay out of the
   pool, and the Signal Jetty must stay core. Then the lane opens in every
   run.
1. **Alternates (narrator only).** Add `paintings.json` and the
   `backdrop()` lookup. Move the hard-coded day, night, docked, mist and dark
   attic tables into data, with the parity test. Wire the closed gate (after
   #1614) and the Willows nights.
2. **Specials engine (one bump, `engine` label).** Add the schema, seed,
   draw, `drawn` condition, `foldInto`, and the seed field on Rust's `create`
   and `upgrade`. Tests: the same seed gives the same draw in the browser and
   in QuickJS; replay; upgrade; the 1,000-seed reachability check.
3. **Hoppy Cat content.** Make the core the Tea Garden and the Signal Jetty,
   with a direct link. Put the other eight places in the pool with their
   residents and items. Set the draw to 2 / 1 / 1. Test on `.dev` from a
   fresh game and from two shared clients on one world.

### Then Argos

0. **Art.** Paint a matched House of Atreus set from one composition, as the
   attic lit and doused pair was made: tomb, Argive palace, Mycenaean palace
   and farmhouse. Then paint the Crossroads and Corinth with Troezen. Argos
   has only one painting today, so the pilot cannot start without these.
1. **Content.** Fold the three Atreid places into `greek-argos-palace`, with
   paintings by account. Add the House-to-Sanctuary link. Make the Colonists'
   Road a travel painting, and make the Sicilian Cave a special.
2. **Release.** Add Argos to the Greek release scope once it is painted.

The rest of the Greek merge follows city by city: Troy, then Athens (after
#1601 and #1609), then Delphi.

## Owner decisions

- Which state shows `harbor-day`, the Willows fire-out camp, Cithaeron and
  Troezen.
- Whether Athens Harbor merges into Piraeus.
- New in-town links: Agora to Marathon, Walls to Landing, House of Atreus to
  Shore Sanctuary, and the Willows shore path.
- The draw counts and rarity weights per world.
