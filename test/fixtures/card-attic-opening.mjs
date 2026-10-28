import { newMemories, rememberEvent } from "../../v2/card-game/memory.mjs";
import { createWorld } from "../../v2/card-game/world.mjs";

// A saved version 1 opening keeps its original quest sequence.
export function atticOpening() {
  const world = createWorld({ opening: true });
  world.opening = { version: 1, crossed: false, met: { vale: 0 } };
  world.actors.vale.place = "attic";
  world.log[0].locationId = "attic";
  world.log[0].cast = ["vale"];
  world.log[0].items = world.log[0].items.filter((item) => item.id === "lamp");
  world.log[0].text = "Vale stands alone in Mirror attic, holding an unlit lamp. A tall mirror reflects a black shore.";
  world.memories = newMemories();
  rememberEvent(world, world.log[0]);
  return world;
}
