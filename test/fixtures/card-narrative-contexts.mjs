import { atticOpening } from "./card-attic-opening.mjs";
import { openingFixture } from "../helpers/greek-opening.mjs";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../../v2/card-game/world.mjs";
import { enableMotives } from "../../v2/card-game/motives.mjs";
import { sailTo } from "../helpers/voyage.mjs";
import {
  narrativeContext,
  applyGeneratedText,
} from "../../v2/card-game/narrative.mjs";

export function playCard(world, kind, item, target) {
  const action = legalActions(world).find(
    (candidate) =>
      candidate.kind === kind &&
      (!item || candidate.item === item) &&
      (!target || candidate.target === target),
  );
  if (!action)
    throw new Error(`Missing fixture action: ${kind} ${item} ${target}`);
  const result = play(world, action);
  if (!result.ok) throw new Error(`Rejected fixture action: ${kind}`);
  return result.state;
}

export function hearFirstEcho() {
  let world = enableMotives(createWorld());
  world.actors.vale.place = "pond";
  world.actors.moth.place = "attic";
  world.actors.keeper.place = "pond";
  world.items.bell.holder = "vale";
  world.items.cloth.holder = "vale";
  world.turn = 7;
  world.revision = 7;
  world = playCard(world, "ring", "bell");
  const context = narrativeContext(world);
  return applyGeneratedText(world, context, {
    revision: context.revision,
    model: "contract-fixture",
    entries: context.entities.map(({ id }) => ({
      id,
      text: "A fixture response.",
    })),
  });
}

// These use the real rules, save codec and browser request builder. They are
// also sent through the Rust HTTP route by the contract smoke.
export function narrativeContractCases() {
  const echoed = hearFirstEcho();
  const covered = playCard(echoed, "cover", "cloth", "bell");
  const secondRing = playCard(echoed, "ring", "bell");
  const clearing = playCard(secondRing, "move", null, "clearing");
  const opening = enableMotives(atticOpening(), {
    questPrograms: true,
  });
  const lit = playCard(opening, "light", "lamp");
  const pond = playCard(lit, "move", null, "pond");
  const signalStart = structuredClone(pond);
  signalStart.items.cloth.holder = "vale";
  signalStart.items.lamp.fuel = 12;
  const firstCover = playCard(signalStart, "cover", "cloth", "lamp");
  const firstFlash = playCard(firstCover, "take", "cloth");
  const secondCover = playCard(firstFlash, "cover", "cloth", "lamp");
  const ship = playCard(secondCover, "take", "cloth");
  const aboard = playCard(ship, "move", null, "greek-ship");
  const harbor = sailTo(aboard, "greek-harbor");
  const road = playCard(harbor, "move", null, "greek-road-thebes");
  const courtyard = playCard(road, "move", null, "greek-courtyard");
  const gate = playCard(courtyard, "move", null, "greek-gate");
  const choose = (world, choiceId) => {
    const action = legalActions(world).find((a) => a.choiceId === choiceId);
    if (!action) throw new Error(`Missing contract choice: ${choiceId}`);
    const result = play(world, action);
    if (!result.ok) throw new Error(`Rejected contract choice: ${choiceId}`);
    return result.state;
  };
  const heard = choose(gate, "greek-hear-decree");
  const refused = choose(heard, "greek-decline-burial");
  const legacyHarbor = structuredClone(harbor);
  legacyHarbor.packs["greek-drama"].scope = "full";
  const egypt = choose(legacyHarbor, "greek-helen-egypt");
  const helen = playCard(egypt, "move", null, "greek-egypt-tomb");
  const worlds = [
    ["opening", opening],
    ["first light", lit],
    ["arrival at pond", pond],
    ["first ring", echoed],
    ["cover bell after echo", covered],
    ["reload covered bell", decodeSave(encodeSave(covered))],
    ["wait after echo", playCard(echoed, "wait")],
    ["second ring after echo", secondRing],
    ["enter clearing", clearing],
    ["return to echo's location", playCard(clearing, "move", null, "pond")],
    ["uncover bell", playCard(covered, "take", "cloth")],
    ["first lamp covering", firstCover],
    ["first lamp flash", firstFlash],
    ["second lamp covering", secondCover],
    ["ship summoned", ship],
    ["reload summoned ship", decodeSave(encodeSave(ship))],
    ["Steam Clock return bell", playCard(clearing, "ring", null, "clearing")],
    ["Greek harbor crossing", harbor],
    ["Theban gate cast", gate],
    ["Theban decree through Talk", playCard(gate, "talk", null, "greek-guard")],
    ["Theban refusal", refused],
    ["Helen history choice", egypt],
    ["Helen in Egypt", helen],
    ["reload Greek history", decodeSave(encodeSave(helen))],
  ];
  for (const branch of ["burial", "concession", "refusal", "exposure"]) {
    const earned = openingFixture(branch).closed;
    // The Bard may still be at sea; a voyage takes a world round.
    let arrival = playCard(earned, "wait");
    for (
      let turn = 0;
      turn < 8 &&
      arrival.actors["greek-rhapsode"].place !== arrival.actors.vale.place;
      turn++
    )
      arrival = playCard(arrival, "wait");
    worlds.push([`${branch} bard arrival`, arrival]);
    worlds.push([
      `${branch} bard conversation`,
      playCard(arrival, "talk", null, "greek-rhapsode"),
    ]);
  }
  return worlds.map(([name, world]) => ({
    name,
    world,
    context: narrativeContext(world),
  }));
}
