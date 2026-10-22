# Runtime Maintenance

**Status**: Planning. The work below awaits implementation. Production trust,
authority correctness, and the Lantern Keeper proof set its place in the
delivery sequence. Promote one bounded issue when that sequence makes room.

## Resident extraction

Historical references: #61, #255, #324, #325, and #326.

The target is a measured 22–23k lines in `main.rs`. The historical baseline was
63,391 lines at `d874f2b9` on 2026-08-21. Measure the current file before each
extraction. Any later crate split needs its own design.

Continuity and prompt context (#321), wants and attachment policy (#322), and
belief storage (#323) were completed. The autonomy offer work from #327 was
superseded by #833 and #835. The remaining resident sequence is:

1. **Observation and gossip** (#324): move room observation, disproved-memory
   cleanup, movement observation, gossip exchange, and memory projection into
   `residents/observation.rs`.
2. **Trade, gift, and delivery policy** (#325): move item scores, capacity and
   exchange rules, mutual trade, gift and delivery candidates, and willingness
   into `residents/economy.rs`. This follows observation.
3. **Conversation and reply planning** (#326): move prompt and reply seeds,
   direct-observation replies, avatar chat plans, room and card reactions,
   reply filtering, and their owned tests into `residents/replies.rs`.
   Inventory the remaining code after the earlier extractions.

Each PR preserves behavior and visibility, carries the owned tests, and lowers
`v2/scripts/main-rs-line-ceiling.txt`. Keep each diff within 2,500 changed lines.
Split the inventory before implementation when it exceeds that size. Record
the before and after line counts in the PR. Run one extraction at a time.

The wider sequence covers RPG state, economy, persistence, places, actors,
items, and route handlers. The route candidates are actions, authentication,
moderation, and assets. Cross-cutting state and `apply_projection_mutations`
retain their separate design reference in #256.

## HTTP connection reuse and event delivery

Historical reference: #484.

Reuse one `reqwest::Client` with the existing three-second timeout for capacity
presence relays. Store the client on `AppState` and inventory the other client
construction sites before selecting further changes.

Serialize each SSE event once into a shared `Arc<str>` while preserving each
subscriber's visibility checks. Keep the channel capacity at 512 and preserve
the existing close behavior for lagging streams.

Proof for this slice covers client reuse on the presence relay path, shared
serialization, SSE smoke tests, and multiplayer delivery. Run
`npm run v2:rust:test` and `npm run v2:check`.

## Kernel ABI drift guard

Historical reference: the `v2/spine-rust` prototype (#706, #707), removed.

The orchestrator hand-mirrors the C kernel's structs and checks only
`size_of::<CwItem>()` against a literal. Add a small C shim, compiled by
`build.rs`, that exports `sizeof` for every mirrored struct (`cw_world`,
`cw_action`, `cw_event`, `cw_event_buffer`, actor, item, location, exit, gate,
evolution track, combat encounter) and the header's `CW_KERNEL_VERSION`. A Rust
test asserts each matches its `size_of::<Cw*>()` and the Rust constant, so a
header change without a matching wrapper change fails the build.

Snapshot restore should reject arrays longer than their compiled `CW_MAX_*`
capacity rather than truncate them. Confirm current `RuntimeSnapshot` restore
behavior before changing it.

## Replay compares events, not only state

Replay re-derives each record's kernel status and event list. Compare both
against the journaled values on every rebuild and fail closed with "replay
diverged at seq N", so semantic drift becomes a boot error rather than a
quietly different world. The golden fixture tests cover one fixture today, not
every boot.

Write down the rejection taxonomy beside this check. Pre-kernel rejections
(authorization, turn, projection preflight) and kernel invalid-input
rejections leave no journal record. Kernel rule rejections journal a public
`rule.rejected` event, advance no played time, apply no projection mutations,
and do not consume the room turn. Verify each class against the live
orchestrator, then promote the taxonomy into `ENG.md`.

## Commit path consolidation

**Planning**: The spine prototype routed every world mutation through one
`commit(envelope)` with a fixed stage order: authorize, turn preflight,
projection preflight, kernel apply, journal append, projection apply, turn
advance, publish. Cross-cutting concerns such as projection mutations,
resident replies, hosted access, and post-commit intents were envelope fields
rather than function-name suffixes like
`_with_resident_reply_and_mutations`. Post-commit AI and observation work
returned as typed intents and never ran inside the commit. ADR 0008 still
governs how projection mutations declare their writes; a consolidation must
keep replay order in the journal.

A single-owner world loop is the matching concurrency alternative: one task
owns the world, edges send commands over a channel with a reply, and committed
events fan out over broadcast. It would replace the many `lock().await` sites
over the shared runtime mutex. It is unmeasured; benchmark it before it is
designed in.

## Builder inspector

Shared worlds become content operations, and mature MUD and CRPG engines
invest in builders. Add a read-only browser inspector for compiled worldpack
rooms, exits, actors, items, jobs, clocks, and generated cards, backed by
`check-worldpack.mjs --report`. Any later editing is limited to low-risk text
(room text, aliases, clock labels) and saved as reviewable worldpack patches,
never as silent database drift.
