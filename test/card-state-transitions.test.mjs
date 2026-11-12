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
const SHARED_SEEDS = process.env.TRANSITION_SEEDS ? SEEDS : SEEDS.slice(0, 1);
const SCALE = Number(process.env.TRANSITION_SCALE || 1);
const [first, second] = humanAvatarIds;
const moves = (c) => c.kind === "move";

describe("state transitions on a seeded walk (#2520)", () => {
  it.each(SEEDS)(
    "reads back every state of the opening, before and after the crossing (seed %i)",
    async (seed) => {
      const driver = local(first),
        start = createWorld({ opening: true, seed });
      const before = await walk(driver, start, { seed, steps: 30 * SCALE, only: (c) => !moves(c) });
      expect(before.state.opening.crossed).toBe(false);
      expect(before.trace.length).toBeGreaterThanOrEqual(10 * SCALE);
      expect(before.reached.stale).toBeGreaterThan(0);
      const crossing = wayTo(driver, before.state, (s) => s.opening.crossed, 4);
      expect(crossing, `seed ${seed} a way out of the opening`).toBeTruthy();
      const crossed = await replay(driver, before.state, crossing);
      expect(crossed.opening.met[first]).toBe(start.opening.met[first]);
      const after = await walk(driver, crossed, { seed, steps: 50 * SCALE });
      expect(after.state.opening.crossed).toBe(true);
      expect(after.reached.move).toBeGreaterThan(0);
      expect(after.reached.stale).toBeGreaterThan(0);
      const trace = [...before.trace, ...crossing, ...after.trace];
      expect(encodeSave(await replay(driver, start, trace))).toBe(encodeSave(after.state));
    },
    60_000 * SCALE,
  );

  it.each(SEEDS)(
    "reads back every state of a local world with no opening, through pack changes (seed %i)",
    async (seed) => {
      const driver = local(first),
        start = createWorld({ seed });
      const { state, trace, reached } = await walk(driver, start, { seed, steps: 72 * SCALE });
      expect(start.opening).toBeUndefined();
      expect(state.opening).toBeUndefined();
      for (const kind of ["move", "wait", "take", "pack", "stale"])
        expect(reached[kind], `seed ${seed} reached ${kind}`).toBeGreaterThan(0);
      expect(state.turn).toBeGreaterThan(start.turn);
      expect(encodeSave(await replay(driver, start, trace))).toBe(encodeSave(state));
    },
    60_000 * SCALE,
  );

  it.each(SHARED_SEEDS)(
    "replays a shared world's journal at the bundled rules, with a second traveler leaving and returning (seed %i)",
    async (seed) => {
      const dispatch = sharedBoundary(),
        alone = { claimed: [first], present: [first] },
        both = { claimed: [first, second], present: [first, second] };
      const create = { op: "create", seed, actor: first },
        start = dispatch(create).world,
        journal = [];
      let world = start;
      const leg = async (seats, steps) => {
        const out = await walk(shared(dispatch, seats), world, { seed, steps: steps * SCALE });
        journal.push(...out.trace);
        world = out.state;
        return out.reached;
      };
      const host = async (command) => {
        journal.push(command);
        world = await replay(shared(dispatch, both), world, [command]);
      };
      const solo = await leg(alone, 6);
      await host({ op: "join", actor: second, ...both });
      const together = await leg(both, 12);
      await host({ op: "presence", actor: first, ...both, present: [first] });
      const away = await leg({ ...both, present: [first] }, 4);
      await host({ op: "presence", actor: second, ...both });
      const back = await leg(both, 6);
      expect(solo[`by:${first}`]).toBeGreaterThan(0);
      expect(together[`by:${second}`]).toBeGreaterThan(0);
      expect(away[`by:${second}`]).toBeUndefined();
      expect(back[`by:${second}`]).toBeGreaterThan(0);
      expect(together.stale).toBeGreaterThan(0);
      expect(world.revision).toBeGreaterThan(start.revision);
      const again = sharedBoundary();
      expect(
        await replay(shared(again, both), again(create).world, journal),
      ).toEqual(world);
    },
    120_000 * SCALE,
  );
});
