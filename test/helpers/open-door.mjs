import {
  currentActor,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { needsVoyage, sailTo } from "./voyage.mjs";
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
    )
      world = playOpenDoor(world, "wait");
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

export function openDoorInvitation(world) {
  const choices = packDefinition("greek-drama").choices;
  return legalActions(world).find(
    (action) =>
      action.kind === "choose" &&
      choices.find(
        (entry) =>
          entry.id === action.choiceId &&
          entry.effects.some(
            (effect) =>
              effect.kind === "set_flag" &&
              effect.key === "greek-open-door-open" &&
              effect.value === true,
          ),
      ),
  );
}

// Giving Myrto a boarding pass opens its lane for everyone.
export const givePass = (world, port) =>
  playOpenDoor(world, "give", {
    item: `greek-pass-${port}`,
    target: "greek-shipmaster",
  });

// Dione's invitation hands Vale the Piraeus boarding pass. Unless `pass` is
// false, Vale then gives it to Myrto, which opens the lane, and walks back.
export function openDoorStart(branch = "refusal", { pass = true } = {}) {
  let world = openingFixture(branch).closed;
  const invitation = openDoorInvitation(world);
  if (!invitation) throw new Error(`Missing invitation after ${branch}`);
  world = playOpenDoor(world, "choose", { choiceId: invitation.choiceId });
  world = playOpenDoor(world, "drop", {
    item: "lamp",
    target: "greek-courtyard",
  });
  if (!pass) return world;
  world = givePass(openDoorWalk(world, "harbor"), "piraeus");
  return openDoorWalk(world, "courtyard");
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
  // The plea hands Vale the Athens Harbor pass; Myrto opens its lane.
  const pass = (port) => ({
    kind: "give",
    item: `greek-pass-${port}`,
    target: "greek-shipmaster",
  });
  return [
    ...move("harbor", "athens", "eleusis"),
    choose("hear-mothers"),
    choose("hear-adrastus"),
    take("burial-petition"),
    ...move("athens"),
    choose("register-plea"),
    choose(`request-${recovery}`),
    choose(`hear-${recovery}-report`),
    ...move("harbor"),
    pass("athens-harbor"),
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
