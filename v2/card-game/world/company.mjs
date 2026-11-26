// Trust at which a resident accepts an invitation without a goal of its own.
export const ACCOMPANY_TRUST = 2;
// What an act against a resident takes from its trust in the actor. Trust
// floors at 0. Only a human traveler's visible acts count.
export const TRUST_LOSS = { threaten: 2, threatenForItem: 3, attack: 1 };

// An act against a resident lowers its trust in the actor, never below 0.
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
  if (!a?.trust || !Object.hasOwn(a.trust, actor)) return;
  a.contact = { ...a.contact, [actor]: [s.turn, a.contact?.[actor]?.[1] ?? a.trust[actor]] };
  a.trust[actor] = Math.min(3, a.trust[actor] + 1);
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
