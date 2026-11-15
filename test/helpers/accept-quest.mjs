import { expect } from "vitest";
import { toldWant } from "../../v2/card-game/talk-quest.mjs";
import { heldOf } from "../../v2/card-game/want.mjs";
import { legalActions, play } from "../../v2/card-game/world.mjs";

export function acceptOffer(world, teller, actor = "vale") {
  const accept = legalActions(world, actor).find(
    (a) => a.kind === "accept" && a.target === teller,
  );
  expect(accept, `${teller} offers ${actor} a quest`).toBeTruthy();
  const done = play(world, accept, world.revision, actor);
  expect(done.ok).toBe(true);
  return done.state;
}

export function heldFrom(world, teller, actor = "vale") {
  expect(toldWant(world, actor, teller), `${teller} told ${actor} a want`).toBe(
    true,
  );
  const held = (w) => heldOf(w.actors[actor]).map((q) => q.from);
  const after = held(world).includes(`quest:from:${teller}`)
    ? world
    : acceptOffer(world, teller, actor);
  expect(held(after), `${actor} holds the quest from ${teller}`).toContain(
    `quest:from:${teller}`,
  );
  return after;
}
export const acceptQuest = heldFrom;
