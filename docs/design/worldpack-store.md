# Worldpack store integrity

The catalog starts empty. This first step adds an offline integrity check;
the runtime compiler does not admit store packs yet. It changes no released
engine bundle.

Run `node v2/scripts/build-card-store.mjs --check` to compare the complete
vendor manifest with the verified, mounted index entries. The same command
without `--check` writes that manifest after all integrity checks pass.
Both modes compare every published asset with the recursive vendored asset
set, including missing files, extra files, nested folders, byte lengths and
SHA-256 hashes. They neither download files nor repair asset copies.

The defined payload is `worldpack.json`, `card-world.json`, `card-bridge.json`,
`PROVENANCE.md`, plus `assets/`. Pins cover sorted path, byte length and hash
records. Manifest identity, revision, engine contract and source repository
must agree with the index. Unmounted entries remain checked but do not enter
the vendor manifest. Paths reject traversal, symlinks and executable files;
payloads allow 512 files, 1,024 paths, 16 MiB per file, 128 MiB total, eight
nested folders, 32 catalog entries. PNG/WebP and MP3 assets are supported.

The local content hash proves agreement with the reviewed vendored bytes.
It does not prove their upstream origin. The next step adds an explicit
commit-pinned importer with Git object evidence, including provenance.
Compiler admission follows that step through the same verified result,
using current bridge entries and switchable groups before any pack is mounted.
