import { expressionOf } from "./expression.mjs";
import { recordLearning, beginLearning, reconsiderPlan } from "./learning.mjs";
import {
  roamingActors,
  authoredRouteEdges,
  initialRouteEdges,
  visibleRouteEdges,
  rememberRoutes,
  knownRoute,
  validRouteKnowledge,
} from "./roaming-routes.mjs";
import { arriveRecitals, arriveRoamingRecitals } from "./pack-recital.mjs";
import {
  currentActor,
  humanAvatar,
  humanAvatarIds,
  controlledByHuman,
  humanPresent,
  sharedEnabled,
  humanRoomAvailable,
  humanHomeGates,
} from "./human-cast.mjs";
export {
  currentActor,
  humanAvatar,
  humanAvatarIds,
  controlledByHuman,
  humanPresent,
  roomHumanCount,
} from "./human-cast.mjs";
export {
  newTable,
  applyTable,
  canVisit,
  itemPlace as sharedItemPlace,
} from "./shared-rules.mjs";
import {
  enableMotives,
  resentment,
  valueOf,
  tradeDecision,
  giftDecision,
  socialTravel,
  recordReaction,
  validMotives,
  tastes,
} from "./motives.mjs";
import { newMemories, rememberEvent, validMemories } from "./memory.mjs";
import {
  installKnowledge,
  witnessKnowledge,
  reserveKnowledge,
  reserveLaneKnowledge,
  acceptKnowledgeSpeech,
  validKnowledge,
} from "./knowledge.mjs";
import {
  knownActors as readKnownActors,
  installWants,
  levelOf,
  wantOf,
  travels,
  resting,
  settleWants,
  refuseWant,
  reviseStalledWants,
  validWant,
  WANT_KINDS,
  CONNECT_TARGET,
} from "./want.mjs";
import {
  keepReason,
  installLife,
  recordLifeAction,
  validLife,
} from "./life.mjs";
import {
  packPlaces,
  packThings,
  crossings,
  entityActive,
  actorCanVisit,
  packExits,
  packChoices,
  applyPackChoice,
  applyMeetingChoices,
  packGiveChoice,
  choiceText,
  conditionsMet,
  validatePackLinks,
  packDefinition,
  packPeople,
  packActorIds,
  packDefinitions,
  isPackActor,
  staysPut,
  packJourneyDestination,
  roamingQuestActor,
  avoidsStandoffs,
  transports,
} from "./pack-registry.mjs";
import {
  newCrossingState,
  newPackRecord,
  newTemperament,
  crossingExits,
  crossingBetween,
  crossingScenery,
  markCrossed,
  beginRound,
  holderBefore,
  noteAct,
  endRound,
  fixtureOffers,
  soundFixture,
  hasTemperament,
  greeting,
  wakeByVoice,
  disturb,
  calm,
  validPackState,
} from "./pack-rules.mjs";
import {
  installTransports,
  moveTransport,
  transportExits,
  waitForTransport,
  transportArrival,
  preserveTransportAccess,
  isCourse,
  setCourse,
  sailTransports,
  courseToward,
  berthOpen,
  laneGated,
  canDisembark,
  transportPlace,
  transportScenery,
  callTransport,
  VOYAGE,
  laneEdges,
  knowsLane,
  learnLane,
  laneOfEdge,
} from "./pack-transport.mjs";
import { upgradeSave } from "./legacy-saves.mjs";
import forest from "./forest.json" with { type: "json" };
import { BOARDY, connectedHumans } from "./boardyai.mjs";

// Authored forest data and mounted packs share the same rule path.
export const places = { ...forest.places, ...packPlaces };
const homeGates = { ...forest.homeGates, ...humanHomeGates };
export const sanctuaries = Object.keys(places).filter(
  (id) => places[id].sanctuary === true,
);
export const people = { ...forest.people, ...packPeople };
export const things = { ...packThings, ...forest.things };
validatePackLinks(places, people, things);
// Geography identifies resources beyond the attic; each real trip keeps its gates.
const atticInterior = (() => {
  const found = new Set(["attic"]), queue = ["attic"];
  const routes = packDefinitions.flatMap((pack) => pack.routes || []);
  for (let i = 0; i < queue.length && i < Object.keys(places).length; i++) {
    const from = queue[i];
    for (const to of [...places[from].exits,
      ...crossings.filter((c) => c.from === from && !c.transport).map((c) => c.to),
      ...routes.filter((r) => r.from === from).map((r) => r.to)]) {
      if (to === "pond" || found.has(to)) continue;
      found.add(to);
      queue.push(to);
    }
  }
  return found;
})();
const ids = Object.keys(things);
const actorIds = [...Object.keys(forest.people), ...packActorIds];
let planReads = null;
function planningReadsFor(world) {
  if (!planReads) return null;
  let reads = planReads.get(world);
  if (!reads) {
    reads = {};
    planReads.set(world, reads);
  }
  return reads;
}
function knownActors(world) {
  const reads = planningReadsFor(world);
  if (!reads) return readKnownActors(world);
  return (reads.knownActors ??= readKnownActors(world)).slice();
}

const expectedTrustKeys = Object.fromEntries(
  actorIds.map((id) => [
    id,
    actorIds
      .filter((other) => other !== id)
      .sort()
      .join(),
  ]),
);
export const nameOf = (id) =>
  places[id]?.name || people[id]?.name || things[id]?.name || "the world";
export function createWorld({ opening = false, packScopes = {} } = {}) {
  const world = {
    schema: 7,
    ...structuredClone(forest.initialState),
    memories: newMemories(),
    turn: 0,
    revision: 0,
    eventSeq: 1,
  };
  if (opening) {
    const start = structuredClone(forest.opening);
    world.opening = start.discovery;
    for (const [id, fields] of Object.entries(start.actors))
      Object.assign(world.actors[id], fields);
    for (const [id, fields] of Object.entries(start.items))
      Object.assign(world.items[id], fields);
    world.log = start.log;
  }
  installPacks(world);
  for (const [id, scope] of Object.entries(packScopes)) {
    if (
      !world.packs[id] ||
      !["opening", "full"].includes(scope) ||
      !packDefinition(id)?.release
    )
      throw new Error("Unknown content scope.");
    world.packs[id].scope = scope;
  }
  enableMotives(world);
  installLife(world, travels);
  installRouteKnowledge(world);
  installKnowledge(world);
  rememberEvent(world, world.log[0]);
  return world;
}
// Mount every pack missing from this save: its crossings, its state, and its
// residents with fresh relationships. Earlier saves keep their own history.
function installPacks(s) {
  installTransports(s);
  s.crossings ??= {};
  s.packs ??= {};
  const fresh = newMemories();
  for (const pack of packDefinitions) {
    for (const c of pack.crossings) s.crossings[c.id] ??= newCrossingState(c);
    if (s.packs[pack.id]) continue;
    s.packs[pack.id] = newPackRecord(pack);
    for (const [id, a] of Object.entries(pack.avatars)) {
      if (s.actors[id]) throw new Error("A pack resident is already present.");
      s.actors[id] = {
        place: a.place,
        crossed: 0,
        lastTalk: -9,
        trust: Object.fromEntries(
          actorIds.filter((other) => other !== id).map((other) => [other, 0]),
        ),
        ...newTemperament(id),
      };
      s.peaceUntil[id] = 0;
      s.memories[id] = fresh[id];
      if (s.motives) s.motives.grievances[id] = [];
    }
    for (const [id, item] of Object.entries(pack.items || {})) {
      if (s.items[id]) throw new Error("A pack item is already present.");
      s.items[id] = { holder: item.holder, history: [] };
      s.memories[id] = fresh[id];
    }
    for (const [id, actor] of Object.entries(s.actors))
      for (const other of Object.keys(pack.avatars))
        if (other !== id) actor.trust[other] ??= 0;
    for (const id of Object.keys(pack.places)) s.memories[id] ??= fresh[id];
  }
  installLife(s, travels);
  installRouteKnowledge(s);
  installWants(s);
}
// Travellers who learn the roads start from their home region's routes.
function installRouteKnowledge(s) {
  s.routeKnowledge ??= {};
  for (const actor of roamingActors)
    if (!s.routeKnowledge[actor]) {
      rememberRoutes(s, actor, initialRouteEdges(actor));
      rememberRoutes(s, actor, visibleRouteEdges(s.actors[actor].place));
    }
}
export function rootHolder(s, id) {
  let holder = s.items[id].holder;
  const visited = new Set([id]);
  while (s.items[holder]) {
    if (visited.has(holder)) throw new Error("An item holds itself.");
    visited.add(holder);
    holder = s.items[holder].holder;
  }
  return holder;
}
export const itemPlace = (s, id) =>
  s.actors[rootHolder(s, id)]?.place || rootHolder(s, id);
export const carried = (s, actor) =>
  ids.filter((id) => rootHolder(s, id) === actor);
export const covered = (s, id) => s.items.cloth.holder === id;
export const shining = (s) =>
  entityActive(s, "lamp") &&
  s.items.lamp.lit &&
  s.items.lamp.fuel > 0 &&
  !covered(s, "lamp");
export const reflectionOpen = (s, from = itemPlace(s, "lamp")) =>
  // Leaving the attic needs its own light; either shore can light the return.
  shining(s) &&
  (from === "attic"
    ? itemPlace(s, "lamp") === "attic"
    : from === "pond" && ["attic", "pond"].includes(itemPlace(s, "lamp")));
// The bell is the shore's sound source: heard where it rests while it rings
// uncovered. Packs add their own sounding fixtures through pack-rules.mjs.
const baseSoundAt = (s, place) =>
  entityActive(s, "bell") &&
  s.items.bell.ringing > 0 &&
  !covered(s, "bell") &&
  itemPlace(s, "bell") === place;
export const senses = { player: "vale", baseSoundAt, nameOf };
export const sensesFor = (s) => ({
  ...senses,
  player: currentActor(s),
  ...(s.controlledActors ? { humanActors: s.controlledActors } : {}),
});
const baseExits = (_s, place) => places[place].exits;
export const placeText = (s, place) =>
  [
    place === "attic"
      ? reflectionOpen(s, place)
        ? "A tall mirror opens onto a black shore. A path leads through the glass."
        : "A tall mirror stands dark and empty. Dust gathers along its frame."
      : s.opening && place === "station"
        ? "The timetable lists years that have yet to happen. A path leads along the shore to the pond."
        : places[place].text,
    ...crossingScenery(s, place, sensesFor(s)),
    ...transportScenery(s, place, nameOf),
    ...((homeRescueExit(s, place) || pondRescueExit(s, place))
      ? [`A narrow path leads to ${nameOf(homeRescueExit(s, place) || pondRescueExit(s, place))}.`]
      : []),
  ].join(" ");
