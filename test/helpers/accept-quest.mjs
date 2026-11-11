import { expect } from "vitest";
import { questFor, toldWant } from "../../v2/card-game/talk-quest.mjs";
import { setWant } from "../../v2/card-game/want.mjs";

// Talk tells a want and the player takes it by a tap (Accept quest, a later
// package). Until that is a play, tests take the quest as the tap would: only
// a want the player was just told, and only while the player holds none.
export function acceptQuest(world, teller, actor = "vale") {
  expect(toldWant(world, actor, teller), `${teller} told ${actor} a want`).toBe(
    true,
  );
  expect(world.actors[actor].want, `${actor} holds nothing`).toBeNull();
  const quest = questFor(world, teller, world.actors[teller].want);
  setWant(world.actors[actor], quest);
  return world;
}
