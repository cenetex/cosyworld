import { addLog, createWorld } from "./world.mjs";
import { newMemories } from "./memory.mjs";
import { settleHeldItems } from "./held-item.mjs";
import { newRunSeed } from "./pack-landing.mjs";

// A physical Pip card opens its own local world. Explicit world links win.
export function pipEntry(href) {
  const url = new URL(href);
  return (
    /^\/pip\/?$/u.test(url.pathname) &&
    !["world", "table", "pack"].some((key) => url.searchParams.has(key))
  );
}

export function createPipWorld(seed = newRunSeed()) {
  const world = createWorld({ seed });
  world.actors.vale.place = "pond";
  world.actors.vale.visited = ["pond"];
  world.actors.keeper.place = "station";
  world.actors.keeper.visited = ["station"];
  world.items.lamp.holder = "vale";
  world.items.lamp.lit = true;
  settleHeldItems(world);
  world.log = [];
  world.eventSeq = 0;
  world.memories = newMemories();
  addLog(
    world,
    "World",
    "You found Pip. The Lamp in your hand lights his wings.",
  );
  return world;
}
