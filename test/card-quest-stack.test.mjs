// A stack of quests per avatar (#1831): new quests go on top, nothing wipes
// one already held, a player may drop any quest or bring one to the top, and
// any quest in the stack can be met.
import { describe, expect, it } from "vitest";
import { questing } from "./helpers/first-quest.mjs";
import {
  createWorld as baseCreateWorld,
  decodeSave,
  encodeSave,
  legalActions,
  nameOf,
  places,
  play,
  rootHolder,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  QUEST_LIMIT,
  knownActors,
  newWant,
  pushQuest,
  questsOf,
  wantCandidates,
} from "../v2/card-game/want.mjs";
import { wantFact } from "../v2/card-game/want-talk.mjs";

const createWorld = () => questing(baseCreateWorld());
const act = (s, pick, actor = "vale") => {
  const action = legalActions(s, actor).find(pick);
  expect(action).toBeTruthy();
  const result = play(s, action, s.revision, actor);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const reload = (s) => decodeSave(encodeSave(s));
const targets = (s, id = "vale") => questsOf(s, id).map((w) => w.target);
const level = (target) => ({
  ...newWant("person", target, 0),
  quest: { level: 2, left: 2 },
});
const story = (target) => ({ ...newWant("item", target, 0), story: true });

describe("the quest stack", () => {
  it("puts a new quest on top and keeps the rest beneath", () => {
    const s = createWorld();
    expect(targets(s)).toEqual(["lamp"]);
    pushQuest(s, "vale", newWant("place", "pond", 0));
    expect(targets(s)).toEqual(["pond", "lamp"]);
    // One already held comes to the top instead of being held twice.
    pushQuest(s, "vale", newWant("item", "lamp", 0));
    expect(targets(s)).toEqual(["lamp", "pond"]);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it(`holds ${QUEST_LIMIT}; the oldest ordinary quest leaves, never a level or story quest`, () => {
    const s = createWorld();
    s.actors.vale.want = level("keeper");
    s.actors.vale.under = [
      newWant("place", "pond", 0),
      newWant("item", "lamp", 0),
    ];
    pushQuest(s, "vale", story("bell"));
    expect(targets(s)).toEqual(["bell", "keeper", "pond"]);
    pushQuest(s, "vale", newWant("place", "station", 0));
    expect(targets(s)).toEqual(["station", "bell", "keeper"]);
    // With only level and story quests beneath, the oldest story quest goes.
    pushQuest(s, "vale", story("cloth"));
    expect(targets(s)).toEqual(["cloth", "bell", "keeper"]);
    pushQuest(s, "vale", newWant("place", "pond", 0));
    expect(targets(s)).toEqual(["pond", "cloth", "keeper"]);
    expect(questsOf(s, "vale").some((w) => w.quest)).toBe(true);
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("offers a Drop for every quest and a Pursue for each beneath the top", () => {
    const s = createWorld();
    s.actors.vale.under = [newWant("place", "pond", 0)];
    const drops = legalActions(s).filter((a) => a.kind === "drop" && !a.item);
    expect(drops.map((a) => a.quest)).toEqual([0, 1]);
    const focus = legalActions(s).filter((a) => a.kind === "focus");
    expect(focus.map((a) => a.quest)).toEqual([1]);
    // Residents are never offered them.
    expect(
      legalActions(s, "moth").some(
        (a) => a.kind === "focus" || (a.kind === "drop" && !a.item),
      ),
    ).toBe(false);
  });

  it("drops an ordinary quest for nothing and a level quest for half the experience", () => {
    let s = createWorld();
    s.actors.vale.xp = 6;
    s.actors.vale.level = 3;
    s.actors.vale.under = [newWant("place", "pond", 0), level("keeper")];
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === 1);
    expect(targets(s)).toEqual(["lamp", "keeper"]);
    expect(s.actors.vale.xp).toBe(6);
    expect(s.actors.vale.gaveUp).toEqual({ target: "pond", turn: s.turn });
    s = act(s, (a) => a.kind === "drop" && !a.item && a.quest === 1);
    expect(targets(s)).toEqual(["lamp"]);
    expect(s.actors.vale.xp).toBe(3);
    expect(s.actors.vale.level).toBe(3);
    // Dropping the last one draws another at once.
    s = act(s, (a) => a.kind === "drop" && !a.item);
    expect(questsOf(s, "vale")).toHaveLength(1);
    expect(s.actors.vale.want.target).not.toBe("lamp");
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("brings a chosen quest to the top", () => {
    let s = createWorld();
    s.actors.vale.under = [newWant("place", "pond", 0), story("bell")];
    s = act(s, (a) => a.kind === "focus" && a.quest === 2);
    expect(targets(s)).toEqual(["bell", "lamp", "pond"]);
    expect(s.log.findLast((e) => e.actorId === "vale")).toMatchObject({
      verb: "focus",
    });
    expect(validateWorld(reload(s))).toBeTruthy();
  });

  it("meets any quest in the stack, not only the top", () => {
    let s = createWorld();
    s.actors.vale.place = "station";
    s.items.lamp.holder = "attic";
    s.actors.vale.under = [newWant("place", "pond", 0)];
    const xp = s.actors.vale.xp;
    s = act(s, (a) => a.kind === "move" && a.target === "pond");
    expect(targets(s)).toEqual(["lamp"]);
    expect(s.actors.vale.xp).toBe(xp + 1);
    expect(
      s.log.some((e) => e.verb === "want_met" && e.wantMet?.target === "pond"),
    ).toBe(true);
  });

  it("moves a stalled resident quest to the bottom instead of losing it", () => {
    let s = createWorld();
    s.actors.moth.want = newWant("person", "greek-creon", 0);
    delete s.actors.moth.under;
    // It stalls at turn 48: a new quest comes above it, and it waits beneath.
    while (s.turn < 48) s = act(s, (a) => a.kind === "wait");
    const moth = questsOf(s, "moth");
    expect(moth).toHaveLength(2);
    expect(moth[1]).toMatchObject({
      target: "greek-creon",
      refusals: 0,
      since: 48,
    });
  });

  it("says only the top quest in Talk, with a count of the rest", () => {
    const s = createWorld();
    s.actors.moth.want = newWant("item", "lamp", 0);
    s.actors.moth.under = [newWant("place", "pond", 0)];
    s.items.lamp.holder = "station";
    expect(wantFact(s, "moth", nameOf)).toBe(
      "I want the Lamp. I have one other quest too.",
    );
  });

  it("rejects an overfull stack and a second level quest", () => {
    const s = createWorld();
    s.actors.vale.under = [
      newWant("place", "pond", 0),
      newWant("place", "station", 0),
      newWant("person", "moth", 0),
    ];
    expect(() => validateWorld(reload(s))).toThrow();
    const t = createWorld();
    t.actors.vale.want = level("keeper");
    t.actors.vale.under = [level("moth")];
    expect(() => validateWorld(reload(t))).toThrow();
  });

  it("draws a player's quest from the whole world, met or found or not", () => {
    const s = createWorld();
    const api = {
      carried: () => [],
      rootHolder: (id) => rootHolder(s, id),
      valueOf: () => 5,
      reachable: () => [],
      player: (id) => id === "vale",
      places: () => Object.keys(places),
    };
    const pool = wantCandidates(s, "vale", api, null, true);
    const known = knownActors(s);
    // Places with no open route, people never met, and things lying about.
    expect(pool).toContain("place:forest-cottage");
    expect(
      pool.some((c) => c.startsWith("person:") && !known.includes(c.slice(7))),
    ).toBe(true);
    expect(pool).toContain("item:greek-decree");
    // A resident's wide pool keeps to the people it knows and what they hold.
    expect(
      wantCandidates(s, "moth", { ...api, player: () => false }, null, true),
    ).not.toContain("place:forest-cottage");
  });
});
