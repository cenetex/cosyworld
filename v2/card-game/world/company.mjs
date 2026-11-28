import forest from "../forest.json" with { type: "json" };
import { humanAvatarIds } from "../human-cast.mjs";

const coreActors = [...new Set([...humanAvatarIds, ...Object.keys(forest.people)])];
const core = new Set(coreActors);
const needsTrust = (id, other) => id !== other && (core.has(id) || core.has(other));

export function startingTrust(id, actors) {
  return Object.fromEntries(
    (core.has(id) ? actors : coreActors).filter((other) => id !== other).map((other) => [other, 0]),
  );
}
export function addTrustLinks(actors, id) {
  for (const [other, actor] of Object.entries(actors))
    if (needsTrust(id, other)) actor.trust[id] ??= 0;
}
export function compactTrust(actors) {
  for (const [id, actor] of Object.entries(actors))
    for (const [other, value] of Object.entries(actor?.trust ?? {}))
      if (value === 0 && id !== other && Object.hasOwn(actors, other) && !needsTrust(id, other))
        delete actor.trust[other];
}

export const ACCOMPANY_TRUST = 2;
export function validTrust(actors, id, trust, actorCount) {
  if (!trust || typeof trust !== "object" || Array.isArray(trust)) return false;
  const peers = Object.keys(trust);
  const complete = core.has(id) ? peers.length === actorCount - 1 :
    coreActors.every((other) => Object.hasOwn(trust, other));
  return complete && peers.every((other) =>
    other !== id && Object.hasOwn(actors, other) &&
    Number.isInteger(trust[other]) && trust[other] >= 0 && trust[other] <= 3,
  );
}
// Only a human traveler's visible acts reduce trust, which floors at 0.
export const TRUST_LOSS = { threaten: 2, threatenForItem: 3, attack: 1 };

export function loseTrust(s, resident, actor, amount) {
  const trust = s.actors?.[resident]?.trust;
  if (!trust || !(trust[actor] > 0)) return 0;
  const before = trust[actor];
  trust[actor] = Math.max(0, before - amount);
  return before - trust[actor];
}

export const TRUST_FADE_TURNS = 96;
export function gainTrust(s, resident, actor) {
  const a = s.actors?.[resident];
  if (!a?.trust || actor === resident || !Object.hasOwn(s.actors, actor)) return;
  const prior = a.trust[actor] ?? 0;
  a.contact = { ...a.contact, [actor]: [s.turn, a.contact?.[actor]?.[1] ?? prior] };
  a.trust[actor] = Math.min(3, prior + 1);
}
export function fadeTrust(s) {
  for (const a of Object.values(s.actors)) {
    if (!a.contact) continue;
    for (const [other, [turn, floor]] of Object.entries(a.contact)) {
      if (s.actors[other]?.place === a.place) a.contact[other] = [s.turn, floor];
      else if (s.turn - turn >= TRUST_FADE_TURNS) {
        if (a.trust[other] > floor) a.trust[other] -= 1;
        if (a.trust[other] > floor) a.contact[other] = [s.turn, floor];
        else delete a.contact[other];
      }
    }
    if (!Object.keys(a.contact).length) delete a.contact;
  }
}

// The fixed words of a disabled Accompany button (the rules' vocabulary, not
// pack text): names only, from cards already on the table or known to the
// traveler. One wording for every card that never travels.
export const staysLabel = (name) => `${name} stays here`;
