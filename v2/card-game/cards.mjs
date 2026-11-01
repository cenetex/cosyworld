import {
  entityActive,
  packThings,
  packPlaces,
  packDefinitions,
} from "./pack-registry.mjs";
import {
  currentActor,
  places,
  people,
  things,
  nameOf,
  legalActions,
  itemPlace,
  rootHolder,
  exits,
  covered,
} from "./world.mjs";

export function availableCards(world) {
  const player = currentActor(world),
    here = world.actors[player].place;
  const items = Object.keys(things).filter(
    (id) => entityActive(world, id) && itemPlace(world, id) === here,
  );
  const cast = Object.keys(people).filter(
    (id) =>
      entityActive(world, id) &&
      world.actors[id].place === here &&
      (!world.controlledActors?.includes(id) ||
        world.presentActors?.includes(id)),
  );
  cast.sort((a, b) => Number(b === player) - Number(a === player));
  const after = (holder) =>
    items
      .filter((id) => world.items[id].holder === holder)
      .flatMap((id) => [id, ...after(id)]);
  const destinations = exits(world, here, player).filter(
    (place) =>
      !world.presentActors ||
      world.presentActors.filter((id) => world.actors[id]?.place === place)
        .length < 4,
  );
  // A standoff here locks the room: no leaving and no changing items. The
  // hand keeps the people, and the demanded item while it can be handed over.
  const fight = world.standoffs?.find((c) => c.location === here);
  if (fight) {
    const mine = [fight.challenger, fight.defender].includes(player);
    const demanded =
      mine && fight.defender === player && fight.item ? [fight.item] : [];
    return [...cast, ...demanded.filter((id) => items.includes(id))];
  }
  const road = packPlaces[here]?.road;
  return [
    ...cast.flatMap((id) => [id, ...after(id)]),
    ...(road && destinations.includes(road[0]) ? [road[0]] : []),
    here,
    ...after(here),
    ...destinations.filter((id) => !road || id !== road[0]),
  ];
}
export function cardType(id) {
  return things[id] ? "item" : people[id] ? "avatar" : "location";
}

export function avatarPlays(world, id) {
  if (!people[id] || !availableCards(world).includes(id)) return [];
  return legalActions(world)
    .filter((a) =>
      id === currentActor(world)
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
  const spokenChoices = new Set(
    packDefinitions.flatMap((pack) =>
      (pack.topics || []).flatMap((topic) =>
        topic.choiceId ? [topic.choiceId] : [],
      ),
    ),
  );
  return legalActions(world).filter(
    (a) =>
      a.target === id &&
      (a.kind === "choose" || Boolean(a.fixture)) &&
      !spokenChoices.has(a.choiceId),
  );
}

// A place card offers the plays its fixtures make there (ringing a clock).
export function placePlays(world, id) {
  if (!places[id] || world.actors[currentActor(world)].place !== id) return [];
  return legalActions(world).filter(
    (a) => a.fixture && a.target === id && a.actor === currentActor(world),
  );
}

// Resolve the primary play for drag gestures and other shortcuts.
// cardActions adds every named choice for the shared row.
export function cardPlay(world, selected) {
  const cards = [...new Set(selected)];
  const available = availableCards(world);
  const result = (action, hint) => ({ action, hint: playText(action) || hint });
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
  const here = world.actors[currentActor(world)].place;
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
        id === here
          ? find("wait")
          : find("move", null, id) || find("course", null, id),
        `Travel to ${nameOf(id)}.`,
      );
    if (id === currentActor(world)) return result(find("wait"));
    if (people[id])
      return result(find("talk", null, id), `Meet ${nameOf(id)} here.`);
    const holder = world.items[id].holder;
    if (
      people[rootHolder(world, id)] &&
      rootHolder(world, id) !== currentActor(world)
    )
      return result(
        find("ask", id),
        things[holder]
          ? `Play ${nameOf(holder)} to ask for the covered pair.`
          : `Make room to ask for the ${nameOf(id)}.`,
      );
    if (holder !== currentActor(world))
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
      id !== "oil" && id !== "cloth"
        ? "Pair with a person to give it, or this place to put it down."
        : id === "oil"
          ? "Hold it with an empty Lamp to fill the Lamp."
          : "Pair with the Lamp or Bell to cover it.",
    );
  }
  const item = cards.find((id) => things[id]);
  const location = cards.find((id) => places[id]);
  const avatar = cards.find((id) => people[id]);
  if (
    cards.includes(currentActor(world)) &&
    cards.some((id) => people[id] && id !== currentActor(world))
  ) {
    const other = cards.find((id) => people[id] && id !== currentActor(world));
    return result(
      find("threaten", undefined, other) || find("guard", undefined, other),
      `Select ${nameOf(other)} on their own to talk.`,
    );
  }
  if (item && avatar === currentActor(world)) return cardPlay(world, [item]);
  if (cards.includes("cloth")) {
    const beneath = cards.find((id) => id !== "cloth");
    if (things[beneath] && world.items.cloth.holder === beneath)
      return result(
        find("take", "cloth"),
        "Put down a carried item to make room for the cloth.",
      );
  }
  if (avatar && location)
    return result(
      avatar === currentActor(world)
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
            (rootHolder(world, item) !== currentActor(world)
              ? use(item)
              : undefined)
        : find("move", item, location),
      "Carry this item to play it with a location.",
    );
  if (item && avatar)
    return result(
      find("give", item, avatar) || find("ask", item, avatar),
      `${nameOf(avatar)} needs carrying space for that.`,
    );
  const trade = actions.find(
    (a) => a.kind === "trade" && cards.every((id) => a.cards.includes(id)),
  );
  if (trade) return result(trade);
  const action = actions.find(
    (a) =>
      a.kind === "cover" &&
      a.cards.length === cards.length &&
      cards.every((id) => a.cards.includes(id)),
  );
  const heldByOther = cards.find(
    (id) =>
      things[id] &&
      people[rootHolder(world, id)] &&
      rootHolder(world, id) !== currentActor(world),
  );
  // Another person's quest is learned by talking with them, not from a card.
  if (!action && heldByOther) {
    const give = cards.find(
      (id) => things[id] && world.items[id].holder === currentActor(world),
    );
    const other = rootHolder(world, heldByOther);
    // Trade is offered whenever both sides have room, so only space is missing.
    if (give) return result(null, "Make room for both sides of the exchange.");
    return result(null, `Talk with ${nameOf(other)} to learn their quest.`);
  }
  return result(action, "Try Oil flask + Lamp, or Black cloth + Lamp / Bell.");
}
// The row lists every play for this selection. The world owns legality.
export function cardActions(world, selected) {
  const cards = [...new Set(selected)];
  const primary = cardPlay(world, cards);
  if (
    !cards.length ||
    cards.length > 2 ||
    cards.some((id) => !availableCards(world).includes(id))
  )
    return { actions: [], hint: primary.hint };
  let actions = primary.action ? [primary.action] : [];
  let hint = actions.length ? "" : primary.hint;
  if (cards.length === 1) {
    const id = cards[0];
    if (id === currentActor(world)) {
      actions.push(...avatarPlays(world, id));
      hint = "Select a person or place to make a pair.";
    } else if (people[id]) {
      const offers = legalActions(world).filter((a) => a.target === id);
      hint = offers.some((a) => a.kind === "threaten")
        ? "Pair with Vale to threaten, or select a carried item to ask for it."
        : offers.some((a) => a.kind === "accompany")
          ? `Pair with a place to invite ${nameOf(id)} along.`
          : "Select a carried item to ask for it.";
    }
    actions.push(...cardChoices(world, id));
  } else if (cards.includes(currentActor(world))) {
    const other = cards.find((id) => id !== currentActor(world));
    if (people[other]) {
      actions = avatarPlays(world, other).filter((a) => a.kind !== "talk");
      hint = actions.length ? "" : primary.hint;
    }
  }
  return {
    actions: [
      ...new Map(actions.map((action) => [action.key, action])).values(),
    ],
    hint,
  };
}

