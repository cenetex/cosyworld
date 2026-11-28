import { describe, expect, it } from "vitest";
import data from "../v2/card-game/arcana.json" with { type: "json" };
import { createPipWorld } from "../v2/card-game/pip-landing.mjs";
import {
  rememberLocalUpgrades,
  wearLocalUpgrades,
} from "../v2/card-game/scarves.mjs";
import {
  arcanaLevel,
  nextSpread,
  recordOf,
} from "../v2/card-game/world/arcana.mjs";
import { validateWorld } from "../v2/card-game/world.mjs";
import { act, reload } from "./helpers/play.mjs";

const FOOL = "arcanum-0";
const WORLD = "arcanum-21";
const holding = (face = "down") => {
  const s = createPipWorld(5);
  s.actors.vale.arcana = {
    proved: [],
    did: [],
    calls: 3,
    need: [FOOL],
    spread: [
      { card: FOOL, face, base: { visited: s.actors.vale.visited.length } },
    ],
  };
  return s;
};
const turnOver = (s) =>
  act(
    s,
    (a) => a.kind === "accept" && a.tarot === 0 && a.label === "Turn over",
  );
const reveal = () => turnOver(holding());
const collect = (s) =>
  act(
    s,
    (a) =>
      a.kind === "accept" && a.tarot !== undefined && a.label === "Collect",
  );

describe("the revealed tarot pack", () => {
  it("collects an unlocked reward without awarding its later quest proof", () => {
    const s = reveal();
    expect(s.actors.vale.upgrades || []).not.toContain(FOOL);
    expect(recordOf(s, "vale")).toMatchObject({
      proved: [],
      done: [],
      level: null,
      spread: [{ card: FOOL, face: "reward" }],
    });
    expect(arcanaLevel(s, "vale")).toBe(0);
    const back = reload(reload(collect(s)));
    expect(back.actors.vale.upgrades).toEqual([FOOL]);
    expect(recordOf(back, "vale").proved).toEqual([]);
    expect(validateWorld(back)).toBeTruthy();
  });

  it("recovers a revealed first Fool as an unclaimed reward", () => {
    const back = reload(holding("up"));
    expect(recordOf(back, "vale").spread[0].face).toBe("reward");
    expect(arcanaLevel(back, "vale")).toBe(0);
    const kept = collect(back);
    expect(kept.actors.vale.upgrades).toEqual([FOOL]);
    expect(recordOf(kept, "vale").proved).toEqual([]);
    expect(arcanaLevel(kept, "vale")).toBe(1);
  });

  it.each(["down", "locked"])(
    "does not collect a card whose %s back still shows",
    (face) => {
      const back = reload(holding(face));
      expect(back.actors.vale.upgrades || []).not.toContain(FOOL);
      expect(recordOf(back, "vale").proved).toEqual([]);
    },
  );

  it("carries the revealed pack into a new local world while leaving proof behind", () => {
    const saved = new Map();
    const storage = {
      getItem: (key) => saved.get(key),
      setItem: (key, value) => saved.set(key, value),
    };
    rememberLocalUpgrades(collect(reveal()), storage);
    const fresh = wearLocalUpgrades(createPipWorld(6), storage);
    expect(fresh.actors.vale.upgrades).toContain(FOOL);
    expect(recordOf(fresh, "vale").proved).toEqual([]);
    expect(arcanaLevel(fresh, "vale")).toBe(0);
    fresh.actors.vale.arcana = { proved: [], did: [], calls: 3 };
    const offered = act(
      fresh,
      (a) => a.kind === "talk" && a.target === "listener",
    );
    const dealt = act(offered, (a) => a.label === "Accept card");
    expect(recordOf(dealt, "vale").spread[0].face).toBe("down");
    const leveled = collect(turnOver(dealt));
    expect(arcanaLevel(leveled, "vale")).toBe(1);
    expect(leveled.actors.vale.upgrades).toEqual([FOOL]);
  });

  it("draws a revealed Fool again with at most one unfamiliar card", () => {
    const s = collect(reveal());
    expect(arcanaLevel(s, "vale")).toBe(1);
    const spread = nextSpread(s, "vale");
    expect(spread).toContainEqual(
      expect.objectContaining({ card: FOOL, face: "up" }),
    );
    expect(
      spread.filter((slot) => !s.actors.vale.upgrades.includes(slot.card)),
    ).toHaveLength(1);
    expect(nextSpread(reload(s), "vale")).toEqual(spread);
    expect(new Set(spread.map((slot) => slot.card)).size).toBe(spread.length);
  });

  it("reserves the World for level twenty after the rest of the pack", () => {
    const s = createPipWorld(5);
    s.actors.vale.upgrades = data.cards.map((c) => c.id).sort();
    s.actors.vale.arcana = { proved: [], did: [], level: 19 };
    expect(nextSpread(s, "vale").map((slot) => slot.card)).not.toContain(WORLD);
    s.actors.vale.arcana.level = 20;
    expect(nextSpread(s, "vale")).toEqual([{ card: WORLD, face: "locked" }]);
    s.actors.vale.arcana.level = 21;
    expect(nextSpread(s, "vale")).toEqual([]);
  });
});
