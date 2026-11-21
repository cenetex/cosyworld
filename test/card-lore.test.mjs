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
    expect(world.items["greek-guide"].holder).toBe("greek-shipmaster");
    const harbor = greek.items["greek-guide"].lore.findIndex(
      (page) => page.about === "greek-harbor",
    );
    expect(lorePages(world, "greek-shipmaster", ["greek-harbor"])).toEqual([
      `greek-guide#${harbor}`,
    ]);
    expect(lorePages(world, "greek-shipmaster", [])).toEqual([]);
    expect(lorePages(world, "greek-antigone", ["greek-harbor"])).toEqual([]);
  });

  it("open song and chronicle pages once their choices are made, and move with the book", () => {
    const world = funeralJourney().buried;
    const opened = (holder) =>
      lorePages(world, holder, []).map((ref) => {
        const [item, n] = ref.split("#");
        const choice = greek.items[item].lore[Number(n)].requires[0].choice;
        expect(world.packs["greek-drama"].receipts).toHaveProperty(choice);
        return text(ref);
      });
    expect(opened("greek-elder")).toContain(
      "She laid her brother in the earth. / A raven feather marked his rest.",
    );
    world.items["greek-songbook"].holder = "greek-antigone";
    expect(opened("greek-antigone")).toContain(
      "She laid her brother in the earth. / A raven feather marked his rest.",
    );
    expect(opened("greek-elder")).toContain(
      "Antigone covers her brother with earth and leaves the raven feather on the mound.",
    );
  });

  it("keep at most three pages, the scene's first", () => {
    const world = funeralJourney().buried;
    const scene = Object.keys(greek.avatars);
    const pages = lorePages(world, "greek-elder", scene);
    expect(pages).toHaveLength(3);
    expect(pages.every((ref) => ref.startsWith("greek-city-roll#"))).toBe(true);
  });

  it("reach the narrator as page ids, never as text", () => {
    const world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-harbor";
    const context = narrativeContext(world);
    const myrto = context.entities.find((e) => e.id === "greek-shipmaster");
    expect(myrto?.lore?.[0]).toMatch(/^greek-guide#/);
    expect(JSON.stringify(context)).not.toContain(text(myrto.lore[0]));
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
