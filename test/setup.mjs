import { afterEach } from "vitest";
import { setImmediate } from "node:timers/promises";

// Yield so the worker answers the runner before the next long synchronous test.
afterEach(() => setImmediate());
