import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { readFileSync } from "node:fs";
import {
  drawStep,
  levelGap,
  levelOf,
  levelXp,
  questSteps,
  questXp,
  STEP_VERBS,
} from "../v2/card-game/want.mjs";
import { levelTier } from "../v2/card-game/level-tiers.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  questCaption,
  questCard,
  questCards,
  metQuests,
  questTier,
} from "../v2/card-game/quest-card.mjs";

const act = (s, pick, actor = "vale") =>
  play(s, legalActions(s, actor).find(pick), s.revision, actor).state;
const wait = (s) => act(s, (a) => a.kind === "wait");
// Sleep is a Wait after a Wait; at a sanctuary it is a long rest.
const sleep = (s) => act(wait(s), (a) => a.sleep);
const dropQuest = (a) => a.kind === "drop" && !a.item;
// Vale at home in the attic, the hub's sanctuary, with experience enough.
const ready = (xp = questXp(2)) => {
  const s = createWorld();
  s.actors.vale.place = "attic";
  s.actors.vale.xp = xp;
  return s;
};

describe("the level quest", () => {
  it("has one step per five levels, as the level curve table says", () => {
    expect([2, 5, 6, 10, 11, 50, 100].map(questSteps)).toEqual([
      1, 1, 2, 2, 3, 10, 20,
    ]);
    // Each row of docs/design/level-curve.md: level, steps, cumulative steps,
    // cumulative steps and rests.
    const doc = readFileSync(
      new URL("../docs/design/level-curve.md", import.meta.url),
      "utf8",
    );
    const rows = [
      ...doc.matchAll(
        /^\| (\d+) \([A-Za-z]+\) \| (\d+) \| (\d+) \| (\d+) \|$/gmu,
      ),
    ];
    expect(rows.map((r) => Number(r[1]))).toEqual([10, 20, 30, 50, 100]);
    for (const [, level, steps, total, all] of rows) {
      const upTo = (n) =>
        Array.from({ length: n - 1 }, (_, i) => questSteps(i + 2));
      const sum = upTo(Number(level)).reduce((a, b) => a + b, 0);
      expect([questSteps(Number(level)), sum, sum + Number(level) - 1]).toEqual(
        [Number(steps), Number(total), Number(all)],
      );
    }
    // Legendary is in reach: at most 400 steps and rests from level 1, as
    // many ordinary wants again between levels (option A, rules 99), and the
    // experience they give is the experience it asks.
    const legendary = levelTier(50);
    expect(legendary.id).toBe("legendary");
    expect(questXp(legendary.minLevel)).toBeLessThanOrEqual(800);
    let xp = 1;
    for (let level = 2; level < 50; level++) {
      expect(levelXp(level - 1)).toBe(xp);
      xp += levelGap(level - 1);
      expect(xp).toBe(questXp(level));
      xp += questSteps(level) + 1;
    }
  });

  it("never draws a violent step, at any level", () => {
    const s = createWorld();
    for (let level = 2; level <= 120; level += 3)
      for (let roll = 0; roll < 60; roll++) {
        const step = drawStep(s, "vale", null, "person", "keeper", level, roll);
        expect(["meet", undefined]).toContain(step?.verb);
      }
    expect(STEP_VERBS.person).toEqual(["meet"]);
  });

  it("holds the player's level at the threshold until a long rest brings the quest in a dream", () => {
    let s = createWorld();
    s.actors.vale.xp = 6;
    expect(levelOf(s, "vale")).toBe(4);
    s = ready();
    s.actors.vale.level = 1;
    s = sleep(s);
    // One step, then the rest that raises the level.
    expect(s.actors.vale.want).toMatchObject({ quest: { level: 2, left: 2 } });
    expect(levelOf(s, "vale")).toBe(1);
    const vale = narrativeContext(s).entities.find((e) => e.id === "vale");
    expect(vale.facts[0]).toMatch(/^In a dream, the quest for level 2: /);
    expect(narrativeContext(s).rest).toBe("long");
    // The quest card shows the level quest in place of the want.
    const card = questCard(s);
    expect(questCaption(card)).toMatch(/^Level II: /);
    // Its colour is the tier of the level it leads to.
    expect(questTier(card).id).toBe("common");
    expect(questTier({ ...card, level: 20 }).id).toBe("rare");
    expect(questTier({ ...card, level: 50 }).id).toBe("legendary");
    expect(validateWorld(s)).toBe(s);
  });

  it("brings no quest below the threshold or while one is open", () => {
    let s = ready(0);
    s = sleep(s);
    expect(s.actors.vale.want?.quest).toBeUndefined();
    s = ready();
    s = sleep(s);
    const quest = s.actors.vale.want;
    s.actors.vale.place = "attic";
    s = sleep(s);
    expect(s.actors.vale.want).toEqual(quest);
  });

  it("returns to the last sanctuary visited, where a long rest raises the level", () => {
    // Level VI is two steps and the rest.
    let s = ready(questXp(6));
    s.actors.vale.level = 5;
    // A level V player has played a while.
    s.turn = s.revision = 48;
    s = sleep(s);
    expect(s.actors.vale.want.quest).toEqual({ level: 6, left: 3 });
    expect(s.actors.vale.sanctuary).toBe("attic");
    s.actors.vale.place = "attic";
    // Each step is pinned to a plain place step, whatever verb was drawn,
    // and the lamp rests in the attic, so no drawn step is met on arrival.
    const plain = ({ step, ...want }) => want;
    const go = (s, target) => {
      s.actors.vale.want = {
        ...plain(s.actors.vale.want),
        kind: "place",
        target,
      };
      return act(s, (a) => a.kind === "move" && a.target === target);
    };
    s.items.lamp.holder = "attic";
    s = go(s, "pond");
    expect(s.actors.vale.want.quest).toEqual({ level: 6, left: 2 });
    // Vale has since slept at the Hillside Sanctuary: the way back leads there,
    // not to her home in the attic.
    s.actors.vale.sanctuary = "greek-sanctuary";
    s = go(s, "station");
    expect(levelOf(s, "vale")).toBe(5);
    expect(s.actors.vale.want).toMatchObject({
      kind: "place",
      target: "greek-sanctuary",
      quest: { level: 6, left: 1 },
      step: { verb: "rest" },
    });
    expect(questCaption(questCard(s))).toBe(
      "Level VI: Rest at The Hillside Sanctuary",
    );
    expect(validateWorld(s)).toBe(s);
    // Being there is not enough: the long rest there raises the level.
    s.actors.vale.place = "greek-sanctuary";
    // The Bard, walking there, would wake her as he arrives.
    s.actors["greek-rhapsode"].place = "greek-palace";
    // A long rest needs a long sleep: she sleeps again as the Bard and
    // Ismene come and go, until one sleep runs long.
    s = sleep(s);
    for (let i = 0; i < 8 && narrativeContext(s).rest !== "long"; i++)
      s = act(s, (a) => a.sleep);
    expect(narrativeContext(s).rest).toBe("long");
    expect(levelOf(s, "vale")).toBe(6);
    expect(s.actors.vale.want?.quest).toBeUndefined();
    expect(validateWorld(s)).toBe(s);
  });

  it.each([
    [5, 1],
    [10, 2],
    [50, 5],
    [100, 6],
  ])("awards the level %i final rest %i XP", (level, xp) => {
    const s = ready(questXp(level) + questSteps(level));
    s.turn = s.revision = 24 * (level + 1);
    s.actors.vale.level = level - 1;
    s.actors.vale.want = {
      kind: "place",
      target: "attic",
      since: s.turn,
      refusals: 0,
      step: { verb: "rest" },
      quest: { level, left: 1 },
    };
    const after = decodeSave(encodeSave(sleep(s)));
    expect(after.actors.vale.level).toBe(level);
    expect(after.actors.vale.xp - s.actors.vale.xp).toBe(xp);
    expect(metQuests([questCard(s)], after, s.eventSeq)).toMatchObject([
      { earnedXp: xp },
    ]);
  });

  it.each([true, false])(
    "keeps each attic rest reward in completion order, level quest on top: %s",
    (levelOnTop) => {
      const s = ready(questXp(50) + questSteps(50));
      s.turn = s.revision = 24 * 51;
      const rest = {
        kind: "place",
        target: "attic",
        since: s.turn,
        refusals: 0,
        step: { verb: "rest" },
      };
      const levelRest = { ...rest, quest: { level: 50, left: 1 } };
      Object.assign(s.actors.vale, {
        level: 49,
        want: levelOnTop ? levelRest : rest,
        under: [levelOnTop ? rest : levelRest],
      });
      const before = questCards(s);
      const after = decodeSave(encodeSave(sleep(decodeSave(encodeSave(s)))));
      expect(after.actors.vale.xp - s.actors.vale.xp).toBe(6);
      expect(metQuests(before, after, s.eventSeq)).toMatchObject([
        { key: before.find((q) => !q.level).key, level: null, earnedXp: 1 },
        { key: before.find((q) => q.level).key, level: 50, earnedXp: 5 },
      ]);
    },
  );

  it("can be dropped for its cost in experience, keeping the level", () => {
    let s = ready(questXp(4));
    s.turn = s.revision = 4;
    s.actors.vale.level = 3;
    s = sleep(s);
    expect(s.actors.vale.want.quest.level).toBe(4);
    s = act(s, dropQuest);
    expect(s.actors.vale.xp).toBe(questXp(4) - 3);
    expect(levelOf(s, "vale")).toBe(3);
    expect(s.actors.vale.want?.quest).toBeUndefined();
    // The ordinary quest beneath stays droppable; no level quest is left.
    expect(
      [s.actors.vale.want, ...(s.actors.vale.under || [])].some(
        (w) => w?.quest,
      ),
    ).toBe(false);
    expect(s.log.findLast((e) => e.verb === "drop")).toMatchObject({
      actorId: "vale",
    });
    expect(validateWorld(s)).toBe(s);
  });

  it("never drops below the experience that earned the level", () => {
    // At Legendary the quest's experience is mostly what level 50 took.
    // A long-played world, so the experience is in range.
    let s = ready(questXp(51));
    s.turn = s.revision = 200;
    s.actors.vale.level = 50;
    s = sleep(s);
    expect(s.actors.vale.want.quest.level).toBe(51);
    s = act(s, dropQuest);
    expect(s.actors.vale.xp).toBe(questXp(50));
    expect(levelOf(s, "vale")).toBe(50);
    // Experience well past the level, from the old curve, costs the same.
    s = ready(1000);
    s.turn = s.revision = 200;
    s.actors.vale.level = 6;
    s = sleep(s);
    s = act(s, dropQuest);
    expect(s.actors.vale.xp).toBe(994);
    expect(levelOf(s, "vale")).toBe(6);
    expect(validateWorld(s)).toBe(s);
  });

  it("offers a player at old-curve experience one level quest per long rest", () => {
    let s = ready(1000);
    s.turn = s.revision = 200;
    s.actors.vale.level = 1;
    const levelQuests = (s) =>
      [s.actors.vale.want, ...(s.actors.vale.under || [])].filter(
        (w) => w?.quest,
      );
    s = sleep(s);
    expect(narrativeContext(s).rest).toBe("long");
    expect(levelQuests(s).map((w) => w.quest)).toEqual([{ level: 2, left: 2 }]);
    // The quest done but its rest, the long rest that ends it brings no
    // second offer; the next long rest brings the next level's quest alone.
    s.actors.vale.want = {
      kind: "place",
      target: "attic",
      since: s.turn,
      refusals: 0,
      quest: { level: 2, left: 1 },
      step: { verb: "rest" },
    };
    s = sleep(s);
    expect(narrativeContext(s).rest).toBe("long");
    expect(levelOf(s, "vale")).toBe(2);
    expect(levelQuests(s)).toEqual([]);
    s.actors.vale.place = "attic";
    s = sleep(s);
    expect(narrativeContext(s).rest).toBe("long");
    expect(levelQuests(s).map((w) => w.quest)).toEqual([{ level: 3, left: 2 }]);
    expect(validateWorld(s)).toBe(s);
  });

  it("shortens a level quest saved before rules 90 to its level's steps", () => {
    const s = createWorld();
    s.turn = s.revision = 48;
    s.actors.vale.level = 5;
    s.actors.vale.xp = questXp(6);
    s.actors.vale.want = {
      kind: "place",
      target: "pond",
      since: 0,
      refusals: 0,
      quest: { level: 6, left: 9 },
    };
    const loaded = decodeSave(JSON.stringify(s));
    expect(loaded.actors.vale.want.quest).toEqual({ level: 6, left: 3 });
    expect(validateWorld(loaded)).toBe(loaded);
  });

  it("lets residents level on experience alone", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s = wait(s);
    s = wait(s);
    expect(s.items.lamp.holder).toBe("moth");
    expect(levelOf(s, "moth")).toBe(2);
  });

  it("raises the player's level only through a met level quest through a long run", () => {
    let s = createWorld();
    let quests = 0;
    for (let step = 0; step < 400; step++) {
      // Now and then the player comes home to the attic with experience.
      if (step % 40 === 0) {
        s.actors.vale.place = "attic";
        s.actors.vale.xp += 3;
      }
      const before = levelOf(s, "vale"),
        want = s.actors.vale.want,
        seq = s.log.at(-1).seq;
      const actions = legalActions(s);
      s = play(s, actions[(step * 7919) % actions.length]).state;
      const after = levelOf(s, "vale");
      expect(after).toBeGreaterThanOrEqual(before);
      if (after > before) {
        expect(want).toMatchObject({
          quest: { level: after, left: 1 },
          step: { verb: "rest" },
        });
        expect(
          s.log.some(
            (e) => e.seq > seq && e.verb === "want_met" && e.actorId === "vale",
          ),
        ).toBe(true);
      }
      const quest = s.actors.vale.want?.quest;
      if (quest) {
        quests++;
        expect(quest.left).toBeLessThanOrEqual(questSteps(quest.level) + 1);
        expect(quest.level).toBe(levelOf(s, "vale") + 1);
      }
    }
    expect(validateWorld(s)).toBe(s);
    expect(quests).toBeGreaterThan(0);
  });
});
