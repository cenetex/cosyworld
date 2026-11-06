import {
  consumable,
  entityActive,
  packPlaces,
  packDefinitions,
  packThings,
  transports,
} from "./pack-registry.mjs";
import { dropCost } from "./want.mjs";
import { lockedAt } from "./pack-items.mjs";
import { shutLanes } from "./pack-transport.mjs";
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
  sealedWays,
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
  // A battle here locks the room: no leaving and no changing items. The
  // hand keeps the people, this place (Wait), and the demanded item while
  // it can be handed over.
  const fight = world.standoffs?.find((c) => c.location === here);
  if (fight) {
    const demanded =
      fight.defender === player && fight.item ? [fight.item] : [];
    return [...cast, ...demanded.filter((id) => items.includes(id)), here];
  }
  const road = packPlaces[here]?.road;
  // A shut way that names its sealed card shows that card (rules 95).
  const sealed = sealedWays(world, player)
    .map((r) => r.to)
    .filter((id) => !destinations.includes(id));
  // A made thing waits locked at its home until its maker makes it again.
  sealed.push(...lockedAt(world, here));
  // A port its ship cannot sail to yet, and why (rules 102).
  sealed.push(
    ...shutLanes(world, here)
      .map((lane) => lane.to)
      .filter((id) => !destinations.includes(id)),
  );
  return [
    ...cast.flatMap((id) => [id, ...after(id)]),
    ...(road && destinations.includes(road[0]) ? [road[0]] : []),
    here,
    ...after(here),
    ...destinations.filter((id) => !road || id !== road[0]),
    ...new Set(sealed),
  ];
}
export function cardType(id) {
  return things[id] ? "item" : people[id] ? "avatar" : "location";
}

