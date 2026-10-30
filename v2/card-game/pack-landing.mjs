import landings from "./pack-landings.json" with { type: "json" };
import { packDefinition } from "./pack-registry.mjs";
import { addLog, createWorld } from "./world.mjs";

export function landingPack(url) {
  const address = new URL(url);
  const id = address.searchParams.get("pack") || landings[address.hostname];
  return packDefinition(id);
}

export function createLandingWorld(pack = null) {
  const world = createWorld({ opening: !pack });
  if (!pack) return world;
  world.actors.vale.place = pack.entry;
  // A retired crossing stays closed in a new game.
  for (const crossing of pack.crossings)
    if (!crossing.retired) world.crossings[crossing.id].discovered = true;
  addLog(
    world,
    "World",
    `Vale arrives at ${pack.places[pack.entry].name}. ${pack.description}`,
  );
  return world;
}
