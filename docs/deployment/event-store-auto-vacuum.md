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
