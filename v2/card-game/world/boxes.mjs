// Boxes (rules 133): one list of every card the rules keep shut. A locked box
// lies face down in the hand and says what opens it; a lock is a want. Five
// kinds of fact used to be gathered in four places (sealed ways, sealed
// residents, locked made things, shut lanes); this module is the one source.
//
//   way       a route with `sealed`, or a guarded way: the card beyond it
//   resident  an avatar with `sealed` and `requires`, drawn where it lies
//   item      a made thing, locked at its home until its maker makes it, or
//             a sealed item (`sealed`), shut where it lies until its `requires`
//             hold
//   lane      a port a ship cannot yet sail to
//   crossing  a pack crossing with `sealed` (a home's door in a shared world)
//   hub       a `reflectionRoutes` entry with `sealed` (the Black pond)
// `boxesAt(s, place, actor)` lists the boxes lying at a place. `boxOpen`
// says whether the way is open now, `boxWant` what opens a shut one. A box
// is the locked card's id, so a card with two entrances is one box.
//
// Opening a box is credited to the traveller whose play opened it, once per
// avatar per box per world (`s.opened`). Time, weather, a resident walking in
// and a guard on his rounds credit nothing (`creditOpened`).
import {
  conditionsMet,
  partyMet,
  crossings,
  entityActive,
  entityShown,
  packDefinitions,
  packEntity,
  packPeople,
  packRouteOpen,
  packThings,
  transports,
} from "../pack-registry.mjs";
import { conditionMet } from "../pack-rules.mjs";
import { shipDock, shutLanes } from "../pack-transport.mjs";
import { usedUp } from "../item-use.mjs";
import {
  currentActor,
  heldByHuman,
  humanAvatarIds,
  humanPresent,
  controlledByHuman,
} from "../human-cast.mjs";
import { guardOf } from "../resident-guard.mjs";
import { life } from "../resident-home.mjs";
import forest from "../forest.json" with { type: "json" };
import { goalsOf, MOST_GOALS } from "./lock-goals.mjs";
import { rootHolder } from "./items.mjs";
import { exits } from "./geography.mjs";
import { sensesFor } from "./senses.mjs";

export const BOX_KINDS = ["way", "item", "resident", "lane", "crossing", "hub"];

// --- Definitions: what can be a box ----------------------------------------

let ways = null,
  thingBoxes = null;
const key = (kind, at, id) => `${kind}|${at}|${id}`;

// Ways and made things never change after load; built on first use because
// the pack registry is still loading when this module is.
function wayDefs() {
  if (ways) return ways;
  ways = new Map();
  const put = (at, id, patch) => {
    const k = key("way", at, id);
    ways.set(k, { kind: "way", at, id, ...ways.get(k), ...patch });
  };
  for (const pack of packDefinitions)
    for (const route of pack.routes || [])
      if (route.sealed) put(route.from, route.to, { pack: pack.id, route });
  // A guard bars his way from both sides (rules 100).
  for (const { from, to } of life.guardable || []) {
    put(from, to, { guard: { post: from, beyond: to } });
    put(to, from, { guard: { post: from, beyond: to } });
  }
  return ways;
}
function itemDefs() {
  thingBoxes ??= Object.keys(packThings)
    .filter((id) => packThings[id].locked || packThings[id].sealed)
    .sort()
    .map((id) =>
      packThings[id].sealed
        ? {
            kind: "item",
            at: packThings[id].holder,
            id,
            pack: packThings[id].packId,
            sealed: true,
          }
        : {
            kind: "item",
            at: packThings[id].home,
            id,
            by: packThings[id].locked.by,
          },
    );
  return thingBoxes;
}
// Residents are read live: a pack's `sealed` and `requires` are data.
const residentDefs = () =>
  Object.entries(packPeople)
    .filter(([, person]) => person.sealed)
    .map(([id, person]) => ({
      kind: "resident",
      at: person.sealed.at,
      id,
    }));
