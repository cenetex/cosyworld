import { entityActive, neverBack, packOf, transports } from "../pack-registry.mjs";
import { packDiscovered, runHash } from "../pack-rules.mjs";
import { usedUp } from "../item-use.mjs";
import { arcanaLevel, LISTENER, owesGiving, recordOf, selling } from "./arcana-record.mjs";
import { rootHolder } from "./items.mjs";
import { controlledByHuman, currentActor, humanAvatar } from "../human-cast.mjs";
import {
  MAX_HELD,
  PLACE_FROM,
  closedAny,
  closedBy,
  heldOf,
  lostOf,
  slotsUsed,
  newWant,
  sameQuest,
} from "../want.mjs";
import { questFor, toldWant } from "../talk-quest.mjs";
import { revealed } from "../want-talk.mjs";
import { boxWant, shutBoxesAt } from "./boxes.mjs";
import { nameOf, people, places, things } from "./catalog.mjs";

export const OFFER_KINDS = ["box", "resident", "home", "listener", "place"];
export const offerId = (kind, source) =>
  kind === "place" ? `${PLACE_FROM}${source}` : `quest:${kind === "resident" ? "from" : kind}:${source}`;
export const isOfferId = (id) => typeof id === "string" && id.startsWith("quest:");

const boxQuest = (s, { kind, target, step, lit }) => ({
  kind,
  target,
  since: s.turn,
  refusals: 0,
  story: true,
  ...(step ? { step: { ...step } } : {}),
  ...(lit === undefined ? {} : { lit }),
});

const isPlayer = (s, actor) =>
  actor === currentActor(s) || controlledByHuman(s, actor);

const stands = (s, actor, kind, source, want) => {
  const a = s.actors[actor],
    id = offerId(kind, source);
  return Boolean(
    want &&
      !lostOf(s, want) &&
      !closedBy(a, id, want) &&
      !closedAny(a, want) &&
      !heldOf(a).some((held) => sameQuest(held, want)),
  );
};
const ownDoor = (box, actor) =>
  box.kind === "crossing" && actor !== "vale" && box.id === humanAvatar(actor)?.home?.id;

export function boxOffer(s, source, actor = currentActor(s)) {
  const a = s.actors[actor];
  if (!a || !isPlayer(s, actor)) return null;
  const box = shutBoxesAt(s, a.place, actor).find((shut) => shut.id === source);
  const goal = box && !ownDoor(box, actor) && boxWant(s, box, actor);
  const want = goal && boxQuest(s, goal);
  if (!stands(s, actor, "box", source, want)) return null;
  return { id: offerId("box", source), kind: "box", source, want, full: slotsUsed(a) >= MAX_HELD };
}

export const placeMet = (s, place) =>
  s.placeMet && Object.hasOwn(s.placeMet, place) ? s.placeMet[place] : [];
export function looseThings(s) {
  const wanted = new Set(
    Object.entries(s.actors)
      .filter(([id]) => !humanAvatar(id))
      .flatMap(([, a]) => [a.want?.target, ...(a.want?.step?.items || [])]),
  );
  const aboard = new Set(Object.values(transports).map((t) => t.place));
  const loose = (at) => !s.items[at] && !s.actors[at] && !aboard.has(at);
  const out = {};
  for (const id of Object.keys(s.items).sort()) {
    const place = things[id]?.holder;
    if (
      Object.hasOwn(places, place) &&
      s.items[id].holder !== place &&
      loose(s.items[id].holder) &&
      !things[id].locked &&
      !things[id].sealed &&
      !wanted.has(id) &&
      !placeMet(s, place).includes(id) &&
      entityActive(s, id) &&
      !neverBack(s, id) &&
      !usedUp(s, id)
    )
      (out[place] ??= []).push(id);
  }
  return out;
}
export function placeWant(s, place) {
  const item = s.placeCard?.[place] ?? looseThings(s)[place]?.[0];
  return item
    ? {
        ...newWant("place", place, s.turn),
        story: true,
        step: { verb: "lay", items: [item] },
      }
    : null;
}
export function validPlaceMet(s) {
  if (s.placeMet === undefined) return true;
  const entries =
    s.placeMet && typeof s.placeMet === "object" && !Array.isArray(s.placeMet)
      ? Object.entries(s.placeMet)
      : null;
  return Boolean(
    entries?.length &&
      entries.every(
        ([place, items]) =>
          Object.hasOwn(places, place) &&
          Array.isArray(items) &&
          items.length >= 1 &&
          new Set(items).size === items.length &&
          items.every((id) => things[id]?.holder === place),
      ),
  );
}
export function placeOffer(s, actor = currentActor(s)) {
  const a = s.actors[actor];
  if (!a || !isPlayer(s, actor) || !Object.hasOwn(places, a.place)) return null;
  const want = placeWant(s, a.place);
  if (!stands(s, actor, "place", a.place, want)) return null;
  return {
    id: offerId("place", a.place),
    kind: "place",
    source: a.place,
    want,
    full: slotsUsed(a) >= MAX_HELD,
  };
}

