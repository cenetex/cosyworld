import { settleGuards } from "../../v2/card-game/resident-guard.mjs";

// An open gate for journeys whose subject is elsewhere. Both papers have
// explicit custody, valid under the historical and current gate policies.
export function openGreekGate(world) {
  world.items["greek-creon-writ"].holder = "greek-guard";
  world.items["greek-decree"].holder = "greek-creon";
  settleGuards(world);
  return world;
}
