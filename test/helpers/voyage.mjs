import { currentActor, legalActions, play } from "../../v2/card-game/world.mjs";
import {
  courseToward,
  transportPlace,
} from "../../v2/card-game/pack-transport.mjs";
import { stowProvisions } from "./provisions.mjs";

const localPlay = (world, action) => {
  const result = play(world, action, world.revision, action.actor);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

// Aboard a ship, "go to that dock" is a voyage of real plays: set a course
// along the lanes, wait out each round at sea, then disembark on arrival.
export function sailTo(
  world,
  dock,
  {
    actor = currentActor(world),
    step = localPlay,
    actions = legalActions,
  } = {},
) {
  for (let turn = 0; turn < 40; turn++) {
    const here = world.actors[actor].place;
    if (here === dock) return world;
    if (!transportPlace(here)) throw new Error(`${actor} is not aboard`);
    const legal = actions(world, actor);
    const ashore = legal.find((a) => a.kind === "move" && a.target === dock);
    if (ashore) return step(world, ashore);
    let lane = courseToward(world, here, dock, actor);
    // These journeys test other stories: a voyage out of Thebes that needs
    // provisions takes a packed load laid on deck (rules 95, 102). Under
    // rules 100 residents' sleep and wants can leave the load ashore.
    if (
      !lane &&
      (world.usedUp?.includes("greek-provisions") ||
        world.items["greek-provisions"]?.holder !== here)
    ) {
      // Only a load that opens the course is laid down: a traveller who
      // carries the provisions keeps them for a free leg.
      const stowed = stowProvisions(structuredClone(world), here);
      const opened = courseToward(stowed, here, dock, actor);
      if (opened) [world, lane] = [stowed, opened];
    }
    const course = actions(world, actor).find(
      (a) => a.kind === "course" && a.target === lane,
    );
    world = step(world, course || legal.find((a) => a.kind === "wait"));
  }
  throw new Error(`The ship never reached ${dock}`);
}

// The next card play of a voyage, for browser journeys that click each play.
export function nextVoyagePlay(world, actor, dock, actions = legalActions) {
  const legal = actions(world, actor);
  if (legal.some((a) => a.kind === "move" && a.target === dock))
    return { kind: "move", target: dock };
  const lane = courseToward(world, world.actors[actor].place, dock, actor);
  if (legal.some((a) => a.kind === "course" && a.target === lane))
    return { kind: "course", target: lane };
  return { kind: "wait" };
}

// True when a move card is not offered because the voyage must happen first.
export const needsVoyage = (world, actor, target, actions = legalActions) =>
  transportPlace(world.actors[actor]?.place) &&
  !actions(world, actor).some((a) => a.kind === "move" && a.target === target);
