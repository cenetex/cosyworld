import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  firstTaleValidationErrors,
  normalizeFirstTaleConfig,
} from "./first-tale-schema.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const worldsRoot = path.resolve(scriptDir, "../worlds");

const validFirstTale = {
  schema_version: 1,
  lead_location_id: 8900,
  destination_location_id: 8905,
  job_id: " project89:operation-liberation ",
  progress_clock_id: " project89.liberation-signal ",
  copy: {
    question: " Can the group interrupt convergence? ",
    notice_instruction: " Notice the attributed signal. ",
    follow_lead_instruction: " Follow it through the inner loop. ",
    contribute_instruction: " Recover witnesses and controls. ",
    complete_instruction: " Publish the liberation covenant. ",
    target_label: " the convergence protocol ",
    consequence: " Independent signals remain legible. ",
    completion_memory: " You preserved the independent signals. ",
    next_invitation: " Commission a relay aperture. ",
    public_trace: " recorded an attributed covenant ",
  },
  continuation: {
    destination_location_id: 800,
    target_actor_id: 8301,
    job_id: " lantern-keeper:rekindle-the-beacon ",
    travel_instruction: " Follow the lamp road west. ",
    arrival_instruction: " Find Mara at the empty key hook. ",
    accepted_instruction: " Begin the Lantern Keeper thread. ",
  },
};

test("first-tale schema accepts and deterministically normalizes complete copy", () => {
  assert.deepEqual(firstTaleValidationErrors(validFirstTale), []);
  assert.deepEqual(normalizeFirstTaleConfig(validFirstTale), {
    schema_version: 1,
    lead_location_id: 8900,
    destination_location_id: 8905,
    job_id: "project89:operation-liberation",
    progress_clock_id: "project89.liberation-signal",
    copy: {
      question: "Can the group interrupt convergence?",
      notice_instruction: "Notice the attributed signal.",
      follow_lead_instruction: "Follow it through the inner loop.",
      contribute_instruction: "Recover witnesses and controls.",
      complete_instruction: "Publish the liberation covenant.",
      target_label: "the convergence protocol",
      consequence: "Independent signals remain legible.",
      completion_memory: "You preserved the independent signals.",
      next_invitation: "Commission a relay aperture.",
      public_trace: "recorded an attributed covenant",
    },
    continuation: {
      destination_location_id: 800,
      target_actor_id: 8301,
      job_id: "lantern-keeper:rekindle-the-beacon",
      travel_instruction: "Follow the lamp road west.",
      arrival_instruction: "Find Mara at the empty key hook.",
      accepted_instruction: "Begin the Lantern Keeper thread.",
    },
  });
});

test("first-tale schema rejects missing copy and unknown fields", () => {
  const invalid = {
    ...validFirstTale,
    unsupported: true,
    copy: {
      ...validFirstTale.copy,
      question: "",
      unsupported: "not runtime-owned",
    },
  };
  const errors = firstTaleValidationErrors(invalid, "fixture first tale");

  assert.ok(errors.some((error) => error.includes("unknown fields: unsupported")));
  assert.ok(errors.some((error) => error.includes("copy has unknown fields")));
  assert.ok(errors.some((error) => error.includes("copy.question")));
});

test("first-tale schema rejects malformed continuation authority", () => {
  const errors = firstTaleValidationErrors({
    ...validFirstTale,
    continuation: {
      ...validFirstTale.continuation,
      target_actor_id: 0,
      arrival_instruction: "",
      client_route: "/hardcoded",
    },
  });

  assert.ok(errors.some((error) => error.includes("unknown fields: client_route")));
  assert.ok(errors.some((error) => error.includes("target_actor_id")));
  assert.ok(errors.some((error) => error.includes("arrival_instruction")));
});

test("authored world first tales satisfy the inline manifest contract", () => {
  for (const worldId of ["official", "project89"]) {
    const value = JSON.parse(
      fs.readFileSync(
        path.join(worldsRoot, worldId, "first-tale.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      firstTaleValidationErrors(value, `${worldId} first tale`),
      [],
    );
    assert.deepEqual(normalizeFirstTaleConfig(value), value);
  }
});

test("Lantern composition mounts the shared official first tale", () => {
  const world = JSON.parse(
    fs.readFileSync(path.join(worldsRoot, "lantern-keeper/world.json"), "utf8"),
  );
  assert.equal(world.first_tale, "../official/first-tale.json");
});

test("compositions without the Lantern pack mount the continuation-free core tale", () => {
  for (const worldId of ["core-only", "core-ruby"]) {
    const world = JSON.parse(
      fs.readFileSync(path.join(worldsRoot, worldId, "world.json"), "utf8"),
    );
    assert.equal(world.first_tale, "../official/first-tale-core.json");
  }
  const coreTale = JSON.parse(
    fs.readFileSync(path.join(worldsRoot, "official/first-tale-core.json"), "utf8"),
  );
  assert.deepEqual(firstTaleValidationErrors(coreTale, "core first tale"), []);
  assert.equal(coreTale.continuation, undefined);
});
