import { desireFor } from "./quests.mjs";
import {
  places,
  people,
  things,
  nameOf,
  legalActions,
  itemPlace,
  rootHolder,
  exits,
  covered,
  handText,
} from "./world.mjs";

export function availableCards(world) {
  const here = world.actors.vale.place;
  return [
    "vale",
    ...Object.keys(things)
      .filter((id) => itemPlace(world, id) === here)
      .sort(
        (a, b) =>
          Number(rootHolder(world, b) === "vale") -
          Number(rootHolder(world, a) === "vale"),
      ),
    ...Object.keys(people).filter(
      (id) => id !== "vale" && world.actors[id].place === here,
    ),
    ...exits(world, here),
    here,
  ];
}
export function cardType(id) {
  return things[id] ? "item" : people[id] ? "avatar" : "location";
}

// Each face names one play. Pairs express use, handover, travel, or placement.
// The shared world rules still decide whether that play is legal.
export function cardPlay(world, selected) {
  const cards = [...new Set(selected)];
  const available = availableCards(world);
  const result = (action, hint) => ({ action, hint: action?.text || hint });
  if (!cards.length || cards.some((id) => !available.includes(id)))
    return result(null, "Choose a card from this hand.");
  if (cards.length > 2) return result(null, "Play one card or a pair.");
  const actions = legalActions(world);
  const find = (kind, item, target) =>
    actions.find(
      (a) =>
        a.kind === kind &&
        (item === undefined || a.item === item) &&
        (target === undefined || a.target === target),
    );
  const here = world.actors.vale.place;
  if (cards.length === 1) {
    const id = cards[0];
    if (places[id])
      return result(
        id === here ? find("wait") : find("move", null, id),
        `Travel to ${nameOf(id)}.`,
      );
    if (people[id])
      return result(
        id === "vale" ? find("wait") : find("talk", null, id),
        `Meet ${nameOf(id)} here.`,
      );
    const holder = world.items[id].holder;
    if (people[rootHolder(world, id)] && rootHolder(world, id) !== "vale")
      return result(
        find("ask", id),
        things[holder]
          ? `Play ${nameOf(holder)} to ask for the covered pair.`
          : `Make room to ask for the ${nameOf(id)}.`,
      );
    if (holder !== "vale")
      return result(
        find("take", id),
        "Pair a carried item with this place to make room.",
      );
    if (id === "lamp")
      return result(
        find(world.items.lamp.lit ? "snuff" : "light", id),
        "Pair the Lamp with Oil flask.",
      );
    if (id === "bell")
      return result(
        find("ring", id),
        covered(world, id)
          ? "Play Black cloth to uncover the Bell."
          : "Ring the Bell.",
      );
    return result(
      null,
      id === "oil"
        ? "Pair with the Lamp to pour oil."
        : "Pair with the Lamp or Bell to cover it.",
    );
  }
  const item = cards.find((id) => things[id]);
  const location = cards.find((id) => places[id]);
  const avatar = cards.find((id) => people[id]);
  if (item && location)
    return result(
      location === here
        ? find("drop", item, here)
        : find("move", item, location),
      "Carry this item to play it with a location.",
    );
  if (item && avatar)
    return result(
      find("give", item, avatar) || find("ask", item, avatar),
      `${nameOf(avatar)} seeks a different item, or needs carrying space.`,
    );
  const trade = actions.find(
    (a) => a.kind === "trade" && cards.every((id) => a.cards.includes(id)),
  );
  if (trade) return result(trade);
  const action = actions.find(
    (a) =>
      ["cover", "refill"].includes(a.kind) &&
      a.cards.length === cards.length &&
      cards.every((id) => a.cards.includes(id)),
  );
  const heldByOther = cards.find(
    (id) =>
      things[id] &&
      people[rootHolder(world, id)] &&
      rootHolder(world, id) !== "vale",
  );
  if (!action && heldByOther)
    return result(
      null,
      `${nameOf(rootHolder(world, heldByOther))} wants to ${handText(desireFor(world, rootHolder(world, heldByOther)))}.`,
    );
  return result(action, "Try Oil flask + Lamp, or Black cloth + Lamp / Bell.");
}
export function playLabel(action) {
  if (action?.kind === "trade")
    return `Trade ${nameOf(action.item)} → ${nameOf(action.receive)}`;
  return {
    take: "Take",
    drop: "Put down",
    give: "Give",
    ask: "Ask for it",
    light: "Light",
    snuff: "Put out",
    ring: "Ring",
    refill: "Pour oil",
    cover: "Cover",
    move: "Travel",
    talk: "Talk",
    wait: "Stay here",
  }[action?.kind];
}
