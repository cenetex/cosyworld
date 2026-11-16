import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  nameOf,
  people,
  things,
  wantAPI,
} from "../v2/card-game/world.mjs";
import { ownName, theName } from "../v2/card-game/world/catalog.mjs";
import { reflectionsFrom } from "../v2/card-game/world/senses.mjs";

describe("item names in rule sentences", () => {
  it("never doubles an article or puts one before an owner's name", () => {
    for (const id of Object.keys(things)) {
      const words = theName(id);
      expect(words).not.toMatch(/^the (?:the|an?) /iu);
      expect(words).not.toMatch(/^the \p{L}+['’]s? /u);
      expect(words.endsWith(nameOf(id))).toBe(true);
    }
    expect(theName("lamp")).toBe("the Lamp");
  });

  it("names the owner once", () => {
    for (const owner of Object.keys(people))
      for (const id of Object.keys(things)) {
        const named = /^['’]/u.test(nameOf(id).slice(nameOf(owner).length));
        expect(ownName(owner, id)).toBe(
          nameOf(id).startsWith(nameOf(owner)) && named
            ? nameOf(id)
            : `${nameOf(owner)}’s ${nameOf(id)}`,
        );
      }
  });

  it("says who holds a given item when a give quest is met", () => {
    const s = createWorld();
    const said = (want) => {
      wantAPI(s).log("vale", want);
      return s.log.at(-1).text;
    };
    expect(said({ kind: "item", target: "lamp" })).toBe(
      "Vale has the Lamp at last.",
    );
    expect(
      said({ kind: "item", target: "lamp", step: { verb: "give", to: "moth" } }),
    ).toBe(`${nameOf("moth")} has the Lamp at last.`);
  });

  it("says the reflection only on a way through a reflection", () => {
    const s = createWorld({ opening: true });
    let reflected = 0;
    for (const place of Object.keys(s.locations)) {
      s.actors.vale.place = place;
      for (const a of legalActions(s).filter((a) => a.kind === "move")) {
        const mirror = reflectionsFrom(s, place).includes(a.target);
        if (mirror) reflected += 1;
        else expect(a.text).not.toContain("through the reflection");
      }
    }
    expect(reflected).toBeGreaterThan(0);
  });
});
