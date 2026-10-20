// The resident planner. It chooses among the same legal offers a player sees,
// so residents follow the player's reach, consent, capacity, and exchange rules.
// It plans from what the avatar knows, not from the world: it routes over places
// it has seen, looks for items where it last saw them, and otherwise follows
// its quest's clues, asks the avatars it meets, searches, and explores.
import {
  avatarOrder,
  awake,
  desireFor,
  holderOf,
  isPlayer,
  itemPlace,
  levelOf,
  nameOf,
  needed,
  programFor,
} from "./goals.mjs";
import {
  handStatus,
  handText,
  hasSpace,
  legalActions,
  opponentOf,
  standoffFor,
  willingToGive,
} from "./world.mjs";
import { latentItem } from "./growth.mjs";
import {
  believedAvatarPlace,
  believedPlace,
  frontier,
  knownStep,
  visibleTo,
} from "./knowledge.mjs";

// How long a search of one place stays fresh.
const SEARCH_AGAIN = 24;

const moveTo = (s, avatar, place) =>
  place &&
  legalActions(s, avatar).find(
    (a) => a.kind === "move" && !a.item && a.target === place,
  );
// One step toward a place over known routes. Without one, explore: head for
// the nearest place not yet visited, then the one visited longest ago.
function toward(s, avatar, target) {
  const known = knownStep(s, avatar, target);
  if (known) return moveTo(s, avatar, known);
  const edge = frontier(s, avatar);
  if (edge) return moveTo(s, avatar, knownStep(s, avatar, edge));
  const k = s.avatars[avatar].known.places,
    here = s.avatars[avatar].place;
  const oldest = Object.keys(k)
    .filter((id) => id !== here && k[id].visited != null)
    .sort((a, b) => k[a].visited - k[b].visited)[0];
  return moveTo(s, avatar, knownStep(s, avatar, oldest));
}

