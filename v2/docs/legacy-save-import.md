# Isolated legacy save import

This runbook is the only supported path for bringing projections from a
process- or shard-local save into the canonical world. It implements the save
import rules in [ADR 0003](../../docs/decisions/0003-one-canonical-world.md).
An import is not a database merge and never boots the source save as a public
writer.

## Safety contract

Every source is assigned one immutable namespace:

```text
legacy://<installation-id>/<legacy-shard-id>/<save-id>
```

The importer normalizes and hashes the complete typed source record set and
the complete transform plan separately. A successful import persists both
hashes, its receipt, every source-to-canonical mapping, the reviewed
composition migration, and any eligible projections in one SQLite immediate
transaction. The transaction holds the canonical world partition lease and
validates the exact store identity and active region before writing.

- Repeating the same namespace, source hash, and plan hash returns the original
  receipt with `status: "no_op"`.
- Reusing a namespace with different data or a different plan conflicts. The
  first receipt remains immutable.
- A validation or target conflict records an audit report but inserts no
  receipt, mapping, projection, claim, composition migration, or public event.
- Numeric ids are only local source ids. `5000` in two saves produces two
  different `legacy://...` references.
- Public events, shared residents, locations, items, balances, claims, and
  pacts are never unioned automatically.
- Imports do not create actor sessions, authenticate accounts, append source
  public history to the canonical event suffix, or mint live world items.

The internal endpoint is hidden without the same exact bearer secret used by
canonical process routing:

```text
POST /internal/canonical/imports
Authorization: Bearer $COSYWORLD_CANONICAL_ROUTER_TOKEN
Content-Type: application/json
```

It returns `201` for a committed import, `200` for the exact receipt no-op,
`409` with a structured conflict report, `400` for an invalid schema or plan,
and `404` when the bearer secret is absent or wrong.

## Import document

The request has four parts:

1. `installation_id`, `legacy_shard_id`, and `save_id` form the source
   namespace. They are durable identity, not labels that can be reused.
2. `source.records` is the complete typed projection set selected from the
   isolated artifact. Record kinds are `account`, `avatar_history`,
   `location`, `resident`, `item`, `balance`, `claim`, `pact`, and
   `public_event`.
3. `composition_transform` records the source composition hash, the currently
   active canonical bundle hash, and operator review evidence. The new hash
   must exactly match `/meta.worldpack.bundle_hash` when the request executes.
4. `transforms` contains exactly one deterministic decision for every source
   `(kind, source_id)` pair.

The fixture pair used by the acceptance harness is
[west-save.json](../orchestrator-rust/fixtures/legacy-import/west-save.json)
and
[east-save.json](../orchestrator-rust/fixtures/legacy-import/east-save.json).
Both contain actor/account id `5000` and item id `42`, but the item histories
diverge. The west import commits; the east import conflicts on the shared
canonical item target, and its otherwise eligible account projection is not
partially inserted.

### Transform strategies

| Strategy | Allowed source | Effect |
| --- | --- | --- |
| `project` | account, avatar history | Persist the eligible projection at one canonical account/journal reference; it does not bypass current authentication |
| `map_existing` | any kind | Record a deterministic mapping; locations, residents, items, balances, and pacts require an existing canonical entity version |
| `archive` | protected shared-world kinds | Preserve the source payload as inactive audit/history data; it cannot affect live world state |
| `mark_consumed` | claim | Insert an approved `rpg`, `orb_reward`, or `listen_attempt` key into the canonical claim ledger so gameplay cannot replay it |
| `discard` | any kind | Record an explicit decision to import no state |

Every protected shared-world transform, including `discard`, requires
`reviewed_transform` with a stable `review_id`, reviewer, transform version,
and rationale. Account and avatar-history projections may omit per-record
review evidence, but the composition transform is always reviewed.

`map_existing` does not mean “last save wins.” If another source already maps
different source content to the same target, the new import reports
`divergent_target_history`. Two isolated copies therefore cannot silently
choose different dispositions for one lantern, resident, pact, or balance.
Claims already present in `canonical_claims` report
`canonical_claim_already_consumed` instead of replaying a reward.

## Operator procedure

1. Quarantine the legacy save read-only. Record its original file digest and
   provenance outside CosyWorld incident storage.
2. Export the complete selected projection set. Do not omit a conflicting
   shared record merely to make a plan pass; use an explicit reviewed
   `archive`, `map_existing`, or `discard` decision.
3. Choose the source namespace once. Check installation, old shard, and save
   identity against prior receipts before submitting.
4. Read `/meta` from the active canonical region and copy its exact worldpack
   bundle hash into `composition_transform.new_hash`. Review every composition
   and protected-record transform.
5. Submit first to an offline copy of the canonical database. Retain the full
   response, source JSON, source hash, plan hash, review evidence, and resulting
   SQLite backup.
6. Compare account/avatar targets, item dispositions, claim keys, pact targets,
   balances, and composition hashes against the live canonical projections.
   A conflict is a required operator decision, not a retry condition.
7. Fence all inactive regions and submit once to the active region. Record the
   returned receipt id. Immediately repeat the exact request and require
   `status: "no_op"` with the same receipt id.
8. Exercise a claimed reward and confirm it remains consumed; inspect imported
   account/avatar projections; compare world sequence and public event suffix
   before and after. An import must not advance or replace public history.
9. Back up the canonical store and attach the receipt/report to the migration
   review. Never delete or rewrite the source receipt to attempt a different
   plan; use a new save id only for a genuinely new immutable source artifact.

## Durable audit tables

The event database creates these append-only/import-owned surfaces:

- `canonical_legacy_import_receipts`: one immutable successful receipt per
  source namespace;
- `canonical_legacy_import_mappings`: source hashes, strategies, canonical
  targets, and review ids;
- `canonical_legacy_import_projections`: active eligible projections and
  inactive protected archives;
- `canonical_legacy_composition_migrations`: reviewed old/new bundle hashes;
- `canonical_legacy_import_reports`: conflict reports that made no canonical
  world mutation.

Imported consumed claims live in the existing `canonical_claims` ledger and
are reloaded into the runtime claim projection at startup and immediately
after import. If the in-memory refresh is delayed, the durable uniqueness
constraint still fails closed, so a reward cannot commit twice.

## Rollback and correction

There is no destructive “unimport.” A successful receipt may already protect
a claim or establish an identity mapping. Correction is a new reviewed
canonical migration that cites the prior receipt and moves forward. Restoring
the isolated source database as a writer, deleting receipt rows, changing a
namespace in place, or appending its public events directly would violate the
one-world invariant.
