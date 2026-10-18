// The resident planner. It chooses among the same legal offers a player sees,
// so residents follow the player's reach, consent, capacity, and exchange rules.
import {
  avatarOrder,
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
  exits,
  handStatus,
  handText,
  hasSpace,
  legalActions,
  opponentOf,
  standoffFor,
  willingToGive,
} from "./world.mjs";

function toward(s, avatar, target) {
  const from = s.avatars[avatar].place;
  const queue = [[from]],
    visited = new Set([from]);
  while (queue.length) {
    const route = queue.shift();
    if (route.at(-1) === target)
      return legalActions(s, avatar).find(
        (a) => a.kind === "move" && !a.item && a.target === route[1],
      );
    for (const next of exits(s, route.at(-1)))
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...route, next]);
      }
  }
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
  if (s.avatars[avatar].peaceUntil > s.turn)
    return idle("Catch a breath after the standoff.");
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
  const reason = `Seek this hand: ${handText(s, hand)}.`;
  // Another avatar can hold its whole hand somewhere else and wait only for
  // this one. Going there completes that hand and ends the wait.
  const waitingHere = (ids) =>
    ids.find((id) => {
      const theirs = desireFor(s, id),
        there = s.avatars[id].place;
      return (
        id !== avatar &&
        there !== here &&
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
  const acquire = (item, seen = new Set()) => {
    if (seen.has(item) || holderOf(s, item) === avatar) return null;
    seen = new Set([...seen, item]);
    const owner = holderOf(s, item),
      local = itemPlace(s, item) === here;
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
    if (!local) return choose(toward(s, avatar, itemPlace(s, item)), reason);
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
        Number(itemPlace(s, b) === here) - Number(itemPlace(s, a) === here),
    )) {
    const next = acquire(item);
    if (next) return next;
  }
  if (missing.length) {
    // Stay while a player here holds a wanted item; the player may hand it over.
    const offered = missing.some(
      (id) =>
        isPlayer(s, holderOf(s, id)) &&
        s.avatars[holderOf(s, id)].place === here,
    );
    const waiting = !offered && waitingHere(avatarOrder(s));
    return waiting ? goMeet(waiting) : idle(reason);
  }
  if (hand.location && here !== hand.location)
    return choose(toward(s, avatar, hand.location), reason);
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
