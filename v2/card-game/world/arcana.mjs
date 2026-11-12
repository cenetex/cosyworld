import data from "../arcana.json" with { type: "json" };
import { humanAvatar, humanAvatarIds, humanPresent } from "../human-cast.mjs";
import {
  isFood,
  localRoadEnds,
  packDefinition,
  packEntity,
  retiredPlace,
  transports,
} from "../pack-registry.mjs";
import { conditionMet, runHash } from "../pack-rules.mjs";
import { places, sanctuaries } from "./catalog.mjs";
import { arcanumOpen, isArcanum, recordOf } from "./arcana-record.mjs";
import { companionOf } from "./company.mjs";
import { homeOf } from "./home.mjs";
import { rootHolder } from "./items.mjs";

export const deck = { cards: data.cards };
export { arcanumOpen, isArcanum, recordOf };

export function resolve(value, binding) {
  if (typeof value === "string")
    return value.startsWith("$") ? (binding[value.slice(1)] ?? value) : value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, binding));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [key, resolve(v, binding)]),
  );
}

const unfilled = (value) =>
  typeof value === "string"
    ? value.startsWith("$")
    : Boolean(value) &&
      typeof value === "object" &&
      Object.values(value).some(unfilled);

const COUNTS = {
  carried: (s, who) =>
    Object.keys(s.items || {}).filter((id) => rootHolder(s, id) === who).length,
  visited: (s, who) => (s.actors[who]?.visited || []).length,
  heard: (s, who) => Object.keys(s.actors[who]?.heard || {}).length,
  upgrades: (s, who) => (s.actors[who]?.upgrades || []).length,
  trusting: (s, who, c) =>
    Object.keys(s.actors).filter(
      (other) =>
        other !== who &&
        conditionMet(
          s,
          { kind: "trusted", actor: other, min: c.level ?? 1 },
          null,
          null,
          who,
        ),
    ).length,
  company: (s, who) => (companionOf(s, who) ? 1 : 0),
  arcana: (s, who) => recordOf(s, who).held.length,
};

export function holds(s, condition, binding) {
  const c = resolve(condition, binding);
  const each = (r) => holds(s, r, binding);
  switch (c.kind) {
    case "all":
      return c.conditions.every(each);
    case "any":
      return c.conditions.some(each);
    case "not":
      return !each(c.condition);
    case "count": {
      const n = COUNTS[c.of](s, binding.traveler, c);
      return n >= (c.min ?? 0) && n <= (c.max ?? Infinity);
    }
    case "did":
      return recordOf(s, binding.traveler).did.includes(c.key);
    default:
      return conditionMet(s, c, null, null, binding.traveler);
  }
}

function plain(id) {
  const e = packEntity(id);
  if (!e) return true;
  const release = packDefinition(e.packId)?.release;
  return (
    !e.requires?.length &&
    !e.appearsWhen?.length &&
    !e.sealed &&
    (!release ||
      [release.places, release.avatars, release.items].some((list) =>
        list.includes(id),
      ))
  );
}

const KINDS = {
  resident: (s) => Object.keys(s.actors || {}).filter((id) => !humanAvatar(id)),
  item: (s) => Object.keys(s.items || {}).filter((id) => !isArcanum(id)),
  place: () =>
    Object.keys(places).filter(
      (id) =>
        !localRoadEnds(id) &&
        !retiredPlace(id) &&
        !Object.values(transports).some((ship) => ship.place === id),
    ),
};
const TRAITS = {
  food: isFood,
  sanctuary: (id) => sanctuaries.includes(id),
};

export const candidates = (s, kind, is) =>
  KINDS[kind](s)
    .filter((id) => plain(id) && (!is || TRAITS[is](id)))
    .sort();

export function bindingOf(s, card, traveler, pool = candidates) {
  const binding = { traveler };
  const home = homeOf(traveler);
  if (home) binding.home = home;
  const taken = [];
  for (const role of card.roles || []) {
    const free = [...pool(s, role.kind, role.is)]
      .sort()
      .filter((id) => !taken.includes(id));
    if (!free.length) return null;
    binding[role.name] =
      free[runHash(s, `arcana-role:${card.id}:${role.name}`) % free.length];
    taken.push(binding[role.name]);
  }
  return unfilled(resolve([card.proof, card.desire || []], binding))
    ? null
    : binding;
}

