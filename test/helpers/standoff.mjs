import {
  currentActor,
  legalActions,
  opponentOf,
  play,
  standoffFor,
} from "../../v2/card-game/world.mjs";

// A standoff locks its room until both fighters stand down. A scripted
// walkthrough that means to move on or handle items first talks its way out;
// a resident opponent stands down in turn, which ends it. A bystander waits
// for the fighters to finish.
export function endStandoff(world, limit = 12) {
  for (let i = 0; i < limit; i++) {
    const actor = currentActor(world),
      here = world.actors[actor].place;
    if (!world.standoffs.some((c) => c.location === here)) return world;
    const mine = standoffFor(world, actor);
    const action = legalActions(world).find((a) =>
      mine
        ? a.kind === "talk" && a.target === opponentOf(mine, actor)
        : a.kind === "wait",
    );
    const result = play(world, action, world.revision);
    if (!result.ok) throw Error(result.error);
    world = result.state;
  }
  throw Error("The standoff did not end.");
}
