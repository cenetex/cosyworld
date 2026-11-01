// Save upgrades drop the old flask's dose count; one flask now fills one lamp.
export function upgradedItems(items) {
  const next = structuredClone(items);
  if (next.oil) delete next.oil.doses;
  return next;
}

// Revision 9 of the Greek pack adds the Suppliant’s Olive Branch.
export const branchItems = {
  "greek-olive-branch": { holder: "greek-athens", history: [] },
};
