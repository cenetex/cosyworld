import { addLog, createWorld, legalActions, play } from "./world.mjs";
import { newMemories } from "./memory.mjs";
import { createLandingWorld, newRunSeed } from "./pack-landing.mjs";
import landings from "./pack-landings.json" with { type: "json" };
import { toldWant } from "./talk-quest.mjs";
import { learnTold } from "./quest-learn.mjs";

export const pipHeard = (world) => toldWant(world, "vale", "moth");

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

// Pip's Talk is the rules' own: it records the want he told, and his quest
export function talkToPip(world) {
  const talk = legalActions(world).find(
    (a) => a.kind === "talk" && a.target === "moth",
  );
  const result = talk && play(world, talk);
  return result?.ok ? result.state : world;
}

// The first world after Pip's card: Vale in the attic, carrying what Pip told
export function beginPipJourney(seed = newRunSeed(), prelude = talkToPip(createPipWorld(seed))) {
  const world = createLandingWorld(null, seed);
  const { want } = prelude.actors.vale;
  if (
    pipHeard(prelude) &&
    world.actors.moth.want?.target === prelude.actors.moth.want.target
  )
    learnTold(world, "moth", "vale");
  // so the pond's offer of it is not a second one.
  if (want)
    world.actors.vale.want = { ...structuredClone(want), since: world.turn };
  return world;
}
