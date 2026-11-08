import { stationExitOrder, stationExits, validStationExitOrder } from "./station-exits.mjs";
import {
  recordConversation,
  settleCompany,
  installConversations,
  validConversations,
} from "./conversation.mjs";
import { expressionOf } from "./expression.mjs";
import {
  pressureBeforeGive,
  validHandover,
  validThreatSource,
} from "./handover.mjs";
import { installJourneyProgress } from "./pack-journeys.mjs";
import { levelTier } from "./level-tiers.mjs";
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
import { meetHidden, validHidden } from "./hidden-avatar.mjs";
import { placeDoors, validDoors } from "./homecoming.mjs";
import {
  currentActor,
  humanAvatar,
  humanAvatarIds,
  controlledByHuman,
  humanPresent,
  sharedEnabled,
  humanRoomAvailable,
  humanHomeGates,
  heldByHuman,
  residentAvatar,
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
  repairAnswer,
  closeRepaired,
  validMotives,
  tastes,
} from "./motives.mjs";
import { newMemories, rememberEvent, validMemories } from "./memory.mjs";
import { handSnapshot, settleHeldItems, validHeldItems } from "./held-item.mjs";
import {
  installKnowledge,
  witnessKnowledge,
  reserveKnowledge,
  reserveLaneKnowledge,
  acceptKnowledgeSpeech,
  witnessRepair,
  validKnowledge,
} from "./knowledge.mjs";
import {
  knownActors as readKnownActors,
  installWants,
  wake,
  repairRestTargets,
  dropQuest,
  focusQuest,
  claimQuestReward,
  questRewardsOf,
  pushQuest,
  questsOf,
  questTerms,
  allQuestsOf,
  beginQuestPlay,
  endQuestPlay,
  levelOf,
  levelReturnHome,
  settleHomeLevels,
  wantOf,
  wantKey,
  travels,
  resting,
  settleWants,
  meetsItemWant,
  refuseWant,
  reviseStalledWants,
  setAsideWant,
  fillWants,
  renewWant,
  validWant,
  WANT_KINDS,
  CONNECT_TARGET,
} from "./want.mjs";
import { pruneTalkQuests, talkQuest } from "./talk-quest.mjs";
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
  personalRouteOpen,
  latchRoutes,
  validOpenedRoutes,
  packChoices,
  applyPackChoice,
  applyMeetingChoices,
  applyHoldChoices,
  packGiveChoice,
  makerChoice,
  packWaitChoice,
  applyDeparture,
  departureWaits,
  packTalkChoice,
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
  recordJourneyTravel,
  roamingQuestActor,
  avoidsStandoffs,
  transports,
  consumable,
} from "./pack-registry.mjs";
import {
  newCrossingState,
  newPackRecord,
  newTemperament,
  crossingExits,
  crossingOpen,
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
  runHash,
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
import { settleVisitSpeech, validVisitSpeech } from "./visit-speech.mjs";
import { firstStart, togglePack, validDisabledPacks } from "./pack-toggle.mjs";
import {
  consume,
  settleCrafting,
  installItemCycle,
  settleItemCycle,
  settleVoyageCargo,
  validItemCycle,
  validCraftEvent,
  reservedItem,
} from "./pack-items.mjs";
import { installSpecials, validSeed } from "./pack-specials.mjs";
import forest from "./forest.json" with { type: "json" };
import { BOARDY, connectedHumans } from "./boardyai.mjs";
import {
  lifeHome,
  rangeOf,
  wanders,
  mayBoard,
  inRange,
  rangeTest,
  walksHome,
  keepsHome,
  lifeDataProblems,
  validHome,
  noteRoomArrival,
  noteResidentInteraction,
  residentCourtesy,
  validResidentCourtesy,
  OFFSTAGE_STEPS,
  worldLife,
} from "./resident-home.mjs";
import { bedtime, residentAsleep, validSleep } from "./resident-sleep.mjs";
import {
  guardableWays,
  guardedExits,
  guardedFrom,
  isGuardable,
  guardPost,
  guardOf,
  wayLifted,
  settleGuards,
  validGuard,
} from "./resident-guard.mjs";

// Authored forest data and mounted packs share the same rule path.
export const places = { ...forest.places, ...packPlaces };
const homeGates = { ...forest.homeGates, ...humanHomeGates };
export const sanctuaries = Object.keys(places).filter(
  (id) => places[id].sanctuary === true,
);
export const p…29043 tokens truncated….
  if (next.actors[actor].sleeping && !exact.sleep)
    wakeUp(next, actor, "chose", `${nameOf(actor)} wakes.`);
  const reflectionSource = next.actors[actor].place;
  const wasOpen = reflectionOpen(next, reflectionSource);
  const active = knownActors(next);
  const residents = [
    ...new Set([
      "moth",
      "keeper",
      ...active.filter((id) => id === BOARDY && !controlledByHuman(next, id)),
      // Avatars nobody steers here live as residents where they stand.
      ...active.filter(
        (id) =>
          residentAvatar(next, id) &&
          next.actors[id].place === next.actors[actor].place,
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
    // A sleeper makes no play unless a fight wakes it (rules 100).
    if (residentAsleep(next, id) && !standoffFor(next, id)) continue;
    wakeResident(next, id);
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
    if (controlledByHuman(next, id) || id === respondent ||
      !roamingQuestActor(id, s) || !roamingQuestActor(id, next)) continue;
    const from = next.actors[id].place;
    rememberRoutes(next, id, visibleRouteEdges(from));
    const chosen = plan(next, id);
    if (chosen.callShip) callTransport(next, from, true);
    if (chosen.action.kind !== "wait" || standoffFor(next, id))
      perform(next, chosen.action, round, [id]);
    else rest(next, id, from);
    rememberRoutes(next, id, visibleRouteEdges(next.actors[id].place));
    if (next.actors[id].place !== from)
      arriveRoamingRecitals(next, packDefinitions, id);
  }
  residentRound(next, [actor, respondent, ...residents].filter(Boolean));
  // Sleeping at a dock calls no ship: only the Wait before it does.
  if (exact.kind === "wait" && !exact.sleep)
    waitForTransport(next, next.actors[actor].place, actor);
  const voyages = sailTransports(next);
  for (const voyage of voyages) {
    const ship = transports[voyage.id].place;
    addLog(
      next,
      "World",
      voyage.kind === "arrive"
        ? `${nameOf(ship)} docks at ${nameOf(voyage.dock)}.`
        : voyage.kind === "home"
          ? `With no cargo to sail on, ${nameOf(ship)} puts in at ${nameOf(voyage.dock)}, and everyone aboard goes ashore.`
          : `${nameOf(ship)} ${voyage.idle ? "sails on its own" : "casts off"} for ${nameOf(voyage.to)}.`,
      { locationId: voyage.kind === "home" ? voyage.dock : ship },
    );
    // Residents put ashore set that pursuit aside.
    if (voyage.kind === "home")
      for (const id of voyage.ashore)
        if (!humanHeld(next, id)) setAsideWant(next, id, wantAPI(next));
  }
  const worldLine = (text, locationId) =>
    addLog(next, "World", text, { kind: "narration", locationId });
  settleVoyageCargo(next, voyages, nameOf, worldLine);
  wakeSleepers(next, s, voyages);
  // Regrowth, the dawn safeguard and kits follow the light and long rests.
  settleItemCycle(next, nameOf, worldLine);
  reviseStalledWants(
    next,
    wantActors(next, [...residents, ...roamingActors]).filter(
      (id) => !controlledByHuman(next, id),
    ),
    wantAPI(next),
  );
  pruneTalkQuests(next, wantAPI(next));
  fillWants(next, wantAPI(next));
  settleHomeLevels(next);
  // A round of waits still ends a standoff nobody would carry on.
  settleStandoffs(next);
  // A gate whose condition now holds stays open from here on.
  latchRoutes(next);
  settleGuards(next);
  settleCompany(next, entityActive);
  settleVisitSpeech(s, next, exact);
  for (const [id, allowance] of Object.entries(
    next.sharedMigration?.inventoryAllowances || {},
  )) {
    const count = Math.min(allowance, carried(next, id).length);
    if (count <= 3) delete next.sharedMigration.inventoryAllowances[id];
    else next.sharedMigration.inventoryAllowances[id] = count;
  }
  settleHeldItems(next, handSnapshot(s));
  endQuestPlay(next);
  settleStationExits(next);
  validateWorld(next);
  // Alone, the world runs on around a sleeper until something wakes it.
  // It stops at the first refused play, and the sleep cap bounds it.
  let slept = next;
  if (!s.actors[actor].sleeping && !sharedEnabled(next))
    for (let i = 0; i < SLEEP_TURNS && slept.actors[actor].sleeping; i++) {
      const on = play(
        slept,
        legalActions(slept, actor).find((a) => a.sleep),
        slept.revision,
        actor,
      );
      if (!on.ok) break;
      slept = on.state;
    }
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
  if (!validStationExitOrder(s, stationTargets)) fail();
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
  for (const field of ["controlledActors", "presentActors", "heldActors"]) {
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
      (o.leftHome !== undefined && typeof o.leftHome !== "boolean") ||
      !o.met ||
      o.met.vale !== 0 ||
      Object.keys(o.met).some((id) => !actorIds.includes(id)) ||
      Object.values(o.met).some(
        (turn) => !Number.isSafeInteger(turn) || turn < 0 || turn > s.turn,
      ) ||
      (!sharedEnabled(s) &&
        o.met.keeper !== undefined &&
        o.met.moth === undefined &&
        !leftHome(s)) ||
      (!o.crossed &&
        (!openingPlace(s.actors?.vale?.place) ||
          Object.keys(o.met).some(
            (id) => id !== "vale" && !roamingActors.includes(id),
          ))) ||
      (o.version === 1 && o.crossed && !s.locations?.attic.anchored) ||
      (o.crossed && o.met.moth === undefined && !leftHome(s)) ||
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
  if (!validPackState(s, sensesFor(s)) || !validItemCycle(s)) fail();
  if (
    !validConversations(s) ||
    !validHeldItems(s) ||
    !validOpenedRoutes(s.openedRoutes) ||
    !validHidden(s) ||
    !validDoors(s) ||
    (s.hidden && !Object.hasOwn(places, s.hidden.place))
  )
    fail();
  if (
    !validRouteKnowledge(s, [...authoredRouteEdges(), ...laneEdges()]) ||
    !validMemories(s) ||
    !validMotives(s) ||
    !validLife(s, Object.keys(places)) ||
    !validHome(s) ||
    !validResidentCourtesy(s, places) ||
    !validSleep(s, places) ||
    !validGuard(s, places)
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
      c.opened > s.turn ||
      !validThreatSource(s, c)
    )
      fail();
    const pair =
      c.resolve && typeof c.resolve === "object" ? fightersOf(c) : [];
    if (
      pair.length < 2 ||
      pair.some((id) => !actorIds.includes(id) || fighting.has(id))
    )
      fail();
    for (const id of pair) fighting.add(id);
    if (
      pair.some(
        (id) => s.actors[id].place !== c.location || s.peaceUntil[id] > s.turn,
      ) ||
      (c.item && rootHolder(s, c.item) !== c.defender)
    )
      fail();
    for (const field of ["resolve", "guarding", "struck", "steppedBack"])
      if (
        !c[field] ||
        Object.keys(c[field]).sort().join() !== pair.slice().sort().join()
      )
        fail();
    // Guard and last-hit maps name combatants (absent before rules 84).
    for (const map of [c.covering, c.hitBy])
      if (
        map !== undefined &&
        (!map ||
          typeof map !== "object" ||
          Object.entries(map).some(
            ([id, other]) =>
              !pair.includes(id) || !pair.includes(other) || id === other,
          ))
      )
        fail();
    if (
      pair.some(
        (id) =>
          !Number.isInteger(c.resolve[id]) ||
          c.resolve[id] < 1 ||
          c.resolve[id] > 4 ||
          typeof c.guarding[id] !== "boolean" ||
          typeof c.struck[id] !== "boolean" ||
          typeof c.steppedBack[id] !== "boolean",
      )
    )
      fail();
  }
  for (const [id, a] of Object.entries(s.actors)) {
    if (!validVisitSpeech(a, s.turn)) fail();
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
      (a.sanctuary !== undefined && !sanctuaries.includes(a.sanctuary)) ||
      (a.sleeping !== undefined &&
        a.sleeping?.until === undefined &&
        (!a.sleeping ||
          Object.keys(a.sleeping).sort().join() !== "place,present,since" ||
          !Number.isSafeInteger(a.sleeping.since) ||
          a.sleeping.since < 0 ||
          a.sleeping.since > s.turn ||
          s.turn - a.sleeping.since >= SLEEP_TURNS ||
          !Object.hasOwn(places, a.sleeping.place) ||
          !Array.isArray(a.sleeping.present) ||
          a.sleeping.present.some(
            (x, i, all) => !actorIds.includes(x) || (i && all[i - 1] >= x),
          )))
    )
      fail();
    if (
      !validWant(s, id) ||
      a.visited.length > Object.keys(places).length ||
      a.visited.some((place) => !Object.hasOwn(places, place)) ||
      allQuestsOf(s, id).some(
        (w) => w.kind === "place" && !Object.hasOwn(places, w.target),
      )
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
  if (!validDisabledPacks(s.disabledPacks)) fail();
  let seq = 0;
  const verbs = [
    "want_met",
    "accompany",
    "threaten",
    "guard",
    "intercept",
    "attack",
    "retreat",
    "sent-home",
    "move",
    "course",
    "take",
    "drop",
    "focus",
    "claim",
    "craft",
    "gate",
    "pack",
    "give",
    "ask",
    "light",
    "snuff",
    "ring",
    "refuel",
    "eat",
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
    if (!validHandover(s, e)) fail();
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
    if (!validCraftEvent(s, e)) fail();
    if (
      e.verb === "craft" &&
      (!places[e.locationId] ||
        (!holderIds.has(e.holderId) && !ids.includes(e.holderId)))
    )
      fail();
    if (
      e.verb === "claim"
        ? e.kind !== "action" ||
          e.generated ||
          !actorIds.includes(e.actorId) ||
          !Number.isSafeInteger(e.seq) ||
          !Number.isSafeInteger(e.receipt) ||
          e.receipt < 1 ||
          e.receipt >= e.seq
        : e.receipt !== undefined
    )
      fail();
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
    if (
      (e.rest !== undefined && (e.rest !== "long" || e.verb !== "wait")) ||
      (e.sleep !== undefined && (e.sleep !== true || e.verb !== "wait")) ||
      (e.dream !== undefined &&
        (!DREAMS.includes(e.dream) || e.rest !== "long")) ||
      (e.woke !== undefined &&
        (!WAKE_REASONS.includes(e.woke) || e.verb !== "wait")) ||
      (e.guards !== undefined &&
        (e.verb !== "wait" || !Object.hasOwn(places, e.guards)))
    )
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
      (e.wantKey !== undefined &&
        (e.verb !== "want_met" ||
          typeof e.wantKey !== "string" ||
          e.wantKey.length > 600 ||
          !e.wantKey.startsWith(
            `${e.actorId}:${e.wantMet?.kind}:${e.wantMet?.target}:`,
          ))) ||
      (e.questXp !== undefined &&
        (e.verb !== "want_met" ||
          !Number.isInteger(e.questXp) ||
          e.questXp < 2 ||
          e.questXp > levelTier(Infinity).rank + 1)) ||
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
    upgradeSave(s, {
      actorIds,
      installPacks,
      laneText: laneFactText,
      setAside: (world, id) =>
        !humanHeld(world, id) && setAsideWant(world, id, wantAPI(world)),
    });
    installJourneyProgress(s, packDefinitions);
    repairRestTargets(s, wantAPI(s));
    // An earlier save records the gates already open as it loads, and its
    // guards take their posts (rules 100).
    installConversations(s);
    latchRoutes(s);
    settleGuards(s);
    settleHeldItems(s);
    if (s.stationExitOrder === undefined) settleStationExits(s);
    validateWorld(s);
    preserveTransportAccess(s);
  } catch (error) {
    // A save that cannot be read starts fresh; it never surfaces a crash.
    if (error instanceof TypeError) return validateWorld(null);
    throw error;
  }
  return validateWorld(s);
}
