import { describe, expect, it } from "vitest";
import {
  cardLevel,
  levelTier,
  rarityColor,
  romanLevel,
} from "../v2/card-game/rarity.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { packDefinitions, hub } from "../v2/card-game/pack-registry.mjs";

describe("card level presentation", () => {
  it.each([
    [0, 9, "common", "#c8dce6"],
    [10, 19, "uncommon", "#8cdcff"],
    [20, 29, "rare", "#be82ff"],
    [30, 49, "epic", "#ffc85a"],
    [50, 144, "legendary", "#fff082"],
  ])(
    "keeps levels %i through %i in one Signal colour",
    (from, to, id, color) => {
      for (const level of [from, to]) {
        expect(levelTier(level)).toMatchObject({ id, color, minLevel: from });
        expect(rarityColor(level)).toBe(color);
      }
    },
  );

  it("reads earned levels without giving an owner's level to their things or place", () => {
    const world = {
      actors: { vale: { xp: 45 } },
      items: { oil: { holder: "vale" } },
    };
    expect(cardLevel(world, "vale")).toBe(10);
    expect(cardLevel(world, "oil")).toBe(10);
    expect(cardLevel(world, "attic")).toBe(1);
    world.actors.vale.xp = 5050;
    expect(cardLevel(world, "vale")).toBe(101);
    expect(levelTier(cardLevel(world, "vale")).id).toBe("legendary");
    expect(world.actors.vale.xp).toBe(5050);
  });

  it("gives items their authored start level and tier, whatever holds them", () => {
    const world = { actors: { vale: { xp: 0 } }, items: {} };
    expect(cardLevel(world, "lamp")).toBe(50);
    expect(levelTier(cardLevel(world, "greek-decree")).id).toBe("legendary");
    expect(levelTier(cardLevel(world, "greek-olive-branch")).id).toBe("epic");
    expect(levelTier(cardLevel(world, "willows-pot")).id).toBe("rare");
    expect(levelTier(cardLevel(world, "hoppycat-context-seed")).id).toBe(
      "uncommon",
    );
    expect(cardLevel(world, "greek-water-jar")).toBe(1);
    const pack = structuredClone(
      packDefinitions.find((p) => p.id === "willows"),
    );
    expect(packProblems(pack, hub).join(" ")).not.toContain("item ");
    pack.items["willows-pot"].startLevel = 0;
    expect(packProblems(pack, hub).join(" ")).toContain(
      "willows-pot startLevel",
    );
  });

  it("keeps actual levels in Roman numerals, including subtractive notation", () => {
    expect(
      [0, 1, 4, 9, 10, 19, 20, 29, 30, 49, 50, 144, 2026].map(romanLevel),
    ).toEqual("N I IV IX X XIX XX XXIX XXX XLIX L CXLIV MMXXVI".split(" "));
  });
});
