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

// Rules 134, package A: an offer that stands is held in the play that made it
// stand, quests stack with the newest on top, and a closed quest stays closed
// until its source offers different terms. Small worlds built from
// `createPipWorld`: Vale at the pond with Pip, who always offers his lamp.
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
    // It is held, so it no longer stands as an offer, and no play takes it.
    expect(questOffers(s)).toEqual([]);
    expect(legalActions(s).some((a) => a.kind === "take" && a.offer)).toBe(false);
    expect(s.log.some((e) => e.verb === "quest" && /takes up a quest/u.test(e.text))).toBe(true);
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
  // Pip's quest is held; then experience reaches the next level.
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
    // Newest on top: the level quest is the active want; Pip's lies beneath.
    expect(sources(s)).toEqual(["quest:level", FROM]);
    expect(s.actors.vale.want).toMatchObject({ quest: { level: 2, left: 1 } });
    expect(s.actors.vale.under).toHaveLength(1);
    expect(s.actors.vale.under[0].target).toBe("lamp");
    expect(questCards(s).map((q) => q.level)).toEqual([2, null]);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("stacks two offers made by one play, the level quest last and on top", () => {
    // Talk makes Pip's offer stand, and the experience already stands the level.
    const start = createPipWorld(5);
    start.actors.vale.level = 1;
    start.actors.vale.xp = questXp(2);
    const s = talk(start);
    expect(sources(s)).toEqual(["quest:level", FROM]);
    expect(s.actors.vale.want.quest).toEqual({ level: 2, left: 1 });
  });

  it("shows the next quest when the top one is discarded", () => {
    let s = levelled();
    // Sleep at home costs the experience it did before.
    expect(dropCost(s, "vale")).toBeGreaterThan(0);
    s = discard(s);
    expect(sources(s)).toEqual([FROM]);
    expect(s.actors.vale.want.target).toBe("lamp");
    expect(s.actors.vale.under).toBeUndefined();
    // Pip's quest on top is free to discard, and nothing is left beneath it.
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
    // The box is not real, so only the stack's own rules are checked here.
    expect(s.actors.vale.want.target).toBe("pond");
    expect(heldOf(s.actors.vale).some((w) => w.quest?.level === 2)).toBe(true);
    for (let i = 0; i < LONG_SLEEP_TURNS + 2 && s.actors.vale.level !== 2; i++) {
      const sleep = legalActions(s).find((a) => a.sleep);
      if (!sleep) break;
      s = play(s, sleep, s.revision).state;
    }
    expect(s.actors.vale.level).toBe(2);
    // The level quest left the stack; the quest above it is still held.
    expect(sources(s)).toContain("quest:box:test");
    expect(heldOf(s.actors.vale).some((w) => w.quest)).toBe(false);
  });
});

describe("a closed quest stays closed", () => {
  // Residents roam; the story here is Pip standing where he was told.
  const staying = (s) => {
    s.actors.moth.place = "pond";
    s.actors.vale.place = "pond";
    return s;
  };

  it("does not return the turn it was discarded, or later, while its terms hold", () => {
    let s = talk(createPipWorld(5));
    s = discard(s);
    expect(heldOf(s.actors.vale)).toEqual([]);
    expect(s.actors.vale.closed[FROM]).toContain("lamp");
    expect(questOffers(staying(s))).toEqual([]);
    for (let i = 0; i < 8; i++) {
      s = wait(staying(s));
      expect(sources(s)).not.toContain(FROM);
    }
    // Nor does the Talk that told it, again.
    s = talk(staying(s));
    expect(sources(s)).not.toContain(FROM);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("returns when the source offers different terms", () => {
    let s = discard(talk(createPipWorld(5)));
    s = wait(staying(s));
    expect(sources(s)).toEqual([]);
    // Pip now wants something else, and he trusts the traveler: a new offer.
    staying(s).actors.moth.want = newWant("item", "bell", s.turn);
    s.actors.moth.trust.vale = 1;
    s = talk(s);
    expect(sources(s)).toEqual([FROM]);
    expect(s.actors.vale.want).toMatchObject({ target: "bell", step: { verb: "give", to: "moth" } });
  });

  it("closes a quest that was met, so it is not held again and paid twice", () => {
    let s = talk(createPipWorld(5));
    s.actors.vale.want.refusals = 0;
    // Vale carries the lamp to Pip and gives it: the quest is met.
    s.items.lamp.holder = "vale";
    const give = legalActions(s).find((a) => a.kind === "give" && a.target === "moth");
    expect(give).toBeTruthy();
    const xp = s.actors.vale.xp;
    s = play(s, give, s.revision).state;
    expect(s.actors.vale.xp).toBeGreaterThan(xp);
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
