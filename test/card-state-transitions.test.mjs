import { describe, expect, it } from "vitest";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import {
  local,
  replay,
  shared,
  sharedBoundary,
  walk,
  wayTo,
} from "./helpers/transition-walk.mjs";

const SEEDS = (process.env.TRANSITION_SEEDS || "7,42").split(",").map(Number);
const SCALE = Number(process.env.TRANSITION_SCALE || 1);
const [first, second] = humanAvatarIds;
const moves = (c) => c.kind === "move";

describe("state transitions on a seeded walk (#2520)", () => {
  it.each(SEEDS)(
    "reads back every state of the opening, before and after the crossing (seed %i)",
    (seed) => {
      const driver = local(first),
        start = createWorld({ opening: true, seed });
      const before = walk(driver, start, { seed, steps: 40 * SCALE, only: (c) => !moves(c) });
      expect(before.state.opening.crossed).toBe(false);
      expect(before.reached.hold).toBeGreaterThan(0);
      expect(before.reached.wait).toBeGreaterThan(0);
      const crossing = wayTo(driver, before.state, (s) => s.opening.crossed, 4);
      expect(crossing, `seed ${seed} a way out of the opening`).toBeTruthy();
      const crossed = replay(driver, before.state, crossing);
      expect(crossed.opening.met[first]).toBe(start.opening.met[first]);
      const after = walk(driver, crossed, { seed, steps: 80 * SCALE });
      expect(after.state.opening.crossed).toBe(true);
      expect(after.reached.move).toBeGreaterThan(0);
      expect(after.reached.stale).toBeGreaterThan(0);
      const trace = [...before.trace, ...crossing, ...after.trace];
      expect(encodeSave(replay(driver, start, trace))).toBe(encodeSave(after.state));
    },
    60_000 * SCALE,
  );

  it.each(SEEDS)(
    "reads back every state of a local world with no opening, through pack changes (seed %i)",
    (seed) => {
      const driver = local(first),
        start = createWorld({ seed });
      const { state, trace, reached } = walk(driver, start, { seed, steps: 160 * SCALE });
      expect(start.opening).toBeUndefined();
      expect(state.opening).toBeUndefined();
      for (const kind of ["move", "wait", "take", "pack", "stale"])
        expect(reached[kind], `seed ${seed} reached ${kind}`).toBeGreaterThan(0);
      expect(state.turn).toBeGreaterThan(start.turn);
      expect(encodeSave(replay(driver, start, trace))).toBe(encodeSave(state));
    },
    60_000 * SCALE,
  );

  it.each(SEEDS)(
    "replays a shared world's journal at the bundled rules, with a second traveler leaving and returning (seed %i)",
    (seed) => {
      const dispatch = sharedBoundary(),
        alone = { claimed: [first], present: [first] },
        both = { claimed: [first, second], present: [first, second] };
      const create = { op: "create", seed, actor: first },
        start = dispatch(create).world,
        journal = [];
      let world = start;
      const leg = (seats, steps) => {
        const out = walk(shared(dispatch, seats), world, { seed, steps: steps * SCALE });
        journal.push(...out.trace);
        world = out.state;
        return out.reached;
      };
      const host = (command) => {
        journal.push(command);
        world = replay(shared(dispatch, both), world, [command]);
      };
      const solo = leg(alone, 12);
      host({ op: "join", actor: second, ...both });
      const together = leg(both, 24);
      host({ op: "presence", actor: first, ...both, present: [first] });
      const away = leg({ ...both, present: [first] }, 8);
      host({ op: "presence", actor: second, ...both });
      const back = leg(both, 12);
      expect(solo[`by:${first}`]).toBeGreaterThan(0);
      expect(together[`by:${second}`]).toBeGreaterThan(0);
      expect(away[`by:${second}`]).toBeUndefined();
      expect(back[`by:${second}`]).toBeGreaterThan(0);
      expect(together.stale).toBeGreaterThan(0);
      expect(world.revision).toBeGreaterThan(start.revision);
      const again = sharedBoundary();
      expect(
        replay(shared(again, both), again(create).world, journal),
      ).toEqual(world);
    },
    120_000 * SCALE,
  );
});
