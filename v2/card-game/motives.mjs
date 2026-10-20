// Personal interests are derived from the shared world. Grievances retain the
// witnessed incident, so a reload and a later visit preserve the same opinion.
export const tastes = {
  badger: {
    likes: "Warm moss and an uninterrupted nap",
    sore: "Being woken and unnecessary noise",
    home: "clearing",
    values: { lamp: 3, oil: 1, bell: 1, cloth: 7 },
  },
  vale: {
    likes: "Interesting routes and a decent bargain",
    sore: "Changed terms",
    home: "attic",
    values: { lamp: 8, oil: 5, bell: 5, cloth: 4 },
  },
  moth: {
    likes: "Warm light and a splendid waistcoat",
    sore: "Someone spoiling the light",
    home: "pond",
    values: { lamp: 12, oil: 3, bell: 1, cloth: 6 },
  },
  keeper: {
    likes: "Quiet hours and properly returned things",
    sore: "Unnecessary ringing",
    home: "station",
    values: { lamp: 3, oil: 8, bell: 10, cloth: 6 },
  },
};
const actors = Object.keys(tastes);
const items = ["lamp", "oil", "bell", "cloth"];
export const names = {
  badger: "Grumpy Badger",
  vale: "Vale",
  moth: "Pip",
  keeper: "The Keeper",
  lamp: "Lamp",
  oil: "Oil flask",
  bell: "Bell",
  cloth: "Black cloth",
};
export const hasMotives = (s) => s.motives?.version === 1;
export const hasQuestPrograms = (s) =>
  !hasMotives(s) || s.motives.questPrograms === true;
