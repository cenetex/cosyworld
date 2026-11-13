import data from "../arcana.json" with { type: "json" };
import {
  heldByHuman,
  humanAvatar,
  humanAvatarIds,
  humanPresent,
} from "../human-cast.mjs";
import {
  isFood,
  localRoadEnds,
  packDefinition,
  packEntity,
  retiredPlace,
  transports,
} from "../pack-registry.mjs";
import { conditionMet, runHash } from "../pack-rules.mjs";
import { specialsAllow } from "../pack-specials.mjs";
import { places, sanctuaries } from "./catalog.mjs";
import { arcanaLevel, isArcanum, recordOf } from "./arcana-record.mjs";
import { boxDefs } from "./boxes.mjs";
import { homeOf } from "./home.mjs";
import { rootHolder } from "./items.mjs";

export const deck = { cards: data.cards };
export { arcanaLevel, isArcanum, recordOf };

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
  opened: (s, who) =>
    Object.values(s.opened || {}).filter((ids) => ids.includes(who)).length,
};

const residents = (s) =>
  Object.keys(s.actors || {}).filter((id) => !humanAvatar(id)).length;
const COUNT_MOST = {
  carried: (s) => Object.keys(s.items || {}).length,
  visited: () => Math.min(64, Object.keys(places).length),
  heard: residents,
  trusting: residents,
  opened: () => new Set(boxDefs().map((def) => def.id)).size,
};

export function holds(s, condition, binding) {
  const c = resolve(condition, binding);
  const each = (r) => holds(s, r, binding);
  if (c.kind === "all") return c.conditions.every(each);
  switch (c.kind) {
    case "any":
      return c.conditions.some(each);
    case "not":
      return !each(c.condition);
    case "count": {
      const n = COUNTS[c.of](s, binding.traveler, c);
      return c.min === undefined
        ? n <= c.max
        : n - (binding.base?.[c.of] ?? 0) >= c.min;
    }
    case "did":
      return recordOf(s, binding.traveler).did.includes(c.key);
    default:
      return conditionMet(s, c, null, null, binding.traveler);
  }
}

