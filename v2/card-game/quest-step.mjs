// A chosen quest offers a legal act that completes its goal or authored stage.
// The player chooses how to gather supplies and reach the goal.
import { packGiveChoice } from "./pack-registry.mjs";
import { questVisible } from "./quest-card.mjs";
import {
  accompanyDecision,
  currentActor,
  expects,
  itemPlace,
  legalActions,
  play,
  rootHolder,
  willingToGive,
} from "./world.mjs";
import { holdsAsWanted } from "./want.mjs";

export const NOT_FOUND = "Not found yet";

// A known quest can name a private carried item. The player chooses the
// payment; the rules offer and resolve the same Trade as an item-card pair.
export function questTrade(
  world,
  quest,
  selected,
  known,
  legal = legalActions(world),
) {
  if (
    !quest ||
    quest.receiptId !== undefined ||
    quest.kind !== "item" ||
    quest.actor !== currentActor(world) ||
    !questVisible(world, quest)
  )
    return null;
  const cards = [...new Set(selected)].filter((id) => id !== quest.actor),
    owner = world.items[quest.target]?.holder;
  if (
    cards.length !== 1 ||
    world.items[cards[0]]?.holder !== quest.actor ||
    !world.actors[owner] ||
    owner === quest.actor ||
    ![cards[0], quest.target, owner].every(known)
  )
    return null;
  return (
    legal.find(
      (action) =>
        action.kind === "trade" &&
        action.actor === quest.actor &&
        action.item === cards[0] &&
        action.receive === quest.target &&
        action.target === owner,
    ) ?? null
  );
}

function accepted(world, action) {
  if (action.kind === "give")
    return packGiveChoice(world, action) || expects(world, action);
  if (action.kind === "ask")
    return willingToGive(world, action.target, action.item, action.actor);
  if (action.kind === "accompany")
    return accompanyDecision(
      world,
      action.actor,
      action.target,
      action.destination,
      true,
    ).accepted;
  // Meal consent is private to the rules. Read its resolved event from a copy.
  if (action.kind === "eat" && action.target) {
    const result = play(world, action, world.revision, action.actor);
    return (
      result.ok &&
      result.state.log.some(
        (event) =>
          event.seq > world.eventSeq &&
          event.verb === "eat" &&
          event.actorId === action.actor &&
          event.accepted === true,
      )
    );
  }
  return true;
}

export function questStep(world, quest, covered, legal = legalActions(world)) {
  if (!questVisible(world, quest)) return null;
  const { actor, kind, target, step } = quest;
  if (kind === "connect" || !target) return null;
  if (covered) return { reason: NOT_FOUND };
  const here = world.actors[actor].place,
    mine = legal.filter((a) => a.actor === actor),
    placeOf = (id) => world.actors[id]?.place,
    choose = (test) => {
      const action = mine.find((a) => test(a) && accepted(world, a));
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
    if (step.to && placeOf(step.to) !== to) return null;
    return rootHolder(world, target) === actor
      ? arrive(to)
      : here === to
        ? choose((a) => ["take", "ask"].includes(a.kind) && a.item === target)
        : null;
  }
  if (step) return choose((a) => a.kind === step.verb && a.target === target);
  if (kind === "place") return arrive(target);
  if (kind === "person")
    return choose((a) => a.kind === "talk" && a.target === target);
  if (kind !== "item") return null;
  return choose((a) => {
    const taking = ["take", "ask"].includes(a.kind),
      lighting = ["light", "snuff"].includes(a.kind);
    if (
      (!taking && !lighting) ||
      (a.item !== target && world.items[a.item]?.holder !== target)
    )
      return false;
    const item = { ...world.items[a.item] };
    if (taking) item.holder = actor;
    else item.lit = a.kind === "light";
    return holdsAsWanted(
      { ...world, items: { ...world.items, [a.item]: item } },
      actor,
      quest,
    );
  });
}
