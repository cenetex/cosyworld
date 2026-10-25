import { hasMotives, tradeDecision, interest } from "./motives.mjs";
import { desireFor } from "./quests.mjs";
import { entityActive, packThings } from "./pack-registry.mjs";
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
      .filter((id) => entityActive(world, id) && itemPlace(world, id) === here)
      .sort(
        (a, b) =>
          Number(rootHolder(world, b) === "vale") -
          Number(rootHolder(world, a) === "vale"),
      ),
    ...Object.keys(people).filter(
      (id) =>
        id !== "vale" &&
        entityActive(world, id) &&
        world.actors[id].place === here,
    ),
    ...exits(world, here, "vale"),
    here,
  ];
}
export function cardType(id) {
  return things[id] ? "item" : people[id] ? "avatar" : "location";
}

export function avatarPlays(world, id) {
  if (!people[id] || !availableCards(world).includes(id)) return [];
  return legalActions(world)
    .filter((a) =>
      id === "vale"
        ? a.kind === "guard"
        : a.target === id &&
          ["talk", "threaten", "guard", "attack"].includes(a.kind),
    )
    .sort(
      (a, b) =>
        ["talk", "wait", "threaten", "guard", "attack"].indexOf(a.kind) -
        ["talk", "wait", "threaten", "guard", "attack"].indexOf(b.kind),
    );
}
export function cardChoices(world, id) {
  if (!availableCards(world).includes(id)) return [];
  return legalActions(world).filter(
    (a) =>
      a.target === id &&
      (a.kind === "choose" ||
        (id === "clearing" && a.kind === "ring" && a.item === null)),
  );
}

// Each face names one play. Pairs express use, handover, travel, invitations, or placement.
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
  const use = (id) =>
    id === "lamp"
      ? find(world.items.lamp.lit ? "snuff" : "light", id)
      : id === "bell"
        ? find("ring", id)
        : undefined;
  if (cards.length === 1) {
    const id = cards[0];
    if (places[id])
      return result(
        id === here ? find("wait") : find("move", null, id),
        `Travel to ${nameOf(id)}.`,
      );
    // Staying put belongs to the place card; Vale's card travels in a pair.
    if (id === "vale") return result(null, "Pair Vale with a place to travel.");
    if (people[id])
      return result(find("talk", null, id), `Meet ${nameOf(id)} here.`);
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
    if (id === "lamp") return result(use(id), "Pair the Lamp with Oil flask.");
    if (id === "bell")
      return result(
        use(id),
        covered(world, id)
          ? "Play Black cloth to uncover the Bell."
          : "Ring the Bell.",
      );
    return result(
      null,
      packThings[id]
        ? "Pair with a person to give it, or this place to put it down."
        : id === "oil"
          ? "Pair with the Lamp to pour oil."
          : "Pair with the Lamp or Bell to cover it.",
    );
  }
  const item = cards.find((id) => things[id]);
  const location = cards.find((id) => places[id]);
  const avatar = cards.find((id) => people[id]);
  if (avatar && location)
    return result(
      avatar === "vale"
        ? location === here
          ? find("wait")
          : find("move", null, location)
        : actions.find(
            (a) =>
              a.kind === "accompany" &&
              a.target === avatar &&
              a.destination === location,
          ),
      "Pair a nearby avatar with an open path to ask them to accompany you.",
    );
  // An item lying here pairs with this place to be used where it lies.
  if (item && location)
    return result(
      location === here
        ? find("drop", item, here) ||
            (rootHolder(world, item) !== "vale" ? use(item) : undefined)
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
  if (!action && heldByOther && hasMotives(world)) {
    const give = cards.find(
      (id) => things[id] && world.items[id].holder === "vale",
    );
    const other = rootHolder(world, heldByOther);
    if (give) {
      const decision = tradeDecision(world, "vale", give, heldByOther);
      return result(
        null,
        decision.accepted
          ? "Make room for both sides of the exchange."
          : decision.reason,
      );
    }
    return result(null, `${nameOf(other)}: ${interest(world, other).text}.`);
  }
  if (!action && heldByOther)
    return result(
      null,
      `${nameOf(rootHolder(world, heldByOther))} wants to ${handText(desireFor(world, rootHolder(world, heldByOther)))}.`,
    );
  return result(action, "Try Oil flask + Lamp, or Black cloth + Lamp / Bell.");
}
export function playLabel(action) {
  if (
    action?.kind === "take" &&
    action.item === "cloth" &&
    action.text.includes("uncovers and takes")
  )
    return "Uncover";
  if (action?.kind === "choose") return action.label;
  if (action?.kind === "ring" && action.target === "clearing")
    return "Ring the Steam Clock";
  if (
    action?.kind === "move" &&
    action.target === "greek-harbor" &&
    action.text.includes("aboard the Greek ship")
  )
    return "Board the Greek ship";
  if (
    action?.target === "badger" &&
    action?.kind === "talk" &&
    action.text.includes("gently wakes")
  )
    return "Wake gently";
  if (action?.kind === "trade")
    return `Trade ${nameOf(action.item)} → ${nameOf(action.receive)}`;
  return {
    accompany: "Accompany",
    threaten: "Threaten",
    guard: "Guard",
    attack: "Attack",
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

export function cardObservation(world, id) {
  const item = world.items[id];
  if (item) {
    const observations = [];
    if (typeof item.lit === "boolean")
      observations.push(item.lit ? "Lit" : "Unlit");
    if (typeof item.ringing === "number")
      observations.push(
        item.ringing > 0 && !covered(world, id) ? "Ringing" : "Silent",
      );
    const cover = Object.keys(world.items).find(
      (other) => world.items[other].holder === id,
    );
    if (cover) observations.push(`Covered by ${nameOf(cover)}`);
    observations.push(
      things[item.holder]
        ? `On ${nameOf(item.holder)}`
        : people[rootHolder(world, id)]
          ? `Carried by ${nameOf(rootHolder(world, id))}`
          : "Resting here",
    );
    return observations.join(". ") + ".";
  }
  if (world.actors[id])
    return world.actors[id].awake === false ? "Asleep." : "Here.";
  return id === world.actors.vale.place ? "Here." : "A way onward.";
}