function plain(s, id) {
  const e = packEntity(id);
  if (!e) return true;
  const pack = packDefinition(e.packId);
  const release = pack?.release;
  return (
    specialsAllow(s.packs?.[e.packId], pack, id) &&
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
  item: (s) => Object.keys(s.items || {}),
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
    .filter((id) => plain(s, id) && (!is || TRAITS[is](id)))
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
    const score = (id) =>
      runHash(s, `arcana-role:${card.id}:${role.name}:${id}`);
    binding[role.name] = free.reduce((best, id) =>
      score(id) < score(best) ? id : best,
    );
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

const countsIn = (c) =>
  c.kind === "count"
    ? [c]
    : [...(c.conditions || []), ...(c.condition ? [c.condition] : [])].flatMap(
        countsIn,
      );
const risingIn = (card) =>
  card.proof.flatMap(countsIn).filter((c) => c.min !== undefined);
const cardOf = (id) => deck.cards.find((card) => card.id === id) ?? null;

export function deckOrder(s, traveler) {
  const score = (id) => runHash(s, `arcana-deal:${traveler}:${id}`);
  const ids = (list) => list.map((card) => card.id);
  const middle = deck.cards
    .filter((card) => card.number !== 0 && card.number !== 21)
    .map((card) => card.id)
    .sort((a, b) => score(a) - score(b) || (a < b ? -1 : a > b ? 1 : 0));
  return [
    ...ids(deck.cards.filter((card) => card.number === 0)),
    ...middle,
    ...ids(deck.cards.filter((card) => card.number === 21)),
  ];
}

export function dealable(s, card, traveler) {
  const binding = bindingOf(s, card, traveler);
  return (
    Boolean(binding) &&
    resolve(risingIn(card), binding).every(
      (c) =>
        COUNTS[c.of](s, traveler, c) + c.min <=
        COUNT_MOST[c.of](s, traveler, c),
    )
  );
}

export function nextCard(s, traveler, except = null) {
  const record = recordOf(s, traveler);
  return (
    deckOrder(s, traveler).find(
      (id) =>
        !record.proved.includes(id) &&
        id !== record.dealt &&
        id !== except &&
        dealable(s, cardOf(id), traveler),
    ) ?? null
  );
}

export function dealtCard(s, traveler) {
  const record = recordOf(s, traveler);
  const card = record.dealt && cardOf(record.dealt);
  const binding = card && bindingOf(s, card, traveler);
  return binding ? { card, binding: { ...binding, base: record.base } } : null;
}

export function arcanumTerms(s, traveler, id) {
  const card = cardOf(id);
  const binding = card && bindingOf(s, card, traveler);
  if (!binding) return [];
  return resolve(
    card.desire?.length
      ? [...card.desire, ...card.proof.filter((c) => !didsIn(c).length)]
      : card.proof,
    binding,
  );
}

export const dreamCard = (s, traveler) =>
  nextCard(s, traveler, recordOf(s, traveler).dealt);

function deal(s, traveler) {
  const id = nextCard(s, traveler);
  const actor = s.actors[traveler];
  if (actor.arcana) {
    delete actor.arcana.dealt;
    delete actor.arcana.base;
  }
  if (!id) return null;
  const card = cardOf(id);
  const binding = bindingOf(s, card, traveler);
  const record = (actor.arcana ??= { proved: [], did: [] });
  const fresh = new Set(
    resolve(card.proof.flatMap(didsIn), binding).map((c) => c.key),
  );
  record.did = record.did.filter((key) => !fresh.has(key));
  record.dealt = id;
  const rising = resolve(risingIn(card), binding);
  if (rising.length)
    record.base = Object.fromEntries(
      rising.map((c) => [c.of, COUNTS[c.of](s, traveler, c)]),
    );
  return id;
}

export function settleArcana(s, actor = null, since = 0) {
  const seated = (ids) =>
    [...new Set(ids)].filter((id) => humanAvatar(id) && s.actors?.[id]).sort();
  const fresh = (s.log || []).filter((entry) => entry.seq > since);
  if (fresh.length)
    for (const traveler of seated([
      actor,
      ...humanAvatarIds.filter((id) => heldByHuman(s, id)),
    ])) {
      const dealt = dealtCard(s, traveler);
      if (!dealt) continue;
      const record = s.actors[traveler].arcana;
      for (const c of resolve(dealt.card.proof.flatMap(didsIn), dealt.binding))
        if (fresh.some((entry) => fits(entry, c)))
          record.did = [...new Set([...record.did, c.key])].sort();
    }
  const opened = !s.opening || s.opening.crossed;
  for (const traveler of seated([
    actor,
    ...humanAvatarIds.filter((id) => humanPresent(s, id)),
  ])) {
    const dealt = dealtCard(s, traveler);
    if (dealt?.card.proof.every((c) => holds(s, c, dealt.binding))) {
      const record = s.actors[traveler].arcana;
      record.proved = [...new Set([...record.proved, dealt.card.id])].sort();
      deal(s, traveler);
    } else if (!dealt && opened) deal(s, traveler);
  }
  return s;
}

export function installArcana(s) {
  for (const actor of Object.values(s.actors || {})) {
    const record = actor?.arcana;
    if (!record || typeof record !== "object" || Array.isArray(record))
      continue;
    delete record.held;
    if (record.dealt === undefined || !validDeal(record)) {
      delete record.dealt;
      delete record.base;
    }
  }
  return s;
}

const validList = (list) =>
  Array.isArray(list) &&
  list.length <= 64 &&
  list.every(
    (id, i) => typeof id === "string" && id && (i === 0 || list[i - 1] < id),
  );

function validDeal(record) {
  const card = cardOf(record.dealt);
  if (!card || !Array.isArray(record.proved) || record.proved.includes(card.id))
    return false;
  const rising = risingIn(card)
    .map((c) => c.of)
    .sort();
  if (!rising.length) return record.base === undefined;
  const base = record.base;
  return (
    Boolean(base) &&
    typeof base === "object" &&
    !Array.isArray(base) &&
    Object.keys(base).sort().join() === rising.join() &&
    Object.values(base).every((n) => Number.isSafeInteger(n) && n >= 0)
  );
}

export function validArcana(s) {
  return Object.entries(s.actors || {}).every(([id, actor]) => {
    const record = actor?.arcana;
    if (record === undefined) return true;
    if (!record || typeof record !== "object" || Array.isArray(record))
      return false;
    const keys = Object.keys(record);
    return (
      Boolean(humanAvatar(id)) &&
      keys.includes("did") &&
      keys.includes("proved") &&
      keys.every((key) => ["base", "dealt", "did", "proved"].includes(key)) &&
      validList(record.did) &&
      validList(record.proved) &&
      (record.dealt === undefined
        ? record.base === undefined
        : validDeal(record))
    );
  });
}
