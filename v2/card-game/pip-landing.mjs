import { addLog, createWorld, legalActions, play } from "./world.mjs";
import { newMemories } from "./memory.mjs";
import { createLandingWorld, newRunSeed } from "./pack-landing.mjs";
import landings from "./pack-landings.json" with { type: "json" };

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

export function talkToPip(world) {
  const talk = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === "moth",
  );
  const result = talk && play(world, talk);
  return result?.ok ? result.state : world;
}

export function beginPipJourney(seed = newRunSeed(), prelude = talkToPip(createPipWorld(seed))) {
  const world = createLandingWorld(null, seed);
  const { heard, want, pendingQuests } = prelude.actors.vale;
  if (heard) world.actors.vale.heard = structuredClone(heard);
  if (want)
    world.actors.vale.want = { ...structuredClone(want), since: world.turn };
  if (pendingQuests)
    world.actors.vale.pendingQuests = pendingQuests.map((q) => ({
      ...structuredClone(q), since: world.turn,
    }));
  return world;
}
