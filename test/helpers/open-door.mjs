import { currentActor, legalActions, play } from "../../v2/card-game/world.mjs";
import { needsVoyage, sailTo } from "./voyage.mjs";
import { summonTransport } from "../../v2/card-game/pack-transport.mjs";
import { packDefinition } from "../../v2/card-game/pack-registry.mjs";
import { openingFixture } from "./greek-opening.mjs";
import { greekTravelTargets, greekMoveSteps } from "./greek-travel.mjs";

export const OPEN_DOOR_PLACES = [
  "greek-athens",
  "greek-piraeus",
  "greek-colonus",
  "greek-eleusis",
  "greek-marathon",
];

export function openDoorAction(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (candidate) =>
      candidate.kind === kind &&
      Object.entries(fields).every(([key, value]) => candidate[key] === value),
  );
  if (!action)
    throw new Error(
      `Missing Open Door action: ${kind} ${JSON.stringify(fields)}`,
    );
  return action;
}

export function playOpenDoor(world, kind, fields = {}) {
  if (
    kind === "move" &&
    Object.keys(fields).join() === "target" &&
    needsVoyage(world, currentActor(world), fields.target)
  )
    return sailTo(world, fields.target);
  if (kind === "move" && fields.target === "greek-ship") {
    for (
      let wait = 0;
      wait < 32 &&
      !legalActions(world).some(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
      wait++
    ) {
      // A roaming bard may have sailed it away; call it back, as the Greek
      // story suite does. The ship suites cover resident voyages.
      if (world.transports["greek-ship"].dock !== world.actors.vale.place)
        summonTransport(world, "greek-ship", world.actors.vale.place);
      world = playOpenDoor(world, "wait");
    }
  }
  const result = play(
    world,
    openDoorAction(world, kind, fields),
    world.revision,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

export const openDoorChoice = (world, id) =>
  playOpenDoor(world, "choose", { choiceId: `greek-open-door-${id}` });

export const openDoorWalk = (world, ...places) =>
  places.reduce(
    (state, id) =>
      greekTravelTargets(state.actors.vale.place, `greek-${id}`).reduce(
        (s, target) => {
          return playOpenDoor(s, "move", { target });
        },
        state,
      ),
    world,
  );

// Giving Dione a Theban outcome opens the road to Eleusis.
export function openDoorStart(branch = "exposure") {
  const world = openingFixture(branch).closed;
  if (!world.packs["greek-drama"].flags["greek-open-door-open"])
    throw new Error(`The road stayed closed after ${branch}`);
  return playOpenDoor(world, "drop", {
    item: "lamp",
    target: "greek-courtyard",
  });
}

export function openDoorSteps({
  recovery = "truce",
  eleusis = "care",
  berth = "family",
  colonus = "custom",
  marathon = "hearing",
} = {}) {
  const move = greekMoveSteps("greek-courtyard");
  const take = (id) => ({ kind: "take", item: `greek-${id}` });
  const choose = (id) => ({
    kind: "choose",
    choiceId: `greek-open-door-${id}`,
  });
  return [
    ...move("harbor", "athens", "eleusis"),
    choose("hear-mothers"),
    choose("hear-adrastus"),
    take("burial-petition"),
    ...move("athens"),
    choose("register-plea"),
    // The plea's olive branch waits at the Agora; hands stay free.
    { kind: "drop", item: "greek-olive-branch", target: "greek-athens" },
    choose(`request-${recovery}`),
    choose(`hear-${recovery}-report`),
    ...move("piraeus"),
    choose("hear-quay"),
    take("provision-basket"),
    choose("set-provisions"),
    take("return-cloths"),
    ...move("athens", "eleusis"),
    choose("lay-cloths"),
    take("ash-urn"),
    choose("lay-ashes"),
    choose("hear-pyre"),
    choose(`eleusis-${eleusis}`),
    take("return-list"),
    ...move("athens", "piraeus"),
    choose(`${berth}-berth`),
    ...move("athens"),
    take("refuge-tablet"),
    ...move("colonus"),
    choose("colonus-enter"),
    take("grove-cup"),
    take("grove-honey"),
    choose("colonus-water"),
    choose("colonus-daughters"),
    choose("colonus-farewell"),
    choose(`colonus-${colonus}`),
    ...move("athens", "piraeus"),
    take("shelter-blanket"),
    ...move("athens", "marathon"),
    choose("marathon-enter"),
    choose("marathon-blanket"),
    choose("marathon-daughter"),
    choose("marathon-battle"),
    choose("marathon-captive"),
    choose(`marathon-${marathon}`),
    ...move("athens", "harbor", "courtyard"),
    choose("return-dione"),
  ];
}

export function openDoorJourney(options) {
  let world = openDoorStart();
  const before = {},
    after = {};
  for (const { kind, ...fields } of openDoorSteps(options)) {
    if (fields.choiceId) before[fields.choiceId] = world;
    world = playOpenDoor(world, kind, fields);
    if (fields.choiceId) after[fields.choiceId] = world;
  }
  return { world, before, after };
}

// The world just after the plea at the Agora, with the Suppliant’s
// olive branch on the ship's deck: every Greek lane is open.
let plea;
export function openSeas() {
  if (!plea) {
    let world = openDoorStart();
    for (const { kind, ...fields } of openDoorSteps()) {
      world = playOpenDoor(world, kind, fields);
      if (fields.choiceId === "greek-open-door-register-plea") break;
    }
    world.items["greek-olive-branch"].holder = "greek-ship";
    plea = world;
  }
  return structuredClone(plea);
}
