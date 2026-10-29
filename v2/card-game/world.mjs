import { beginPersonalMeetings, advancePersonalQuests, personalNesting, personalItem } from "./pack-personal-quests.mjs";
import { trustValue, validTrust } from "./trust.mjs";
import { captureQuestHands, advanceQuestPrograms } from "./quest-progress.mjs";
import { expressionOf } from "./expression.mjs";
import {
  readingActions,
  resolveReadingReplay,
  applyReadingAction,
  validHearingRef,
} from "./reading-actions.mjs";
import { validPrivateAudience } from "./reading-privacy.mjs";
import { validRecallRef } from "./reading-context.mjs";
import { noteReadingDepartures } from "./poem-readings.mjs";
import { recordLearning, beginLearning, reconsiderPlan } from "./learning.mjs";
import {
  dropQuest,
  questCarried,
  carryQuest,
  questHolderActor,
  canCarryQuest,
  questHandKeys,
  settleQuestHands,
  validQuestHands,
} from "./quest-hands.mjs";
import { syncStoryQuests, createStoryQuestValidator } from "./story-quests.mjs";
import {
  installRoamingQuests,
  roamingPlan,
  roamingHelpPlan,
  settleRoamingArrival,
  roamingHelpMet,
  validRoamingQuests,
} from "./roaming-quests.mjs";
import {
  roamingActors,
  authoredRouteEdges,
  initialRouteEdges,
  visibleRouteEdges,
  witnessedRouteEdges,
} from "./roaming-routes.mjs";
import {
  collectionCards,
  installSharedQuestRegistry,
  questRecord,
  questRecords,
  focusedQuest,
  focusQuest,
  joinQuest,
  canJoinQuest,
  shareQuest,
  validSharedQuestRegistry,
} from "./shared-quests.mjs";
import {
  publishQuestCompletions,
  validQuestCompletions,
} from "./quest-completions.mjs";
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
  hasMotives,
  hasQuestPrograms,
  resentment,
  valueOf,
  tradeDecision,
  giftDecision,
  socialTravel,
  socialPlan,
  recordReaction,
  validMotives,
  tastes,
} from "./motives.mjs";
import { newMemories, rememberEvent, validMemories } from "./memory.mjs";
import {
  installKnowledge,
  witnessKnowledge,
  reserveKnowledge,
  acceptKnowledgeSpeech,
  validKnowledge,
} from "./knowledge.mjs";
import {
  programsFor,
  personalQuestActor,
  knownActors as readKnownActors,
  newProgress,
  programFor,
  savedProgramFor,
  desireFor,
  levelOf,
  targetsFor,
  alternatives,
  generateProgram,
  sequence,
  actorQuests,
  installQuestCollection,
  ensureCollectedQuest,
  collectExperienceQuests,
  pursueQuest,
} from "./quests.mjs";
import {
  lifeOf,
  questActive,
  keepReason,
  stayingWith,
  recordLifeAction,
  experienceKinds,
  validLife,
  installHumanLife,
  hopeOf,
  settleLife,
  purposeOrigin,
} from "./life.mjs";
import {
  conditionMet,
  questItemAvailable,
  conditionText,
  requiredItems,
  validCondition,
  validConsequence,
} from "./situations.mjs";
import {
  packPlaces,
  canonicalPlace,
  packThings,
  crossings,
  entityActive,
  actorCanVisit,
  packExits,
  packChoices,
  applyPackChoice,
  conditionsMet,
  validatePackLinks,
  packDefinition,
  packPeople,
  packActorIds,
  packDefinitions,
  isPackActor,
  staysPut,
  packJourneyDestination,
  packKeepsItem,
  packIndependentJourneyDestination,
  roamingQuestActor,
  avoidsStandoffs,
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
  transportDepartureDock,
  transportBoardingAllowed,
  preserveTransportAccess,
} from "./pack-transport.mjs";
import { upgradeSave } from "./legacy-saves.mjs";
import forest from "./forest.json" with { type: "json" };
import { BOARDY } from "./boardyai.mjs";
import {
  introductionPair,
  introductionPlan,
  validIntroductionProgram,
  introductionTarget,
  recordIntroductionTurn,
  validIntroductionVisits,
} from "./introductions.mjs";

// Authored forest data and mounted packs share the same rule path.
export const places = { ...forest.places, ...packPlaces };
const homeGates = { ...forest.homeGates, ...humanHomeGates };
const itemGateCrossings = crossings.filter((crossing) =>
  crossing.requires.some((condition) => condition.kind === "item_present"),
);
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

const trustActorIds = new Set(actorIds);
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
  installRoamingQuests(world, roamingActors, roamingAPI(world));
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
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
        trust: {},
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
    for (const id of Object.keys(pack.places)) s.memories[id] ??= fresh[id];
  }
  installHumanLife(s, (id) => tastes[id]);
  installRoamingQuests(s, roamingActors, roamingAPI(s));
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
const countableItem = (s, id) => personalItem(s, packDefinitions, id)?.active !== false;
export const carried = (s, actor) =>
  ids.filter((id) => countableItem(s, id) && rootHolder(s, id) === actor);
export const covered = (s, id) => s.items.cloth.holder === id;
export const shining = (s) =>
  entityActive(s, "lamp") &&
  s.items.lamp.lit &&
  s.items.lamp.fuel > 0 &&
  !covered(s, "lamp");
export const reflectionOpen = (s, from = itemPlace(s, "lamp")) =>
  // Light at either end opens the mirror in both directions.
  ["attic", "pond"].includes(from) &&
  shining(s) &&
  ["attic", "pond"].includes(itemPlace(s, "lamp"));
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
    s.opening && place === "attic"
      ? reflectionOpen(s, place)
        ? "A tall mirror opens onto a black shore. A path leads through the glass."
        : "A tall mirror reflects a black shore. Dust gathers along its frame."
      : s.opening && place === "station"
        ? "The timetable lists years that have yet to happen. A path leads along the shore to the pond."
        : places[place].text,
    ...crossingScenery(s, place, sensesFor(s)),
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
    (s.items.oil.doses > 0 &&
      ordinaryRouteHome(s, here, oil, actor) &&
      ordinaryRouteHome(s, oil, lamp, actor) &&
      localGateResource(at(oil), oil, "oil", actor))
  );
}
// Recover a gate resource left beyond the mirror after reachable remedies are gone.
function pondRescueExit(s, place, actor, previous) {
  actor ||= currentActor(s);
  const lamp = itemPlace(s, "lamp"),
    oil = itemPlace(s, "oil");
  if (
    place !== "pond" ||
    s.actors[actor]?.place !== place ||
    (!controlledByHuman(s, actor) && !knownActors(s).includes(actor)) ||
    !(
      atticInterior.has(lamp) ||
      (s.items.oil.doses > 0 && atticInterior.has(oil))
    ) ||
    ordinaryRouteHome(s, place, "attic", actor, previous)
  )
    return null;
  if (
    ordinaryRouteHome(s, place, lamp, actor, previous) &&
    (s.items.lamp.fuel > 0 ||
      (s.items.oil.doses > 0 &&
        ordinaryRouteHome(s, place, oil, actor, previous)))
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
      transportBoardingAllowed(s, actor, to) &&
      humanRoomAvailable(s, actor, to),
  );
}

