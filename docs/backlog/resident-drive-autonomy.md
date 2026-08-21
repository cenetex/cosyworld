# Resident Drive Autonomy — Planning

**Status**: Planning. The typed drive vocabulary and decay primitives shipped
through [#841](https://github.com/cenetex/cosyworld/issues/841); the integration,
scheduling, and authoring sequence below is not active delivery work.

## Purpose

Give residents one typed language for motivation without making inference or
the scheduler authoritative. Three entity atoms — avatar (`A`), location (`L`),
and item (`I`) — compose into drive patterns that describe inclinations already
present in resident behavior:

| Pattern | Inclination | Existing examples |
| --- | --- | --- |
| `I` | possess or use an item | pick up, use item |
| `L` | be at a location | move, roam |
| `A` | be near an avatar | notice, meet |
| `AI` | relate an avatar and item | trade, give |
| `AL` | relate an avatar and location | follow, meet |
| `IL` | relate an item and location | seek, use feature |
| `ALI` | relate avatar, location, and item | delivery |
| `ALLI` | carry an item between locations | fetch and deliver |

The grammar is a scoring and authoring vocabulary. It does not grant new verbs,
bypass authoritative offers, or let a model commit world state.

## Shipped Foundation

- `DriveAtom`, `DrivePattern`, `ResidentDrive`, and `ActorDriveState` exist in
  `residents/drives.rs` with serialization, recovery, satisfaction, and tests.
- Resident offer kinds are a closed enum, and autonomy candidate generation and
  ranking are co-located in `autonomy.rs`.
- Current pack fields such as `ambient_autonomy`, `roaming`, `desires`, and
  free-text goals remain the runtime contract. The typed drives are not yet
  wired into live decisions.

## Candidate Delivery Sequence

Promote only one bounded slice at a time after the production-stability and
seventh-visit gates produce evidence that autonomy is the selected investment.

1. **Compatibility projection.** Derive typed drives from existing pack fields
   without changing behavior: ambient/roaming become `L`, desires become bound
   `I`, and unclassified goals remain `Other`.
2. **Played-time recovery and satisfaction.** Recover drives on authoritative
   played ticks and satisfy the exact pattern of a committed autonomous action.
   Replay, restart, and duplicate work must produce the same drive state.
3. **Generate, then rank.** Produce every legal candidate once and rank across
   candidates and residents through one scoring seam. Preserve current choices
   before adding drive modifiers; social commitments remain explicit hard gates.
4. **Belief-grounded binding.** Bind a general pattern to concrete known actors,
   items, and locations using certified resident beliefs. A classifier may
   propose a binding but cannot invent entities or legality.
5. **Pack-authored drives.** Add a versioned `drives` schema only after the
   compatibility projection and ranker are proven. Existing fields remain
   backwards-compatible authoring sugar.
6. **Attention-bubble scheduling.** Evaluate player-attention bubbles as a
   separate performance and liveliness slice. Scope candidate eligibility and
   credits to active regions without changing drive recovery or simulating
   unobserved world history.

## Decisions Required Before Promotion

- Whether avoidance is a negative drive strength or a separate typed relation.
- Whether sequences are planner-owned ordered goals rather than compound drive
  patterns.
- Which drives are general personality inclinations versus bindings to exact
  entities.
- Which contextual constraints are hard gates and which may be rank modifiers.
- Attention-bubble radius, departure grace, overlap, fairness, and the measured
  concurrent-bubble performance ceiling.

## Invariants

- World time remains played time; no wall-clock hunger or offscreen simulation.
- The kernel and authoritative offer pipeline decide legality and mutation.
- Drive state, candidates, scoring inputs, and committed satisfaction are
  deterministic, journal-safe, and replayable.
- Inference may classify or propose bindings only from admitted beliefs and a
  closed output vocabulary.
- Player attention can select where simulation spends budget, but cannot make
  hidden regions advance or cause one player's bubble to own shared residents.
- The first integrated slice must prove no behavior change before drive strength
  is allowed to influence ranking.

## Historical Issue Evidence

- [#842](https://github.com/cenetex/cosyworld/issues/842) — integration and
  dependency sequence.
- [#843](https://github.com/cenetex/cosyworld/issues/843) — attention-bubble
  motivation, performance questions, and scheduler seam.
- [#845](https://github.com/cenetex/cosyworld/issues/845) — duplicate cascade and
  ranker analysis.
- [#846](https://github.com/cenetex/cosyworld/issues/846) — unification of pack
  fields, beliefs, promises, refusals, and bindings.

