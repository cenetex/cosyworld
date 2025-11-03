/**
 * Foundation Event Bus Adapter
 * Thin re-export of the shared singleton EventEmitter instance.
 *
 * This indirection lets higher-level services import from
 * `services/foundation/eventBus.mjs` while the concrete implementation
 * can remain in `src/utils/eventBus.mjs` (or be swapped later).
 */

import eventBus from '../../utils/eventBus.mjs';

export default eventBus;

