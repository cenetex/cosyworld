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
