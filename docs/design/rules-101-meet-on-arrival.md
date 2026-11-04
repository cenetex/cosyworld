# Rules 101: meeting a resident who arrives

Issue [#2248](https://github.com/cenetex/cosyworld/issues/2248). Owner
approved the fix for the next rules bump (2026-11-04).

## Bug

At dawn and dusk the resident round (`residentRound` in
`v2/card-game/world.mjs`, rules 100) moves residents with `travel` and logs
"X arrives.", but never calls `meetCast`. The only caller of `meetCast` is the
end of `act`, and a Wait returns before it. In a local save `knownActors`
reads `s.opening.met`, and every person play (Talk, Threaten, Give, Invite)
loops over `knownActors`, while the hand shows every present resident. So a
resident who walked in dealt into the hand with no plays until the player's
next non-Wait play. Shared worlds were mostly unaffected: their
`knownActors` starts from `s.actors`, though the pack's `met` record also
waited.

## Rule

When the round moves a resident into the current player's place, the round
calls `meetCast` for that place, on that turn. The newcomer joins
`s.opening.met` and its pack's `met` with this turn, so:

- Talk and the other person plays are legal at once, also after only Waits;
- the "first meeting (the newcomer)" speech occasion can fire on arrival;
- a resident who arrives where no player is stays unmet.

Before the opening is crossed `meetCast` keeps its own rule (only travellers
are met), and the round does not move travellers, so the opening is
unchanged.

## Versions and replay

The change is in a module of the shared bundle, so it mints rules 101
(`engine-v101.js`). Rules 100 stays byte-identical and is pinned in
`test/card-released-rules.test.mjs`; journals recorded on 100 replay on 100.
No field is added: a rules 100 world upgrades to 101 with nothing to migrate,
and meets the next arrival. `next-shared-rules.mjs` now names rules 100 to
199 (`HUNDREDTH`, `HUNDRED_FIRST`, ...).

## Tests

- `test/card-meet-on-arrival.test.mjs`: the elder walks into the courtyard at
  dusk after only Waits, or after Talks with another resident, and Talk is
  offered that turn; nobody is met where the player is not; the browser and
  the `engine-v101.js` host commit the same worlds and replay, and rules 100
  still does not meet on arrival.
- `card_shared::meet_on_arrival_tests` (Rust): the meeting commits and replays
  from the journal in the C QuickJS host, here and reopened, and a rules 100
  world upgrades to 101 and meets on arrival.
