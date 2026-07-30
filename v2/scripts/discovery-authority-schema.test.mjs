import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

import {
  assertDiscoveryAuthority,
  discoveryAuthorityValidationErrors,
} from "./discovery-authority-schema.mjs";
import { validateContentPackManifest } from "./content-pack-contract.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  scriptDir,
  "../orchestrator-rust/fixtures/discovery-authority-v1.json",
);
const valid = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const packId = "fixture.discovery";

function errorsFor(mutator) {
  const invalid = structuredClone(valid);
  mutator(invalid);
  return discoveryAuthorityValidationErrors(invalid, packId).join("\n");
}

test("one schema expresses item, secret-door, resource, optional-POI, and required-route slots", () => {
  const schema = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, "../schemas/discovery-authority-v1.schema.json"), "utf8"),
  );
  assert.equal(new Ajv({ allErrors: true, strict: false }).compile(schema)(valid), true);
  assert.equal(assertDiscoveryAuthority(valid, packId), valid);
  assert.deepEqual(
    valid.slots.map((slot) => slot.target_kind),
    ["item", "feature", "resource", "location", "route"],
  );
});

test("the content-pack compiler invokes discovery authority validation", () => {
  const pack = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, "../content/core/pack.json"), "utf8"),
  );
  const extension = JSON.parse(
    JSON.stringify(valid).replaceAll("fixture.discovery", pack.id),
  );
  pack.extensions["x-cosyworld-discovery-slots"] = extension;
  assert.equal(validateContentPackManifest(pack), pack);
  pack.extensions["x-cosyworld-discovery-slots"].stocking_tables[0].eligible_inputs.push(
    "model_text",
  );
  assert.throws(
    () => validateContentPackManifest(pack),
    /eligible_inputs must be a bounded unique server-fact list/,
  );
});

test("rejects unknown schema, receipt, and roll-algorithm versions", () => {
  assert.match(errorsFor((value) => { value.schema_version = 2; }), /schema_version/);
  assert.match(errorsFor((value) => { value.receipt_version = "future"; }), /receipt_version/);
  assert.match(errorsFor((value) => { value.roll_algorithm = "random-v2"; }), /roll_algorithm/);
  assert.match(
    errorsFor((value) => {
      value.slots[0].stocking.table_version = 99;
    }),
    /exact version/,
  );
});

test("rejects unbounded required discovery and invalid fallback rows", () => {
  assert.match(
    errorsFor((value) => {
      const slot = value.slots.at(-1);
      slot.progression.sign_budget = 0;
      slot.progression.fallback_row_id = "missing";
    }),
    /finite sign_budget|valid deterministic fallback/,
  );
});

test("rejects duplicate unique results", () => {
  assert.match(
    errorsFor((value) => {
      value.stocking_tables[0].rows.push({
        id: "second_old_coin",
        weight: 1,
        result_ids: ["fixture.discovery:item/old-coin"],
      });
    }),
    /unique result .* more than one stocking row/,
  );
});

test("rejects a unique row as the deterministic fallback", () => {
  assert.match(
    errorsFor((value) => {
      value.stocking_tables[0].fallback_row_id = "old_coin";
    }),
    /fallback row cannot be unique/,
  );
});

test("rejects topology outside the slot authorization", () => {
  assert.match(
    errorsFor((value) => {
      value.slots[3].authorized_topology_ids = [];
    }),
    /creates topology outside the slot authorization/,
  );
});

test("event rows cannot create permanent topology, unique loot, or rewards", () => {
  assert.match(
    errorsFor((value) => {
      value.event_tables[0].rows[0].effect_kind = "create_unique_loot";
      value.event_tables[0].rows[0].topology_entity_ids = [
        "fixture.discovery:route/surprise",
      ];
    }),
    /unknown field topology_entity_ids|cannot create topology, unique loot, or rewards/,
  );
});

test("rejects client, wall-clock, provider, model, and user roll inputs", () => {
  for (const input of ["client_state", "wall_clock", "provider", "model_text", "user_input"]) {
    assert.match(
      errorsFor((value) => {
        value.stocking_tables[0].eligible_inputs.push(input);
      }),
      /bounded unique server-fact list/,
    );
  }
});