function personalQuestApi() {
  return {
    isPlayer: (id) => !!humanAvatar(id),
    isPresent: (s, id) => controlledByHuman(s, id) && humanPresent(s, id),
    isLocation: (id) => !!places[id],
    active: entityActive,
    canAward: (s, id) => carried(s, id).length < 3,
    reachable: (s, actor, from) => {
      const seen = new Set([from]), queue = [from];
      while (queue.length && seen.size <= 128) {
        const at = queue.shift();
        const view = { ...s, actors: { ...s.actors, [actor]: { ...s.actors[actor], place: at } } };
        for (const next of exits(view, at, actor)) if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
      return [...seen].sort().slice(0, 128);
    },
  };
}
function resolvePersonalQuests(s, action) {
  const api = personalQuestApi();
  beginPersonalMeetings(s, packDefinitions, api);
  // Pack receipts have one event per turn; defer other choices to the next turn.
  if (action.kind === "choose") return;
  for (const done of advancePersonalQuests(s, packDefinitions, api, action)) {
    for (const event of done.sharedChoices) {
      const choice = applyPackChoice(s, { packId: done.pack, choiceId: event.choice, actor: event.actor });
      addLog(s, "World", choice.textTemplate.replaceAll("{actor}", nameOf(event.actor)), {
        kind: "action", actorId: event.actor, verb: "choose", packId: done.pack,
        choiceId: event.choice, targetId: choice.subject, locationId: choice.at,
      });
    }
    addLog(s, "World", `${nameOf(done.player)} receives the ${nameOf(done.reward)}.`, {
      kind: "action", actorId: done.player, verb: "personal-quest-complete",
      targetId: packDefinition(done.pack).personalQuests.find((q) => q.id === done.quest).host,
      itemId: done.reward, questKey: `${done.pack}:${done.quest}:${done.player}`,
    });
  }
}

const programPlaces = (s) =>
  s.opening
    ? Object.fromEntries(
        Object.keys(places).map((id) => [
          id,
          { ...places[id], exits: exits(s, id) },
        ]),
      )
    : places;
function meetCast(s) {
  const player = currentActor(s);
  for (const [id, a] of Object.entries(packPeople))
    if (entityActive(s, id) && s.actors[id].place === s.actors[player].place)
      s.packs[a.packId].met && (s.packs[a.packId].met[id] ??= s.turn);
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
const canUse = (s, actor, item) =>
  canReach(s, actor, item) || questItemAvailable(s, actor, item);
const loadOf = (s, id) => 1 + (s.items.cloth.holder === id ? 1 : 0);
const hasSpace = (s, actor, id) =>
  carried(s, actor).length +
    (rootHolder(s, id) === actor ? 0 : loadOf(s, id)) <=
  3;
export function handStatus(s, actor, hand = desireFor(s, actor)) {
  const held = carried(s, actor),
    here = s.actors[actor].place;
  const items = hand.items.map((id) => ({
    id,
    met: questItemAvailable(s, actor, id),
    ...(!held.includes(id) && questItemAvailable(s, actor, id)
      ? { sharedBy: rootHolder(s, id) }
      : {}),
  }));
  const location = {
    id: hand.location,
    met: !hand.location || here === hand.location,
  };
  const avatars = hand.avatars.map((id) => ({
    id,
    met: s.actors[id].place === here,
  }));
  const conditions = (hand.conditions || []).map((c) => ({
    ...c,
    met: conditionMet(s, c, actor),
  }));
  return {
    items,
    location,
    avatars,
    conditions,
    met:
      items.every((e) => e.met) &&
      location.met &&
      avatars.every((e) => e.met) &&
      conditions.every((e) => e.met) &&
      roamingHelpMet(s, hand, roamingAPI(s)),
  };
}
export function handText(hand) {
  return [
    hand.items.length
      ? `hold ${hand.items.map(nameOf).join(" + ")}`
      : "hold any items",
    hand.location ? `at ${nameOf(hand.location)}` : "in any place",
    hand.avatars.length
      ? `with ${hand.avatars.map(nameOf).join(" + ")}`
      : "with any company",
    ...(hand.conditions || []).map((c) => conditionText(c, nameOf)),
  ].join(" · ");
}
const bundle = (s, item) => [
  item,
  ...(s.items.cloth.holder === item ? ["cloth"] : []),
];
const needed = (s, actor, item) =>
  bundle(s, item).some((id) =>
    requiredItems(s, actor, desireFor(s, actor)).includes(id),
  );
const accepts = (s, actor, item) =>
  (hasMotives(s) && valueOf(s, actor, item) >= 2) ||
  controlledByHuman(s, actor) ||
  (item === "lamp" &&
    !s.items.lamp.fuel &&
    s.items.oil.doses > 0 &&
    rootHolder(s, "oil") === actor &&
    !staysPut(actor) &&
    (s.actors[actor].place === "attic" ||
      desireFor(s, actor).location === "attic")) ||
  bundle(s, item).some(
    (id) =>
      requiredItems(s, actor, desireFor(s, actor)).includes(id) &&
      rootHolder(s, id) !== actor,
  );
// The cast gives a spare once its own items are in hand. After Vale has gone
// a long while without completing a hand, it gives Vale spares sooner, so the
// player always has a way forward.
export const valeStalled = (s) =>
  s.turn - (s.actors.vale.progress.marks.at(-1) || 0) >= 24;
export function willingToGive(s, owner, item, recipient = null) {
  if (packKeepsItem(s, owner, item)) return false;
  if (hasMotives(s) && recipient && resentment(s, owner, recipient))
    return false;
  if (!hasQuestPrograms(s) || lifeOf(s, owner))
    return (
      !controlledByHuman(s, owner) &&
      recipient !== null &&
      giftDecision(s, owner, item, recipient).accepted
    );
  return (
    !controlledByHuman(s, owner) &&
    !needed(s, owner, item) &&
    (handStatus(s, owner).items.every((e) => e.met) ||
      (recipient && trustValue(s, owner, recipient) > 0) ||
      (recipient === "vale" && valeStalled(s)))
  );
}
export function canTrade(s, actor, give, receive) {
  const other = s.items[receive]?.holder;
  if (packKeepsItem(s, actor, give) || packKeepsItem(s, other, receive))
    return false;
  if (
    s.items[give]?.holder !== actor ||
    !actorIds.includes(other) ||
    !knownActors(s).includes(other) ||
    other === actor ||
    controlledByHuman(s, other) ||
    s.actors[actor].place !== s.actors[other].place
  )
    return false;
  if (
    hasMotives(s)
      ? !tradeDecision(s, actor, give, receive).accepted &&
        !(
          hasQuestPrograms(s) &&
          !s.life &&
          !resentment(s, other, actor) &&
          needed(s, other, give) &&
          !needed(s, other, receive)
        )
      : !accepts(s, other, give) || needed(s, other, receive)
  )
    return false;
  const outgoing = loadOf(s, give),
    incoming = loadOf(s, receive);
  return (
    carried(s, actor).length - outgoing + incoming <= 3 &&
    carried(s, other).length - incoming + outgoing <= 3
  );
}
export function tradeOffers(s, actor) {
  return ids.filter(
    (id) =>
      entityActive(s, id) && s.items[id].holder === actor &&
      (s.life
        ? !keepReason(s, actor, id)
        : hasQuestPrograms(s)
          ? !needed(s, actor, id)
          : valueOf(s, actor, id) <= 6),
  );
}
function captureHands(s, met) {
  captureQuestHands(s, met, { actorIds, handStatus });
}
// Each new program reads the programs chosen before it in the same round, so two
// actors never pick goals against each other's stale wants.
export function ensurePrograms(s, candidates = actorIds) {
  const placesForGeneration = () => programPlaces(s);
  for (const actor of candidates.filter(
    (id) =>
      personalQuestActor(id) &&
      (id !== BOARDY || (lifeOf(s, id) && entityActive(s, id))),
  )) {
    const p = s.actors[actor].progress;
    if (ensureCollectedQuest(s, actor, placesForGeneration, things)) continue;
    if (p.program >= programsFor(s, actor).length && !p.current) {
      p.completedHands ??= programsFor(s, actor).reduce(
        (n, program) => n + program.steps.length,
        0,
      );
      p.recent ??= [];
      p.recentKinds ??= [];
      if (!questActive(s, actor)) continue;
      p.current = generateProgram(
        structuredClone(s),
        actor,
        programPlaces(s),
        things,
      );
    }
  }
}
// Cast members reconsider an unfinished bargain after twelve turns. Keep the
// completed prefix; every remaining hand still needs a real world match.
function refreshStalledPrograms(s) {
  if (!hasQuestPrograms(s)) return;
  for (const actor of knownActors(s).filter(
    (id) => !controlledByHuman(s, id) && personalQuestActor(id),
  )) {
    const p = s.actors[actor].progress,
      current = programFor(s, actor);
    if (lifeOf(s, actor)?.collection) continue;
    if (
      !current?.generated ||
      s.turn - Math.max(current.generated.turn, p.marks.at(-1) || 0) < 12
    )
      continue;
    const fresh = generateProgram(
      structuredClone(s),
      actor,
      programPlaces(s),
      things,
      {
        independent: true,
        solo: s.turn - (p.marks.at(-1) || 0) >= 24,
      },
    );
    const unfinished = fresh.steps.filter(
      (step) => !alternatives(step).some((h) => handStatus(s, actor, h).met),
    );
    if (!unfinished.length) continue;
    p.current = {
      ...fresh,
      steps: sequence(
        current.steps.slice(0, p.step),
        unfinished.slice(0, current.steps.length - p.step),
      ),
    };
    addLog(
      s,
      "World",
      `${nameOf(actor)} finds a new purpose: ${handText(desireFor(s, actor))}.`,
      {
        actorId: actor,
        questPlan: structuredClone(p.current),
      },
    );
  }
}
function applyConsequence(s, actor, target) {
  const effect = target.consequence;
  if (!effect) return;
  let text;
  switch (effect.kind) {
    case "anchor":
      s.locations.attic.anchored = true;
      text =
        "The mirror remembers the crossing. Its path opens in lamplight at either shore.";
      break;
    case "oil":
      s.items.oil.doses = 3;
      s.locations.pond.answer = "call";
      remember(
        s,
        "oil",
        "The pond answered the bell. Three measures of oil fill the flask.",
      );
      text =
        "The pond answers the bell. Three measures of oil fill the flask, wherever its carrier stands.";
      break;
    case "hush":
      s.locations.pond.answer = "hush";
      for (const c of [...s.standoffs].filter((c) => c.location === "pond"))
        closeStandoff(s, c);
      text =
        "The pond accepts the muffled bell. Its shore becomes a refuge: the cast will settle disputes here until the bell rings again.";
      break;
    case "trust":
      s.actors[effect.avatar].trust[actor] = Math.min(
        3,
        trustValue(s, effect.avatar, actor) + 1,
      );
      text = `${nameOf(effect.avatar)} remembers ${nameOf(actor)}'s help. They will share spare items sooner and accept a detour in their company.`;
      break;
  }
  addLog(s, "World", text, {
    actorId: actor,
    consequence: structuredClone(effect),
    itemId: effect.kind === "oil" ? "oil" : undefined,
    targetId: effect.avatar,
  });
}
function advancePrograms(s, met) {
  return advanceQuestPrograms(s, met, {
    applyConsequence,
    ensurePrograms,
    sanctuaries,
    nameOf,
    handText,
    addLog,
  });
}

// Accepted speech can reveal a new fact during the same saved turn.
export function refreshQuestProgress(s) {
  const met = new Map();
  captureHands(s, met);
  publishQuestCompletions(s, advancePrograms(s, met));
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
    const choices = packChoices(s, listener);
    const topics = authoredKnowledgeTopics()
      .filter(
        (topic) =>
          (topic.publicAccount === true &&
            topic.choiceId !== undefined &&
            Object.hasOwn(
              s.packs[topic.packId]?.receipts || {},
              topic.choiceId,
            )) ||
          conditionsMet(s, topic.packId, topic.requires || [], listener),
      )
      .map((topic) => ({
        ...topic,
        choiceReady: choices.some(
          (a) => a.packId === topic.packId && a.choiceId === topic.choiceId,
        ),
      }));
    if (reserveKnowledge(s, speaker, listener, entry, topics)) break;
  }
}

// Only recorded speech publishes a selected account and its authored effects.
export function publishKnowledgeSpeech(s, entry, disclosures) {
  const learned = acceptKnowledgeSpeech(s, entry, disclosures);
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
  if (learned.length) {
    const met = new Map();
    captureHands(s, met);
    publishQuestCompletions(s, [
      ...advancePrograms(s, met),
      ...syncStoryQuests(s, learned[0].listener),
    ]);
    settleQuestHands(s);
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
  const owned = new Map(
    questRecords(s).map((q) => [q.key, questHolderActor(s, q)]),
  );
  s.items[item].holder = holder;
  settleQuestHands(s);
  for (const q of questRecords(s)) {
    const actor = questHolderActor(s, q);
    if (actor && actor !== owned.get(q.key)) carryQuest(s, actor, q);
  }
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
    return {
      accepted: false,
      reason: "Their commitments keep them in this part of the world.",
    };
  if (standoffFor(s, actor) || standoffFor(s, companion))
    return { accepted: false, reason: "Attend to the standoff first." };
  if (s.peaceUntil[companion] > s.turn)
    return { accepted: false, reason: "Catch a breath after the standoff." };
  if (packPeople[companion]?.journey)
    return invited &&
      packJourneyDestination(s, companion) === destination &&
      exits(s, here, companion, transportDepartureDock(s, here)).includes(
        destination,
      )
      ? { accepted: true, reason: "Follow the road we agreed to take." }
      : { accepted: false, reason: "Keep to the agreed journey." };
  if (hasMotives(s)) {
    const social = socialTravel(s, actor, companion, destination);
    if (
      !hasQuestPrograms(s) ||
      resentment(s, companion, actor) ||
      social.accepted
    )
      return social;
  }
  const distance = (from, to) => {
    const route = routeBetween(s, from, to);
    return route ? route.length - 1 : Infinity;
  };
  const closer = (place) =>
    distance(destination, place) < distance(here, place);
  const agree = (reason) => ({ accepted: true, reason });
  if (
    s.life &&
    targetsFor(s, actor).some(
      (hand) =>
        hand.location &&
        closer(hand.location) &&
        hand.items.some(
          (id) =>
            rootHolder(s, id) === companion && questItemAvailable(s, actor, id),
        ),
    )
  )
    return agree("Keep our shared belongings with us for this journey.");
  for (const hand of targetsFor(s, companion)) {
    const missing = requiredItems(s, companion, hand).filter(
      (id) => rootHolder(s, id) !== companion,
    );
    // Collect a wanted object here before leaving it behind. Objects carried
    // by the requester travel with the pair and remain within reach.
    if (
      missing.some(
        (id) => itemPlace(s, id) === here && rootHolder(s, id) !== actor,
      )
    )
      continue;
    const distant = missing.filter((id) => rootHolder(s, id) !== actor);
    const sought = distant.find((id) => closer(itemPlace(s, id)));
    if (sought) return agree(`Seek the ${nameOf(sought)}.`);
    if (distant.length) continue;
    if (hand.location) {
      if (closer(hand.location))
        return agree(`Reach ${nameOf(hand.location)} for the target hand.`);
      continue;
    }
    const company = hand.avatars.filter((id) => id !== actor);
    const meet = company.find((id) => closer(s.actors[id].place));
    if (meet) return agree(`Meet ${nameOf(meet)}.`);
    if (company.every((id) => s.actors[id].place === destination))
      return agree(`Travel in ${nameOf(actor)}'s company.`);
  }
  if (trustValue(s, companion, actor) > 0)
    return {
      ...agree(`Remember ${nameOf(actor)}'s help and share this detour.`),
      favor: true,
    };
  return {
    accepted: false,
    reason: `Pursue this hand first: ${handText(desireFor(s, companion))}.`,
  };
}

function visibleQuest(s, actor, quest) {
  const holder = quest.holder;
  if (!holder || !entityActive(s, holder.id)) return false;
  const here = s.actors[actor].place;
  return holder.kind === "place"
    ? holder.id === here
    : holder.kind === "item"
      ? itemPlace(s, holder.id) === here
      : s.actors[holder.id]?.place === here;
}
function sharedQuestActions(s, actor) {
  const actions = [],
    here = s.actors[actor].place;
  for (const quest of questRecords(s)) {
    if (
      quest.completedTurn !== null ||
      quest.retired ||
      quest.droppedBy?.[actor] !== undefined ||
      !visibleQuest(s, actor, quest)
    )
      continue;
    if (
      !quest.participants.includes(actor) &&
      canJoinQuest(s, actor, quest.key)
    )
      actions.push({
        kind: "join-quest",
        actor,
        questKey: quest.key,
        key: `join-quest:${actor}:${quest.key}`,
        label: "Help",
        text: `${nameOf(actor)} joins ${quest.program.name}.`,
        parts: [],
      });
    if (quest.mode === "story") continue;
    const holder = quest.holder;
    const canShare =
      holder.kind === "avatar"
        ? holder.id === actor
        : holder.kind === "item"
          ? rootHolder(s, holder.id) === actor
          : quest.participants.includes(actor);
    if (!canShare) continue;
    const targets = [
      { kind: "place", id: here },
      ...actorIds
        .filter((id) => entityActive(s, id) && s.actors[id].place === here)
        .map((id) => ({ kind: "avatar", id })),
      ...carried(s, actor).map((id) => ({ kind: "item", id })),
    ];
    for (const to of targets) {
      if (to.kind === holder.kind && to.id === holder.id) continue;
      if (to.kind === "avatar" && !canJoinQuest(s, to.id, quest.key)) continue;
      actions.push({
        kind: "share-quest",
        actor,
        questKey: quest.key,
        holder: to,
        key: `share-quest:${actor}:${quest.key}:${to.kind}:${to.id}`,
        label:
          to.kind === "place"
            ? `Leave at ${nameOf(to.id)}`
            : `Share with ${nameOf(to.id)}`,
        text: `${nameOf(actor)} leaves ${quest.program.name} with ${nameOf(to.id)}.`,
        parts: [],
      });
    }
  }
  return actions;
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
  for (const quest of actorQuests(s, actor).filter(
    (q) => q.status === "pending" && canCarryQuest(s, actor, q),
  )) {
    out.push({
      kind: "pursue",
      actor,
      questKey: quest.key,
      key: `pursue:${actor}:${quest.key}`,
      label: "Pursue",
      text: `${nameOf(actor)} chooses ${quest.program.name}.`,
      parts: [],
    });
  }
  out.push(...sharedQuestActions(s, actor));
  const carried = questHandKeys(s, actor).map((key) => s.quests.records[key]);
  if (
    lifeOf(s, actor) &&
    !lifeOf(s, actor).collection &&
    canCarryQuest(s, actor)
  )
    carried.push(...actorQuests(s, actor).filter((q) => !q.holder));
  for (const q of carried) {
    const key = q.key;
    out.push({
      kind: "drop-quest",
      actor,
      questKey: key,
      key: `drop-quest:${actor}:${key}`,
      cards: [],
      label: "Drop",
      text: `${nameOf(actor)} sets aside ${q.program.name}.`,
      parts: [],
    });
  }
  const ways = exits(s, here, actor);
  const ownStep = packIndependentJourneyDestination(s, actor);
  for (const to of packPeople[actor]?.journey
    ? ways.filter((place) => place === ownStep)
    : ways) {
    const through = !baseExits(s, here).includes(to);
    const crossing = crossingBetween(here, to, s);
    const way = through
      ? ` ${homeRescueExit(s, here, actor) === to || pondRescueExit(s, here, actor) === to ? "along a narrow path" : crossing?.travel || "through the reflection"}`
      : "";
    // A human can invite a willing resident along their open route.
    for (const other of knownActors(s).filter(
      (id) =>
        (crossing?.travelers !== "player" || controlledByHuman(s, actor)) &&
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
    for (const id of ids.filter((id) => entityActive(s, id) && s.items[id].holder === actor)) {
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
          (id) => entityActive(s, id) && s.items[id].holder === other && needed(s, actor, id),
        ) ||
        ids.find((id) => entityActive(s, id) && s.items[id].holder === other) ||
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
    if (item.holder === actor && !packKeepsItem(s, actor, id)) {
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
          (accepts(s, p, id) ||
            targetsFor(s, actor).some((h) =>
              h.conditions?.some(
                (c) => c.kind === "heldBy" && c.item === id && c.avatar === p,
              ),
            )) &&
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
  const payments = ids.filter((id) => entityActive(s, id) && s.items[id].holder === actor);
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
  const tradeGoods = ids.filter((id) => entityActive(s, id) && tradePartners.has(s.items[id].holder));
  for (const give of payments)
    for (const receive of tradeGoods) {
      if (!canTrade(s, actor, give, receive)) continue;
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
  out.push(
    ...fixtureOffers(s, actor, sensesFor(s)),
    ...packChoices(s, actor),
    ...readingActions(s, actor),
  );
  for (const action of out) {
    if (action.kind === "take" && things[s.items[action.item]?.holder])
      action.label = "Uncover";
    if (action.kind === "move") {
      const crossing = crossingBetween(here, action.target, s);
      if (crossing?.travelLabel) action.label = crossing.travelLabel;
    }
  }
  return out;
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

function perform(s, a, capture = () => {}, round = null) {
  const who = nameOf(a.actor);
  if (a.kind === "read") {
    const result = applyReadingAction(s, a);
    if (result.completion)
      addLog(
        s,
        "World",
        `${who} completes ${result.completion.label.toLowerCase()}.`,
        {
          kind: "action",
          actorId: a.actor,
          verb: "choose",
          packId: a.packId,
          choiceId: result.completion.id,
          targetId: result.completion.subject,
          locationId: result.completion.at,
        },
      );
    addLog(s, "World", a.text, {
      kind: "action",
      actorId: a.actor,
      verb: "read",
      targetId: a.target,
      privateTo: [...result.privateTo],
      cast: [...result.privateTo],
      ...(result.hearing ? { hearing: [...result.hearing, s.turn] } : {}),
    });
    capture();
    return a.target;
  }
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
    if (learningStart) {
      addLog(s, "World", a.text, {
        kind: "action",
        actorId: a.actor,
        verb: "wait",
        witnesses,
      });
      recordLearning(s, a, learningStart, s.log.at(-1));
    }
    return;
  }
  if (a.kind === "drop-quest") {
    dropQuest(s, a.actor, a.questKey);
    const remaining = questHandKeys(s, a.actor).find(
      (key) => s.quests.records[key].completedTurn === null,
    );
    if (!focusedQuest(s, a.actor) && remaining)
      pursueQuest(s, a.actor, remaining);
    addLog(s, "World", a.text, {
      kind: "action",
      verb: "drop-quest",
      actorId: a.actor,
      locationId: here,
      questKey: a.questKey,
      targetId: questRecord(s, a.questKey).holder.id,
    });
    return;
  }
  if (a.kind === "join-quest" || a.kind === "share-quest") {
    if (a.kind === "join-quest") focusQuest(s, a.actor, a.questKey);
    else shareQuest(s, a.questKey, a.holder);
    addLog(s, "World", a.text, {
      kind: "action",
      actorId: a.actor,
      locationId: here,
      verb: a.kind,
      questKey: a.questKey,
      targetId: questRecord(s, a.questKey).holder.id,
    });
    return;
  }
  if (a.kind === "pursue") {
    pursueQuest(s, a.actor, a.questKey);
    addLog(s, "World", a.text, { actorId: a.actor, locationId: here });
    return;
  }
  const learningStart = beginLearning(s, a);
  const holder = holderBefore(s, a);
  const usefulGift =
    a.kind === "give" &&
    (valueOf(s, a.target, a.item) >= 5 || needed(s, a.target, a.item));
  let text = a.text;
  let requestAccepted = false;
  let affected = null,
    arrival = null,
    invitation = null;
  switch (a.kind) {
    case "use":
      remember(s, a.item, a.text);
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
      if (invitation.favor)
        s.actors[a.target].trust[a.actor] =
          trustValue(s, a.target, a.actor) - 1;
      s.actors[a.actor].lastTalk = s.turn;
      if (invitation.accepted) {
        const visits = (s.invitedPlaces ??= {});
        visits[a.target] = [
          ...new Set([...(visits[a.target] || []), a.destination]),
        ].sort();
        const through = travelParty(s, [a.actor, a.target], a.destination);
        text += ` ${nameOf(a.target)} agrees. ${invitation.reason} They travel together.`;
        if (through && firstCrossing)
          text += " Something on the far shore turns its head.";
      } else {
        text += ` ${nameOf(a.target)} declines the trip. ${invitation.reason}`;
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
        const retreat = exits(s, here, a.target)[0];
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
      transfer(s, a.item, a.target, a.text);
      break;
    case "trade":
      transfer(s, a.item, a.target, a.text);
      transfer(s, a.receive, a.actor, a.text);
      break;
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
        if (
          !handStatus(s, a.target).items.every((e) => e.met) &&
          trustValue(s, a.target, a.actor) > 0
        )
          s.actors[a.target].trust[a.actor] =
            trustValue(s, a.target, a.actor) - 1;
        text = `${nameOf(a.target)} hands the ${nameOf(a.item)} to ${who}.`;
        transfer(s, a.item, a.actor, text);
      } else {
        text += ` ${nameOf(a.target)} keeps it for now.`;
        if (hasMotives(s))
          text += ` ${giftDecision(s, a.target, a.item, a.actor).reason}`;
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
  // Record the completed physical act while its shared use is still agreed.
  // Reactions can change who is willing to share on the following play.
  capture();
  recordReaction(s, a, witnesses, requestAccepted);
  recordLifeAction(s, a, invitation?.accepted ?? requestAccepted, usefulGift);
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
    ...(a.kind === "ask" ? { accepted: requestAccepted } : {}),
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
  // Resolved plays, and only those, can advance a crossing's signal.
  if (round)
    noteAct(s, a, here, holder, round, sensesFor(s), (line, locationId) =>
      addLog(s, "World", line, { locationId }),
    );
  // Answering the request is the invited avatar's action for this round.
  return invitation ? a.target : null;
}

function roamingAPI(s) {
  return {
    canonicalPlace,
    nameOf: (id) => (id ? nameOf(id) : "a traveler"),
    crossing: (from, to) => crossingBetween(from, to, s),
    itemPlace: (id) => itemPlace(s, id),
    route: (from, to, actor) => routeBetween(s, from, to, actor),
    initialEdges: initialRouteEdges,
    active: (place) => entityActive(s, place),
    visibleEdges: visibleRouteEdges,
    witnessedEdges: (actor) => witnessedRouteEdges(s, actor),
    exits: (from, actor, previous = null) => exits(s, from, actor, previous),
    actions: (actor) => legalActions(s, actor),
    transportExit: (actor) => {
      const destinations = transportExits(s, s.actors[actor].place);
      return legalActions(s, actor).find(
        (a) => a.kind === "move" && destinations.includes(a.target),
      );
    },
    present: (actor) => !controlledByHuman(s, actor) || humanPresent(s, actor),
    arrive: (actor) => arriveRoamingRecitals(s, packDefinitions, actor),
  };
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
    for (const next of exits(projected, here, actor, route.at(-2)))
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...route, next]);
      }
  }
}
function toward(s, actor, target) {
  const here = s.actors[actor].place;
  const route = routeBetween(s, here, target, actor);
  let actions;
  const getActions = () => (actions ??= legalActions(s, actor));
  if (route)
    return getActions().find((a) => a.kind === "move" && a.target === route[1]);
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
  // Mirror journeys prepare the lamp through the same legal item plays.
  if (target !== "attic" && here !== "attic") return;
  const find = (kind, item) =>
    getActions().find((a) => a.kind === kind && a.item === item);
  const take = find("take", "lamp");
  if (take) return take;
  if (covered(s, "lamp") && find("take", "cloth")) return find("take", "cloth");
  if (!s.items.lamp.fuel && !s.items.oil.doses && here === "pond") {
    const call = find("ring", "bell");
    if (call) return call;
  }
  if (!s.items.lamp.fuel && s.items.oil.doses > 0) {
    if (find("refill", "oil")) return find("refill", "oil");
    if (find("take", "oil")) return find("take", "oil");
    if (
      find("ask", "oil") &&
      willingToGive(s, rootHolder(s, "oil"), "oil", actor)
    )
      return find("ask", "oil");
    const tender = rootHolder(s, "oil");
    if (
      rootHolder(s, "lamp") === actor &&
      !needed(s, actor, "lamp") &&
      tender !== actor &&
      s.actors[tender]?.place === here &&
      !controlledByHuman(s, tender) &&
      !staysPut(tender)
    )
      return getActions().find(
        (action) =>
          action.kind === "give" &&
          action.item === "lamp" &&
          action.target === tender,
      );
  }
  if (!s.items.lamp.lit && find("light", "lamp")) return find("light", "lamp");
  if (here === "station")
    return getActions().find((a) => a.kind === "move" && a.target === "pond");
  if (here === "pond" && itemPlace(s, "lamp") === "station")
    return getActions().find(
      (a) => a.kind === "move" && a.target === "station",
    );
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
  const ownStep = packIndependentJourneyDestination(s, actor);
  const onward =
    ownStep &&
    legalActions(s, actor).find(
      (a) => a.kind === "move" && !a.item && a.target === ownStep,
    );
  if (onward)
    return { action: onward, reason: "Follow the journey I agreed to make." };
  const arrival = transportArrival(s, actor);
  const landing =
    arrival &&
    legalActions(s, actor).find(
      (a) => a.kind === "move" && a.target === arrival,
    );
  if (landing)
    return { action: landing, reason: `Step ashore at ${nameOf(arrival)}.` };
  const program = programFor(s, actor);
  const pair = introductionPair(program);
  if (pair && questActive(s, actor))
    return introductionPlan(
      s,
      actor,
      focusedQuest(s, actor)?.key || program.id,
      program,
      {
        actions: legalActions(s, actor),
        toward: (place) => toward(s, actor, place),
        name: nameOf,
      },
    );
  const selected = basePlan(s, actor);
  // Earlier authored programs keep their recorded route and turn order.
  if (!hasMotives(s)) return selected;
  const futureItems = new Set(
    hasQuestPrograms(s)
      ? (program?.steps || []).flatMap((step) =>
          alternatives(step).flatMap((hand) => requiredItems(s, actor, hand)),
        )
      : [],
  );
  return reconsiderPlan(
    s,
    actor,
    selected,
    legalActions(s, actor).filter(
      (a) =>
        a.key === selected.action.key ||
        !["trade", "give"].includes(a.kind) ||
        (!needed(s, actor, a.item) &&
          !keepReason(s, actor, a.item) &&
          (a.kind !== "give" ||
            !bundle(s, a.item).some((id) => futureItems.has(id)))),
    ),
  );
}
function basePlan(s, actor) {
  const help = !staysPut(actor) && roamingHelpPlan(s, actor, roamingAPI(s));
  if (help) return help;
  // A resident who never leaves home keeps to it.
  if (staysPut(actor))
    return {
      action: legalActions(s, actor)[0],
      reason: packPeople[actor].tastes.reason,
    };
  if (isPackActor(actor) && !personalQuestActor(actor)) {
    const actions = legalActions(s, actor).filter(
      (a) =>
        !["move", "accompany", "threaten"].includes(a.kind) &&
        (a.kind !== "take" || desireFor(s, actor).items.includes(a.item)),
    );
    return socialPlan(s, actor, actions, {
      standoffFor,
      opponentOf,
      routeBetween,
      carried,
      willingToGive,
    });
  }
  if (!knownActors(s).includes(actor))
    return {
      action: legalActions(s, actor)[0],
      reason: "Wait for a first meeting.",
    };
  const acts = legalActions(s, actor).filter((a) => {
      if (
        !lifeOf(s, actor) ||
        !["give", "drop"].includes(a.kind) ||
        !keepReason(s, actor, a.item)
      )
        return true;
      return (
        a.kind === "give" &&
        targetsFor(s, actor).some((h) =>
          h.conditions?.some(
            (c) =>
              c.kind === "heldBy" && c.item === a.item && c.avatar === a.target,
          ),
        )
      );
    }),
    hand = desireFor(s, actor);
  const carryingPromise = hand.conditions?.some(
    (condition) =>
      condition.kind === "heldBy" &&
      condition.avatar !== actor &&
      s.items[condition.item]?.holder === actor,
  );
  if (
    hasMotives(s) &&
    (!hasQuestPrograms(s) ||
      !questActive(s, actor) ||
      stayingWith(s, actor) ||
      standoffFor(s, actor) ||
      s.peaceUntil[actor] > s.turn ||
      (!carryingPromise &&
        actorIds.some(
          (other) =>
            s.actors[other].place === s.actors[actor].place &&
            resentment(s, actor, other) > 0,
        )))
  )
    return socialPlan(s, actor, acts, {
      standoffFor,
      opponentOf,
      routeBetween,
      carried,
      willingToGive,
    });
  const here = s.actors[actor].place;
  const find = (kind, item, target) =>
    acts.find(
      (a) =>
        a.kind === kind &&
        (item === undefined || a.item === item) &&
        (target === undefined || a.target === target),
    );
  const idle = (reason) => ({ action: acts[0], reason });
  const choose = (action, reason) =>
    action ? { action, reason } : idle(reason);
  if (s.peaceUntil[actor] > s.turn)
    return idle("Catch a breath after the standoff.");
  const conflict = standoffFor(s, actor);
  if (conflict) {
    const other = opponentOf(conflict, actor);
    if (actor === conflict.defender && !conflict.answered)
      return choose(
        find(
          levelOf(s, actor) > levelOf(s, other) ? "talk" : "guard",
          undefined,
          other,
        ),
        "Answer the threat.",
      );
    if (conflict.struck[other] || conflict.struck[actor])
      return choose(find("attack", undefined, other), "Answer the attack.");
    if (
      conflict.challenger === actor &&
      conflict.item &&
      needed(s, actor, conflict.item) &&
      s.turn - conflict.opened >= 2
    )
      return choose(
        find("attack", undefined, other),
        "Press the demand for the disputed item.",
      );
  }
  const resources = requiredItems(s, actor, hand);
  const missing = resources.filter((id) =>
    hand.items.includes(id)
      ? !questItemAvailable(s, actor, id)
      : rootHolder(s, id) !== actor,
  );
  const reason = `Seek this hand: ${handText(hand)}.`;
  // Quiet the carried bell before preparing travel for a simple cloth hand.
  if (
    !missing.length &&
    !hand.conditions?.length &&
    hand.items.includes("cloth") &&
    rootHolder(s, "bell") === actor &&
    s.items.bell.ringing &&
    find("cover", "cloth", "bell")
  )
    return choose(find("cover", "cloth", "bell"), "Wrap the ringing bell.");
  // Prepare a closed route for this hand or a nearby traveler's ready hand.
  const collecting = missing.some(
    (item) =>
      itemPlace(s, item) !== here &&
      routeBetween(s, here, itemPlace(s, item), actor),
  );
  const destinations = [
    ...missing.map((id) => itemPlace(s, id)),
    ...(!collecting
      ? [hand.location, ...hand.avatars.map((id) => s.actors[id].place)]
      : []),
    ...(!collecting
      ? knownActors(s)
          .filter(
            (id) =>
              id !== actor &&
              s.actors[id].place === here &&
              handStatus(s, id).items.every((item) => item.met),
          )
          .map((id) => desireFor(s, id).location)
      : []),
  ];
  for (const destination of new Set(destinations)) {
    if (
      !destination ||
      destination === here ||
      routeBetween(s, here, destination, actor)
    )
      continue;
    const prepare = toward(s, actor, destination);
    if (prepare && prepare.kind !== "move") {
      if (
        prepare.kind === "light" &&
        here === "station" &&
        missing.some((item) => {
          const owner = rootHolder(s, item);
          return (
            itemPlace(s, item) === here &&
            actorIds.includes(owner) &&
            !controlledByHuman(s, owner) &&
            needed(s, owner, item) &&
            resources.some(
              (held) => rootHolder(s, held) === actor && needed(s, owner, held),
            )
          );
        })
      )
        continue;
      return choose(prepare, "Prepare the way for the meeting.");
    }
  }
  // Another avatar can hold its whole hand somewhere else and wait only for
  // this one. Going there completes that hand and ends the wait.
  const waitingHere = (ids) =>
    ids.find((id) => {
      const theirs = desireFor(s, id),
        there = s.actors[id].place;
      return (
        id !== actor &&
        entityActive(s, id) &&
        there !== here &&
        theirs.avatars.includes(actor) &&
        (theirs.location || there) === there &&
        handStatus(s, id, theirs).items.every((e) => e.met) &&
        theirs.avatars.every(
          (other) => other === actor || s.actors[other].place === there,
        ) &&
        toward(s, actor, there)
      );
    });
  const goMeet = (id) =>
    choose(
      toward(s, actor, s.actors[id].place),
      `Meet ${nameOf(id)}, who is waiting at ${nameOf(s.actors[id].place)}.`,
    );
  const acquire = (item, seen = new Set()) => {
    if (seen.has(item) || rootHolder(s, item) === actor) return null;
    seen = new Set([...seen, item]);
    const owner = rootHolder(s, item),
      local = itemPlace(s, item) === here;
    if (local) {
      const take = find("take", item);
      if (take) return choose(take, reason);
      const trade = acts.find(
        (a) =>
          a.kind === "trade" &&
          bundle(s, a.receive).includes(item) &&
          !needed(s, actor, a.item),
      );
      if (trade) return choose(trade, reason);
      if (
        hasMotives(s) &&
        actorIds.includes(owner) &&
        !willingToGive(s, owner, item, actor)
      ) {
        const help = acts.find(
          (a) =>
            a.kind === "give" &&
            a.target === owner &&
            !needed(s, actor, a.item) &&
            (needed(s, owner, a.item) ||
              (resentment(s, owner, actor) > 0 &&
                valueOf(s, owner, a.item) >= 4)),
        );
        if (help)
          return choose(
            help,
            `Help ${nameOf(owner)} with ${nameOf(help.item)} before asking for ${nameOf(item)}.`,
          );
      }
      let heldItem = item;
      while (s.items[s.items[heldItem].holder])
        heldItem = s.items[heldItem].holder;
      const ask = find("ask", heldItem);
      if (ask && willingToGive(s, owner, heldItem, actor))
        return choose(ask, reason);
      if (!hasSpace(s, actor, item)) {
        const drop = acts.find(
          (a) => a.kind === "drop" && !needed(s, actor, a.item),
        );
        if (drop) return choose(drop, "Make room for the target hand.");
        if (
          rootHolder(s, "cloth") === actor &&
          !hand.items.includes("cloth") &&
          find("take", "cloth")
        )
          return choose(
            find("take", "cloth"),
            "Uncover the object to make room.",
          );
      }
    }
    // A desired item can require another item as payment. Follow that need
    // through the same take, travel and trade rules, with cycle detection.
    if (
      programFor(s, actor)?.generated &&
      actorIds.includes(owner) &&
      !needed(s, owner, item)
    ) {
      for (const payment of requiredItems(s, owner, desireFor(s, owner))) {
        if (!hand.items.includes(payment) && rootHolder(s, payment) !== owner) {
          const purchase = acquire(payment, seen);
          if (purchase)
            return {
              ...purchase,
              reason: `Seek ${nameOf(payment)} to trade for ${nameOf(item)}.`,
            };
        }
      }
    }
    if (!local) {
      for (const crossing of routeBetween(s, here, itemPlace(s, item), actor)
        ? []
        : itemGateCrossings) {
        if (
          crossing.transport ||
          !actorCanVisit(actor, crossing.to, s) ||
          !routeBetween(s, crossing.to, itemPlace(s, item), actor)
        )
          continue;
        for (const gate of crossing.requires.filter(
          (condition) =>
            condition.kind === "item_present" &&
            itemPlace(s, condition.item) !== condition.place,
        )) {
          const key = acquire(gate.item, seen);
          if (key)
            return {
              ...key,
              reason: `Bring ${nameOf(gate.item)} to ${nameOf(gate.place)} to reach ${nameOf(item)}.`,
            };
          if (rootHolder(s, gate.item) === actor) {
            const doorstep = toward(s, actor, gate.place);
            if (doorstep)
              return choose(
                doorstep,
                `Bring ${nameOf(gate.item)} to ${nameOf(gate.place)}.`,
              );
          }
        }
      }
      const approach = toward(s, actor, itemPlace(s, item));
      return approach ? choose(approach, reason) : null;
    }
    if (
      actorIds.includes(owner) &&
      local &&
      needed(s, owner, item) &&
      programFor(s, actor)?.generated
    ) {
      const refusals = s.log.filter(
        (e) =>
          e.kind === "action" &&
          e.verb === "ask" &&
          e.actorId === actor &&
          e.targetId === owner &&
          e.itemId === item &&
          s.turn - e.turn <= 12,
      );
      const threat =
        here === "pond" && s.locations.pond.answer === "hush"
          ? null
          : find("threaten", undefined, owner);
      if (refusals.length >= 2 && threat)
        return choose(threat, "The same item is blocking both target hands.");
    }
    if (actorIds.includes(owner) && s.turn - s.actors[actor].lastTalk >= 3) {
      let heldItem = item;
      while (s.items[s.items[heldItem].holder])
        heldItem = s.items[heldItem].holder;
      if (find("ask", heldItem)) return choose(find("ask", heldItem), reason);
    }
    return null;
  };
  for (const item of missing
    .slice()
    .sort(
      (a, b) =>
        Number(itemPlace(s, b) === here) - Number(itemPlace(s, a) === here),
    )) {
    const next = acquire(item);
    if (next) return next;
  }
  if (missing.length) {
    // Stay while Vale is here holding a wanted item; the player may hand it over.
    const offered = missing.some(
      (id) =>
        controlledByHuman(s, rootHolder(s, id)) &&
        s.actors[rootHolder(s, id)].place === here,
    );
    const waiting = !offered && waitingHere(actorIds);
    return waiting ? goMeet(waiting) : idle(reason);
  }
  // Timing matters: reach the meeting place before using a brief sound or light.
  if (hand.conditions?.length) {
    if (
      hand.conditions.some((c) => c.kind === "lit") &&
      !s.items.lamp.fuel &&
      !s.items.oil.doses
    ) {
      if (here !== "pond")
        return choose(toward(s, actor, "pond"), "Call for oil at the pond.");
      if (covered(s, "bell"))
        return choose(find("take", "cloth"), "Unwrap the bell for the pond.");
      return choose(
        find("ring", "bell"),
        "Call one measure of oil into the empty flask.",
      );
    }
    if (hand.location && here !== hand.location)
      return choose(toward(s, actor, hand.location), reason);
    for (const c of hand.conditions.filter((c) => !conditionMet(s, c, actor))) {
      if (c.kind === "knows") {
        const source = s.knowledge?.facts?.[c.topic]?.source.actorId;
        if (source && s.actors[source].place !== here) return goMeet(source);
        return choose(
          find("talk", undefined, source),
          "Ask for the shared news.",
        );
      }
      if (c.kind === "heldBy") {
        if (s.items[c.item].holder !== actor && rootHolder(s, c.item) === actor)
          return choose(
            find("take", c.item),
            "Uncover the promised item before handing it over.",
          );
        if (s.actors[c.avatar].place !== here)
          return hand.location
            ? idle(
                `Wait for ${nameOf(c.avatar)} at ${nameOf(here)} to hand it over.`,
              )
            : goMeet(c.avatar);
        return choose(
          find("give", c.item, c.avatar),
          "Put the promised item in their hands.",
        );
      }
      if (c.kind === "covered")
        return choose(
          find("cover", "cloth", c.item),
          "Wrap the sound or light.",
        );
      if (covered(s, c.item))
        return choose(
          find("take", "cloth"),
          "Uncover the wanted sound or light.",
        );
      if (c.kind === "ringing")
        return choose(find("ring", "bell"), "Let the pond hear the bell.");
      if (c.kind === "lit") {
        if (!s.items.lamp.fuel)
          return choose(find("refill", "oil"), "Feed oil to the lamp.");
        return choose(find("light", "lamp"), "Make a light for the meeting.");
      }
    }
  }
  // Item affordances also apply when an avatar carries its target hand.
  if (hand.items.includes("lamp") && rootHolder(s, "lamp") === actor) {
    if (covered(s, "lamp") && !hand.items.includes("cloth"))
      return choose(find("take", "cloth"), "Uncover the light.");
    if (s.items.lamp.fuel <= 2 && find("refill", "oil"))
      return choose(find("refill", "oil"), "Feed oil to the lamp.");
    if (!s.items.lamp.lit && s.items.lamp.fuel > 0)
      return choose(find("light", "lamp"), "Light the lamp.");
  }
  if (
    hand.items.includes("cloth") &&
    rootHolder(s, "bell") === actor &&
    s.items.bell.ringing &&
    find("cover", "cloth", "bell")
  )
    return choose(find("cover", "cloth", "bell"), "Wrap the ringing bell.");
  // When both avatars hold their hands and wait, the later one in cast order
  // goes. Keep following that meeting across intermediate rooms instead of
  // returning to this avatar's own meeting place after the first step.
  const waiting = waitingHere(actorIds.slice(0, actorIds.indexOf(actor)));
  if (waiting) return goMeet(waiting);
  if (hand.location && here !== hand.location)
    return choose(toward(s, actor, hand.location), reason);
  const rescue = homeRescueExit(s, here, actor);
  if (
    rescue &&
    hand.avatars.some(
      (other) =>
        s.actors[other].place !== here &&
        !routeBetween(s, s.actors[other].place, here, other),
    )
  ) {
    if (!s.items.lamp.fuel && s.items.oil.doses > 0 && find("take", "oil"))
      return choose(
        find("take", "oil"),
        "Bring oil to the travelers at the shore.",
      );
    return choose(
      find("move", undefined, rescue),
      "Meet the waiting travelers at the shore.",
    );
  }
  return idle(
    handStatus(s, actor).met
      ? "Hold the target hand."
      : `Wait for ${hand.avatars
          .filter((id) => s.actors[id].place !== here)
          .map(nameOf)
          .join(" and ")} at ${nameOf(here)}.`,
  );
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
  const exact =
    legalActions(s, actor).find((a) => a.key === action?.key) ||
    resolveReadingReplay(s, actor, action?.key);
  if (!exact)
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  const next = structuredClone(s);
  if (actor !== "vale" || s.playerActorId) next.playerActorId = actor;
  for (const id of actorIds) installQuestCollection(next, id);
  if (entityActive(next, BOARDY) && lifeOf(next, BOARDY))
    ensureCollectedQuest(next, BOARDY, () => programPlaces(next), things);
  const previousHopes = Object.fromEntries(
    knownActors(s).map((id) => [id, lifeOf(s, id)?.milestones.length || 0]),
  );
  // Crossings open before the play decide whether a signal refreshes them.
  const round = beginRound(s, sensesFor(s));
  next.turn += 1;
  next.revision += 1;
  noteReadingDepartures(next);
  const reflectionSource = next.actors[actor].place;
  const wasOpen = reflectionOpen(next, reflectionSource);
  if (exact.kind === "wait")
    addLog(next, "World", `${nameOf(actor)} waits. The cast takes a turn.`);
  const met = new Map();
  if (exact.kind === "pursue") pursueQuest(next, actor, exact.questKey);
  captureHands(next, met);
  const active = knownActors(next);
  const respondent = perform(next, exact, () => captureHands(next, met), round);
  resolvePersonalQuests(next, exact);
  captureHands(next, met);
  if (
    next.opening &&
    !next.locations.attic.anchored &&
    exact.kind === "light" &&
    next.actors.vale.place === "attic"
  ) {
    next.locations.attic.anchored = true;
  }
  const residents = [
    ...new Set([
      "moth",
      "keeper",
      ...active.filter((id) => packIndependentJourneyDestination(next, id)),
      ...active.filter(
        (id) =>
          !controlledByHuman(next, id) &&
          (id === BOARDY || introductionPair(programFor(next, id))),
      ),
      ...active.filter(
        (id) =>
          isPackActor(id) &&
          !roamingQuestActor(id) &&
          entityActive(next, id) &&
          next.actors[id].place === next.actors[actor].place,
      ),
    ]),
  ];
  for (const actor of residents) {
    if (
      actor === respondent ||
      !active.includes(actor) ||
      controlledByHuman(next, actor)
    )
      continue;
    const program = programFor(next, actor);
    const key = focusedQuest(next, actor)?.key || program?.id;
    const target = introductionTarget(next, actor, key, program);
    perform(
      next,
      plan(next, actor).action,
      () => captureHands(next, met),
      round,
    );
    recordIntroductionTurn(next, actor, key, program, target);
    captureHands(next, met);
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
  publishQuestCompletions(next, [
    ...advancePrograms(next, met),
    ...syncStoryQuests(next, exact.actor),
  ]);
  installRoamingQuests(next, roamingActors, roamingAPI(next));
  for (const id of roamingActors) {
    if (controlledByHuman(next, id)) continue;
    if (id === respondent) next.roamingQuests[id].lastActedTurn = next.turn;
    const action = roamingPlan(next, id, roamingAPI(next));
    if (action) perform(next, action, () => {}, round);
    settleRoamingArrival(next, id, roamingAPI(next));
  }
  if (exact.kind === "wait")
    waitForTransport(next, next.actors[actor].place, actor);

  for (const actor of knownActors(next)) {
    const life = lifeOf(next, actor);
    if (life && life.milestones.length > (previousHopes[actor] || 0)) {
      const hope = hopeOf(next, actor);
      addLog(
        next,
        "World",
        `${nameOf(actor)} reaches a hope milestone: ${hope.milestones[life.milestones.length - 1].title}. Hope ${life.milestones.length}/${hope.milestones.length}.`,
        { actorId: actor },
      );
    }
  }
  for (const actor of settleLife(
    next,
    knownActors(next).filter(
      (id) => !controlledByHuman(next, id) || id === exact.actor,
    ),
    sanctuaries,
  )) {
    ensurePrograms(next);
    const origin = purposeOrigin(next, actor);
    const program = savedProgramFor(next, actor);
    if (!program) continue;
    addLog(
      next,
      "World",
      `${nameOf(actor)} finds a new purpose: ${program.name}.${origin ? ` It began with ${origin}.` : ""}`,
      { actorId: actor, questPlan: structuredClone(program) },
    );
  }
  for (const id of knownActors(next))
    collectExperienceQuests(next, id, () => programPlaces(next), things);
  ensurePrograms(next);
  refreshStalledPrograms(next);
  for (const [id, allowance] of Object.entries(
    next.sharedMigration?.inventoryAllowances || {},
  )) {
    const count = Math.min(allowance, carried(next, id).length);
    if (count <= 3) delete next.sharedMigration.inventoryAllowances[id];
    else next.sharedMigration.inventoryAllowances[id] = count;
  }
  settleQuestHands(next);
  noteReadingDepartures(next);
  validateWorld(next);
  return { ok: true, state: next };
}
function validHand(h, actor) {
  return (
    h &&
    Array.isArray(h.items) &&
    h.items.length <= 3 &&
    new Set(h.items).size === h.items.length &&
    h.items.every((id) => ids.includes(id)) &&
    (h.location === null || Object.hasOwn(places, h.location)) &&
    Array.isArray(h.avatars) &&
    h.avatars.length <= 2 &&
    new Set(h.avatars).size === h.avatars.length &&
    h.avatars.every((id) => actorIds.includes(id) && id !== actor) &&
    (h.conditions === undefined ||
      (Array.isArray(h.conditions) &&
        h.conditions.length <= 3 &&
        h.conditions.every((c) => validCondition(c, actor)))) &&
    (h.consequence === undefined || validConsequence(h.consequence, actor)) &&
    (h.passage === undefined ||
      (h.passage &&
        roamingActors.includes(h.passage.actor) &&
        ["directions", "passage"].includes(h.passage.kind) &&
        Object.hasOwn(places, h.passage.from) &&
        Object.hasOwn(places, h.passage.to)))
  );
}
function validQuestOrigin(s, origin) {
  return (
    origin === null ||
    (origin &&
      Object.keys(origin).every((key) =>
        ["kind", "turn", "other", "item", "place"].includes(key),
      ) &&
      experienceKinds.includes(origin.kind) &&
      Number.isSafeInteger(origin.turn) &&
      origin.turn >= 0 &&
      origin.turn <= s.turn &&
      (origin.other === null || actorIds.includes(origin.other)) &&
      (origin.item === null || ids.includes(origin.item)) &&
      (origin.place === null || Object.hasOwn(places, origin.place)))
  );
}
function validProgram(p, actor, s, shared = false) {
  if (
    !p ||
    (!shared && !actorIds.includes(actor)) ||
    typeof p.id !== "string" ||
    p.id.length > 80 ||
    !p.id.length ||
    typeof p.name !== "string" ||
    p.name.length > 100 ||
    !p.name.length ||
    !Array.isArray(p.steps) ||
    !p.steps.length ||
    p.steps.length > 12
  )
    return false;
  if (
    p.purpose !== undefined &&
    (typeof p.purpose !== "string" || p.purpose.length > 240)
  )
    return false;
  for (const step of p.steps) {
    const options = step?.any ?? [step];
    if (
      !Array.isArray(options) ||
      !options.length ||
      options.length > 6 ||
      !options.every((h) => validHand(h, actor))
    )
      return false;
  }
  if (p.generated) {
    const g = p.generated;
    const pair = introductionPair(p);
    if (!validIntroductionProgram(p)) return false;
    if (
      !Number.isSafeInteger(g.turn) ||
      g.turn < 0 ||
      g.turn > s.turn ||
      !Number.isSafeInteger(g.level) ||
      g.level < (lifeOf(s, actor)?.collection ? 1 : 3) ||
      g.level > s.turn * (lifeOf(s, actor)?.collection ? 8 : 1) + 1 ||
      ![...actorIds, ...Object.keys(places)].includes(g.owner) ||
      (pair
        ? g.item !== null ||
          g.owner !== actor ||
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          new Set(pair).size !== 2 ||
          pair.some((id) => !actorIds.includes(id) || id === actor) ||
          g.partner !== pair[0]
        : g.solo === undefined
          ? !ids.includes(g.item) ||
            !actorIds.includes(g.partner) ||
            g.partner === actor
          : g.solo !== true ||
            g.owner !== actor ||
            g.partner !== null ||
            (g.item !== null && !ids.includes(g.item)))
    )
      return false;
  }
  return true;
}
// JSON hosts may reorder object keys. Save equality follows values and array order.
function sameValue(a, b) {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
  );
}
export function validateWorld(s) {
  const fail = () => {
    throw new Error(
      "This save needs a fresh start. Your previous save is kept until you choose New game.",
    );
  };
  if (
    !s ||
    s.readingView !== undefined ||
    s.schema !== 7 ||
    !Number.isSafeInteger(s.turn) ||
    s.turn < 0 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < s.turn
  )
    fail();
  if (
    !validKnowledge(s, actorIds, Object.keys(places), authoredKnowledgeTopics())
  )
    fail();
  if (
    !validSharedQuestRegistry(s, {
      actors: actorIds,
      items: ids,
      places: Object.keys(places),
      program: (p, actor) => validProgram(p, actor, s, true),
      origin: (value) => validQuestOrigin(s, value),
      story: createStoryQuestValidator(s),
    }) ||
    !validQuestHands(s) ||
    !validQuestCompletions(s, actorIds, Object.keys(places))
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
    !validRoamingQuests(
      s,
      roamingActors,
      Object.keys(places),
      authoredRouteEdges(),
    )
  )
    fail();
  if (
    !validMemories(s) ||
    !validMotives(s) ||
    !validIntroductionVisits(s, actorIds, Object.keys(places)) ||
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
    if (!validTrust(a.trust, id, trustActorIds)) fail();
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
    // Pack residents follow their own interests, never authored programs.
    if (isPackActor(id) && !personalQuestActor(id)) {
      if (!sameValue(a.progress, newProgress())) fail();
      continue;
    }
    if (
      isPackActor(id) &&
      personalQuestActor(id) &&
      !lifeOf(s, id)?.collection &&
      sameValue(a.progress, newProgress())
    )
      continue;
    const progress = a.progress,
      programs = programsFor(s, id);
    if (
      !progress ||
      !Number.isSafeInteger(progress.program) ||
      progress.program < 0 ||
      progress.program > s.turn * (lifeOf(s, id)?.collection ? 8 : 1) ||
      !Number.isInteger(progress.step) ||
      progress.step < 0
    )
      fail();
    const program = savedProgramFor(s, id);
    const personalActive = !lifeOf(s, id) || lifeOf(s, id).phase === "active";
    const resting = !personalActive && progress.step === 0;
    if (
      (!program && !resting) ||
      (program &&
        (!validProgram(program, id, s) ||
          progress.step >= program.steps.length)) ||
      (!personalActive && !resting)
    )
      fail();
    const collection = lifeOf(s, id)?.collection;
    if (collection) {
      const cards = collectionCards(s, id);
      const archive = collectionCards(s, id, true);
      if (
        !Array.isArray(cards) ||
        cards.length > 32 ||
        !Array.isArray(archive) ||
        cards.length + archive.length > 256 ||
        archive.some(
          (q) =>
            !q ||
            typeof q.key !== "string" ||
            !q.key.startsWith(`${id}:quest:`) ||
            q.key.length > 80 ||
            !validQuestOrigin(s, q.origin) ||
            !q.program ||
            typeof q.program.id !== "string" ||
            typeof q.program.name !== "string" ||
            q.program.name.length > 120 ||
            typeof q.program.purpose !== "string" ||
            q.program.purpose.length > 240 ||
            !Array.isArray(q.program.steps) ||
            q.program.steps.length !== 0 ||
            !Number.isInteger(q.totalSteps) ||
            q.totalSteps < 1 ||
            q.totalSteps > 32 ||
            q.step !== q.totalSteps ||
            !Number.isSafeInteger(q.createdTurn) ||
            q.createdTurn < 0 ||
            !Number.isSafeInteger(q.completedTurn) ||
            q.completedTurn < q.createdTurn ||
            q.completedTurn > s.turn,
        ) ||
        new Set([...cards, ...archive].map((q) => q.key)).size !==
          cards.length + archive.length ||
        !Number.isSafeInteger(collection.next) ||
        collection.next < cards.length + archive.length ||
        !Number.isSafeInteger(collection.earned) ||
        collection.earned < 0 ||
        collection.earned > s.turn * 8 ||
        !Number.isSafeInteger(collection.archivedCompleted) ||
        collection.archivedCompleted < 0 ||
        !Number.isSafeInteger(collection.authoredThrough) ||
        collection.authoredThrough < 0 ||
        collection.authoredThrough > programs.length ||
        !Number.isSafeInteger(collection.collectedThrough) ||
        collection.collectedThrough < 0 ||
        collection.collectedThrough > s.turn ||
        (collection.lastOfferTurn !== undefined &&
          (!Number.isSafeInteger(collection.lastOfferTurn) ||
            collection.lastOfferTurn < 0 ||
            collection.lastOfferTurn > s.turn)) ||
        new Set(cards.map((q) => q.key)).size !== cards.length ||
        cards.filter(
          (q) => q.completedTurn === null && questCarried(s, id, q.key),
        ).length > 8 ||
        cards.some(
          (q) =>
            !q ||
            typeof q.key !== "string" ||
            !q.key.startsWith(`${id}:quest:`) ||
            q.key.length > 80 ||
            !validQuestOrigin(s, q.origin) ||
            (q.lastProgressTurn !== undefined &&
              (!Number.isSafeInteger(q.lastProgressTurn) ||
                q.lastProgressTurn < q.createdTurn ||
                q.lastProgressTurn > s.turn)) ||
            !validProgram(q.program, id, s) ||
            !Number.isInteger(q.step) ||
            q.step < 0 ||
            !Number.isSafeInteger(q.createdTurn) ||
            q.createdTurn < 0 ||
            q.createdTurn > s.turn ||
            (q.completedTurn === null
              ? q.step >= q.program.steps.length
              : !Number.isSafeInteger(q.completedTurn) ||
                q.completedTurn < q.createdTurn ||
                q.completedTurn > s.turn ||
                q.step !== q.program.steps.length),
        ) ||
        collection.archivedCompleted +
          archive.length +
          cards.filter((q) => q.completedTurn !== null).length !==
          progress.program ||
        (collection.active !== null &&
          !cards.some(
            (q) =>
              q.key === collection.active &&
              q.completedTurn === null &&
              q.step === progress.step,
          )) ||
        (collection.active === null && progress.step !== 0) ||
        !Array.isArray(progress.marks) ||
        progress.marks.length !== Math.min(32, collection.earned) ||
        progress.marks.some(
          (turn, i) =>
            !Number.isSafeInteger(turn) ||
            turn < 1 ||
            turn > s.turn ||
            (i > 0 && turn < progress.marks[i - 1]),
        )
      )
        fail();
      continue;
    }
    let completed = programs
      .slice(0, progress.program)
      .reduce((n, p) => n + p.steps.length, 0);
    if (progress.program >= programs.length) {
      if (
        !Number.isSafeInteger(progress.completedHands) ||
        progress.completedHands <
          completed + (progress.program - programs.length) ||
        progress.completedHands >
          completed + 12 * (progress.program - programs.length) ||
        (program &&
          (program.id !== `generated-${id}-${levelOf(s, id)}` ||
            program.generated?.level !== levelOf(s, id))) ||
        !Array.isArray(progress.recent) ||
        progress.recent.length > 4 ||
        progress.recent.some((item) => !ids.includes(item))
      )
        fail();
      completed = progress.completedHands;
      if (
        progress.recentKinds !== undefined &&
        (!Array.isArray(progress.recentKinds) ||
          progress.recentKinds.length > 4 ||
          progress.recentKinds.some(
            (kind) =>
              ![
                "crossing",
                "answer",
                "delivery",
                "gathering",
                "introduction",
                "bargain",
              ].includes(kind),
          ))
      )
        fail();
    } else if (
      progress.current ||
      progress.completedHands !== undefined ||
      progress.recent !== undefined
    )
      fail();
    const count = completed + progress.step;
    if (
      count > s.turn ||
      !Array.isArray(progress.marks) ||
      progress.marks.length !== Math.min(32, count) ||
      progress.marks.some(
        (turn, i) =>
          !Number.isSafeInteger(turn) ||
          turn < 1 ||
          turn > s.turn ||
          (i > 0 && turn <= progress.marks[i - 1]),
      )
    )
      fail();
  }

  const itemHolders = new Set([...actorIds, ...Object.keys(places)]);
  const heldCounts = new Map();
  for (const [id, item] of Object.entries(s.items)) {
    if (
      !itemHolders.has(item.holder) &&
      !personalNesting(s, packDefinitions, id, item.holder) &&
      !(id === "cloth" && ["lamp", "bell"].includes(item.holder))
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
    if (countableItem(s, id)) {
      const holder = rootHolder(s, id);
      heldCounts.set(holder, (heldCounts.get(holder) || 0) + 1);
    }
  }
  for (const actor of actorIds) {
    const allowance = s.sharedMigration?.inventoryAllowances?.[actor];
    const count = heldCounts.get(actor) || 0;
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
    "personal-quest-complete",
    "drop-quest",
    "join-quest",
    "share-quest",
    "accompany",
    "threaten",
    "guard",
    "attack",
    "move",
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
    "read",
    "use",
  ];
  for (const e of s.log) {
    if (!validPrivateAudience(s, e.privateTo)) fail();
    if (!validRecallRef(s, e.recall, e.privateTo)) fail();
    if (!validHearingRef(s, e.hearing, e.privateTo, e.turn, e.locationId))
      fail();
    if (e.seq !== undefined) {
      if (!Number.isSafeInteger(e.seq) || e.seq <= seq || e.seq > s.eventSeq)
        fail();
      seq = e.seq;
    }
    if (
      e.kind !== undefined &&
      !["action", "dialogue", "narration", "input", "hint", "quest"].includes(
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
        (choice.repeatable
          ? !(s.packs[e.packId].receipts[e.choiceId] >= e.turn)
          : s.packs[e.packId].receipts[e.choiceId] !== e.turn)
      )
        fail();
    } else if (e.packId !== undefined || e.choiceId !== undefined) fail();
    if (e.destinationId != null && !Object.hasOwn(places, e.destinationId))
      fail();
    if (e.accepted !== undefined && typeof e.accepted !== "boolean") fail();
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
    if (e.questPlan !== undefined && !validProgram(e.questPlan, e.actorId, s))
      fail();
    if (
      e.consequence !== undefined &&
      !validConsequence(e.consequence, e.actorId)
    )
      fail();
    if (e.kind === "quest") {
      const authored = s.actors[e.actorId] ? programsFor(s, e.actorId) : [];
      const authoredIndex = authored.findIndex((p) => p.id === e.programId);
      const program = e.program || authored[authoredIndex];
      const index = e.programIndex ?? authoredIndex;
      if (
        !validProgram(program, e.actorId, s) ||
        program.id !== e.programId ||
        (e.questMode !== "shared" &&
          (!Number.isSafeInteger(index) ||
            index < 0 ||
            index > s.actors[e.actorId].progress.program)) ||
        !Number.isInteger(e.step) ||
        e.step < 0 ||
        e.step >= program.steps.length ||
        (e.questMode !== "shared" &&
          e.level !==
            index + 1 + Number(e.step === program.steps.length - 1)) ||
        (e.questMode !== "shared" &&
          program.generated &&
          (program.generated.level !== index + 1 ||
            program.id !== `generated-${e.actorId}-${index + 1}`))
      )
        fail();
      const options = alternatives(program.steps[e.step]),
        target = e.target || options[0];
      if (
        !validHand(target, e.actorId) ||
        !options.some((h) => sameValue(h, target))
      )
        fail();
      if (e.fulfillment !== undefined) {
        const seen = e.fulfillment;
        if (
          !seen ||
          !Array.isArray(seen.items) ||
          seen.items.length > 3 ||
          new Set(seen.items).size !== seen.items.length ||
          seen.items.some((id) => !ids.includes(id)) ||
          !Object.hasOwn(places, seen.location) ||
          !Array.isArray(seen.avatars) ||
          seen.avatars.length > 2 ||
          new Set(seen.avatars).size !== seen.avatars.length ||
          seen.avatars.some(
            (id) => !actorIds.includes(id) || id === e.actorId,
          ) ||
          target.items.some((id) => !seen.items.includes(id)) ||
          (target.location && target.location !== seen.location) ||
          target.avatars.some((id) => !seen.avatars.includes(id))
        )
          fail();
        if (
          target.conditions?.length &&
          !sameValue(
            seen.conditions,
            target.conditions.map((c) => ({ ...c, met: true })),
          )
        )
          fail();
      }
    }
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
  upgradeSave(s, {
    actorIds,
    ensurePrograms,
    installPacks,
    profileOf: (id) => tastes[id],
  });
  validateWorld(s);
  preserveTransportAccess(s);
  settleQuestHands(s);
  return validateWorld(s);
}
