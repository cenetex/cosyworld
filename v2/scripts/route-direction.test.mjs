import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalRouteDirection,
  routeDiscoveryPolicy,
  routeDiscoveryValidationErrors,
  routeDirectionValidationErrors,
} from "./route-direction.mjs";

test("route directions canonicalize exactly like the runtime", () => {
  assert.equal(canonicalRouteDirection(" N "), "north");
  assert.equal(canonicalRouteDirection("north-east"), "northeast");
  assert.equal(canonicalRouteDirection("inside"), "in");
  assert.equal(canonicalRouteDirection("homeward"), "out");
  assert.equal(canonicalRouteDirection("safehouse signal"), null);
});

test("route direction validation rejects narrative labels", () => {
  assert.deepEqual(
    routeDirectionValidationErrors([
      {
        from_location_id: 1,
        to_location_id: 2,
        direction: "safehouse signal",
      },
    ], []),
    [
      "exit 1->2 must declare a canonical direction; received \"safehouse signal\"",
    ],
  );
});

test("route direction collisions compare canonical aliases across visible and hidden exits", () => {
  const errors = routeDirectionValidationErrors([
    {
      from_location_id: 1,
      to_location_id: 2,
      direction: "n",
    },
  ], [
    {
      id: "secret-north",
      from_location_id: 1,
      to_location_id: 3,
      direction: "north",
      return_direction: "south",
    },
    {
      id: "secret-return",
      from_location_id: 4,
      to_location_id: 3,
      direction: "east",
      return_direction: "s",
    },
  ]);

  assert.equal(errors.length, 2);
  assert.match(errors[0], /hidden exit secret-north outbound.*already claimed/);
  assert.match(errors[1], /hidden exit secret-return return.*already claimed/);
});

test("distinct canonical visible and hidden directions pass", () => {
  assert.deepEqual(
    routeDirectionValidationErrors([
      {
        from_location_id: 1,
        to_location_id: 2,
        direction: "north",
      },
    ], [
      {
        id: "secret-east",
        from_location_id: 1,
        to_location_id: 3,
        direction: "east",
        return_direction: "west",
      },
    ]),
    [],
  );
});

test("route discovery accepts known and scout while legacy omission defaults to scout", () => {
  const legacyExit = {
    from_location_id: 1,
    to_location_id: 2,
    direction: "north",
  };
  assert.equal(routeDiscoveryPolicy(legacyExit), "scout");
  assert.deepEqual(routeDiscoveryValidationErrors([
    legacyExit,
    { ...legacyExit, discovery: "known" },
    { ...legacyExit, discovery: "scout" },
  ]), []);
});

test("route discovery rejects unknown values and non-string values", () => {
  const errors = routeDiscoveryValidationErrors([
    {
      from_location_id: 1,
      to_location_id: 2,
      direction: "north",
      discovery: "public",
    },
    {
      from_location_id: 2,
      to_location_id: 1,
      direction: "south",
      discovery: true,
    },
  ]);

  assert.equal(errors.length, 2);
  assert.match(errors[0], /invalid discovery "public"/);
  assert.match(errors[1], /invalid discovery true/);
});
