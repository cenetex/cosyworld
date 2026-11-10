# Radio entry consequence trace

Synthetic seed 17, captured from `createWorld({ opening: true, seed: 17 })`
on main `78098f408ddde1805df206f278a7b1184752b4d7`, then shared creation.
No holders, places, flags, meetings, levels or turns were edited.
`radio-entry-rules-130.json` records the initial shared save, 15 requests and
exact successor worlds. Its SHA-256 fields pin the immutable engine-v130.js
and the accompanying `card-content-rules-130.json` bytes.

Reviewed commands and outcomes:

1. Vale stows the lamp using quiet Hold (no turn).
2. Vale crosses to the pond, takes the Station Key, walks to the station,
   enters Staff Kitchen, drops the key, leaves and enters again.
3. Mara takes and uses her Theatre mask, walks to the clearing, rings the
   Steam Clock, walks to the pond, station and Staff Kitchen.

There are 14 legal plays plus one Hold. The key's take receipt remains, but
its current holder is Staff Kitchen. `station-open` is the only Radio flag.
Mara reaches the kitchen without inheriting custody. Dispatch remains closed;
this unfinished visit does not awaken Raven. Neither traveler was teleported
or equipped with a fabricated gathered-keepsake inventory.

The JS test separately exercises opening/no-opening local saves and current
source-versus-compiled agreement. The existing Rust world-life test module
executes the pinned requests in C-hosted QuickJS, reconnects Mara, rejects a
repeated drop without a journal row, removes checkpoints from its temporary
SQLite database, reopens it and replays the actual journal.

Do not refresh these expected historical worlds to fix a failing assertion.
Investigate the first divergent request. New outcomes belong in a separately
reviewed versioned fixture. This is the first #2520 slice, not its completion:
Raven's full return, Theban public/private knowledge, Forest keep/give and
personal upgrades, pack transitions and broader seeded walks remain open.
