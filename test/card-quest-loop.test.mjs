import { collectRewards } from "./helpers/claim-rewards.mjs";
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
  wantAPI,
} from "../v2/card-game/world.mjs";
import {
  halfwayXp,
  levelXp,
  newWant,
  offerLevelQuest,
  pushQuest,
  questsOf,
  questXp,
} from "../v2/card-game/want.mjs";
import {
  drawGlimpse,
  glimpseAspect,
  GLIMPSE_KINDS,
  honours,
} from "../v2/card-game/glimpse.mjs";
import { sleepPlan, sleepWake } from "../v2/card-game/sleep-presentation.mjs";
import {
  reflectionContext,
  reflectionDue,
} from "../v2/card-game/reflections.mjs";
import { glimpseCompanion } from "../v2/card-game/glimpse-card.mjs";

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
  return collectRewards(play(s, move, s.revision, "vale").state);
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
    s = collectRewards(s);
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

// Vale at level X with the halfway quest, short of full.
function halfway() {
  let s = at(10, halfwayXp(10) - 1);
  s.actors.vale.talked = ["keeper", "moth"];
  return meetOne(s);
}
const wake = (s) =>
  s.log.findLast((e) => e.actorId === "vale" && e.woke !== undefined);

describe("the halfway glimpse", () => {
  it("locks one aspect of the coming level quest, which its first step uses", () => {
    let s = longRest(halfway());
    const glimpse = s.actors.vale.glimpse;
    expect(glimpse).toMatchObject({ level: 11, at: "attic" });
    expect(GLIMPSE_KINDS).toContain(glimpse.kind);
    expect(wake(s)).toMatchObject({ rest: "long", dream: "glimpse" });
    // The DREAM card with the aspect beside it, partly shown; no quest beat.
    const shown = sleepWake(s, "vale", s.turn - 1);
    expect(shown).toMatchObject({ dream: true, glimpse, quests: [] });
    expect(sleepPlan(shown)).toContain("dream");
    expect(sleepPlan(shown)).not.toContain("quest");
    expect(glimpseCompanion(shown.glimpse)).toEqual({
      kind: glimpse.kind,
      id: glimpse.id,
      revealed: 0.5,
    });
    // Saved and replayed exactly.
    expect(reload(s).actors.vale.glimpse).toEqual(glimpse);
    // A long rest after the glimpse, short of full, brings no dream.
    s = longRest(s);
    expect(wake(s).dream).toBeUndefined();
    expect(levelQuest(s)).toBeNull();
    while (s.actors.vale.xp < questXp(11)) s = meetOne(s);
    s = longRest(s);
    const quest = levelQuest(s);
    expect(quest.quest).toEqual({ level: 11, left: 4 });
    expect(honours(quest, glimpseAspect(s, "vale", wantAPI(s), glimpse))).toBe(
      true,
    );
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("is honoured by the level quest in 1,000 seeded runs, for every kind", () => {
    const base = at(10, questXp(11));
    const kinds = new Set();
    for (let seed = 0; seed < 1000; seed++) {
      const s = structuredClone(base);
      s.run = { seed };
      // What Vale knows varies by run.
      const people = ["keeper", "moth", "badger", "greek-guard"];
      s.actors.vale.talked = people.slice(0, seed % 5);
      s.actors.vale.visited = ["station", "pond", "attic"].slice(
        0,
        1 + (seed % 3),
      );
      const api = wantAPI(s);
      const glimpse = drawGlimpse(s, "vale", api, 11);
      expect(drawGlimpse(s, "vale", api, 11)).toEqual(glimpse);
      kinds.add(glimpse.kind);
      s.actors.vale.glimpse = glimpse;
      const quest = offerLevelQuest(s, "vale", api);
      expect(quest.quest.level).toBe(11);
      expect(honours(quest, glimpse)).toBe(true);
    }
    expect([...kinds].sort()).toEqual([...GLIMPSE_KINDS].sort());
  });

  it("keeps an aspect out of reach, and puts the nearest known one for a retired id", () => {
    const s = at(10, questXp(11));
    s.actors.vale.talked = ["keeper", "moth"];
    const api = wantAPI(s);
    // Asleep with its pack, the thing is kept: the quest may wait.
    s.disabledPacks = ["hoppy"];
    const asleep = {
      level: 11,
      kind: "item",
      id: "hoppycat-red-thread-spool",
      at: "station",
    };
    expect(glimpseAspect(s, "vale", api, asleep)).toEqual(asleep);
    // A person no longer in the world: the nearest known person instead,
    // fewest steps from where the glimpse was dreamed, ties by id.
    const retired = {
      level: 11,
      kind: "person",
      id: "gone-person",
      at: "attic",
    };
    const steps = (id) => api.distance("attic", s.actors[id].place, "vale");
    const nearest = ["keeper", "moth"].sort(
      (x, y) => steps(x) - steps(y) || (x < y ? -1 : 1),
    )[0];
    expect(glimpseAspect(s, "vale", api, retired)).toEqual({
      ...retired,
      id: nearest,
    });
    s.actors.vale.glimpse = retired;
    const quest = offerLevelQuest(s, "vale", api);
    expect(honours(quest, { ...retired, id: nearest })).toBe(true);
    expect(validateWorld(s)).toBe(s);
  });

  it("brings none when the halfway quest is dropped, or when full comes first", () => {
    let s = halfway();
    const i = questsOf(s, "vale").findIndex((w) => w.step?.verb === "rest");
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === i);
    s = longRest(s);
    expect(s.actors.vale.glimpse).toBeUndefined();
    expect(wake(s).dream).toBeUndefined();
    // Halfway and full crossed before one long rest: the quest, drawn freely.
    s = halfway();
    while (s.actors.vale.xp < questXp(11)) s = meetOne(s);
    s = longRest(s);
    expect(s.actors.vale.glimpse).toBeUndefined();
    expect(levelQuest(s).quest.level).toBe(11);
  });
});

// Each level dreams once or twice, never more (sleep spec §5): the dreams
// a long rest's wake records, and the only ones a reflection may write.
const dreamsSince = (s, seq) =>
  s.log
    .filter((e) => e.seq > seq && e.actorId === "vale" && e.dream)
    .map((e) => e.dream);
// A long rest, checking that a dream is due exactly when the rules dreamed.
function restAndReflect(s) {
  s = longRest(s);
  const due = reflectionDue(reflectionContext(s), "vale", null);
  expect(due).toEqual({ thought: true, dream: Boolean(wake(s).dream) });
  return s;
}

describe("dreams per level", () => {
  it("are two with a long rest after halfway, never a third", () => {
    let s = halfway();
    const from = s.log.at(-1).seq;
    s = restAndReflect(s);
    // More long rests between halfway and full bring no dream.
    s = restAndReflect(restAndReflect(s));
    while (s.actors.vale.xp < questXp(11)) s = meetOne(s);
    s = restAndReflect(s);
    expect(dreamsSince(s, from)).toEqual(["glimpse", "quest"]);
  });

  it("is one when full experience comes before a long rest, or the halfway quest is dropped", () => {
    let s = halfway();
    let from = s.log.at(-1).seq;
    while (s.actors.vale.xp < questXp(11)) s = meetOne(s);
    s = restAndReflect(restAndReflect(s));
    expect(dreamsSince(s, from)).toEqual(["quest"]);
    s = halfway();
    from = s.log.at(-1).seq;
    const i = questsOf(s, "vale").findIndex((w) => w.step?.verb === "rest");
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === i);
    s = restAndReflect(s);
    while (s.actors.vale.xp < questXp(11)) s = meetOne(s);
    s = restAndReflect(s);
    expect(dreamsSince(s, from)).toEqual(["quest"]);
  });

  it("never comes to an ordinary long rest or a Wait", () => {
    let s = at(10, levelXp(10));
    s = restAndReflect(s);
    expect(wake(s).dream).toBeUndefined();
    const context = { ...reflectionContext(s), rest: undefined };
    const life = {
      persona: null,
      thoughts: [1, 2, 3].map((turn) => ({ turn, text: "A thought." })),
      dreams: [],
    };
    expect(reflectionDue(context, "vale", life).dream).toBe(false);
  });
});
