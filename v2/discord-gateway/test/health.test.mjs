import test from "node:test";
import assert from "node:assert/strict";
import { healthStatus } from "../src/health.mjs";

const base = { ready: true, rooms: 2, cast: 5, lastTickAt: 100000, startedAt: 0, now: 200000 };

test("health is 200 when ready and ticking", () => {
  assert.deepEqual(healthStatus(base), {
    code: 200,
    body: { ready: true, rooms: 2, cast: 5, lastTickAt: 100000 },
  });
});

test("health is 503 when not ready or the tick is stale", () => {
  assert.equal(healthStatus({ ...base, ready: false }).code, 503);
  assert.equal(healthStatus({ ...base, now: 500000 }).code, 503);
  assert.equal(healthStatus({ ...base, lastTickAt: null, now: 100000 }).code, 200);
  assert.equal(healthStatus({ ...base, lastTickAt: null, now: 400000 }).code, 503);
});
