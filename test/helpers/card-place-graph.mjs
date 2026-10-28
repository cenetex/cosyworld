import { currentActor, exits, places } from "../../v2/card-game/world.mjs";

// Pure quest generators receive the same visible roads as a live planner.
export const currentPlaces = (world, actor = currentActor(world)) =>
  Object.fromEntries(
    Object.entries(places).map(([id, place]) => [
      id,
      { ...place, exits: exits(world, id, actor) },
    ]),
  );