function laneDefs() {
  return Object.entries(transports).flatMap(([transport, t]) =>
    (t.lanes || [])
      .filter((lane) => lane.sealed)
      .map((lane) => ({
        kind: "lane",
        at: t.place,
        id: lane.to,
        transport,
        pack: t.packId,
        lane,
      })),
  );
}
const crossingDefs = () =>
  crossings
    .filter((c) => c.sealed && !c.transport && !c.retired)
    .map((c) => ({
      kind: "crossing",
      at: c.from,
      id: c.to,
      pack: c.packId,
      crossing: c,
    }));
// The hub's sealed ways are checked as a pack's crossings are: a gate and
// nothing else; what opens one is read from the gate (pack-schema.mjs).
for (const r of forest.reflectionRoutes || [])
  if (
    r.sealed !== undefined &&
    !(Object.keys(r.sealed).length === 0 && r.requires?.length)
  )
    throw new Error(`Reflection ${r.from}>${r.to} sealed card needs a gate.`);
const hubDefs = () =>
  (forest.reflectionRoutes || [])
    .filter((r) => r.sealed)
    .map((route) => ({ kind: "hub", at: route.from, id: route.to, route }));

/** Every box the content can lock, with the facts that lock it. */
export const boxDefs = () => [
  ...wayDefs().values(),
  ...itemDefs(),
  ...residentDefs(),
  ...laneDefs(),
  ...crossingDefs(),
  ...hubDefs(),
];
const defOf = (box) =>
  boxDefs().find(
    (d) => d.kind === box.kind && d.at === box.at && d.id === box.id,
  );

// --- Facts: is the box shut? -----------------------------------------------

// The conditions of a card's own that gate it (a place or a resident).
const ownConditions = (id) => {
  const e = packEntity(id);
  return e ? [...(e.requires || []), ...(e.appearsWhen || [])] : [];
};
const holds = (s, def, conditions, actor) =>
  conditionsMet(s, def.pack, conditions, actor);

// A route's lock holds for this traveller: its gate and its own entry rule.
const routeHolds = (s, def, actor) =>
  !def.route ||
  (holds(s, def, def.route.requires, actor) &&
    partyMet(s, def.pack, def.route.travelerRequires, actor));
// The guard is met when he still stands at his post and the order lifts his
// bar (the Writ in his hands, or a pass he gives this traveller). A guard who
// has walked off, or been knocked through, is not met by anyone.
const guardMet = (s, def, actor) =>
  Object.values(s.actors).some(
    (a) => a.guarding === def.guard.beyond && a.place === def.guard.post,
  ) &&
  (packRouteOpen(s, def.guard.post, def.guard.beyond) ||
    !guardOf(s, def.at, def.id, actor));

/**
 * Whether the facts that lock this box hold for the actor now. The rules read
 * conditions directly, never the latched route, so a play is judged by what it
 * made true. A guard is met only by him letting the traveller by (the Writ),
 * not by the guard being gone.
 */
export function boxMet(s, def, actor = currentActor(s)) {
  switch (def.kind) {
    case "way":
      return (
        routeHolds(s, def, actor) &&
        (!def.guard || guardMet(s, def, actor)) &&
        entityActive(s, def.id)
      );
    case "resident":
      return entityActive(s, def.id);
    case "item":
      return def.sealed ? entityActive(s, def.id) : !usedUp(s, def.id);
    case "lane":
      return (
        shipDock(s, def.transport) === def.lane.from &&
        holds(s, def, def.lane.opensWith, actor)
      );
    case "crossing":
      return (
        def.crossing.requires.every((c) =>
          conditionMet(s, c, sensesFor(s), def.pack, actor),
        ) && entityActive(s, def.id)
      );
    case "hub":
      return def.route.requires.every((c) => conditionMet(s, c, null));
    default:
      return false;
  }
}