const PLAY_ORDER = ["talk", "wait", "threaten", "guard", "intercept", "attack"];
// In battle the selection names the verb: yourself is Brace, yourself and
// another combatant is Cover, another combatant alone is Strike, and this
// place is Wait. There is no Talk.
export function avatarPlays(world, id) {
  if (!people[id] || !availableCards(world).includes(id)) return [];
  return legalActions(world)
    .filter((a) =>
      id === currentActor(world)
        ? a.kind === "guard"
        : a.target === id &&
          ["talk", "threaten", "intercept", "attack"].includes(a.kind),
    )
    .sort((a, b) => PLAY_ORDER.indexOf(a.kind) - PLAY_ORDER.indexOf(b.kind));
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

// Why a Take is missing when the actor's hands are full (#2018). The rules
// own the carry limit: an item within reach, in a room no battle locks, is
// refused only for space, so its missing Take says so.
export const TOO_MANY_ITEMS = "You have too many items, give one away.";
function carryFull(world, id) {
  const actor = currentActor(world),
    here = world.actors[actor].place;
  return (
    itemPlace(world, id) === here &&
    !people[rootHolder(world, id)] &&
    !world.standoffs?.some((c) => c.location === here) &&
    !legalActions(world).some((a) => a.kind === "take" && a.item === id)
  );
}

// Why an Ask, Trade or Invite is missing: the resident it needs is asleep
// (rules 100), for the context button. Talk wakes it; a Give it keeps.
export function asleepReason(world, selected) {
  const sleeper = selected
    .map((id) => (people[id] ? id : things[id] ? rootHolder(world, id) : null))
    .find(
      (id) =>
        id &&
        id !== currentActor(world) &&
        world.actors[id]?.sleeping?.until !== undefined,
    );
  return sleeper ? `${nameOf(sleeper)} is asleep` : null;
}
// Why a sealed card's way is shut, from its pack data, or null. A locked
// made thing names who makes it from what (rules 102).
export const sealedReason = (world, id) => {
  const lock = things[id] && packThings[id]?.locked;
  if (lock)
    return lockedAt(world, packThings[id].home).includes(id)
      ? `${nameOf(lock.by)} consumes ${listOf(lock.consumes.map((c) => theThing(c)))}`
      : null;
  const player = currentActor(world);
  return (
    sealedWays(world, player).find((r) => r.to === id)?.sealed.reason ??
    shutLanes(world, world.actors[player]?.place).find((l) => l.to === id)
      ?.reason ??
    null
  );
};
const theThing = (id) =>
  /^(the|a|an) /iu.test(nameOf(id)) ? nameOf(id) : `the ${nameOf(id)}`;
const listOf = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
    : names[0];

// Resolve the primary play for drag gestures and other shortcuts.
// cardActions adds every named choice for the shared row.
export function cardPlay(world, selected) {
  const cards = [...new Set(selected)];
  const available = availableCards(world);
  const result = (found, hint) => {
    const action = shownPlay(world, found, cards);
    return { action, hint: playText(action) || hint };
  };
  if (!cards.length || cards.some((id) => !available.includes(id)))
    return result(null, "Choose a card from this hand.");
  if (cards.length > 3) return result(null, "Choose one card or a pair.");
  const actions = legalActions(world);
  const player = currentActor(world);
  if (cards.length === 3)
    return result(
      cards.includes(player) &&
        actions.find(
          (a) =>
            a.kind === "eat" &&
            a.target &&
            cards.includes(a.item) &&
            cards.includes(a.target),
        ),
      "Choose yourself, a meal you hold, and a companion to share it.",
    );
  const here = world.actors[player].place;
  const wait = actions.find((a) => a.kind === "wait" && !a.sleep && !a.guards);
  const find = (kind, item, target) =>
    actions.find(
      (a) =>
        a.kind === kind &&
        (item === undefined || a.item === item) &&
        (target === undefined || a.target === target),
    );
  // The place alone plays its fixture. With yourself, it passes time.
  const stay = () => cardChoices(world, here)[0] || wait;
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
          ? stay()
          : find("move", null, id) ||
              find("course", null, id) ||
              find("gate", null, id),
        sealedReason(world, id) || `Travel to ${nameOf(id)}.`,
      );
    if (id === currentActor(world)) return result(find("guard") || wait);
    if (people[id])
      return result(
        find("talk", null, id) || find("attack", null, id),
        `Meet ${nameOf(id)} here.`,
      );
    if (sealedReason(world, id)) return result(null, sealedReason(world, id));
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
        carryFull(world, id)
          ? TOO_MANY_ITEMS
          : "Pair a carried item with this place to make room.",
      );
    // Food and drink held alone are eaten or drunk (rules 102).
    const meal = actions.find(
      (a) => a.kind === "eat" && a.item === id && !a.target,
    );
    if (meal) return result(meal);
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
      find("threaten", undefined, other) || find("intercept", undefined, other),
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
          ? (world.actors[player].sleeping && actions.find((a) => a.sleep)) ||
            wait
          : // Yourself and a guardable way stands guard (rules 100).
            actions.find((a) => a.guards === location) ||
            find("move", null, location)
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
    cards.length > 3 ||
    cards.some((id) => !availableCards(world).includes(id))
  )
    return { actions: [], hint: primary.hint };
  const actions = primary.action ? [primary.action] : [];
  let hint = actions.length ? "" : primary.hint;
  if (cards.length === 1) {
    const id = cards[0];
    if (id === currentActor(world)) {
      hint = "Select a person or place to make a pair.";
    } else if (people[id]) {
      const offers = legalActions(world).filter((a) => a.target === id);
      const offered = (kind) => offers.some((a) => a.kind === kind);
      // Each hint names only a play the rules offer for this person now.
      hint = offered("threaten")
        ? offered("ask")
          ? "Pair with Vale to threaten, or select a carried item to ask for it."
          : "Pair with Vale to threaten."
        : offered("accompany")
          ? `Pair with a place to invite ${nameOf(id)} along.`
          : offered("ask")
            ? "Select a carried item to ask for it."
            : "";
    }
    actions.push(...cardChoices(world, id));
  }
  return {
    actions: [
      ...new Map(actions.map((action) => [action.key, action])).values(),
    ],
    hint,
  };
}

