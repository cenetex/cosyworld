// Each run draws a few extra places, residents and things from a pack's pool,
// hashing the world's run seed. The save records the draw; nothing redraws it.
import { sectionPlace } from "./pack-sections.mjs";

// Card tier weights. A legendary card is earned, never drawn.
export const RARITY_WEIGHTS = {
  common: 8,
  uncommon: 4,
  rare: 2,
  epic: 1,
  legendary: 0,
};
const SPECIAL_KINDS = ["places", "avatars", "items"];
export const validSeed = (n) =>
  Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const kindOf = (pack, id) =>
  SPECIAL_KINDS.find((kind) => Object.hasOwn(pack[kind] || {}, id));

export function seedHash(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Which pool entries bring each entity. A place brings its residents, its
// fixtures and the things that start there.
const covers = new Map();
export function poolCover(pack) {
  if (covers.has(pack)) return covers.get(pack);
  const by = new Map();
  const add = (id, entry) => by.set(id, [...(by.get(id) || []), entry]);
  for (const { id } of pack.specials?.pool || []) {
    if (!id) continue;
    add(id, id);
    if (kindOf(pack, id) !== "places") continue;
    for (const kind of ["avatars", "items", "fixtures"])
      for (const other of Object.keys(pack[kind] || {}))
        if (sectionPlace(pack, other) === id) add(other, id);
  }
  covers.set(pack, by);
  return by;
}

// The pack's draw for one seed: places first, then residents and things that
// no drawn place already brings. Each slot is one weighted pick without
// replacement; a `none` entry lets the slot stay empty.
export function drawSpecials(pack, seed) {
  const drawn = [];
  if (!pack.specials) return drawn;
  const cover = poolCover(pack);
  const brought = (id) =>
    (cover.get(id) || []).some(
      (entry) => entry !== id && drawn.includes(entry),
    );
  for (const kind of SPECIAL_KINDS) {
    const pool = pack.specials.pool.filter(
      (e) => e.none || (kindOf(pack, e.id) === kind && !brought(e.id)),
    );
    for (let slot = 0; slot < (pack.specials.draw[kind] || 0); slot++) {
      const total = pool.reduce((n, e) => n + RARITY_WEIGHTS[e.rarity], 0);
      if (!total) break;
      let pick = seedHash(`${seed}:${pack.id}:${kind}:${slot}`) % total;
      const index = pool.findIndex(
        (e) => (pick -= RARITY_WEIGHTS[e.rarity]) < 0,
      );
      const [entry] = pool.splice(index, 1);
      if (!entry.none) drawn.push(entry.id);
    }
  }
  return drawn;
}

// A pool entity is in play only when its own entry, or its place's, was drawn.
export function specialsAllow(state, pack, id) {
  const by = pack.specials && poolCover(pack).get(id);
  return !by || by.some((entry) => state?.specials?.includes(entry));
}

// Record the draw in the pack state. A drawn resident or thing comes to its
// anchor; anyone else standing in an undrawn place returns to the entry.
export function installSpecials(world, pack) {
  const state = world.packs[pack.id],
    pooled = (id) => pack.specials.pool.some((e) => e.id === id);
  if (!pack.specials) delete state.specials;
  if (!pack.specials || !world.run) return;
  // A new content revision keeps the earlier draw, less what left the pool.
  if (state.specials) {
    state.specials = state.specials.filter(pooled);
    return;
  }
  state.specials = drawSpecials(pack, world.run.seed);
  for (const id of state.specials) {
    const anchor =
      pack.specials.pool.find((e) => e.id === id).anchor || pack.entry;
    if (kindOf(pack, id) === "avatars") world.actors[id].place = anchor;
    if (kindOf(pack, id) === "items") world.items[id].holder = anchor;
  }
  for (const [id, actor] of Object.entries(world.actors))
    if (!poolCover(pack).has(id) && !specialsAllow(state, pack, actor.place))
      actor.place = pack.entry;
}

export function validSpecials(world, pack) {
  const list = world.packs[pack.id]?.specials;
  if (!pack.specials || !world.run) return list === undefined;
  return (
    Array.isArray(list) &&
    new Set(list).size === list.length &&
    list.every((id) => pack.specials.pool.some((e) => e.id === id))
  );
}
