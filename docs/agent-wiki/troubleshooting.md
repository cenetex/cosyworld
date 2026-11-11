# Troubleshooting without inventing a fix

[Wiki home](README.md) · [Dialogue guide](../../v2/docs/card-table/dialogue-beats.md)

| Symptom                                       | First checks                                                                                                                                                                  | Avoid                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Talk/Move button disappears after an action   | Inspect pending dialogue, queued selection and actual legal actions separately. Advance the current dialogue as a player would, then select the next card.                    | Longer sleeps or bypassing dialogue just to turn a smoke green.                                          |
| Character claims a refused transfer succeeded | Compare committed outcome and actual custody with facts passed into narration. Check the shared server path as well as browser text.                                          | Trusting prior speech as authority or replacing every refusal with a guessed trust explanation.          |
| Locked card looks like a different widget     | Follow the existing descriptor/context-control path and its disabled/paired states.                                                                                           | A second panel, duplicate label or CSS workaround without owner approval.                                |
| New pack test passes but pack is absent       | Inspect selected pack configuration, compiled catalog and deployed metadata; check whether smoke skipped.                                                                     | Reporting a design or prerequisite PR as a playable world.                                               |
| Route test fails after map change             | Trace every legal land/ship return and the precise unmet condition. Separate unreachable objective from a trapped player.                                                     | Declaring a softlock from one obsolete direct-route fixture.                                             |
| Shared bundle/catalog becomes stale           | Check owning source, generator, current main and released-version wiring.                                                                                                     | Hand-editing generated files or overwriting an old engine.                                               |
| Old-engine fixture fails with new content     | Pair the historical engine with its recorded content and test the intended upgrade boundary.                                                                                  | Loading today's catalog into an old engine and calling it replay corruption.                             |
| Full suite fails only in sandbox              | Read exact error: loopback/socket EPERM, missing toolchain/cache, native sanitizer/ptrace and product assertions are different.                                               | Weakening assertions or raising timeouts without evidence.                                               |
| Generation seems to freeze                    | Capture request duration, main-thread tasks, input responsiveness and persistence timing separately. Use mature and fresh saves, real streams and shared play where relevant. | Inferring a renderer rewrite from network latency, or treating a tiny metadata sample as a failure rate. |
| Storage health job is red                     | Read job thresholds, bytes/units, volume headroom, OOMs, live metadata and table attribution.                                                                                 | Calling every budget breach an outage, blindly raising a limit, or deleting journals.                    |

## Keep observability honest

Read the metric definition before interpreting its label. For example, a returned
line classified as [`untold`](../../v2/orchestrator-rust/src/card_narrative/voice_metrics.rs) is not automatically missing speech. Counter windows
can restart with deployments; do not combine samples across commits as one rate.

The [offline shared-journal archive prototype](../../v2/scripts/archive_shared_journal.py) verifies structural integrity, not
semantic replay or complete restore. Checkpoint-free reconstruction still needs
retained commands, exact content revisions and compatible engines. Before any
retention decision, establish authorized backup/restore evidence and account for
non-replay readers of journal rows. A snapshot or hash does not recreate deleted
history. Never put production database rows in public debugging artifacts.

When blocked, report the exact command/action, target, reason, completed work and
whether execution failed, was denied, or has an uncertain outcome. Check an
uncertain outcome before retrying. Keep the smallest useful evidence in the PR.
