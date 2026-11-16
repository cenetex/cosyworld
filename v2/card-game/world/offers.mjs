//
//   box       a shut box lying here
//   home      your own home's door, shut
//
import { entityActive, neverBack, packOf } from "../pack-registry.mjs";
import { packDiscovered, runHash } from "../pack-rules.mjs";
import { usedUp } from "../item-use.mjs";
import { arcanaLevel, owesGiving, recordOf } from "./arcana-record.mjs";
import { rootHolder } from "./items.mjs";
import { controlledByHuman, currentActor, humanAvatar } from "../human-cast.mjs";
import {
  MAX_HELD,
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
import { offerFrom } from "../offer-chance.mjs";
import { boxWant, shutBoxesAt } from "./boxes.mjs";
import { nameOf, people } from "./catalog.mjs";
import { travelerOf } from "./company.mjs";

export const OFFER_KINDS = ["box", "resident", "home", "listener"];
const LISTENER = "listener";
export const offerId = (kind, source) =>
  `quest:${kind === "resident" ? "from" : kind}:${source}`;
export const isOfferId = (id) => typeof id === "string" && id.startsWith("quest:");

// The quest a shut box gives: the thing to hold or bring, the place to reach
// or the person to see (the sealed card's own quest, or read from its lock).
const boxQuest = (s, { kind, target, step, lit }) => ({
  kind,
  target,
  since: s.turn,
  refusals: 0,
  story: true,
  ...(step ? { step: { ...step } } : {}),
  ...(lit === undefined ? {} : { lit }),
});

// An escort or meeting offered by a resident who is already another
function withAnother(s, actor, kind, source, want) {
  const traveler = travelerOf(s, source);
  return Boolean(
    kind === "resident" &&
      traveler &&
      traveler !== actor &&
      want.kind === "person" &&
      want.target === source,
  );
}

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
      !heldOf(a).some((held) => sameQuest(held, want)) &&
      !withAnother(s, actor, kind, source, want),
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
    (recordOf(s, actor).sale || owesGiving(s, actor)) &&
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

export function residentOffer(s, actor = currentActor(s)) {
  const a = s.actors[actor],
    them = offerFrom(s, actor);
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
