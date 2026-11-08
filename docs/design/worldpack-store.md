# Worldpack store integrity

The catalog starts empty. This offline integrity gate changes no released engine; the runtime compiler does not admit store packs yet.

Run `node v2/scripts/build-card-store.mjs --check` to compare the complete vendor manifest with verified, mounted index entries. Without `--check`, it writes that manifest after all checks pass. Both modes compare every published asset with the recursive vendored set: missing files, extra files, nested folders, lengths, SHA-256 hashes. Neither downloads nor repairs assets.

The payload is `worldpack.json`, `card-world.json`, `card-bridge.json`, `PROVENANCE.md`, any upstream `LICENSE`, plus `assets/`. Pins cover sorted path, length, hash records. Identity, revision, contract, source must match the index. Unmounted entries remain checked but stay outside the vendor manifest.

Paths reject traversal, symlinks, executable files. Limits: 512 files, 1,024 paths, 16 MiB per file, 128 MiB total, eight nested folders, 32 entries. PNG/WebP plus MP3 assets are supported.

Each entry requires `worldpacks/proofs/<id>.json`: the source repository/commit, raw commit bytes, raw trees needed to locate the complete payload. Bytes use canonical base64. The gate verifies Git object hashes, then compares each selected blob with the same bytes used for its SHA-256 pin. Re-pinning edited content or dropping an upstream license cannot pass. Unrelated upstream files remain outside the payload.

Git evidence binds bytes to a commit; it does not authenticate repository ownership. The receipt's repository association comes from an explicit fetch of the named HTTPS repository. No receipt implies a signed commit, trusted author, or content approval.

Proofs allow 4 MiB JSON, 256 KiB per raw commit/tree, 1,024 trees. Selected source paths also reject case collisions, Windows device names, trailing dots, executable files, symlinks, submodules. Pinned fixture/payload bytes bypass Git line-ending conversion and formatting.

`fetchGitSource` in `v2/scripts/card-store-fetch.mjs` acquires a verified snapshot in a private bare Git directory. It fetches the exact commit, then only required trees/blobs using [`--filter=tree:0`](https://git-scm.com/docs/git-rev-list). It never checks out upstream files. The helper returns bounded bytes/proof, removes its private directory, writes no repository files. Ordinary checks remain offline.

Git receives a sanitized environment, no inherited global/system configuration, empty template directory, disabled credential helpers/hooks/submodules/lazy fetch, HTTPS-only transport, rejected redirects. Fetches exclude tags/history beyond the pinned commit. Inventory checks reject unexpected objects, more than 1,537 objects, oversized files, more than 160 MiB of fetched objects/disk use. Commands allow 20 seconds each within a 60-second acquisition deadline; subprocess output is bounded. The 128 MiB payload and 4 MiB proof limits still apply. Size/inventory checks run after each filtered fetch; they are not a transport byte quota.

Next: the transactional install CLI; then compiler admission through this verified result, current bridge entries, switchable groups before any pack is mounted. Advisory ratings and curated reviews will have a separate offline catalog; popularity will never affect admission.
