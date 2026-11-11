// Sticky companions (rules 133). One saved fact: `actors[traveler].companion`
// names the resident who is with that traveler. Nothing is saved on the
// resident; "R is somebody's companion" is read by asking who names R. This
// module holds the state and the predicates and imports nothing, so the pack
// registry and the rules can both use it; the rules inject what they know
// (grievances, wants, the planner) where they call it.
//
// A companion follows the traveler's every move, holds still against its own
// pulls, walks to catch up if it is not in the traveler's place, and goes
// back to being an ordinary resident on exactly two endings: its trust falls
// below the accompany threshold (or it holds a grievance against the
// traveler), or the traveler wakes from a long rest holding no quest that
// pins it.

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
  delete s.actors[resident]?.homeward;
  return before && before !== resident ? before : null;
}
export function release(s, traveler) {
  const before = companionOf(s, traveler);
  delete s.actors[traveler]?.companion;
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

// Why a bond ends now, or null: trust fell below the threshold, or the
// resident holds an active grievance against the traveler.
export function partingReason(s, traveler, resident, grievance) {
  if ((s.actors[resident]?.trust?.[traveler] || 0) < ACCOMPANY_TRUST)
    return "trust";
  return grievance ? "grievance" : null;
}

// The saved field: a resident id, never the traveler itself, one traveler
// per resident.
export function validCompanions(s, actorIds) {
  const seen = new Set();
  for (const [id, a] of Object.entries(s.actors || {})) {
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

// The turn a traveler last acted, from the log, or null if it has aged out.
export const lastActed = (s, who) =>
  s.log?.findLast((e) => e.actorId === who)?.turn ?? null;

// The fixed words of a disabled Accompany button (the rules' vocabulary, not
// pack text): names only, from cards already on the table or known to the
// traveler. One wording for every card that never travels.
export const staysLabel = (name) => `${name} stays here`;
export const withLabel = (name, traveler) => `${name} is with ${traveler}`;