// The combat verbs read Strike and Brace at the table. The rules keep their
// own kinds (attack, guard) and journal text, so only the words change here.
export function playText(action) {
  const who = nameOf(action?.actor),
    other = nameOf(action?.target).replace(/^The /u, "the ");
  if (action?.kind === "attack") return `${who} strikes ${other}.`;
  if (action?.kind === "guard") return `${who} braces against ${other}.`;
  return action?.text;
}

export function playLabel(action) {
  // Pack data can name a play (a fixture, or greeting a sleeping resident).
  if (action?.label) return action.label;
  if (action?.kind === "trade")
    return `Trade ${nameOf(action.item)} for ${nameOf(action.receive)}`;
  if (action?.kind === "threaten")
    return `Threaten ${nameOf(action.target)}${action.item ? ` for ${nameOf(action.item)}` : ""}`;
  if (action?.kind === "give") return `Give to ${nameOf(action.target)}`;
  if (action?.kind === "ask")
    return `Ask ${nameOf(action.target)} for ${nameOf(action.item)}`;
  if (action?.kind === "accompany")
    return `Invite ${nameOf(action.target)} along`;
  if (action?.kind === "drop" && !action.item) return "Drop quest";
  if (action?.kind === "focus") return "Pursue quest";
  if (action?.kind === "move" && action.item)
    return `Carry to ${nameOf(action.target)}`;
  return {
    accompany: "Accompany",
    threaten: "Threaten",
    guard: "Brace",
    attack: "Strike",
    take: "Take",
    drop: "Put down",
    give: "Give",
    ask: "Ask for it",
    light: "Light",
    snuff: "Put out",
    ring: "Ring",
    cover: "Cover",
    move: "Travel",
    talk: "Talk",
    wait: "Wait",
  }[action?.kind];
}

// A play that has not resolved yet reads as what its actor is doing now: a
// rules caption from the action kind, never authored dialogue.
const progress = {
  accompany: "inviting",
  threaten: "threatening",
  guard: "bracing",
  attack: "striking",
  take: "taking",
  drop: "putting down",
  focus: "choosing a quest",
  give: "giving",
  ask: "asking",
  trade: "trading",
  light: "lighting",
  snuff: "putting out",
  ring: "ringing",
  cover: "covering",
  move: "travelling",
  talk: "talking",
  wait: "waiting",
};
export function playProgress(action) {
  return action?.kind === "move" && action.item
    ? "carrying"
    : progress[action?.kind] || "acting";
}
/** "Vale is waiting…" */
export function playProgressLine(actor, action) {
  return `${nameOf(actor)} is ${playProgress(action)}…`;
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
  return id === world.actors[currentActor(world)].place
    ? "Here."
    : "A way onward.";
}
