import { describe, expect, it } from "vitest";
import {
  cardLevel,
  levelTier,
  rarityColor,
  romanLevel,
} from "../v2/card-game/rarity.mjs";

describe("card level presentation", () => {
  it.each([
    [0, 9, "common", "#c8dce6"],
    [10, 19, "uncommon", "#8cdcff"],
    [20, 29, "rare", "#be82ff"],
    [30, 49, "epic", "#ffc85a"],
    [50, 99, "legendary", "#fff082"],
    [100, 144, "mythic", "#ff9ce6"],
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
      items: { lamp: { holder: "vale" } },
    };
    expect(cardLevel(world, "vale")).toBe(10);
    expect(cardLevel(world, "lamp")).toBe(1);
    expect(cardLevel(world, "attic")).toBe(1);
    world.actors.vale.xp = 5050;
    expect(cardLevel(world, "vale")).toBe(101);
    expect(levelTier(cardLevel(world, "vale")).id).toBe("mythic");
    expect(world.actors.vale.xp).toBe(5050);
  });

  it("keeps actual levels in Roman numerals, including subtractive notation", () => {
    expect(
      [0, 1, 4, 9, 10, 19, 20, 29, 30, 49, 50, 144, 2026].map(romanLevel),
    ).toEqual("N I IV IX X XIX XX XXIX XXX XLIX L CXLIV MMXXVI".split(" "));
  });
});
