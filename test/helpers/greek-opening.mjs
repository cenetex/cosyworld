import { moveTransport } from "../../v2/card-game/pack-transport.mjs";
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
  const choose = (choiceId) => act("choose", { choiceId });
  const walk = (...places) =>
    places.forEach((p) =>
      greekTravelTargets(world.actors.vale.place, `greek-${p}`).forEach(move),
    );
  act("light");
  move("pond");
  world.items.cloth.holder = "vale";
  world.items.oil.holder = "greek-harbor";
  world.items.lamp.fuel = 12;
  for (let i = 0; i < 2; i++) {
    act("cover", { item: "cloth", target: "lamp" });
    take("cloth");
  }
  walk("ship", "harbor");
  act("snuff", { item: "lamp" });
  act("drop", { item: "cloth", target: "greek-harbor" });
  const bardFrom = world.actors["greek-rhapsode"].place;
  world.actors["greek-rhapsode"].place = "greek-harbor";
  moveTransport(world, bardFrom, "greek-harbor");
  walk("courtyard");
  states.arrival = world;
  if (water) {
    walk("well");
    take("greek-water-jar");
    walk("courtyard");
    states.waterOffer = world;
    choose("greek-return-water-jar");
    states.water = world;
  }
  walk("gate");
  choose("greek-hear-decree");
  states.decree = world;
  if (branch === "refusal" || branch === "exposure") {
    choose(branch === "refusal" ? "greek-decline-burial" : "greek-report-plan");
    states.choice = world;
    walk("courtyard");
    states.returning = world;
    choose(`greek-courtyard-${branch}`);
  } else {
    if (branch === "concession") {
      walk("well");
      choose("greek-gather-witness");
      walk("courtyard", "sanctuary");
      take("greek-household-token");
      walk("courtyard", "well", "palace");
      take("greek-decree");
      choose("greek-petition-burial");
      states.permission = world;
      walk("well", "courtyard");
      if (reportFirst) {
        choose("greek-courtyard-concession");
        states.permissionShared = world;
      }
      walk("gate");
    }
    take("greek-shovel");
    walk("battlefield");
    choose(
      branch === "concession"
        ? "greek-prepare-permitted-burial"
        : "greek-prepare-burial-ground",
    );
    walk("gate", "courtyard", "sanctuary");
    if (branch === "concession")
      act("drop", { item: "greek-household-token", target: "greek-sanctuary" });
    take("greek-funeral-cloth");
    walk("courtyard");
    take("greek-oil-flask");
    walk("gate", "battlefield");
    states.beforeRite = world;
    choose(
      branch === "concession"
        ? "greek-perform-permitted-burial"
        : "greek-perform-burial",
    );
    states.buried = world;
    walk("gate", "courtyard");
    states.returning = world;
    if (branch === "concession") {
      if (!reportFirst) {
        choose("greek-courtyard-concession");
        states.permissionShared = world;
      }
      states.beforeGraveReport = world;
      choose("greek-courtyard-permitted-burial");
    } else choose("greek-courtyard-burial");
  }
  states.closed = world;
  return states;
}
