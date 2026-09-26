import assert from "node:assert/strict";
import test from "node:test";
import { arrivalLocationId, isSolanaAddress, linkedAvatarsValidationErrors } from "./linked-avatars-schema.mjs";

const PROXIM8 = "5QBfYxnihn5De4UEV3U1To4sWuWoWwHYJsxpd3hPamaf";
const valid = () => ({
  schema_version: 1,
  sources: [
    { id: "proxim8", name: "Proxim8", collections: [PROXIM8], arrival_location: "cosyworld.core:location/1" },
    { id: "chosen", name: "Chosen", assets: ["Bcw1nuJtSXQcXTs7jBc5iN5v51Zm2vAsY2QcHNJVgvgo"], arrival_location: "cosyworld.core:location/1" },
  ],
});

test("a world may admit whole collections and specific assets", () => {
  assert.deepEqual(linkedAvatarsValidationErrors(valid(), "linked_avatars", new Set([1])), []);
});

test("addresses must be 32-byte base58", () => {
  assert.equal(isSolanaAddress(PROXIM8), true);
  assert.equal(isSolanaAddress("11111111111111111111111111111111"), true);
  assert.equal(isSolanaAddress("0OIl" + PROXIM8.slice(4)), false);
  assert.equal(isSolanaAddress(PROXIM8.slice(0, 20)), false);
});

test("characters group copies of one avatar", () => {
  const config = valid();
  config.sources.push({
    id: "rati-avatars", name: "RATi Avatar", arrival_location: "cosyworld.core:location/1",
    characters: [{ id: "santa-pooz", name: "Santa Pooz",
      assets: ["EM3tciRcUa8VeupDDdKBfZVH484LDRhqRpCZ8YsAGVGA", "EPzcJWBhPJJzwzEvNv5JXfhQ7cYaXDWFx9h16nHwzmpc"] }],
  });
  assert.deepEqual(linkedAvatarsValidationErrors(config), []);
  const twice = structuredClone(config);
  twice.sources[2].characters.push({ id: "again", name: "Again", assets: ["EM3tciRcUa8VeupDDdKBfZVH484LDRhqRpCZ8YsAGVGA"] });
  assert.notDeepEqual(linkedAvatarsValidationErrors(twice), []);
  const empty = structuredClone(config);
  empty.sources[2].characters[0].assets = [];
  assert.notDeepEqual(linkedAvatarsValidationErrors(empty), []);
});

test("bad sources are refused", () => {
  const cases = [
    (c) => { c.sources[0].collections = ["not-an-address"]; },
    (c) => { c.sources[1].assets = []; },
    (c) => { c.sources[1].id = "proxim8"; },
    (c) => { c.sources[0].arrival_location = "somewhere"; },
    (c) => { c.sources[0].standard = "metaplex_core"; },
    (c) => { c.schema_version = 2; },
    (c) => { c.sources = []; },
  ];
  for (const mutate of cases) {
    const config = valid();
    mutate(config);
    assert.notDeepEqual(linkedAvatarsValidationErrors(config), [], mutate.toString());
  }
  assert.notDeepEqual(linkedAvatarsValidationErrors(valid(), "linked_avatars", new Set([2])), []);
  assert.equal(arrivalLocationId("cosyworld.core:location/8900"), 8900);
});