// A home gate can be restored by resources in the room, including a present
// helper's belongings. Full hands can make room through the usual Drop action.
function localGateResource(s, place, item, actor) {
  return Boolean(
    s.items[item] &&
      entityActive(s, item) &&
      itemPlace(s, item) === place &&
      (canUse(s, actor, item) ||
        (controlledByHuman(s, rootHolder(s, item)) &&
          humanPresent(s, rootHolder(s, item))) ||
        (knownActors(s).includes(rootHolder(s, item)) &&
          (willingToGive(s, rootHolder(s, item), item, actor) ||
            carried(s, actor).some((payment) =>
              canTrade(s, actor, payment, item),
            )))),
  );
}
function homeGateRecoverable(s, place, gate, actor) {
  if (!localGateResource(s, place, gate.item, actor)) return false;
  if (!gate.light || s.items[gate.item].fuel > 0) return true;
  return Boolean(
    gate.refill &&
      localGateResource(s, place, gate.refill, actor) &&
      s.items[gate.refill].doses > 0,
  );
}
function ordinaryExits(s, place, actor, previous) {
  return [
    ...new Set([
      ...baseExits(s, place),
      ...(reflectionOpen(s, place) && place === "attic"
        ? ["pond"]
        : reflectionOpen(s, place) && place === "pond"
          ? ["attic"]
          : []),
      ...crossingExits(s, place, actor, sensesFor(s)),
      ...transportExits(s, place, previous, actor),
      ...packExits(s, place, actor),
    ]),
  ];
}
// A doorway into another part of the same isolated home still needs a way out.
// Capacity is checked when traveling, so a crowded shore remains a waiting case.
function ordinaryRouteHome(s, place, destination, actor, previous) {
  const queue = [[place, previous]], visited = new Set([place]);
  for (let i = 0; i < queue.length; i++) {
    const [from, before] = queue[i];
    if (from === destination) return true;
    for (const to of ordinaryExits(s, from, actor, before)) {
      if (visited.has(to) || !entityActive(s, to) || !actorCanVisit(actor, to, s))
        continue;
      visited.add(to);
      queue.push([to, from]);
    }
  }
  return false;
}
function homeRescueExit(s, place, actor = currentActor(s), previous = null) {
  const gate = homeGates[place];
  actor ||= currentActor(s);
  return gate &&
    (controlledByHuman(s, actor) ||
      (gate.opening && knownActors(s).includes(actor))) &&
    s.actors[actor]?.place === place &&
    !ordinaryRouteHome(s, place, gate.rescue, actor, previous) &&
    !homeGateRecoverable(s, place, gate, actor)
    ? gate.rescue
    : null;
}
function insideLampRemedy(s, actor) {
  const here = s.actors[actor].place, lamp = itemPlace(s, "lamp"), oil = itemPlace(s, "oil");
  if (!atticInterior.has(here) || !ordinaryRouteHome(s, here, lamp, actor) ||
    !ordinaryRouteHome(s, lamp, "attic", actor)) return false;
  const at = (place) => ({ ...s, actors: { ...s.actors,
    [actor]: { ...s.actors[actor], place } } });
  if (!localGateResource(at(lamp), lamp, "lamp", actor)) return false;
  return s.items.lamp.fuel > 0 || (s.items.oil.doses > 0 &&
    ordinaryRouteHome(s, here, oil, actor) && ordinaryRouteHome(s, oil, lamp, actor) &&
    localGateResource(at(oil), oil, "oil", actor));
}
// Recover a gate resource left beyond the mirror after reachable remedies are gone.
function pondRescueExit(s, place, actor, previous) {
  actor ||= currentActor(s);
  const lamp = itemPlace(s, "lamp"), oil = itemPlace(s, "oil");
  // An empty lamp and flask need the bell to call fresh oil at the pond.
  const refillBell = !s.items.lamp.fuel && !s.items.oil.doses
    ? itemPlace(s, "bell") : null;
  if (place !== "pond" || s.actors[actor]?.place !== place ||
    (!controlledByHuman(s, actor) && !knownActors(s).includes(actor)) ||
    !(atticInterior.has(lamp) || (s.items.oil.doses > 0 && atticInterior.has(oil)) ||
      (atticInterior.has(refillBell) && !ordinaryRouteHome(s, place, refillBell, actor, previous))) ||
    ordinaryRouteHome(s, place, "attic", actor, previous)) return null;
  if (ordinaryRouteHome(s, place, lamp, actor, previous) &&
    (s.items.lamp.fuel > 0 || (s.items.oil.doses > 0 &&
      ordinaryRouteHome(s, place, oil, actor, previous)))) return null;
  if (knownActors(s).some((id) =>
    (!controlledByHuman(s, id) || humanPresent(s, id)) &&
    (insideLampRemedy(s, id) || (!atticInterior.has(lamp) && s.actors[id].place === "attic" &&
      homeRescueExit(s, "attic", id) && (localGateResource(s, "attic", "oil", id) ||
        (refillBell && localGateResource(s, "attic", "bell", id))))))) return null;
  return "attic";
}
export function exits(s, place, actor = null, previous = null) {
  const rescue = homeRescueExit(s, place, actor, previous),
    returnPath = pondRescueExit(s, place, actor, previous);
  return [
    ...ordinaryExits(s, place, actor, previous),
    ...(rescue ? [rescue] : []),
    ...(returnPath ? [returnPath] : []),
  ].filter(
    (to) =>
      entityActive(s, to) &&
      actorCanVisit(actor, to, s) &&
      humanRoomAvailable(s, actor, to),
  );
}

function meetCast(s) {
  const player = currentActor(s);
  for (const [id, a] of Object.entries(packPeople))
    if (entityActive(s, id) && s.actors[id].place === s.actors[player].place)
      s.packs[a.packId].met && (s.packs[a.packId].met[id] ??= s.turn);
  if (controlledByHuman(s, player))
    applyMeetingChoices(s, player, Object.keys(places));
  if (!s.opening || (player !== "vale" && !s.opening.crossed)) return;
  if (player === "vale" && s.actors.vale.place === "pond")
    s.opening.crossed = true;
  if (!s.opening.crossed) {
    for (const id of roamingActors)
      if (entityActive(s, id) && s.actors[id].place === s.actors[player].place)
        s.opening.met[id] ??= s.turn;
    return;
  }
  for (const id of actorIds)
    if (
      entityActive(s, id) &&
      s.actors[id].place === s.actors[player].place &&
      s.opening.met[id] === undefined
    )
      s.opening.met[id] = s.turn;
}
const canReach = (s, actor, item) =>
  (itemPlace(s, item) === s.actors[actor].place &&
    !actorIds.includes(rootHolder(s, item))) ||
  rootHolder(s, item) === actor;
const canUse = canReach;
const loadOf = (s, id) => 1 + (s.items.cloth.holder === id ? 1 : 0);
const hasSpace = (s, actor, id) =>
  carried(s, actor).length +
    (rootHolder(s, id) === actor ? 0 : loadOf(s, id)) <=
  3;
// A want in words, for cards and history.
export function wantText(want) {
  if (!want) return "nothing in particular";
  if (want.kind === "item") return `hold ${nameOf(want.target)}`;
  if (want.kind === "place") return `be at ${nameOf(want.target)}`;
  if (want.kind === "connect") return "introduce two people";
  return `talk with ${nameOf(want.target)}`;
}
const bundle = (s, item) => [
  item,
  ...(s.items.cloth.holder === item ? ["cloth"] : []),
];
// An item is needed when it is, or carries, the actor's wanted item.
const needed = (s, actor, item) => {
  const want = wantOf(s, actor);
  return want?.kind === "item" && bundle(s, item).includes(want.target);
};
export function willingToGive(s, owner, item, recipient = null) {
  return (
    !controlledByHuman(s, owner) &&
    recipient !== null &&
    !resentment(s, owner, recipient) &&
    !needed(s, owner, item) &&
    giftDecision(s, owner, item, recipient).accepted
  );
}
// A trade is possible when both items are in hand and both sides have room.
// Whether the other side agrees is decided when the trade is played.
export function tradePossible(s, actor, give, receive) {
  const other = s.items[receive]?.holder;
  if (
    s.items[give]?.holder !== actor ||
    !actorIds.includes(other) ||
    !knownActors(s).includes(other) ||
    other === actor ||
    controlledByHuman(s, other) ||
    s.actors[actor].place !== s.actors[other].place
  )
    return false;
  const outgoing = loadOf(s, give),
    incoming = loadOf(s, receive);
  return (
    carried(s, actor).length - outgoing + incoming <= 3 &&
    carried(s, other).length - incoming + outgoing <= 3
  );
}
// Nobody trades away their own want; anyone takes it in trade.
// A grudge raises the price in tradeDecision; the other side's own want is
// worth any grudge.
function tradeWilling(s, actor, give, receive) {
  const other = s.items[receive].holder;
  return (
    !needed(s, other, receive) &&
    (needed(s, other, give) || tradeDecision(s, actor, give, receive).accepted)
  );
}
export function canTrade(s, actor, give, receive) {
  return (
    tradePossible(s, actor, give, receive) &&
    tradeWilling(s, actor, give, receive)
  );
}
function giftWilling(s, item, recipient) {
  return (
    controlledByHuman(s, recipient) ||
    needed(s, recipient, item) ||
    valueOf(s, recipient, item) >= 2
  );
}
// Refusals commit a code on the play; the refuser's own line voices it.
export const REFUSAL_REASONS = ["grudge", "needs-it", "wants-something-else"];
export const REFUSED_VERBS = ["give", "trade", "ask", "accompany"];
function refusalReason(s, a) {
  const other = a.kind === "trade" ? s.items[a.receive].holder : a.target;
  if (resentment(s, other, a.actor)) return "grudge";
  if (a.kind === "trade" && needed(s, other, a.receive)) return "needs-it";
  if (a.kind === "ask" && (needed(s, other, a.item) || keepReason(s, other, a.item)))
    return "needs-it";
  return "wants-something-else";
}
// What the other side will say to a Give or Trade. The residents' planner
// reads this to avoid some offers it expects to be refused.
export function expects(s, a) {
  if (a.kind === "give") return giftWilling(s, a.item, a.target);
  if (a.kind === "trade") return tradeWilling(s, a.actor, a.item, a.receive);
  return true;
}
// Places an actor can route to now, for drawing a next want.
function reachable(s, actor) {
  const from = s.actors[actor].place,
    seen = new Set([from]),
    queue = [from];
  for (let i = 0; i < queue.length; i++)
    for (const next of exits(s, queue[i], actor))
      if (!seen.has(next) && entityActive(s, next)) {
        seen.add(next);
        queue.push(next);
      }
  return [...seen].filter((id) => id !== from && !transportPlace(id)).sort();
}
const homeOf = (id) =>
  tastes[id]?.home || humanAvatar(id)?.home?.id || null;
