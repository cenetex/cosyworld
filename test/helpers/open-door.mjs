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

// The Open Door is played with ordinary cards. Meeting someone tells their
// part of the story, Waiting with a thing at its place does the deed, and
// each outcome given to Dione is that story's report.
export function openDoorSteps() {
  const move = greekMoveSteps("greek-courtyard");
  const take = (id) => ({ kind: "take", item: `greek-${id}` });
  const give = (id, to) => ({
    kind: "give",
    item: `greek-${id}`,
    target: `greek-${to}`,
  });
  const wait = { kind: "wait" };
  const talk = (who, n = 1) =>
    Array.from({ length: n }, () => ({ kind: "talk", target: `greek-${who}` }));
  const dione = (...ids) => ids.map((id) => give(id, "baker"));
  return [
    // Meeting Aethra on arrival tells the mothers' request; Adrastus speaks
    // at the next play.
    ...move("harbor", "athens", "eleusis"),
    take("burial-petition"),
    ...move("athens"),
    give("burial-petition", "theseus"),
    // The herald's truce now rests in the Agora; Theseus reads its return.
    ...talk("theseus"),
    ...move("piraeus"),
    wait,
    take("return-cloths"),
    ...move("athens", "eleusis"),
    { kind: "drop", item: "greek-return-cloths", target: "greek-eleusis" },
    wait,
    take("ash-urn"),
    give("ash-urn", "argive-mother"),
    take("return-list"),
    take("pyre-account"),
    ...move("athens", "piraeus"),
    give("return-list", "quay-host"),
    // Myrine agrees on meeting at Eleusis and walks to the quay in company.
    ...move("athens", "eleusis"),
    ...myrineSteps.map((destination) => ({
      kind: "accompany",
      target: "greek-household-witness",
      destination,
    })),
    take("provision-basket"),
    give("provision-basket", "household-witness"),
    take("return-list"),
    ...greekMoveSteps("greek-piraeus")("athens"),
    take("refuge-tablet"),
    ...greekMoveSteps("greek-athens")("colonus"),
    wait,
    ...talk("colonus-keeper", 2),
    wait,
    // Three hands are full: the first reports go home to Dione.
    ...greekMoveSteps("greek-colonus")("athens", "harbor", "courtyard"),
    ...dione("pyre-account", "return-list", "refuge-tablet"),
    ...greekMoveSteps("greek-courtyard")("harbor", "piraeus"),
    take("shelter-blanket"),
    ...greekMoveSteps("greek-piraeus")("athens", "marathon"),
    { kind: "drop", item: "greek-shelter-blanket", target: "greek-marathon" },
    wait,
    ...talk("marathon-keeper", 3),
    take("marathon-record"),
    ...greekMoveSteps("greek-marathon")("athens"),
    take("olive-branch"),
    ...greekMoveSteps("greek-athens")("harbor", "courtyard"),
    ...dione("olive-branch", "marathon-record"),
    ...talk("baker"),
  ];
}

// Myrine walks her authored path one road at a time, from Eleusis along the
// Sacred Way and the Long Walls to Piraeus.
export const myrineSteps =
  packDefinition("greek-drama").avatars[
    "greek-household-witness"
  ].journey.path.slice(1);

// The world before and after each step that commits a story choice.
export function openDoorJourney(steps = openDoorSteps()) {
  let world = openDoorStart();
  const before = {},
    after = {};
  for (const { kind, ...fields } of steps) {
    const prior = world;
    world = playOpenDoor(world, kind, fields);
    for (const id of Object.keys(world.packs["greek-drama"].receipts))
      if (!(id in prior.packs["greek-drama"].receipts)) {
        before[id] = prior;
        after[id] = world;
      }
  }
  return { world, before, after };
}

// The world just after the plea at the Agora. The petition and the
// herald's truce rest there, so the Sacred Way and the Long Walls both stand
// open.
let plea;
export function openSeas() {
  if (!plea) {
    let world = openDoorStart();
    for (const { kind, ...fields } of openDoorSteps()) {
      world = playOpenDoor(world, kind, fields);
      if (world.packs["greek-drama"].receipts["greek-open-door-register-plea"])
        break;
    }
    plea = world;
  }
  return structuredClone(plea);
}