export function enableMotives(s, { questPrograms = false } = {}) {
  if (!s.motives)
    s.motives = {
      version: 1,
      grievances: Object.fromEntries(actors.map((id) => [id, []])),
    };
  if (questPrograms) s.motives.questPrograms = true;
  return s;
}
export function owner(s, item) {
  const holder = s.items[item].holder;
  return items.includes(holder) ? s.items[holder].holder : holder;
}
const placeOf = (s, item) => s.actors[owner(s, item)]?.place || owner(s, item);
export function resentment(s, actor, other) {
  return Math.min(
    3,
    (s.motives?.grievances[actor] || [])
      .filter((g) => g.other === other)
      .reduce((n, g) => n + g.weight, 0),
  );
}
export function valueOf(s, actor, item) {
  let value = tastes[actor].values[item];
  if (item === "lamp" && !s.items.lamp.fuel) value -= 5;
  if (item === "oil") {
    if (!s.items.oil.doses) return 1;
    if (owner(s, "lamp") === actor && s.items.lamp.fuel <= 2) value += 9;
  }
  if (item === "bell" && !s.items.oil.doses && s.items.lamp.fuel === 0)
    value += 12;
  if (item === "cloth" && actor === "keeper" && s.items.bell.ringing)
    value += 9;
  return Math.max(1, value);
}
export function bundleValue(s, actor, item) {
  return (
    valueOf(s, actor, item) +
    (s.items.cloth.holder === item ? valueOf(s, actor, "cloth") : 0)
  );
}
export function tradeDecision(s, requester, give, receive) {
  const seller = owner(s, receive);
  const premium = resentment(s, seller, requester) * 2;
  const favour = Math.min(2, s.actors[seller].trust[requester] || 0);
  const accepted =
    bundleValue(s, seller, give) >=
    bundleValue(s, seller, receive) + 1 + premium - favour;
  return {
    accepted,
    reason: premium
      ? `${names[seller]} wants a better offer after ${names[requester]}'s recent behaviour.`
      : `${names[seller]} values ${names[give]} against ${names[receive]}.`,
  };
}
export function giftDecision(s, giver, item, recipient) {
  const annoyed = resentment(s, giver, recipient);
  const spare = bundleValue(s, giver, item) <= 3;
  const favour =
    s.actors[giver].trust[recipient] > 0 && bundleValue(s, giver, item) <= 6;
  return {
    accepted: !annoyed && (spare || favour),
    reason: annoyed
      ? `${names[giver]} is still annoyed with ${names[recipient]}.`
      : `${names[giver]} wants to keep the ${names[item]}.`,
  };
}
export function interest(s, actor) {
  if (actor === "badger")
    return {
      items: [],
      location: "clearing",
      avatars: [],
      text: !s.actors.badger.awake
        ? "An uninterrupted nap"
        : s.actors.badger.irritation > 1
          ? "Some quiet after all that noise"
          : "The warm patch of moss",
      reason: "Badger considers this patch of moss his own.",
    };
  const held = items.filter((id) => owner(s, id) === actor);
  let item = items
    .slice()
    .sort((a, b) => valueOf(s, actor, b) - valueOf(s, actor, a))
    .find((id) => !held.includes(id));
  const home = tastes[actor].home;
  const annoyed = (s.motives?.grievances[actor] || [])
    .filter(
      (g) =>
        resentment(s, actor, g.other) > 0 &&
        s.actors[g.other].place === s.actors[actor].place,
    )
    .at(-1);
  if (annoyed)
    return {
      items: [],
      location:
        s.actors[actor].place === home
          ? home === "attic"
            ? "station"
            : "attic"
          : home,
      avatars: [],
      text: `Some space from ${names[annoyed.other]}`,
      reason: annoyed.reason,
    };
  if (actor === "moth" && held.includes("lamp")) {
    item = s.items.lamp.fuel <= 2 ? (s.items.oil.doses ? "oil" : "bell") : null;
  }
  if (actor === "keeper" && held.includes("bell"))
    item = s.items.bell.ringing && !held.includes("cloth") ? "cloth" : null;
  if (item && actors.includes(owner(s, item)) && owner(s, item) !== actor) {
    const holder = owner(s, item);
    const refusal = s.log.findLast(
      (e) =>
        e.verb === "ask" &&
        e.actorId === actor &&
        e.targetId === holder &&
        e.itemId === item &&
        e.accepted === false,
    );
    if (resentment(s, holder, actor) || (refusal && s.turn - refusal.turn < 8))
      return {
        items: [item],
        location: home,
        avatars: [],
        text: `Still wants the ${names[item]}`,
        reason: `${names[holder]} wants to keep it. ${names[actor]} will wait at ${home === "pond" ? "the pond" : home === "attic" ? "the attic" : "the station"} for a better opening.`,
      };
  }
  return {
    items: item ? [item] : [],
    location: item ? placeOf(s, item) : home,
    avatars: [],
    text: item
      ? `Interested in the ${names[item]}`
      : actor === "moth"
        ? "A warm spot by the pond"
        : actor === "keeper"
          ? "A quiet station"
          : "An interesting route",
    reason: tastes[actor].likes,
  };
}
export function socialTravel(s, requester, companion, destination) {
  const grudge = resentment(s, companion, requester);
  const want = interest(s, companion);
  if (grudge)
    return {
      accepted: false,
      reason: `${names[companion]} wants space after ${names[requester]}'s recent behaviour.`,
    };
  const carriedWant = want.items.some((id) => owner(s, id) === requester);
  if (destination === want.location || carriedWant)
    return {
      accepted: true,
      reason: carriedWant
        ? `Stay near the wanted ${names[want.items.find((id) => owner(s, id) === requester)]}.`
        : want.reason,
    };
  if (s.actors[companion].trust[requester] > 0)
    return {
      accepted: true,
      favor: true,
      reason: `Repay a favour to ${names[requester]}.`,
    };
  return {
    accepted: false,
    reason: `${names[companion]} would rather pursue ${want.text.toLowerCase()}.`,
  };
}
export function recordReaction(s, a, witnesses, accepted) {
  if (!hasMotives(s)) return;
  const add = (id, reason, kind) => {
    if (id === a.actor || !witnesses.includes(id)) return;
    const list = s.motives.grievances[id];
    const prior = list.find((g) => g.other === a.actor && g.kind === kind);
    if (prior) {
      prior.weight = Math.min(3, prior.weight + 1);
      prior.turn = s.turn;
      list.splice(list.indexOf(prior), 1);
      list.push(prior);
    } else list.push({ other: a.actor, kind, reason, turn: s.turn, weight: 1 });
    s.motives.grievances[id] = list.slice(-6);
  };
  if (a.kind === "ring")
    add(
      "badger",
      `${names[a.actor]} rang a bell beside his warm patch of moss.`,
      "noise",
    );
  if (a.kind === "ring")
    add(
      "keeper",
      `${names[a.actor]} rang the bell during a perfectly good quiet moment.`,
      "noise",
    );
  if (a.kind === "snuff" || (a.kind === "cover" && a.target === "lamp"))
    add("moth", `${names[a.actor]} spoiled Pip's light.`, "light");
  if (a.kind === "threaten" || a.kind === "attack")
    add(a.target, `${names[a.actor]} picked a fight.`, "threat");
  if (
    a.kind === "ask" &&
    !accepted &&
    s.log.some(
      (e) =>
        e.verb === "ask" &&
        e.actorId === a.actor &&
        e.targetId === a.target &&
        e.itemId === a.item &&
        s.turn - e.turn <= 6,
    )
  )
    add(
      a.target,
      `${names[a.actor]} kept asking for the same belongings.`,
      "pestering",
    );
  if (a.kind === "give") {
    s.motives.grievances[a.target] = s.motives.grievances[a.target]
      .map((g) => (g.other === a.actor ? { ...g, weight: g.weight - 1 } : g))
      .filter((g) => g.weight > 0);
    s.actors[a.target].trust[a.actor] = Math.min(
      3,
      s.actors[a.target].trust[a.actor] + 1,
    );
  }
}
export function motiveFacts(s, actor, limit = 6) {
  return [
    tastes[actor].likes,
    `Current interest: ${interest(s, actor).text}.`,
    ...(s.motives?.grievances[actor] || [])
      .slice(-limit)
      .reverse()
      .map((g) => `Remembered grievance: ${g.reason}`),
  ];
}
export function validMotives(s) {
  if (s.motives === undefined) return true;
  const m = s.motives;
  return (
    m?.version === 1 &&
    (m.questPrograms === undefined || typeof m.questPrograms === "boolean") &&
    Object.keys(m.grievances || {})
      .sort()
      .join() === actors.slice().sort().join() &&
    actors.every(
      (id) =>
        Array.isArray(m.grievances[id]) &&
        m.grievances[id].length <= 6 &&
        m.grievances[id].every(
          (g) =>
            actors.includes(g.other) &&
            g.other !== id &&
            ["noise", "light", "threat", "pestering"].includes(g.kind) &&
            typeof g.reason === "string" &&
            g.reason.length <= 180 &&
            Number.isSafeInteger(g.turn) &&
            g.turn >= 0 &&
            g.turn <= s.turn &&
            Number.isInteger(g.weight) &&
            g.weight >= 1 &&
            g.weight <= 3,
        ),
    )
  );
}

