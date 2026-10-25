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
} from "./motives.mjs";
import {
  newMemories,
  rememberEvent,
  migrateMemories,
  validMemories,
} from "./memory.mjs";
import {
  questPrograms,
  programsFor,
  knownActors,
  newProgress,
  programFor,
  savedProgramFor,
  desireFor,
  levelOf,
  targetsFor,
  alternatives,
  generateProgram,
  sequence,
} from "./quests.mjs";
import {
  lifeOf,
  questActive,
  keepReason,
  stayingWith,
  recordLifeAction,
  finishPersonalQuest,
  validLife,
  INSPIRATION_MAX,
  hopes,
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
  packDefinitions,
  packPlaces,
  packPeople,
  packThings,
  isPackActor,
  entityActive,
  actorCanVisit,
  packExits,
  packChoices,
  applyPackChoice,
  validatePackStates,
  validatePackLinks,
  packDefinition,
} from "./pack-registry.mjs";
// The playable slice uses one rule path for the guided avatar and the cast.
export const places = {
  ...packPlaces,
  clearing: {
    name: "Forest Clearing",
    text: "The old Steam Clock ticks among the trees. Its bell can be rung. Badger rests on warm moss; a reflection between the roots answers only while a bell is sounding.",
    exits: [],
  },
  station: {
    name: "Empty station",
    text: "The timetable lists years that have yet to happen. Stairs lead to the attic; a path leads to the pond.",
    exits: ["attic", "pond"],
  },
  attic: {
    name: "Mirror attic",
    text: "A tall mirror reflects a black shore. The stairs lead to the station.",
    exits: ["station"],
  },
  pond: {
    name: "Black pond",
    text: "Something vast breathes beneath the reflection. A path leads to the station.",
    exits: ["station"],
  },
};
export const people = {
  ...packPeople,
  badger: {
    name: "Grumpy Badger",
    text: "Comically touchy. Very attached to his warm patch of moss.",
  },
  vale: {
    name: "Vale",
    text: "Your avatar. A traveller with a coat full of empty pockets.",
  },
  moth: {
    name: "Pip",
    text: "A moth in a borrowed waistcoat. Seeks a lamp and a witness at the pond.",
  },
  keeper: {
    name: "The keeper",
    text: "A tall figure with a clock for a face. Seeks a bell and a witness in the attic.",
  },
};
export const things = {
  ...packThings,
  lamp: {
    name: "Lamp",
    text: "An oil lamp with soot-darkened glass. Burns one fuel each turn, even under a cloth.",
  },
  oil: {
    name: "Oil flask",
    text: "Each dose adds four fuel to the lamp, up to twelve.",
  },
  bell: {
    name: "Bell",
    text: "A hand bell with a worn handle. Rings for three turns. Its ring carries far over still water. The Black cloth stops its sound.",
  },
  cloth: {
    name: "Black cloth",
    text: "Cover the lamp to block its light, or the bell to stop its sound. Travels with the covered object.",
  },
};
const ids = Object.keys(things);
const actorIds = [
  "vale",
  "moth",
  "keeper",
  "badger",
  ...Object.keys(packPeople),
];
validatePackLinks(places, people, things);
export const nameOf = (id) =>
  places[id]?.name || people[id]?.name || things[id]?.name || "the world";
