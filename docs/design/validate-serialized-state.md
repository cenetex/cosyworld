# Validate the value being saved

Issue #2518: `validateWorld` returned mutable objects marked in a WeakSet.
`encodeSave` trusted that mark once, even if callers changed a top-level field
or nested possession after validation. The first save could therefore write
bytes that the decoder refused, replacing the last usable local save.

Always validate in `encodeSave`. Remove the mark entirely. This adds no new
validation to individual shared reducer actions. Any future optimization must
cache immutable snapshots or validated bytes rather than mutable identity.
The app already encodes before touching localStorage or queuing a backup;
validation failures leave the existing bytes in place and show the unsaved
notice. No migration or automatic reset is introduced.

Tests cover top-level and nested mutations immediately after validation,
repeated valid local/shared round trips, and the real browser app save function.
The browser smoke adds its probe only through a test response interception,
checks both mutation failures preserve localStorage, then reloads that save.
All fixtures are synthetic. No player data or production journals are used.

On this Mac, Chromium at desktop size measured 1.2 ms median / 1.5 ms p95 for
146 KB opening saves and 1.3 / 1.5 ms for a 275 KB synthetic capped-history save.
At phone viewport size with 4x CPU throttling, the corresponding measurements
were 5.5 / 6.9 ms and 5.2 / 6.3 ms. Each sample includes validation and JSON
serialization (10 warmups, 100 samples). Throttling is a phone performance
proxy, not physical-device evidence; the fixture fills both bounded history
lanes, not every possible persisted collection. Rerun with:
`node v2/scripts/smoke-card-save-validation.mjs`.

The prior separately reviewed local patch mentioned by the issue was absent
from this executor's branches, worktrees, reflogs and remote refs. This is a
fresh reconstruction and needs a fresh independent review.

This change is integrated with paired encounter reconciliation on main
78098f408 in immutable rules 131. The narrator and authored text catalog are
rebuilt; released bundles through 130 remain byte-identical. The release
version stays 1.2.127. Shared/replay and required final-head checks remain
landing requirements. No production deployment is part of this work.
