import { encodeSave } from "../../v2/card-game/world.mjs";
import { dispatchShared } from "../../v2/card-game/shared-world.mjs";
import { openDoorStart, openDoorWalk } from "./open-door.mjs";

export const agoraVisitors = ["vale", "mara", "ash", "nell", "tavi"];

// Imported local fixture: the traveler reached Eleusis through legal roads.
// Four other shared avatars are ready to claim their places in the Agora.
export function crowdedAgoraWorld() {
  const solo = openDoorWalk(openDoorStart(), "harbor", "athens", "eleusis");
  const world = dispatchShared({ op: "create", save: encodeSave(solo) }).world;
  for (const id of agoraVisitors.slice(1))
    world.actors[id].place = "greek-athens";
  return world;
}

export function agoraView(world, present = agoraVisitors, actor = "vale") {
  return dispatchShared({
    op: "view",
    world,
    actor,
    claimed: agoraVisitors,
    present,
  });
}
