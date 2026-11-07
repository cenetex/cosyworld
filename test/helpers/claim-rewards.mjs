import { legalActions, play } from "../../v2/card-game/world.mjs";

export function collectRewards(world, actor = "vale") {
  for (const action of legalActions(world, actor).filter((a) => a.kind === "claim")) {
    const result = play(world, action, world.revision, actor);
    if (!result.ok) throw new Error(result.error);
    world = result.state;
  }
  return world;
}
