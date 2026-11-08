import assert from "node:assert/strict";
import { test } from "vitest";
import { questRewardProgress } from "../v2/card-game/quest-reward-progress.mjs";
import { questXp, levelXp } from "../v2/card-game/want.mjs";

test("reward progress reads banked XP without changing level or granting it", () => {
  for (let level = 1; level <= 6; level++) {
    const floor = levelXp(level), goal = questXp(level + 1);
    for (const xp of [0, floor, floor + 1, goal, goal + 6]) {
      const world = { actors: { vale: { level, xp } } };
      const before = structuredClone(world);
      const progress = questRewardProgress(world, "vale");
      assert.equal(progress.value, Math.min(goal - floor, Math.max(0, xp - floor)));
      assert.equal(progress.max, goal - floor);
      assert.equal(progress.ready, xp >= goal);
      assert.equal(progress.nextLevel, level + 1);
      assert.deepEqual(world, before);
    }
  }
});
