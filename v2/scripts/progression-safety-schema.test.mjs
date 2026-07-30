import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  progressionSafetyValidationErrors,
  progressionSafetyWorldValidationErrors,
} from "./progression-safety-schema.mjs";
import { validateContentPackManifest } from "./content-pack-contract.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(scriptDir, "..");
const contentRoot = path.join(v2Root, "content");
const extensionName = "x-cosyworld-progression-safety";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sourceManifests() {
  const manifests = new Map();
  for (const directory of fs.readdirSync(contentRoot)) {
    const filePath = path.join(contentRoot, directory, "pack.json");
    if (!fs.existsSync(filePath)) continue;
    const manifest = readJson(filePath);
    manifests.set(manifest.id, manifest);
  }
  return manifests;
}

const manifestsById = sourceManifests();

function compiledWorldContext(worldName) {
  const lock = readJson(path.join(v2Root, "worlds", worldName, "pack.lock.json"));
  const manifests = lock.packs.map((pack) => {
    const manifest = manifestsById.get(pack.id);
    assert(manifest, `missing source manifest ${pack.id}`);
    return structuredClone(manifest);
  });
  const resources = {};
  for (const collection of ["locations", "items", "exits", "lifecycle_hooks"]) {
    const filePath = path.join(contentRoot, worldName, `${collection}.json`);
    resources[collection] = fs.existsSync(filePath) ? readJson(filePath) : [];
  }
  return { manifests, resources };
}

function errorsForWorld(context, mutator = () => {}) {
  const value = structuredClone(context);
  mutator(value);
  return progressionSafetyWorldValidationErrors(
    value.manifests,
    value.resources,
    "fixture world",
  ).join("\n");
}

function projectProof(context) {
  return context.manifests
    .find((manifest) => manifest.id === "project89.composition.three-rings")
    .extensions[extensionName];
}

const official = compiledWorldContext("official");
const project89 = compiledWorldContext("project89");
const descriptorFixture = readJson(
  path.join(v2Root, "orchestrator-rust", "fixtures", "threshold-descriptors-v1.json"),
);

function boundedRuinContext() {
  const proof = {
    schema_version: 1,
    proof_version: "progression-safety-v1",
    entry_location_id: 1,
    required_location_ids: [1, 2, 3],
    optional_content: [
      {
        kind: "item",
        id: 40,
        missable: true,
      },
    ],
    recoveries: [],
    access_methods: [],
    reclosable_gates: [
      {
        id: "fixture.discovery:gate/ruin-plinth",
        version: 1,
        from_location_id: 2,
        to_location_id: 3,
        required: true,
        method_kind: "installed_item",
        far_side_escape: {
          kind: "return_route",
          route: {
            from_location_id: 3,
            to_location_id: 2,
          },
        },
      },
    ],
    required_discoveries: [
      {
        slot_id: "fixture.discovery:discovery/required-route-sign",
        slot_version: 1,
      },
    ],
    required_leads: [
      {
        lead_id: "fixture.discovery:lead/cairn-track",
        lead_version: 1,
        anchor_id: "fixture.discovery:anchor/moonlit-cairn",
        anchor_version: 1,
        recovery_ref: "fixture.discovery:recovery/chest-needle-reset",
        recovery_version: 1,
      },
    ],
    frontier_transitions: [
      {
        id: "fixture.discovery:frontier/bounded-ruin",
        version: 1,
        from_location_id: 2,
        to_location_id: 3,
        anchor_id: "fixture.discovery:anchor/moonlit-cairn",
        anchor_version: 1,
        fatigue_escape: [
          {
            kind: "retreat",
            route: {
              from_location_id: 3,
              to_location_id: 2,
            },
          },
        ],
      },
    ],
  };
  return {
    manifests: [
      {
        id: "fixture.discovery",
        extensions: {
          "x-cosyworld-discovery-slots": structuredClone(descriptorFixture.discovery),
          "x-cosyworld-threshold-descriptors": structuredClone(descriptorFixture.thresholds),
          [extensionName]: proof,
        },
      },
    ],
    resources: {
      locations: [
        { id: 1, pack_id: "fixture.discovery" },
        { id: 2, pack_id: "fixture.discovery" },
        { id: 3, pack_id: "fixture.discovery" },
      ],
      items: [{ id: 40, location_id: 2, pack_id: "fixture.discovery" }],
      exits: [
        { from_location_id: 1, to_location_id: 2, flags: 0, pack_id: "fixture.discovery" },
        { from_location_id: 2, to_location_id: 1, flags: 0, pack_id: "fixture.discovery" },
        { from_location_id: 2, to_location_id: 3, flags: 0, pack_id: "fixture.discovery" },
        { from_location_id: 3, to_location_id: 2, flags: 0, pack_id: "fixture.discovery" },
      ],
      lifecycle_hooks: [],
    },
  };
}

test("Core and the Holy Land bridge publish reachable required topology", () => {
  assert.equal(errorsForWorld(official), "");
  const core = official.manifests.find((manifest) => manifest.id === "cosyworld.core");
  assert.deepEqual(
    core.extensions[extensionName].optional_content,
    [{ kind: "location", id: 65, missable: true }],
  );
  assert(
    official.manifests.some(
      (manifest) => manifest.id === "cosyworld.composition.core-holy-land",
    ),
  );
});

