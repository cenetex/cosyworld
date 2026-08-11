import assert from "node:assert/strict";
import test from "node:test";

import { spatialSceneValidationErrors } from "./spatial-scene-schema.mjs";

const fixture = {
  scenes: [{
    schema_version: 1,
    id: "test:scene:1",
    location_id: 1,
    projection: "isometric",
    camera: "north_east",
    palette: "flooded_moor",
    viewer_site_id: "entry",
    sites: [
      { id: "entry", label: "Entry", kind: "entry", tiles: [[0, 0, 0]] },
      { id: "gate", label: "Gate", kind: "exit", tiles: [[1, 0, 0]] },
    ],
    links: [{ from_site_id: "entry", to_site_id: "gate" }],
    anchors: [
      { kind: "actor", actor_id: 10, site_id: "entry" },
      { kind: "feature", feature_key: "flame", site_id: "entry" },
      { kind: "exit", destination_location_id: 2, site_id: "gate" },
    ],
    constraints: [{
      id: "keeper-blocks-gate",
      kind: "active_actor_blocks_exit",
      actor_id: 10,
      destination_location_id: 2,
      label: "The keeper bars the gate.",
    }],
  }],
  locations: [{ id: 1, interior_view: "isometric" }],
  actors: [{ id: 10 }],
  roomFeatures: [{ location_id: 1, key: "flame" }],
  exits: [{ from_location_id: 1, to_location_id: 2 }],
};

test("a connected isometric scene with typed anchors passes", () => {
  assert.deepEqual(spatialSceneValidationErrors(fixture), []);
});

test("scenes fail closed on disconnected sites and missing references", () => {
  const broken = structuredClone(fixture);
  broken.scenes[0].links = [];
  broken.scenes[0].anchors[0].actor_id = 99;
  const errors = spatialSceneValidationErrors(broken);
  assert(errors.some((error) => error.includes("must declare 1-48 links")));
  assert(errors.some((error) => error.includes("site graph must be connected")));
  assert(errors.some((error) => error.includes("missing actor 99")));
});

test("scene coordinates are bounded presentation data", () => {
  const broken = structuredClone(fixture);
  broken.scenes[0].sites[0].tiles = [[17, 0, 0]];
  assert(spatialSceneValidationErrors(broken).some((error) => error.includes("invalid tile")));
});
