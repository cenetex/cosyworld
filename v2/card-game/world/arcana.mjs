import data from "../arcana.json" with { type: "json" };
import {
  heldByHuman,
  humanAvatar,
  humanAvatarIds,
  humanPresent,
} from "../human-cast.mjs";
import {
  consumable,
  entityActive,
  isFood,
  localRoadEnds,
  neverBack,
  packDefinition,
  packEntity,
  packIdOf,
  packOn,
  retiredPlace,
  transports,
} from "../pack-registry.mjs";
import { conditionMet, runHash } from "../pack-rules.mjs";
import { specialsAllow } from "../pack-specials.mjs";
import { nameOf, places, sanctuaries } from "./catalog.mjs";
import {
  arcanaLevel,
  called,
  CALLS,
  isArcanum,
  owesGiving,
  recordOf,
  unlockedOf,
} from "./arcana-record.mjs";
import { boxDefs } from "./boxes.mjs";
import { companionOf } from "./company.mjs";
import { found } from "./found.mjs";
import { homeOf } from "./home.mjs";
import { rootHolder, shining } from "./items.mjs";
import { conditionWords } from "./want-words.mjs";
import { LEVEL_CAP } from "../level-tiers.mjs";
import {
  heldOf,
  MAX_HELD,
  releaseQuest,
  sleepQuest,
  slotsUsed,
} from "../want.mjs";

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
  opened: (s, who, c) =>
    Object.entries(s.opened || {}).filter(
      ([id, ids]) => ids.includes(who) && boxOf(id, c.box),
    ).length,
};

const boxOf = (id, kind) =>
  !kind || boxDefs().some((def) => def.id === id && def.kind === kind);
const residents = (s) => candidates(s, "resident");
const unseen = (ids, seen) => ids.filter((id) => !seen.includes(id)).length;
const ROOM = {
  carried: (s, who) =>
    candidates(s, "item").filter((id) => rootHolder(s, id) !== who).length,
  visited: (s, who) =>
    Math.min(
      64 - COUNTS.visited(s, who),
      unseen(candidates(s, "place"), s.actors[who]?.visited || []),
    ),
  heard: (s, who) =>
    unseen(residents(s), Object.keys(s.actors[who]?.heard || {})),
  trusting: (s, who, c) =>
    residents(s).filter(
      (other) =>
        other !== who &&
        !conditionMet(
          s,
          { kind: "trusted", actor: other, min: c.level ?? 1 },
          null,
          null,
          who,
        ),
    ).length,
  opened: (s, who, c) =>
    new Set(
      boxDefs()
        .filter(
          (def) =>
            (!c.box || def.kind === c.box) &&
            packOn(s, packIdOf(def.at)) &&
            entityActive(s, def.at) &&
            (!def.pack || packOn(s, def.pack)) &&
            !s.opened?.[def.id]?.includes(who),
        )
        .map((def) => def.id),
    ).size,
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
    case "fighting":
      return (s.standoffs || []).some((fight) =>
        Object.hasOwn(fight.resolve || {}, binding.traveler),
      );
    case "company": {
      const mate = companionOf(s, binding.traveler);
      return (
        Boolean(mate) &&
        (!c.invited || mate === binding.invited) &&
        s.actors[mate]?.place === s.actors[binding.traveler]?.place
      );
    }
    case "lit":
      return candidates(s, "item", "lamp").some(
        (id) =>
          (!c.item || id === c.item) &&
          rootHolder(s, id) === binding.traveler &&
          glows(s, id),
      );
    default:
      return conditionMet(s, c, null, null, binding.traveler);
  }
}

