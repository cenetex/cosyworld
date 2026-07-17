# ADR 0003: capacity processes serve one canonical world

- Status: Accepted
- Date: 2026-07-17
- Decision owners: CosyWorld maintainers
- Related: #20, #23, #28, #44, #47

## Context

CosyWorld promises a shared living world. The current runtime is safe only as a
single process: it owns an in-memory kernel, a SQLite journal, and one SSE
stream. Earlier documentation proposed scaling by starting isolated “shards”
and routing each player back to one of them. That would create multiple copies
of scarce items, residents, room history, and public events. An invite could
lead two players to identical-looking rooms that were not the same room.

Capacity is an implementation concern, not a product choice. Regions,
processes, partition owners, and world-pack composition must never become
player-facing alternate worlds or independent sources of truth.

## Decision

The official service has one canonical, persistent player world. Its stable
identity is `world://cosyworld/official`. Every public hostname, capacity
process, and deployment region is an entrance to that world.

The terms have deliberately different meanings:

| Term | Meaning | May define player-visible truth? |
| --- | --- | --- |
| **world** | The canonical identity, entity graph, durable history, and mounted pack composition | Yes; there is one official world |
| **capacity process** | A replaceable orchestrator instance serving requests and projections | No |
| **region** | A failure and latency boundary containing capacity processes | No |
| **partition** | An internal ownership boundary, normally a location plus its occupants and floor state | Only through committed canonical events |
| **room owner** | The currently fenced writer for a partition lease and epoch | No |
| **world-pack composition** | The version-locked authored resources mounted into the canonical world | It changes what exists, but does not create another world |

`COSYWORLD_V2_SHARD_ID` and `/meta.shard_id` remain temporary compatibility
names for a capacity-process label. They do not identify a world. New code and
operator copy use `process_id`; a compatibility change will expose both names
before removing the old one.

Self-hosted deployments are separate installations with their own world ids.
They are not capacity shards of the official world and do not share its scarce
entities or event history.

## Canonical identities

Numeric C-kernel ids remain local runtime handles. Durable records and APIs
carry a `world_id` and a canonical reference. Authored seed entities keep the
pack references accepted in [ADR 0001](0001-cards-are-entitlements.md); runtime
entities use opaque ids minted by the canonical authority.

| Concept | Canonical identity semantics |
| --- | --- |
| World | `world://cosyworld/official`; immutable for the lifetime of the official service |
| Location | authored `pack://<pack>/location/<id>` or `world://cosyworld/official/location/<opaque-id>`; one shared state and room history |
| Actor | authored `pack://<pack>/actor/<id>` or `world://cosyworld/official/actor/<opaque-id>`; account links do not replace actor identity |
| Item | authored `pack://<pack>/item/<id>` or `world://cosyworld/official/item/<opaque-id>`; exactly one live world disposition at a time |
| Journal | `world://cosyworld/official/journal/<opaque-account-id>`; private account projection whose settled public causes reference canonical events |
| Pact | `world://cosyworld/official/pact/<opaque-id>`; one durable relationship/covenant record independent of its current owner process |
| Public event | `(world_id, world_epoch, world_seq)`; globally unique, immutable, and totally ordered within the world epoch |

Every mutable entity also carries an increasing `entity_version`. A command
names the versions it observed; a stale command is rejected or re-evaluated,
never silently applied to another history. Idempotency and claim keys are
scoped by canonical world and intent, not process.

`world_epoch` changes only through an explicit, operator-audited migration that
cannot preserve the preceding ordering domain. Ordinary deploys, process loss,
region failover, and pack migrations do not create a new epoch.

## Authority, ordering, and partitions

The durable canonical journal is the commit point. A successful mutation:

1. resolves stable identities and observed versions;
2. reaches the current owner for every affected partition;
3. validates through the deterministic kernel;
4. atomically appends an idempotent command receipt and its events to the
   canonical journal;
5. advances affected entity versions and the global `world_seq`; and
6. publishes projections after commit.

Each writable partition has one leased owner with a monotonically increasing
fencing epoch. Storage rejects writes from an expired owner even if a network
partition leaves that process running. A multi-partition action, including a
move, trade, gift, or pact change, commits through one coordinator transaction
or an equivalently atomic durable protocol; clients never observe half of it.

Ordering guarantees are:

- all public events have a total replay order by `(world_epoch, world_seq)`;
- mutations of one entity are strictly ordered by `entity_version`;
- an SSE connection may receive batches, but resume from its last committed
  `world_seq` without gaps or duplicates after idempotent de-duplication;
