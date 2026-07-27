import assert from "node:assert/strict";
import test from "node:test";

import { roomFeatureSchemaValidationErrors } from "./room-feature-schema.mjs";

const validLodging = {
  key: "lodging",
  lodging: {
    gate: {
      kind: "open",
    },
  },
};

test("lodging requires its typed declaration", () => {
  assert.deepEqual(
    roomFeatureSchemaValidationErrors({ key: "lodging" }),
    ["room feature lodging must be an object"],
  );
});

test("lodging requires a gate", () => {
  assert.deepEqual(
    roomFeatureSchemaValidationErrors({ key: "lodging", lodging: {} }),
    ["room feature lodging gate must be an object"],
  );
});

test("lodging rejects unsupported gate kinds", () => {
  assert.deepEqual(
    roomFeatureSchemaValidationErrors({
      ...validLodging,
      lodging: { gate: { kind: "orb_price" } },
    }),
    ["room feature lodging gate kind must be open"],
  );
});

test("open lodging and ordinary room features pass", () => {
  assert.deepEqual(roomFeatureSchemaValidationErrors(validLodging), []);
  assert.deepEqual(roomFeatureSchemaValidationErrors({ key: "hearth" }), []);
});