export function proves(s, card, traveler) {
  const binding = bindingOf(s, card, traveler);
  return Boolean(binding) && card.proof.every((c) => holds(s, c, binding));
}

const didsIn = (c) =>
  c.kind === "did"
    ? [c]
    : [...(c.conditions || []), ...(c.condition ? [c.condition] : [])].flatMap(
        didsIn,
      );

const set = (value) => value !== undefined && value !== null && value !== false;

const fits = (entry, c) =>
  !entry.generated &&
  Object.entries(c.match || {}).every(([field, want]) =>
    [want].flat().includes(entry[field]),
  ) &&
  (c.with || []).every((field) => set(entry[field])) &&
  (c.without || []).every((field) => !set(entry[field])) &&
  (c.present || []).every((id) => (entry.cast || []).includes(id));

function latch(s, traveler, list, value) {
  const record = (s.actors[traveler].arcana ??= recordOf(s, traveler));
  record[list] = [...new Set([...record[list], value])].sort();
}

export function settleArcana(s, actor = null) {
  const travelers = [
    ...new Set([actor, ...humanAvatarIds.filter((id) => humanPresent(s, id))]),
  ]
    .filter((id) => humanAvatar(id) && s.actors?.[id])
    .sort();
  for (const traveler of travelers)
    for (const card of deck.cards) {
      if (recordOf(s, traveler).proved.includes(card.id)) continue;
      const binding = bindingOf(s, card, traveler);
      if (!binding) continue;
      for (const c of resolve(card.proof.flatMap(didsIn), binding))
        if (
          !recordOf(s, traveler).did.includes(c.key) &&
          (s.log || []).some((entry) => fits(entry, c))
        )
          latch(s, traveler, "did", c.key);
      if (card.proof.every((c) => holds(s, c, binding)))
        latch(s, traveler, "proved", card.id);
    }
  return s;
}

export function takeArcanum(s, actor, id) {
  if (!isArcanum(id)) return false;
  if (arcanumOpen(s, id, actor)) latch(s, actor, "held", id);
  return true;
}

export function spreadCards(cardIds, spots, pick, placed = {}) {
  const out = {};
  const lying = () => [...Object.values(placed), ...Object.values(out)];
  const free = (spot) => !lying().includes(spot.place);
  for (const card of cardIds) {
    if (placed[card]) continue;
    const open = spots.some(free) ? spots.filter(free) : spots;
    if (!open.length) continue;
    const load = (region) =>
      spots.filter((x) => x.region === region && !free(x)).length;
    const regions = [...new Set(open.map((x) => x.region))].sort();
    const least = Math.min(...regions.map(load));
    const lightest = regions.filter((region) => load(region) === least);
    const region = lightest[pick(`arcana-world:${card}`, lightest.length)];
    const here = open.filter((x) => x.region === region);
    out[card] = here[pick(`arcana-place:${card}`, here.length)].place;
  }
  return out;
}

export function installArcana(s, memories = null) {
  const lying = Object.fromEntries(
    data.cards
      .filter((card) => s.items[card.id])
      .map((card) => [card.id, s.items[card.id].holder]),
  );
  const spots = candidates(s, "place").map((place) => ({
    place,
    region: packEntity(place)?.packId ?? "hub",
  }));
  const picked = spreadCards(
    data.cards.map((card) => card.id),
    spots,
    (key, n) => runHash(s, key) % n,
    lying,
  );
  for (const [id, holder] of Object.entries(picked))
    s.items[id] = { holder, history: [] };
  if (memories && s.memories)
    for (const { id } of data.cards) s.memories[id] ??= memories[id];
  return s;
}

const validList = (list) =>
  Array.isArray(list) &&
  list.length <= 64 &&
  list.every(
    (id, i) => typeof id === "string" && id && (i === 0 || list[i - 1] < id),
  );

export function validArcana(s) {
  const lie = Object.keys(s.items || {})
    .filter(isArcanum)
    .every((id) => Boolean(places[s.items[id].holder]));
  return (
    lie &&
    Object.entries(s.actors || {}).every(([id, actor]) => {
      const record = actor?.arcana;
      if (record === undefined) return true;
      return (
        Boolean(humanAvatar(id)) &&
        Boolean(record) &&
        typeof record === "object" &&
        !Array.isArray(record) &&
        Object.keys(record).sort().join() === "did,held,proved" &&
        [record.did, record.held, record.proved].every(validList) &&
        record.held.every((card) => record.proved.includes(card))
      );
    })
  );
}
