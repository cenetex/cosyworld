# Canonical world runtime contract

CosyWorld’s official service is one persistent world. Capacity processes,
regions, room owners, and pack bundles are replaceable machinery behind that
promise. [ADR 0003](../../docs/decisions/0003-one-canonical-world.md) is the
normative decision; this page turns it into rollout and test gates.

## Current and target shapes

Today, one Rust orchestrator owns the in-memory C kernel and one SQLite event
store. It is a valid single-writer seed of the canonical world, but it is not a
horizontal multi-writer design. Production must keep one task/machine while
this storage mode is active.

The target separates five responsibilities without changing player identity:

```text
public route / invite / profile
              |
       capacity processes
              |
    canonical command gateway
       /       |        \
room owner  room owner  account owner     (fenced leases)
       \       |        /
    canonical journal + projections        (one history)
```

- A **world** owns stable identities and durable history.
- A **capacity process** terminates HTTP/SSE and may host an owner, but can be
  replaced without moving a player to another world.
- A **region** is a routing and failure boundary.
- A **partition owner** is a fenced writer for a bounded entity set.
- A **pack composition** is one version-locked content input to the world.

`COSYWORLD_PROCESS_ID` labels a replaceable process in `/meta`.
`COSYWORLD_V2_SHARD_ID` and `/meta.deployment.shard_id` remain compatibility
aliases with the same value; startup fails if both environment variables are
set differently. Do not use either label in URLs, persistence keys, actor
identity, invitations, claims, or player copy.

## Consistency classes

| Data | Minimum guarantee | Read path |
| --- | --- | --- |
| Room/location, occupants, floor item, turn | Linearized per partition; public result receives global event order | authoritative owner or versioned projection |
| Actor location and held world item | Atomic with origin/destination changes | canonical entity version |
| World item | Exactly one live disposition | authoritative entity version |
| Orb/reward/claim | Idempotent, transactional, account ordered | canonical ledger |
| Journal | Account ordered; settled public causes reference public event ids | private account projection |
| Pact/covenant | Versioned and atomic across membership changes | authoritative pact owner |
| Public room history | Immutable total order inside `world_epoch` | replayable event projection |
| Presence/typing/heartbeats | Ephemeral and eventually consistent; never world truth | regional fan-out |
| Pack composition | One active hash for all writers | deployment/migration record |

Presence may briefly lag. Item ownership, affordability, access, action
eligibility, and committed story outcomes may not.

## Command envelope

Horizontal-capacity implementation must carry a logical envelope equivalent to:

```json
{
  "world_id": "world://cosyworld/official",
  "intent_id": "opaque-idempotency-key",
  "actor_ref": "world://cosyworld/official/actor/opaque-id",
  "observed": {
    "actor_version": 18,
    "location_version": 402
  },
  "last_world_seq": 92811
}
```

The committed receipt adds `world_epoch`, `world_seq`, affected entity versions,
and the owner fencing epoch. Transport retries reuse `intent_id`. A capacity
process cannot replace or infer the authenticated actor reference from a local
session alone.

The current `POST /commands` request carries this object under `envelope` and
returns it as a top-level `receipt`. `/state` and `/world` expose `world_id`,
`world_epoch`, `world_seq`, canonical entity references, and entity versions;
each public event carries its own `world_id`, `world_epoch`, and `seq` tuple;
numeric ids remain compatibility handles for the in-process kernel. Authored
entities keep their `pack://` references. Runtime actors, items, locations,
journals, and pacts use opaque `world://cosyworld/official/...` references that
survive snapshot and action-journal replay. Browser commands always send the
envelope. Legacy callers without one receive a server-minted compatibility
intent and a receipt marked `compatibility_envelope`; this bridge must not be
used for transport retries.

SQLite is now the durable canonical commit point. Every journal mutation
atomically writes its action record, globally ordered events, affected entity
versions, newly claimed idempotency keys, command receipt, owner fences, and
outbox jobs. Reusing an intent with a different envelope fails closed, exact
retries return the stored response, and stale observed versions return `409`
before dispatch. A response lost after append can therefore be recovered from
the receipt without executing the effect again.

