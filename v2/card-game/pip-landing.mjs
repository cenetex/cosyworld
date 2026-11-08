import { addLog, createWorld } from "./world.mjs";
import { newMemories } from "./memory.mjs";
import { createLandingWorld, newRunSeed } from "./pack-landing.mjs";
import landings from "./pack-landings.json" with { type: "json" };
import { questFor } from "./talk-quest.mjs";
import { pushQuest } from "./want.mjs";

// A physical Pip card opens its own local world. Explicit world links win.
export function pipEntry(href) {
  const url = new URL(href);
  return (
    /^\/pip\/?$/u.test(url.pathname) &&
    !landings[url.hostname] &&
    !["world", "table", "pack"].some((key) => url.searchParams.has(key))
  );
}

export function createPipWorld(seed = newRunSeed()) {
  const world = createWorld({ seed });
  world.actors.vale.place = "pond";
  world.actors.vale.visited = ["pond"];
  world.actors.keeper.place = "station";
  world.actors.keeper.visited = ["station"];
  world.log = [];
  world.eventSeq = 0;
  world.memories = newMemories();
  addLog(world, "World", "You found Pip.");
  return world;
}

export function beginPipJourney(seed = newRunSeed()) {
  const world = createLandingWorld(null, seed);
  pushQuest(world, "vale", {
    ...questFor(world, "moth", world.actors.moth.want),
    story: true,
  });
  return world;
}
