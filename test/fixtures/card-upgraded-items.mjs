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

// Revision 9 of the Greek pack adds the Suppliant’s Olive Branch; later
// revisions add the Theban outcomes.
export const branchItems = {
  "greek-olive-branch": { holder: "greek-athens", history: [] },
  ...thebanItems,
};

