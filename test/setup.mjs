import { afterEach } from "vitest";
import { setImmediate } from "node:timers/promises";

// Yield between tests so the worker answers the runner before the next long
// synchronous test starts.
afterEach(() => setImmediate());
