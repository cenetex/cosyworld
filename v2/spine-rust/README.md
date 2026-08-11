# cosyworld-spine

A greenfield prototype of the CosyWorld orchestrator's commit spine, built
alongside the live system (issue #706). It changes nothing in
`v2/orchestrator-rust`; it exists to prove the seams that the `main.rs`
decomposition (#61) deferred as "a later crate split."

The live system's invariants are kept intact. What changes is the shape of
the Rust layer around them.

## The five seams

| Seam | Here | Replaces in `main.rs` |
| --- | --- | --- |
| One commit pipeline | `pipeline.rs`: `commit()` runs authorize → turn preflight → projection preflight → kernel apply → journal append → projection apply → turn advance → publish | the `apply_and_broadcast_*` wrapper family (`_with_resident_reply`, `_with_mutations`, …). Cross-cutting concerns are fields on `CommitEnvelope`, not function-name suffixes. |
| Kernel port | `kernel.rs`: `KernelPort` mirrors `cw_world_apply` semantics — action + caller-supplied seed in, status + events out | the direct FFI calls at the mutation site. A production adapter wraps the real C kernel; `FakeKernel` proves the pipeline against a deterministic world. |
| Projection registry | `projection.rs`: each projection owns `check` / `apply` / `snapshot` / `restore` / `schema_version`; claim keys are registry-level and journaled | the ~60 `BTreeMap` fields on `RuntimeWorld`. `check` runs before the kernel commits, so a projection can never contradict it after. |
| Journal trait | `journal.rs`: `append` / `read_from` / `latest_seq` / `health`, SQLite-backed, append-only by construction | the free functions over paths (`append_action_journal(path, …)`, `read_event_store_*`). Health/degraded policy attaches to the trait. |
| World loop | `world.rs`: one tokio task owns the pipeline; commands arrive over mpsc, events fan out over broadcast | `Arc<Mutex<RuntimeWorld>>` plus the satellite mutexes on `AppState`. Linearizability comes from singular ownership, so there is no lock-held-across-await. |

## Invariants carried over unchanged

- **The journal is the source of truth.** A `JournalRecord` is the commit's
  inputs (action, seed, tick flag, turn room, mutations) plus the committed
  status and events. `Pipeline::replay` re-applies inputs and asserts the
  re-derived events match the stored feed bit-for-bit. Snapshots are
  disposable accelerators and restore fail-closed on version mismatch.
- **Played time.** The kernel tick advances only inside a committed apply;
  rejected actions never advance it (kernel test:
  `rejected_actions_never_advance_played_time`).
- **Claim-key idempotency.** A mutation whose claim key was already applied
  is a silent no-op; the claim set is persisted in the snapshot. Retries
  never double-mint.
- **Turn taxonomy is declared.** `ActionKind::is_turn_consuming()` is the
  single place a verb declares its class; turn-exempt speech never touches
  the rotation. Turn membership derives from kernel presence, so it replays.
- **AI stays outside commit.** Post-commit work (resident observations, AI
  jobs) is returned as `PostCommitIntent`s and scheduled by the world loop's
  consumers; no inference runs inside the pipeline.
- **Rejections leave no trace.** Auth, turn, projection-preflight, and kernel
  rejections produce no journal record and no broadcast event, each proven by
  a dedicated test.

## The proof

`pipeline::tests::golden_replay_rebuilds_identical_state`: commit a mixed
sequence (item pickup, seeded search, move + claim-keyed mint, pass), then
rebuild a fresh pipeline from nothing but the journal and assert identical
kernel state, projection state, claim set, and turn rotation.

## Run

```sh
cargo test        # 24 tests
cargo clippy      # zero warnings
cargo fmt --check
```

## Non-goals (per issue #706)

No route surface, no FFI adapter for the real kernel, no migration of live
state, no changes to `v2/orchestrator-rust` or `v2/core-c`. If the seams
prove out, adoption is a series of extraction PRs against #61's queue, each
moving one subsystem behind the registry/pipeline interface shown here.
