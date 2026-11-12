import { describe, expect, it } from "vitest";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  LONG_SLEEP_TURNS,
  play,
  questOffers,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  dropCost,
  heldOf,
  holdQuest,
  newWant,
  questXp,
} from "../v2/card-game/want.mjs";
import { questCards } from "../v2/card-game/quest-card.mjs";

const act = (s, pick) => {
  const action = legalActions(s).find(pick);
  expect(action, "a legal play").toBeTruthy();
  const result = play(s, action, s.revision);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const talk = (s) => act(s, (a) => a.kind === "talk" && a.target === "moth");
const wait = (s) => act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards);
const discard = (s) => act(s, (a) => a.kind === "drop" && !a.item);
const sources = (s) => heldOf(s.actors.vale).map((w) => w.from);
const FROM = "quest:from:moth";
const reload = (s) => decodeSave(encodeSave(s));

describe("an offer is held without an accept play", () => {
  it("holds Pip's quest as his Talk ends, with nothing to accept", () => {
    const before = createPipWorld(5);
    expect(heldOf(before.actors.vale)).toEqual([]);
    const s = talk(before);
    expect(s.turn).toBe(before.turn + 1);
    expect(s.actors.vale.want).toMatchObject({
      kind: "item",
      target: "lamp",
      step: { verb: "give", to: "moth" },
      from: FROM,
    });
    expect(questOffers(s)).toEqual([]);
    expect(legalActions(s).some((a) => a.kind === "take" && a.offer)).toBe(false);
    expect(s.log.some((e) => e.verb === "quest")).toBe(false);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("offers the discard of the top quest only", () => {
    let s = talk(createPipWorld(5));
    const drops = legalActions(s).filter((a) => a.kind === "drop" && !a.item);
    expect(drops).toHaveLength(1);
    expect(drops[0].quest).toBe(0);
    expect(questCards(s)).toHaveLength(1);
  });
});

describe("quests stack", () => {
  const piped = () => talk(createPipWorld(5));
  const levelled = () => {
    const s = piped();
    s.actors.vale.level = 1;
    s.actors.vale.xp = questXp(2);
    s.actors.moth.place = "pond";
    return wait(s);
  };

  it("holds the level quest like any other, stacked on top of Pip's", () => {
    const s = levelled();
    expect(sources(s)).toEqual(["quest:level", FROM]);
    expect(s.actors.vale.want).toMatchObject({ quest: { level: 2, left: 1 } });
    expect(s.actors.vale.under).toHaveLength(1);
    expect(s.actors.vale.under[0].target).toBe("lamp");
    expect(questCards(s).map((q) => q.level)).toEqual([2, null]);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("stacks two offers made by one play, the level quest last and on top", () => {
    const start = createPipWorld(5);
    start.actors.vale.level = 1;
    start.actors.vale.xp = questXp(2);
    const s = talk(start);
    expect(sources(s)).toEqual(["quest:level", FROM]);
    expect(s.actors.vale.want.quest).toEqual({ level: 2, left: 1 });
  });

  it("shows the next quest when the top one is discarded", () => {
    let s = levelled();
    expect(dropCost(s, "vale")).toBeGreaterThan(0);
    s = discard(s);
    expect(sources(s)).toEqual([FROM]);
    expect(s.actors.vale.want.target).toBe("lamp");
    expect(s.actors.vale.under).toBeUndefined();
    expect(dropCost(s, "vale")).toBe(0);
    s = discard(s);
    expect(heldOf(s.actors.vale)).toEqual([]);
    expect(s.actors.vale.want).toBeNull();
  });

  it("meets Sleep at home from beneath another quest", () => {
    let s = levelled();
    s.actors.vale.place = "attic";
    s = wait(s);
    holdQuest(s, "vale", newWant("place", "pond", s.turn), "quest:box:test");
    expect(s.actors.vale.want.target).toBe("pond");
    expect(heldOf(s.actors.vale).some((w) => w.quest?.level === 2)).toBe(true);
    for (let i = 0; i < LONG_SLEEP_TURNS + 2 && s.actors.vale.level !== 2; i++) {
      const sleep = legalActions(s).find((a) => a.sleep);
      if (!sleep) break;
      s = play(s, sleep, s.revision).state;
    }
    expect(s.actors.vale.level).toBe(2);
    expect(sources(s)).toContain("quest:box:test");
    expect(heldOf(s.actors.vale).some((w) => w.quest)).toBe(false);
  });
});

describe("a closed quest stays closed", () => {
  const staying = (s) => {
    s.actors.moth.place = "pond";
    s.actors.vale.place = "pond";
    return s;
  };

  it("does not return the turn it was discarded, or later, while its terms hold", () => {
    let s = talk(createPipWorld(5));
    s = discard(s);
    expect(heldOf(s.actors.vale)).toEqual([]);
    expect(s.actors.vale.closed[FROM][1]).toContain("lamp");
    expect(questOffers(staying(s))).toEqual([]);
    for (let i = 0; i < 8; i++) {
      s = wait(staying(s));
      expect(sources(s)).not.toContain(FROM);
    }
    s = talk(staying(s));
    expect(sources(s)).not.toContain(FROM);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("returns when the source offers different terms", () => {
    let s = discard(talk(createPipWorld(5)));
    s = wait(staying(s));
    expect(sources(s)).toEqual([]);
    staying(s).actors.moth.want = newWant("item", "bell", s.turn);
    s.actors.moth.trust.vale = 1;
    s = talk(s);
    expect(sources(s)).toEqual([FROM]);
    expect(s.actors.vale.want).toMatchObject({ target: "bell", step: { verb: "give", to: "moth" } });
  });

  it("closes a quest that was met, so it is not held again and paid twice", () => {
    let s = talk(createPipWorld(5));
    s.actors.vale.want.refusals = 0;
    s.items.lamp.holder = "vale";
    const give = legalActions(s).find((a) => a.kind === "give" && a.target === "moth");
    expect(give).toBeTruthy();
    const xp = s.actors.vale.xp;
    s = play(s, give, s.revision).state;
    expect(s.actors.vale.xp).toBe(xp + 2); // the quest, and helping Pip meet his want
    expect(sources(s)).not.toContain(FROM);
    expect(s.actors.vale.closed[FROM]).toBeTruthy();
  });
});

describe("the stack is validated", () => {
  it("refuses a stack on a resident, a stack with no top, and a duplicate", () => {
    const base = wait(talk(createPipWorld(5)));
    const lamp = base.actors.vale.want;
    const bad = [
      (s) => (s.actors.moth.under = [structuredClone(lamp)]),
      (s) => ((s.actors.vale.want = null), (s.actors.vale.under = [structuredClone(lamp)])),
      (s) => (s.actors.vale.under = [structuredClone(lamp)]),
      (s) => (s.actors.vale.closed = {}),
      (s) => (s.actors.vale.closed = { other: "x" }),
    ];
    for (const corrupt of bad) {
      const s = structuredClone(base);
      corrupt(s);
      expect(() => validateWorld(s)).toThrow();
    }
  });
});

describe("every held quest is live", () => {
  const pip = () => talk(createPipWorld(5));

  it("meets a buried quest while another is on top, and pays it", () => {
    let s = pip();
    holdQuest(s, "vale", newWant("place", "station", s.turn), "quest:from:test");
    expect(sources(s)).toEqual(["quest:from:test", FROM]);
    s.items.lamp.holder = "vale";
    s.actors.moth.place = "pond";
    s.actors.vale.place = "pond";
    const xp = s.actors.vale.xp;
    const give = legalActions(s).find((a) => a.kind === "give" && a.target === "moth");
    s = play(s, give, s.revision).state;
    expect(sources(s)).toEqual(["quest:from:test"]);
    expect(s.actors.vale.want.target).toBe("station");
    expect(s.actors.vale.closed[FROM]).toBeTruthy();
    expect(s.actors.vale.xp).toBe(xp + 2);
  });

  it("meets two quests with one play, each paid, top first", () => {
    let s = pip();
    s.items.lamp.holder = "vale";
    holdQuest(s, "vale", newWant("item", "lamp", s.turn), "quest:from:test");
    expect(sources(s)).toEqual(["quest:from:test", FROM]);
    const xp = s.actors.vale.xp;
    s = wait(s);
    expect(sources(s)).toEqual([FROM]);
    expect(s.actors.vale.xp).toBe(xp + 1);
    s.actors.moth.place = "pond";
    s.actors.vale.place = "pond";
    const give = legalActions(s).find((a) => a.kind === "give" && a.target === "moth");
    const before = s.actors.vale.xp;
    s = play(s, give, s.revision).state;
    expect(sources(s)).not.toContain(FROM);
    expect(s.opened.attic).toEqual(["vale"]);
    expect(s.actors.vale.xp).toBe(before + 3);
  });

  it("clears buried quests the world already satisfies", () => {
    let s = pip();
    holdQuest(s, "vale", newWant("item", "lamp", s.turn), "quest:box:test");
    holdQuest(s, "vale", newWant("place", "pond", s.turn), "quest:box:other");
    s.items.lamp.holder = "vale";
    s = wait(s);
    expect(sources(s)).toEqual([FROM]);
    expect(s.actors.vale.closed["quest:box:test"]).toBeTruthy();
    expect(s.actors.vale.closed["quest:box:other"]).toBeTruthy();
  });
});
