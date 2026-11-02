import { describe, it, expect } from "vitest";
import {
  createWorld,
  encodeSave,
  legalActions,
  outranks,
  play,
  strikeDamage,
  strikePower,
} from "../v2/card-game/world.mjs";
import { levelTier } from "../v2/card-game/level-tiers.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";

const at = (vale, moth, seed = 7, revision = 0) => {
  const s = createWorld({ seed });
  s.actors.vale.level = vale;
  s.actors.moth.level = moth;
  s.revision = revision;
  return s;
};
// Every roll Vale makes on Pip over many seeds and plays.
const rolls = (vale, moth) => {
  const s = at(vale, moth);
  const seen = new Map();
  for (let seed = 1; seed <= 200; seed++)
    for (let revision = 0; revision < 10; revision++) {
      Object.assign(s, { run: { seed }, revision });
      const damage = strikeDamage(s, "vale", "moth");
      seen.set(damage, (seen.get(damage) || 0) + 1);
    }
  return seen;
};

describe("strike strength by level tier", () => {
  it("is equal within a tier and one step across a boundary", () => {
    expect(levelTier(1)).toBe(levelTier(2));
    // [Vale's level, Pip's level, most Vale's strike can land, Vale outranks]
    for (const [vale, moth, most, ranks] of [
      [1, 2, 2, false], // I and II are equally matched
      [2, 1, 2, false],
      [1, 9, 2, false],
      [10, 19, 2, false],
      [19, 10, 2, false],
      [30, 49, 2, false],
      [10, 9, 3, true], // across a boundary, in either direction
      [9, 10, 1, false],
      [20, 19, 3, true],
      [19, 20, 1, false],
      [100, 1, 3, true], // several tiers apart is still one step
      [1, 100, 1, false],
    ]) {
      expect(strikePower(at(vale, moth), "vale", "moth")).toBe(most);
      expect(outranks(at(vale, moth), "vale", "moth")).toBe(ranks);
    }
  });
  it("rolls 1-2 in a tier, 1-3 a tier up and exactly 1 a tier down", () => {
    const same = rolls(1, 2);
    const up = rolls(10, 9);
    expect([...same.keys()].sort()).toEqual([1, 2]);
    expect([...up.keys()].sort()).toEqual([1, 2, 3]);
    // Each outcome turns up often enough to be a real chance.
    for (const count of [...same.values(), ...up.values()])
      expect(count).toBeGreaterThan(400);
    expect([...rolls(9, 10).keys()]).toEqual([1]);
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
      const strike = (s, kind) =>
        play(
          s,
          legalActions(s).find((a) => a.kind === kind),
        ).state;
      s = strike(s, "threaten");
      // Pip does not outrank Vale, so it braces rather than talking.
      expect(s.standoffs[0].guarding.moth).toBe(true);
      const before = s;
      s = strike(s, "attack");
      const [hit, back] = s.log.filter((e) => e.seq > before.eventSeq);
      // Braced, a roll of 1 or 2 lands 1.
      expect(hit).toMatchObject({ verb: "attack", damage: 1, guarded: true });
      expect(back).toMatchObject({ verb: "attack", actorId: "moth" });
      expect([1, 2]).toContain(back.damage);
      expect(back.text).toContain(`loses ${back.damage} resolve`);
      expect(back.resolveBefore - back.resolveAfter).toBe(back.damage);
      // The same seed and play roll the same.
      expect(strike(before, "attack").log).toEqual(s.log);
    }
  });
  it("rolls the same strikes in the browser and the compiled server rules", () => {
    const runtime = currentSharedEngine();
    const ask = (request) =>
      JSON.parse(runtime.cardShared(JSON.stringify(request)));
    const claimed = ["vale"];
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
      const save = encodeSave(createWorld());
      let world = dispatchShared({ op: "create", save, seed }).world;
      world.actors.moth.place = world.actors.vale.place;
      world.items.lamp.holder = "moth";
      world.actors.moth.want = null;
      world.actors.moth.metTurn = 0;
      for (const action of [
        "threaten:vale:lamp:moth",
        ...Array(3).fill("attack:vale::moth"),
      ]) {
        if (action.startsWith("attack") && !world.standoffs.length) break;
        const request = { op: "play", world, actor: "vale", claimed, action };
        request.present = claimed;
        const browser = dispatchShared(request);
        expect(browser.ok).toBe(true);
        expect(ask(request)).toEqual(browser);
        for (const e of browser.events)
          if (e.verb === "attack") seen.add(e.damage);
        world = browser.world;
      }
    }
    expect([...seen].sort()).toEqual([1, 2]);
  });
});
