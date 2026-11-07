# Shared journal archive experiment

This opt-in, offline tool tests compressed history without changing the game.
It never deletes rows, rewrites JSON, calls the runtime, restores data, or uploads
anything. There is no production integration. Keep a full SQLite backup.

## Try it on an authorized backup

Use a consistent SQLite backup, not a copy of only the main file while WAL is
active. Python 3.11 or newer is sufficient; no additional packages are needed.

```sh
python3 v2/scripts/archive_shared_journal.py export \
  --database backup.sqlite --world WORLD_ID --output world.jsonl.gz
python3 v2/scripts/archive_shared_journal.py verify world.jsonl.gz --sha256 SAVED_SHA256
python3 -m unittest discover -s v2/scripts -p test_archive_shared_journal.py
```

SQLite is opened read-only with `query_only` and one read transaction. A long
read can delay WAL recycling: prefer a backup. The stream contains one world's
journal prefix, optional checkpoint, and referenced saved packs. Global sequence
gaps are valid; counts are never inferred by subtraction. Exact command, state,
pack text, integer sequence and timestamp survive the gzip JSON-lines envelope.
Each line extends SHA-256(previous digest || line), starting at SHA-256 of
`cosyworld-shared-journal/v1`; the footer gives counts and chain head. Pack hashes
are checked. Gzip uses a fixed timestamp and no filename for reproducibility.
A verified output is published privately (0600), atomically, without overwriting.

Full World data contains private memories and reflections: never publish it,
commit it, use it as a client projection, or attach it to a PR. Gzip is not encryption.
Only verify trusted local inputs: lines are capped at 64 MiB but total expanded
bytes and pack-reference counts are not bounded. Untrusted archives can exhaust resources.

## Limits and next steps

Checks prove structure, cursors and bytes, **not semantic replay or completeness**.
Keep the printed SHA-256 separately trusted: someone replacing an archive can
recompute its chain or truncate/rewrite history. An unanchored chain is not authenticity.
This is not a restore format: bindings, job keys, scenes, progression/unlocks and
other tables are absent. Historical engine code must be retained separately.
Before reclamation, add bounded immutable segments and trusted manifests, prove
genesis and checkpoint-plus-tail replay parity on an isolated DB, and preserve
idempotency. Never verify by calling `full_store::world` on the source: it can append
upgrades. `full_snapshot`, `full_reflect`, and `full_dedupe` consume journal JSON;
add durable projections or archive-aware reads before pruning or in-place compression.
