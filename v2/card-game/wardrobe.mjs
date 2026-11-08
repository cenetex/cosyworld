// Item-dependent artwork is separate from temperament and earned upgrades.
export const WARDROBE_ROLES = [
  "base",
  "happy",
  "sad",
  "hit",
  "strike",
  "brace",
  "sleep",
];
export const wardrobeKey = (items) => JSON.stringify([...items].sort());
const own = (object, key) => Object.hasOwn(object || {}, key);

export function validWardrobe(entries, itemExists, imageValid) {
  if (!Array.isArray(entries) || entries.length > 32) return false;
  const keys = new Set();
  return entries.every((entry) => {
    if (
      !entry ||
      Object.keys(entry).some((key) => !["items", "images"].includes(key)) ||
      !Array.isArray(entry.items) ||
      entry.items.length > 4 ||
      !entry.items.every((id) => typeof id === "string" && itemExists(id)) ||
      new Set(entry.items).size !== entry.items.length ||
      !entry.images ||
      typeof entry.images !== "object" ||
      Array.isArray(entry.images) ||
      !own(entry.images, "base") ||
      !Object.entries(entry.images).every(
        ([role, path]) => WARDROBE_ROLES.includes(role) && imageValid(path),
      )
    )
      return false;
    const key = wardrobeKey(entry.items);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

// Directly carried items count; items dropped, traded away or inside boxes do not.
// A combination beats a single item. Equal-sized sets use canonical lexical order,
// independent of authored insertion order, UI selection and object enumeration.
export function activeWardrobe(world, actor, entries = []) {
  if (!world?.actors?.[actor]) return null;
  return (
    entries
      .filter((entry) =>
        entry.items.every(
          (id) => own(world.items, id) && world.items[id].holder === actor,
        ),
      )
      .sort(
        (a, b) =>
          b.items.length - a.items.length ||
          (wardrobeKey(a.items) < wardrobeKey(b.items) ? -1 : 1),
      )[0] || null
  );
}

export function wardrobePortrait(world, actor, entries, pose = "base") {
  const entry = activeWardrobe(world, actor, entries);
  return entry?.images[pose] || entry?.images.base || null;
}

// Combat gets the already-painted source, preserving the outfit captured at
// the start of a beat even if the final state has transferred an item away.
export function wardrobePoseForSource(entries = [], source, pose) {
  const path = source?.replace(/^\.\//u, "");
  const entry = entries.find((entry) =>
    Object.values(entry.images).includes(path),
  );
  const role = { attack: "strike", guard: "brace" }[pose] || pose;
  return entry?.images[role] || entry?.images.base || null;
}
