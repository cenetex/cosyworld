import { canonicalPlace } from "../../v2/card-game/pack-registry.mjs";

// Save upgrades drop the old flask's dose count; one flask now fills one lamp.
export function upgradedItems(items) {
  const next = structuredClone(items);
  if (next.oil) delete next.oil.doses;
  return next;
}

// The Theban outcomes wait unseen where their deeds will be done.
export const thebanItems = {
  "greek-burial-account": { holder: "greek-battlefield", history: [] },
  "greek-creon-writ": { holder: "greek-palace", history: [] },
  "greek-guard-tablet": { holder: "greek-gate", history: [] },
};

// The Athenian outcomes wait the same way (Greek revision 15).
export const athenianItems = {
  "greek-pyre-account": { holder: "greek-eleusis", history: [] },
  "greek-marathon-record": { holder: "greek-marathon", history: [] },
};

// Revision 9 of the Greek pack adds the olive branch that became the
// herald's truce; later revisions add the Theban and Athenian outcomes.
export const branchItems = {
  "greek-olive-branch": { holder: "greek-athens", history: [] },
  ...thebanItems,
  ...athenianItems,
};

// Greek revision 12 retires places; a resident of one lives where it was
// taken in.
export function upgradedActor(actor) {
  const next = { ...actor };
  for (const field of ["place", "home"])
    if (next[field]) next[field] = canonicalPlace(next[field]);
  return next;
}
