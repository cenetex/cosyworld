// Sticky companions (rules 133). One saved fact: `actors[traveler].companion`
// names the resident who is with that traveler (and `actedAt`, the turn the
// traveler last played, which times the shared-world absence limit). Nothing
// is saved on the resident; "R is somebody's companion" is read by asking who
// names R. This module holds the state and the predicates and imports
// nothing, so the pack registry and the rules can both use it.
//
// A companion follows every move of its traveler, holds still against its own
// pulls, and walks to catch up if it is ever parted. The bond ends in exactly
// these ways and no others:
//   - its trust in the traveler falls below the accompany threshold (a threat
//     or a strike on it lowers trust; a grievance alone does not);
//   - the traveler wakes from a long rest holding no quest that pins it;
//   - the traveler asks another resident to accompany them (replacement);
//   - in a shared world the traveler has been away for a day;
//   - the traveler's avatar is reset.
// A companion who is not an active card (its pack switched off) stays bound
// and waits, unseen, until it is back.

// Trust at which a resident will travel with someone (the bond ladder).
export const ACCOMPANY_TRUST = 2;
// What an act against a resident takes from its trust in the actor. Trust
// floors at 0. Only a human traveler's visible acts count; nothing drifts.
export const TRUST_LOSS = { threaten: 2, threatenForItem: 3, attack: 1 };
// A traveler away from a shared world pauses the bond; it ends after a day
// (two light periods, 48 turns).
export const ABSENT_TURNS = 48;

export const companionOf = (s, who) => s.actors?.[who]?.companion ?? null;

// The traveler a resident is with, or null. Sorted, so every engine agrees.
export function travelerOf(s, resident) {
  for (const id of Object.keys(s.actors || {}).sort())
    if (s.actors[id].companion === resident) return id;
  return null;
}

// Whoever is in the same party as `who` in the same place: the traveler and
// its companion, from either side. Gates and per-traveler conditions on a way
// are met by the party (a companion carrying the key opens the door for both).
export function partyOf(s, who) {
  const here = s.actors?.[who]?.place;
  if (here === undefined) return [who];
  const party = [who];
  const mine = companionOf(s, who);
  if (mine && s.actors[mine]?.place === here) party.push(mine);
  const traveler = travelerOf(s, who);
  if (traveler && s.actors[traveler]?.place === here) party.push(traveler);
  return party;
}

// Bind a resident to a traveler. One companion per traveler and one traveler
// per resident: the traveler's earlier companion is released where they stand
// (returned), and the caller refuses a resident who is with someone else.
export function bind(s, traveler, resident) {
  const before = companionOf(s, traveler);
  s.actors[traveler].companion = resident;
  s.actors[traveler].actedAt = s.turn;
  delete s.actors[resident]?.homeward;
  return before && before !== resident ? before : null;
}
export function release(s, traveler) {
  const before = companionOf(s, traveler);
  delete s.actors[traveler]?.companion;
  delete s.actors[traveler]?.actedAt;
  return before;
}

// An act against a resident lowers its trust in the actor, never below 0.
export function loseTrust(s, resident, actor, amount) {
  const trust = s.actors?.[resident]?.trust;
  if (!trust || !(trust[actor] > 0)) return 0;
  const before = trust[actor];
  trust[actor] = Math.max(0, before - amount);
  return before - trust[actor];
}

// Trust is the only thing that breaks a bond while it lasts.
export const trustBroken = (s, traveler, resident) =>
  (s.actors[resident]?.trust?.[traveler] || 0) < ACCOMPANY_TRUST;

// The saved field: a resident id, never the traveler itself, one traveler
// per resident.
export function validCompanions(s, actorIds) {
  const seen = new Set();
  for (const [id, a] of Object.entries(s.actors || {})) {
    if (a.actedAt !== undefined && (a.companion === undefined || !Number.isSafeInteger(a.actedAt) || a.actedAt < 0 || a.actedAt > s.turn)) return false;
    if (a.companion === undefined) continue;
    if (
      typeof a.companion !== "string" ||
      a.companion === id ||
      !actorIds.includes(a.companion) ||
      seen.has(a.companion)
    )
      return false;
    seen.add(a.companion);
  }
  return true;
}


// The fixed words of a disabled Accompany button (the rules' vocabulary, not
// pack text): names only, from cards already on the table or known to the
// traveler. One wording for every card that never travels.
export const staysLabel = (name) => `${name} stays here`;
export const withLabel = (name, traveler) => `${name} is with ${traveler}`;
export const cannotFollowLabel = (name) => `${name} cannot follow`;
