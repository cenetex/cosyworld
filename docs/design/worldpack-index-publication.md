# Publishing a worldpack store index

`publishStoreIndex` is a local filesystem primitive for the upcoming transactional importer. It is not yet wired to a CLI or runtime. The caller holds the import lock, validates the store and prepares the new index on the same filesystem.

The helper checks hard-link support, moves the actual current index into a private `.index-recovery-*` directory, compares the moved bytes with the expected index, then publishes using an exclusive hard link. Publication and restoration never replace a concurrent writer's index. Errors include the retained recovery path; the caller must preserve that error even if its own cleanup fails.

Recovery directories are ignored by Git and are retained after success and failure. Keeping the old inode preserves later writes through an editor's open file descriptor. The caller reports the returned recovery path on success. Inspect it before removal, after all writers have closed.

This provides no-overwrite publication and recoverability, not concurrent-edit merging. There is a brief interval without `store.json`; do not run readers or manually edit the store during import. Unsupported hard links fail before moving the index. Later restoration failures leave the old index at the reported recovery path. No overwrite fallback is allowed. There is no crash-durability guarantee; recovery after a crash requires inspecting retained files and partially completed work.
