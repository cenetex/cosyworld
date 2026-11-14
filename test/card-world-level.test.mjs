import { test } from "vitest";
import assert from "node:assert/strict";
import { createWorld } from "../v2/card-game/world.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import landings from "../v2/card-game/pack-landings.json" with { type: "json" };
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave } from "../v2/card-game/world.mjs";
import {
  TIER_KEY,
  cachedWorldTier,
  rememberWorldTier,
  worldLevel,
  worldPoints,
} from "../v2/card-game/world-level.mjs";
import { rankOf } from "../v2/card-game/level-tiers.mjs";
import { rankXp } from "../v2/card-game/want.mjs";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
  };
};
// A resident who starts at level 1 reaches a level on the 0-21 track at the
// experience of its rank, which takes moments (at most eight a moment).
const raise = (world, id, level) => {
  world.actors[id].xp = rankXp(rankOf(level));
  world.turn = Math.max(world.turn, Math.ceil(world.actors[id].xp / 8));
  world.revision = Math.max(world.revision, world.turn);
  return world;
};

test("a new world, and each site's landing world, is Common", () => {
  assert.deepEqual(worldLevel(createWorld({ seed: 7 })), {
    level: 1,
    tier: worldLevel(createWorld()).tier,
  });
  assert.equal(worldLevel(createWorld()).tier.id, "common");
  for (const id of new Set(Object.values(landings))) {
    const { level, tier } = worldLevel(
      createLandingWorld(packDefinition(id), 3),
    );
    assert.equal(tier.id, "common", id);
    assert.ok(level < 10, id);
  }
});

test("the level is the same for the same world, local or shared", () => {
  const world = raise(createWorld({ seed: 11 }), "moth", 6);
  world.openedRoutes = ["forest-garden>forest-trail"];
  assert.deepEqual(worldLevel(world), worldLevel(structuredClone(world)));
  const shared = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  raise(shared, "moth", 6).openedRoutes = world.openedRoutes;
  const view = dispatchShared({
    op: "view",
    world: shared,
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
  }).world;
  assert.equal(worldPoints(view), worldPoints(world));
  assert.equal(worldPoints(view), 6);
});

test("resident levels gained and ways opened count; players do not", () => {
  const world = createWorld();
  raise(world, "moth", 4);
  assert.equal(worldPoints(world), 3);
  world.actors.vale.xp = 500;
  world.actors.vale.level = 30;
  assert.equal(worldPoints(world), 3, "a player's level is left out");
  world.openedRoutes = ["a>b", "c>d"];
  assert.equal(worldPoints(world), 5);
  const [crossing] = Object.keys(world.crossings);
  world.crossings[crossing].discovered = true;
  assert.equal(worldPoints(world), 6);
});

test("thresholds follow the game's level tiers", () => {
  const at = (points) => {
    const world = createWorld();
    if (points) raise(world, "moth", 1 + points);
    return worldLevel(world);
  };
  assert.deepEqual(
    [0, 4, 5, 9, 10, 13, 14, 17, 18, 19, 20].map((p) => [
      at(p).level,
      at(p).tier.id,
    ]),
    [
      [1, "common"],
      [5, "common"],
      [6, "uncommon"],
      [10, "uncommon"],
      [11, "rare"],
      [14, "rare"],
      [15, "epic"],
      [18, "epic"],
      [19, "legendary"],
      [20, "legendary"],
      [21, "mythic"],
    ],
  );
});

test("the browser remembers each world's tier for the menu", () => {
  const storage = memoryStorage();
  const rare = worldLevel(raise(createWorld(), "moth", 11)).tier;
  assert.equal(cachedWorldTier("world:a", storage).id, "common");
  rememberWorldTier("world:a", rare, storage);
  assert.equal(cachedWorldTier("world:a", storage).id, "rare");
  for (let i = 0; i < 45; i++) rememberWorldTier(`world:${i}`, rare, storage);
  const kept = JSON.parse(storage.getItem(TIER_KEY));
  assert.equal(Object.keys(kept).length, 40);
  assert.equal(cachedWorldTier("world:a", storage).id, "common");
  storage.setItem(TIER_KEY, "not json");
  assert.equal(cachedWorldTier("world:44", storage).id, "common");
});
