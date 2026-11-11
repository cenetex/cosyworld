import { expect } from "vitest";
import { toldWant } from "../../v2/card-game/talk-quest.mjs";
import { legalActions, play } from "../../v2/card-game/world.mjs";

// Talk tells a want and the player takes it by a tap on the resident's quest
// card (Accept quest): the `take` play of the offer `quest:from:<teller>`.
// The helper plays it as the tap would, in place, so a test can go on with
// the world it holds. Only a want the player was just told, offered this
// visit, and only while the player holds none.
export function acceptQuest(world, teller, actor = "vale") {
  expect(toldWant(world, actor, teller), `${teller} told ${actor} a want`).toBe(
    true,
  );
  expect(world.actors[actor].want, `${actor} holds nothing`).toBeNull();
  const action = legalActions(world, actor).find(
    (a) => a.kind === "take" && a.offer === `quest:from:${teller}`,
  );
  expect(action, `${teller} offers ${actor} a quest`).toBeTruthy();
  const result = play(world, action, world.revision, actor);
  expect(result.ok, result.error).toBe(true);
  Object.assign(world, result.state);
  return world;
}
