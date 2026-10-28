# Book V: House of Blood

Book V opens after the Open Door account reaches Dione. Myrto offers the
invitation at the harbor. The watchman at the Argive crossroads offers the
three existing household accounts. A saved household choice keeps its route.

This source draft belongs to the combined version 1.2.5, rules 21 and Greek
revision 8. Its base is `d0eed59f437f05467839f287d93c867f9da9d2d7`.
The release coordinator owns the combined merge and release.

## Chapters

| Source                           | Three physical steps                                       | Branches                                                         | Carried return   |
| -------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| Aeschylus, _Agamemnon_           | Fuel for the watch; cup beside Cassandra; household record | All voices; the daughter's claim first; agreed journey to refuge | Household record |
| Aeschylus, _Libation Bearers_    | Libation vessel; recognition signs; witness tablet         | Promised hearing; refusal; tragic account                        | Tomb tablet      |
| Sophocles, _Electra_             | Bread; urn and signet; witness tablet                      | Promised hearing; refusal; tragic account                        | Palace tablet    |
| Euripides, _Electra_             | Water; road bread and invitation record; witness tablet    | Promised hearing; refusal; tragic account                        | Farm tablet      |
| Euripides, _Orestes_             | Water beside the telling; petition; road bundle            | Consented hearing; accompanied passage; source command           | Argive petition  |
| Aeschylus, _Eumenides_           | Refuge branch; court objects; completed record             | Source settlement; dissent; first gift of care                   | Court record     |
| Euripides, _Iphigenia in Tauris_ | Letter copy; childhood cloth; shore rite and record        | Source escape; agreed pact; Iphigenia's choice to stay           | Shore record     |

Each chapter has three deed quests and one return quest. Tauris also records
the placing of water and the local image before the ending. First discovery
uses the latest invitation, account choice and meeting evidence. Each return
requires the actual record and the carrier's published hearing of its final
account. A different human can carry the record, hear its account and return it.

The three agreed walks use ordinary Accompany actions at each edge:

- Housekeeper: palace, tomb, crossroads, refuge.
- Phrygian servant: refuge, crossroads, harbor.
- Furies: Delphi, Athens, Ares Hill.

The household hearing is received by Athena on Ares Hill. Each other household
ending uses its original local witness. The old inquiry choices, six sibling
IDs, three tablets and saved hearing/refusal commitments retain their identity.

## Source frames and game choices

Each play has a named saved frame. A source reading preserves its author,
event order and closing boundary. The physical table adds acts of care,
record keeping and travel. Its new hearings, refuge, dissent and shore pacts
are original game scenes. Their wording states the deed performed and any
work still promised. Source killings are attributed reports within the telling.

Agamemnon's beacon precedes the herald and Cassandra's speech precedes her
entry. The purple path and snaring robe are separate objects. The tomb account
keeps hair, footprints, woven cloth, Cilissa's message and Pylades's advice.
Sophocles's play ends as Aegisthus is driven indoors. The farmhouse account
keeps Electra's doubts about the proposed signs, the scar, the false childbirth
message, lament, separation and future trial. Its Dioscuri name Helen's Egypt
and phantom account.

Orestes is a sixth-day source song. The city sentence precedes the attacks.
Apollo's ending keeps Helen's rescue, the future year's exile and trial, and
his marriage orders. Hermione's assent belongs to the separate game hearing.
Eumenides distinguishes the tied verdict from the Furies' later assent and
honored settlement. Apollo's parentage claim remains his argument.

Tauris keeps Artemis's rescue at Aulis, the letter spoken as a safeguard,
Pylades's immediate delivery to Orestes, further family evidence and the Furies
who still pursue him. The sea turns the escape back. Athena stops pursuit,
orders the captive women's return and names Halai and Brauron. The table's
letter and sacred image are named copies. Its new shore pacts record consent
and future work. A separate saved Aulis ending keeps its own source frame.

## Catalog and compatibility

[HOUSE-OF-BLOOD-IDS.json](HOUSE-OF-BLOOD-IDS.json) lists every new ID.

| Catalog      | Added | Total in this branch |
| ------------ | ----: | -------------------: |
| Places       |     3 |                   66 |
| Characters   |    20 |                   53 |
| Objects      |    26 |                   52 |
| Actions      |   114 |                  263 |
| Topics       |    43 |                   61 |
| Story quests |    28 |                   49 |
| Verses       |    57 |                  113 |

The 56 released stanza definitions remain exact. Engines 2–20 stay frozen.
The revision 7 save upgrade adds the new cast, objects and place memories
while preserving saved custody, source choices and receipts. The coordinator
will join the revision 8 ID lists with the other books.