// Whether a box is on the table at all: a home's door only where this world
// put it, and only in a shared world.
function present(s, def) {
  switch (def.kind) {
    case "crossing":
      return def.crossing.requires
        .filter((c) => ["home_door", "shared_world"].includes(c.kind))
        .every((c) => conditionMet(s, c, null, def.pack));
    case "lane": {
      return shipDock(s, def.transport) === def.lane.from;
    }
    default:
      return true;
  }
}

/** Whether the box stands open to this actor now, as the hand shows it. */
export function boxOpen(s, box, actor = currentActor(s)) {
  const def = defOf(box);
  if (!def) return true;
  switch (def.kind) {
    // A way is open when the traveller can walk it: a gate, a door or the
    // mirror, or a rescue path to the same card.
    case "way":
    case "crossing":
    case "hub":
      return exits(s, def.at, actor).includes(def.id);
    case "resident":
      return entityActive(s, def.id);
    case "item":
      return def.sealed ? entityActive(s, def.id) : !usedUp(s, def.id);
    case "lane":
      return boxMet(s, def, actor);
    default:
      return true;
  }
}

// --- What opens a shut box --------------------------------------------------

// The first unmet condition as a goal a quest card can state. "Something
// heard while holding a thing" has no goal.
function conditionGoal(s, packId, conditions, actor) {
  if (!conditions) return null;
  const met = (c) =>
    packId ? conditionsMet(s, packId, [c], actor) : conditionMet(s, c, null);
  for (const condition of conditions) {
    if (met(condition)) continue;
    if (condition.kind === "any") {
      const goal = conditionGoal(s, packId, condition.conditions, actor);
      if (goal) return goal;
    }
    if (condition.kind === "talked")
      return { kind: "person", target: condition.person };
    if (condition.kind === "holding" && condition.actor)
      return {
        kind: "item",
        target: condition.item,
        step: { verb: "give", to: condition.actor },
      };
    if (condition.kind === "holding" && condition.role === "actor")
      return { kind: "item", target: condition.item };
    if (["item_near", "item_at", "item_present"].includes(condition.kind))
      return {
        kind: "item",
        target: condition.item,
        ...(condition.place
          ? { step: { verb: "bring", at: condition.place } }
          : {}),
      };
  }
  return null;
}
function craftedGoal(s, id, actor) {
  const { by, consumes } = packThings[id].locked,
    home = packThings[id].home;
  const held = consumes.find((c) => rootHolder(s, c) === actor);
  if (held)
    return { kind: "item", target: held, step: { verb: "give", to: by } };
  const missing = consumes.find((c) => ![by, home].includes(rootHolder(s, c)));
  return missing
    ? { kind: "item", target: missing, step: { verb: "bring", at: home } }
    : null;
}
// A sealed route names its quest; the rest is read from its conditions.
const questGoal = ({ kind, target, to }) => ({
  kind,
  target,
  ...(to ? { step: { verb: "give", to } } : {}),
});

function wantOf(s, def, actor) {
  switch (def.kind) {
    case "way": {
      const guarded = def.guard && guardOf(s, def.at, def.id, actor);
      if (def.route?.sealed.quest && !guarded)
        return questGoal(def.route.sealed.quest);
      // A guarded way is opened by what its route asks, from either side.
      const routes = packDefinitions.flatMap((pack) =>
        (pack.routes || [])
          .filter(
            (r) =>
              (r.from === def.at && r.to === def.id) ||
              (def.guard && r.from === def.id && r.to === def.at),
          )
          .map((route) => ({ pack: pack.id, route })),
      );
      for (const { pack, route } of routes) {
        const goal =
          conditionGoal(s, pack, route.travelerRequires, actor) ||
          conditionGoal(s, pack, route.requires, actor);
        if (goal) return goal;
      }
      return null;
    }
    case "item":
      return def.sealed
        ? conditionGoal(s, def.pack, packThings[def.id].requires, actor)
        : craftedGoal(s, def.id, actor);
    case "lane":
      return conditionGoal(s, def.pack, def.lane.opensWith, actor);
    case "crossing":
      return conditionGoal(s, def.pack, def.crossing.requires, actor);
    case "hub":
      return conditionGoal(s, null, def.route.requires, actor);
    default:
      return null;
  }
}

