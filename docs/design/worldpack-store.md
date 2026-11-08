# Worldpack store integrity

The catalog starts empty. This offline integrity gate changes no released engine; the runtime compiler does not admit store packs yet.

Run `node v2/scripts/build-card-store.mjs --check` to compare the complete vendor manifest with verified, mounted index entries. Without `--check`, it writes that manifest after all checks pass. Both modes compare every published asset with the recursive vendored set: missing files, extra files, nested folders, lengths, SHA-256 hashes. Neither downloads nor repairs assets.

The payload is `worldpack.json`, `card-world.json`, `card-bridge.json`, `PROVENANCE.md`, plus `assets/`. Pins cover sorted path, length, hash records. Identity, revision, contract, source must match the index. Unmounted entries remain checked but stay outside the vendor manifest.

Paths reject traversal, symlinks, executable files. Limits: 512 files, 1,024 paths, 16 MiB per file, 128 MiB total, eight nested folders, 32 entries. PNG/WebP plus MP3 assets are supported.

The local hash proves agreement with reviewed bytes, not upstream origin. Next: a commit-pinned importer with Git object evidence, including provenance; then compiler admission using this verified result, current bridge entries, switchable groups before any pack is mounted.
