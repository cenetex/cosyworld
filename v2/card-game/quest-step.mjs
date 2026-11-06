// A chosen quest offers a legal act that completes its goal or authored stage.
// The player chooses how to gather supplies and reach the goal.
import { packGiveChoice } from "./pack-registry.mjs";
import { questVisible } from "./quest-card.mjs";
import { itemPlace, legalActions, rootHolder } from "./world.mjs";

export const NOT_FOUND = "Not found yet";

export function questStep(world, quest, covered, legal = legalActions(world)) {
  if (!questVisible(world, quest)) return null;
  const { actor, kind, target, step } = quest;
  if (kind === "connect" || !target) return null;
  if (covered) return { reason: NOT_FOUND };
  const here = world.actors[actor].place,
    mine = legal.filter((a) => a.actor === actor),
    placeOf = (id) => world.actors[id]?.place,
    choose = (test) => {
      const action = mine.find(test);
      return action ? { action } : null;
    },
    arrive = (place) =>
      choose((a) => a.kind === "move" && !a.item && a.target === place);
  if (step?.verb === "lay") {
    if (here !== target) return null;
    if (quest.remaining)
      return choose(
        (a) =>
          a.kind === "give" &&
          a.item === quest.remaining[0] &&
          a.target === "greek-antigone" &&
          packGiveChoice(world, a),
      );
    const missing = step.items.filter(
      (id) => world.items[id]?.holder !== target,
    );
    return missing.length === 1
      ? choose((a) => a.kind === "drop" && a.item === missing[0])
      : null;
  }
  if (step?.verb === "rest")
    return kind === "place" && here === target ? { rest: true } : null;
  if (step?.verb === "give")
    return choose(
      (a) => a.kind === "give" && a.item === target && a.target === step.to,
    );
  if (step?.verb === "eat")
    return !step.at || here === step.at
      ? choose(
          (a) =>
            a.kind === "eat" &&
            a.item === target &&
            (!step.with || a.target === step.with),
        )
      : null;
  if (step?.verb === "find") return arrive(itemPlace(world, target));
  if (step?.verb === "meet")
    return !step.at || placeOf(target) === step.at
      ? arrive(placeOf(target))
      : null;
  if (step?.verb === "bring") {
    const to = step.at ?? placeOf(step.to);
    if (kind === "person")
      return choose(
        (a) =>
          a.kind === "accompany" && a.target === target && a.destination === to,
      );
    return rootHolder(world, target) === actor &&
      (!step.to || placeOf(step.to) === to)
      ? arrive(to)
      : null;
  }
  if (step) return choose((a) => a.kind === step.verb && a.target === target);
  if (kind === "place") return arrive(target);
  if (kind === "person")
    return choose((a) => a.kind === "talk" && a.target === target);
  return kind === "item"
    ? choose((a) => ["take", "ask"].includes(a.kind) && a.item === target)
    : null;
}