- private account projections may be delivered separately, but references to
  public causes use the committed public event identity.

Queries may be served from bounded-staleness projections. Mutation eligibility,
scarcity, access, balances, and turn ownership must read an authoritative
version or include a compare-and-set precondition. A response that cannot prove
freshness does not offer a mutation as available.

## Failure behavior: preserve one history

Availability yields to consistency whenever accepting a command could fork the
world.

| Scenario | Required behavior |
| --- | --- |
| Process loss | Revoke or expire its lease, replay committed state on a replacement, then accept writes under a higher fencing epoch |
| Network partition | A process without authoritative storage/lease quorum becomes read-only or unavailable; it cannot buffer world mutations for later merge |
| Hot room | Split read/SSE fan-out from the single fenced writer, or migrate ownership at a committed sequence boundary |
| Partition split | Create child ownership ranges from one committed checkpoint; no child accepts writes until its fenced lease is active |
| Reconnect | Resolve the stable actor and location, resume after the last acknowledged `world_seq`, then refresh current versions and action hand |
| Region failover | Promote only from durable replicated history and fencing authority; DNS/routing changes do not change world identity |
| Pack-composition deploy | Run one audited canonical migration; mixed compositions cannot write concurrently |

There is no merge algorithm for divergent world histories because divergent
histories are prohibited. If authority is uncertain, commands fail closed with
a retryable unavailable/conflict result. Speech drafts may remain client-side,
but no player-visible room speech is an event until the canonical append.

## Routing, profiles, and invitations

Public routes carry stable world entities, never a process address. Profile and
invite links identify the canonical actor, pact, or location plus an optional
public event cursor. The edge/router looks up the current partition owner and
may send both users through different capacity processes; both processes read
and mutate the same canonical records.

An invite to a room is therefore a rendezvous request, not a request to join a
host. The receiver lands in the inviter’s canonical location if access still
allows it. If the inviter moved, the route shows the current public profile and
offers the new reachable location; it never manufactures a copy of the old
room. Process-local session affinity may reduce churn but is never identity or
correctness.

## Save and composition migration

The current SQLite save is the seed of the canonical world, not one peer to be
merged with other saves. Import tools treat every isolated legacy save as a
foreign namespace:

`legacy://<installation-id>/<legacy-shard-id>/<save-id>`

The importer records source hash, source ids, chosen canonical targets, and an
idempotent receipt. Account links and eligible avatar history may be proposed
for import. Shared locations, residents, items, balances, claims, pacts, and
public events are never unioned automatically: the operator must select one
authoritative source or provide a reviewed, deterministic transformation.
Conflicts fail closed and remain in a report. No import can mint a second live
copy of a canonical item or replay a claimed reward.

A pack-composition change likewise migrates the one world in place. It records
the old and new composition hashes and a reversible mapping where possible.
Failing validation leaves the old composition authoritative; it does not boot a
fresh public history under the same world id.

## Verification contract

The implementation is not ready for horizontal writes until automated tests
prove all of the following:

- two clients pinned to different capacity processes see the same location,
  actors, item disposition, action result, and ordered room history;
- duplicate commands through different processes commit once;
- a stale or partitioned owner cannot write after a newer fencing epoch;
- an ownership split and hot-room migration preserve sequence and entity
  versions without gaps, duplicates, or half-applied moves;
- reconnect resumes from an event cursor and converges on the same action hand;
- process loss and regional failover recover only committed history;
- profile and invite routes rendezvous through different processes;
- a composition migration either commits one audited result or leaves the old
  world untouched; and
- isolated save imports are namespaced, repeatable, and conflict-reported.

Until that gate passes, production remains deliberately single-writer
(`desired_count = 1`). Adding load-balanced writers to the current SQLite/EFS
shape is forbidden.

## Consequences and follow-ups

This decision rejects player-facing multi-world semantics and isolated
capacity-shard saves. It accepts lower write availability during uncertain
authority in exchange for no forks, duplicate scarce objects, or split room
history.

Implementation is decomposed into linked follow-up issues: identity/API
envelopes (#129), durable journal and fenced ownership (#128), routing/presence
and the two-process harness (#127), failover/hot-room migration (#130), and
isolated-save migration (#131). [The runtime
contract](../../v2/docs/canonical-world.md) is the operator and test-plan
companion to this decision.
