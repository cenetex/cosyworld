import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { settleGuards } from "../v2/card-game/resident-guard.mjs";
const guard = "greek-guard",
  beyond = "greek-battlefield";
function learnedGuard() {
  // Reduced from the world-life seed-two walk: an unanswered request is
  // followed by the player's standing Guard, whose Wait has a place target.
  let world = createWorld({ seed: 2 });
  world.actors.vale.place = "greek-gate";
  world.packs["greek-drama"].met[guard] = 0;
  world.items["greek-creon-writ"].holder = guard;
  settleGuards(world);
  for (const pick of [
    (a) => a.kind === "ask" && a.item === "greek-creon-writ",
    (a) => a.guards === beyond,
  ]) {
    const action = legalActions(world).find(pick);
    expect(action).toBeDefined();
    const done = play(world, action);
    expect(done.ok).toBe(true);
    world = done.state;
  }
  return world;
}
describe("learning from a standing guard", () => {
  it("records the actual Guard Wait and reloads after the source log is trimmed", () => {
    const world = learnedGuard();
    const trial = world.memories.vale.learning.at(-1);
    expect(trial.action).toEqual({
      kind: "wait",
      target: beyond,
      item: null,
      receive: null,
      destination: null,
    });
    expect(world.log.find((e) => e.seq === trial.seq).guards).toBe(beyond);
    expect(decodeSave(encodeSave(world))).toEqual(world);
    world.log = [];
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("checks the saved place and the committed Guard action", () => {
    const world = learnedGuard();
    for (const target of ["unknown-place", "vale", "lamp", "pond"]) {
      const bad = structuredClone(world);
      bad.memories.vale.learning.at(-1).action.target = target;
      expect(() => encodeSave(bad), target).toThrow();
    }
    const plainWait = structuredClone(world);
    const trial = plainWait.memories.vale.learning.at(-1);
    delete plainWait.log.find((e) => e.seq === trial.seq).guards;
    expect(() => encodeSave(plainWait)).toThrow();
  });
});
