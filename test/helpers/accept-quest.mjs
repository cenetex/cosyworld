import { expect } from "vitest";
import { toldWant } from "../../v2/card-game/talk-quest.mjs";
import { heldOf } from "../../v2/card-game/want.mjs";

export function heldFrom(world, teller, actor = "vale") {
  expect(toldWant(world, actor, teller), `${teller} told ${actor} a want`).toBe(
    true,
  );
  expect(
    heldOf(world.actors[actor]).map((w) => w.from),
    `${actor} holds the quest from ${teller}`,
  ).toContain(`quest:from:${teller}`);
  return world;
}
export const acceptQuest = heldFrom;
