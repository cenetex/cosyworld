import { legalActions, play, wantAPI } from "../../v2/card-game/world.mjs";
import { questXp, questsOf } from "../../v2/card-game/want.mjs";

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
// With `dream`, the avatar instead sleeps a long rest at a sanctuary with
// the experience for its next level, so the rest dreams the level quest:
// since rules 99 the only dreams are the rules' own, the halfway glimpse
// and the level quest.
export function rest(world, { dream = false } = {}) {
  if (!dream) return wait(world);
  let next = structuredClone(world);
  const actor = next.playerActorId || "vale",
    a = next.actors[actor];
  a.level ??= 1;
  if (!questsOf(next, actor).some((w) => w.quest))
    a.xp = Math.max(a.xp, questXp(a.level + 1));
  if (!wantAPI(next).sanctuaries.includes(a.place)) a.place = "attic";
  // An unlit lamp lets the sleep run long.
  for (const item of Object.values(next.items)) if (item.lit) item.lit = false;
  next = sleep(wait(next));
  const dreamt = (s) =>
    s.log.findLast((e) => e.actorId === actor && e.woke !== undefined)
      ?.dream === "quest";
  for (let i = 0; i < 8 && !dreamt(next); i++) next = sleep(next);
  if (!dreamt(next)) throw new Error("the rest did not dream");
  return next;
}