Twelve approved portraits cover fourteen roles. The two Clytemnestra roles
share one portrait, and the two Pylades roles share one portrait. The court
batch is from PR #1285 at `227399dda93f4ed476a1a797e2c2f98d46913115`;
the witness batch is from PR #1286 at
`a8b5cd606266b41dd1a8509d263390b850780e5a`. Their original PNGs retain the
generated transparency. Each portrait faces left. The game builds a full-size
stage image and a smaller card image from each original.

The source catalog compiles into `v2/card-game/packs.json`. The current rules
21 interpreter and Rust card assets are generated from this source.
[HOUSE-OF-BLOOD-ART.json](HOUSE-OF-BLOOD-ART.json) keeps the fixed queue of
18 portrait files for the 20 roles and three scenery locations. The separate
art handoff adds day and night views for each location and both ship views
at Tauris. The remaining six portraits, objects and scenery use the existing
Greek art while their new images are prepared.
The local temple/shore walk remains part of the Tauris chapter. The combined
ship map will bind its landing to `greek-tauris-shore` and replace this draft
branch's Piraeus/temple entry edge.

## Sources

These public-domain English versions support the source order. All new game
dialogue and verse are original paraphrases.

- [Agamemnon](https://classics.mit.edu/Aeschylus/agamemnon.pl.txt)
- [Libation Bearers](https://classics.mit.edu/Aeschylus/choephori.html)
- [Eumenides](https://classics.mit.edu/Aeschylus/eumendides.html)
- [Sophocles's Electra](https://classics.mit.edu/Sophocles/electra.html)
- [Euripides's Electra](https://classics.mit.edu/Euripides/electra_eur.pl.txt)
- [Orestes](https://classics.mit.edu/Euripides/orestes.html)
- [Iphigenia in Tauris](https://classics.mit.edu/Euripides/iph_taur.pl.txt)

## Validation status

- `node v2/scripts/build-card-worldpacks.mjs` — passed.
- `node v2/scripts/build-card-shared-engine.mjs` — rebuilt rules 21.
- `node v2/scripts/build-card-assets.mjs` — rebuilt 700 card assets.
- `node v2/scripts/build-card-images.mjs --check` — all 208 image sources passed, including exact transparency checks for the twelve new portraits and their display copies.
- `node node_modules/vitest/vitest.mjs run test/card-packs.test.mjs test/card-portrait-facing.test.mjs --maxWorkers=1 --minWorkers=1` — 29 passed. Chapter media paths stay inside their own pack folder.
- `node node_modules/vitest/vitest.mjs run test/card-greek-house-of-blood.test.mjs --maxWorkers=1 --minWorkers=1` — 40 passed. These include all 21 endings and returns, six engine-20 household saves, actual arrival and custody, separate assent, first meeting authorship, second carrier publication, stable shared actor ordering and seven bundled-interpreter comparisons.
- Targeted historical save cases in the Ajax, capacity, section-upgrade and travel test files — 11 passed.
- `node v2/scripts/smoke-card-house-of-blood.mjs` — refuge and keeper paths passed at 1440px and 390px, with actual card pairing, published Talk, carried return, reload, viewport fit and loaded art.
- A separate browser art check selected all fourteen roles at 1440px and 390px. All 28 portrait bindings loaded, each page fit its viewport, and browser and asset errors stayed at zero. Screenshots cover the six locations used by the two portrait batches.
- `git diff --check` — passed.

The native journal test is in `house_of_blood_tests.rs`. It covers the agreed
refuge arrival, a second carrier's source hearing and return, and replay after
checkpoint removal. The focused native run passed at
`b4d6297c5d2da0bc005a4e44b2f4eab7f8bb0ab2`: one test passed in 39.13 seconds.
It used Node 24, one build worker, one test worker, a 16 MiB thread stack and
the isolated target folder `/private/tmp/cosyworld-book-v-native-target`:

```sh
CARGO_TARGET_DIR=/private/tmp/cosyworld-book-v-native-target \
  CARGO_BUILD_JOBS=1 RUST_MIN_STACK=16777216 \
  cargo test --manifest-path v2/orchestrator-rust/Cargo.toml \
  house_of_blood_agreed_arrival_and_second_carrier_replay_from_the_journal \
  -- --test-threads=1
```

The native window has returned to the release coordinator. The full combined
JavaScript and native suites remain part of the chapter release checks. This
PR stays in draft through those checks and the shared ship and art joins.
