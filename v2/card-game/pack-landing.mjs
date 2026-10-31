import landings from "./pack-landings.json" with { type: "json" };
import { packDefinition } from "./pack-registry.mjs";
import { addLog, createWorld } from "./world.mjs";

export function landingPack(url) {
  const address = new URL(url);
  const id = address.searchParams.get("pack") || landings[address.hostname];
  return packDefinition(id);
}

// New game draws its run seed here, outside the rules.
export const newRunSeed = () =>
  globalThis.crypto.getRandomValues(new Uint32Array(1))[0];

export function createLandingWorld(pack = null, seed = newRunSeed()) {
  const world = createWorld({ opening: !pack, seed });
  if (!pack) return world;
  // A world's own landing opens its whole pool, with everyone at home.
  if (pack.specials) {
    const pool = pack.specials.pool.map((e) => e.id);
    world.packs[pack.id].specials = pool.filter((id) => pack.places[id]);
    for (const id of pool) {
      if (pack.avatars[id]) world.actors[id].place = pack.avatars[id].place;
      if (pack.items?.[id]) world.items[id].holder = pack.items[id].holder;
    }
  }
  world.actors.vale.place = pack.entry;
  // A retired crossing stays closed in a new game.
  for (const crossing of pack.crossings)
    if (!crossing.retired) world.crossings[crossing.id].discovered = true;
  // A landing starts inside the pack, so its things that start outside it,
  // such as the Hoppy Cat spool at Black pond, wait at the entry instead.
  for (const [id, item] of Object.entries(pack.items || {}))
    if (!pack.places[item.holder] && !pack.avatars?.[item.holder])
      world.items[id].holder = pack.entry;
  addLog(
    world,
    "World",
    `Vale arrives at ${pack.places[pack.entry].name}. ${pack.description}`,
  );
  return world;
}
