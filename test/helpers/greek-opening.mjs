import {
  learnLane,
  moveTransport,
} from "../../v2/card-game/pack-transport.mjs";
import { atticOpening } from "../fixtures/card-attic-opening.mjs";
import {
  createWorld,
  currentActor,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { needsVoyage, sailTo } from "./voyage.mjs";
import { enableMotives } from "../../v2/card-game/motives.mjs";
import { greekTravelTargets } from "./greek-travel.mjs";
import { endStandoff } from "./standoff.mjs";

// Opening-only worlds reached through legal choices. Initial inventory setup
// leaves the forest tools at the harbor and room for the funeral materials.
// Poem-only scenes place the singer at the harbor after setup; separate travel
// tests follow his data-defined start and every legal movement.
export function openingFixture(
  branch,
  { water = true, reportFirst = true } = {},
) {
  let world = enableMotives(atticOpening(), {
    questPrograms: true,
    personalQuests: true,
  });
  const states = {};
  const act = (kind, fields = {}) => {
    world = endStandoff(world);
    const action = legalActions(world).find(
      (a) =>
        a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
    );
    if (!action)
      throw Error(
        `Unavailable fixture action: ${kind} ${JSON.stringify(fields)}`,
      );
    const result = play(world, action, world.revision);
    if (!result.ok) throw Error(result.error);
    world = result.state;
  };
  const move = (target) =>
    needsVoyage(world, currentActor(world), target)
      ? (world = sailTo(world, target))
      : act("move", { target });
  const take = (item) => act("take", { item });
  const walk = (...places) =>
    places.forEach((p) =>
      greekTravelTargets(world.actors.vale.place, `greek-${p}`).forEach(move),
    );
  // The opening starts lit: douse to cross, then the shore lamp is lit again
  // (#1600). Setting it keeps the released turn count of this long fixture.
  act("snuff");
  move("pond");
  world.items.lamp.lit = true;
  world.items.cloth.holder = "vale";
  world.items.oil.holder = "greek-harbor";
  world.items.lamp.fuel = 12;
  // Cover, then uncover, the lit lamp: the whole ship signal.
  act("cover", { item: "cloth", target: "lamp" });
  take("cloth");
  walk("ship", "harbor");
  // Black Pond sails only to the Wine-Dark Harbor. The Travel Provisions
  // ride on deck, which opens the lane on to Piraeus, and Myrto has told the
  // traveller the lane from Piraeus to Athens Harbor.
  world.items["greek-provisions"].holder = "greek-ship";
  learnLane(world, "vale", "greek-piraeus", "greek-athens-harbor");
  act("snuff", { item: "lamp" });
  act("drop", { item: "cloth", target: "greek-harbor" });
  const bardFrom = world.actors["greek-rhapsode"].place;
  world.actors["greek-rhapsode"].place = "greek-harbor";
  moveTransport(world, bardFrom, "greek-harbor");
  walk("courtyard");
  states.arrival = world;
  const give = (item, target) => act("give", { item, target });
  if (water) {
    walk("well");
    take("greek-water-jar");
    walk("courtyard");
    states.waterOffer = world;
    give("greek-water-jar", "greek-baker");
    states.water = world;
  }
  // Meeting the guard at the gate tells the traveller the decree.
  walk("gate");
  states.decree = world;
  if (branch === "exposure") {
    // Handing the guard the shovel reports the plan; his tablet records it.
    take("greek-shovel");
    give("greek-shovel", "greek-guard");
    states.choice = world;
    take("greek-guard-tablet");
    walk("courtyard");
    states.returning = world;
    give("greek-guard-tablet", "greek-baker");
  } else {
    if (branch === "concession") {
      // The elder stands witness when met after the decree.
      walk("well");
      walk("sanctuary");
      take("greek-household-token");
      walk("palace");
      take("greek-decree");
      give("greek-decree", "greek-creon");
      states.permission = world;
      // Creon's writ appears; the decree lies at the palace again. The token
      // has done its work.
      act("drop", { item: "greek-household-token", target: "greek-palace" });
      take("greek-decree");
      take("greek-creon-writ");
      walk("courtyard");
      if (reportFirst) {
        give("greek-creon-writ", "greek-baker");
        states.permissionShared = world;
      }
      walk("gate");
    } else {
      walk("palace");
      take("greek-decree");
      walk("gate");
    }
    // The road out to the battlefield is open while the guard at the gate
    // holds the decree.
    give("greek-decree", "greek-guard");
    take("greek-shovel");
    // Waiting on the battlefield with the shovel prepares the grave.
    walk("battlefield");
    act("wait");
    act("drop", { item: "greek-shovel", target: "greek-battlefield" });
    // Cloth and oil are carried out one at a time and laid at the grave.
    walk("gate", "sanctuary");
    take("greek-funeral-cloth");
    walk("gate", "battlefield");
    act("drop", { item: "greek-funeral-cloth", target: "greek-battlefield" });
    walk("gate", "courtyard");
    take("greek-oil-flask");
    walk("gate", "battlefield");
    act("drop", { item: "greek-oil-flask", target: "greek-battlefield" });
    states.beforeRite = world;
    act("wait");
    states.buried = world;
    take("greek-burial-account");
    walk("gate", "courtyard");
    states.returning = world;
    if (branch === "concession") {
      if (!reportFirst) {
        give("greek-creon-writ", "greek-baker");
        states.permissionShared = world;
      }
      states.beforeGraveReport = world;
    }
    give("greek-burial-account", "greek-baker");
  }
  states.closed = world;
  return states;
}
