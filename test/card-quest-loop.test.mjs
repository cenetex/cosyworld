// Rules 99, the quest loop: the halfway quest to sleep at a sanctuary, the
// glimpse it brings, one or two dreams per level, and quests from Talk.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  halfwayXp,
  levelXp,
  newWant,
  pushQuest,
  questsOf,
  questXp,
} from "../v2/card-game/want.mjs";

export const act = (s, pick, actor = "vale") =>
  play(s, legalActions(s, actor).find(pick), s.revision, actor).state;
// Vale at level `level` with `xp`, an empty stack, in a long-played world.
export function at(level, xp) {
  const s = createWorld();
  s.turn = s.revision = 96;
  Object.assign(s.actors.vale, { level, xp, want: null });
  s.actors.vale.visited = [...new Set([...s.actors.vale.visited, "pond"])];
  return s;
}
// One ordinary want met: a place want for the next room, walked to.
export function meetOne(s) {
  const move = legalActions(s, "vale").find((a) => a.kind === "move");
  pushQuest(s, "vale", newWant("place", move.target, s.turn));
  return play(s, move, s.revision, "vale").state;
}
const wokeLong = (s) =>
  s.log.findLast((e) => e.actorId === "vale" && e.woke !== undefined)?.rest ===
  "long";
// A long rest in the attic, the hub's sanctuary: Sleep until one runs long.
export function longRest(s, place = "attic") {
  s.actors.vale.place = place;
  s = act(s, (a) => a.kind === "wait");
  s = act(s, (a) => a.sleep);
  for (let i = 0; i < 8 && !wokeLong(s); i++) s = act(s, (a) => a.sleep);
  expect(wokeLong(s)).toBe(true);
  return s;
}
export const sanctuaryQuests = (s) =>
  questsOf(s, "vale").filter((w) => w.step?.verb === "rest" && !w.quest);
const levelQuest = (s) => questsOf(s, "vale").find((w) => w.quest) ?? null;
const reload = (s) => decodeSave(encodeSave(s));

describe("the halfway quest to sleep at a sanctuary", () => {
  it("comes once at halfway, and a long rest in any sanctuary meets it", () => {
    // Level X asks a gap of four ordinary wants: halfway is two.
    let s = at(10, halfwayXp(10) - 1);
    s = meetOne(s);
    expect(s.actors.vale.xp).toBe(halfwayXp(10));
    expect(sanctuaryQuests(s)).toHaveLength(1);
    expect(s.actors.vale.halfwayIssued).toBe(11);
    expect(validateWorld(reload(s))).toBeTruthy();
    // Met at the Hillside Sanctuary as well as in the attic: one more want.
    s = longRest(s, "greek-sanctuary");
    expect(sanctuaryQuests(s)).toHaveLength(0);
    expect(s.actors.vale.xp).toBe(halfwayXp(10) + 1);
    // Short of full experience before the rest, no level quest comes.
    expect(levelQuest(s)).toBeNull();
    expect(validateWorld(s)).toBe(s);
  });

  it("is free to drop and never returns that level", () => {
    let s = at(10, halfwayXp(10) - 1);
    s = meetOne(s);
    const i = questsOf(s, "vale").findIndex((w) => w.step?.verb === "rest");
    const xp = s.actors.vale.xp;
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === i);
    expect(s.actors.vale.xp).toBe(xp);
    expect(sanctuaryQuests(s)).toHaveLength(0);
    s = meetOne(s);
    expect(sanctuaryQuests(s)).toHaveLength(0);
  });

  it("points to a sanctuary again at full, and any long rest at full brings the level quest", () => {
    let s = at(2, questXp(3) - 1);
    s.actors.vale.halfwayIssued = 3;
    s = meetOne(s);
    expect(s.actors.vale.xp).toBe(questXp(3));
    expect(sanctuaryQuests(s)).toHaveLength(1);
    // Dropped, it cannot block levelling.
    const i = questsOf(s, "vale").findIndex((w) => w.step?.verb === "rest");
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === i);
    s = longRest(s);
    expect(levelQuest(s)?.quest).toMatchObject({ level: 3 });
    expect(validateWorld(s)).toBe(s);
  });

  it("keeps its curve: halfway between reaching the level and the next quest", () => {
    for (const level of [1, 2, 5, 10, 49]) {
      expect(halfwayXp(level)).toBeGreaterThan(levelXp(level));
      expect(halfwayXp(level)).toBeLessThan(questXp(level + 1));
    }
  });
});
