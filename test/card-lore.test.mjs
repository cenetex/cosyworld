import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  hub,
  lorePages,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";

const greek = packDefinition("greek-drama");
const text = (ref) => {
  const [item, n] = ref.split("#");
  return greek.items[item].lore[Number(n)].text;
};

describe("lore items", () => {
  it("give their holder the pages about the scene", () => {
    const world = createWorld();
    expect(world.items["greek-guide"].holder).toBe("greek-rhapsode");
    expect(lorePages(world, "greek-rhapsode", ["greek-harbor"])).toEqual([
      `greek-guide#${greek.items["greek-guide"].lore.findIndex((p) => p.about === "greek-harbor")}`,
    ]);
    expect(lorePages(world, "greek-rhapsode", [])).toEqual([]);
    expect(lorePages(world, "greek-antigone", ["greek-harbor"])).toEqual([]);
  });

  it("open chronicle and song pages only once their choices are made", () => {
    const world = funeralJourney().buried;
    const elder = lorePages(world, "greek-elder", []);
    expect(elder).toHaveLength(3);
    for (const ref of elder) {
      const [item, n] = ref.split("#");
      const choice = greek.items[item].lore[Number(n)].requires[0].choice;
      expect(world.packs["greek-drama"].receipts).toHaveProperty(choice);
    }
    expect(elder.map(text)).toContain(
      "Antigone covers her brother with earth and leaves the raven feather on the mound.",
    );
    expect(lorePages(world, "greek-rhapsode", []).map(text)).toContain(
      "She laid her brother in the earth. / A raven feather marked his rest.",
    );
  });

  it("keep at most three pages and move with the item", () => {
    const world = funeralJourney().buried;
    const scene = Object.keys(greek.avatars);
    expect(lorePages(world, "greek-elder", scene)).toHaveLength(3);
    expect(
      lorePages(world, "greek-elder", scene).every((ref) =>
        ref.startsWith("greek-city-roll#"),
      ),
    ).toBe(true);
    world.items["greek-songbook"].holder = "greek-antigone";
    expect(lorePages(world, "greek-antigone", [])[0]).toMatch(
      /^greek-songbook#/,
    );
    expect(
      lorePages(world, "greek-rhapsode", []).some((ref) =>
        ref.startsWith("greek-songbook#"),
      ),
    ).toBe(false);
  });

  it("reach the narrator as page ids, never as text", () => {
    const world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-harbor";
    const context = narrativeContext(world);
    const bard = context.entities.find((e) => e.id === "greek-rhapsode");
    expect(bard?.lore?.[0]).toMatch(/^greek-guide#/);
    expect(JSON.stringify(context)).not.toContain(text(bard.lore[0]));
  });

  it("are checked by the pack schema", () => {
    const pack = structuredClone(greek);
    pack.items["greek-guide"].lore[0].about = "greek-nowhere";
    pack.items["greek-songbook"].lore[0].requires = [
      { kind: "receipt", choice: "greek-unmade" },
    ];
    pack.items["greek-cargo-list"].lore[0].text = "x".repeat(1201);
    const problems = packProblems(pack, hub).join("\n");
    expect(problems).toContain("item greek-guide lore[0]");
    expect(problems).toContain("a receipt condition names no choice");
    expect(problems).toContain("item greek-cargo-list lore[0]");
  });
});