Each process has a boot-scoped authority owner id. Before mutation it acquires
the current room partition (or the world partition for an unscoped system
mutation); the commit transaction validates the exact owner and fencing epoch,
renews unexpired leases, and acquires every additional affected room (for
example both sides of a move). The global event cursor is a separate atomic
compare-and-set, so different room owners cannot allocate conflicting history.
Lease takeover only occurs after expiry and increments the fencing epoch. A
stale owner, an expired owner, a discontinuous world cursor, or an entity
compare-and-set failure aborts the whole transaction and reloads the committed
journal. The optional `COSYWORLD_CANONICAL_LEASE_TTL_MS` setting accepts
1000–300000 ms and defaults to 30000 ms.

`canonical_world_state`, `canonical_partition_leases`,
`canonical_entity_versions`, `canonical_claims`, and `canonical_commits` are
created alongside the existing SQLite tables. Existing single-writer saves are
backfilled from their durable event suffix on first open. The action journal
remains the replay and rollback source, so this migration does not introduce a
second save format or require an isolated-world merge.

Presence is deliberately outside this commit protocol. `actor.presence` is an
ephemeral fan-out event with `seq: 0`; it is not persisted, does not advance an
entity version, and is not part of SSE resume. All events with `seq > 0` form
the gap-free durable suffix ordered by `(world_epoch, world_seq)`.

## Routing and rendezvous

- `/play`, profile, invite, and pact routes resolve stable canonical refs.
- The router resolves the current owner; the URL never embeds an instance,
  region, lease, or process id.
- Two users may keep HTTP/SSE connections to different capacity processes and
  still share one room projection and event cursor.
- Reconnect sends the last acknowledged public cursor, replays committed
  events, refreshes entity versions, and then accepts new commands.
- Session affinity is an optimization only. Correctness tests must deliberately
  disable it.

## Failure and migration gates

| Gate | Pass condition |
| --- | --- |
| Process kill | replacement replays the committed prefix; no acknowledged event disappears |
| Stale owner | storage rejects its write after a newer fencing epoch |
| Network isolation | isolated process rejects mutations and cannot later merge buffered events |
| Hot-room handoff | ownership changes at one committed sequence boundary with uninterrupted replay |
| Partition split | child owners start from one checkpoint; cross-child mutations remain atomic |
| Region failover | promoted region proves durable prefix and obtains higher fences before writes |
| Pack migration | all writers change from old hash to new hash as one audited operation |
| Save import | source is namespaced and hashed; rerun is idempotent; conflicts create no world mutation |

## Two-process integration test plan

The required harness starts two API processes with different `process_id`
values and one canonical test authority. It pins client A to process A and
client B to process B, with affinity disabled.

1. Both clients enter the same location and compare location/actor/item ids and
   versions.
2. A takes the floor item; B observes the same disposition and ordered event.
3. Both retry A’s `intent_id`; the journal contains one receipt and one effect.
4. A moves while B acts in the origin room; the result is serialized without a
   duplicated actor or half-moved item.
5. Kill the owner between validation and append, then after append but before
   response. Each case converges to zero or one committed effect.
6. Isolate the old owner, grant a higher fence, and prove the old owner cannot
   write.
7. Reconnect both clients from earlier cursors and compare the full public event
   suffix and projected action hands.
8. Follow an invite generated on A through B and prove both clients rendezvous
   in the same canonical location.

The failover suite repeats this with ownership migration, a hot room under SSE
fan-out, and a promoted second region. It verifies monotonically increasing
`world_seq` and `entity_version`, no duplicate identity, and no lost
acknowledged event.

## Rollout order

1. Add canonical identity and command/receipt envelopes while remaining one
   process. (Complete in #129.)
2. Move the journal, idempotency receipts, entity versions, and fencing
   authority to durable multi-process storage. (Complete in #128.)
3. Add stable routing, regional presence fan-out, invite rendezvous, and the pinned
   two-process harness.
4. Add partition handoff, hot-room fan-out, and process-loss tests.
5. Add replicated regional recovery and prove the failover gate.
6. Raise production capacity only after every gate passes.

Rollback always returns traffic to one authoritative writer over the same
committed journal. It never restores an isolated process save as a competing
world.
