# Importing a worldpack

Start from current main in an isolated branch. Run `node v2/scripts/import-card-store.mjs OWNER/REPO EXACT_COMMIT`, replacing both arguments with the reviewed GitHub repository and its full 40-character commit. The command fetches verified source bytes, stages a complete candidate, then adds payload, proof, recursive asset copies and an index entry with `mounted: false`.

The installer holds an exclusive import lock, refuses existing destinations, validates copied bytes, checks that the index/native table stayed unchanged, then replaces the index atomically. A failure before that final commit removes only this attempt's paths. The vendor manifest stays unchanged because the new entry is unmounted. Existing lock files remain untouched. After a successful import, a cleanup error reports the committed result explicitly.

Run `node v2/scripts/build-card-store.mjs --check`. Review the manifest, license, provenance, exact payload diff and repository/commit association. Admission also needs reviewed bridge entries, a switchable group, the ordinary compiler checks, a new shared engine when the compiled content changes. Never rewrite released bundles. The compiler admission step is introduced separately from this importer.

## Reviewed updates

The CLI deliberately refuses an existing id. Updates remain a reviewed re-vendoring workflow in a separate worktree:

1. Commit the current work, run the store check, record the old source pin and mount settings. Stop if the gate finds unexpected files or changed bytes; those files are not safe to replace.
2. Remove only that verified pack's `v2/worldpacks/ID/`, `v2/card-game/assets/ID/`, `v2/worldpacks/proofs/ID.json` from the branch. Remove its index entry, then run `node v2/scripts/build-card-store.mjs` to regenerate the vendor manifest. Keep the old committed revision available for comparison and rollback.
3. Run the import command with the new exact source commit. It restores the pack as unmounted, including any upstream license. The lower-level `fetchGitSource({ repo, commit })` API returns `{ proof, files }`; each file supplies its relative path plus raw Buffer bytes for reviewed tooling.
4. Review every changed source file, proof, published asset and pin. Restore admission settings only after reviewing compatibility with the new revision; regenerate the vendor manifest, compiled packs and the next shared engine through their source tools. Keep all earlier engine bytes unchanged.
5. Run the store check, required compiler checks and focused tests. Publish the draft PR with both old/new pins plus provenance evidence. A failed acquisition leaves the prepared worktree at step 2; restore its committed prior state before retrying if you want the old pack back.
