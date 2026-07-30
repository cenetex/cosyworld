import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

import {
  assertThresholdDescriptors,
  thresholdDescriptorValidationErrors,
} from "./threshold-descriptor-schema.mjs";
import { validateContentPackManifest } from "./content-pack-contract.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  scriptDir,
  "../orchestrator-rust/fixtures/threshold-descriptors-v1.json",
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function slotMap(value = fixture.discovery) {
  return new Map(value.slots.map((slot) => [slot.id, slot]));
}

function errorsFor(mutator) {
  const invalid = structuredClone(fixture);
  mutator(invalid);
  return thresholdDescriptorValidationErrors(
    invalid.thresholds,
    invalid.pack_id,
    slotMap(invalid.discovery),
  ).join("\n");
}

test("the v1 catalog covers the shared threshold descriptor examples", () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(scriptDir, "../schemas/threshold-descriptors-v1.schema.json"),
      "utf8",
    ),
  );
  assert.equal(
    new Ajv({ allErrors: true, strict: false }).compile(schema)(fixture.thresholds),
    true,
  );
  assert.equal(
    assertThresholdDescriptors(fixture.thresholds, fixture.pack_id, slotMap()),
    fixture.thresholds,
  );
  assert.deepEqual(
    fixture.thresholds.gates.map((gate) => gate.id.split("/").at(-1)),
    ["archive-door", "relic-plinth", "wax-seal", "holder-threshold"],
  );
  assert.equal(fixture.thresholds.hazards[0].bypasses[0].id, "use_chest_key");
  assert.equal(fixture.thresholds.pressures[0].progress.maximum, 6);
  assert.equal(fixture.thresholds.leads[0].transitions[1].method, "build_cairn");
});

test("concrete method offers expose exact-key certainty and timeful tool risk", () => {
  const archiveMethods = fixture.thresholds.gates.find(
    (gate) => gate.id.endsWith("/archive-door"),
  ).methods;
  const exactKey = archiveMethods.find((method) => method.id === "use_retained_key");
  const safeTools = archiveMethods.find(
    (method) => method.id === "work_lock_with_fine_tools",
  );
  const fineTools = fixture.thresholds.hazards[0].methods.find(
    (method) => method.id === "disarm_needle",
  );

  assert.equal(exactKey.offer.resolution.kind, "certain");
  assert.match(exactKey.offer.consequence, /quiet/i);
  assert.equal(safeTools.offer.resolution.kind, "certain");
  assert.ok(safeTools.offer.economy.played_time_turns > 0);
  assert.ok(fineTools.offer.economy.played_time_turns > 0);
  assert.equal(fineTools.offer.resolution.kind, "srd_check");
  assert.ok(fineTools.failure_effects.length > 0);
});

test("method offer contracts reject Orb costs, null checks, and randomized exact keys", () => {
  assert.match(
    errorsFor((value) => {
      value.thresholds.gates[0].methods[0].offer.economy.orbs = 1;
    }),
    /unknown field orbs/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.gates[0].methods[0].offer.economy.played_time_turns = 0;
    }),
    /bounded open_v1 method contract/,
  );
  assert.match(
    errorsFor((value) => {
      const method = value.thresholds.hazards[0].methods[0];
      delete method.failure_effects;
    }),
    /checked resolution must name an SRD check and a state-changing failure/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.hazards[0].methods[0].offer.resolution.dc = 32_768;
    }),
    /checked resolution must name an SRD check and a state-changing failure/,
  );
  assert.match(
    errorsFor((value) => {
      const method = value.thresholds.gates[0].methods[0];
      method.offer.resolution = {
        kind: "srd_check",
        rules_action: "Use an Object",
        ability: "dexterity",
        dc: 10,
      };
      method.failure_effects = [
        {
          kind: "set_gate_state",
          target_id: value.thresholds.gates[0].id,
          state: "closed",
        },
      ];
    }),
    /exact-item method must be certain/,
  );
});

test("the content-pack compiler invokes threshold descriptor validation", () => {
  const pack = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, "../content/core/pack.json"), "utf8"),
  );
  const rewritten = JSON.parse(
    JSON.stringify(fixture).replaceAll(fixture.pack_id, pack.id),
  );
  pack.extensions["x-cosyworld-discovery-slots"] = rewritten.discovery;
  pack.extensions["x-cosyworld-threshold-descriptors"] = rewritten.thresholds;
  assert.equal(validateContentPackManifest(pack), pack);
  pack.extensions["x-cosyworld-threshold-descriptors"].gates[0].transition = "model_decides";
  assert.throws(() => validateContentPackManifest(pack), /transition is invalid/);
});

test("unknown versions, authority, scopes, transitions, and recovery refs fail closed", () => {
  assert.match(
    errorsFor((value) => { value.thresholds.schema_version = 2; }),
    /schema_version/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.descriptor_version = "future"; }),
    /descriptor_version/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.accepted_intent_version = "future"; }),
    /accepted_intent_version/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.authoring_authority = "generated_text"; }),
    /authored_pack/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.gates[0].scope = "party-ish"; }),
    /scope is invalid/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.gates[0].transition = "improvise"; }),
    /transition is invalid/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.hazards[0].methods[0].recovery_version = 99;
    }),
    /recovery_ref must resolve/,
  );
});

test("unknown predicates, effects, triggers, and recursive requirements fail closed", () => {
  assert.match(
    errorsFor((value) => {
      value.thresholds.gates[0].methods[0].requirements.clauses[0].kind = "model_claim";
    }),
    /unknown predicate kind/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.gates[0].methods[0].success_effects[0].kind = "free_form";
    }),
    /unknown effect kind/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.hazards[0].triggers.push("whenever_it_feels_right");
    }),
    /closed trigger vocabulary/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.gates[0].closed_requirements.clauses[0].requirements = {
        mode: "all",
        clauses: [],
      };
    }),
    /unknown field requirements/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.gates[0].methods[0].success_effects[0].target_id =
        "fixture.discovery:gate/missing";
    }),
    /unknown target/,
  );
});

test("Discovery Slot refs require exact compatible versions and bounded claims", () => {
  assert.match(
    errorsFor((value) => { value.thresholds.leads[0].slot.slot_version = 99; }),
    /known compatible Discovery Slot and exact version/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.leads[0].slot.table_version = 99; }),
    /exact Discovery stocking table version/,
  );
  assert.match(
    errorsFor((value) => {
      value.thresholds.hazards[0].slot.allowed_result_type = "route";
    }),
    /known compatible Discovery Slot and exact version/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.pressures[0].slot.finite_budget = 0; }),
    /finite_budget/,
  );
  assert.match(
    errorsFor((value) => { value.thresholds.gates[0].slot.receipt_version = "future"; }),
    /claim and receipt contract is incompatible/,
  );
});

test("legacy lead migration is complete and anchor branch authority is explicit", () => {
  assert.match(
    errorsFor((value) => { delete value.thresholds.lead_state_migrations.mapped; }),
    /complete closed legacy lead-state migration/,
  );
  const anchor = fixture.thresholds.anchors[0];
  assert.equal(anchor.return_chain[0].id, "fixture.discovery:route/ford");
  assert.equal(anchor.branch_authorization[0].id, "fixture.discovery:route/ridge");
  assert.notEqual(anchor.return_chain[0].id, anchor.branch_authorization[0].id);
});
