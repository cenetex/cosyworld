import { describe, expect, it } from "vitest";
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import {
  decodeSave,
  encodeSave,
  legalActions,
  LONG_SLEEP_TURNS,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  MAX_CLOSED,
  closedKey,
  dropQuest,
  dropCost,
  heldOf,
  holdQuest,
  newWant,
  questXp,
  settleWants,
  validWant,
} from "../v2/card-game/want.mjs";

// Rules 134 package A, review fixes: the level quest after a discard, the
// bound on `closed`, the same terms from two sources, a stack under an avatar
// that stops being a player's, and companions in a shared world. Small worlds
// from `createPipWorld`.
const act = (s, pick, actor) => {
  const action = legalActions(s, actor).find(pick);
  expect(action, "a legal play").toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const wait = (s, actor) =>
  act(s, (a) => a.kind === "wait" && !a.sleep && !a.guards, actor);
const talk = (s) => act(s, (a) => a.kind === "talk" && a.target === "moth");
const sources = (s, who = "vale") => heldOf(s.actors[who]).map((w) => w.from);
const lamp = { kind: "item", target: "lamp", step: { verb: "give", to: "moth" } };

describe("the level quest after a discard", () => {
  const sleepAtHome = (s) => {
    s.actors.vale.place = "attic";
    s = wait(s);
    for (let i = 0; i < LONG_SLEEP_TURNS + 2 && s.actors.vale.level === 1; i++)
      s = play(s, legalActions(s).find((a) => a.sleep), s.revision).state;
    return s;
  };

  it("is never recorded closed, comes back with the experience, and levels up", () => {
    let s = createPipWorld(5);
    s.actors.vale.level = 1;
    s.actors.vale.xp = questXp(2);
    s = wait(s);
    expect(sources(s)).toEqual(["quest:level"]);
    const cost = dropCost(s, "vale");
    expect(cost).toBe(1);
    s = act(s, (a) => a.kind === "drop" && !a.item);
    expect(s.actors.vale.xp).toBe(questXp(2) - 1);
    expect(heldOf(s.actors.vale)).toEqual([]);
    // Nothing remembers it: the cost was the XP.
    expect(s.actors.vale.closed?.["quest:level"]).toBeUndefined();
    s = wait(s);
    expect(heldOf(s.actors.vale)).toEqual([]);
    // Regain the experience: the quest stands again, and a long rest at home
    // raises the level.
    s.actors.vale.xp = questXp(2);
    s = wait(s);
    expect(sources(s)).toEqual(["quest:level"]);
    expect(s.actors.vale.want.quest).toEqual({ level: 2, left: 1 });
    s = sleepAtHome(s);
    expect(s.actors.vale.level).toBe(2);
    expect(heldOf(s.actors.vale)).toEqual([]);
    // The next level's quest stands when its experience is reached.
    s.actors.vale.xp = questXp(3);
    s = wait(s);
    expect(s.actors.vale.want.quest).toEqual({ level: 3, left: 1 });
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });
});

describe("the closed record is bounded", () => {
  it("takes far more closes than its bound, stays valid, and keeps the newest", () => {
    const s = createPipWorld(5);
    const total = MAX_CLOSED * 3;
    for (let i = 0; i < total; i++) {
      s.turn += 1;
      s.revision += 1;
      holdQuest(s, "vale", newWant("place", "pond", s.turn), `quest:from:src${i}`);
      dropQuest(s, "vale");
      expect(() => validateWorld(s)).not.toThrow();
    }
    const kept = Object.keys(s.actors.vale.closed).sort();
    expect(kept).toHaveLength(MAX_CLOSED);
    for (let i = total - MAX_CLOSED; i < total; i++)
      expect(s.actors.vale.closed[`quest:from:src${i}`][0]).toBe(i + 1);
    expect(s.actors.vale.closed["quest:from:src0"]).toBeUndefined();
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("evicts by turn then by name, not by key order", () => {
    const s = createPipWorld(5);
    s.turn = 10;
    s.revision = 10;
    s.actors.vale.closed = {};
    for (let i = 0; i < MAX_CLOSED; i++)
      s.actors.vale.closed[`quest:from:n${String(MAX_CLOSED - i).padStart(3, "0")}`] = [5, "x"];
    holdQuest(s, "vale", newWant("place", "pond", 10), "quest:from:new");
    dropQuest(s, "vale");
    // All were closed at turn 5: the least name, n001, goes.
    expect(s.actors.vale.closed["quest:from:n001"]).toBeUndefined();
    expect(s.actors.vale.closed["quest:from:n002"]).toBeTruthy();
    expect(s.actors.vale.closed["quest:from:new"]).toEqual([10, closedKey(newWant("place", "pond", 10))]);
  });
});

describe("the same terms from two sources", () => {
  it("is not held when another source already closed those terms", () => {
    const s = createPipWorld(5);
    s.actors.vale.closed = { "quest:box:elsewhere": [0, closedKey(lamp)] };
    const next = talk(s);
    expect(sources(next)).toEqual([]);
  });

  it("is not held when another source's quest with those terms is held", () => {
    const s = createPipWorld(5);
    holdQuest(s, "vale", { ...lamp, since: 0, refusals: 0 }, "quest:box:elsewhere");
    const next = talk(s);
    expect(sources(next)).toEqual(["quest:box:elsewhere"]);
  });
});

describe("a stack under an avatar that stops being a player's", () => {
  it("promotes the next quest when a non-player's top quest is met", () => {
    const s = createPipWorld(5);
    s.turn = s.revision = 5;
    holdQuest(s, "vale", newWant("place", "pond", s.turn), "quest:from:a");
    holdQuest(s, "vale", newWant("place", "station", s.turn), "quest:from:b");
    expect(heldOf(s.actors.vale)).toHaveLength(2);
    // Vale stands at the pond; the station quest on top is met as a resident
    // would meet it (not a player).
    s.actors.vale.place = "station";
    const api = { player: () => false, log() {}, sanctuaries: [], home: () => null };
    settleWants(s, ["vale"], api, null);
    expect(s.actors.vale.want.from).toBe("quest:from:a");
    expect(s.actors.vale.under).toBeUndefined();
    expect(s.actors.vale.content).toBeUndefined();
    expect(validWant(s, "vale")).toBe(true);
  });
});
