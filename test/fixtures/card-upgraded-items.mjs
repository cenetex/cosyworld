// Save upgrades drop the old flask's dose count; one flask now fills one lamp.
export function upgradedItems(items) {
  const next = structuredClone(items);
  if (next.oil) delete next.oil.doses;
  return next;
}

// Revision 9 of the Greek pack adds its boarding passes. A journey past a
// pass's story gate finds it waiting at the Wine-Dark Harbor.
export const passItems = (flags = {}) => ({
  "greek-pass-piraeus": {
    holder: flags["greek-open-door-open"] ? "greek-harbor" : "greek-shipmaster",
    history: [],
  },
  "greek-pass-athens-harbor": {
    holder: flags["greek-open-door-plea-registered"]
      ? "greek-harbor"
      : "greek-shipmaster",
    history: [],
  },
});