// Every goal still unmet in what keeps this box shut, read from its
// conditions: what the lock shows (world/lock-goals.mjs). A guarded way waits
// on its guard.
export function goalsFor(s, def, actor) {
  switch (def.kind) {
    case "way": {
      const guard = def.guard && guardOf(s, def.at, def.id, actor);
      if (guard) return [wantOf(s, def, actor) ?? { kind: "person", target: guard }];
      return goalsOf(
        s,
        def.pack,
        [
          ...(def.route?.travelerRequires || []),
          ...(def.route?.requires || []),
          ...ownConditions(def.id),
        ],
        actor,
      );
    }
    case "resident":
      return goalsOf(s, packPeople[def.id].packId, ownConditions(def.id), actor);
    case "item": {
      const goal = def.sealed ? null : craftedGoal(s, def.id, actor);
      return def.sealed
        ? goalsOf(s, def.pack, packThings[def.id].requires, actor)
        : goal
          ? [goal]
          : [];
    }
    case "lane":
      return goalsOf(s, def.pack, def.lane.opensWith, actor);
    case "crossing":
      return goalsOf(s, def.pack, def.crossing.requires, actor);
    case "hub":
      return goalsOf(s, null, def.route.requires, actor);
    default:
      return [];
  }
}

/**
 * What opens a shut box, as a goal `{kind, target, step?}` a quest card can
 * state, or null when no such goal fits. `box.goals` lists every unmet goal
 * the lock shows.
 */
export function boxWant(s, box, actor = currentActor(s)) {
  const def = defOf(box);
  return def ? wantOf(s, def, actor) : null;
}

// --- The list ---------------------------------------------------------------

function boxFor(s, def, actor, open) {
  return {
    id: def.id,
    kind: def.kind,
    at: def.at,
    open,
    want: open ? null : wantOf(s, def, actor),
    goals: open ? [] : goalsFor(s, def, actor).slice(0, MOST_GOALS),
  };
}

/**
 * The boxes lying at a place, in hand order (ways, made things, residents,
 * lanes, crossings, then the hub's). A way, crossing or hub box is listed
 * open or shut. A resident, made thing or lane is listed only while shut: once
 * open it is a card like any other.
 */
