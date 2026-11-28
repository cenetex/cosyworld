import { lampRoomFlame } from "./lamp-room-fuel.mjs";
import { RADIO_ITEM } from "./radio-item.mjs";
import {
  consumable,
  entityActive,
  packPlaces,
  packDefinitions,
  packThings,
  packPeople,
  transports,
} from "./pack-registry.mjs";
import { questCaption, questVerb } from "./quest-card.mjs";
import { joinWants } from "./world/want-words.mjs";
import { inSentence, theName } from "./combat-beats.mjs";
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
  shutBoxesAt,
  knownActors,
} from "./world.mjs";
import { controlledByHuman } from "./human-cast.mjs";
import { staysLabel } from "./world/company.mjs";
import { staysByRole } from "./resident-guard.mjs";

// The boxes shut at the player's place: the one list the rules keep (rules
// 133, world/boxes.mjs). The hand draws each face down and the context
// button gives its reason.
export const shutBoxes = (world) => {
  const player = currentActor(world);
  return shutBoxesAt(world, world.actors[player]?.place, player);
};
const shutBox = (world, id) => shutBoxes(world).find((box) => box.id === id);
// An undiscovered resident can wait as an existing locked card, without
// becoming an active actor or receiving plays before its requirements hold.
export const sealedAvatar = (world, id) => {
  const box = shutBox(world, id);
  return box?.kind === "resident" ? { at: box.at } : null;
};

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
  // Every shut box lies in the hand face down (rules 133): a way, a made
  // thing waiting for its maker, a resident, a port, a door.
  const sealed = shutBoxes(world)
    .map((box) => box.id)
    .filter((id) => !destinations.includes(id));
  return [
    ...cast.flatMap((id) => [id, ...after(id)]),
    ...(road && destinations.includes(road[0]) ? [road[0]] : []),
    here,
    ...after(here),
    ...destinations.filter((id) => !road || id !== road[0]),
    ...new Set(sealed),
  ];
}
// A person here whom the rules have not met yet, whatever this browser saw.
export function unmet(world, id) {
  const player = currentActor(world);
  return Boolean(people[id]) && id !== player &&
    world.actors[id]?.place === world.actors[player]?.place &&
    entityActive(world, id) && !knownActors(world).includes(id);
}
// The people here whom the rules met after `turn`.
export const metSince = (world, turn) =>
  availableCards(world).filter((id) => people[id] && id !== currentActor(world) && [
    world.opening?.met, world.packs?.[packPeople[id]?.packId]?.met,
  ].some((met) => met?.[id] > turn));
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
  return choicesOn(id, legalActions(world));
}
function choicesOn(id, actions) {
  const spokenChoices = new Set(
    packDefinitions.flatMap((pack) =>
      (pack.topics || []).flatMap((topic) =>
        topic.choiceId ? [topic.choiceId] : [],
      ),
    ),
  );
  return actions.filter(
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
  return sleeper
    ? `${nameOf(sleeper)} is asleep`
    : invitationReason(world, selected);
}
// What opens a locked card, in words: each want it waits on, worded by the one
// wording of a want (quest-card.mjs) and screened by what the traveler has
// discovered (`known`; the default knows nothing, so it names nothing). The
// rules own the goals (`box.goals`, world/boxes.mjs); a box with none shows
// only that it is shut.
export const LOCKED_BOX = "A locked box.";
export function lockWords(world, id, known = () => false) {
  const box = shutBox(world, id);
  if (!box) return null;
  const actor = currentActor(world);
  const text = joinWants(
    (box.goals.length ? box.goals : box.want ? [box.want] : [])
      // The locked card itself cannot explain how to open it.
      .filter((goal) => goal.target !== id),
    (goal) => {
      const quest = { actor, ...goal };
      return questCaption(quest, false, questVerb(world, quest), known);
    },
  );
  return text || LOCKED_BOX;
}
export const sealedReason = lockWords;
function invitationTarget(world, selected) {
  if (selected.length !== 2) return null;
  const player = currentActor(world);
  if (!selected.some((id) => places[id] && id !== world.actors[player].place))
    return null;
  return selected.find((id) => people[id] && id !== player) ?? null;
}

export function invitationPartner(world, selected, next) {
  return selected.find((id) => invitationTarget(world, [id, next]));
}

function invitationReason(world, selected) {
  const who = invitationTarget(world, selected);
  if (
    !who ||
    world.actors[who]?.place !== world.actors[currentActor(world)].place
  )
    return null;
  if (controlledByHuman(world, who))
    return `${nameOf(who)} chooses their own route`;
  return staysByRole(world, who) ? staysLabel(nameOf(who)) : null;
}

// Resolve one play for the context row and drag gestures.
export function cardPlay(world, selected) {
  return playFromHand(world, [...new Set(selected)], availableCards(world));
}
function playFromHand(world, cards, available) {
  const own = selectionPlay(world, cards, available);
  if (
    own.action ||
    cards.length < 2 ||
    cards.length > 3 ||
    invitationTarget(world, cards)
  )
    return own;
  if (cards.some((id) => !available.includes(id))) return own;
  const player = currentActor(world);
  const order = [
    cards.find((id) => people[id] && id !== player),
    cards.find((id) => things[id]),
    cards.find((id) => places[id]),
  ];
  for (const id of order.filter(Boolean)) {
    const alone = selectionPlay(world, [id], available);
    if (order[0] && alone.action?.kind === "wait")
      return selectionPlay(world, [order[0]], available);
    if (alone.action) return alone;
  }
  return own;
}
function selectionPlay(world, selected, available = availableCards(world)) {
  const cards = [...new Set(selected)];
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
  const use = (id) =>
    id === RADIO_ITEM
      ? find("radio", id)
      : id === "bell"
        ? find("ring", id)
        : undefined;
  if (cards.length === 1) {
    const id = cards[0];
    const authored = () => choicesOn(id, actions)[0];
    const single = (found, hint) => result(found || authored(), hint);
    // A local fixture takes the place of a plain Wait.
    if (places[id])
      return single(
        id === here
          ? authored() || wait
          : find("move", null, id) ||
              find("course", null, id),
        sealedReason(world, id) || `Travel to ${nameOf(id)}.`,
      );
    if (id === currentActor(world)) return single(find("guard") || wait);
    if (people[id])
      return single(
        authored() || find("talk", null, id) || find("attack", null, id),
        sealedReason(world, id) || `Meet ${nameOf(id)} here.`,
      );
    if (sealedReason(world, id)) return single(null, sealedReason(world, id));
    const holder = world.items[id].holder;
    if (
      people[rootHolder(world, id)] &&
      rootHolder(world, id) !== currentActor(world)
    )
      return single(
        find("ask", id),
        things[holder]
          ? `Play ${nameOf(holder)} to ask for the covered pair.`
          : `Make room to ask for ${theName(id)}.`,
      );
    if (holder !== currentActor(world))
      return single(
        find("take", id) || find("read", id),
        carryFull(world, id)
          ? TOO_MANY_ITEMS
          : "Pair a carried item with this place to make room.",
      );
    const meal = actions.find(
      (a) => a.kind === "eat" && a.item === id && !a.target,
    );
    if (meal) return result(meal);
    return single(
      use(id) || find("read", id),
      "Pair with a person to give it, or this place to put it down.",
    );
  }
  const usePair = actions.find((a) => a.kind === "use" && a.cards.length === 2 &&
    cards.every((id) => a.cards.includes(id)));
  if (usePair) return result(usePair);
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
      selectionPlay(world, [other], available).hint,
    );
  }
  if (item && avatar === currentActor(world)) return playFromHand(world, [item], available);
  if (cards.includes("cloth")) {
    const beneath = cards.find((id) => id !== "cloth");
    if (things[beneath] && world.items.cloth.holder === beneath)
      return result(find("take", "cloth"), TOO_MANY_ITEMS);
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
      asleepReason(world, cards) ||
        sealedReason(world, location) ||
        "Choose an open path to invite this resident along.",
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
      rootHolder(world, item) === avatar
        ? cardPlay(world, [item]).hint
        : rootHolder(world, item) === currentActor(world)
          ? `${nameOf(avatar)} needs carrying space for that.`
          : `Take ${theName(item)} first.`,
    );
  const trade = actions.find(
    (a) => a.kind === "trade" && cards.every((id) => a.cards.includes(id)),
  );
  if (trade) return result(trade);
  const heldByOther = cards.find(
    (id) =>
      things[id] &&
      people[rootHolder(world, id)] &&
      rootHolder(world, id) !== currentActor(world),
  );
  if (heldByOther) {
    const give = cards.find(
      (id) => things[id] && world.items[id].holder === currentActor(world),
    );
    const other = rootHolder(world, heldByOther);
    // Trade is offered whenever both sides have room, so only space is missing.
    if (give) return result(null, "Make room for both sides of the exchange.");
    return result(null, `Talk with ${nameOf(other)} to learn their quest.`);
  }
  return result(null, "");
}
export function sharedMeal(world, cards) {
  return cards.length === 3 && selectionPlay(world, cards).action?.kind === "eat";
}
// A card tapped beside a raised held thing pairs with it only when the pair
// plays; one taken or travelled to alone puts the held thing aside.
export function settledChoice(world, cards, id) {
  if (cards.length !== 2 || !cards.includes(id)) return cards;
  if (invitationTarget(world, cards)) return cards;
  if (!things[id] && !places[id]) return cards;
  const available = availableCards(world);
  if (selectionPlay(world, cards, available).action) return cards;
  const alone = playFromHand(world, [id], available).action?.kind;
  return alone === "take" || alone === "move" || alone === "course"
    ? [id]
    : cards;
}
// The row shows one play for this selection. The world owns legality.
export function cardActions(world, selected) {
  const cards = [...new Set(selected)];
  const available = availableCards(world);
  const primary = playFromHand(world, cards, available);
  if (
    !cards.length ||
    cards.length > 3 ||
    cards.some((id) => !available.includes(id))
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
          ? `Pair with ${nameOf(currentActor(world))} to threaten, or select a carried item to ask for it.`
          : `Pair with ${nameOf(currentActor(world))} to threaten.`
        : offered("accompany")
          ? `Pair with a place to invite ${nameOf(id)} along.`
          : offered("ask")
            ? "Select a carried item to ask for it."
            : "";
    }
  }
  return { actions, hint };
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
      shown: action.sleep
        ? `${nameOf(action.actor)} sleeps on.`
        : `Wake ${nameOf(action.actor)}`,
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
    other = inSentence(action?.target);
  if (action?.kind === "attack") return `${who} strikes ${other}.`;
  if (action?.kind === "guard") return `${who} braces.`;
  if (action?.kind === "intercept") return `${who} covers ${other}.`;
  return [action?.item, action?.target, action?.receive].reduce(
    (text, id) => text?.replaceAll(` ${nameOf(id)}`, ` ${inSentence(id)}`),
    action?.shown || action?.text,
  );
}

