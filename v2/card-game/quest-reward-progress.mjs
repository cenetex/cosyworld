// Presentation reads committed experience; it never grants XP or advances a level.
import { levelOf, levelXp, questXp } from "./want.mjs";

export function questRewardProgress(world, actor) {
  const level = levelOf(world, actor);
  const xp = world.actors[actor]?.xp || 0;
  const floor = levelXp(level), goal = questXp(level + 1);
  const max = Math.max(1, goal - floor);
  return {
    value: Math.min(max, Math.max(0, xp - floor)),
    max,
    ready: xp >= goal,
    nextLevel: level + 1,
  };
}
