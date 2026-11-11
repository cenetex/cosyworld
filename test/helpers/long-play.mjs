import { legalActions, play } from "../../v2/card-game/world.mjs";
import { DAYLIGHT_TURNS } from "../../v2/card-game/pack-rules.mjs";
import { funeralJourney } from "./greek-funeral.mjs";
import { endStandoff } from "./standoff.mjs";

// Worlds for the Rust suite (card_shared/js_bridge_tests.rs), built by real
// play from createWorld and printed as a save. Nothing here is recorded.

// A long honest played save: the whole burial, the errands before it
// included. It carries a log, memories, motives, knowledge and a played cast.
export const longPlay = () => funeralJourney().buried;

const wait = (world) => {
  world = endStandoff(world);
  const action = legalActions(world).find(
    (a) => a.kind === "wait" && !a.sleep && !a.guards,
  );
  if (!action) throw new Error("No plain Wait is offered");
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

// The long played world, waited on until three turns before the next dusk, so
// a round through dusk starts with the cast on its feet. The wait runs until
// that condition holds, never for a fixed number of turns.
export function busyDusk() {
  let world = longPlay();
  // Dusk falls on the boundaries where the day count is odd.
  let dusk = (Math.floor(world.turn / DAYLIGHT_TURNS) + 1) * DAYLIGHT_TURNS;
  while (Math.floor(dusk / DAYLIGHT_TURNS) % 2 !== 1) dusk += DAYLIGHT_TURNS;
  while (world.turn < dusk - 3) world = wait(world);
  return world;
}
