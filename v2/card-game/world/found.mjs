import { packOf } from "../pack-registry.mjs";

export function found(world, speaker, id) {
  const a = world.actors[speaker];
  if (world.actors[id])
    return (
      !a?.talked ||
      a.talked.includes(id) ||
      world.opening?.met?.[id] !== undefined ||
      world.packs?.[packOf(id)?.id]?.met?.[id] !== undefined
    );
  return Boolean(world.items[id]) || !a?.visited || a.visited.includes(id);
}
