# Keep encounter removal consistent during content reconciliation

A local opening records a pack resident's first meeting in both the opening
and the pack. When revised content retires the receipt that enables a resident,
`reconcilePackProgress` already removes the pack's encounter. It must remove
the same resident from the opening ledger as well. Otherwise a previously
valid local save fails the reciprocal encounter invariant after migration.

This change follows the paired removal already used by `leaveTheRumours`.
It does not merge ledgers, infer dates, reset saves, or change encounters for
residents that remain enabled or have departed. It only removes the opening
entry when the existing migration already removes that resident's pack entry.
Shared worlds need not mirror their opening and pack encounters; no new entry
or equality requirement is introduced for them. Historical engines stay pinned.

The synthetic regression starts with a valid progressed world, revises a choice
prerequisite, and checks reconciliation for local opening, local without opening,
and shared worlds. It checks unrelated opening state, independent validation,
and idempotence. No player save is used.

This refresh is integrated with serialization hardening in immutable rules 131,
following main rules 130. The narrator and authored text catalog are rebuilt.
Released bundles through 130 remain byte-identical. Final shared/replay checks
and hosted validation remain landing requirements.
