import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { levelOf, questSteps } from "../v2/card-game/want.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  questCaption,
  questCard,
  questTier,
} from "../v2/card-game/quest-card.mjs";

const act = (s, pick, actor = "vale") =>
  play(s, legalActions(s, actor).find(pick), s.revision, actor).state;
const wait = (s) => act(s, (a) => a.kind === "wait");
const dropQuest = (a) => a.kind === "drop" && !a.item;
// Vale at home in the attic, the hub's sanctuary, with experience enough.
const ready = (xp = 1) => {
  const s = createWorld();
  s.actors.vale.place = "attic";
  s.actors.vale.xp = xp;
  return s;
};

describe("the level quest", () => {
  it("has a Fibonacci number of steps", () => {
    expect([1, 2, 3, 4, 5, 6].map(questSteps)).toEqual([1, 1, 2, 3, 5, 8]);
  });

  it("holds the player's level at the threshold until a long rest brings the quest in a dream", () => {
    let s = createWorld();
    s.actors.vale.xp = 6;
    expect(levelOf(s, "vale")).toBe(4);
    s = ready();
    s.actors.vale.level = 1;
    s = wait(s);
    // One step, then the rest that raises the level.
    expect(s.actors.vale.want).toMatchObject({ quest: { level: 2, left: 2 } });
    expect(levelOf(s, "vale")).toBe(1);
    const vale = narrativeContext(s).entities.find((e) => e.id === "vale");
    expect(vale.facts[0]).toMatch(/^In a dream, the quest for level 2: /);
    expect(narrativeContext(s).rest).toBe("long");
    // The quest card shows the level quest in place of the want.
    const card = questCard(s);
    expect(questCaption(card)).toMatch(/^Level II: /);
    // Its colour follows its F(n) steps: 1 is Common, 5 (level V) is Rare.
    expect(questTier(card).id).toBe("common");
    expect(questTier({ ...card, level: 5 }).id).toBe("rare");
    expect(validateWorld(s)).toBe(s);
  });

  it("brings no quest below the threshold or while one is open", () => {
    let s = ready(0);
    s = wait(s);
    expect(s.actors.vale.want?.quest).toBeUndefined();
    s = ready();
    s = wait(s);
    const quest = s.actors.vale.want;
    s.actors.vale.place = "attic";
    s = wait(s);
    expect(s.actors.vale.want).toEqual(quest);
  });

  it("returns to the last sanctuary visited, where a long rest raises the level", () => {
    let s = ready(3);
    s.actors.vale.level = 2;
    s = wait(s);
    expect(s.actors.vale.want.quest).toEqual({ level: 3, left: 3 });
    expect(s.actors.vale.sanctuary).toBe("attic");
    s.actors.vale.place = "attic";
    // Each step is pinned to a plain place step, whatever verb was drawn,
    // and the lamp rests in the attic, so no drawn step is met on arrival.
    const plain = ({ step, ...want }) => want;
    const go = (s, target) => {
      s.actors.vale.want = { ...plain(s.actors.vale.want), kind: "place", target };
      return act(s, (a) => a.kind === "move" && a.target === target);
    };
    s.items.lamp.holder = "attic";
    s = go(s, "pond");
    expect(s.actors.vale.want.quest).toEqual({ level: 3, left: 2 });
    // Vale has since slept at the Hillside Sanctuary: the way back leads there,
    // not to her home in the attic.
    s.actors.vale.sanctuary = "greek-sanctuary";
    s = go(s, "station");
    expect(levelOf(s, "vale")).toBe(2);
    expect(s.actors.vale.want).toMatchObject({
      kind: "place",
      target: "greek-sanctuary",
      quest: { level: 3, left: 1 },
      step: { verb: "rest" },
    });
    expect(questCaption(questCard(s))).toBe("Level III: Rest at The Hillside Sanctuary");
    expect(validateWorld(s)).toBe(s);
    // Being there is not enough: the long rest there raises the level.
    s.actors.vale.place = "greek-sanctuary";
    s = wait(s);
    expect(narrativeContext(s).rest).toBe("long");
    expect(levelOf(s, "vale")).toBe(3);
    expect(s.actors.vale.want?.quest).toBeUndefined();
    expect(validateWorld(s)).toBe(s);
  });

  it("can be dropped for half the experience, keeping the level", () => {
    let s = ready(6);
    s.actors.vale.level = 3;
    s = wait(s);
    expect(s.actors.vale.want.quest.level).toBe(4);
    s = act(s, dropQuest);
    expect(s.actors.vale.xp).toBe(3);
    expect(levelOf(s, "vale")).toBe(3);
    expect(s.actors.vale.want?.quest).toBeUndefined();
    expect(legalActions(s).some(dropQuest)).toBe(false);
    expect(s.log.findLast((e) => e.verb === "drop")).toMatchObject({ actorId: "vale" });
    expect(validateWorld(s)).toBe(s);
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
          s.log.some((e) => e.seq > seq && e.verb === "want_met" && e.actorId === "vale"),
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