function wantAPI(s) {
  return {
    carried: (actor) => carried(s, actor),
    rootHolder: (item) => rootHolder(s, item),
    valueOf: (actor, item) => valueOf(s, actor, item),
    reachable: (actor) => reachable(s, actor),
    exits: (actor) => exits(s, s.actors[actor].place, actor),
    isPlace: (id) => Object.hasOwn(places, id),
    transportPlace,
    routePlaces: (actor) => [
      ...new Set((s.routeKnowledge?.[actor] || []).flat()),
    ],
    // Whether the want planner has a play toward the want. A truce holds
    // every want for a few turns, so it is not a dead end.
    wayForward: (actor) => {
      if (s.peaceUntil[actor] > s.turn) return true;
      // Calling a ship counts only while no ship already waits here.
      const step = wantPlan(s, actor);
      const here = s.actors[actor].place;
      return (
        step.action?.kind !== "wait" ||
        (Boolean(step.callShip) &&
          !Object.values(s.transports || {}).some(
            (t) => t.phase === "docked" && t.dock === here,
          ))
      );
    },
    home: homeOf,
    sanctuaries,
    log: (actor, want) =>
      addLog(
        s,
        "World",
        want.kind === "item"
          ? `${nameOf(actor)} has the ${nameOf(want.target)} at last.`
          : want.kind === "place"
            ? `${nameOf(actor)} reaches ${nameOf(want.target)}.`
            : want.kind === "connect"
              ? `${nameOf(actor)} makes an introduction at last.`
              : `${nameOf(actor)} and ${nameOf(want.target)} talk at last.`,
        {
          kind: "narration",
          actorId: actor,
          verb: "want_met",
          wantMet: { kind: want.kind, target: want.target },
          ...(want.kind === "item" ? { itemId: want.target } : {}),
          ...(want.kind === "person" ? { targetId: want.target } : {}),
        },
      ),
  };
}
// Who can meet a want this turn: the cast that acts and the people it met.
// Pack residents join only when they act or are spoken to, so a resident
// already at its wanted place does not fill the history unseen.
function wantActors(s, extra = []) {
  return [
    ...new Set([
      ...actorIds.filter(
        (id) =>
          travels(id) &&
          entityActive(s, id) &&
          (!controlledByHuman(s, id) || humanPresent(s, id)),
      ),
      ...extra,
    ]),
  ].filter((id) => s.actors[id] && entityActive(s, id));
}
export function addLog(s, speaker, text, detail = {}) {
  const actorId =
    detail.actorId ?? actorIds.find((id) => nameOf(id) === speaker) ?? null;
  const locationId =
    detail.locationId || s.actors[actorId || currentActor(s)].place;
  if (s.eventSeq === undefined) {
    s.log.forEach((entry, index) => {
      entry.seq = index + 1;
    });
    s.eventSeq = s.log.length;
  }
  s.eventSeq += 1;
  s.log.push({
    seq: s.eventSeq,
    turn: s.turn,
    speaker,
    text,
    kind:
      detail.kind ||
      (speaker === "You" ? "input" : actorId ? "dialogue" : "narration"),
    actorId,
    locationId,
    cast: knownActors(s).filter(
      (id) =>
        s.actors[id].place === locationId &&
        (!controlledByHuman(s, id) || humanPresent(s, id)),
    ),
    items: ids
      .filter((id) => entityActive(s, id) && itemPlace(s, id) === locationId)
      .map((id) => {
        const { history, ...item } = s.items[id];
        return { id, ...item };
      }),
    light: shining(s) && itemPlace(s, "lamp") === locationId,
    ...detail,
  });
  const entry = s.log.at(-1);
  if (
    !entry.generated &&
    entry.actorId === currentActor(s) &&
    entry.fromLocationId &&
    entry.fromLocationId !== entry.locationId &&
    (entry.verb === "move" || (entry.verb === "accompany" && entry.accepted))
  )
    s.arrival = {
      seq: entry.seq,
      fromLocationId: entry.fromLocationId,
      locationId: entry.locationId,
    };
  rememberEvent(s, entry);
  witnessKnowledge(
    s,
    entry,
    (id) =>
      entityActive(s, id) && (!controlledByHuman(s, id) || humanPresent(s, id)),
    authoredKnowledgeTopics(),
  );
  trimLog(s);
}

const authoredKnowledgeTopics = () =>
  packDefinitions.flatMap((pack) =>
    (pack.topics || []).map((topic) => ({ ...topic, packId: pack.id })),
  );
function talkKnowledge(s, action, entry) {
  const pairs = controlledByHuman(s, action.actor)
    ? [
        [action.target, action.actor],
        [action.actor, action.target],
      ]
    : [
        [action.actor, action.target],
        [action.target, action.actor],
      ];
  for (const [speaker, listener] of pairs) {
    if (expressionOf(people[speaker]) !== "speech") continue;
    // A story choice is the listener's own deed: only their Talk commits it.
    // A resident who seeks them out may tell the account, which their own
    // later Talk can still turn into the choice, one choice per turn.
    const choices = listener === action.actor ? packChoices(s, listener) : [];
    const topics = authoredKnowledgeTopics()
      .filter((topic) =>
        conditionsMet(s, topic.packId, topic.requires || [], listener),
      )
      .map((topic) => ({
        ...topic,
        choiceReady: choices.some(
          (a) => a.packId === topic.packId && a.choiceId === topic.choiceId,
        ),
      }));
    // At a port or aboard, talk turns to the ships unless an authored story
    // choice is ready here; elsewhere a lane is told when there is nothing
    // newer to say.
    const lane = laneToTell(s, speaker, listener);
    const port =
      lane && atPort(s, speaker) && !topics.some((topic) => topic.choiceReady);
    if (port && reserveLaneKnowledge(s, speaker, listener, entry, lane)) break;
    if (reserveKnowledge(s, speaker, listener, entry, topics)) break;
    if (lane && !port && reserveLaneKnowledge(s, speaker, listener, entry, lane))
      break;
  }
}
const atPort = (s, actor) =>
  Object.values(transports).some(
    (t) =>
      t.place === s.actors[actor].place ||
      t.docks.includes(s.actors[actor].place),
  );
// A lane the speaker knows and the listener does not, nearest first.
function laneToTell(s, speaker, listener) {
  const here = s.actors[speaker].place;
  const ship = Object.entries(transports).find(([, t]) => t.place === here);
  const near = ship ? s.transports[ship[0]].dock : here;
  const lanes = laneEdges()
    .map(laneOfEdge)
    .filter(
      ([from, to]) =>
        entityActive(s, from) &&
        entityActive(s, to) &&
        knowsLane(s, speaker, from, to) &&
        !knowsLane(s, listener, from, to),
    )
    .sort(
      ([a, b], [c, d]) =>
        Number(c === near || d === near) - Number(a === near || b === near),
    );
  return lanes.length ? laneFact(...lanes[0]) : null;
}
// Talk context: the lanes a person at a port knows from it. Narration only.
export function laneTalkFacts(s, actor) {
  if (!s.actors[actor] || !atPort(s, actor)) return [];
  const here = s.actors[actor].place;
  const ship = Object.entries(transports).find(([, t]) => t.place === here);
  const near = ship ? s.transports[ship[0]].dock : here;
  const known = laneEdges()
    .map(laneOfEdge)
    .filter(
      ([from, to]) =>
        from === near &&
        entityActive(s, to) &&
        knowsLane(s, actor, from, to),
    )
    .map(([, to]) => nameOf(to));
  return known.length
    ? [`I know ships sail from ${nameOf(near)} to ${known.join(" and ")}.`]
    : [`I know of no ship lane from ${nameOf(near)}.`];
}
// A gated lane is told with its condition; telling it never opens it.
export const laneFact = (from, to) => ({
  id: `lane:${from}>${to}`,
  text: laneGated(from, to)
    ? `Ships for ${nameOf(to)} leave from ${nameOf(from)} only with something from there aboard.`
    : `Ships for ${nameOf(to)} leave from ${nameOf(from)}.`,
});
const laneFactText = (id) => {
  const [from, to] = id.startsWith("lane:") ? id.slice(5).split(">") : [];
  return from &&
    to &&
    laneEdges().some(([a, b]) => a === `sea:${from}` && b === `sea:${to}`)
    ? laneFact(from, to).text
    : null;
};

// Only recorded speech publishes a selected account and its authored effects.
export function publishKnowledgeSpeech(s, entry, disclosures) {
  const learned = acceptKnowledgeSpeech(s, entry, disclosures);
  // A lane heard in published speech goes on the listener's own chart.
  for (const { fact, listener } of learned)
    if (fact.source.kind === "lane")
      learnLane(s, listener, ...fact.id.slice(5).split(">"));
  for (const { fact, listener, commitChoice } of learned) {
    const topic = fact.source.topic;
    if (
      !commitChoice ||
      !topic?.choiceId ||
      !humanAvatar(listener) ||
      Object.hasOwn(s.packs[topic.packId].receipts, topic.choiceId)
    )
      continue;
    const action = packChoices(s, listener).find(
      (a) => a.packId === topic.packId && a.choiceId === topic.choiceId,
    );
    if (!action) continue;
    applyPackChoice(s, action);
    addLog(s, "World", action.text, {
      kind: "action",
      actorId: listener,
      verb: "choose",
      packId: action.packId,
      choiceId: action.choiceId,
      targetId: action.target,
      locationId: s.actors[listener].place,
    });
  }
  return learned;
}
// Rules read recent history, so generated words never shorten the authoritative
// window. Each kind keeps its own limit; the same plays leave the same events.
export const LOG_LIMIT = 100;
export const GENERATED_LOG_LIMIT = 100;
function trimLog(s) {
  const authoritative = () => s.log.filter((entry) => !entry.generated).length;
  while (authoritative() > LOG_LIMIT) {
    // Keep scene beats when commands fill the history. Retain the latest event.
    const last = s.log.findLastIndex((entry) => !entry.generated);
    const hint = s.log.findIndex(
      (entry, index) =>
        !entry.generated &&
        index < last &&
        ["input", "hint"].includes(entry.kind),
    );
    s.log.splice(
      hint >= 0 ? hint : s.log.findIndex((entry) => !entry.generated),
      1,
    );
  }
  // Generated words older than every remaining event have no scene to join.
  while (
    s.log.filter((entry) => entry.generated).length > GENERATED_LOG_LIMIT ||
    s.log[0]?.generated
  )
    s.log.splice(
      s.log.findIndex((entry) => entry.generated),
      1,
    );
}
function remember(s, item, text) {
  s.items[item].history.push(`Turn ${s.turn}: ${text}`);
  s.items[item].history = s.items[item].history.slice(-12);
}
function transfer(s, item, holder, text) {
  s.items[item].holder = holder;
  remember(s, item, text);
}
function offer(kind, actor, item, target, text, cards) {
  return {
    kind,
    actor,
    item,
    target,
    text,
    cards,
    key: [kind, actor, item || "", target || ""].join(":"),
  };
}
export function standoffFor(s, actor) {
  return s.standoffs.find((c) => [c.challenger, c.defender].includes(actor));
}
export function opponentOf(c, actor) {
  return c.challenger === actor ? c.defender : c.challenger;
}
export function strikePower(s, actor, target) {
  return 2 + Math.sign(levelOf(s, actor) - levelOf(s, target));
}
function closeStandoff(s, c) {
  s.standoffs = s.standoffs.filter((entry) => entry !== c);
  for (const id of [c.challenger, c.defender]) s.peaceUntil[id] = s.turn + 3;
}
function settleStandoffs(s) {
  for (const c of [...s.standoffs]) {
    const separated = [c.challenger, c.defender].some(
      (id) => s.actors[id].place !== c.location,
    );
    const released = c.item && rootHolder(s, c.item) !== c.defender;
    if (separated || released) {
      closeStandoff(s, c);
      addLog(
        s,
        "World",
        separated
          ? `${nameOf(c.challenger)} and ${nameOf(c.defender)} part. The standoff ends.`
          : `The ${nameOf(c.item)} changes hands. The standoff ends.`,
        {
          actorId: c.challenger,
          targetId: c.defender,
          itemId: c.item,
          locationId: c.location,
        },
      );
    }
  }
}
// A joint trip follows the invited avatar's current target hands.
export function accompanyDecision(
  s,
  actor,
  companion,
  destination,
  routeApproved = false,
) {
  const here = s.actors[companion].place;
  const invited =
    controlledByHuman(s, actor) &&
    !controlledByHuman(s, companion) &&
    s.actors[actor].place === here &&
    (routeApproved || exits(s, here, actor).includes(destination));
  if (!invited && !actorCanVisit(companion, destination, s))
    return { accepted: false, reason: "wants-something-else" };
  if (standoffFor(s, actor) || standoffFor(s, companion))
    return { accepted: false, reason: "wants-something-else" };
  if (s.peaceUntil[companion] > s.turn)
    return { accepted: false, reason: "wants-something-else" };
  if (packPeople[companion]?.journey)
    return invited && packJourneyDestination(s, companion) === destination
      ? { accepted: true }
      : { accepted: false, reason: "wants-something-else" };
  if (resentment(s, companion, actor))
    return socialTravel(s, actor, companion, destination);
  // A companion goes along when the trip brings its own want closer.
  const want = wantOf(s, companion);
  // A companion stays near its wanted item when the requester carries it.
  if (want?.kind === "item" && rootHolder(s, want.target) === actor)
    return { accepted: true };
  const goal =
    want?.kind === "place"
      ? want.target
      : want?.kind === "person"
        ? s.actors[want.target]?.place
        : want?.kind === "item" && rootHolder(s, want.target) !== companion
          ? itemPlace(s, want.target)
          : null;
  const distance = (from, to) => {
    const route = routeBetween(s, from, to);
    return route ? route.length - 1 : Infinity;
  };
  if (goal && (goal === destination || distance(destination, goal) < distance(here, goal)))
    return { accepted: true };
  if (s.actors[companion].trust[actor] > 0) return { accepted: true };
  return socialTravel(s, actor, companion, destination);
}