export function createWorld({ opening = false } = {}) {
  const world = {
    schema: 6,
    locations: {
      attic: { anchored: false },
      pond: { answer: null, shipSignal: 0 },
    },
    standoffs: [],
    peaceUntil: { vale: 0, moth: 0, keeper: 0 },
    memories: newMemories(),
    turn: 0,
    revision: 0,
    eventSeq: 1,
    actors: {
      vale: {
        place: "station",
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
        trust: { moth: 0, keeper: 0 },
      },
      moth: {
        place: "pond",
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
        trust: { vale: 0, keeper: 0 },
      },
      keeper: {
        place: "attic",
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
        trust: { vale: 0, moth: 0 },
      },
    },
    items: {
      lamp: { holder: "station", fuel: 8, lit: false, history: [] },
      oil: { holder: "keeper", doses: 3, history: [] },
      bell: { holder: "station", ringing: 0, history: [] },
      cloth: { holder: "moth", history: [] },
    },
    log: [
      {
        seq: 1,
        turn: 0,
        kind: "narration",
        actorId: null,
        locationId: "station",
        cast: ["vale"],
        items: [
          { id: "lamp", holder: "station", fuel: 8, lit: false },
          { id: "bell", holder: "station", ringing: 0 },
        ],
        light: false,
        speaker: "World",
        text: "Vale arrives at the empty station. Pip carries a black cloth. The keeper holds the oil. Each wants something ... different. Under the pond, a presence is listening.",
      },
    ],
  };
  if (opening) {
    world.opening = { version: 1, crossed: false, met: { vale: 0 } };
    world.actors.vale.place = "attic";
    world.actors.keeper.place = "station";
    world.items.lamp.holder = "vale";
    world.log[0] = {
      ...world.log[0],
      locationId: "attic",
      items: [{ id: "lamp", holder: "vale", fuel: 8, lit: false }],
      text: "Vale stands alone in Mirror attic, holding an unlit lamp. A tall mirror reflects a black shore.",
    };
  }
  addSteamClock(world);
  addWorldPacks(world);
  rememberEvent(world, world.log[0]);
  return world;
}
// A missing pack marker identifies an old shore save. Once a marker exists,
// incomplete pack state must fail validation rather than respawning lost items.
function addWorldPacks(s) {
  if (s.packs !== undefined) return;
  s.packs = {};
  for (const pack of packDefinitions) {
    s.packs[pack.id] = {
      revision: pack.revision,
      choices: {},
      flags: {},
      receipts: {},
      met: {},
    };
    for (const [id, a] of Object.entries(pack.avatars)) {
      if (Object.hasOwn(s.actors, id))
        throw new Error("Duplicate pack actor in an unversioned save.");
      s.actors[id] = {
        place: a.place,
        progress: newProgress(),
        crossed: 0,
        lastTalk: -9,
        trust: Object.fromEntries(
          actorIds.filter((other) => other !== id).map((other) => [other, 0]),
        ),
      };
      s.peaceUntil[id] = 0;
    }
    for (const [id, item] of Object.entries(pack.items)) {
      if (Object.hasOwn(s.items, id))
        throw new Error("Duplicate pack item in an unversioned save.");
      s.items[id] = { holder: item.holder, history: [] };
    }
  }
  for (const [id, a] of Object.entries(s.actors)) {
    if (
      !isPackActor(id) &&
      a.trust &&
      typeof a.trust === "object" &&
      !Array.isArray(a.trust)
    )
      for (const other of Object.keys(packPeople)) a.trust[other] ??= 0;
  }
  const memories = newMemories();
  if (s.memories && typeof s.memories === "object")
    for (const id of [
      ...Object.keys(packPlaces),
      ...Object.keys(packPeople),
      ...Object.keys(packThings),
    ])
      s.memories[id] ??= memories[id];
  if (s.motives?.grievances && typeof s.motives.grievances === "object")
    for (const id of Object.keys(packPeople)) s.motives.grievances[id] ??= [];
}
// Add the clearing to earlier shore saves while retaining their state and history.
function addSteamClock(s) {
  if (s.steamClock !== undefined) {
    // Earlier saves remember discovery, but have no temporary access receipt.
    if (s.steamClock && s.steamClock.openUntil === undefined)
      s.steamClock.openUntil = 0;
    if (s.steamClock && s.steamClock.returnRingingUntil === undefined)
      s.steamClock.returnRingingUntil = 0;
    return;
  }
  s.steamClock = {
    rings: 0,
    discovered: false,
    openUntil: 0,
    returnRingingUntil: 0,
  };
  s.actors.badger = {
    place: "clearing",
    progress: newProgress(),
    crossed: 0,
    lastTalk: -9,
    trust: Object.fromEntries(
      Object.keys(s.actors)
        .filter((id) => id !== "badger")
        .map((id) => [id, 0]),
    ),
    awake: false,
    irritation: 0,
    wakeCause: null,
  };
  for (const [id, actor] of Object.entries(s.actors))
    if (id !== "badger") actor.trust.badger = 0;
  s.peaceUntil.badger = 0;
  const fresh = newMemories();
  for (const id of ["badger", "clearing"]) s.memories[id] = fresh[id];
  if (s.motives) s.motives.grievances.badger = [];
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
  s.items.lamp.lit && s.items.lamp.fuel > 0 && !covered(s, "lamp");
export const reflectionOpen = (s, from = null) =>
  // Discovery keeps the attic's escape open. Entry from the pond still needs
  // light here, resolved through the lamp's current holder and their location.
  from === "pond"
    ? shining(s) && itemPlace(s, "lamp") === "pond"
    : Boolean(s.locations?.attic.anchored) ||
      (shining(s) && ["attic", "pond"].includes(itemPlace(s, "lamp")));
export const clearingOpen = (s) =>
  s.steamClock?.discovered &&
  s.turn < s.steamClock.openUntil &&
  s.items.bell.ringing > 0 &&
  !covered(s, "bell") &&
  itemPlace(s, "bell") === "pond";
// A remembered crossing is not an open crossing. The clock's own bell is a
// local, repeatable way back when the hand bell was left on the other shore.
export const clockRinging = (s) =>
  s.turn < (s.steamClock?.returnRingingUntil ?? 0);
export const clearingReturnOpen = (s) =>
  Boolean(s.steamClock?.discovered) &&
  (clockRinging(s) ||
    (s.items.bell.ringing > 0 &&
      !covered(s, "bell") &&
      ["pond", "clearing"].includes(itemPlace(s, "bell"))));
// Count resolved cover/uncover transitions, not inspection, retries or the
// current brightness alone. Phase 4 is the second complete flash and summons.
export const shipSignalPhase = (s) => s.locations?.pond?.shipSignal ?? 0;
const shipSignalConditions = (s) =>
  s.actors.vale.place === "pond" &&
  s.items.lamp.lit &&
  s.items.lamp.fuel > 0 &&
  itemPlace(s, "lamp") === "pond" &&
  !(
    s.items.bell.ringing > 0 &&
    !covered(s, "bell") &&
    ["pond", "clearing"].includes(itemPlace(s, "bell"))
  ) &&
  !clockRinging(s);
export const greekShipPresent = (s) =>
  shipSignalPhase(s) === 4 &&
  shipSignalConditions(s) &&
  !covered(s, "lamp") &&
  packExits(s, "pond", "vale").includes("greek-harbor");
function advanceShipSignal(s, action, before) {
  if (!before.ready || !shipSignalConditions(s)) {
    s.locations.pond.shipSignal = 0;
    return;
  }
  const nowCovered = covered(s, "lamp");
  if (before.covered === nowCovered) return;
  const player = action.actor === "vale";
  const covering =
    player &&
    action.kind === "cover" &&
    action.item === "cloth" &&
    action.target === "lamp" &&
    nowCovered;
  const uncovering =
    player &&
    action.kind === "take" &&
    action.item === "cloth" &&
    before.covered &&
    !nowCovered;
  s.locations.pond.shipSignal = covering
    ? before.phase === 2
      ? 3
      : 1
    : uncovering && [1, 3].includes(before.phase)
      ? before.phase + 1
      : 0;
}
const baseExits = (s, place) =>
  s.opening
    ? places[place].exits.filter((to) => ![place, to].includes("attic"))
    : places[place].exits;
export const placeText = (s, place) =>
  place === "clearing"
    ? clearingReturnOpen(s)
      ? "A bell sounds among the Steam Clock's roots. Its dark reflection opens onto Black pond. The clock's bell can be rung again before the sound fades."
      : "The Steam Clock ticks among the trees. The roots show only moss: no path to Black pond is visible. Ring the clock's bell to reopen the crossing."
    : place === "pond"
      ? greekShipPresent(s)
        ? "Lamplight lies across the quiet Black pond. A Greek ship waits on the reflection; its gangway leads to the Wine-Dark Harbor. The shore path to the station remains."
        : shipSignalPhase(s) >= 2
          ? "One flash has crossed the quiet pond. Cover and uncover the lit lamp once more with the Black cloth. The path to the station remains."
          : "Black pond holds the lamp's reflection. In quiet, cover and uncover the lit lamp twice with the Black cloth to call a ship. A path leads to the station."
      : s.opening && place === "attic"
        ? reflectionOpen(s)
          ? "A tall mirror opens onto a black shore. A path leads through the glass."
          : "A tall mirror reflects a black shore. Dust gathers along its frame."
        : s.opening && place === "station"
          ? "The timetable lists years that have yet to happen. A path leads along the shore to the pond."
          : places[place].text;
export function exits(s, place, actor = null) {
  return [
    ...new Set([
      ...baseExits(s, place),
      ...(reflectionOpen(s, place) && place === "attic"
        ? ["pond"]
        : reflectionOpen(s, place) && place === "pond"
          ? ["attic"]
          : []),
      // Discovery lasts; entry needs the bell's current local ringing window.
      // The clearing keeps Badger's company small: no one else follows.
      ...(clearingOpen(s) && place === "pond" && actor === "vale"
        ? ["clearing"]
        : []),
      ...(clearingReturnOpen(s) && place === "clearing" && actor === "vale"
        ? ["pond"]
        : []),
      ...packExits(s, place, actor).filter(
        (to) =>
          place !== "pond" || to !== "greek-harbor" || greekShipPresent(s),
      ),
    ]),
  ].filter((to) => entityActive(s, to) && actorCanVisit(actor, to));
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
  for (const [id, a] of Object.entries(packPeople))
    if (entityActive(s, id) && s.actors[id].place === s.actors.vale.place)
      s.packs[a.packId].met[id] ??= s.turn;
  if (!s.opening) return;
  if (s.actors.vale.place === "pond") s.opening.crossed = true;
  for (const id of actorIds)
    if (
      entityActive(s, id) &&
      s.actors[id].place === s.actors.vale.place &&
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
    met: conditionMet(s, c),
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
      conditions.every((e) => e.met),
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
  actor === "vale" ||
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
  if (hasMotives(s) && recipient && resentment(s, owner, recipient))
    return false;
  if (!hasQuestPrograms(s) || lifeOf(s, owner))
    return (
      owner !== "vale" &&
      recipient !== null &&
      giftDecision(s, owner, item, recipient).accepted
    );
  return (
    owner !== "vale" &&
    !needed(s, owner, item) &&
    (handStatus(s, owner).items.every((e) => e.met) ||
      (recipient && s.actors[owner].trust[recipient] > 0) ||
      (recipient === "vale" && valeStalled(s)))
  );
}
export function canTrade(s, actor, give, receive) {
  const other = s.items[receive]?.holder;
  if (
    s.items[give]?.holder !== actor ||
    !actorIds.includes(other) ||
    !knownActors(s).includes(other) ||
    other === actor ||
    other === "vale" ||
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
      s.items[id].holder === actor &&
      (s.life
        ? !keepReason(s, actor, id)
        : hasQuestPrograms(s)
          ? !needed(s, actor, id)
          : valueOf(s, actor, id) <= 6),
  );
}
// Capture each fulfilled hand before another actor can leave or move an item.
// Program changes happen after the round, so every actor pursues one step per turn.
function captureHands(s, met) {
  if (!hasQuestPrograms(s)) return;
  for (const actor of knownActors(s).filter(
    (id) => id !== "badger" && !isPackActor(id),
  )) {
    const target = targetsFor(s, actor).find(
      (h) => handStatus(s, actor, h).met,
    );
    if (!met.has(actor) && target) {
      met.set(actor, {
        target: structuredClone(target),
        fulfillment: {
          items: [...target.items],
          location: s.actors[actor].place,
          // Include the actual required participants, even before Vale meets
          // them. Keep nearby witnesses within the receipt's two-person bound.
          avatars: [
            ...new Set([
              ...target.avatars,
              ...actorIds.filter(
                (id) =>
                  id !== actor &&
                  entityActive(s, id) &&
                  s.actors[id].place === s.actors[actor].place,
              ),
            ]),
          ]
            .slice(0, 2)
            .sort((a, b) => actorIds.indexOf(a) - actorIds.indexOf(b)),
          ...((target.conditions || []).length
            ? { conditions: handStatus(s, actor, target).conditions }
            : {}),
        },
      });
    }
  }
}
// Each new program reads the programs chosen before it in the same round, so two
// actors never pick goals against each other's stale wants.
function ensurePrograms(s) {
  for (const actor of actorIds.filter(
    (id) => id !== "badger" && !isPackActor(id),
  )) {
    const p = s.actors[actor].progress;
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
    (id) => id !== "vale" && !isPackActor(id),
  )) {
    const p = s.actors[actor].progress,
      current = programFor(s, actor);
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
        "The mirror remembers the crossing. The way out of the attic stays open when the lamp goes dark.";
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
        s.actors[effect.avatar].trust[actor] + 1,
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
  if (!hasQuestPrograms(s)) return;
  const receipts = [];
  for (const [actor, evidence] of met) {
    const progress = s.actors[actor].progress,
      program = programFor(s, actor),
      step = progress.step,
      programIndex = progress.program;
    progress.marks.push(s.turn);
    progress.marks = progress.marks.slice(-32);
    progress.step += 1;
    const complete = progress.step === program.steps.length;
    if (complete) {
      finishPersonalQuest(s, actor, program, evidence.target);
      applyConsequence(s, actor, evidence.target);
      if (program.generated) {
        progress.completedHands += program.steps.length;
        if (program.generated.item)
          progress.recent = [...progress.recent, program.generated.item].slice(
            -4,
          );
        progress.recentKinds = [
          ...(progress.recentKinds || []),
          program.generated.situation || "bargain",
        ].slice(-4);
        delete progress.current;
      }
      progress.program += 1;
      progress.step = 0;
    }
    receipts.push({
      actor,
      program,
      step,
      programIndex,
      complete,
      ...evidence,
    });
  }
  ensurePrograms(s);
  for (const {
    actor,
    program,
    step,
    programIndex,
    complete,
    target,
    fulfillment,
  } of receipts) {
    let text = `${nameOf(actor)} completes hand ${step + 1}/${program.steps.length} of ${program.name}.`;
    if (complete) text += ` Level ${levelOf(s, actor)}.`;
    const life = lifeOf(s, actor);
    if (complete && life?.milestones.at(-1) === s.turn)
      text += ` Hope milestone: ${hopes[actor].milestones[life.milestones.length - 1].title}.`;
    text += questActive(s, actor)
      ? ` Next: ${handText(desireFor(s, actor))}.`
      : " Take time to enjoy this. Helpful actions will grow a new purpose.";
    addLog(s, "World", text, {
      kind: "quest",
      actorId: actor,
      programId: program.id,
      program: structuredClone(program),
      programIndex,
      target,
      fulfillment,
      step,
      level: levelOf(s, actor),
    });
  }
}
export function addLog(s, speaker, text, detail = {}) {
  const actorId =
    detail.actorId ?? actorIds.find((id) => nameOf(id) === speaker) ?? null;
  const locationId = detail.locationId || s.actors[actorId || "vale"].place;
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
    cast: knownActors(s).filter((id) => s.actors[id].place === locationId),
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
    entry.actorId === "vale" &&
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
  trimLog(s);
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
export function accompanyDecision(s, actor, companion, destination) {
  const here = s.actors[companion].place;
  if (!actorCanVisit(companion, destination))
    return {
      accepted: false,
      reason: "Their commitments keep them in this part of the world.",
    };
  if (standoffFor(s, actor) || standoffFor(s, companion))
    return { accepted: false, reason: "Attend to the standoff first." };
  if (s.peaceUntil[companion] > s.turn)
    return { accepted: false, reason: "Catch a breath after the standoff." };
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
  if (s.actors[companion].trust[actor] > 0)
    return {
      ...agree(`Remember ${nameOf(actor)}'s help and share this detour.`),
      favor: true,
    };
  return {
    accepted: false,
    reason: `Pursue this hand first: ${handText(desireFor(s, companion))}.`,
  };
}

export function legalActions(s, actor = "vale") {
  if (!s.actors[actor] || !entityActive(s, actor)) return [];
  const here = s.actors[actor].place;
  const out = [
    offer("wait", actor, null, null, `${nameOf(actor)} waits one turn.`, []),
  ];
  if (here === "clearing" && actor === "vale")
    out.push(
      offer(
        "ring",
        actor,
        null,
        "clearing",
        "Vale rings the Steam Clock's bell. A dark reflection between the roots opens onto Black pond for three following turns.",
        ["clearing"],
      ),
    );
  for (const to of exits(s, here, actor)) {
    const through = !baseExits(s, here).includes(to);
    for (const other of knownActors(s).filter(
      (id) =>
        to !== "clearing" &&
        id !== actor &&
        id !== "badger" &&
        actorCanVisit(id, to) &&
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
        `${nameOf(actor)} goes to ${nameOf(to)}${here === "pond" && to === "greek-harbor" ? " aboard the Greek ship" : through ? " through the reflection" : ""}.`,
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
          `${nameOf(actor)} carries the ${nameOf(id)} to ${nameOf(to)}${here === "pond" && to === "greek-harbor" ? " aboard the Greek ship" : through ? " through the reflection" : ""}.`,
          [id, to],
        ),
      );
    }
  }
  for (const other of knownActors(s).filter(
    (id) => id !== actor && s.actors[id].place === here,
  )) {
    if (other === "badger") {
      out.push(
        offer(
          "talk",
          actor,
          null,
          other,
          s.actors.badger.awake
            ? `${nameOf(actor)} says hello to Grumpy Badger.`
            : `${nameOf(actor)} gently wakes Grumpy Badger.`,
          [other],
        ),
      );
      continue;
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
          here === "pond" &&
            actor === "vale" &&
            (s.steamClock.rings === 1 || clearingOpen(s))
            ? `${nameOf(actor)} rings the Bell again. The Steam Clock answers through the water.`
            : `${nameOf(actor)} rings the Bell. The sound carries across the shore.`,
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
  for (const give of ids)
    for (const receive of ids) {
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
  return [...out, ...packChoices(s, actor)];
}
export function matchingActions(s, selected) {
  const set = [...new Set(selected)].filter((id) => id !== "vale");
  if (!set.length) return [];
  return legalActions(s).filter(
    (a) =>
      a.cards.length === set.length && set.every((id) => a.cards.includes(id)),
  );
}
function travel(s, actor, destination) {
  const through = !baseExits(s, s.actors[actor].place).includes(destination);
  if (through) s.actors[actor].crossed += 1;
  s.actors[actor].place = destination;
  for (const id of carried(s, actor))
    remember(s, id, `${nameOf(actor)} carried it to ${nameOf(destination)}.`);
  return through;
}
function perform(s, a, capture = () => {}) {
  const who = nameOf(a.actor);
  const firstCrossing = actorIds.every((id) => s.actors[id].crossed === 0);
  const here = s.actors[a.actor].place;
  const witnesses = [
    ...actorIds.filter(
      (id) => entityActive(s, id) && s.actors[id].place === here,
    ),
    ...ids.filter((id) => entityActive(s, id) && itemPlace(s, id) === here),
  ];
  const conflict = standoffFor(s, a.actor);
  if (conflict) {
    conflict.guarding[a.actor] = false;
    if (a.actor === conflict.defender) conflict.answered = true;
  }
  if (a.kind === "wait") return;
  const signalBefore = {
    ready: shipSignalConditions(s),
    covered: covered(s, "lamp"),
    phase: shipSignalPhase(s),
  };
  const usefulGift =
    a.kind === "give" &&
    (valueOf(s, a.target, a.item) >= 5 || needed(s, a.target, a.item));
  let text = a.text;
  let requestAccepted = false;
  let affected = null,
    arrival = null,
    invitation = null;
  switch (a.kind) {
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
      invitation = accompanyDecision(s, a.actor, a.target, a.destination);
      if (invitation.favor) s.actors[a.target].trust[a.actor] -= 1;
      s.actors[a.actor].lastTalk = s.turn;
      if (invitation.accepted) {
        const through = travel(s, a.actor, a.destination);
        travel(s, a.target, a.destination);
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
        s.actors[a.target].place = retreat;
        for (const id of carried(s, a.target))
          remember(
            s,
            id,
            `${nameOf(a.target)} retreated to ${nameOf(retreat)} with it.`,
          );
        text += ` ${nameOf(a.target)} retreats to ${nameOf(retreat)}. The standoff ends.`;
        closeStandoff(s, conflict);
        arrival = {
          text: `${nameOf(a.target)} arrives at ${nameOf(retreat)} after yielding to ${who}.`,
          actorId: a.target,
          locationId: retreat,
          fromLocationId: here,
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
      if (here === "clearing") {
        s.actors.badger.awake = true;
        s.actors.badger.wakeCause ??= "bell";
        s.actors.badger.irritation = Math.min(
          3,
          s.actors.badger.irritation + 2,
        );
        text += " Badger opens his eyes and flattens his ears at the noise.";
      }
      if (a.target === "clearing" && a.item === null) {
        s.steamClock.discovered = true;
        s.steamClock.returnRingingUntil = s.turn + 3;
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
    case "talk":
      if (a.target === "badger" && !s.actors.badger.awake) {
        s.actors.badger.awake = true;
        s.actors.badger.wakeCause = "voice";
        s.actors.badger.irritation = 1;
        text +=
          " Badger wakes from a very satisfactory nap, looking mildly offended.";
      }
      s.actors[a.actor].lastTalk = s.turn;
      break;
    case "ask": {
      const willing = willingToGive(s, a.target, a.item, a.actor);
      requestAccepted = willing;
      if (willing) {
        if (
          !handStatus(s, a.target).items.every((e) => e.met) &&
          s.actors[a.target].trust[a.actor] > 0
        )
          s.actors[a.target].trust[a.actor] -= 1;
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
  advanceShipSignal(s, a, signalBefore);
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
    ...(hasMotives(s) && a.kind === "ask" ? { accepted: requestAccepted } : {}),
    ...(invitation
      ? { destinationId: a.destination, accepted: invitation.accepted }
      : {}),
    ...(a.kind === "attack" ? { locationId: here } : {}),
  });
  if (arrival) {
    const { text: arrivalText, ...details } = arrival;
    addLog(s, "World", arrivalText, details);
  }
  settleStandoffs(s);
  // Answering the request is the invited avatar's action for this round.
  return invitation ? a.target : null;
}
function routeBetween(s, from, target, actor = "vale") {
  const queue = [[from]],
    visited = new Set([from]);
  while (queue.length) {
    const route = queue.shift();
    if (route.at(-1) === target) return route;
    for (const next of exits(s, route.at(-1), actor))
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...route, next]);
      }
  }
}
function toward(s, actor, target) {
  const route = routeBetween(s, s.actors[actor].place, target, actor);
  return legalActions(s, actor).find(
    (a) => a.kind === "move" && a.target === route?.[1],
  );
}
export function plan(s, actor = "vale") {
  if (isPackActor(actor)) {
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
  if (actor === "badger")
    return {
      action: legalActions(s, actor)[0],
      reason: "Keep the warm patch of moss.",
    };
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
  if (
    hasMotives(s) &&
    (!hasQuestPrograms(s) ||
      !questActive(s, actor) ||
      stayingWith(s, actor) ||
      standoffFor(s, actor) ||
      s.peaceUntil[actor] > s.turn ||
      actorIds.some(
        (other) =>
          s.actors[other].place === s.actors[actor].place &&
          resentment(s, actor, other) > 0,
      ))
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
        routeBetween(s, here, there, actor) &&
        theirs.avatars.includes(actor) &&
        (theirs.location || there) === there &&
        handStatus(s, id, theirs).items.every((e) => e.met) &&
        theirs.avatars.every(
          (other) => other === actor || s.actors[other].place === there,
        )
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
    if (!local) return choose(toward(s, actor, itemPlace(s, item)), reason);
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
      (id) => rootHolder(s, id) === "vale" && s.actors.vale.place === here,
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
    for (const c of hand.conditions.filter((c) => !conditionMet(s, c))) {
      if (c.kind === "heldBy") {
        if (s.items[c.item].holder !== actor && rootHolder(s, c.item) === actor)
          return choose(
            find("take", c.item),
            "Uncover the promised item before handing it over.",
          );
        if (s.actors[c.avatar].place !== here) return goMeet(c.avatar);
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
  return idle(
    handStatus(s, actor).met
      ? "Hold the target hand."
      : `Wait for ${hand.avatars
          .filter((id) => s.actors[id].place !== here)
          .map(nameOf)
          .join(" and ")} at ${nameOf(here)}.`,
  );
}
export function play(s, action, expectedRevision = s.revision) {
  if (expectedRevision !== s.revision)
    return {
      ok: false,
      state: s,
      error: "The world changed. Choose a current play.",
    };
  const exact = legalActions(s).find((a) => a.key === action?.key);
  if (!exact)
    return {
      ok: false,
      state: s,
      error: "That play has changed. Check the cards and choose again.",
    };
  const next = structuredClone(s);
  const previousHopes = Object.fromEntries(
    knownActors(s).map((id) => [id, lifeOf(s, id)?.milestones.length || 0]),
  );
  const clearingWasOpen = clearingOpen(s);
  const returnWasOpen = clearingReturnOpen(s);
  const shipWasPresent = greekShipPresent(s);
  next.turn += 1;
  next.revision += 1;
  for (const actor of knownActors(next)) {
    const life = lifeOf(next, actor);
    if (life?.phase === "content" && next.turn > life.restUntil)
      life.phase = "seeking";
  }
  const reflectionSource = next.actors.vale.place;
  const wasOpen = reflectionOpen(next, reflectionSource);
  if (exact.kind === "wait")
    addLog(next, "World", "Vale waits. The cast takes a turn.");
  const met = new Map();
  captureHands(next, met);
  const active = knownActors(next);
  const pondRing =
    exact.kind === "ring" &&
    exact.item === "bell" &&
    next.actors.vale.place === "pond";
  const secondRing = pondRing && next.steamClock.rings === 1;
  next.steamClock.rings = pondRing && !secondRing && !clearingWasOpen ? 1 : 0;
  const respondent = perform(next, exact, () => captureHands(next, met));
  if (secondRing) {
    // The second ring reveals the way; Vale stays until the player takes it.
    next.steamClock.discovered = true;
    addLog(
      next,
      "World",
      "The second ring folds the pond's reflection. In the water, a forest clearing and an old Steam Clock come into view.",
      { locationId: "pond" },
    );
  } else if (pondRing && !clearingWasOpen) {
    addLog(
      next,
      "World",
      "A distant clock answers the bell. Its echo hangs over the pond, waiting for a second ring.",
      { locationId: "pond" },
    );
  }
  if (exact.kind === "wait" && next.actors.vale.place === "clearing") {
    next.actors.badger.irritation = Math.max(
      0,
      next.actors.badger.irritation - 1,
    );
    if (next.motives)
      next.motives.grievances.badger = next.motives.grievances.badger
        .map((g) => (g.other === "vale" ? { ...g, weight: g.weight - 1 } : g))
        .filter((g) => g.weight > 0);
  }
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
    "moth",
    "keeper",
    ...active.filter(
      (id) =>
        isPackActor(id) &&
        entityActive(next, id) &&
        next.actors[id].place === next.actors.vale.place,
    ),
  ];
  for (const actor of residents) {
    if (actor === respondent || !active.includes(actor)) continue;
    perform(next, plan(next, actor).action, () => captureHands(next, met));
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
  // silence it during this round, and a distant ring cannot extend the path.
  if (!rings.length)
    next.items.bell.ringing = Math.max(0, next.items.bell.ringing - 1);
  if (
    secondRing ||
    (clearingWasOpen && rings.some((entry) => entry.fromLocationId === "pond"))
  )
    next.steamClock.openUntil = next.turn + 3;
  if (clearingWasOpen && !clearingOpen(next))
    addLog(next, "World", "The reflected clearing fades from the pond.", {
      locationId: "pond",
    });
  if (returnWasOpen && !clearingReturnOpen(next))
    addLog(
      next,
      "World",
      "The bells fall silent. The path to Black pond disappears between the roots; the Steam Clock's bell can reopen it.",
      {
        locationId: "clearing",
      },
    );
  if (!shipSignalConditions(next)) next.locations.pond.shipSignal = 0;
  if (shipSignalPhase(s) < 2 && shipSignalPhase(next) === 2)
    addLog(
      next,
      "World",
      "The first flash draws a ripple across the reflection. A second cover and uncover may bring something closer.",
      { locationId: "pond" },
    );
  if (shipWasPresent !== greekShipPresent(next))
    addLog(
      next,
      "World",
      greekShipPresent(next)
        ? "At the second uncovering, a Greek ship appears on Black pond. Its gangway opens a passage to the Wine-Dark Harbor."
        : "The Greek ship and its gangway fade from Black pond. The passage to the Wine-Dark Harbor is no longer open.",
      {
        locationId: "pond",
      },
    );
  const isOpen = reflectionOpen(next, reflectionSource);
  if (wasOpen !== isOpen)
    addLog(
      next,
      "World",
      isOpen
        ? reflectionSource === "pond"
          ? "The pond's reflection opens a path to the attic."
          : "The attic mirror and the pond open onto each other. A dark shore waits between them."
        : reflectionSource === "pond"
          ? "The pond's reflected path to the attic closes. The shore path to the station remains open."
          : "The reflected path closes. The paths through the station remain open.",
      { locationId: reflectionSource },
    );
  if (next.actors.vale.place !== "pond") next.steamClock.rings = 0;
  advancePrograms(next, met);
  for (const actor of knownActors(next)) {
    const life = lifeOf(next, actor);
    if (life && life.milestones.length > (previousHopes[actor] || 0))
      addLog(
        next,
        "World",
        `${nameOf(actor)} reaches a hope milestone: ${hopes[actor].milestones[life.milestones.length - 1].title}. Hope ${life.milestones.length}/3.`,
        { actorId: actor },
      );
  }
  for (const actor of knownActors(next)) {
    const life = lifeOf(next, actor);
    if (life?.phase === "seeking" && life.inspiration >= INSPIRATION_MAX) {
      life.phase = "active";
      life.inspiration = 0;
      ensurePrograms(next);
      addLog(
        next,
        "World",
        `${nameOf(actor)} finds a new purpose: ${programFor(next, actor).name}. Hope: ${hopes[actor].title}.`,
        { actorId: actor, questPlan: structuredClone(programFor(next, actor)) },
      );
    }
  }
  refreshStalledPrograms(next);
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
    (h.consequence === undefined || validConsequence(h.consequence, actor))
  );
}
function validProgram(p, actor, s) {
  if (
    !p ||
    !actorIds.includes(actor) ||
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
    if (
      !Number.isSafeInteger(g.turn) ||
      g.turn < 0 ||
      g.turn > s.turn ||
      !Number.isSafeInteger(g.level) ||
      g.level < 3 ||
      g.level > s.turn + 1 ||
      ![...actorIds, ...Object.keys(places)].includes(g.owner) ||
      (g.solo === undefined
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
export function validateWorld(s) {
  const fail = () => {
    throw new Error(
      "This save needs a fresh start. Your previous save is kept until you choose New game.",
    );
  };
  if (
    !s ||
    s.schema !== 6 ||
    !Number.isSafeInteger(s.turn) ||
    s.turn < 0 ||
    !Number.isSafeInteger(s.revision) ||
    s.revision < s.turn
  )
    fail();
  if (
    !s.steamClock ||
    ![0, 1].includes(s.steamClock.rings) ||
    typeof s.steamClock.discovered !== "boolean" ||
    !Number.isSafeInteger(s.steamClock.openUntil) ||
    s.steamClock.openUntil < 0 ||
    s.steamClock.openUntil > s.turn + 3 ||
    (s.steamClock.openUntil > 0 && !s.steamClock.discovered) ||
    (s.steamClock.rings === 1 && s.actors?.vale?.place !== "pond") ||
    (s.steamClock.returnRingingUntil !== undefined &&
      (!Number.isSafeInteger(s.steamClock.returnRingingUntil) ||
        s.steamClock.returnRingingUntil < 0 ||
        s.steamClock.returnRingingUntil > s.turn + 3 ||
        (s.steamClock.returnRingingUntil > 0 && !s.steamClock.discovered)))
  )
    fail();
  if (s.opening !== undefined) {
    const o = s.opening;
    if (
      !o ||
      o.version !== 1 ||
      typeof o.crossed !== "boolean" ||
      !o.met ||
      o.met.vale !== 0 ||
      Object.keys(o.met).some((id) => !actorIds.includes(id)) ||
      Object.values(o.met).some(
        (turn) => !Number.isSafeInteger(turn) || turn < 0 || turn > s.turn,
      ) ||
      (o.met.keeper !== undefined && o.met.moth === undefined) ||
      (!o.crossed &&
        (s.actors?.vale?.place !== "attic" ||
          Object.keys(o.met).length !== 1)) ||
      (o.crossed && (!s.locations?.attic.anchored || o.met.moth === undefined))
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
    !validatePackStates(s) ||
    !validMemories(s) ||
    !validMotives(s) ||
    !validLife(s)
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
      Object.keys(a.trust).sort().join() !==
        actorIds
          .filter((other) => other !== id)
          .sort()
          .join() ||
      Object.values(a.trust).some((n) => !Number.isInteger(n) || n < 0 || n > 3)
    )
      fail();
    if (
      !Object.hasOwn(places, a.place) ||
      !actorCanVisit(id, a.place) ||
      (entityActive(s, id) && !entityActive(s, a.place)) ||
      !Number.isSafeInteger(a.crossed) ||
      a.crossed < 0 ||
      !Number.isSafeInteger(a.lastTalk) ||
      a.lastTalk > s.turn
    )
      fail();
    if (id === "badger") {
      if (
        typeof a.awake !== "boolean" ||
        !Number.isInteger(a.irritation) ||
        a.irritation < 0 ||
        a.irritation > 3 ||
        ![null, "voice", "bell"].includes(a.wakeCause) ||
        a.awake !== (a.wakeCause !== null) ||
        JSON.stringify(a.progress) !== JSON.stringify(newProgress())
      )
        fail();
      continue;
    }
    if (isPackActor(id)) {
      if (JSON.stringify(a.progress) !== JSON.stringify(newProgress())) fail();
      continue;
    }
    const progress = a.progress,
      programs = programsFor(s, id);
    if (
      !progress ||
      !Number.isSafeInteger(progress.program) ||
      progress.program < 0 ||
      progress.program > s.turn ||
      !Number.isInteger(progress.step) ||
      progress.step < 0
    )
      fail();
    const program = savedProgramFor(s, id);
    const resting = !questActive(s, id) && progress.step === 0;
    if (
      (!program && !resting) ||
      (program &&
        (!validProgram(program, id, s) ||
          progress.step >= program.steps.length)) ||
      (!questActive(s, id) && !resting)
    )
      fail();
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
  for (const actor of actorIds) if (carried(s, actor).length > 3) fail();
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
  ];
  for (const e of s.log) {
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
        e.actorId !== "vale" ||
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
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > s.actors[e.actorId].progress.program ||
        !Number.isInteger(e.step) ||
        e.step < 0 ||
        e.step >= program.steps.length ||
        e.level !== index + 1 + Number(e.step === program.steps.length - 1) ||
        (program.generated &&
          (program.generated.level !== index + 1 ||
            program.id !== `generated-${e.actorId}-${index + 1}`))
      )
        fail();
      const options = alternatives(program.steps[e.step]),
        target = e.target || options[0];
      if (
        !validHand(target, e.actorId) ||
        !options.some((h) => JSON.stringify(h) === JSON.stringify(target))
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
          JSON.stringify(seen.conditions) !==
            JSON.stringify(target.conditions.map((c) => ({ ...c, met: true })))
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
  if (s?.schema === 1 && s.actors && typeof s.actors === "object") {
    s.schema = 2;
    for (const actor of Object.values(s.actors)) {
      if (actor && typeof actor === "object") {
        actor.progress = newProgress();
        delete actor.aim;
      }
    }
  }
  if (s?.schema === 2) {
    for (const [id, actor] of Object.entries(s.actors || {})) {
      if (id === "badger" || isPackActor(id)) continue;
      const p = actor?.progress,
        programs = questPrograms[id];
      if (
        !programs ||
        !p ||
        !Number.isInteger(p.program) ||
        p.program < 0 ||
        p.program > programs.length ||
        !Number.isInteger(p.step) ||
        p.step < 0 ||
        (p.program === programs.length
          ? p.step !== 0
          : p.step >= programs[p.program].steps.length)
      )
        throw new Error("This save has an invalid quest step.");
    }
    s.schema = 3;
    ensurePrograms(s);
  }
  if (s?.schema === 3) {
    s.schema = 4;
    if (s.eventSeq === undefined && Array.isArray(s.log)) {
      s.log.forEach((entry, index) => {
        entry.seq = index + 1;
      });
      s.eventSeq = s.log.length;
    }
    if (Array.isArray(s.log)) migrateMemories(s);
  }
  if (s?.schema === 4) {
    s.schema = 5;
    s.standoffs = [];
    s.peaceUntil = Object.fromEntries(actorIds.map((id) => [id, 0]));
  }
  if (s?.schema === 5) {
    s.schema = 6;
    s.locations = { attic: { anchored: false }, pond: { answer: null } };
    for (const [id, actor] of Object.entries(s.actors || {}))
      actor.trust = Object.fromEntries(
        actorIds.filter((other) => other !== id).map((other) => [other, 0]),
      );
    const remembered = { ...s, memories: newMemories() };
    for (const entry of s.log || []) rememberEvent(remembered, entry);
    for (const [id, memory] of Object.entries(s.memories || {}))
      memory.landmarks = remembered.memories[id]?.landmarks || [];
  }
  if (s?.schema === 6) {
    // Only absence means legacy. Malformed present values still fail validation.
    if (s.locations?.pond && s.locations.pond.shipSignal === undefined)
      s.locations.pond.shipSignal = 0;
    addSteamClock(s);
    addWorldPacks(s);
  }
  return validateWorld(s);
}
