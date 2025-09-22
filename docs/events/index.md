# Cosyworld Eventing Overview

This document defines the initial in-process event envelope and usage guidelines. The goal is to decouple service concerns and enable future migration to an external broker (Redis, NATS, Kafka) with minimal churn.

## Envelope Shape
```
{
  id: <uuid>,
  type: "domain.action" | "system.event",   // e.g. "guild.connected", "ai.call.failure"
  version: 1,                                  // schema version for this event type
  ts: ISO8601,                                 // creation timestamp
  source: "discordService" | "aiService" | ..., 
  corrId: string | null,                       // correlation id for tracing
  payload: { ...domainFields },                // event-specific fields (versioned)
  meta: { ...nonDomainObservability }          // latency, retry counts, etc.
}
```

## Publishing
Use the helper in `src/events/envelope.mjs`:
```js
import { publishEvent } from '../../events/envelope.mjs';

publishEvent({
  type: 'guild.connected',
  source: 'discordService',
  corrId,
  payload: { id: guild.id, name: guild.name }
});
```

## Subscribing
```js
import eventBus from '../../utils/eventBus.mjs';

eventBus.on('guild.connected', evt => {
  // evt.payload.id
});

// Generic listener (observability, logging):
eventBus.on('*', evt => {});
```

## Naming Conventions
- Use `<boundedContext>.<pastParticiple>` for state changes (e.g. `avatar.created`).
- Use `<context>.<noun>` or `<context>.<action>` for transient operational events (e.g. `ai.breaker.open`).
- Avoid verbs implying commands; events are facts.

## Versioning
- Increment `version` only when breaking payload changes occur.
- Additive (backward-compatible) fields do not require a version bump.

## Correlation IDs
- Entry points (Discord messages, HTTP requests, scheduled tasks) should create a `corrId` (UUID) if missing and pass through service calls and `publishEvent`.

## Backpressure & Future Scalability
Today events are synchronous in-process publishes. Migration path:
1. Introduce durable outbox (collection `event_outbox`).
2. Background dispatcher to external broker.
3. Replace direct `eventBus.emit` with adapter that writes to outbox + emits.

## Observability
Recommended generic subscriber logs JSON lines with keys: `event`, `id`, `type`, `corrId`, `source`, `latencyMs` (if present), `failureRate` (breaker), etc.

## Initial Event Catalog (Draft)
| Type | Purpose | Payload Fields |
|------|---------|----------------|
| `guild.connected` | Guild presence updated | `id`, `name`, `memberCount` |
| `guild.disconnected` | Guild removed | `id` |
| `ai.call.success` | Successful AI call | `provider`, `model`, `latencyMs`, `attempts` |
| `ai.call.failure` | Failed AI call (final) | `provider`, `model`, `code`, `attempts` |
| `ai.breaker.open` | Circuit breaker tripped | `provider`, `failureRate`, `recentFailures` |
| `ai.breaker.half_open` | Trial state entered | `provider` |
| `ai.breaker.closed` | Breaker reset | `provider` |
| `combat.attack.attempt` | Attack roll initiated | `attackerId`,`defenderId`,`rawRoll`,`attackRoll`,`armorClass`,`advantageUsed`,`channelId` |
| `combat.attack.hit` | Attack succeeded | `attackerId`,`defenderId`,`damage`,`critical`,`attackRoll`,`armorClass`,`currentHp`,`rawRoll`,`channelId` |
| `combat.attack.miss` | Attack failed to meet AC | `attackerId`,`defenderId`,`attackRoll`,`armorClass`,`rawRoll`,`channelId` |
| `combat.knockout` | Defender reduced to 0 HP but has lives remaining | `attackerId`,`defenderId`,`damage`,`livesRemaining`,`critical?`,`channelId` |
| `combat.death` | Defender exhausted all lives | `attackerId`,`defenderId`,`damage?`,`channelId` |
| `combat.flee.attempt` | Combatant attempts to flee | `avatarId`,`channelId` |
| `combat.flee.success` | Combatant fled; encounter ends | `avatarId`,`roll`,`dc`,`channelId` |
| `combat.flee.fail` | Flee attempt failed; turn advances | `avatarId`,`roll`,`dc`,`channelId` |
| `combat.hide.success` | Hide (stealth) succeeded (grants advantage) | `avatarId`,`channelId` |
| `combat.hide.fail` | Hide attempt failed | `avatarId`,`channelId` |
| `combat.narrative.request.pre_combat` | Request pre-combat chatter after initiative | `channelId` |
| `combat.narrative.request.post_round` | Request post-round discussion at round wrap | `channelId`,`round` |
| `combat.narrative.request.round_planning` | Request brief planning phase chatter | `channelId`,`round` |
| `combat.narrative.request.commentary` | Generic commentary opportunity mid-turn | `channelId` |
| `combat.narrative.request.inter_turn` | Inter-turn chatter between turn pacing | `channelId` |

## Testing Guidance
- Unit test: ensure `publishEvent` returns frozen envelope and emits on both specific and `*` channels.
- Contract test: critical listeners assert minimal required fields exist.

## Next Steps
- Integrate into `updateConnectedGuilds` (fire `guild.connected` per new/updated guild once diff logic added).
- Instrument AI service after circuit breaker implementation.
- Add outbox persistence once cross-process scaling begins.
- Expand narrative listener (now implemented) with adaptive heuristics and future persona-based weighting.