export function legalActions(s, actor = currentActor(s)) {
  if (
    !s.actors[actor] ||
    (!entityActive(s, actor) && !roamingQuestActor(actor))
  )
    return [];
  const here = s.actors[actor].place;
  const out = [
    offer("wait", actor, null, null, `${nameOf(actor)} waits one turn.`, []),
  ];
  for (const to of packPeople[actor]?.journey ? [] : exits(s, here, actor)) {
    // A course card aboard a docked ship sets the voyage for everyone aboard.
    if (isCourse(s, here, to)) {
      const course = offer(
        "course",
        actor,
        null,
        to,
        `${nameOf(actor)} sets the ship's course for ${nameOf(to)}.`,
        [to],
      );
      course.label = "Set course";
      out.push(course);
      continue;
    }
    const through = !baseExits(s, here).includes(to);
    const crossing = crossingBetween(here, to, s);
    const way = through
      ? ` ${(homeRescueExit(s, here, actor) === to || pondRescueExit(s, here, actor) === to) ? "along a narrow path" : crossing?.travel || "through the reflection"}`
      : "";
    // A human can invite a willing resident along their open route.
    for (const other of knownActors(s).filter(
      (id) =>
        (crossing?.travelers !== "player" || controlledByHuman(s, actor)) &&
        (!transportPlace(here) ||
          !crossing?.transport ||
          canDisembark(s, crossing.transport, id)) &&
        id !== actor &&
        !controlledByHuman(s, id) &&
        (!staysPut(id) || packJourneyDestination(s, id) === to) &&
        s.actors[id].place === here,
    )) {
      const request = offer(
        "accompany",
        actor,
        null,
        other,
        `${nameOf(actor)} asks ${nameOf(other)} to accompany them to ${nameOf(to)}.`,
        [other, to],
      );
      request.destination = to;
      request.key += `:${to}`;
      out.push(request);
    }
    out.push(
      offer(
        "move",
        actor,
        null,
        to,
        crossing?.transport
          ? `${nameOf(actor)} ${crossing.travelLabel === "Board" ? "boards" : "disembarks at"} ${nameOf(to)}.`
          : `${nameOf(actor)} goes to ${nameOf(to)}${way}.`,
        [to],
      ),
    );
    for (const id of ids.filter((id) => s.items[id].holder === actor)) {
      out.push(
        offer(
          "move",
          actor,
          id,
          to,
          crossing?.transport
            ? `${nameOf(actor)} carries the ${nameOf(id)} ${crossing.travelLabel === "Board" ? "aboard" : "ashore at"} ${nameOf(to)}.`
            : `${nameOf(actor)} carries the ${nameOf(id)} to ${nameOf(to)}${way}.`,
          [id, to],
        ),
      );
    }
  }
  for (const other of knownActors(s).filter(
    (id) => id !== actor && s.actors[id].place === here,
  )) {
    // A resident with a temperament is greeted (or woken) rather than asked
    // what it wants, and one that avoids standoffs cannot be threatened.
    if (hasTemperament(other)) {
      const greet = greeting(s, other, actor, senses);
      const talk = offer("talk", actor, null, other, greet.text, [other]);
      if (greet.label) talk.label = greet.label;
      out.push(talk);
    }
    const conflict = standoffFor(s, actor);
    if (conflict && opponentOf(conflict, actor) === other) {
      out.push(
        offer(
          "guard",
          actor,
          null,
          other,
          `${nameOf(actor)} guards against ${nameOf(other)}.`,
          [other],
        ),
        offer(
          "attack",
          actor,
          null,
          other,
          `${nameOf(actor)} attacks ${nameOf(other)}.`,
          [other],
        ),
      );
    } else if (
      !(sharedEnabled(s) && controlledByHuman(s, other)) &&
      !avoidsStandoffs(other) &&
      !conflict &&
      !standoffFor(s, other) &&
      s.peaceUntil[actor] <= s.turn &&
      s.peaceUntil[other] <= s.turn
    ) {
      const stake =
        ids.find(
          (id) => s.items[id].holder === other && needed(s, actor, id),
        ) ||
        ids.find((id) => s.items[id].holder === other) ||
        null;
      out.push(
        offer(
          "threaten",
          actor,
          stake,
          other,
          `${nameOf(actor)} threatens ${nameOf(other)}${stake ? ` over the ${nameOf(stake)}` : ""}.`,
          [other],
        ),
      );
    }
    if (!hasTemperament(other))
      out.push(
        offer(
          "talk",
          actor,
          null,
          other,
          `${nameOf(actor)} asks ${nameOf(other)} what they want.`,
          [other],
        ),
      );
  }
  for (const id of ids) {
    const item = s.items[id];
    if (
      !entityActive(s, id) ||
      itemPlace(s, id) !== here ||
      (actorIds.includes(rootHolder(s, id)) &&
        !knownActors(s).includes(rootHolder(s, id)))
    )
      continue;
    if (
      canReach(s, actor, id) &&
      item.holder !== actor &&
      hasSpace(s, actor, id)
    ) {
      out.push(
        offer(
          "take",
          actor,
          id,
          null,
          `${nameOf(actor)} ${things[item.holder] ? "uncovers and takes" : "takes"} the ${nameOf(id)}.`,
          [id],
        ),
      );
    }
    if (item.holder === actor) {
      out.push(
        offer(
          "drop",
          actor,
          id,
          here,
          `${nameOf(actor)} puts the ${nameOf(id)} in ${nameOf(here)}.`,
          [id],
        ),
      );
      for (const other of knownActors(s).filter(
        (p) =>
          p !== actor &&
          s.actors[p].place === here &&
          hasSpace(s, p, id),
      )) {
        out.push(
          offer(
            "give",
            actor,
            id,
            other,
            `${nameOf(actor)} gives the ${nameOf(id)} to ${nameOf(other)}.`,
            [id, other],
          ),
        );
      }
    } else if (
      actorIds.includes(item.holder) &&
      item.holder !== actor &&
      hasSpace(s, actor, id)
    ) {
      out.push(
        offer(
          "ask",
          actor,
          id,
          item.holder,
          `${nameOf(actor)} asks ${nameOf(item.holder)} for the ${nameOf(id)}.`,
          [id, item.holder],
        ),
      );
    }
    if (!canUse(s, actor, id)) continue;
    const belonging = humanAvatarIds
      .map(humanAvatar)
      .find((a) => a.id !== "vale" && a.item.id === id);
    if (belonging) {
      const use = offer(
        "use",
        actor,
        id,
        null,
        `${nameOf(actor)} ${belonging.item.effect}.`,
        [id],
      );
      use.label = belonging.item.verb;
      out.push(use);
    }
    if (id === "lamp") {
      if (item.lit)
        out.push(
          offer(
            "snuff",
            actor,
            id,
            null,
            `${nameOf(actor)} puts out the Lamp.`,
            [id],
          ),
        );
      else if (item.fuel > 0)
        out.push(
          offer(
            "light",
            actor,
            id,
            null,
            `${nameOf(actor)} lights the Lamp${covered(s, id) ? " under its cloth" : ""}.`,
            [id],
          ),
        );
    }
    if (id === "bell" && !covered(s, id))
      out.push(
        offer(
          "ring",
          actor,
          id,
          null,
          `${nameOf(actor)} rings the Bell. The sound carries across the shore.`,
          [id],
        ),
      );
    if (
      id === "oil" &&
      item.doses > 0 &&
      s.items.lamp.fuel < 12 &&
      canUse(s, actor, "lamp") &&
      itemPlace(s, "lamp") === here
    ) {
      out.push(
        offer(
          "refill",
          actor,
          id,
          "lamp",
          `${nameOf(actor)} pours one dose of oil into the Lamp.`,
          [id, "lamp"],
        ),
      );
    }
    if (
      id === "cloth" &&
      canReach(s, actor, id) &&
      item.holder !== "lamp" &&
      item.holder !== "bell"
    ) {
      for (const target of ["lamp", "bell"].filter(
        (t) =>
          itemPlace(s, t) === here &&
          canReach(s, actor, t) &&
          (rootHolder(s, t) !== actor || hasSpace(s, actor, id)),
      )) {
        out.push(
          offer(
            "cover",
            actor,
            id,
            target,
            `${nameOf(actor)} covers the ${nameOf(target)} with the Black cloth.`,
            [id, target],
          ),
        );
      }
    }
  }
  const payments = ids.filter((id) => s.items[id].holder === actor);
  const tradePartners = new Set(
    payments.length
      ? knownActors(s).filter(
          (other) =>
            other !== actor &&
            !controlledByHuman(s, other) &&
            s.actors[other].place === here,
        )
      : [],
  );
  const tradeGoods = ids.filter((id) => tradePartners.has(s.items[id].holder));
  for (const give of payments)
    for (const receive of tradeGoods) {
      if (!tradePossible(s, actor, give, receive)) continue;
      const other = s.items[receive].holder;
      const action = offer(
        "trade",
        actor,
        give,
        other,
        `${nameOf(actor)} trades the ${nameOf(give)} for ${nameOf(other)}’s ${nameOf(receive)}.`,
        [give, receive],
      );
      action.receive = receive;
      action.key += ":" + receive;
      out.push(action);
    }
  out.push(...fixtureOffers(s, actor, sensesFor(s)), ...packChoices(s, actor));
  for (const action of out) {
    if (action.kind === "take" && things[s.items[action.item]?.holder])
      action.label = "Uncover";
    if (action.kind === "move") {
      const crossing = crossingBetween(here, action.target, s);
      if (crossing?.travelLabel) action.label = crossing.travelLabel;
    }
  }
  // Every Give and Trade is offered. While planning, residents only consider
  // the offers they expect the other side to accept.
  return planReads ? out.filter((a) => expects(s, a)) : out;
}
export function matchingActions(s, selected, actor = currentActor(s)) {
  const set = [...new Set(selected)].filter((id) => id !== actor);
  if (!set.length) return [];
  return legalActions(s, actor).filter(
    (a) =>
      Array.isArray(a.cards) &&
      a.cards.length === set.length &&
      set.every((id) => a.cards.includes(id)),
  );
}
function travelParty(s, actors, destination) {
  const from = s.actors[actors[0]].place;
  const through = !baseExits(s, from).includes(destination);
  // The legal action approves the whole party before any carried key moves.
  if (
    homeGates[from]?.opening &&
    homeRescueExit(s, from, actors[0]) === destination
  )
    s.locations[from].anchored = true;
  markCrossed(s, from, destination);
  for (const actor of actors) {
    if (through) s.actors[actor].crossed += 1;
    s.actors[actor].place = destination;
    for (const id of carried(s, actor))
      remember(s, id, `${nameOf(actor)} carried it to ${nameOf(destination)}.`);
  }
  moveTransport(s, from, destination);
  return through;
}
const travel = (s, actor, destination) => travelParty(s, [actor], destination);