export function boxesAt(s, place, actor = currentActor(s)) {
  if (!place || !entityActive(s, place)) return [];
  const out = [];
  const seen = new Set();
  const add = (def, open) => {
    const k = `${def.kind}|${def.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(boxFor(s, def, actor, open));
  };
  const here = boxDefs().filter((d) => d.at === place);
  for (const def of here) {
    if (!present(s, def)) continue;
    switch (def.kind) {
      case "way":
        if (!entityShown(s, def.id)) break;
        // A guarded way with no sealed route is a box only while he bars it.
        if (!def.route && !(def.guard && guardOf(s, def.at, def.id, actor)))
          break;
        add(def, boxOpen(s, def, actor));
        break;
      case "item":
        // A made thing waits used up for its maker; a sealed item lies shut
        // while it is in the world but its own conditions do not hold.
        if (
          def.sealed
            ? !entityActive(s, def.id) && entityShown(s, def.id)
            : usedUp(s, def.id) && entityActive(s, def.by)
        )
          add(def, false);
        break;
      case "resident":
        if (!entityActive(s, def.id)) add(def, false);
        break;
      case "lane":
        if (shutLanes(s, place).some((lane) => lane.to === def.id))
          add(def, false);
        break;
      case "crossing":
      case "hub":
        if (entityShown(s, def.id)) add(def, boxOpen(s, def, actor));
        break;
    }
  }
  return out.sort(
    (a, b) => BOX_KINDS.indexOf(a.kind) - BOX_KINDS.indexOf(b.kind),
  );
}

/** The shut boxes at a place: the cards the hand draws face down. */
export const shutBoxesAt = (s, place, actor = currentActor(s)) =>
  boxesAt(s, place, actor).filter((box) => !box.open);

// --- XP for opening ---------------------------------------------------------

const placesOf = (conditions, kind, found = []) => {
  for (const c of conditions || []) {
    if (c.kind === kind) found.push(c.place);
    placesOf(c.conditions, kind, found);
    if (c.condition) placesOf([c.condition], kind, found);
  }
  return found;
};
const lockConditions = (def) => [
  ...(def.route?.requires || []),
  ...(def.route?.travelerRequires || []),
  ...(def.crossing?.requires || []),
  ...(def.lane?.opensWith || []),
  ...ownConditions(def.id),
];

// Whether the avatar has already stood in the place this box leads to.
const stood = (world, id, def) =>
  ["way", "crossing", "hub", "lane"].includes(def.kind) &&
  Boolean(world.actors[id]?.visited?.includes(def.id));

/**
 * After a traveller's play, pay one XP to whoever's play opened a box: it
 * was shut before the play, it holds after it, and the clock alone would not
 * have opened it. Pays once per avatar per box, so a box that locks again
 * pays nothing more. A lock for two (`humans_at`) pays each traveller who
 * stands at its place. Returns the boxes paid, for tests and logs.
 */
export function creditOpened(before, next, actor) {
  if (!(heldByHuman(next, actor) || controlledByHuman(next, actor))) return [];
  const asActor = (world) => ({ ...world, playerActorId: actor });
  const was = asActor(before),
    clock = { ...was, turn: next.turn };
  const paid = [];
  for (const def of boxDefs()) {
    // The post he guards is where the traveller already stands: the bar seen
    // from the far side is the same lock, and pays on the card beyond.
    if (def.guard && !def.route && def.id === def.guard.post) continue;
    if (next.opened?.[def.id]?.includes(actor)) continue;
    // Opening a way back into a place the avatar has already stood in pays
    // nothing: the mirror to the attic does not pay Vale for coming home
    // (owner proposal, 2026-11-11).
    if (stood(before, actor, def)) continue;
    if (boxMet(was, def, actor) || !boxMet(next, def, actor)) continue;
    // A box that opens as the hour turns is not opened by the play.
    if (boxMet(clock, def, actor)) continue;
    const together = placesOf(lockConditions(def), "humans_at");
    const payees = [
      ...new Set([
        actor,
        ...(together.length
          ? humanAvatarIds.filter(
              (id) =>
                humanPresent(next, id) &&
                together.includes(next.actors[id]?.place),
            )
          : []),
      ]),
    ].filter(
      (id) => !next.opened?.[def.id]?.includes(id) && !stood(before, id, def),
    );
    if (!payees.length) continue;
    next.opened ??= {};
    next.opened[def.id] = [...(next.opened[def.id] || []), ...payees].sort();
    paid.push({ box: def.id, kind: def.kind, avatars: payees });
  }
  return paid;
}

/** The saved record of who has opened which box. */
export function validOpened(s) {
  if (s.opened === undefined) return true;
  const ids = new Set(boxDefs().map((d) => d.id));
  return (
    s.opened !== null &&
    typeof s.opened === "object" &&
    !Array.isArray(s.opened) &&
    Object.keys(s.opened).length > 0 &&
    Object.entries(s.opened).every(
      ([box, who]) =>
        ids.has(box) &&
        Array.isArray(who) &&
        who.length > 0 &&
        who.every(
          (id, i) =>
            Object.hasOwn(s.actors || {}, id) && (!i || who[i - 1] < id),
        ),
    )
  );
}
