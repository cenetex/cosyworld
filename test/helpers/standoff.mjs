import { currentActor, legalActions, play } from "../../v2/card-game/world.mjs";

// A battle locks its room until a full round passes without a Strike. A
// scripted walkthrough that means to move on or handle items first waits it
// out; residents nobody is striking wait too, which ends it.
export function endStandoff(world, limit = 12) {
  for (let i = 0; i < limit; i++) {
    const here = world.actors[currentActor(world)].place;
    if (!world.standoffs.some((c) => c.location === here)) return world;
    const action = legalActions(world).find((a) => a.kind === "wait");
    const result = play(world, action, world.revision);
    if (!result.ok) throw Error(result.error);
    world = result.state;
  }
  throw Error("The battle did not end.");
}
