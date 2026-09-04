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