export function questOffers(s, actor = currentActor(s)) {
  const a = s.actors[actor];
  if (!a || !isPlayer(s, actor)) return [];
  const full = slotsUsed(a) >= MAX_HELD;
  const here = a.place,
    out = [];
  const add = (kind, source, want) => {
    if ((full && kind !== "listener") || !stands(s, actor, kind, source, want)) return;
    out.push({ id: offerId(kind, source), kind, source, want });
  };
  const home = humanAvatar(actor)?.home;
  for (const box of shutBoxesAt(s, here, actor)) {
    if (ownDoor(box, actor))
      add(
        "home",
        box.id,
        {
          ...newWant("item", humanAvatar(actor).item.id, s.turn),
          story: true,
          step: { verb: "bring", at: home.id },
        },
      );
    else {
      const goal = boxWant(s, box, actor);
      if (goal) add("box", box.id, boxQuest(s, goal));
    }
  }
  if (
    (selling(s, actor) || owesGiving(s, actor)) &&
    s.actors[LISTENER]?.place === here &&
    entityActive(s, LISTENER) &&
    !Object.values(s.items).some((item) => item.holder === actor)
  )
    for (const target of fetchPool(s, actor))
      add("listener", target, {
        ...newWant("item", target, s.turn),
        story: true,
        step: { verb: "give", to: LISTENER },
      });
  return out;
}

export function residentOffer(s, actor, them) {
  const a = s.actors[actor];
  if (
    !a ||
    !them ||
    !isPlayer(s, actor) ||
    !people[them] ||
    s.actors[them]?.place !== a.place ||
    !entityActive(s, them) ||
    !toldWant(s, actor, them) ||
    !revealed(s, them, s.actors[them].want, actor)
  )
    return null;
  const id = offerId("resident", them),
    want = questFor(s, them, s.actors[them].want);
  if (!stands(s, actor, "resident", them, want)) return null;
  return { id, kind: "resident", source: them, want, full: slotsUsed(a) >= MAX_HELD };
}
// A resident's quest lies locked until a Talk tells it, then stands (below).
export function lockedOffer(s, actor, them) {
  const a = s.actors[actor],
    want = s.actors[them]?.want;
  if (
    !a ||
    !isPlayer(s, actor) ||
    !people[them] ||
    them === actor ||
    s.actors[them].place !== a.place ||
    !entityActive(s, them) ||
    !revealed(s, them, want) ||
    toldWant(s, actor, them)
  )
    return null;
  const quest = questFor(s, them, want);
  return quest && stands(s, actor, "resident", them, quest) ? { kind: "resident", source: them } : null;
}
export const residentOffers = (s, actor = currentActor(s)) =>
  Object.keys(s.actors)
    .sort()
    .map((them) => residentOffer(s, actor, them))
    .filter(Boolean);

function fetchPool(s, actor) {
  const level = arcanaLevel(s, actor);
  const order = (ids) =>
    ids
      .map((id) => [runHash(s, `listener-fetch:${actor}:${level}:${id}`), id])
      .sort(([x, a], [y, b]) => x - y || (a < b ? -1 : 1))
      .map(([, id]) => id);
  const known = (id) => {
    const pack = packOf(id);
    return !pack || packDiscovered(s, pack.id);
  };
  const wanted = (active) =>
    new Set(
      Object.entries(s.actors)
        .filter(
          ([id, a]) =>
            !humanAvatar(id) &&
            a.want?.kind === "item" &&
            (!active || entityActive(s, id)),
        )
        .map(([, a]) => a.want.target),
    );
  const fits = (id) =>
    Object.hasOwn(s.items, id) &&
    !neverBack(s, id) &&
    !usedUp(s, id) &&
    ![actor, LISTENER].includes(rootHolder(s, id));
  const near = wanted(true),
    far = wanted(false);
  const ids = Object.keys(s.items);
  const tiers = [
    ids.filter((id) => near.has(id) && known(id)),
    ids.filter((id) => entityActive(s, id) && known(id)),
    ids.filter((id) => far.has(id)),
    ids,
  ];
  const pool = [];
  for (const tier of tiers)
    for (const id of order(tier.filter(fits)))
      if (pool.length < 3 && !pool.includes(id)) pool.push(id);
  return pool;
}
