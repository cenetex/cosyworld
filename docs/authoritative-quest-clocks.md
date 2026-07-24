# Authoritative quest clocks

World quests advance through authored contribution strategies, not through a
generic proximity rule. A strategy names the action binding, target,
requirements, resolution policy, exact clock, progress amounts, claim policy,
narration key, effects, active rules profile, and content-pack provenance.

The same strategy is available to every avatar that satisfies its world-state
requirements. Calling, title, earned practice, and controller mode do not
change legality, odds, or effect. A direct-input controller clicks the
certified action; an inference controller selects that same action from the
same offer surface.

## Resolution contract

Each strategy declares one resolution policy:

- `certain` applies its authored progress without creating a roll;
- `srd_check` resolves the named ability and DC through the active rules
  profile;
- `existing_kernel_outcome` consumes a named successful or failed kernel event.

Baseline progress applies to every resolved attempt. Success and prepared
bonuses apply only when their declared conditions hold. Claims may be
repeatable, once per actor, once per target, or once per actor-and-target.
Generic Work or Help has no target and cannot advance an unrelated clock.

The journal stores the complete strategy intent before resolution. A successful
projection writes this causal chain:

```text
kernel roll/outcome (when required)
  -> job.contribution.resolved
    -> clock.updated
      -> clock.threshold (when crossed)
      -> authored fill effects (when filled)
```

`job.contribution.resolved` is structured evidence. It records the resolved
target, outcome, progress components, claim key, source event sequences, rules
profile and pack, and content pack/version. Browser, text-client, and inspector
views render this evidence and the authored threshold narration.

## Status and idempotency

Quest status is derived from the journaled clocks: a filled danger clock fails
the quest, a filled progress clock completes it, and otherwise it remains
active. Explicit terminal status remains readable only for legacy snapshots
whose quest did not have authoritative clocks.

Clock thresholds and fill effects fire only when their boundary is crossed.
Claims are inserted before progress is applied, so retrying the same
once-scoped contribution cannot duplicate progress or consequences. Snapshots
persist clocks and claims, while action-journal replay reuses the stored
strategy intent and kernel seed.

The immediately preceding production worldpack remains replay-compatible.
Its old Listen/Use lifecycle clock effects are retained as a migration bridge;
when a record includes an authoritative contribution, matching legacy
clock effects are excluded so current actions cannot double-count.

## Authoring rules

Pack validation rejects strategies with unknown bindings, targets,
requirements, clocks, rules packs, content provenance, effects, duplicate IDs,
or unsupported resolution policies. Narrated thresholds must reference one of
the quest's clocks, be unique, and occur before the clock fills.

Generated pathway jobs receive the same versioned Work and Help strategy
schema. Delivery jobs remain evidence-driven: physical possession-chain
delivery evidence completes them instead of pretending that generic Work
delivered an item.
