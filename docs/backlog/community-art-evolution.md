# Community Art Evolution

Status: first vertical slice shipped in the Rust/browser implementation; production hardening remains.

## Product decision

Orbs exist to help the community make shared images. They do not pay for Chat or any other world verb.

Every eligible generated collectible has one community generation available at each authoritative level. The pooled Orb price is exactly the level. A level-3 location therefore needs three community contributions in total, not three from every player. Funding never changes ownership, access, mechanics, rarity, success, or level.

The generated image belongs to the public card. Its prompt uses the card identity and public event history through the funding sequence. When the collectible later reaches a new level, the newly unlocked image can evolve in response to the history accumulated since its previous image.

## Implemented slice

- Chat and repeat Listen/Notice have no Orb affordability check, debit, or refund path; Chat's separate cost is one banked advancement point.
- `community_image_generation` is the only negative Orb reason emitted by new player actions.
- Eligible subjects are generated human avatars, runtime-generated items, and familiar generated pathway locations.
- Card state exposes `level`, `required_orbs`, `funded_orbs`, `remaining_orbs`, `status`, and `history_through_seq`.
- `POST /actions/fund-image` accepts one Orb per request, journals the contributor and funding mutation atomically, caps the pool at the level, and does not advance the room turn.
- Provider absence fails before debit. Fully funded failures/retries do not debit again.
- Replicate generation is asynchronous. A committed ready result swaps the card to the shared generated asset with a level cache key.
- Funding and status survive snapshots and action-journal replay. In-flight job de-duplication is currently process-local.
- The existing keepsake modal shows pooled progress and provides the contribution/retry action; no separate currency UI was added.

## Groomed backlog

### P0 — production safety

- Move generation into a durable `media_jobs` queue with leases, retries, dead-letter state, and startup recovery for fully funded jobs.
- Store assets in durable object storage and retain immutable `{subject, level, revision}` provenance instead of replacing one local file.
- Add an automated invariant/alert: every new negative Orb ledger row must have reason `community_image_generation` and a matching accepted funding mutation.
- Add moderator reject/replace controls. Rejection and replacement must never charge the community again.
- Record provider/model/prompt version, history range, contributor totals, source funding event, output digest, and moderation status in the media asset record.

### P1 — complete the collectible model

- Make level authoritative for generated items and locations, not just avatars. Define the gameplay event that advances each type; Orb funding must never advance it.
- Decide whether one level unlock applies per card identity, per shard-local instance, or per canonical collectible. Default: canonical shared subject for locations/avatars; instance for materially distinct crafted items.
- Add history-delta prompt construction so level N emphasizes events since level N-1 while retaining stable visual identity.
- Add optional reference-image composition from the prior ready level to preserve recognizability across evolution.
- Let contributors inspect the public history summary and cost before contributing, without exposing raw prompts or private/moderation data.

### P2 — community and operations

- Show contributor attribution and funding completion in the public Journal/chronicle without turning the room transcript into a transaction feed.
- Add operator views for funding funnels, provider failures, generation latency, retry count, cost per ready image, and abandoned partial pools.
- Establish refund policy only for permanently cancelled card identities. Provider failure alone is retryable and should not refund/recollect.
- Consider contribution amounts greater than one only if the one-Orb press becomes burdensome; preserve exact pooled cap and idempotency.

## Acceptance invariants

1. A zero-Orb avatar can Say, Listen, Help, travel, fight, grow, and manage cards; it can Chat whenever banked advancement makes that friendship action available.
2. For subject `S` at level `L`, accepted contributions total at most `L` Orbs and at most one image becomes ready.
3. Concurrent/replayed contribution requests cannot overfund, double-debit, or create multiple generation jobs.
4. A provider outage, invalid subject, invisible card, completed level, or retry after full funding debits zero Orbs.
5. The prompt is derived only from committed public history through a recorded sequence.
6. A ready image changes presentation only; mechanics and ownership are byte-for-byte unaffected.
7. Reaching level `L+1` creates a fresh pool of `L+1` Orbs while preserving the prior level's provenance.