export function plan(s, avatar) {
  const acts = legalActions(s, avatar),
    hand = desireFor(s, avatar);
  const here = s.avatars[avatar].place;
  const n = (id) => nameOf(s, id);
  const find = (kind, item, target) =>
    acts.find(
      (a) =>
        a.kind === kind &&
        (item === undefined || a.item === item) &&
        (target === undefined || a.target === target),
    );
  const idle = (reason) => ({ action: acts[0], reason });
  const choose = (action, reason) =>
    action ? { action, reason } : idle(reason);
  const conflict = standoffFor(s, avatar);
  if (conflict) {
    const other = opponentOf(conflict, avatar);
    if (avatar === conflict.defender && !conflict.answered)
      return choose(
        find(
          levelOf(s, avatar) > levelOf(s, other) ? "talk" : "guard",
          undefined,
          other,
        ),
        "Answer the threat.",
      );
    if (conflict.struck[other] || conflict.struck[avatar])
      return choose(find("attack", undefined, other), "Answer the attack.");
    if (
      conflict.challenger === avatar &&
      conflict.item &&
      needed(s, avatar, conflict.item) &&
      s.turn - conflict.opened >= 2
    )
      return choose(
        find("attack", undefined, other),
        "Press the demand for the disputed item.",
      );
  }
  const missing = hand.items.filter((id) => holderOf(s, id) !== avatar);
  const reason = `Seek this hand: ${handText(s, hand, avatar)}.`;
  // Another avatar can hold its whole hand somewhere else and wait only for
  // this one. Going there completes that hand and ends the wait.
  const waitingHere = (ids) =>
    ids.find((id) => {
      const theirs = desireFor(s, id),
        there = believedAvatarPlace(s, avatar, id);
      return (
        id !== avatar &&
        awake(s, id) &&
        there &&
        there !== here &&
        s.avatars[id].place === there &&
        theirs.avatars.includes(avatar) &&
        (theirs.location || there) === there &&
        handStatus(s, id, theirs).items.every((e) => e.met) &&
        theirs.avatars.every(
          (other) => other === avatar || s.avatars[other].place === there,
        )
      );
    });
  const goMeet = (id) =>
    choose(
      toward(s, avatar, s.avatars[id].place),
      `Meet ${n(id)}, who is waiting at ${n(s.avatars[id].place)}.`,
    );
  const clues = programFor(s, avatar)?.clues ?? {};
  const k = s.avatars[avatar].known;
  // Look for something not where the avatar believes it is: ask whoever is
  // here, search the clue's place, then explore beyond it.
  const hunt = (id, why) => {
    const clue = clues[id];
    const talk =
      s.turn - s.avatars[avatar].lastTalk >= SEARCH_AGAIN / 4 &&
      acts.find((a) => a.kind === "talk");
    if (talk) return choose(talk, `Ask ${n(talk.target)} for news. ${why}`);
    const searched = k.places[here].searched;
    if (
      (!clue || clue === here) &&
      (searched === null || s.turn - searched > SEARCH_AGAIN)
    )
      return choose(find("search"), `Search ${n(here)}. ${why}`);
    if (clue && clue !== here) {
      const step = moveTo(s, avatar, knownStep(s, avatar, clue));
      if (step) return choose(step, `Follow the clue to ${n(clue)}. ${why}`);
    }
    return choose(toward(s, avatar, null), `Explore. ${why}`);
  };
  const acquire = (item, seen = new Set()) => {
    if (seen.has(item) || holderOf(s, item) === avatar) return null;
    seen = new Set([...seen, item]);
    // A promised item comes from its maker: bring that place's inputs and put
    // them down there.
    if (latentItem(s, item)) {
      const maker = s.items[item].maker,
        work = s.places[maker].quest;
      if (work?.reward !== item) return null;
      for (const input of work.items) {
        if (holderOf(s, input) === maker) continue;
        if (holderOf(s, input) !== avatar) {
          const fetch = acquire(input, seen);
          if (fetch)
            return { ...fetch, reason: `Seek ${n(input)} for ${n(maker)}.` };
          continue;
        }
        if (here === maker)
          return choose(
            find("drop", input),
            `Put the ${n(input)} down for ${n(maker)}.`,
          );
        return choose(
          toward(s, avatar, maker),
          `Bring the ${n(input)} to ${n(maker)}.`,
        );
      }
      return null;
    }
    const owner = holderOf(s, item),
      local = itemPlace(s, item) === here && visibleTo(s, avatar, item);
    if (local) {
      const take = find("take", item);
      if (take) return choose(take, reason);
      const trade = acts.find(
        (a) =>
          a.kind === "trade" &&
          a.receive === item &&
          !needed(s, avatar, a.item),
      );
      if (trade) return choose(trade, reason);
      const ask = find("ask", item);
      if (ask && willingToGive(s, owner, item, avatar))
        return choose(ask, reason);
      if (!hasSpace(s, avatar, item)) {
        const drop = acts.find(
          (a) => a.kind === "drop" && !needed(s, avatar, a.item),
        );
        if (drop) return choose(drop, "Make room for the target hand.");
      }
    }
    // A desired item can require another item as payment. Follow that need
    // through the same take, travel and trade rules, with cycle detection.
    if (s.avatars[owner] && !isPlayer(s, owner) && !needed(s, owner, item)) {
      for (const payment of desireFor(s, owner).items) {
        if (!hand.items.includes(payment) && holderOf(s, payment) !== owner) {
          const purchase = acquire(payment, seen);
          if (purchase)
            return {
              ...purchase,
              reason: `Seek ${n(payment)} to trade for ${n(item)}.`,
            };
        }
      }
    }
    if (!local) {
      const at = believedPlace(s, avatar, item);
      return at && at !== here
        ? choose(toward(s, avatar, at), reason)
        : hunt(item, reason);
    }
    if (s.avatars[owner] && needed(s, owner, item) && programFor(s, avatar)) {
      const refusals = s.log.filter(
        (e) =>
          e.verb === "ask" &&
          e.actorId === avatar &&
          e.targetId === owner &&
          e.itemId === item &&
          s.turn - e.turn <= 12,
      );
      const threat = find("threaten", undefined, owner);
      if (refusals.length >= 2 && threat)
        return choose(threat, "The same item is blocking both target hands.");
    }
    if (s.avatars[owner] && s.turn - s.avatars[avatar].lastTalk >= 3) {
      const ask = find("ask", item);
      if (ask) return choose(ask, reason);
    }
    return null;
  };
  // Between players, a swap comes before a gift: accept one that costs
  // nothing this hand needs, and offer a spare for an item this hand needs.
  const accept = acts.find(
    (a) =>
      a.kind === "accept" &&
      (!needed(s, avatar, a.item) || needed(s, avatar, a.receive)),
  );
  if (accept) return choose(accept, `Accept ${n(accept.target)}’s offer.`);
  const swap = acts.find(
    (a) =>
      a.kind === "offer" &&
      needed(s, avatar, a.receive) &&
      !needed(s, avatar, a.item) &&
      !s.offers.some((o) => o.from === avatar && o.receive === a.receive),
  );
  if (swap) return choose(swap, `Offer ${n(swap.target)} a swap.`);
  // Hand a spare to an avatar here whose goal needs it. A resident does this
  // only when it would agree to an ask.
  const spare = acts.find(
    (a) =>
      a.kind === "give" &&
      needed(s, a.target, a.item) &&
      !needed(s, avatar, a.item) &&
      (isPlayer(s, avatar) || willingToGive(s, avatar, a.item, a.target)),
  );
  if (spare) return choose(spare, `Give ${n(spare.target)} what they need.`);
  for (const item of missing
    .slice()
    .sort(
      (a, b) =>
        Number(itemPlace(s, b) === here && visibleTo(s, avatar, b)) -
        Number(itemPlace(s, a) === here && visibleTo(s, avatar, a)),
    )) {
    const next = acquire(item);
    if (next) return next;
  }
  if (missing.length) {
    // Stay while a player here holds a wanted item; the player may hand it over.
    const offered = missing.some(
      (id) =>
        isPlayer(s, holderOf(s, id)) &&
        awake(s, holderOf(s, id)) &&
        s.avatars[holderOf(s, id)].place === here,
    );
    const waiting = !offered && waitingHere(avatarOrder(s));
    return waiting ? goMeet(waiting) : idle(reason);
  }
  if (hand.location && here !== hand.location)
    return k.places[hand.location]
      ? choose(toward(s, avatar, hand.location), reason)
      : hunt(hand.location, reason);
  // When two avatars hold their hands and wait for each other, the later one
  // in avatar order goes. Players come first, so residents come to players.
  const order = avatarOrder(s);
  const waiting = waitingHere(order.slice(0, order.indexOf(avatar)));
  if (waiting) return goMeet(waiting);
  return idle(
    handStatus(s, avatar).met
      ? "Hold the target hand."
      : `Wait for ${hand.avatars
          .filter((id) => s.avatars[id].place !== here)
          .map(n)
          .join(" and ")} at ${n(here)}.`,
  );
}
