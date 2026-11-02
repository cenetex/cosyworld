import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  outranks,
  play,
  strikeDamage,
  strikePower,
} from "../v2/card-game/world.mjs";
import { levelTier } from "../v2/card-game/level-tiers.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { encodeSave } from "../v2/card-game/world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const at = (vale, moth, seed = 7) => {
  const s = createWorld({ seed });
  s.actors.vale.level = vale;
  s.actors.moth.level = moth;
  return s;
};
const most = (vale, moth) => strikePower(at(vale, moth), "vale", "moth");
// Every roll Vale could make on Pip over many seeds and plays.
const rolls = (vale, moth) => {
  const seen = new Map();
  for (let seed = 1; seed <= 200; seed++) {
    const s = at(vale, moth, seed);
    for (let revision = 0; revision < 10; revision++) {
      s.revision = revision;
      const damage = strikeDamage(s, "vale", "moth");
      seen.set(damage, (seen.get(damage) || 0) + 1);
    }
  }
  return seen;
};
const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action, `${kind} ${target || ""}`).toBeTruthy();
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
};

describe("strike strength by level tier", () => {
  it("matches levels I and II equally", () => {
    expect(levelTier(1)).toBe(levelTier(2));
    expect(most(1, 2)).toBe(2);
    expect(most(2, 1)).toBe(2);
    expect(outranks(at(2, 1), "vale", "moth")).toBe(false);
  });
  it("keeps a tier equal across its whole band", () => {
    expect(most(1, 9)).toBe(2);
    expect(most(9, 1)).toBe(2);
    expect(most(10, 19)).toBe(2);
    expect(most(19, 10)).toBe(2);
    expect(most(30, 49)).toBe(2);
  });
  it("changes strength only across a tier boundary, in either direction", () => {
    expect(most(10, 9)).toBe(3);
    expect(most(9, 10)).toBe(1);
    expect(most(20, 19)).toBe(3);
    expect(most(19, 20)).toBe(1);
    // A gap of several tiers is still one step stronger, not more.
    expect(most(100, 1)).toBe(3);
    expect(most(1, 100)).toBe(1);
    expect(outranks(at(10, 9), "vale", "moth")).toBe(true);
    expect(outranks(at(9, 10), "vale", "moth")).toBe(false);
  });
  it("rolls 1-2 in a tier, 1-3 a tier up and exactly 1 a tier down", () => {
    const same = rolls(1, 2);
    expect([...same.keys()].sort()).toEqual([1, 2]);
    const up = rolls(10, 9);
    expect([...up.keys()].sort()).toEqual([1, 2, 3]);
    // Each outcome turns up often enough to be a real chance.
    for (const count of [...same.values(), ...up.values()])
      expect(count).toBeGreaterThan(400);
    expect([...rolls(9, 10).keys()]).toEqual([1]);
  });
  it("rolls the same for the same seed and play, and differs by seed", () => {
    const one = at(1, 2, 42);
    const two = at(1, 2, 42);
    for (let revision = 0; revision < 20; revision++) {
      one.revision = two.revision = revision;
      expect(strikeDamage(one, "vale", "moth")).toBe(
        strikeDamage(two, "vale", "moth"),
      );
    }
    const bySeed = (seed) =>
      Array.from({ length: 20 }, (_, revision) => {
        const s = at(1, 2, seed);
        s.revision = revision;
        return strikeDamage(s, "vale", "moth");
      }).join();
    expect(bySeed(1)).not.toBe(bySeed(2));
  });
  it("records the rolled damage, and a Brace never takes it below one", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = createWorld({ seed });
      s.actors.moth.place = "station";
      s.actors.moth.want = null;
      s.actors.moth.metTurn = 0;
      s.items.lamp.holder = "moth";
      s.turn = s.revision = 3;
      s.actors.vale.xp = 1; // level II against Pip's I: the same tier
      s = act(s, "threaten", "moth");
      // Pip does not outrank Vale, so it braces rather than talking.
      expect(s.standoffs[0].guarding.moth).toBe(true);
      const before = structuredClone(s);
      s = act(s, "attack", "moth");
      const hit = s.log.findLast(
        (e) => e.actorId === "vale" && e.verb === "attack",
      );
      // Braced, a roll of 1 or 2 lands 1.
      expect(hit).toMatchObject({ damage: 1, guarded: true, resolveAfter: 3 });
      const back = s.log.findLast(
        (e) => e.actorId === "moth" && e.verb === "attack",
      );
      expect([1, 2]).toContain(back.damage);
      expect(back.guarded).toBe(false);
      expect(back.text).toContain(`loses ${back.damage} resolve`);
      expect(back.resolveBefore - back.resolveAfter).toBe(back.damage);
      // Replaying the same play from the same state rolls the same.
      expect(act(before, "attack", "moth").log).toEqual(s.log);
    }
  });
  it("rolls the same strikes in the browser and the compiled server rules", () => {
    const runtime = currentSharedEngine();
    const ask = (request) =>
      JSON.parse(runtime.cardShared(JSON.stringify(request)));
    const claimed = ["vale"];
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      let world = dispatchShared({
        op: "create",
        save: encodeSave(createWorld()),
        seed,
      }).world;
      world.actors.moth.place = world.actors.vale.place;
      world.items.lamp.holder = "moth";
      world.actors.moth.want = null;
      world.actors.moth.metTurn = 0;
      for (const action of [
        "threaten:vale:lamp:moth",
        "attack:vale::moth",
        "attack:vale::moth",
        "attack:vale::moth",
      ]) {
        if (action.startsWith("attack") && !world.standoffs.length) break;
        const request = { op: "play", world, actor: "vale", claimed, action };
        request.present = claimed;
        const browser = dispatchShared(request);
        expect(browser.ok).toBe(true);
        expect(ask(request)).toEqual(browser);
        for (const e of browser.events.filter((e) => e.verb === "attack"))
          seen.add(e.damage);
        world = browser.world;
      }
    }
    expect([...seen].sort()).toEqual([1, 2]);
  });
});
