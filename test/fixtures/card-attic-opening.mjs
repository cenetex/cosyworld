import { createWorld, holdChoice } from "../../v2/card-game/world.mjs";

// Use the same opening as a new browser table or shared world.
export function atticOpening() {
  return createWorld({ opening: true });
}

// Quiet physical selection, not a retired Light/Snuff gameplay action.
export function selectLamp(world, item = null) {
  const next = structuredClone(world);
  holdChoice(next, "vale", { item, revision: next.revision });
  return next;
}
