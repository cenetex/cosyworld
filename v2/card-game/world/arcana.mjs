import data from "../arcana.json" with { type: "json" };
import { humanAvatar } from "../human-cast.mjs";
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
import { companionOf } from "./company.mjs";
import { homeOf } from "./home.mjs";
import { rootHolder } from "./items.mjs";

export const deck = { cards: data.cards };
const cardIds = new Set(data.cards.map((card) => card.id));
export const isArcanum = (id) => cardIds.has(id);

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

export function recordOf(s, traveler) {
  const record = s.actors?.[traveler]?.arcana;
  return {
    proved: record?.proved || [],
    held: record?.held || [],
    did: record?.did || [],
  };
}

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