// Trust has one source: someone gave me the item I wanted.
function trustGiver(s, recipient, item, giver) {
  if (!needed(s, recipient, item) || !s.actors[recipient].trust) return;
  s.actors[recipient].trust[giver] = Math.min(
    3,
    (s.actors[recipient].trust[giver] || 0) + 1,
  );
}
function perform(s, a, round = null, settle = []) {
  const who = nameOf(a.actor);
  const firstCrossing = actorIds.every((id) => s.actors[id].crossed === 0);
  const here = s.actors[a.actor].place;
  const witnesses = [
    ...actorIds.filter(
      (id) =>
        entityActive(s, id) &&
        s.actors[id].place === here &&
        (!controlledByHuman(s, id) || humanPresent(s, id)),
    ),
    ...ids.filter((id) => entityActive(s, id) && itemPlace(s, id) === here),
  ];
  const conflict = standoffFor(s, a.actor);
  if (conflict) {
    conflict.guarding[a.actor] = false;
    if (a.actor === conflict.defender) conflict.answered = true;
  }
  if (a.kind === "wait") {
    const learningStart = beginLearning(s, a);
    if (a.actor === currentActor(s)) calm(s, here, a.actor);
    // The player's wait is a committed play like any other.
    if (learningStart || a.actor === currentActor(s)) {
      addLog(s, "World", a.text, {
        kind: "action",
        actorId: a.actor,
        verb: "wait",
        witnesses,
      });
      if (learningStart) recordLearning(s, a, learningStart, s.log.at(-1));
    }
    return;
  }
  const learningStart = beginLearning(s, a);
  const holder = holderBefore(s, a);
  const usefulGift =
    a.kind === "give" &&
    (valueOf(s, a.target, a.item) >= 5 || needed(s, a.target, a.item));
  let text = a.text;
  let requestAccepted = false;
  let refusal = null;
  let affected = null,
    arrival = null,
    invitation = null;
  switch (a.kind) {
    case "use":
      remember(s, a.item, a.text);
      break;
    case "course":
      setCourse(s, here, a.target);
      break;
    case "choose":
      applyPackChoice(s, a);
      break;
    case "accompany": {
      const respondentConflict = standoffFor(s, a.target);
      if (respondentConflict) {
        respondentConflict.guarding[a.target] = false;
        if (respondentConflict.defender === a.target)
          respondentConflict.answered = true;
      }
      invitation = accompanyDecision(s, a.actor, a.target, a.destination, true);
      s.actors[a.actor].lastTalk = s.turn;
      if (invitation.accepted) {
        const visits = (s.invitedPlaces ??= {});
        visits[a.target] = [
          ...new Set([...(visits[a.target] || []), a.destination]),
        ].sort();
        const through = travelParty(s, [a.actor, a.target], a.destination);
        text += ` ${nameOf(a.target)} agrees. They travel together.`;
        if (through && firstCrossing)
          text += " Something on the far shore turns its head.";
      } else {
        text += ` ${nameOf(a.target)} declines the trip.`;
        refusal = invitation.reason;
      }
      break;
    }
    case "threaten":
      if (here === "pond") s.locations.pond.answer = null;
      s.standoffs.push({
        challenger: a.actor,
        defender: a.target,
        location: here,
        item: a.item,
        opened: s.turn,
        answered: false,
        resolve: { [a.actor]: 4, [a.target]: 4 },
        guarding: { [a.actor]: false, [a.target]: false },
        struck: { [a.actor]: false, [a.target]: false },
      });
      break;
    case "guard":
      conflict.guarding[a.actor] = true;
      break;
    case "attack": {
      const guarded = conflict.guarding[a.target];
      const damage = Math.max(
        1,
        strikePower(s, a.actor, a.target) - Number(guarded),
      );
      conflict.guarding[a.target] = false;
      conflict.struck[a.actor] = true;
      conflict.resolve[a.target] = Math.max(
        0,
        conflict.resolve[a.target] - damage,
      );
      text += ` ${guarded ? "The guard softens the blow. " : ""}${nameOf(a.target)} loses ${damage} resolve.`;
      if (conflict.resolve[a.target] === 0) {
        const dropped =
          conflict.item && rootHolder(s, conflict.item) === a.target
            ? conflict.item
            : ids.find(
                (id) =>
                  s.items[id].holder === a.target && needed(s, a.actor, id),
              );
        if (dropped) {
          transfer(
            s,
            dropped,
            here,
            `${nameOf(a.target)} yields the ${nameOf(dropped)}.`,
          );
          text += ` ${nameOf(a.target)} drops the ${nameOf(dropped)}.`;
        }
        const retreat = exits(s, here, a.target).find(
          (to) => !isCourse(s, here, to),
        );
        if (retreat) {
          markCrossed(s, here, retreat);
          s.actors[a.target].place = retreat;
          moveTransport(s, here, retreat);
          for (const id of carried(s, a.target))
            remember(
              s,
              id,
              `${nameOf(a.target)} retreated to ${nameOf(retreat)} with it.`,
            );
          text += ` ${nameOf(a.target)} retreats to ${nameOf(retreat)}. The standoff ends.`;
          arrival = {
            text: `${nameOf(a.target)} arrives at ${nameOf(retreat)} after yielding to ${who}.`,
            actorId: a.target,
            locationId: retreat,
            fromLocationId: here,
          };
        } else {
          text += ` ${nameOf(a.target)} yields here. The standoff ends.`;
        }
        closeStandoff(s, conflict);
      }
      break;
    }
    case "move":
      if (travel(s, a.actor, a.target) && firstCrossing)
        text += " Something on the far shore turns its head.";
      break;
    case "take":
      transfer(s, a.item, a.actor, a.text);
      break;
    case "drop":
      transfer(s, a.item, here, a.text);
      break;
    case "give":
    case "trade": {
      // A pack can make a gift the trigger of one authored choice.
      const gift = a.kind === "give" ? packGiveChoice(s, a) : null;
      if (gift) {
        requestAccepted = true;
        text = choiceText(applyPackChoice(s, gift, { mode: "give" }), a.actor);
        break;
      }
      requestAccepted = expects(s, a);
      if (!requestAccepted) {
        refusal = refusalReason(s, a);
        if (a.kind === "trade") refuseWant(s, a.actor, a.receive, wantAPI(s));
        text =
          a.kind === "give"
            ? `${who} offers the ${nameOf(a.item)} to ${nameOf(a.target)}.`
            : `${who} offers the ${nameOf(a.item)} for ${nameOf(a.target)}’s ${nameOf(a.receive)}.`;
        text += ` ${nameOf(a.target)} declines.`;
        break;
      }
      if (a.kind === "give") trustGiver(s, a.target, a.item, a.actor);
      transfer(s, a.item, a.target, a.text);
      if (a.kind === "trade") transfer(s, a.receive, a.actor, a.text);
      break;
    }
    case "light":
      if (
        s.opening &&
        !s.opening.crossed &&
        a.actor === "vale" &&
        here === "attic" &&
        s.items.lamp.holder === "attic"
      )
        transfer(
          s,
          "lamp",
          "vale",
          "Vale lifts the lamp as its light wakes the mirror.",
        );
      s.items.lamp.lit = true;
      remember(s, "lamp", a.text);
      break;
    case "snuff":
      s.items.lamp.lit = false;
      remember(s, "lamp", a.text);
      break;
    case "ring":
      // Any sound made here disturbs the residents resting here.
      for (const line of disturb(s, here)) text += ` ${line}`;
      if (a.fixture) {
        soundFixture(s, a.fixture);
        break;
      }

      s.locations.pond.answer =
        s.locations.pond.answer === "hush" ? null : s.locations.pond.answer;
      s.items.bell.ringing = 3;
      remember(s, "bell", a.text);
      if (here === "pond" && s.items.oil.doses === 0) {
        s.items.oil.doses = 1;
        s.locations.pond.answer = "call";
        affected = "oil";
        text +=
          " The pond answers. One measure of oil gathers in the empty flask.";
        remember(
          s,
          "oil",
          "The pond answers the bell with one measure of oil.",
        );
      }
      break;
    case "refill":
      s.items.oil.doses -= 1;
      s.items.lamp.fuel = Math.min(12, s.items.lamp.fuel + 4);
      remember(s, "oil", a.text);
      remember(s, "lamp", a.text);
      break;
    case "cover":
      transfer(s, "cloth", a.target, a.text);
      remember(s, a.target, a.text);
      if (a.target === "bell") s.items.bell.ringing = 0;
      break;
    case "talk": {
      const woken = wakeByVoice(s, a.target);
      if (woken) text += ` ${woken}`;
      s.actors[a.actor].lastTalk = s.turn;
      break;
    }
    case "ask": {
      const willing = willingToGive(s, a.target, a.item, a.actor);
      requestAccepted = willing;
      if (willing) {
        trustGiver(s, a.actor, a.item, a.target);
        text = `${nameOf(a.target)} hands the ${nameOf(a.item)} to ${who}.`;
        transfer(s, a.item, a.actor, text);
      } else {
        text += ` ${nameOf(a.target)} keeps it for now.`;
        refusal = refusalReason(s, a);
        refuseWant(s, a.actor, a.item, wantAPI(s));
      }
      s.actors[a.actor].lastTalk = s.turn;
      break;
    }
    default:
      throw new Error("Unknown act.");
  }
  const recitals =
    here !== s.actors[a.actor].place
      ? arriveRecitals(s, packDefinitions, a.actor)
      : [];
  meetCast(s);
  recordReaction(s, a, witnesses, requestAccepted);
  recordLifeAction(
    s,
    a,
    invitation?.accepted ?? requestAccepted,
    usefulGift && requestAccepted,
  );
  addLog(s, "World", text, {
    kind: "action",
    actorId: a.actor,
    verb: a.kind,
    ...(a.kind === "choose" ? { packId: a.packId, choiceId: a.choiceId } : {}),
    fromLocationId: here,
    witnesses,
    itemId: a.item,
    ...(affected ? { entityId: affected } : {}),
    targetId: a.target,
    ...(a.receive ? { receiveId: a.receive } : {}),
    ...(["ask", "give", "trade"].includes(a.kind)
      ? { accepted: requestAccepted }
      : {}),
    ...(refusal ? { reason: refusal } : {}),
    ...(invitation
      ? { destinationId: a.destination, accepted: invitation.accepted }
      : {}),
    ...(a.kind === "attack" ? { locationId: here } : {}),
  });
  if (a.kind === "talk") talkKnowledge(s, a, s.log.at(-1));
  recordLearning(s, a, learningStart, s.log.at(-1));
  for (const visit of recitals)
    addLog(
      s,
      "World",
      `${nameOf(visit.actorId)} waits here with a song of ${who}'s journey.`,
      {
        ...visit,
        kind: "narration",
        verb: "move",
        witnesses: [a.actor, visit.actorId],
      },
    );
  if (arrival) {
    const { text: arrivalText, ...details } = arrival;
    addLog(s, "World", arrivalText, details);
  }
  settleStandoffs(s);
  // A want met by this play is a world fact recorded right after it.
  settleWants(
    s,
    wantActors(s, [a.actor, ...(s.actors[a.target] ? [a.target] : []), ...settle]),
    wantAPI(s),
    a,
  );
  // Resolved plays, and only those, can advance a crossing's signal.
  if (round)
    noteAct(s, a, here, holder, round, sensesFor(s), (line, locationId) =>
      addLog(s, "World", line, { locationId }),
    );
  // Answering the request is the invited avatar's action for this round.
  return invitation ? a.target : null;
}

