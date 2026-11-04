// A chosen quest's next step on the context button: one play the rules
// already offer (`legalActions`) that moves the quest on, or the reason
// there is none. Presentation only; the rules decide nothing new here.
import { questDistance } from "./quest-card.mjs";
import { itemPlace, legalActions, rootHolder } from "./world.mjs";

export const NOT_FOUND = "Not found yet";
export const NO_WAY = "No way there yet";

const standingAt = (world, actor, place) => ({
  ...world,
  actors: { ...world.actors, [actor]: { ...world.actors[actor], place } },
});

// Where the quest's next step happens.
function destination(world, quest) {
  const { actor, kind, target, step } = quest,
    placeOf = (id) => world.actors[id]?.place ?? null;
  if (kind === "place") return target;
  if (kind === "person") {
    if (step?.verb === "bring")
      return placeOf(target) === placeOf(actor)
        ? (step.at ?? placeOf(step.to))
        : placeOf(target);
    return step?.verb === "meet" && step.at ? step.at : placeOf(target);
  }
  if (kind !== "item") return null;
  if (rootHolder(world, target) !== actor || step?.verb === "find")
    return itemPlace(world, target);
  if (step?.verb === "give") return placeOf(step.to);
  return step?.verb === "bring" ? step.at : null;
}

// The play that does the step where the player stands.
function directPlay(world, quest, legal) {
  const { actor, kind, target, step } = quest,
    mine = legal.filter((a) => a.actor === actor);
  if (kind === "person")
    return step
      ? null
      : mine.find((a) => a.kind === "talk" && a.target === target);
  if (kind !== "item" || step?.verb === "find") return null;
  if (rootHolder(world, target) === actor)
    return step?.verb === "give"
      ? mine.find(
          (a) => a.kind === "give" && a.item === target && a.target === step.to,
        )
      : null;
  return (
    mine.find((a) => a.kind === "take" && a.item === target) ??
    mine.find((a) => a.kind === "ask" && a.item === target)
  );
}

// `{ action }`, `{ rest: true }` (Wait, then Sleep, as the hand offers
// them), `{ reason }`, or null when the quest has no step to show.
export function questStep(world, quest, covered, legal = legalActions(world)) {
  const { actor, kind, target, step } = quest;
  if (kind === "connect" || !target) return null;
  if (covered) return { reason: NOT_FOUND };
  const here = world.actors[actor].place;
  if (kind === "place" && step?.verb === "rest" && here === target)
    return { rest: true };
  const action = directPlay(world, quest, legal);
  if (action) return { action };
  const to = destination(world, quest);
  if (!to || to === here) return null;
  const now = questDistance(world, actor, to);
  const move =
    now !== null &&
    legal.find(
      (a) =>
        a.actor === actor &&
        a.kind === "move" &&
        !a.item &&
        questDistance(standingAt(world, actor, a.target), actor, to) ===
          now - 1,
    );
  return move ? { action: move } : { reason: NO_WAY };
}
