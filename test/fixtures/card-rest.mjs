import { homeOf, legalActions, play } from "../../v2/card-game/world.mjs";
import { sleepQuest } from "../../v2/card-game/want.mjs";

const wait = (world) =>
  play(
    world,
    legalActions(world).find((a) => a.kind === "wait"),
  ).state;
const sleep = (world) =>
  play(
    world,
    legalActions(world).find((a) => a.sleep),
  ).state;

// The current avatar chooses Wait, the only play that turns them inward.
// With `dream`, the avatar instead holds the sleep quest and sleeps a long
// rest at home, so the rest dreams the glimpse of a card.
export function rest(world, { dream = false } = {}) {
  if (!dream) return wait(world);
  let next = structuredClone(world);
  const actor = next.playerActorId || "vale",
    a = next.actors[actor];
  sleepQuest(next, actor, { home: homeOf });
  a.place = homeOf(actor);
  for (const item of Object.values(next.items)) if (item.lit) item.lit = false;
  next = sleep(wait(next));
  const dreamt = (s) =>
    s.log.findLast((e) => e.actorId === actor && e.woke !== undefined)
      ?.dream === "glimpse";
  for (let i = 0; i < 8 && !dreamt(next); i++) next = sleep(next);
  if (!dreamt(next)) throw new Error("the rest did not dream");
  return next;
}
