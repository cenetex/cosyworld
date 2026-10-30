import { setImmediate as yieldToRunner } from "node:timers/promises";
import { expect } from "vitest";
import {
  createWorld,
  legalActions,
  plan,
  play,
} from "../../v2/card-game/world.mjs";
import { levelOf } from "../../v2/card-game/quests.mjs";

const actors = ["vale", "moth", "keeper"];
const progressOf = (s) =>
  actors.map((id) => levelOf(s, id) * 100 + s.actors[id].progress.step);

// Each seed plays 400 loose turns, then 160 planned turns in which every
// avatar must finish a step. The seeds are split across files so CI can run
// them on separate workers.
export async function expectSeedsKeepProgressing(seeds) {
  for (const seed of seeds) {
    let x = (seed * 2654435761) >>> 0,
      s = createWorld();
    for (let i = 0; i < 400; i++) {
      if (i % 100 === 0) await yieldToRunner();
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      const acts = legalActions(s);
      s = play(s, i % 2 === 0 ? plan(s).action : acts[x % acts.length]).state;
    }
    const before = progressOf(s);
    const completed = new Set();
    for (let i = 0; i < 160; i++) {
      if (i % 100 === 0) await yieldToRunner();
      const next = play(s, plan(s).action).state;
      for (const id of actors)
        if (
          next.actors[id].progress.marks.at(-1) !==
          s.actors[id].progress.marks.at(-1)
        )
          completed.add(id);
      s = next;
    }
    expect(progressOf(s), `seed ${seed}`).not.toEqual(before);
    expect([...completed].sort(), `seed ${seed}`).toEqual([...actors].sort());
  }
}