test("the content-pack contract invokes progression safety validation", () => {
  const core = structuredClone(
    official.manifests.find((manifest) => manifest.id === "cosyworld.core"),
  );
  validateContentPackManifest(core, "core/pack.json");
  core.extensions[extensionName].proof_version = "model-decides";
  assert.throws(
    () => validateContentPackManifest(core, "core/pack.json"),
    /proof_version must be progression-safety-v1/,
  );
});

test("Project89's four unique relay keys certify the whole three-ring graph", () => {
  assert.equal(errorsForWorld(project89), "");
  const proof = projectProof(project89);
  assert.deepEqual(
    proof.access_methods.map((method) => method.item_id),
    [8971, 8973, 8979, 8983],
  );
  assert(proof.access_methods.every((method) => method.kind === "mission_key"));
  assert(
    proof.access_methods.every((method) =>
      Object.values(method.custody).filter((value) => value === "recoverable").length === 6),
  );
});

test("a bounded ruin certifies Discovery, Lead recovery, reclosure, and fatigue retreat", () => {
  assert.equal(errorsForWorld(boundedRuinContext()), "");
});

test("rejects a unique key that can be unreachable behind its required Gate", () => {
  assert.match(
    errorsForWorld(project89, (context) => {
      const proof = projectProof(context);
      proof.access_methods[0].source_location_id = 8940;
      proof.recoveries[0].source_location_id = 8940;
    }),
    /Gate .* mission key 8971 is unreachable before its required route opens/,
  );
});

test("rejects an installed-item Gate that can strand actors without return or rescue", () => {
  assert.match(
    errorsForWorld(boundedRuinContext(), (context) => {
      context.resources.exits = context.resources.exits.filter(
        (route) => !(route.from_location_id === 3 && route.to_location_id === 2),
      );
    }),
    /reclosable Gate .* far-side escape route is missing/,
  );
});

test("rejects a required Discovery Slot with no finite Sign budget or fallback", () => {
  assert.match(
    errorsForWorld(boundedRuinContext(), (context) => {
      const slot = context.manifests[0]
        .extensions["x-cosyworld-discovery-slots"]
        .slots
        .find((entry) => entry.id.endsWith("/required-route-sign"));
      delete slot.progression.sign_budget;
      delete slot.progression.fallback_row_id;
    }),
    /required Discovery Slot .* exhaust its Sign budget without deterministic fallback/,
  );
});

test("rejects a frontier fatigue transition with no retreat, camp, aid, or rescue", () => {
  const context = boundedRuinContext();
  context.manifests[0].extensions[extensionName].frontier_transitions[0].fatigue_escape = [];
  assert.match(
    progressionSafetyValidationErrors(
      context.manifests[0].extensions[extensionName],
    ).join("\n"),
    /frontier .* preserve a bounded retreat, camp, aid, or rescue escape/,
  );
});

test("rejects custody paths that omit an authored loss or recovery policy", () => {
  const proof = structuredClone(projectProof(project89));
  delete proof.access_methods[0].custody.resident_custody;
  assert.match(
    progressionSafetyValidationErrors(proof).join("\n"),
    /classify resident_custody as recoverable or inert/,
  );
  proof.access_methods[0].custody.resident_custody = "recoverable";
  proof.access_methods[0].custody.recovery_ref =
    "project89.composition.three-rings:recovery/missing";
  const context = structuredClone(project89);
  projectProof(context).access_methods[0].custody = proof.access_methods[0].custody;
  assert.match(errorsForWorld(context), /references missing recovery .*missing/);
});

test("keeps exact mission keys distinct from reusable capabilities", () => {
  const proof = structuredClone(projectProof(project89));
  const method = proof.access_methods[0];
  method.kind = "reusable_capability";
  method.capability = "archive-decoding";
  assert.match(
    progressionSafetyValidationErrors(proof).join("\n"),
    /reusable_capability cannot masquerade as an exact mission key/,
  );
});

test("rejects cross-pack Gate routes whose generated owner is not authoritative", () => {
  assert.match(
    errorsForWorld(project89, (context) => {
      const bridge = context.manifests.find(
        (manifest) => manifest.id === "project89.composition.three-rings",
      );
      bridge.extensions["x-cosyworld-generation"].cross_pack_routes[0].route_owner =
        "project89.operation-liberation";
    }),
    /Gate .* is owned by project89\.composition\.three-rings, not generated owner project89\.operation-liberation/,
  );
});

test("optional side content is missable only by explicit declaration", () => {
  const core = structuredClone(
    official.manifests.find((manifest) => manifest.id === "cosyworld.core")
      .extensions[extensionName],
  );
  core.optional_content[0].missable = false;
  assert.match(
    progressionSafetyValidationErrors(core).join("\n"),
    /optional side content must explicitly declare missable true/,
  );
});

test("failure messages name the missing Lead and Anchor", () => {
  assert.match(
    errorsForWorld(boundedRuinContext(), (context) => {
      context.manifests[0]
        .extensions["x-cosyworld-threshold-descriptors"]
        .leads = [];
      context.manifests[0]
        .extensions["x-cosyworld-threshold-descriptors"]
        .anchors = [];
    }),
    /required Lead fixture\.discovery:lead\/cairn-track.*missing[\s\S]*missing Anchor fixture\.discovery:anchor\/moonlit-cairn/,
  );
});
