# The Wine-Dark Sea

A Greek drama card-world pack reached from Black Pond. The first release is
**Before the Burial**, a compact Theban episode with seven painted places.
The traveler retains their identity, belongings, memories and decisions.

## Opening release

A new game exposes the Wine-Dark Harbor, Theban Courtyard, Market Well,
City Gate, Exposed Battlefield, Palace Forecourt and Hillside Sanctuary.
Each has distinct generated scenery. Seven local residents support the
opening: Myrto, Antigone, Ismene, Creon, the guard, Dione and the chorus elder.
The player can refuse involvement, visit a quiet sanctuary or return home;
no completion checklist governs departure.

The `release` allowlist selects opening places, residents, items and choices.
New saves store `scope: "opening"`; schema-6 Greek saves migrate to `full`
scope so existing travelers are not stranded and their histories remain
available. This is content-release composition, not a player-facing meter
or a new condition to solve. Existing valid saves are never reset to make
the smaller release load.

## Sources and shared runtime

`card-world.json` is canonical author data: 49 places, 21 resident definitions,
13 objects, 79 typed choices and 44 work records. Five works support the
existing Theban, Helen and Atreid episodes. The other 39 remain situated
hooks in the source; **their empty inquiry actions are withheld from fresh
opening play**. No inquiry journal is added.

The Forest implementation owns the shared `pack-schema.mjs`,
`pack-rules.mjs`, registry, Steam Clock fixture and Forest Clearing behavior.
This pack extends that same closed vocabulary with items, account choices,
receipt validation, and signal conditions. It does not retain separate
hardcoded Greek/Forest gates in `world.mjs`.

`v2/worlds/greek-drama/card-bridge.json` connects the reusable pack to the
hub. `v2/worlds/card-table.json` selects both packs. One compiled file,
`v2/card-game/packs.json`, supplies the browser and Rust's trusted personas.
There is no separately generated Greek module or raw-source persona copy.

```sh
npm run v2:card:pack:build
npm run v2:card:pack:check
```

This remains the existing **browser-local deterministic card table** with
localStorage saves. It is not a new shared server journal or multiplayer
runtime. Server-authoritative integration still requires C-kernel/replay work.

## The crossing

At quiet Black Pond, cover and uncover the fueled lit Lamp with Black cloth
twice. Only the four resolved player transitions count. The shared signal's
`while` conditions require a lit fueled lamp at the pond and no sound at
the pond or clearing. Its route additionally requires the lamp uncovered.
Leaving, losing the flame/fuel or nearby sound cancels the signal. Restoring
light or quiet does not silently complete a canceled sequence.

Internal phase survives reload; the player sees no phase, counter, recipe,
first-flash ripple or progress reassurance. The actual ship appearance and
Board option use the same predicate and are rechecked on commitment. The
return from the harbor stays available without the entry lamp.

## Dramatic actions and compatibility

Before the Burial supports returning water, hearing the decree, arranging
a witness, staging a shovel, supplying cloth and oil, burial, petition,
permitted burial, refusal, reporting, and later public disclosure. Object
custody and witnessed events matter. Generated speech cannot perform an
unrecorded murder, burial, hearing or voyage.

Each opening quest card has one short line. The Bard carries the growing
poem. Finishing a quest brings him to the next room the player enters.
Talking to him supplies every earned verse through that visit, in order.
Permission adds a verse while the burial quest stays open. A later rite
adds another verse and opens a return to tell Dione about the grave.
See the [exact copy list](OPENING-POEM.md) for the three card lines and every
branch of the bard's song.

The legacy/full scope retains the two Helen accounts and three Atreid
accounts. Mutually exclusive embodiments share `canonicalPerson` identities;
the chosen account controls its route, cast and evidence. Saved receipts
replay choices and flags in turn order; invalid/inconsistent histories are
rejected. Inactive embodiments cannot be moved or assigned invented history.

Conditions are closed descriptors. Choice effects remain `choose`,
`set_flag` and `place_item`; placement requires current custody at the action
location. No script in the content can spawn, kill, teleport or spend money.

## Scenery and presentation

Seven generated paintings replace shared SVG backgrounds in the opening.
The pond ship is a masked generated ship/rigging/reflection layer over the
**unchanged original pond**. The original mirror, trees, building, shore and
camera remain. The boarding portrait was generated from the original pond,
the transparent ship layer and the archive's review sheet. It matches the
ship, mirror and nighttime setting.

`assets/greek-drama/scenery-provenance.json` records generation IDs, source
names, transformations, dimensions and runtime checksums. Seven backdrops
are full-frame WebP derivatives; the ship layer is an alpha PNG. Fifteen
existing transparent character portraits remain intact. Later/legacy places
still use their original SVG backgrounds. **Weather and night alternates
are not integrated**, and no weather clock or countdown has been added.

Cards remain large art and small names. Controls describe immediate actions,
not puzzle solutions. Optional conversation history contains spoken lines,
not objectives. Accessibility descriptions must follow the same observable-
only boundary. Internal simulation fields are retained for save compatibility;
this does not claim that all points-based mechanics have been redesigned.

## Checks

```sh
npm test
npx vitest run test/card-theban-release.test.mjs
node v2/scripts/smoke-card-theban-scenery.mjs
node v2/scripts/smoke-card-image-first.mjs
node v2/scripts/smoke-card-greek-drama.mjs
node v2/scripts/smoke-card-clearing-access.mjs
```

The Theban tests cover exactly seven reachable places, hidden inquiries,
return paths, real schema-6 saves, migration of a halfway signal, evidence
and history preservation, media checksums and HTTP MIME types. Historical
fixtures were created with commit `25e7777`, not invented schema shapes.
Browser tests use fixture speech, not paid live-model output. Rust formatting,
Rust tests and actual desktop/mobile playthroughs are separate release gates;
JavaScript tests alone do not establish them.

See `ATTRIBUTION.md` for repertoire and translation boundaries.
