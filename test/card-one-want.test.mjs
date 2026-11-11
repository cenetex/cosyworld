// Rules 133, package 1 (#2605): one want per avatar. A player takes its want
// by a tap and is never drawn one; a resident keeps drawing its own.
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
  CONTENT_TURNS,
  dropCost,
  dropQuest,
  fillWants,
  newWant,
  nextWant,
  refuseWant,
  setWant,
  takeQuest,
  wantOf,
} from "../v2/card-game/want.mjs";

const pond = (seed) => newWant("place", "pond", seed);

describe("one want per avatar", () => {
  it("gives a player no authored or drawn want", () => {
    const s = createWorld();
    expect(wantOf(s, "vale")).toBeNull();
    expect(s.actors.vale.under).toBeUndefined();
    fillWants(s, wantAPI(s), true);
    expect(wantOf(s, "vale")).toBeNull();
    expect(nextWant(s, "moth", wantAPI(s))).not.toBeNull();
  });

  it("takes a quest only when none is held, and replaces nothing", () => {
    const s = createWorld();
    expect(takeQuest(s, "vale", pond(0))).toMatchObject({ target: "pond" });
    expect(takeQuest(s, "vale", newWant("place", "attic", 0))).toBeNull();
    expect(wantOf(s, "vale").target).toBe("pond");
    expect(validateWorld(decodeSave(encodeSave(s)))).toBeTruthy();
  });

  it("sets a quest down for nothing and draws no other in its place", () => {
    const s = createWorld();
    setWant(s.actors.vale, pond(0));
    s.actors.vale.xp = 4;
    expect(dropCost(s, "vale")).toBe(0);
    const drop = legalActions(s).find((a) => a.kind === "drop" && !a.item);
    expect(drop).toMatchObject({ quest: 0 });
    const next = play(s, drop).state;
    expect(next.actors.vale.want).toBeNull();
    expect(next.actors.vale.xp).toBe(4);
    expect(next.actors.vale.gaveUp).toMatchObject({ target: "pond" });
    expect(legalActions(next).some((a) => a.kind === "drop" && !a.item)).toBe(
      false,
    );
  });

  it("charges a level quest to drop, never below the level held", () => {
    const s = createWorld();
    Object.assign(s.actors.vale, { xp: 1, level: 1 });
    setWant(s.actors.vale, {
      ...pond(0),
      step: { verb: "rest" },
      quest: { level: 2, left: 1 },
    });
    expect(dropCost(s, "vale")).toBe(1);
    dropQuest(s, "vale");
    expect(s.actors.vale).toMatchObject({ xp: 0, want: null });
  });

  it("never lets a resident hold a stack: a set-aside want is replaced", () => {
    const s = createWorld();
    const api = wantAPI(s);
    s.actors.keeper.want = newWant("item", "oil", 0);
    s.items.oil.holder = "moth";
    for (let i = 0; i < 3; i++) refuseWant(s, "keeper", "oil", api);
    expect(s.actors.keeper.under).toBeUndefined();
    expect(s.actors.keeper.gaveUp).toMatchObject({ target: "oil" });
    expect(s.actors.keeper.want?.target).not.toBe("oil");
  });

  it("draws a resident's next want after a day, and a player's never", () => {
    const s = createWorld();
    Object.assign(s.actors.keeper, { want: null, content: true, metTurn: 0 });
    Object.assign(s.actors.vale, { want: null, metTurn: 0 });
    s.turn = CONTENT_TURNS;
    fillWants(s, wantAPI(s));
    expect(s.actors.keeper.want).not.toBeNull();
    expect(s.actors.vale.want).toBeNull();
  });

  it("holds no stack or receipts through a long run", () => {
    let s = createWorld();
    for (let turn = 0; turn < 300; turn++) {
      const actions = legalActions(s);
      s = play(s, actions[(turn * 7919) % actions.length]).state;
      if (turn % 50 === 0) setWant(s.actors.vale, s.actors.vale.want ?? pond(s.turn));
    }
    for (const a of Object.values(s.actors)) {
      expect(a.under).toBeUndefined();
      expect(a.questRewards).toBeUndefined();
    }
    expect(legalActions(s).some((a) => ["claim", "focus"].includes(a.kind))).toBe(
      false,
    );
    expect(validateWorld(s)).toBe(s);
  });

  it("refuses a saved stack or receipt", () => {
    const s = createWorld();
    for (const edit of [
      (a) => (a.under = [pond(0)]),
      (a) => (a.questRewards = []),
    ]) {
      const bad = JSON.parse(encodeSave(s));
      edit(bad.actors.vale);
      expect(() => decodeSave(JSON.stringify(bad))).toThrow();
    }
  });
});
