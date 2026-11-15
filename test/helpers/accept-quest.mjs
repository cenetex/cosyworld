import { expect } from "vitest";
import { toldWant } from "../../v2/card-game/talk-quest.mjs";
import { heldOf } from "../../v2/card-game/want.mjs";
import { play, questPreviews } from "../../v2/card-game/world.mjs";

export function heldFrom(world, teller, actor = "vale") {
  expect(toldWant(world, actor, teller), `${teller} told ${actor} a want`).toBe(
    true,
  );
  const offer = questPreviews(world, actor).find((q) => q.source === teller && q.action);
  if (offer) {
    const result = play(world, offer.action, world.revision, actor);
    expect(result.ok, result.error).toBe(true);
    Object.assign(world, result.state);
  }
  expect(
    heldOf(world.actors[actor]).map((w) => w.from),
    `${actor} holds the quest from ${teller}`,
  ).toContain(`quest:from:${teller}`);
  return world;
}
export const acceptQuest = heldFrom;
