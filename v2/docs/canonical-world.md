# Canonical world runtime contract

CosyWorld’s official service is one persistent world. Capacity processes,
regions, room owners, and pack bundles are replaceable machinery behind that
promise. [ADR 0003](../../docs/decisions/0003-one-canonical-world.md) is the
normative decision; this page turns it into rollout and test gates.

## Current and target shapes

The Rust orchestrator can now run divergent capacity processes over one shared
SQLite journal. Each process keeps a replayable C-kernel projection, advertises
an exact boot-scoped route, forwards writes to the current fenced room owner,
polls the durable suffix, and relays ephemeral presence without advancing the
world cursor. The pinned two-process harness proves this convergence path.

Production still keeps one task/machine. Hot-room ownership migration and the
full process-loss/failover gate remain in #130, and a normal shared load
balancer is not an exact process route. Passing the #127 harness does not by
itself authorize raising production capacity.

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

Each routed process must set both of these values or neither:

- `COSYWORLD_CANONICAL_ROUTE_URL`: an HTTP(S) origin that targets that exact
  process, with no credentials, path, query, or fragment;
- `COSYWORLD_CANONICAL_ROUTER_TOKEN`: a shared secret of at least 16 characters
  used only for authenticated process-to-process requests.

Routing also requires `COSYWORLD_V2_EVENT_DB_PATH`. A boot registers its exact
`owner_id`, `process_id`, origin, and heartbeat expiry in
`canonical_process_routes`. The current room lease names the owner; ingress
looks up that owner's live route and forwards the original command envelope.
Internal routes return `404` without the exact bearer secret. Do not configure
the ordinary shared player load balancer as a process route: it can select the
wrong owner and recurse into an unavailable write.

Durable projections poll the shared action journal every 100 ms and also catch
up before `/state`, `/inspect`, `/world`, `/events`, `/stream`, `/profiles`,
invite, and command handling. Reconnect resumes from the caller's acknowledged
event cursor. Stable actor lookups use `GET /profiles?actor_ref=...` and never
derive identity from a process label.

`POST /invites` creates a seven-day durable invite for an authenticated actor,
`GET /invites/{invite_id}` resolves the inviter's current canonical profile,
and `POST /invites/{invite_id}/follow` moves an authenticated follower to the
inviter's current canonical location. The follow is fenced across origin and
destination rooms and is forwarded to the current owner when necessary.

Presence uses the same live route registry but remains explicitly ephemeral.
Capacity processes relay `actor.presence` with `seq: 0`, keep a bounded regional
view for active-room projections, and never insert it into replay history.
Session affinity is therefore an optimization only, not a correctness
requirement.

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

## Two-process integration harness

`divergent_capacity_processes_converge_without_affinity` starts two real
loopback API servers with different `process_id` and boot-scoped owner values,
one shared journal, and affinity disabled. It pins client A to process A and
client B to process B.

1. Both clients enter the same location and compare location/actor/item ids and
   versions.
2. A takes the floor item; B observes the same disposition and ordered event.
3. Both retry A’s `intent_id`; the journal contains one receipt and one effect.
4. An invite generated on A is resolved and followed through B; both profiles
   rendezvous at the inviter's current stable location reference.
5. Both clients compare location, actors, items, action hand, and the complete
   ordered public suffix from an earlier cursor.
6. The owner process and its convergence worker are killed; after lease expiry,
   B commits with a higher fence while preserving identity and history.

The harness also proves cross-process session refresh and `seq: 0` presence
fan-out. The remaining #130 failover suite adds ownership migration during an
active hot room, stale-owner isolation at the append boundary, and promoted
region recovery.

## Rollout order

1. Add canonical identity and command/receipt envelopes while remaining one
   process. (Complete in #129.)
2. Move the journal, idempotency receipts, entity versions, and fencing
   authority to durable multi-process storage. (Complete in #128.)
3. Add stable routing, regional presence fan-out, invite rendezvous, and the
   pinned two-process harness. (Complete in #127.)
4. Add partition handoff, hot-room fan-out, and process-loss tests.
5. Add replicated regional recovery and prove the failover gate.
6. Raise production capacity only after every gate passes.

Rollback always returns traffic to one authoritative writer over the same
committed journal. It never restores an isolated process save as a competing
world.