// Score only legal actions. Ownership and movement still use the shared rules.
export function socialPlan(s, actor, actions, api) {
  const here = s.actors[actor].place,
    want = interest(s, actor);
  const recent = s.log.filter(
    (e) => e.actorId === actor && e.kind === "action" && s.turn - e.turn <= 4,
  );
  const conflict = api.standoffFor(s, actor);
  const score = (a) => {
    if (s.peaceUntil[actor] > s.turn) return a.kind === "wait" ? 100 : -100;
    if (conflict) {
      if (
        a.kind === "attack" &&
        conflict.struck[api.opponentOf(conflict, actor)]
      )
        return 80;
      if (a.kind === "guard" && !conflict.answered) return 70;
      if (a.kind === "move") return 60;
    }
    let n = -30;
    if (a.kind === "wait") n = 0;
    if (a.kind === "take") n = valueOf(s, actor, a.item) * 2;
    if (a.kind === "trade")
      n =
        (bundleValue(s, actor, a.receive) - bundleValue(s, actor, a.item)) * 3;
    if (a.kind === "ask")
      n = api.willingToGive(s, a.target, a.item, actor)
        ? valueOf(s, actor, a.item) * 2
        : want.items.includes(a.item)
          ? 5
          : -5;
    if (a.kind === "move" && !a.item) {
      const target = want.location;
      const path = api.routeBetween(s, here, target);
      n = path?.[1] === a.target ? (want.items.length ? 18 : 35) : -15;
    }
    if (a.kind === "light" && actor === "moth") n = 45;
    if (a.kind === "refill" && actor !== "keeper" && s.items.lamp.fuel <= 2)
      n = 40;
    if (a.kind === "ring" && here === "pond" && !s.items.oil.doses) n = 50;
    if (
      a.kind === "cover" &&
      a.target === "bell" &&
      actor === "keeper" &&
      s.items.bell.ringing
    )
      n = 45;
    if (
      a.kind === "take" &&
      a.item === "cloth" &&
      s.items.cloth.holder === "lamp" &&
      actor === "moth"
    )
      n = 40;
    if (
      a.kind === "snuff" &&
      actor === "keeper" &&
      s.items.lamp.lit &&
      s.items.lamp.fuel <= 2
    )
      n = 25;
    if (a.kind === "talk" && s.turn - s.actors[actor].lastTalk >= 4) n = 2;
    if (a.kind === "drop")
      n =
        api.carried(s, actor).length >= 3 && valueOf(s, actor, a.item) <= 3
          ? 10
          : -30;
    // A refusal is remembered; repeated requests lose appeal while another
    // activity or a changed offer can become worthwhile.
    n -=
      recent.filter(
        (e) =>
          e.verb === a.kind && e.itemId === a.item && e.targetId === a.target,
      ).length * 12;
    return n;
  };
  const action = actions
    .map((action, index) => ({ action, index, score: score(action) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].action;
  return { action, reason: want.reason + ". " + want.text + "." };
}