// Aboard a transport under way (course set or at sea), a Wait is the voyage:
// each round passed carries it on (sailTransports in pack-transport.mjs). The
// pack names that Wait (waitVerb, waitSentence) when the selection holds the
// transport's own card: choosing the ship lets it carry us. The avatar alone
// keeps Wait, and so does a docked ship, where a wait moves nothing. The rules
// keep their wait and journal either way.
function underWay(world, actor) {
  const here = world.actors[actor]?.place;
  return Object.entries(transports).find(
    ([id, t]) =>
      t.place === here &&
      t.waitVerb &&
      ["course", "sea"].includes(world.transports?.[id]?.phase),
  )?.[1];
}
function shownPlay(world, action, cards = []) {
  if (
    action?.kind === "wait" &&
    !action.guards &&
    world.actors[action.actor]?.sleeping
  )
    return {
      ...action,
      label: action.sleep ? "Sleep on" : "Wake",
      shown: `${nameOf(action.actor)} ${action.sleep ? "sleeps on" : "wakes"}.`,
    };
  const t =
    action?.kind === "wait" &&
    !action.sleep &&
    cards.includes(world.actors[action.actor]?.place) &&
    underWay(world, action.actor);
  if (!t) return action;
  return {
    ...action,
    label: t.waitVerb,
    shown: t.waitSentence.replace("{actor}", () => nameOf(action.actor)),
  };
}

// The combat verbs read Strike and Brace at the table. The rules keep their
// own kinds (attack, guard) and journal text, so only the words change here.
export function playText(action) {
  const who = nameOf(action?.actor),
    other = nameOf(action?.target).replace(/^The /u, "the ");
  if (action?.kind === "attack") return `${who} strikes ${other}.`;
  if (action?.kind === "guard") return `${who} braces.`;
  if (action?.kind === "intercept") return `${who} covers ${other}.`;
  return action?.shown || action?.text;
}

export function playLabel(action, world = null) {
  // Pack data can name a play (a fixture, or greeting a sleeping resident).
  if (action?.label) return action.label;
  if (action?.kind === "trade")
    return `Trade ${nameOf(action.item)} for ${nameOf(action.receive)}`;
  if (action?.kind === "threaten")
    return `Threaten ${nameOf(action.target)}${action.item ? ` for ${nameOf(action.item)}` : ""}`;
  if (action?.kind === "give") return `Give to ${nameOf(action.target)}`;
  if (action?.kind === "eat")
    return `${consumable(action.item) === "drink" ? "Drink" : "Eat"}${action.target ? ` with ${nameOf(action.target)}` : ""}`;
  if (action?.kind === "ask")
    return `Ask ${nameOf(action.target)} for ${nameOf(action.item)}`;
  if (action?.kind === "accompany")
    return `Invite ${nameOf(action.target)} along`;
  // Dropping a quest reads Discard; a level quest's names its experience
  // cost (`dropCost`), only here.
  if (action?.kind === "drop" && !action.item) {
    const cost = world ? dropCost(world, action.actor, action.quest) : 0;
    return cost ? `Discard (−${cost} XP)` : "Discard";
  }
  if (action?.kind === "focus") return "Choose quest";
  if (action?.kind === "gate") return "Seek the way";
  if (action?.kind === "move" && action.item)
    return `Carry to ${nameOf(action.target)}`;
  return {
    accompany: "Accompany",
    threaten: "Threaten",
    guard: "Brace",
    intercept: "Cover",
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

// An awake player can sleep by choosing the same Wait again. A quest's
// rest shortcut continues to offer Sleep on while its owner is asleep.
export function restPlays(world, actions, again, cards = []) {
  const asleep = Boolean(world.actors[currentActor(world)].sleeping);
  const plainWait = (a) => a.kind === "wait" && !a.sleep && !a.guards;
  const sleep =
    (asleep ? !cards.length : again) &&
    actions.some(plainWait) &&
    legalActions(world).find((a) => a.sleep);
  return actions.map((a) =>
    shownPlay(world, sleep && plainWait(a) ? sleep : a, cards),
  );
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
    return world.actors[id].awake === false || world.actors[id].sleeping
      ? "Asleep."
      : "Here.";
  return id === world.actors[currentActor(world)].place
    ? "Here."
    : "A way onward.";
}