function plain(s, id) {
  const e = packEntity(id);
  if (!e) return packOn(s, packIdOf(id));
  const pack = packDefinition(e.packId);
  const release = pack?.release;
  return (
    packOn(s, e.packId) &&
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
  transport: () => Object.values(transports).map((ship) => ship.place),
};
const glows = (s, id) =>
  id === "lamp"
    ? shining(s)
    : s.items[id]?.lit === true &&
      (s.items[id].fuel ?? 1) > 0 &&
      s.items.cloth?.holder !== id;
const TRAITS = {
  food: isFood,
  drink: (id) => consumable(id) === "drink",
  lamp: (id, s) => typeof s.items[id]?.lit === "boolean",
  sanctuary: (id) => sanctuaries.includes(id),
  wanted: (id, s) =>
    residents(s).some(
      (who) =>
        s.actors[who].want?.kind === "item" && s.actors[who].want.target === id,
    ),
};

export const candidates = (s, kind, is) =>
  KINDS[kind](s)
    .filter((id) => plain(s, id) && (!is || TRAITS[is](id, s)))
    .sort();

export function bindingOf(s, card, traveler, pool = candidates) {
  const binding = { traveler };
  const home = homeOf(traveler, s);
  if (home) binding.home = home;
  const taken = [];
  for (const role of card.roles || []) {
    const free = [...pool(s, role.kind, role.is)]
      .sort()
      .filter((id) => !taken.includes(id) && !neverBack(s, id));
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

const FOOL = 0;
const WORLD = 21;
const LISTENER = data.visit.match.targetId;
const numberOf = (id) => cardOf(id)?.number;
const isMiddle = (id) =>
  Boolean(cardOf(id)) && numberOf(id) !== FOOL && numberOf(id) !== WORLD;
const numbered = (n) => deck.cards.find((card) => card.number === n)?.id;
const sorted = (ids) => [...new Set(ids)].sort();

export function deckOrder(s, traveler, level = 0) {
  const score = (id) => runHash(s, `arcana-deal:${traveler}:${level}:${id}`);
  const ids = (list) => list.map((card) => card.id);
  const middle = deck.cards
    .filter((card) => card.number !== FOOL && card.number !== WORLD)
    .map((card) => card.id)
    .sort((a, b) => score(a) - score(b) || (a < b ? -1 : a > b ? 1 : 0));
  return [
    ...ids(deck.cards.filter((card) => card.number === FOOL)),
    ...middle,
    ...ids(deck.cards.filter((card) => card.number === WORLD)),
  ];
}

export function dealable(s, card, traveler, base = null) {
  const binding = bindingOf(s, card, traveler);
  return (
    Boolean(binding) &&
    resolve(risingIn(card), binding).every(
      (c) =>
        ROOM[c.of](s, traveler, c) >=
        c.min - (base ? COUNTS[c.of](s, traveler, c) - (base[c.of] ?? 0) : 0),
    )
  );
}

export const stepAt = (level) =>
  (data.levels || [])
    .filter((step) => level >= step.from)
    .reduce((last, step) => ({ ...last, ...step }), { scale: 1 });
const nextScale = (level) =>
  (data.levels || []).find((step) => step.scale > stepAt(level).scale)?.scale ??
  stepAt(level).scale;

export function scaled(card, scale = 1) {
  if (!card || scale === 1) return card;
  const grow = (c) =>
    c.kind === "count" && c.min !== undefined
      ? { ...c, min: c.min * scale }
      : c.conditions
        ? { ...c, conditions: c.conditions.map(grow) }
        : c.condition
          ? { ...c, condition: grow(c.condition) }
          : c;
  return { ...card, proof: card.proof.map(grow) };
}

const slotCard = (slot) => scaled(cardOf(slot?.card), slot?.scale ?? 1);
const lostRole = (s, id) =>
  neverBack(s, id) || !(s.items?.[id] || s.actors?.[id] || places[id]);

export function slotBinding(s, slot, traveler) {
  const card = slotCard(slot);
  if (!card) return null;
  const binding = { traveler };
  const home = homeOf(traveler, s);
  if (home) binding.home = home;
  const taken = [];
  for (const role of card.roles || []) {
    const pinned = slot.bind?.[role.name];
    if (pinned && !lostRole(s, pinned) && !taken.includes(pinned))
      binding[role.name] = pinned;
    else {
      const free = candidates(s, role.kind, role.is).filter(
        (id) => !taken.includes(id) && !lostRole(s, id),
      );
      if (!free.length) return null;
      const score = (id) =>
        runHash(s, `arcana-role:${card.id}:${role.name}:${id}`);
      binding[role.name] = free.reduce((best, id) =>
        score(id) < score(best) ? id : best,
      );
    }
    taken.push(binding[role.name]);
  }
  if (unfilled(resolve([card.proof, card.desire || []], binding))) return null;
  return slot.base ? { ...binding, base: slot.base } : binding;
}

function makeSlot(s, traveler, id, face, scale = 1) {
  const card = scaled(cardOf(id), scale);
  const binding = card && bindingOf(s, card, traveler);
  if (!binding) return null;
  const slot = { card: id, face };
  if (card.roles?.length)
    slot.bind = Object.fromEntries(
      card.roles.map((role) => [role.name, binding[role.name]]),
    );
  if (scale > 1) slot.scale = scale;
  return slot;
}

const SPENDS = ["eat", "give", "trade"];
function uses(s, traveler, slot) {
  const card = slotCard(slot);
  const binding = slotBinding(s, slot, traveler);
  const spent = new Set(
    resolve(card.proof.flatMap(didsIn), binding)
      .filter((c) => [c.match?.verb].flat().some((v) => SPENDS.includes(v)))
      .map((c) => c.match.itemId),
  );
  return Object.values(slot.bind || {}).map((id) => [id, spent.has(id)]);
}

function clash(s, traveler, a, b) {
  const kept = new Map(uses(s, traveler, a));
  return uses(s, traveler, b).some(
    ([id, spent]) => kept.has(id) && (spent || kept.get(id)),
  );
}

export function nextSpread(s, traveler) {
  const level = arcanaLevel(s, traveler);
  if (level >= LEVEL_CAP) return [];
  const unlocked = unlockedOf(s, traveler);
  const world = numbered(WORLD);
  if (
    world &&
    level === LEVEL_CAP - 1 &&
    deck.cards.every((card) => card.id === world || unlocked.includes(card.id))
  ) {
    const slot =
      dealable(s, cardOf(world), traveler) &&
      makeSlot(s, traveler, world, "locked");
    return slot ? [slot] : [];
  }
  const scale = stepAt(level + 1).scale;
  const middle = deckOrder(s, traveler, level).filter(isMiddle);
  const known = middle.filter((id) => unlocked.includes(id));
  const unknown = middle.filter((id) => !unlocked.includes(id));
  const used = new Set();
  const tried = recordOf(s, traveler).need;
  const pick = (all, face, at, other = null) => {
    for (const id of [
      ...all.filter((card) => !tried.includes(card)),
      ...all.filter((card) => tried.includes(card)),
    ]) {
      if (used.has(id) || !dealable(s, scaled(cardOf(id), at), traveler))
        continue;
      const slot = makeSlot(s, traveler, id, face, at);
      if (!slot || (other && clash(s, traveler, other, slot))) continue;
      used.add(id);
      return slot;
    }
    return null;
  };
  const up = pick(known, "up", scale);
  const down = pick(known, "down", 1);
  const locked = unknown.length
    ? pick(unknown, "locked", scale, up)
    : pick(known, "locked", nextScale(level + 1), up);
  return [up, down, locked].filter(Boolean);
}

const needOf = (spread) => {
  const shown = spread.filter((slot) => slot.face !== "down");
  return sorted((shown.length ? shown : spread).map((slot) => slot.card));
};

function place(s, traveler, slot) {
  const record = s.actors[traveler].arcana;
  const card = slotCard(slot);
  const binding = slotBinding(s, slot, traveler);
  const fresh = new Set(
    resolve(card.proof.flatMap(didsIn), binding).map((c) => c.key),
  );
  record.did = record.did.filter((key) => !fresh.has(key));
  const rising = resolve(risingIn(card), binding);
  if (rising.length)
    slot.base = Object.fromEntries(
      rising.map((c) => [c.of, COUNTS[c.of](s, traveler, c)]),
    );
  return slot;
}

const recordFor = (s, traveler) =>
  (s.actors[traveler].arcana ??= { proved: [], did: [] });

export function dealSpread(s, traveler) {
  const slots = nextSpread(s, traveler);
  if (!slots.length) return false;
  const a = s.actors[traveler];
  while (heldOf(a).length) releaseQuest(a, heldOf(a)[0]);
  const record = recordFor(s, traveler);
  record.spread = slots.map((slot) => place(s, traveler, slot));
  record.need = needOf(record.spread);
  delete record.done;
  delete record.sale;
  return true;
}

function giveFool(s, traveler) {
  const fool = numbered(FOOL);
  const record = recordFor(s, traveler);
  if (!fool || (record.spread || []).some((slot) => slot.card === fool)) return;
  const a = s.actors[traveler];
  while (slotsUsed(a) >= MAX_HELD && heldOf(a).length)
    releaseQuest(a, heldOf(a).at(-1));
  if (slotsUsed(a) >= MAX_HELD) return;
  const slot = makeSlot(s, traveler, fool, "down");
  if (!slot) return;
  record.spread = [...(record.spread || []), place(s, traveler, slot)];
  record.need = [fool];
  delete record.done;
}

function unlock(s, traveler, id) {
  const a = s.actors[traveler];
  const record = a.arcana;
  record.level ??= arcanaLevel(s, traveler);
  record.proved = sorted([...record.proved, id]);
  record.done = sorted([...(record.done || []), id]);
  a.upgrades = sorted([...(a.upgrades || []), id]);
}

function leave(record, slot) {
  record.spread = record.spread.filter((other) => other !== slot);
  if (!record.spread.length) delete record.spread;
}

function visit(s, traveler, say) {
  const record = recordFor(s, traveler);
  delete record.calls;
  delete record.callers;
  const tell = (text) =>
    say?.(text, {
      kind: "narration",
      actorId: LISTENER,
      cast: [LISTENER, traveler],
      witnesses: [LISTENER, traveler],
      consequence: true,
    });
  const deedOf = (slot) => {
    const binding = slotBinding(s, slot, traveler);
    return (
      binding &&
      conditionWords(
        resolve(termsOf(slotCard(slot)), binding),
        (id) => found(s, traveler, id),
        { home: homeOf(traveler, s) },
      )
    );
  };
  const fool = numbered(FOOL);
  if (
    arcanaLevel(s, traveler) === 0 &&
    !(record.spread || []).some((slot) => slot.card === fool) &&
    !(record.done || []).includes(fool)
  ) {
    giveFool(s, traveler);
    if ((record.spread || []).some((slot) => slot.card === fool))
      tell(`${nameOf(LISTENER)} gives ${nameOf(traveler)} a face-down card.`);
  } else
    for (const slot of [...(record.spread || [])]) {
      if (slot.face !== "down") continue;
      const name = cardOf(slot.card).name,
        deed = deedOf(slot);
      if (!slot.done) {
        slot.face = "up";
        tell(
          `${nameOf(LISTENER)} turns over ${name}${deed ? `, still to do: ${deed}` : ""}.`,
        );
        continue;
      }
      tell(`${nameOf(LISTENER)} turns over ${name}${deed ? `: ${deed}` : ""}.`);
      unlock(s, traveler, slot.card);
      leave(record, slot);
    }
  const need = record.need || [];
  if (need.length && need.every((id) => (record.done || []).includes(id))) {
    const world = numbered(WORLD);
    const rises =
      arcanaLevel(s, traveler) + 1 < LEVEL_CAP ||
      !world ||
      need.includes(world) ||
      unlockedOf(s, traveler).includes(world);
    if (rises) {
      record.level = Math.min(LEVEL_CAP, arcanaLevel(s, traveler) + 1);
      tell(`${nameOf(traveler)} rises a level.`);
    }
    delete record.need;
    delete record.done;
    if (rises && slotsUsed(s.actors[traveler]) < MAX_HELD)
      sleepQuest(s, traveler, { home: (id) => homeOf(id, s) });
  }
  const held = (record.spread || []).map((slot) => slot.card);
  if (
    arcanaLevel(s, traveler) >= 1 &&
    !(record.need || []).some(
      (id) => held.includes(id) && !(record.done || []).includes(id),
    ) &&
    nextSpread(s, traveler).length
  )
    record.sale = true;
}

export const sells = (s, traveler) =>
  recordOf(s, traveler).sale && nextSpread(s, traveler).length > 0;

export const takes = (s, traveler) =>
  sells(s, traveler) || owesGiving(s, traveler);

export const spreadOf = (s, traveler) =>
  recordOf(s, traveler).spread.map((slot, index) => ({
    index,
    card: slot.card,
    face: slot.face,
    binding: slotBinding(s, slot, traveler),
  }));

const termsOf = (card) =>
  card.desire?.length
    ? [...card.desire, ...card.proof.filter((c) => !didsIn(c).length)]
    : card.proof;

export function arcanumTerms(s, traveler, index) {
  const slot = recordOf(s, traveler).spread[index];
  if (!slot || slot.face === "down") return [];
  const card = slotCard(slot);
  const binding = slotBinding(s, slot, traveler);
  if (!binding) return [];
  const { did } = recordOf(s, traveler);
  const left = (c) => {
    if (c.kind !== "count" || c.min === undefined) return c;
    const n = COUNTS[c.of](s, traveler, c) - (binding.base?.[c.of] ?? 0);
    return n > 0 ? { ...c, min: Math.max(1, c.min - n), more: true } : c;
  };
  const grow = (c) =>
    c.conditions ? { ...c, conditions: c.conditions.map(grow) } : left(c);
  return resolve(
    termsOf(card).filter((c) => !c.key || !did.includes(c.key)),
    binding,
  ).map(grow);
}

export function discardTarot(s, traveler, index) {
  const record = s.actors[traveler]?.arcana;
  const slot = record?.spread?.[index];
  if (slot) leave(record, slot);
}

export function dreamCard(s, traveler) {
  const unlocked = unlockedOf(s, traveler);
  const held = recordOf(s, traveler).spread.map((slot) => slot.card);
  return (
    deckOrder(s, traveler, arcanaLevel(s, traveler)).find(
      (id) => isMiddle(id) && !unlocked.includes(id) && !held.includes(id),
    ) ?? null
  );
}

function settleSlots(s, traveler) {
  const record = s.actors[traveler].arcana;
  for (const slot of [...(record?.spread || [])]) {
    const binding = slotBinding(s, slot, traveler);
    if (!binding) {
      leave(record, slot);
      continue;
    }
    const roles = slotCard(slot).roles || [];
    if (roles.length)
      slot.bind = Object.fromEntries(
        roles.map((role) => [role.name, binding[role.name]]),
      );
    if (slot.done || !slotCard(slot).proof.every((c) => holds(s, c, binding)))
      continue;
    if (slot.face === "down") slot.done = true;
    else {
      unlock(s, traveler, slot.card);
      leave(record, slot);
    }
  }
}

export function settleArcana(s, actor = null, since = 0, say = null) {
  const seated = (ids) =>
    [...new Set(ids)].filter((id) => humanAvatar(id) && s.actors?.[id]).sort();
  const fresh = (s.log || []).filter((entry) => entry.seq > since);
  const seen = new Map();
  if (fresh.length)
    for (const traveler of seated([
      actor,
      ...humanAvatarIds.filter((id) => heldByHuman(s, id)),
    ])) {
      const met = (rule) =>
        fresh.some((entry) => fits(entry, resolve(rule, { traveler })));
      seen.set(traveler, { visit: met(data.visit), price: met(data.price) });
      const record = s.actors[traveler].arcana;
      for (const slot of record?.spread || []) {
        const binding = slotBinding(s, slot, traveler);
        if (!binding) continue;
        for (const c of resolve(slotCard(slot).proof.flatMap(didsIn), binding))
          if (
            fresh.some(
              (entry) =>
                fits(entry, c) &&
                (c.while || []).every((w) =>
                  holds(s, w, { ...binding, invited: entry.targetId }),
                ),
            )
          )
            record.did = sorted([...record.did, c.key]);
      }
    }
  for (const traveler of seated([
    actor,
    ...humanAvatarIds.filter((id) => humanPresent(s, id)),
  ])) {
    settleSlots(s, traveler);
    const events = seen.get(traveler);
    if (events?.price && recordOf(s, traveler).sale) {
      dealSpread(s, traveler);
      delete s.actors[traveler].arcana.sale;
    } else if (events?.visit && called(s, traveler)) visit(s, traveler, say);
  }
  return s;
}

const validList = (list) =>
  Array.isArray(list) &&
  list.length <= 64 &&
  list.every(
    (id, i) => typeof id === "string" && id && (i === 0 || list[i - 1] < id),
  );
const plainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function validSlot(slot) {
  if (!plainObject(slot)) return false;
  const card = cardOf(slot.card);
  if (
    !card ||
    !Object.keys(slot).every((key) =>
      ["base", "bind", "card", "done", "face", "scale"].includes(key),
    ) ||
    !["up", "down", "locked"].includes(slot.face) ||
    (slot.done !== undefined &&
      !(slot.done === true && slot.face === "down")) ||
    (slot.scale !== undefined && ![2, 3].includes(slot.scale))
  )
    return false;
  const roles = (card.roles || []).map((role) => role.name).sort();
  if (
    roles.length
      ? !plainObject(slot.bind) ||
        Object.keys(slot.bind).sort().join() !== roles.join() ||
        !Object.values(slot.bind).every((id) => typeof id === "string" && id)
      : slot.bind !== undefined
  )
    return false;
  const rising = [...new Set(risingIn(card).map((c) => c.of))].sort();
  if (!rising.length) return slot.base === undefined;
  return (
    plainObject(slot.base) &&
    Object.keys(slot.base).sort().join() === rising.join() &&
    Object.values(slot.base).every((n) => Number.isSafeInteger(n) && n >= 0)
  );
}

const validSpread = (spread) =>
  Array.isArray(spread) &&
  spread.length >= 1 &&
  spread.length <= 3 &&
  spread.every(validSlot) &&
  new Set(spread.map((slot) => slot.card)).size === spread.length;
const validNeed = (need) =>
  Array.isArray(need) &&
  need.length >= 1 &&
  need.length <= 3 &&
  need.every(isArcanum) &&
  new Set(need).size === need.length;
const validDone = (done) => validList(done) && done.every(isArcanum);
const validLevel = (level) =>
  Number.isSafeInteger(level) && level >= 0 && level <= LEVEL_CAP;

export function installArcana(s) {
  for (const actor of Object.values(s.actors || {})) {
    const record = actor?.arcana;
    if (!plainObject(record)) continue;
    delete record.held;
    delete record.dealt;
    delete record.base;
    const proved = Array.isArray(record.proved)
      ? record.proved.filter(isArcanum)
      : [];
    if (record.level === undefined && proved.length) {
      record.level = Math.min(LEVEL_CAP, proved.length);
      actor.upgrades = sorted([...(actor.upgrades || []), ...proved]);
    }
    if (record.level !== undefined && !validLevel(record.level))
      delete record.level;
    if (record.spread !== undefined && !validSpread(record.spread))
      delete record.spread;
    if (record.need !== undefined && !validNeed(record.need))
      delete record.need;
    if (record.done !== undefined && !validDone(record.done))
      delete record.done;
    if (record.sale !== undefined && record.sale !== true) delete record.sale;
  }
  return s;
}

export function validArcana(s) {
  return Object.entries(s.actors || {}).every(([id, actor]) => {
    const record = actor?.arcana;
    if (record === undefined) return true;
    if (!plainObject(record)) return false;
    const keys = Object.keys(record);
    return (
      Boolean(humanAvatar(id)) &&
      keys.includes("did") &&
      keys.includes("proved") &&
      keys.every((key) =>
        [
          "callers",
          "calls",
          "did",
          "done",
          "level",
          "need",
          "proved",
          "sale",
          "spread",
        ].includes(key),
      ) &&
      (record.calls === undefined ||
        (Number.isSafeInteger(record.calls) &&
          record.calls >= 1 &&
          record.calls <= CALLS)) &&
      (record.callers === undefined ||
        (validList(record.callers) &&
          record.callers.length >= 1 &&
          record.callers.length <= (record.calls ?? 0))) &&
      (record.sale === undefined || record.sale === true) &&
      (record.level === undefined || validLevel(record.level)) &&
      (record.spread === undefined || validSpread(record.spread)) &&
      (record.need === undefined || validNeed(record.need)) &&
      (record.done === undefined || validDone(record.done)) &&
      validList(record.did) &&
      validList(record.proved)
    );
  });
}
