# Seventh-visit proof-world findings

## Status

The automated proof-world preflight is complete. Its synthetic player visits
on seven UTC days and produces the expected first-to-second, first-to-third,
and first-to-seventh conversions. It also exercises solo, co-presence, pact,
bond, answered-beat, reciprocity, public-trace, job, stranded/recovered, and
gated-entry signals. Retry and duplicate delivery do not change totals;
unsupported schemas are excluded and surfaced; the backfill fixture proves that
private chat, narration, avatar names, and raw actor handles are not copied.

These are instrumentation findings, not live retention results. The first live
readout begins with v0.0.87 and story-metrics schema 2; older delivery-based
`world_beat_seen` rows are excluded from this receipt-based cohort. The readout
must not be represented as a playtest outcome until a cohort has had the full
30-day return window.

## Pre-registered decision thresholds

Evaluate once at least 30 newly observed players have completed a 30-day
window. Do not move the thresholds after seeing the cohort.

- **Ship the loop:** second visit at least 50%, third visit at least 35%, and
  seventh visit at least 20%; at least 60% of seventh-visit players have one or
  more social or story signals before that visit; no material privacy, loss,
  stalled-job, stranded-item, or unanswered-beat concern.
- **Iterate and rerun:** seventh visit is 10–19%, the cohort is smaller than 30,
  a health signal identifies a repairable world-content gap, or signal coverage
  is too sparse to distinguish the candidate loops.
- **Stop or redesign the loop:** seventh visit is below 10% after 30 complete
  windows, no social/story signal has a positive directional association with
  return, or the run exposes a privacy or unrecoverable event-loss failure.

Associations are descriptive and must not be called causal. Counts below five
players are shown for operational diagnosis but are not used to rank loops or
make player-level decisions.

## Live findings template

Record the release, observation window, complete cohort size, first-to-second,
first-to-third, and first-to-seventh rates, then the return rates after solo,
co-presence, pact, bond, and answered-beat visits. Add unanswered beats, stalled
jobs, stranded items, rooms without meaningful action, unsupported schema rows,
and any known delivery gap. Finish with `ship`, `iterate`, or `stop/redesign`
against the thresholds above and link the follow-up issue.
