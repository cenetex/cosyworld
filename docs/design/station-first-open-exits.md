# Station exits: first open, maximum three

The owner clarified on 2026-11-08: at most three active exits, including Black Pond.
Pond is permanent. The first two other eligible ways stay until they close.
Waiting ways stay hidden. Simultaneous openings use authored order; reopened ways go last.
Train/home doors need their belonging nearby; BoardyAI also needs two humans present.
RatiRadio's earned entrance stays permanent, with its flag and item progress intact.
Before it is earned, a physically present key carrier must make it eligible.
Saved stationExitOrder includes waiters. Reads never mutate it. Creation, accepted
plays, upgrades and journaled presence settle it. Older saves initialize in authored
order without changing possessions or progress. Rust already journals enter, leave
and release: rules125 settle admission in those events, never on GET/view. Replay
uses the same events; earlier rules retain their original behavior and bundles.
