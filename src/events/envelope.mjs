/**
 * Event Envelope utilities.
 * Provides a normalized event shape and helper to publish via the shared event bus.
 */
import eventBus from '../utils/eventBus.mjs';
import { randomUUID } from 'crypto';

/**
 * Create a standardized event envelope.
 * @param {Object} params
 * @param {string} params.type - Canonical event type e.g. 'guild.connected'.
 * @param {Object} params.payload - Domain payload (versioned separately from envelope).
 * @param {string} [params.source] - Logical service/component source.
 * @param {string} [params.corrId] - Correlation id propagated across boundaries.
 * @param {number} [params.version=1] - Event schema version.
 * @param {Object} [params.meta] - Additional metadata (non-domain, observability info).
 */
export function createEvent({ type, payload = {}, source = 'unknown', corrId = null, version = 1, meta = {} }) {
  if (!type) throw new Error('event type required');
  return Object.freeze({
    id: randomUUID(),
    type,
    version,
    ts: new Date().toISOString(),
    source,
    corrId: corrId || null,
    payload,
    meta
  });
}

/**
 * Publish an event through the in-process bus.
 * Returns the envelope for chaining/testing.
 */
export function publishEvent(opts) {
  const evt = createEvent(opts);
  setImmediate(() => eventBus.emit(evt.type, evt));
  // Also emit wildcard namespace for generic subscribers (e.g. logging)
  setImmediate(() => eventBus.emit('*', evt));
  return evt;
}

export default { createEvent, publishEvent };
