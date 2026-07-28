# Seventh-Visit Operating Queue

CosyWorld's current product goal is to earn a seventh visit. This queue turns
the larger design backlog into a bounded delivery sequence. GitHub issues,
labels, and milestones remain the source of truth for implementation state;
this document records the portfolio rules and exit gates.

## Portfolio rule

An issue competes for current delivery only when it directly:

1. restores production trust;
2. closes an authority gap that could make player-visible state untrue; or
3. proves the Lantern Keeper campaign and meaningful Journal loop needed for
   the seventh-visit cohort.

Starting a new major gameplay, generation, media-model, or world-topology epic
must displace current work or wait until the cohort produces evidence.

## Operating sequence

| Wave | Outcome | Work |
| --- | --- | --- |
| 0 — Production trust | The live world is available, recoverable, economically honest, and protected by a real release gate. | [Milestone 2](https://github.com/cenetex/cosyworld/milestone/2): #513, #500, #487/#483, #504/#502/#503, #501, #498; #482 follows the storage policy. |
| 1 — Authority correctness | Every player transport and resolution path acts through the authoritative offer and method. | #469, #408, #462, and #491. |
| 2 — First campaign proof | One coherent campaign exposes premise, relationship, consequence, Journal meaning, and recall. | [Milestone 3](https://github.com/cenetex/cosyworld/milestone/3): #357, #307, #360, #362, #363, #410, #505–#509, and #511. |
| 3 — Post-cohort selection | Evidence selects one major gameplay investment. | Choose between #356 and #371 after the stability gate, golden journey, and cohort measurement. |
| Parked | Valuable design work that does not compete with the proof. | Generated descendants and reference-composed art, full Death/Return, broad combat, model-diversity expansion, Cairn extensions, and broad Journal migration/diagnostics. |

Wave order is a constraint, not merely a sort. Work may be prepared early, but
the next wave does not widen player-facing scope while an earlier exit gate is
red.

## Exit gates

### Wave 0 — Production Stability Gate

- Event and snapshot storage have bounded retention, safe checkpoint
  prerequisites, stale-temporary recovery, and advance telemetry.
- The declared Fly machine size survives a sustained multiplayer run without
  an OOM kill; the structural full-world-clone fix remains scheduled.
- Community-image retries are observable and idempotent. Preflight failures do
  not consume provider attempts or emit usage, and corrupt candidates recover
  or terminate actionably.
- Every effective production AI capability route is audited at startup.
- A fresh-seed browser smoke runs in CI, and restore/replay plus deployed smoke
  evidence is recorded.

### Wave 1 — Authority correctness

- Scout submits only the exact offered route.
- Browser, `/commands`, and terminal players can commit only one of the
  current dealt actions or request the free deterministic redeal.
- Combat preview, equipment, resolution, and replay name the same
  authoritative method.
- The persistent world has a replay-safe renewable healing supply.

### Wave 2 — Lantern Keeper / Seventh Visit Proof

- Premise and stakes reach a player surface.
- Class revelation and Mara's relationship beat are causally honest and work
  with providers offline.
- The Journal renders current place, open threads, and meaningful story beats
  rather than raw event grammar.
- A deterministic golden journey proves the complete campaign and captures
  player-visible exposure/recall evidence.

## Triage dimensions

Every open issue carries exactly one value from each delivery dimension:

| Dimension | Values | Meaning |
| --- | --- | --- |
| Priority | `priority:p0`, `priority:p1`, `priority:p2` | Stop-the-line, committed next-wave, or valuable follow-on. |
| Horizon | `horizon:now`, `horizon:next`, `horizon:later` | Current gate, sequenced work, or deliberately deferred work. |
| State | `state:ready`, `state:blocked`, `state:in-progress`, `state:parked` | Immediately executable, waiting on a named prerequisite, actively changing, or intentionally outside the queue. |

`status:blocked` is reserved for automation failure and is not a dependency
label. A dependency-blocked product issue uses `state:blocked` and names its
prerequisite in the issue body.

## Work-in-progress policy

- Wave 0 may have separate storage, memory, media, startup-audit, and test-gate
  streams only when they do not edit the same seam.
- Wave 1 starts with the smallest authority gap that is not already being
  changed by Wave 0.
- Wave 2 has one product spine: Lantern Keeper plus the Journal slices required
  by its golden journey.
- `main.rs` decomposition continues as one small mechanical extraction at a
  time and never displaces incident or proof work.
- A parked issue is still valid design. Moving it forward requires new
  evidence, an explicit displacement decision, and updated horizon/state
  labels.

## Review cadence

Review the two active milestones after every production incident, merged gate,
or cohort checkpoint. Close completed decision tickets promptly. When an issue
moves between waves, update its milestone, all three delivery labels, and any
named dependencies together.
