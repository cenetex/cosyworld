import { createWorld } from "../../v2/card-game/world.mjs";

// Use the same opening as a new browser table or shared world.
export function atticOpening() {
  return createWorld({ opening: true });
}
