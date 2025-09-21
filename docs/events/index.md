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

## Testing Guidance
- Unit test: ensure `publishEvent` returns frozen envelope and emits on both specific and `*` channels.
- Contract test: critical listeners assert minimal required fields exist.

## Next Steps
- Integrate into `updateConnectedGuilds` (fire `guild.connected` per new/updated guild once diff logic added).
- Instrument AI service after circuit breaker implementation.
- Add outbox persistence once cross-process scaling begins.
