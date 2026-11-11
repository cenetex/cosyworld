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

// Pip's Talk is the rules' own: it records the want he told. The prelude
// plays it, and the quest itself waits as his offer card (rules 133).
export function talkToPip(world) {
  const talk = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === "moth",
  );
  const result = talk && play(world, talk);
  return result?.ok ? result.state : world;
}

// The first world after Pip's card: Vale in the attic, still carrying what
// Pip told her. Nothing is taken; Pip's Accept quest card lies where he
// stands, once the lamp is out and she reaches him.
export function beginPipJourney(seed = newRunSeed(), prelude = talkToPip(createPipWorld(seed))) {
  const world = createLandingWorld(null, seed);
  const heard = prelude.actors.vale.heard;
  if (heard) world.actors.vale.heard = structuredClone(heard);
  return world;
}
