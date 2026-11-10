import { settleLamp } from "../lamp-state.mjs";
// World creation and run seeding, split out of world.mjs (#1390).
import { installJourneyProgress } from "../pack-journeys.mjs";
import { enableMotives } from "../motives.mjs";
import { newMemories, rememberEvent } from "../memory.mjs";
import { settleHeldItems } from "../held-item.mjs";
import { installKnowledge } from "../knowledge.mjs";
import { travels, fillWants } from "../want.mjs";
import { installLife } from "../life.mjs";
import { packDefinition, packDefinitions } from "../pack-registry.mjs";
import { validSeed } from "../pack-specials.mjs";
import forest from "../forest.json" with { type: "json" };
import { settleGuards } from "../resident-guard.mjs";
// These still live in world.mjs; the cycle resolves at call time.
import {
  installPacks,
  installRouteKnowledge,
  wantAPI,
  settleStationExits,
} from "../world.mjs";

export function createWorld({ opening = false, packScopes = {}, seed } = {}) {
  const world = {
    schema: 7,
    ...structuredClone(forest.initialState),
    memories: newMemories(),
    turn: 0,
    revision: 0,
    eventSeq: 1,
    conversations: [],
  };
  if (seed != null && !validSeed(seed)) throw new Error("Choose a run seed.");
  if (seed != null) world.run = { seed };
  if (opening) {
    const start = structuredClone(forest.opening);
    world.opening = start.discovery;
    for (const [id, fields] of Object.entries(start.actors))
      Object.assign(world.actors[id], fields);
    for (const [id, fields] of Object.entries(start.items))
      Object.assign(world.items[id], fields);
    world.log = start.log;
  }
  installPacks(world);
  installJourneyProgress(world, packDefinitions);
  for (const [id, scope] of Object.entries(packScopes)) {
    if (
      !world.packs[id] ||
      !["opening", "full"].includes(scope) ||
      !packDefinition(id)?.release
    )
      throw new Error("Unknown content scope.");
    world.packs[id].scope = scope;
  }
  enableMotives(world);
  installLife(world, travels);
  installRouteKnowledge(world);
  installKnowledge(world);
  // A new world starts with one want on every avatar but a player still
  // waiting for its first quest.
  fillWants(world, wantAPI(world), true);
  rememberEvent(world, world.log[0]);
  settleGuards(world);
  settleHeldItems(world);
  settleLamp(world);
  settleStationExits(world);
  return world;
}

export function seedRun(s, seed) {
  if (s.run || !validSeed(seed)) return s;
  s.run = { seed };
  // Doors placed before the world had a seed move to the seed's picks.
  delete s.doors;
  installPacks(s);
  return s;
}