export function playLabel(action, world = null) {
  // Pack data can name a play (a fixture, or greeting a sleeping resident).
  if (action?.label) return action.label;
  if (action?.kind === "trade")
    return `Trade ${inSentence(action.item)} for ${inSentence(action.receive)}`;
  if (action?.kind === "threaten")
    return `Threaten ${inSentence(action.target)}${action.item ? ` for ${inSentence(action.item)}` : ""}`;
  if (action?.kind === "give") return `Give to ${inSentence(action.target)}`;
  if (action?.kind === "eat")
    return `${consumable(action.item) === "drink" ? "Drink" : "Eat"}${action.target ? ` with ${inSentence(action.target)}` : ""}`;
  if (action?.kind === "ask")
    return `Ask ${inSentence(action.target)} for ${inSentence(action.item)}`;
  if (action?.kind === "accompany")
    return `Invite ${inSentence(action.target)} along`;
  if (action?.kind === "drop" && !action.item) return "Discard";
  if (action?.kind === "focus") return "Choose quest";
  if (action?.kind === "move" && action.item)
    return `Carry to ${inSentence(action.target)}`;
  return {
    accept: "Accept",
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
  return actions.flatMap((a) => {
    const shown = shownPlay(world, a, cards);
    if (!sleep || !plainWait(a)) return [shown];
    const rest = shownPlay(world, sleep, cards);
    return a.label && !asleep ? [shown, rest] : [rest];
  });
}

export function cardObservation(world, id) {
  const item = world.items[id];
  if (item) {
    const observations = [];
    if (id === RADIO_ITEM)
      observations.push(item.radioOn === true ? "Radio on" : "Radio off");
    if (typeof item.lit === "boolean")
      observations.push(
        id === "lamp" && item.fuelRooms !== undefined
          ? lampRoomFlame(item)
          : item.lit
            ? "Lit"
            : "Unlit",
      );
    if (typeof item.ringing === "number")
      observations.push(
        item.ringing > 0 ? "Ringing" : "Silent",
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