// Routes use the exits available to the actor who is planning the trip.
function routeBetween(s, from, target, actor = null) {
  const reads = planningReadsFor(s);
  if (!reads) return readRouteBetween(s, from, target, actor);
  const routes = (reads.routes ??= new Map());
  if (!routes.has(actor)) routes.set(actor, new Map());
  const origins = routes.get(actor);
  if (!origins.has(from)) origins.set(from, new Map());
  const destinations = origins.get(from);
  if (!destinations.has(target))
    destinations.set(target, readRouteBetween(s, from, target, actor));
  return destinations.get(target)?.slice();
}
function readRouteBetween(s, from, target, actor = null) {
  const queue = [[from]],
    visited = new Set([from]);
  while (queue.length) {
    const route = queue.shift();
    if (route.at(-1) === target) return route;
    const here = route.at(-1);
    const projected = s.actors[actor] && s.actors[actor].place !== here
      ? { ...s, actors: { ...s.actors, [actor]: { ...s.actors[actor], place: here } } }
      : s;
    const previous = route.at(-2) ?? (transportPlace(here) ? VOYAGE : null);
    for (const next of exits(projected, here, actor, previous))
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...route, next]);
      }
  }
}
// Aboard a ship, reaching a dock means setting a course toward it, waiting
// out the voyage, or stepping ashore once the ship has arrived.
function voyageAction(s, actor, dock, actions = legalActions(s, actor)) {
  const here = s.actors[actor].place;
  if (!transportPlace(here)) return undefined;
  const ashore = actions.find((a) => a.kind === "move" && a.target === dock);
  if (ashore) return ashore;
  const lane = courseToward(s, here, dock, actor);
  return (
    actions.find((a) => a.kind === "course" && a.target === lane) ||
    actions.find((a) => a.kind === "wait")
  );
}
function toward(s, actor, target) {
  const here = s.actors[actor].place;
  const route = routeBetween(s, here, target, actor);
  let actions;
  const getActions = () => (actions ??= legalActions(s, actor));
  if (route)
    return (
      getActions().find((a) => a.kind === "move" && a.target === route[1]) ||
      voyageAction(s, actor, route[1], getActions())
    );
  if (target === "attic" && !["attic", "pond", "station"].includes(here)) {
    const approach = routeBetween(s, here, "pond", actor);
    if (approach?.length > 1)
      return getActions().find((a) => a.kind === "move" && a.target === approach[1]);
  }
  if (target !== "attic" && atticInterior.has(target) && !atticInterior.has(here))
    return toward(s, actor, "attic");
  // Reach a home threshold before tending its gate or taking its rescue path.
  const rescueRoutes = new Map();
  const rescueRoute = (from) => {
    if (!rescueRoutes.has(from))
      rescueRoutes.set(from, routeBetween(s, from, target, actor));
    return rescueRoutes.get(from);
  };
  for (const [home, gate] of Object.entries(homeGates)) {
    if (here === home || !rescueRoute(gate.rescue)) continue;
    const approach = routeBetween(s, here, home, actor);
    if (approach?.length > 1)
      return getActions().find((a) => a.kind === "move" && a.target === approach[1]);
  }
  // Sound can reopen an outward crossing while the traveler stays on its shore.
  if (crossings.some((c) => c.from === here && !c.transport &&
    c.requires.some((r) => r.kind === "sound" && r.at.includes(here)) &&
    routeBetween(s, c.to, target, actor))) {
    const sound = getActions().find((a) => a.kind === "ring" && a.item === "bell");
    if (sound) return covered(s, "bell")
      ? getActions().find((a) => a.kind === "take" && a.item === "cloth")
      : sound;
  }
}
export function plan(s, actor = currentActor(s)) {
  const previousReads = planReads;
  planReads = new WeakMap();
  try {
    return readPlan(s, actor);
  } finally {
    planReads = previousReads;
  }
}
function readPlan(s, actor) {
  const arrival = transportArrival(s, actor);
  const landing =
    arrival &&
    legalActions(s, actor).find(
      (a) => a.kind === "move" && a.target === arrival,
    );
  if (landing)
    return { action: landing };
  const selected = wantPlan(s, actor);
  return reconsiderPlan(
    s,
    actor,
    selected,
    legalActions(s, actor).filter(
      (a) =>
        a.key === selected.action.key ||
        !["trade", "give"].includes(a.kind) ||
        (!needed(s, actor, a.item) && !keepReason(s, actor, a.item)),
    ),
  );
}
// One legal step toward a place. Travellers who learn the roads keep to
// the routes they know and explore the edge of that map; the others use
// the open routes and the plays that open them.
function stepToward(s, actor, target) {
  const known = s.routeKnowledge?.[actor];
  if (!known) return { action: toward(s, actor, target) || null };
  const here = s.actors[actor].place;
  const open = (from, to, previous) =>
    exits(s, from, actor, previous ?? (transportPlace(from) ? VOYAGE : null)).includes(to);
  let path =
    knownRoute(s, actor, here, target, open) ||
    knownRoute(s, actor, here, target);
  if (!path) {
    const frontiers = [...new Set(known.map(([, to]) => to))].filter(
      (to) =>
        to !== here &&
        entityActive(s, to) &&
        berthOpen(s, to) !== false &&
        !known.some(([from]) => from === to),
    );
    if (!entityActive(s, here)) frontiers.push(...exits(s, here, actor));
    path = frontiers
      .map((to) => knownRoute(s, actor, here, to))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length || a.at(-1).localeCompare(b.at(-1)))[0];
    if (!path) return { action: null };
  }
  const actions = legalActions(s, actor);
  const action =
    actions.find((a) => a.kind === "move" && a.target === path[1]) ||
    voyageAction(s, actor, path[1], actions);
  // Waiting at a port for the ship calls it one lane closer.
  return {
    action: action || null,
    ...(!action && transportPlace(path[1]) ? { callShip: true } : {}),
  };
}
// Pursue the want with the fixed verbs: go there, then ask, trade, threaten.
// A refusal is an outcome: it counts against the want, and enough of them
// set it aside.
function wantPlan(s, actor) {
  const acts = legalActions(s, actor);
  const find = (kind, test = () => true) =>
    acts.find((a) => a.kind === kind && test(a));
  const idle = () => ({ action: find("wait") || acts[0] });
  const here = s.actors[actor].place;
  if (s.peaceUntil[actor] > s.turn)
    return idle();
  const want = wantOf(s, actor);
  // A challenger whose want has moved on from the stake goes after its new
  // want, and leaving the room ends the standoff.
  const standoff = standoffFor(s, actor);
  const conflict =
    standoff &&
    standoff.challenger === actor &&
    standoff.item &&
    !standoff.struck[actor] &&
    !Object.values(standoff.struck).some(Boolean) &&
    !(want?.kind === "item" && want.target === standoff.item)
      ? null
      : standoff;
  if (conflict) {
    const other = opponentOf(conflict, actor);
    const answer = (action) => (action ? { action } : idle());
    if (actor === conflict.defender && !conflict.answered)
      return answer(
        levelOf(s, actor) > levelOf(s, other)
          ? find("talk", (a) => a.target === other)
          : find("guard")
      );
    if (conflict.struck[other] || conflict.struck[actor])
      return answer(find("attack", (a) => a.target === other));
    if (
      conflict.challenger === actor &&
      conflict.item &&
      needed(s, actor, conflict.item) &&
      s.turn - conflict.opened >= 2
    )
      return answer(
        find("attack", (a) => a.target === other)
      );
    return idle();
  }
  if (!want) return idle();
  if (resting(s, actor, homeOf(actor))) return idle();
  const go = (place) => {
    if (!travels(actor) || staysPut(actor)) return idle();
    const step = stepToward(s, actor, place);
    return step.action
      ? { action: step.action }
      : { ...idle(), ...(step.callShip ? { callShip: true } : {}) };
  };
  if (want.kind === "place") return here === want.target ? idle() : go(want.target);
  // A connector Talks once two connected humans share the room, and
  // otherwise visits one who is elsewhere.
  if (want.kind === "connect") {
    const humans = connectedHumans(s);
    const withMe = humans.filter((id) => s.actors[id].place === here);
    if (withMe.length >= 2) {
      const talk = find("talk", (a) => withMe.includes(a.target));
      return talk && s.turn - s.actors[actor].lastTalk >= 1
        ? { action: talk }
        : idle();
    }
    const away = humans.find((id) => s.actors[id].place !== here);
    return away ? go(s.actors[away].place) : idle();
  }
  if (want.kind === "person") {
    const there = s.actors[want.target]?.place;
    if (there !== here) return go(there);
    const talk = find("talk", (a) => a.target === want.target);
    return talk && s.turn - s.actors[actor].lastTalk >= 1
      ? { action: talk }
      : idle();
  }
  const item = want.target,
    owner = rootHolder(s, item);
  if (owner === actor) return idle();
  if (itemPlace(s, item) !== here) return go(itemPlace(s, item));
  let top = item;
  while (s.items[s.items[top].holder]) top = s.items[top].holder;
  const spares = (kind) =>
    acts
      .filter((a) => a.kind === kind && !needed(s, actor, a.item))
      .sort(
        (x, y) =>
          valueOf(s, actor, x.item) - valueOf(s, actor, y.item) ||
          x.item.localeCompare(y.item),
      );
  if (!actorIds.includes(owner)) {
    const take =
      find("take", (a) => a.item === top) || find("take", (a) => a.item === item);
    if (take) return { action: take };
    const drop = spares("drop")[0];
    return drop ? { action: drop } : idle();
  }
  const recent = (verb, test = () => true) =>
    s.log.some(
      (e) =>
        e.kind === "action" &&
        e.verb === verb &&
        e.actorId === actor &&
        e.targetId === owner &&
        s.turn - e.turn <= 4 &&
        test(e),
    );
  if (!hasSpace(s, actor, top)) {
    const drop = spares("drop")[0];
    if (drop) return { action: drop };
  }
  const ask = find("ask", (a) => a.item === top && a.target === owner);
  if (ask && !recent("ask")) return { action: ask };
  const trades = spares("trade").filter((a) => a.receive === top);
  const trade =
    trades.find((a) => expects(s, a)) ||
    trades.find((a) => !recent("trade", (e) => e.itemId === a.item));
  if (trade) return { action: trade };
  const bold =
    travels(actor) &&
    !avoidsStandoffs(actor) &&
    want.refusals >= 1 &&
    (resentment(s, actor, owner) > 0 ||
      want.refusals >= 2 ||
      levelOf(s, actor) > levelOf(s, owner));
  const threat = bold && find("threaten", (a) => a.target === owner);
  if (threat) return { action: threat };
  return idle();
}
export function play(
  s,
  action,
  expectedRevision = s.revision,
  actor = currentActor(s),
) {
  if (expectedRevision !== s.revision)
    return {
      ok: false,
      state: s,
      error: "The world changed. Choose a current play.",
    };
  const exact = legalActions(s, actor).find((a) => a.key === action?.key);
  if (!exact)
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  const next = structuredClone(s);
  if (actor !== "vale" || s.playerActorId) next.playerActorId = actor;
  // Crossings open before the play decide whether a signal refreshes them.
  const round = beginRound(s, sensesFor(s));
  next.turn += 1;
  next.revision += 1;
  const reflectionSource = next.actors[actor].place;
  const wasOpen = reflectionOpen(next, reflectionSource);
  const active = knownActors(next);
  const residents = [
    ...new Set([
      "moth",
      "keeper",
      ...active.filter((id) => id === BOARDY && !controlledByHuman(next, id)),
      ...active.filter(
        (id) =>
          isPackActor(id) &&
          !roamingQuestActor(id) &&
          entityActive(next, id) &&
          next.actors[id].place === next.actors[actor].place,
      ),
    ]),
  ];
  const respondent = perform(next, exact, round, residents);
  if (
    next.opening &&
    !next.locations.attic.anchored &&
    exact.kind === "light" &&
    next.actors.vale.place === "attic"
  ) {
    next.locations.attic.anchored = true;
  }
  for (const id of residents) {
    if (
      id === respondent ||
      !active.includes(id) ||
      controlledByHuman(next, id)
    )
      continue;
    perform(next, plan(next, id).action, round, residents);
  }
  if (next.items.lamp.lit) {
    next.items.lamp.fuel = Math.max(0, next.items.lamp.fuel - 1);
    if (next.items.lamp.fuel === 0) {
      next.items.lamp.lit = false;
      addLog(
        next,
        "World",
        "The Lamp runs dry. Its flame folds into a tiny black sun.",
        { locationId: itemPlace(next, "lamp") },
      );
    }
  }
  const rings = next.log.filter(
    (entry) =>
      entry.turn === next.turn &&
      entry.verb === "ring" &&
      entry.itemId === "bell" &&
      !entry.generated,
  );
  // A fresh ring lasts for three following plays. Covering the bell can still
  // silence it during this round. Other bells keep their own time.
  if (!rings.length)
    next.items.bell.ringing = Math.max(0, next.items.bell.ringing - 1);
  // Break unfinished signals and narrate crossings that opened or closed.
  endRound(next, round, sensesFor(next), (line, locationId) =>
    addLog(next, "World", line, { locationId }),
  );
  const isOpen = reflectionOpen(next, reflectionSource);
  if (wasOpen !== isOpen)
    addLog(
      next,
      "World",
      isOpen
        ? reflectionSource === "pond"
          ? "The pond's reflection opens a path to the attic."
          : "The attic mirror opens a path to the pond. A dark shore waits through the glass."
        : reflectionSource === "pond"
          ? "The pond's reflected path to the attic closes. The shore path to the station remains open."
          : "The attic mirror's path to the pond closes.",
      { locationId: reflectionSource },
    );
  // Travellers who learn the roads act every round, wherever they are.
  for (const id of roamingActors) {
    if (controlledByHuman(next, id) || id === respondent) continue;
    const from = next.actors[id].place;
    rememberRoutes(next, id, visibleRouteEdges(from));
    const chosen = plan(next, id);
    if (chosen.callShip) callTransport(next, from, true);
    if (chosen.action.kind !== "wait") perform(next, chosen.action, round, [id]);
    rememberRoutes(next, id, visibleRouteEdges(next.actors[id].place));
    if (next.actors[id].place !== from)
      arriveRoamingRecitals(next, packDefinitions, id);
  }
  if (exact.kind === "wait")
    waitForTransport(next, next.actors[actor].place, actor);
  for (const voyage of sailTransports(next)) {
    const ship = transports[voyage.id].place;
    addLog(
      next,
      "World",
      voyage.kind === "arrive"
        ? `${nameOf(ship)} docks at ${nameOf(voyage.dock)}.`
        : `${nameOf(ship)} ${voyage.idle ? "sails on its own" : "casts off"} for ${nameOf(voyage.to)}.`,
      { locationId: ship },
    );
  }
  reviseStalledWants(
    next,
    wantActors(next, [...residents, ...roamingActors]).filter(
      (id) => !controlledByHuman(next, id),
    ),
    wantAPI(next),
  );
  for (const [id, allowance] of Object.entries(
    next.sharedMigration?.inventoryAllowances || {},
  )) {
    const count = Math.min(allowance, carried(next, id).length);
    if (count <= 3) delete next.sharedMigration.inventoryAllowances[id];
    else next.sharedMigration.inventoryAllowances[id] = count;
  }
  validateWorld(next);
  return { ok: true, state: next };
}
export function validateWorld(s) {
  const fail = () => {
    throw new Error(
      "This save needs a fresh start. Your previous save is kept until you choose New game.",
    );
  };
  if (
    !s ||
    s.schema !== 7 ||
    !Number.isSafeInteger(s.turn) ||
    s.turn < 0 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < s.turn
  )
    fail();
  if (
    !validKnowledge(
      s,
      actorIds,
      Object.keys(places),
      authoredKnowledgeTopics(),
      laneFactText,
    )
  )
    fail();
  if (s.sharedMigration !== undefined) {
    const m = s.sharedMigration;
    if (
      !sharedEnabled(s) ||
      !m ||
      m.version !== 1 ||
      Object.keys(m).some(
        (key) =>
          !["version", "legacyTurn", "uses", "inventoryAllowances"].includes(
            key,
          ),
      ) ||
      !Number.isSafeInteger(m.legacyTurn) ||
      m.legacyTurn < 0 ||
      m.legacyTurn > 4294967295 ||
      !Array.isArray(m.uses) ||
      m.uses.length !== 8 ||
      m.uses.some((n) => !Number.isInteger(n) || n < 0 || n > 2147483647) ||
      (m.inventoryAllowances !== undefined &&
        (!m.inventoryAllowances ||
          Array.isArray(m.inventoryAllowances) ||
          typeof m.inventoryAllowances !== "object" ||
          Object.entries(m.inventoryAllowances).some(
            ([id, n]) =>
              !humanAvatar(id) || !Number.isInteger(n) || n < 4 || n > 8,
          )))
    )
      fail();
  }
  if (s.playerActorId !== undefined && !humanAvatar(s.playerActorId)) fail();
  for (const field of ["controlledActors", "presentActors"]) {
    if (
      s[field] !== undefined &&
      (!Array.isArray(s[field]) ||
        s[field].length > 8 ||
        new Set(s[field]).size !== s[field].length ||
        s[field].some((id) => !humanAvatar(id)))
    )
      fail();
  }
  if (
    s.presentActors &&
    (!s.controlledActors ||
      s.presentActors.some((id) => !s.controlledActors.includes(id)))
  )
    fail();
  if (s.opening !== undefined) {
    const o = s.opening;
    if (
      !o ||
      ![1, 2].includes(o.version) ||
      typeof o.crossed !== "boolean" ||
      !o.met ||
      o.met.vale !== 0 ||
      Object.keys(o.met).some((id) => !actorIds.includes(id)) ||
      Object.values(o.met).some(
        (turn) => !Number.isSafeInteger(turn) || turn < 0 || turn > s.turn,
      ) ||
      (!sharedEnabled(s) &&
        o.met.keeper !== undefined &&
        o.met.moth === undefined) ||
      (!o.crossed &&
        (!Object.entries(homeGates).some(
          ([place, gate]) =>
            gate.opening &&
            [place, gate.rescue, "station"].includes(s.actors?.vale?.place),
        ) ||
          Object.keys(o.met).some(
            (id) => id !== "vale" && !roamingActors.includes(id),
          ))) ||
      (o.version === 1 && o.crossed && !s.locations?.attic.anchored) ||
      (o.crossed && o.met.moth === undefined) ||
      (o.version === 2 && !o.crossed)
    )
      fail();
  }
  if (
    Object.keys(s.actors || {})
      .sort()
      .join() !== actorIds.slice().sort().join() ||
    Object.keys(s.items || {})
      .sort()
      .join() !== ids.slice().sort().join()
  )
    fail();
  if (
    s.invitedPlaces !== undefined &&
    (!s.invitedPlaces ||
      typeof s.invitedPlaces !== "object" ||
      Array.isArray(s.invitedPlaces) ||
      Object.entries(s.invitedPlaces).some(
        ([actor, visits]) =>
          !actorIds.includes(actor) ||
          !Array.isArray(visits) ||
          visits.length > Object.keys(places).length ||
          new Set(visits).size !== visits.length ||
          visits.some((place) => !Object.hasOwn(places, place)),
      ))
  )
    fail();
  if (!validPackState(s, sensesFor(s))) fail();
  if (
    !validRouteKnowledge(s, [...authoredRouteEdges(), ...laneEdges()]) ||
    !validMemories(s) ||
    !validMotives(s) ||
    !validLife(s, Object.keys(places))
  )
    fail();
  if (
    !s.locations ||
    typeof s.locations.attic?.anchored !== "boolean" ||
    ![null, "call", "hush"].includes(s.locations.pond?.answer)
  )
    fail();
  if (
    !s.peaceUntil ||
    Object.keys(s.peaceUntil).sort().join() !==
      actorIds.slice().sort().join() ||
    Object.values(s.peaceUntil).some(
      (turn) => !Number.isSafeInteger(turn) || turn < 0 || turn > s.turn + 3,
    ) ||
    !Array.isArray(s.standoffs) ||
    s.standoffs.length > Math.floor(actorIds.length / 2)
  )
    fail();
  const fighting = new Set();
  for (const c of s.standoffs) {
    if (
      !c ||
      !actorIds.includes(c.challenger) ||
      !actorIds.includes(c.defender) ||
      c.challenger === c.defender ||
      !Object.hasOwn(places, c.location) ||
      (c.item !== null && !ids.includes(c.item)) ||
      typeof c.answered !== "boolean" ||
      !Number.isSafeInteger(c.opened) ||
      c.opened < 1 ||
      c.opened > s.turn
    )
      fail();
    const pair = [c.challenger, c.defender];
    if (pair.some((id) => fighting.has(id))) fail();
    for (const id of pair) fighting.add(id);
    if (
      pair.some(
        (id) => s.actors[id].place !== c.location || s.peaceUntil[id] > s.turn,
      ) ||
      (c.item && rootHolder(s, c.item) !== c.defender)
    )
      fail();
    for (const field of ["resolve", "guarding", "struck"])
      if (
        !c[field] ||
        Object.keys(c[field]).sort().join() !== pair.slice().sort().join()
      )
        fail();
    if (
      pair.some(
        (id) =>
          !Number.isInteger(c.resolve[id]) ||
          c.resolve[id] < 1 ||
          c.resolve[id] > 4 ||
          typeof c.guarding[id] !== "boolean" ||
          typeof c.struck[id] !== "boolean",
      )
    )
      fail();
  }
  for (const [id, a] of Object.entries(s.actors)) {
    if (
      !a.trust ||
      Object.keys(a.trust).sort().join() !== expectedTrustKeys[id] ||
      Object.values(a.trust).some((n) => !Number.isInteger(n) || n < 0 || n > 3)
    )
      fail();
    if (
      !Object.hasOwn(places, a.place) ||
      !actorCanVisit(id, a.place, s) ||
      (entityActive(s, id) && !entityActive(s, a.place)) ||
      !Number.isSafeInteger(a.crossed) ||
      a.crossed < 0 ||
      !Number.isSafeInteger(a.lastTalk) ||
      a.lastTalk > s.turn
    )
      fail();
    if (
      !validWant(s, id) ||
      a.visited.length > Object.keys(places).length ||
      a.visited.some((place) => !Object.hasOwn(places, place)) ||
      (a.want?.kind === "place" && !Object.hasOwn(places, a.want.target))
    )
      fail();
  }

  for (const [id, item] of Object.entries(s.items)) {
    if (
      ![
        ...actorIds,
        ...Object.keys(places),
        ...(id === "cloth" ? ["lamp", "bell"] : []),
      ].includes(item.holder)
    )
      fail();
    if (
      entityActive(s, id) &&
      (!entityActive(s, item.holder) || !entityActive(s, itemPlace(s, id)))
    )
      fail();
    if (
      !Array.isArray(item.history) ||
      item.history.length > 12 ||
      item.history.some((t) => typeof t !== "string" || t.length > 400)
    )
      fail();
  }
  for (const actor of actorIds) {
    const allowance = s.sharedMigration?.inventoryAllowances?.[actor];
    const count = carried(s, actor).length;
    if (count > (allowance || 3) || (allowance && allowance !== count)) fail();
  }
  const lamp = s.items.lamp,
    oil = s.items.oil,
    bell = s.items.bell;
  if (
    !Number.isInteger(lamp.fuel) ||
    lamp.fuel < 0 ||
    lamp.fuel > 12 ||
    typeof lamp.lit !== "boolean" ||
    (lamp.lit && lamp.fuel === 0)
  )
    fail();
  if (
    !Number.isInteger(oil.doses) ||
    oil.doses < 0 ||
    oil.doses > 3 ||
    !Number.isInteger(bell.ringing) ||
    bell.ringing < 0 ||
    bell.ringing > 3 ||
    (covered(s, "bell") && bell.ringing > 0)
  )
    fail();
  const signal = s.locations.pond.shipSignal;
  if (
    signal !== undefined &&
    (!Number.isInteger(signal) || signal < 0 || signal > 4)
  )
    fail();
  if (
    !Array.isArray(s.log) ||
    s.log.filter((e) => !e?.generated).length > LOG_LIMIT ||
    s.log.filter((e) => e?.generated).length > GENERATED_LOG_LIMIT ||
    s.log.some(
      (e) =>
        !Number.isSafeInteger(e.turn) ||
        e.turn < 0 ||
        e.turn > s.turn ||
        typeof e.text !== "string" ||
        e.text.length > 600 ||
        typeof e.speaker !== "string" ||
        e.speaker.length > 40,
    )
  )
    fail();
  if (
    s.eventSeq !== undefined &&
    (!Number.isSafeInteger(s.eventSeq) || s.eventSeq < s.log.length)
  )
    fail();
  if (
    s.arrival !== undefined &&
    (!s.arrival ||
      !Number.isSafeInteger(s.arrival.seq) ||
      s.arrival.seq < 1 ||
      s.arrival.seq > s.eventSeq ||
      !Object.hasOwn(places, s.arrival.fromLocationId) ||
      !Object.hasOwn(places, s.arrival.locationId) ||
      s.arrival.fromLocationId === s.arrival.locationId)
  )
    fail();
  let seq = 0;
  const verbs = [
    "want_met",
    "accompany",
    "threaten",
    "guard",
    "attack",
    "move",
    "course",
    "take",
    "drop",
    "give",
    "ask",
    "light",
    "snuff",
    "ring",
    "refill",
    "cover",
    "talk",
    "wait",
    "trade",
    "choose",
    "use",
  ];
  for (const e of s.log) {
    if (e.seq !== undefined) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= seq || e.seq > s.eventSeq)
        fail();
      seq = e.seq;
    }
    if (
      e.kind !== undefined &&
      !["action", "dialogue", "narration", "input", "hint"].includes(
        e.kind,
      )
    )
      fail();
    if (
      e.witnesses !== undefined &&
      (!Array.isArray(e.witnesses) ||
        e.witnesses.length > actorIds.length + ids.length ||
        e.witnesses.some((id) => ![...actorIds, ...ids].includes(id)))
    )
      fail();
    if (
      e.entityId != null &&
      ![...actorIds, ...ids, ...Object.keys(places)].includes(e.entityId)
    )
      fail();
    if (e.fromLocationId != null && !Object.hasOwn(places, e.fromLocationId))
      fail();
    if (e.generated !== undefined && e.generated !== true) fail();
    for (const field of ["departureTo", "arrivalFrom"])
      if (
        e[field] !== undefined &&
        (!e.generated ||
          e.kind !== "dialogue" ||
          !actorIds.includes(e.actorId) ||
          !Object.hasOwn(places, e[field]) ||
          e[field] === e.locationId)
      )
        fail();
    if (e.departureTo && e.arrivalFrom) fail();
    if (e.actorId != null && !actorIds.includes(e.actorId)) fail();
    if (e.locationId != null && !Object.hasOwn(places, e.locationId)) fail();
    if (e.verb != null && !verbs.includes(e.verb)) fail();
    if (e.verb === "choose") {
      const pack = packDefinition(e.packId),
        choice = pack?.choices.find((c) => c.id === e.choiceId);
      if (
        !choice ||
        !humanAvatar(e.actorId) ||
        e.targetId !== choice.subject ||
        e.locationId !== choice.at ||
        s.packs[e.packId].receipts[e.choiceId] !== e.turn
      )
        fail();
    } else if (e.packId !== undefined || e.choiceId !== undefined) fail();
    if (e.destinationId != null && !Object.hasOwn(places, e.destinationId))
      fail();
    if (e.accepted !== undefined && typeof e.accepted !== "boolean") fail();
    if (
      e.reason !== undefined &&
      (!REFUSED_VERBS.includes(e.verb) ||
        e.accepted !== false ||
        !REFUSAL_REASONS.includes(e.reason))
    )
      fail();
    if (
      e.verb === "accompany" &&
      (!actorIds.includes(e.actorId) ||
        !actorIds.includes(e.targetId) ||
        e.targetId === e.actorId ||
        !Object.hasOwn(places, e.destinationId) ||
        !Object.hasOwn(places, e.fromLocationId) ||
        e.destinationId === e.fromLocationId ||
        typeof e.accepted !== "boolean" ||
        e.locationId !== (e.accepted ? e.destinationId : e.fromLocationId))
    )
      fail();
    if (e.itemId != null && !ids.includes(e.itemId)) fail();
    if (e.receiveId != null && !ids.includes(e.receiveId)) fail();
    if (
      (e.verb === "want_met") !== (e.wantMet !== undefined) ||
      (e.wantMet !== undefined &&
        (!e.wantMet ||
          Object.keys(e.wantMet).length !== 2 ||
          !WANT_KINDS.includes(e.wantMet.kind) ||
          !actorIds.includes(e.actorId) ||
          (e.wantMet.kind === "connect"
            ? e.wantMet.target !== CONNECT_TARGET
            : ![...actorIds, ...ids, ...Object.keys(places)].includes(
                e.wantMet.target,
              ))))
    )
      fail();
    if (
      e.targetId != null &&
      ![...actorIds, ...ids, ...Object.keys(places)].includes(e.targetId)
    )
      fail();
    if (e.light !== undefined && typeof e.light !== "boolean") fail();
    if (
      e.cast !== undefined &&
      (!Array.isArray(e.cast) ||
        e.cast.length > actorIds.length ||
        new Set(e.cast).size !== e.cast.length ||
        e.cast.some((id) => !actorIds.includes(id)))
    )
      fail();
    if (
      e.items !== undefined &&
      (!Array.isArray(e.items) ||
        e.items.length > ids.length ||
        e.items.some(
          (item) =>
            !item ||
            !ids.includes(item.id) ||
            ![...actorIds, ...ids, ...Object.keys(places)].includes(
              item.holder,
            ),
        ))
    )
      fail();
  }
  return s;
}
export const encodeSave = (s) => JSON.stringify(validateWorld(s));
export function decodeSave(text) {
  const s = JSON.parse(text);
  upgradeSave(s, { actorIds, installPacks });
  validateWorld(s);
  preserveTransportAccess(s);
  return validateWorld(s);
}
