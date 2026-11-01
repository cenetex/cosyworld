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
  offerLevelQuest,
  dropLevelQuest,
  levelOf,
  wantOf,
  travels,
  resting,
  settleWants,
  refuseWant,
  reviseStalledWants,
  fillWants,
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
  packWaitChoice,
  applyDeparture,
  departureWaits,
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
  conditionMet,
  DAYLIGHT_TURNS,
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
  laneConditions,
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
import { installSpecials, validSeed } from "./pack-specials.mjs";
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
  const found = new Set(["attic"]),
    queue = ["attic"];
  const routes = packDefinitions.flatMap((pack) => pack.routes || []);
  for (let i = 0; i < queue.length && i < Object.keys(places).length; i++) {
    const from = queue[i];
    for (const to of [
      ...places[from].exits,
      ...crossings
        .filter((c) => c.from === from && !c.transport)
        .map((c) => c.to),
      ...routes.filter((r) => r.from === from).map((r) => r.to),
    ]) {
      if (to === "pond" || found.has(to)) continue;
      found.add(to);
      queue.push(to);
    }
  }
  return found;
})();
const ids = Object.keys(things);
const actorIds = [...Object.keys(forest.people), ...packActorIds];
// Fixed at load, so validation compares against these instead of rebuilding.
const placeIds = Object.keys(places);
const sortedActorKeys = actorIds.slice().sort().join();
const sortedItemKeys = ids.slice().sort().join();
const castIds = new Set([...actorIds, ...ids]);
const entityIds = new Set([...castIds, ...placeIds]);
const holderIds = new Set([...actorIds, ...placeIds]);
const LOG_KINDS = ["action", "dialogue", "narration", "input", "hint"];
const OUTCOMES = ["hit", "guarded", "yield", "sent-home"];
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
// A run seed draws each pack's specials once (pack-specials.mjs).
export function createWorld({ opening = false, packScopes = {}, seed } = {}) {
  const world = {
    schema: 7,
    ...structuredClone(forest.initialState),
    memories: newMemories(),
    turn: 0,
    revision: 0,
    eventSeq: 1,
  };
  if (seed != null && !validSeed(seed)) throw new Error("Choose a run seed.");
  if (seed != null) world.run = { seed };
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
  // A new world starts with one want on every avatar but a player still
  // waiting for its first quest.
  fillWants(world, wantAPI(world), true);
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
  // A hub item added after this save was written joins it where it starts.
  for (const [id, item] of Object.entries(forest.initialState.items))
    if (!Object.hasOwn(s.items, id)) {
      s.items[id] = structuredClone(item);
      s.memories[id] ??= fresh[id];
    }
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
  for (const pack of packDefinitions) installSpecials(s, pack);
  installLife(s, travels);
  installRouteKnowledge(s);
  installWants(s);
}
// A world saved before runs had seeds takes one once, from its host.
export function seedRun(s, seed) {
  if (s.run || !validSeed(seed)) return s;
  s.run = { seed };
  installPacks(s);
  return s;
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
// Holder chains are a few links deep, so the walk tracks visits only when a
// chain runs long enough to hide a loop: the common case allocates nothing.
const SHORT_CHAIN = 32;
export function rootHolder(s, id) {
  let holder = s.items[id].holder;
  for (let step = 0; step < SHORT_CHAIN; step++) {
    if (!s.items[holder]) return holder;
    if (holder === id) throw new Error("An item holds itself.");
    holder = s.items[holder].holder;
  }
  holder = s.items[id].holder;
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
// A reflection opens while its authored conditions hold (#1600). Forest data
// opens the attic mirror once the lamp there is dark, and the pond's way back
// while the lamp shines on the shore.
const reflectionsFrom = (s, from) =>
  (forest.reflectionRoutes || [])
    .filter(
      (r) =>
        r.from === from && r.requires.every((c) => conditionMet(s, c, null)),
    )
    .map((r) => r.to);
export const reflectionOpen = (s, from = itemPlace(s, "lamp")) =>
  reflectionsFrom(s, from).length > 0;
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
    place === "attic" && reflectionOpen(s, place)
      ? "A tall mirror opens onto a black shore. A path leads through the glass."
      : s.opening && place === "station"
        ? "The timetable lists years that have yet to happen. A path leads along the shore to the pond."
        : places[place].text,
    ...crossingScenery(s, place, sensesFor(s)),
    ...transportScenery(s, place, nameOf),
    ...(homeRescueExit(s, place) || pondRescueExit(s, place)
      ? [
          `A narrow path leads to ${nameOf(homeRescueExit(s, place) || pondRescueExit(s, place))}.`,
        ]
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
  // Holding a full flask with the empty lamp refuels it, so a flask here is enough.
  return Boolean(gate.fuel && localGateResource(s, place, gate.fuel, actor));
}
function ordinaryExits(s, place, actor, previous) {
  return [
    ...new Set([
      ...baseExits(s, place),
      ...reflectionsFrom(s, place),
      ...crossingExits(s, place, actor, sensesFor(s)),
      ...transportExits(s, place, previous, actor),
      ...packExits(s, place, actor),
    ]),
  ];
}
// A doorway into another part of the same isolated home still needs a way out.
// Capacity is checked when traveling, so a crowded shore remains a waiting case.
function ordinaryRouteHome(s, place, destination, actor, previous) {
  const queue = [[place, previous]],
    visited = new Set([place]);
  for (let i = 0; i < queue.length; i++) {
    const [from, before] = queue[i];
    if (from === destination) return true;
    for (const to of ordinaryExits(s, from, actor, before)) {
      if (
        visited.has(to) ||
        !entityActive(s, to) ||
        !actorCanVisit(actor, to, s)
      )
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
      homeOf(actor) === place ||
      (gate.opening && knownActors(s).includes(actor))) &&
    s.actors[actor]?.place === place &&
    !ordinaryRouteHome(s, place, gate.rescue, actor, previous) &&
    !homeGateRecoverable(s, place, gate, actor)
    ? gate.rescue
    : null;
}
function insideLampRemedy(s, actor) {
  const here = s.actors[actor].place,
    lamp = itemPlace(s, "lamp"),
    oil = itemPlace(s, "oil");
  if (
    !atticInterior.has(here) ||
    !ordinaryRouteHome(s, here, lamp, actor) ||
    !ordinaryRouteHome(s, lamp, "attic", actor)
  )
    return false;
  const at = (place) => ({
    ...s,
    actors: { ...s.actors, [actor]: { ...s.actors[actor], place } },
  });
  if (!localGateResource(at(lamp), lamp, "lamp", actor)) return false;
  return (
    s.items.lamp.fuel > 0 ||
    (ordinaryRouteHome(s, here, oil, actor) &&
      ordinaryRouteHome(s, oil, lamp, actor) &&
      localGateResource(at(oil), oil, "oil", actor))
  );
}
// Recover a gate resource left beyond the mirror after reachable remedies are gone.
function pondRescueExit(s, place, actor, previous) {
  actor ||= currentActor(s);
  const lamp = itemPlace(s, "lamp"),
    oil = itemPlace(s, "oil");
  // The flask is always full; it matters while it is shut inside with the lamp empty.
  if (
    place !== "pond" ||
    s.actors[actor]?.place !== place ||
    (!controlledByHuman(s, actor) && !knownActors(s).includes(actor)) ||
    !(atticInterior.has(lamp) || atticInterior.has(oil)) ||
    ordinaryRouteHome(s, place, "attic", actor, previous)
  )
    return null;
  if (
    ordinaryRouteHome(s, place, lamp, actor, previous) &&
    (s.items.lamp.fuel > 0 || ordinaryRouteHome(s, place, oil, actor, previous))
  )
    return null;
  if (
    knownActors(s).some(
      (id) =>
        (!controlledByHuman(s, id) || humanPresent(s, id)) &&
        (insideLampRemedy(s, id) ||
          (!atticInterior.has(lamp) &&
            s.actors[id].place === "attic" &&
            homeRescueExit(s, "attic", id) &&
            localGateResource(s, "attic", "oil", id))),
    )
  )
    return null;
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
  const step = want.step,
    what = nameOf(want.target),
    // Players see Strike for the attack play.
    verb = step?.verb === "attack" ? "strike" : step?.verb;
  if (step?.verb === "give") return `give ${what} to ${nameOf(step.to)}`;
  if (step?.verb === "bring")
    return `bring ${what} to ${nameOf(step.to)} at ${nameOf(step.at)}`;
  if (step?.at) return `${verb} ${what} at ${nameOf(step.at)}`;
  if (step) return `${verb} ${what}`;
  if (want.kind === "item")
    return `hold ${want.lit === undefined ? "" : want.lit ? "the lit " : "the dark "}${nameOf(want.target)}`;
  if (want.kind === "place") return `go to ${nameOf(want.target)}`;
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
  if (
    a.kind === "ask" &&
    (needed(s, other, a.item) || keepReason(s, other, a.item))
  )
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
const homeOf = (id) => tastes[id]?.home || humanAvatar(id)?.home?.id || null;
function wantAPI(s) {
  return {
    carried: (actor) => carried(s, actor),
    rootHolder: (item) => rootHolder(s, item),
    valueOf: (actor, item) => valueOf(s, actor, item),
    // A resident holding the item directly would give it, or take something
    // the actor carries in trade. A human holder or a nested item may yet.
    obtainable: (actor, item) => {
      const owner = s.items[item].holder;
      return (
        !actorIds.includes(owner) ||
        controlledByHuman(s, owner) ||
        willingToGive(s, owner, item, actor) ||
        carried(s, actor).some(
          (give) => give !== item && tradeWilling(s, actor, give, item),
        )
      );
    },
    reachable: (actor) => reachable(s, actor),
    home: homeOf,
    sanctuaries,
    player: (id) => id === currentActor(s) || controlledByHuman(s, id),
    questsBeginAt: forest.questsBeginAt,
    placeOf: (item) => itemPlace(s, item),
    distance: (from, to, actor) =>
      from === to ? 0 : (routeBetween(s, from, to, actor)?.length ?? 0) - 1,
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
          travels(id, s) &&
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
    (["move", "retreat", "sent-home"].includes(entry.verb) ||
      (entry.verb === "accompany" && entry.accepted))
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
    if (
      lane &&
      !port &&
      reserveLaneKnowledge(s, speaker, listener, entry, lane)
    )
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
        from === near && entityActive(s, to) && knowsLane(s, actor, from, to),
    )
    .map(([, to]) => nameOf(to));
  return known.length
    ? [`I know ships sail from ${nameOf(near)} to ${known.join(" and ")}.`]
    : [`I know of no ship lane from ${nameOf(near)}.`];
}
// A gated lane is told with its condition; telling it never opens it. A
// named thing is told by name; a world's things as "something from there".
const laneNeed = (gate) =>
  [
    ...new Set(
      gate.map((c) => (c.item ? nameOf(c.item) : "something from there")),
    ),
  ].join(" and ");
export const laneFact = (from, to) => {
  const gate = laneConditions(from, to);
  return {
    id: `lane:${from}>${to}`,
    text: gate
      ? `Ships for ${nameOf(to)} leave from ${nameOf(from)} only with ${laneNeed(gate)} aboard.`
      : `Ships for ${nameOf(to)} leave from ${nameOf(from)}.`,
  };
};
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
  // An unnamed id has no name to stand for I or you.
  const named = (id) => (nameOf(id) === "the world" ? null : nameOf(id));
  const learned = acceptKnowledgeSpeech(s, entry, disclosures, named);
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
const LAMP_FUEL = 12;
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
// A fuel item fills its empty target when one avatar holds both, then returns
// full to its authored place. Forest data names the pair (oil refuels lamp).
const fuelItems = Object.keys(forest.things).filter(
  (id) => forest.things[id].refuels,
);
function refuelCarried(s) {
  for (const id of fuelItems) {
    const { refuels: target, returnsTo } = things[id];
    const actor = rootHolder(s, id);
    if (
      !s.actors[actor] ||
      rootHolder(s, target) !== actor ||
      s.items[target].fuel !== 0 ||
      !entityActive(s, id) ||
      !entityActive(s, target)
    )
      continue;
    const here = s.actors[actor].place;
    const text = `${nameOf(actor)} empties the ${nameOf(id)} into the dry ${nameOf(target)}. The ${nameOf(target)} is full. Back at ${nameOf(returnsTo)}, the ${nameOf(id)} stands full again.`;
    s.items[target].fuel = LAMP_FUEL;
    remember(s, target, text);
    transfer(s, id, returnsTo, text);
    addLog(s, "World", text, {
      kind: "narration",
      verb: "refuel",
      actorId: actor,
      itemId: id,
      targetId: target,
      itemIds: [id, target],
      locationId: here,
      returnLocationId: returnsTo,
    });
  }
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
// Consecutive defeats per avatar. A win or a rest at home clears the count;
// the third defeat sends the loser home with empty hands.
export const DEFEATS_TO_SEND_HOME = 3;
// A loss at zero resolve. The first two drop the disputed item and fall back
// along an open path. The third drops everything the loser carries where they
// fell and puts them at home. Being sent home is not a crossing.
function defeatInStandoff(s, c, winner, loser, here) {
  const defeats = (s.defeats ??= {});
  delete defeats[winner];
  const lossCount = (defeats[loser] || 0) + 1;
  const home = homeOf(loser);
  const sentHome =
    lossCount >= DEFEATS_TO_SEND_HOME &&
    Boolean(home) &&
    entityActive(s, home) &&
    actorCanVisit(loser, home, s);
  const dropped = sentHome
    ? ids.filter((id) => s.items[id].holder === loser)
    : [
        c.item && rootHolder(s, c.item) === loser
          ? c.item
          : ids.find(
              (id) => s.items[id].holder === loser && needed(s, winner, id),
            ),
      ].filter(Boolean);
  let text = "";
  for (const id of dropped)
    transfer(s, id, here, `${nameOf(loser)} yields the ${nameOf(id)}.`);
  if (dropped.length)
    text += ` ${nameOf(loser)} drops the ${dropped.map(nameOf).join(", the ")}.`;
  if (lossCount >= DEFEATS_TO_SEND_HOME) delete defeats[loser];
  else defeats[loser] = lossCount;
  const outcome = sentHome ? "sent-home" : "yield";
  const to = sentHome
    ? home
    : exits(s, here, loser).find((next) => !isCourse(s, here, next));
  closeStandoff(s, c);
  if (!to || to === here) {
    text += sentHome
      ? ` ${nameOf(loser)} is already home. The standoff ends.`
      : ` ${nameOf(loser)} yields here. The standoff ends.`;
    return { text, outcome, lossCount, droppedItemIds: dropped, to: null };
  }
  // A retreat walks an open path; being sent home crosses nothing.
  if (!sentHome) markCrossed(s, here, to);
  s.actors[loser].place = to;
  moveTransport(s, here, to);
  for (const id of carried(s, loser))
    remember(s, id, `${nameOf(loser)} retreated to ${nameOf(to)} with it.`);
  text += sentHome
    ? ` ${nameOf(loser)} is beaten a third time and sent home to ${nameOf(to)}. The standoff ends.`
    : ` ${nameOf(loser)} retreats to ${nameOf(to)}. The standoff ends.`;
  return {
    text,
    outcome,
    lossCount,
    droppedItemIds: dropped,
    to,
    arrivalText: sentHome
      ? `${nameOf(loser)} arrives home at ${nameOf(to)} with empty hands after a third defeat by ${nameOf(winner)}.`
      : `${nameOf(loser)} arrives at ${nameOf(to)} after yielding to ${nameOf(winner)}.`,
  };
}
function settleStandoffs(s) {
  for (const c of [...s.standoffs]) {
    const separated = [c.challenger, c.defender].some(
      (id) => s.actors[id].place !== c.location,
    );
    const released = c.item && rootHolder(s, c.item) !== c.defender;
    // A resident challenger that has set the disputed item aside before
    // any blow would only stand there; it lets the item go.
    const forgone =
      c.item &&
      !controlledByHuman(s, c.challenger) &&
      !Object.values(c.struck).some(Boolean) &&
      !needed(s, c.challenger, c.item);
    if (separated || released || forgone) {
      closeStandoff(s, c);
      addLog(
        s,
        "World",
        separated
          ? `${nameOf(c.challenger)} and ${nameOf(c.defender)} part. The standoff ends.`
          : released
            ? `The ${nameOf(c.item)} changes hands. The standoff ends.`
            : `${nameOf(c.challenger)} lets the ${nameOf(c.item)} go. The standoff ends.`,
        {
          kind: "narration",
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
  if (
    goal &&
    (goal === destination || distance(destination, goal) < distance(here, goal))
  )
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
  // A sleeper's only play is to wait until the light changes.
  if (s.actors[actor].sleepUntil !== undefined) return out;
  // A level quest can be dropped, at the cost of half the experience.
  if (s.actors[actor].want?.quest)
    out.push(
      offer("drop", actor, null, null, `${nameOf(actor)} drops the quest.`, []),
    );
  for (const to of packPeople[actor]?.journey ? [] : exits(s, here, actor)) {
    if (departureWaits(s, actor, to)) continue;
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
      ? ` ${homeRescueExit(s, here, actor) === to || pondRescueExit(s, here, actor) === to ? "along a narrow path" : crossing?.travel || "through the reflection"}`
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
        (!staysPut(id, s) || packJourneyDestination(s, id) === to) &&
        !departureWaits(s, id, to) &&
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
      );
      // A sanctuary allows a threat but never an attack.
      if (!sanctuaries.includes(here))
        out.push(
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
        (p) => p !== actor && s.actors[p].place === here && hasSpace(s, p, id),
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
  // Leaving the opening home anchors it, by its rescue path or through a
  // mirror the doused lamp opened (#1600).
  if (
    homeGates[from]?.opening &&
    (s.opening || homeRescueExit(s, from, actors[0]) === destination)
  )
    s.locations[from].anchored = true;
  markCrossed(s, from, destination);
  for (const actor of actors) applyDeparture(s, actor, destination);
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
// Wait is the only rest, and the player's own play. At a sanctuary it is a
// long rest: the avatar sleeps until the light next changes, then wakes with
// every loss cleared. Anywhere else it is a short rest that clears one loss.
// Nobody rests in the middle of a standoff.
function rest(s, actor, here) {
  const a = s.actors[actor],
    losses = s.defeats?.[actor] || 0;
  if (a.sleepUntil !== undefined) {
    if (s.turn < a.sleepUntil) return null;
    delete a.sleepUntil;
    if (losses) delete s.defeats[actor];
    offerLevelQuest(s, actor, wantAPI(s));
    return "long";
  }
  if (actor !== currentActor(s) || standoffFor(s, actor)) return null;
  if (sanctuaries.includes(here))
    a.sleepUntil = (Math.floor(s.turn / DAYLIGHT_TURNS) + 1) * DAYLIGHT_TURNS;
  else if (losses > 1) s.defeats[actor] = losses - 1;
  else if (losses) delete s.defeats[actor];
  return null;
}
// A standoff goes on only while someone strikes. Any other play by either
// side ends it, and so does a Brace answering the other side's standing Brace.
function perform(s, a, round = null, settle = []) {
  const conflict = standoffFor(s, a.actor),
    other = conflict && opponentOf(conflict, a.actor);
  const mutual = a.kind === "guard" && conflict?.guarding[other];
  const result = performPlay(s, a, round, settle);
  if (
    conflict &&
    s.standoffs.includes(conflict) &&
    (mutual || !["guard", "attack"].includes(a.kind))
  ) {
    closeStandoff(s, conflict);
    addLog(
      s,
      "World",
      mutual
        ? `${nameOf(a.actor)} and ${nameOf(other)} both stand down. The standoff ends.`
        : `${nameOf(a.actor)} steps back from ${nameOf(other)}. The standoff ends.`,
      {
        kind: "narration",
        actorId: a.actor,
        targetId: other,
        locationId: conflict.location,
      },
    );
  }
  return result;
}
function performPlay(s, a, round = null, settle = []) {
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
  if (a.kind === "drop" && !a.item) {
    dropLevelQuest(s, a.actor, wantAPI(s));
    addLog(s, "World", a.text, {
      kind: "action",
      actorId: a.actor,
      verb: "drop",
      witnesses,
    });
    return;
  }
  if (a.kind === "wait") {
    const rested = rest(s, a.actor, here);
    const learningStart = beginLearning(s, a);
    if (a.actor === currentActor(s)) calm(s, here, a.actor);
    // Observing here may notice one of the place's signs.
    const sign = packWaitChoice(s, a.actor);
    const text = sign
      ? choiceText(applyPackChoice(s, sign, { mode: "wait" }), a.actor)
      : a.text;
    // The player's wait is a committed play like any other.
    if (learningStart || sign || a.actor === currentActor(s)) {
      addLog(s, "World", text, {
        kind: "action",
        actorId: a.actor,
        verb: "wait",
        witnesses,
        ...(rested ? { rest: rested } : {}),
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
    combat = null,
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
      const resolveBefore = conflict.resolve[a.target];
      conflict.guarding[a.target] = false;
      conflict.struck[a.actor] = true;
      conflict.resolve[a.target] = Math.max(0, resolveBefore - damage);
      text += ` ${guarded ? "The guard softens the blow. " : ""}${nameOf(a.target)} loses ${damage} resolve.`;
      combat = {
        damage,
        guarded,
        resolveBefore,
        resolveAfter: conflict.resolve[a.target],
        outcome: guarded ? "guarded" : "hit",
        lossCount: s.defeats?.[a.target] || 0,
      };
      if (conflict.resolve[a.target] === 0) {
        const defeat = defeatInStandoff(s, conflict, a.actor, a.target, here);
        text += defeat.text;
        Object.assign(combat, {
          outcome: defeat.outcome,
          lossCount: defeat.lossCount,
          droppedItemIds: defeat.droppedItemIds,
        });
        if (defeat.to)
          arrival = {
            text: defeat.arrivalText,
            kind: "narration",
            verb: defeat.outcome === "sent-home" ? "sent-home" : "retreat",
            actorId: a.target,
            targetId: a.actor,
            locationId: defeat.to,
            fromLocationId: here,
            droppedItemIds: defeat.droppedItemIds,
            lossCount: defeat.lossCount,
            witnesses,
          };
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
        transfer(s, "lamp", "vale", "Vale lifts the lamp.");
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
    ...(a.kind === "attack" ? { locationId: here, ...combat } : {}),
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
    wantActors(s, [
      a.actor,
      ...(s.actors[a.target] ? [a.target] : []),
      ...settle,
    ]),
    wantAPI(s),
    ["ask", "give", "trade"].includes(a.kind)
      ? { ...a, accepted: requestAccepted }
      : a,
  );
  // Resolved plays, and only those, can advance a crossing's signal.
  if (round)
    noteAct(s, a, here, holder, round, sensesFor(s), (line, locationId) =>
      addLog(s, "World", line, { locationId }),
    );
  // A flask and an empty lamp in one avatar's hands refuel after the play.
  refuelCarried(s);
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
    const projected =
      s.actors[actor] && s.actors[actor].place !== here
        ? {
            ...s,
            actors: {
              ...s.actors,
              [actor]: { ...s.actors[actor], place: here },
            },
          }
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
  // Inside a lamp gate, a cast avatar lights its lamp to open the way out;
  // the player's own hand makes that play.
  const gate = homeGates[here];
  if (
    gate?.light &&
    !s.items[gate.item].lit &&
    actor !== currentActor(s) &&
    !controlledByHuman(s, actor) &&
    homeGateRecoverable(s, here, gate, actor)
  ) {
    const light = getActions().find(
      (a) => a.kind === "light" && a.item === gate.item,
    );
    if (light) return light;
  }
  if (target === "attic" && !["attic", "pond", "station"].includes(here)) {
    const approach = routeBetween(s, here, "pond", actor);
    if (approach?.length > 1)
      return getActions().find(
        (a) => a.kind === "move" && a.target === approach[1],
      );
  }
  if (
    target !== "attic" &&
    atticInterior.has(target) &&
    !atticInterior.has(here)
  )
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
      return getActions().find(
        (a) => a.kind === "move" && a.target === approach[1],
      );
  }
  // Sound can reopen an outward crossing while the traveler stays on its shore.
  if (
    crossings.some(
      (c) =>
        c.from === here &&
        !c.transport &&
        c.requires.some((r) => r.kind === "sound" && r.at.includes(here)) &&
        routeBetween(s, c.to, target, actor),
    )
  ) {
    const sound = getActions().find(
      (a) => a.kind === "ring" && a.item === "bell",
    );
    if (sound)
      return covered(s, "bell")
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
  if (landing) return { action: landing };
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
    exits(
      s,
      from,
      actor,
      previous ?? (transportPlace(from) ? VOYAGE : null),
    ).includes(to);
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
      .sort(
        (a, b) => a.length - b.length || a.at(-1).localeCompare(b.at(-1)),
      )[0];
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
  if (s.peaceUntil[actor] > s.turn) return idle();
  const conflict = standoffFor(s, actor);
  const want = wantOf(s, actor);
  if (conflict) {
    const other = opponentOf(conflict, actor);
    const answer = (action) => (action ? { action } : idle());
    if (actor === conflict.defender && !conflict.answered)
      return answer(
        levelOf(s, actor) > levelOf(s, other)
          ? find("talk", (a) => a.target === other)
          : find("guard"),
      );
    if (conflict.struck[other] || conflict.struck[actor])
      return answer(find("attack", (a) => a.target === other));
    // A challenger that wants the item strikes; any other play would end
    // the standoff.
    if (
      conflict.challenger === actor &&
      conflict.item &&
      needed(s, actor, conflict.item)
    )
      return answer(find("attack", (a) => a.target === other));
    return idle();
  }
  if (!want) return idle();
  if (resting(s, actor, homeOf(actor))) return idle();
  const go = (place) => {
    if (!travels(actor, s) || staysPut(actor, s)) return idle();
    const step = stepToward(s, actor, place);
    return step.action
      ? { action: step.action }
      : { ...idle(), ...(step.callShip ? { callShip: true } : {}) };
  };
  if (want.kind === "place")
    return here === want.target ? idle() : go(want.target);
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
  // Held but not as wanted: uncover it, then light or put it out.
  if (owner === actor) {
    if (want.lit === undefined) return idle();
    const cover = ids.find((id) => s.items[id].holder === item);
    const fix = cover
      ? find("take", (a) => a.item === cover)
      : s.items[item].lit !== want.lit &&
        find(want.lit ? "light" : "snuff", (a) => a.item === item);
    return fix ? { action: fix } : idle();
  }
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
      find("take", (a) => a.item === top) ||
      find("take", (a) => a.item === item);
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
    travels(actor, s) &&
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
    ["light", "snuff"].includes(exact.kind) &&
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
  // A lamp that just ran dry in a hand that also holds the flask fills again.
  refuelCarried(next);
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
    if (chosen.action.kind !== "wait")
      perform(next, chosen.action, round, [id]);
    rememberRoutes(next, id, visibleRouteEdges(next.actors[id].place));
    if (next.actors[id].place !== from)
      arriveRoamingRecitals(next, packDefinitions, id);
  }
  // A resident resting at home clears a run of defeats.
  for (const id of Object.keys(next.defeats || {}))
    if (resting(next, id, homeOf(id))) delete next.defeats[id];
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
  fillWants(next, wantAPI(next));
  // A round of waits still ends a standoff nobody would carry on.
  settleStandoffs(next);
  for (const [id, allowance] of Object.entries(
    next.sharedMigration?.inventoryAllowances || {},
  )) {
    const count = Math.min(allowance, carried(next, id).length);
    if (count <= 3) delete next.sharedMigration.inventoryAllowances[id];
    else next.sharedMigration.inventoryAllowances[id] = count;
  }
  validateWorld(next);
  // Alone, the world runs on around a sleeper until the light changes.
  let slept = next;
  if (s.actors[actor].sleepUntil === undefined && !sharedEnabled(next))
    while (slept.actors[actor].sleepUntil !== undefined)
      slept = play(
        slept,
        legalActions(slept, actor)[0],
        slept.revision,
        actor,
      ).state;
  return { ok: true, state: slept };
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
      .join() !== sortedActorKeys ||
    Object.keys(s.items || {})
      .sort()
      .join() !== sortedItemKeys
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
  if (
    s.run !== undefined &&
    (Object.keys(s.run || {}).join() !== "seed" || !validSeed(s.run.seed))
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
    ![null, "hush"].includes(s.locations.pond?.answer)
  )
    fail();
  if (
    !s.peaceUntil ||
    Object.keys(s.peaceUntil).sort().join() !== sortedActorKeys ||
    Object.values(s.peaceUntil).some(
      (turn) => !Number.isSafeInteger(turn) || turn < 0 || turn > s.turn + 3,
    ) ||
    !Array.isArray(s.standoffs) ||
    s.standoffs.length > Math.floor(actorIds.length / 2)
  )
    fail();
  if (
    s.defeats !== undefined &&
    (!s.defeats ||
      typeof s.defeats !== "object" ||
      Array.isArray(s.defeats) ||
      Object.entries(s.defeats).some(
        ([id, count]) =>
          !actorIds.includes(id) ||
          !Number.isInteger(count) ||
          count < 1 ||
          count >= DEFEATS_TO_SEND_HOME,
      ))
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
      a.lastTalk > s.turn ||
      (a.sleepUntil !== undefined &&
        (!Number.isSafeInteger(a.sleepUntil) ||
          a.sleepUntil < 0 ||
          a.sleepUntil > s.turn + DAYLIGHT_TURNS))
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
      !holderIds.has(item.holder) &&
      !(id === "cloth" && (item.holder === "lamp" || item.holder === "bell"))
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
    lamp.fuel > LAMP_FUEL ||
    typeof lamp.lit !== "boolean" ||
    (lamp.lit && lamp.fuel === 0)
  )
    fail();
  if (
    Object.hasOwn(oil, "doses") ||
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
    "retreat",
    "sent-home",
    "move",
    "course",
    "take",
    "drop",
    "give",
    "ask",
    "light",
    "snuff",
    "ring",
    "refuel",
    "cover",
    "talk",
    "wait",
    "trade",
    "choose",
    "use",
  ];
  const cast = castIds,
    entities = entityIds;
  for (const e of s.log) {
    if (e.seq !== undefined) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= seq || e.seq > s.eventSeq)
        fail();
      seq = e.seq;
    }
    if (e.kind !== undefined && !LOG_KINDS.includes(e.kind)) fail();
    if (
      e.witnesses !== undefined &&
      (!Array.isArray(e.witnesses) ||
        e.witnesses.length > actorIds.length + ids.length ||
        e.witnesses.some((id) => !cast.has(id)))
    )
      fail();
    if (e.entityId != null && !entities.has(e.entityId)) fail();
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
    if (
      (e.outcome !== undefined && !OUTCOMES.includes(e.outcome)) ||
      (e.droppedItemIds !== undefined &&
        (!Array.isArray(e.droppedItemIds) ||
          e.droppedItemIds.some((id) => !ids.includes(id))))
    )
      fail();
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
    if (e.rest !== undefined && (e.rest !== "long" || e.verb !== "wait"))
      fail();
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
            : !entities.has(e.wantMet.target))))
    )
      fail();
    if (e.targetId != null && !entities.has(e.targetId)) fail();
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
            !item || !ids.includes(item.id) || !entities.has(item.holder),
        ))
    )
      fail();
  }
  freshlyValidated.add(s);
  return s;
}
// Rule results are validated before they return, so the save that follows
// does not check the same world again. Saving spends the mark: a later save of
// that object, and every decoded or imported save, is validated in full.
const freshlyValidated = new WeakSet();
export function encodeSave(s) {
  if (!freshlyValidated.has(s)) validateWorld(s);
  freshlyValidated.delete(s);
  return JSON.stringify(s);
}
export function decodeSave(text) {
  const s = JSON.parse(text);
  try {
    upgradeSave(s, { actorIds, installPacks, laneText: laneFactText });
    validateWorld(s);
    preserveTransportAccess(s);
  } catch (error) {
    // A save that cannot be read starts fresh; it never surfaces a crash.
    if (error instanceof TypeError) return validateWorld(null);
    throw error;
  }
  return validateWorld(s);
}
