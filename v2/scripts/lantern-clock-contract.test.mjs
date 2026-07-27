import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LANTERN_KEEPER_PACK_ID,
  LANTERN_CLOCK_OUTCOMES,
  lanternClockEffectValidationErrors,
} from "./lantern-clock-contract.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packRoot = path.resolve(scriptDir, "../content/the-lantern-keeper");
const clocks = JSON.parse(fs.readFileSync(path.join(packRoot, "clocks.json"), "utf8"));
const lifecycleHooks = JSON.parse(
  fs.readFileSync(path.join(packRoot, "lifecycle_hooks.json"), "utf8"),
);
const packs = [{ id: LANTERN_KEEPER_PACK_ID }];

function validate(overrides = {}) {
  return lanternClockEffectValidationErrors({
    clocks,
    lifecycleHooks,
    packs,
    ...overrides,
  });
}

test("Lantern clocks directly declare one justified authoritative consequence", () => {
  assert.deepEqual(validate(), []);
  for (const [clockId, status] of LANTERN_CLOCK_OUTCOMES) {
    const clock = clocks.find((candidate) => candidate.id === clockId);
    assert.ok(clock);
    assert.equal(
      clock.on_fill.filter((effect) => effect.op === "set_job_status").length,
      1,
    );
    assert.ok(clock.on_fill.every((effect) => effect.reason?.trim()));
    assert.equal(
      clock.on_fill.find((effect) => effect.op === "set_job_status").status,
      status,
    );
  }
});

test("Lantern clock contract rejects missing, tag-only, and unjustified effects", () => {
  for (const clockId of LANTERN_CLOCK_OUTCOMES.keys()) {
    const missing = structuredClone(clocks);
    delete missing.find((clock) => clock.id === clockId).on_fill;
    assert.match(validate({ clocks: missing }).join("\n"), /must directly declare/);

    const tagOnly = structuredClone(clocks);
    const tagOnlyClock = tagOnly.find((clock) => clock.id === clockId);
    tagOnlyClock.on_fill = tagOnlyClock.on_fill.filter((effect) => effect.op === "set_tag");
    assert.match(validate({ clocks: tagOnly }).join("\n"), /cannot be tag-only/);

    const unjustified = structuredClone(clocks);
    delete unjustified.find((clock) => clock.id === clockId).on_fill[0].reason;
    assert.match(validate({ clocks: unjustified }).join("\n"), /must declare reason/);
  }
});

test("Lantern clock contract rejects a duplicate lifecycle source", () => {
  assert.match(
    validate({
      lifecycleHooks: [{
        hook: "on_clock_fill",
        target_kind: "clock",
        target_id: "lantern-keeper.light",
        effects: clocks[0].on_fill,
      }],
    }).join("\n"),
    /sole authoritative consequence source/,
  );
});

test("compositions without the Lantern pack are outside this contract", () => {
  assert.deepEqual(
    lanternClockEffectValidationErrors({
      clocks: [],
      lifecycleHooks: [],
      packs: [{ id: "cosyworld.core" }],
    }),
    [],
  );
});
