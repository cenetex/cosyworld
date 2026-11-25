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
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";

const FOOL = "arcanum-0";
const WORLD = "arcanum-21";
const reload = (s) => decodeSave(encodeSave(s));
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
const reveal = () => {
  const s = holding();
  const action = legalActions(s, "vale").find(
    (a) => a.kind === "talk" && a.target === "listener",
  );
  expect(action).toBeTruthy();
  const result = play(s, action, s.revision, "vale");
  expect(result.ok, result.error).toBe(true);
  return result.state;
};

describe("the revealed tarot pack", () => {
  it("keeps a card when the Listener reveals it before its proof is complete", () => {
    const s = reveal();
    expect(s.actors.vale.upgrades).toContain(FOOL);
    expect(recordOf(s, "vale")).toMatchObject({
      proved: [],
      done: [],
      level: null,
      spread: [{ card: FOOL, face: "up" }],
    });
    expect(arcanaLevel(s, "vale")).toBe(0);
    const back = reload(reload(s));
    expect(back.actors.vale.upgrades).toEqual([FOOL]);
    expect(recordOf(back, "vale").proved).toEqual([]);
    expect(validateWorld(back)).toBeTruthy();
  });

  it("recovers revealed cards from an older save without awarding proof", () => {
    const back = reload(holding("up"));
    expect(back.actors.vale.upgrades).toEqual([FOOL]);
    expect(recordOf(back, "vale").proved).toEqual([]);
    expect(arcanaLevel(back, "vale")).toBe(0);
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
    rememberLocalUpgrades(reveal(), storage);
    const fresh = wearLocalUpgrades(createPipWorld(6), storage);
    expect(fresh.actors.vale.upgrades).toContain(FOOL);
    expect(recordOf(fresh, "vale").proved).toEqual([]);
    expect(arcanaLevel(fresh, "vale")).toBe(0);
  });

  it("draws a revealed Fool again with at most one unfamiliar card", () => {
    const s = reveal();
    s.actors.vale.arcana.level = 1;
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
