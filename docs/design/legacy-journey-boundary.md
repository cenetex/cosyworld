# Legacy journey migration boundary

Follow-up to G14/P01 in the [state-machine inventory](state-machine-contracts.md),
tested against main `532653fb3`, package 1.2.127, shared rules 129.

## Decision

Do not add a migration fallback for an off-path actor with missing journey
progress. The isolated `indexOf` result of `-1` is real, but the same input
was invalid under the historical rules. No reachable valid-save failure or
affected production save has been established. No private save or journal
was inspected.

Rules 12 through 110 use `validJourneyPlaces`: an agreed traveller must be
on the authored path; without agreement they must be at its first waypoint.
`validatePackStates` checks this during save decoding and accepted play.
[Rules 111](https://github.com/cenetex/cosyworld/commit/65a1a8bbec239c64552f7fae8dde83b9a6a579ae)
replaced that restriction with saved progress so a later visit could preserve
the waypoint independently of location. This is why a current save with
recorded progress may detour, while deleting its progress does not make it
an authentic old save.

## Executed evidence

`test/card-legacy-journey-boundary.test.mjs` loads the checked-in rules-103
opening through unmodified rules 110 and replays 52 recorded legal actions.
The actions include actual agreement, four Accompany edges, a Talk that wakes
Myrine, and the gift completing her household's care. No receipt, waypoint,
or completion is fabricated. The recorded actions are in
`test/fixtures/released-rules/journey-v110-actions.json`.

The opening fixture's provenance is documented in
`test/fixtures/greek-before-funeral/README.md`. Rules 110 and its content at
[a1f0038ac](https://github.com/cenetex/cosyworld/commit/a1f0038ac88294d3ef3dd5fc706cd3e8a7b68c5b)
match the pinned released engine and existing `card-content-rules-109.json`
byte for byte. The test checks their hashes and the opening fixture's hash.

Seven states cover no agreement, agreement, every travelled waypoint and
completed care. Each passes historical validation, the full current save
decoder, round-trip encoding, and both source and compiled shared upgrade.
The checks preserve every actor's location, the agreement/completion receipts,
event log and sequence, turn, and basket custody. Shared upgrade alone advances
the revision by one. Off-path corruption is rejected by both old and current
decoders. After upgrade, detours preserve partial and completed progress.

These are JS runtime/save-boundary checks, not native QuickJS, HTTP, browser
or production-journal coverage. They do not prove every historical content
revision is safe; existing retired-road migration tests remain relevant.

## Future changes

If an authentic historical save fails, preserve it as a fixture and identify
the precise content migration before choosing recovery. Keep consent, actor
location and completed evidence; never infer completion from a convenient
fallback or a later visit. `pack-journeys.mjs` is in the shared engine import
graph, so changing migration semantics needs an engine-labelled design note
and a newly generated rules version. This characterization changes neither
runtime rules nor released bundles and does not claim the pending lamp's
rules130 slot.
