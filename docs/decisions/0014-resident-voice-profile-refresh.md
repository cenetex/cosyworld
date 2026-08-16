# ADR 0014: resident voice profiles refresh on durable identity events

- Status: Accepted
- Date: 2026-08-13
- Decision owners: CosyWorld maintainers
- Related: #547, #548, #554, #796, ADR 0011

## Context

Resident replies already use committed continuity, but generated avatars share
one generic fallback voice arm. A durable generated voice profile can make each
resident's interior register reflect their own history without adding a model
call to every line.

Persisting such a profile requires exact refresh triggers, an authored-character
policy, and hard cost ceilings. A vague cadence would make replay and provider
spend depend on scheduling rather than world events.

## Decision

### Refresh trigger and generation identity

A voice-profile job may be admitted only after one of these committed events:

1. the generated actor's first durable identity refinement; or
2. a successful `avatar.evolved` event for that actor.

The initial profile and each level refresh read continuity only through the
triggering event's committed sequence. Unrelated continuity changes do not
schedule work. Retries reuse the same generation identity:

```text
resident-voice-profile-v1
  / {world_id}
  / {world_epoch}
  / {actor_id}
  / {trigger_kind}
  / {trigger_event_seq}
  / {continuity_through_seq}
```

One identity can publish at most one accepted profile. Snapshot restore,
journal replay, reconnect, duplicate scheduling, and concurrent workers recover
the existing job or result rather than generating again. Replay never calls a
model.

### Authored actors

Hand-written actor voices are permanent by default. An authored actor may use
generated refresh only when its owning world pack declares a versioned
`generated_voice_policy` opt-in. The hand-written voice remains the immutable
seed and fallback; generated output may refine register from continuity but may
not erase named structural constraints, change identity, or become world fact.

Adding, removing, or changing that opt-in is a declared pack migration. Existing
accepted profiles keep their frozen policy and source voice. A host default or
provider configuration can never opt an authored actor into drift.

### Cost and retry ceilings

The following ceilings are product law for `resident-voice-profile-v1`:

| Scope                           | Accepted profiles | Provider attempts |
| ------------------------------- | ----------------: | ----------------: |
| one resident in one world epoch |                 4 |                 8 |
| the complete world epoch        |               512 |             1,024 |
| one generation identity         |                 1 |                 2 |

The initial identity profile consumes one resident slot. Later
`avatar.evolved` triggers consume the remaining slots in event order. Once a
resident or world ceiling is reached, newer triggers retain the latest accepted
profile or the authored fallback and do not queue deferred work for a later
wall-clock window.

The normal server-paid daily admission limit and capability registry remain
additional gates. The required capability is `WorldContent` through the
reviewed metacognitive lane. Missing capability, disabled generation, budget
exhaustion, timeout, provider failure, or validation rejection never falls
through to an unreviewed model.

### Failure and validation

Generated profiles are private candidates until validation accepts their
bounded first-person register. They may describe preferences, attention,
hesitation, and social habits grounded in supplied continuity. They may not add
possessions, relationships, memories, actions, secrets, authority, catchphrases,
speaker labels, signpost habits, model language, or facts absent from the
committed context.

A failed or rejected job:

- leaves the previous accepted profile unchanged;
- otherwise uses the existing authored or deterministic fallback arm;
- does not mutate continuity, identity, facts, or progression;
- persists only bounded attempt status, check codes, hashes, attribution, cost,
  and timing; and
- never delays or blocks the resident's next legal action or reply.

## Rejected alternatives

- **Refresh after an arbitrary continuity-change threshold.** Rejected because
  a large class of events would need to become hidden cost triggers and minor
  tuning changes could alter replay scheduling.
- **Refresh on every line or room heartbeat.** Rejected for latency, cost, and
  replay nondeterminism.
- **Implicit drift for authored actors.** Rejected because a host setting could
  silently replace pack-authored character identity.
- **Unlimited retries under the daily spend cap.** Rejected because repeated
  invalid output can starve other world features even when total spend is
  bounded.

## Implementation slices for #554

1. Add the versioned policy, generation identity, job/result persistence, and
   the resident/world admission counters.
2. Build the continuity-through-sequence prompt and fail-closed validator while
   preserving the current fallback arms.
3. Commit accepted profiles, consume them in the resident context spine, and
   prove snapshot, journal replay, retry, authored opt-in migration, and cost
   ceilings.
