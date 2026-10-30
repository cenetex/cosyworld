import { lifeOf, attachmentValue, keepReason, lifeFacts } from "./life.mjs";
import {
  packTastes,
  packNames,
  packPeople,
  packThings,
} from "./pack-registry.mjs";
import forest from "./forest.json" with { type: "json" };
// Personal interests are derived from the shared world. Grievances retain the
// witnessed incident, so a reload and a later visit preserve the same opinion.
// The hub cast's tastes are authored in forest.json beside the pack residents'.
export const tastes = {
  ...Object.fromEntries(
    Object.entries(forest.people).map(([id, p]) => [
      id,
      { ...p.tastes, home: p.home, values: p.values },
    ]),
  ),
  ...packTastes,
};
const actors = Object.keys(tastes);
const items = ["lamp", "oil", "bell", "cloth", ...Object.keys(packThings)];
export const names = {
  ...packNames,
  vale: "Vale",
  moth: "Pip",
  keeper: "The Keeper",
  lamp: "Lamp",
  oil: "Oil flask",
  bell: "Bell",
  cloth: "Black cloth",
};
export const hasMotives = (s) => s.motives?.version === 1;
// Every world keeps motives. The options of earlier callers are ignored.
export function enableMotives(s) {
  if (!s.motives)
    s.motives = {
      version: 1,
      grievances: Object.fromEntries(actors.map((id) => [id, []])),
    };
  return s;
}
export function owner(s, item) {
  const holder = s.items[item].holder;
  return items.includes(holder) ? s.items[holder].holder : holder;
}
export function resentment(s, actor, other) {
  return Math.min(
    3,
    (s.motives?.grievances[actor] || [])
      .filter((g) => g.other === other)
      .reduce((n, g) => n + g.weight, 0),
  );
}
export function valueOf(s, actor, item) {
  let value = tastes[actor]?.values[item] ?? 1;
  if (item === "lamp" && !s.items.lamp.fuel) value -= 5;
  if (item === "oil") {
    if (!s.items.oil.doses) return 1;
    if (owner(s, "lamp") === actor && s.items.lamp.fuel <= 2) value += 9;
  }
  if (item === "bell" && !s.items.oil.doses && s.items.lamp.fuel === 0)
    value += 12;
  if (item === "cloth" && actor === "keeper" && s.items.bell.ringing)
    value += 9;
  // The wanted item is worth more than anything spare.
  const want = s.actors[actor]?.want;
  if (want?.kind === "item" && want.target === item) value += 6;
  return Math.max(1, value) + attachmentValue(s, actor, item);
}
function bundleValue(s, actor, item) {
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
    bundleValue(s, seller, receive) +
      (lifeOf(s, seller) ? 0 : 1) +
      premium -
      favour;
  return { accepted };
}
export function giftDecision(s, giver, item, recipient) {
  const annoyed = resentment(s, giver, recipient);
  const spare = bundleValue(s, giver, item) <= 3;
  const favour =
    s.actors[giver].trust[recipient] > 0 && bundleValue(s, giver, item) <= 6;
  return {
    accepted: !annoyed && !keepReason(s, giver, item) && (spare || favour),
  };
}
// A companion with no reason to go declines, unless it owes a favour. The
// refusal is a code; the companion's own line says why.
export function socialTravel(s, requester, companion) {
  return {
    accepted: false,
    reason: resentment(s, companion, requester)
      ? "grudge"
      : "wants-something-else",
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
  // Residents who mind noise resent a bell rung beside them.
  if (a.kind === "ring")
    for (const [id, resident] of Object.entries(packPeople))
      if (resident.tastes.noise)
        add(
          id,
          resident.tastes.noise.replace("{actor}", names[a.actor]),
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
  if (a.kind === "give" && accepted)
    s.motives.grievances[a.target] = s.motives.grievances[a.target]
      .map((g) => (g.other === a.actor ? { ...g, weight: g.weight - 1 } : g))
      .filter((g) => g.weight > 0);
}
export function motiveFacts(s, actor, limit = 6) {
  return [
    tastes[actor].likes,
    ...(lifeOf(s, actor) ? [lifeFacts(s, actor).join(" ").slice(0, 240)] : []),
    ...(s.motives?.grievances[actor] || [])
      .slice(-limit)
      .reverse()
      .map((g) => `Remembered grievance: ${g.reason}`),
  ].filter(Boolean);
}
export function validMotives(s) {
  if (s.motives === undefined) return true;
  const m = s.motives;
  return (
    m?.version === 1 &&
    m.questPrograms === undefined &&
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
