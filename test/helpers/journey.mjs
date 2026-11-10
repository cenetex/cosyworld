import { createHash } from "node:crypto";
import {
  currentActor,
  decodeSave,
  encodeSave,
  holdChoice,
  legalActions,
  play,
} from "../../v2/card-game/world.mjs";
import { greekTravelTargets } from "./greek-travel.mjs";
import { needsVoyage, sailTo } from "./voyage.mjs";
import { endStandoff } from "./standoff.mjs";

// A test journey is a named list of steps played through the real rules API:
// legalActions, choose one, play it. See test/journeys/README.md.
//
//   { kind: "take", item: "greek-bread" }   a play; every field must match
//   { walk: "courtyard" }                    the moves of a road or voyage
//   { hold: "cloth" | null }                 the quiet hand selection
//   { at: "arrival" }                        name the world reached so far
//
// A step that is not legal stops the build with the checkpoint it was
// heading for and the plays that were legal instead.
export function playJourney(journey) {
  let world = journey.start();
  const checkpoints = {};
  const names = journey.steps.filter((s) => s.at).map((s) => s.at);
  const heading = (i) => names.find((n) => !(n in checkpoints)) ?? "(end)";
  const fail = (i, step, why) => {
    const legal = legalActions(world, currentActor(world))
      .map((a) => `${a.kind}:${a.target ?? a.item ?? ""}`)
      .join(" ");
    throw new Error(
      `Journey ${journey.name}, step ${i} ${JSON.stringify(step)} on the way to checkpoint "${heading(i)}": ${why}. ` +
        `At ${world.actors[currentActor(world)].place}, turn ${world.turn}, legal plays: ${legal}`,
    );
  };
  const act = (i, step) => {
    world = endStandoff(world);
    const action = legalActions(world).find(
      (a) =>
        a.kind === step.kind &&
        Object.entries(step).every(([k, v]) => k === "kind" || a[k] === v),
    );
    if (!action) fail(i, step, "that play is not legal here");
    const result = play(world, action, world.revision);
    if (!result.ok) fail(i, step, result.error);
    world = result.state;
  };
  journey.steps.forEach((step, i) => {
    if (step.at) {
      if (step.at in checkpoints) fail(i, step, "duplicate checkpoint name");
      checkpoints[step.at] = encodeSave(world);
    } else if (step.walk) {
      const actor = currentActor(world);
      for (const target of greekTravelTargets(
        world.actors[actor].place,
        `greek-${step.walk}`,
      )) {
        if (needsVoyage(world, actor, target)) world = sailTo(world, target);
        else act(i, { kind: "move", target });
      }
    } else if ("hold" in step) {
      const next = structuredClone(world);
      holdChoice(next, currentActor(world), {
        item: step.hold,
        revision: next.revision,
      });
      world = next;
    } else act(i, step);
  });
  return checkpoints;
}

// Checkpoint saves are text, in the order the journey names them. Each caller
// gets its own worlds, loaded as a player's browser would load a save.
const built = new Map();
export function journeyWorlds(journey) {
  if (!built.has(journey.name)) built.set(journey.name, playJourney(journey));
  return Object.fromEntries(
    Object.entries(built.get(journey.name)).map(([name, save]) => [
      name,
      decodeSave(save),
    ]),
  );
}

// One readable record per checkpoint for the committed summary
// (test/journeys/checkpoints.json): a rules or pack change shows up as a
// diff of what moved, and the hash catches any other change.
export function summarize(checkpoints) {
  return Object.fromEntries(
    Object.entries(checkpoints).map(([name, save]) => {
      const world = JSON.parse(save);
      const carried = Object.entries(world.items)
        .filter(([, item]) => item.holder === "vale")
        .map(([id]) => id)
        .sort();
      return [
        name,
        {
          turn: world.turn,
          place: world.actors.vale.place,
          carried,
          sha256: createHash("sha256").update(save).digest("hex").slice(0, 16),
        },
      ];
    }),
  );
}
