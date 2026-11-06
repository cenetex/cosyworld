import { createWorld, legalActions, play } from "../../v2/card-game/world.mjs";
import { worldLife } from "../../v2/card-game/resident-home.mjs";
import { greekTravelTargets } from "./greek-travel.mjs";
import { endStandoff } from "./standoff.mjs";

// Start at Dione's courtyard, then earn the writ and carry every supply by
// ordinary card plays. The crossing has its own journey tests.
export function funeralJourney(world = null) {
  if (!world) {
    world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-courtyard";
    world.actors.vale.visited.push("pond", "greek-harbor", "greek-courtyard");
    world.items.lamp.lit = false;
  }
  const life = worldLife.on;
  worldLife.on = false;
  const states = {};
  const act = (kind, fields = {}) => {
    world = endStandoff(world);
    const action = legalActions(world).find(
      (a) =>
        a.kind === kind &&
        Object.entries(fields).every(([key, value]) => a[key] === value),
    );
    if (!action)
      throw new Error(
        `Missing funeral action: ${kind} ${JSON.stringify(fields)} at ${world.actors.vale.place}`,
      );
    const result = play(world, action);
    if (!result.ok) throw new Error(result.error);
    world = result.state;
  };
  const move = (place) => {
    for (const target of greekTravelTargets(
      world.actors.vale.place,
      `greek-${place}`,
    ))
      act("move", { target });
  };
  try {
    if (world.items.lamp.holder === "vale")
      act("drop", { item: "lamp", target: "greek-courtyard" });
    move("well");
    act("take", { item: "greek-water-jar" });
    move("courtyard");
    act("give", { item: "greek-water-jar", target: "greek-baker" });
    act("take", { item: "greek-bread" });
    move("gate");
    act("trade", { item: "greek-bread", receive: "greek-decree" });
    act("talk", { target: "greek-antigone" });
    move("palace");
    act("trade", { item: "greek-decree", receive: "greek-creon-writ" });
    move("gate");
    worldLife.on = true;
    act("give", { item: "greek-creon-writ", target: "greek-guard" });
    act("take", { item: "greek-shovel" });
    move("courtyard");
    act("take", { item: "greek-oil-flask" });
    move("sanctuary");
    act("take", { item: "greek-funeral-cloth" });
    states.supplied = world;
    move("polynices-hollow");
    for (const item of [
      "greek-oil-flask",
      "greek-funeral-cloth",
      "greek-shovel",
    ])
      act("drop", { item, target: "greek-polynices-hollow" });
    for (
      let turns = 0;
      turns < 48 &&
      !legalActions(world).some((a) => a.choiceId === "greek-anoint-polynices");
      turns++
    )
      act("wait");
    states.beforeAnoint = world;
    for (const [state, choiceId] of [
      ["anointed", "greek-anoint-polynices"],
      ["veiled", "greek-shroud-polynices"],
      ["buried", "greek-bury-polynices"],
    ]) {
      act("choose", { choiceId });
      states[state] = world;
    }
    return states;
  } finally {
    worldLife.on = life;
  }
}
