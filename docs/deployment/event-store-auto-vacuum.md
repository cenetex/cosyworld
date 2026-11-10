# One-time event store auto_vacuum conversion

Both production event stores were created before #877 with
`auto_vacuum = none`: compaction frees pages onto the freelist and the file
can only ever grow. New stores choose `incremental` ahead of WAL, but existing
stores need exactly one full `VACUUM` to convert. This runbook drives that
one-time conversion through a normal deploy.

## Preconditions

- A quiet window: the rewrite holds the SQLite write lock for its duration.
  Startup runs it before the process serves traffic, which is the window.
- Roughly 2x the store size free on the volume. Primary: 198 MB used of
  4.3 GB free. Lonely Forest: 142 MB at the root plus per-tenant stores, on
  6.2 GB free after the 2 -> 8 GB extension.

## Procedure

1. Set the flag for exactly one deploy:

   ```sh
   fly secrets set COSYWORLD_ONE_TIME_AUTO_VACUUM=1 --app cosyworld
   fly secrets set COSYWORLD_ONE_TIME_AUTO_VACUUM=1 --app cosyworld-lonelyforest
   ```

2. Deploy in that quiet window. At boot the process converts the store before
   serving traffic and logs
   `one-time event store auto_vacuum conversion complete`. If the conversion
   fails, boot fails closed with the cause — fix the volume and redeploy.

3. Verify each app reports the converted mode:

   ```sh
   curl -s https://cosyworld.fly.dev/meta | jq .persistence.event_store_auto_vacuum
   # "incremental"
   ```

4. Unset the flag so later deploys do not repeat the check:

   ```sh
   fly secrets unset COSYWORLD_ONE_TIME_AUTO_VACUUM --app cosyworld
   fly secrets unset COSYWORLD_ONE_TIME_AUTO_VACUUM --app cosyworld-lonelyforest
   ```

## Properties

- Idempotent: an already-converted or empty store reports no work and boots
  normally even with the flag left set (the log says so).
- Replay-safe: `VACUUM` rewrites the file in place; every journaled row and
  the WAL journal survive. A test asserts rows survive the rewrite.
- Rollback: unset the flag; there is nothing to undo — the conversion is a
  standard SQLite VACUUM of the same data.

After conversion, the bounded incremental pass added in #877 returns compacted
pages to the filesystem after each snapshot, so a burst becomes recoverable
instead of permanent.

## One-time drop of the retired classic tables

The classic game is retired (#1652) and the card-only server no longer reads
or creates its event store tables, but existing volumes still carry them. The
owner decided on 2026-11-10 that those rows are not needed. The primary store
(479.7 MB, `auto_vacuum = none`) is over its 400 MB budget on them.
`COSYWORLD_ONE_TIME_DROP_CLASSIC_ROWS=1` drops them at boot.

**This cannot be undone except by restoring the volume backup.** It drops
only the 51 tables named in `v2/orchestrator-rust/src/card_boot/classic_row_drop.rs`
(a fixed list, never a pattern), with their indexes and triggers. Accounts,
passkeys, shared worlds and their journal, card authoring, play metrics and
signing keys are not on the list, and a test fails if any of them ever is.
`action_journal` and `persistence_compaction` are on the list; their last
readers (`card-policy-lab export-shadow`, `inspect-action-journal`) were removed.

### Procedure

1. Take a volume snapshot and wait for it to reach `created`:

   ```sh
   scripts/backup-fly-v2.sh cosyworld primary
   ```

   Also check the volume has roughly 2x the store size free, because the
   shrink step is the full `VACUUM` described above.

2. Stage the flag so it applies on the next deploy instead of restarting the
   old image:

   ```sh
   fly secrets set --stage COSYWORLD_ONE_TIME_DROP_CLASSIC_ROWS=1 --app cosyworld
   ```

3. Deploy. At boot, before anything serves, the log (warn level) shows one
   `dropping classic table` line per table with its row count, then
   `classic tables dropped; unset ... on the next deploy` with the bytes
   freed, then `event store file shrunk after the classic drop`. If the
   shrink fails (for example no free space) the drop still stands, the error
   is logged and the server boots; set `COSYWORLD_ONE_TIME_AUTO_VACUUM=1` for
   a later deploy to retry the shrink. If the drop itself fails it rolls back
   and the boot fails with the cause.

4. Confirm the size:

   ```sh
   curl -s https://cosyworld.fly.dev/meta | jq .persistence
   # event_store_bytes drops; event_store_auto_vacuum is "incremental"
   ```

5. Unset the flag. A second boot with it set finds no tables and logs
   `no classic tables found; unset COSYWORLD_ONE_TIME_DROP_CLASSIC_ROWS`:

   ```sh
   fly secrets unset COSYWORLD_ONE_TIME_DROP_CLASSIC_ROWS --app cosyworld
   ```

To undo, restore the step 1 snapshot to a new volume. There is no other way
back. The Lonely Forest store and its per-tenant stores are not covered by
this runbook.
