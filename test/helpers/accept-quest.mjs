import { expect } from "vitest";
import { toldWant } from "../../v2/card-game/talk-quest.mjs";
import { heldOf } from "../../v2/card-game/want.mjs";

// Talk tells a want, and the quest it gives is held at once by the play that
// made it stand (rules 134): there is no accept play. The helper asserts the
// player was told and now holds the quest from `quest:from:<teller>`, and
// returns the world so a test can go on with it.
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
// The earlier name, kept for tests not yet moved to `heldFrom`.
export const acceptQuest = heldFrom;
