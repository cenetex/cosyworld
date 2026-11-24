import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { hub, packDefinition } from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";

const greek = packDefinition("greek-drama");

describe("lore items", () => {
  it("never reach the narrator", () => {
    const world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    world.actors.vale.place = "greek-harbor";
    const context = narrativeContext(world);
    const myrto = context.entities.find((e) => e.id === "greek-shipmaster");
    expect(world.items["greek-guide"].holder).toBe("greek-shipmaster");
    expect(myrto).not.toHaveProperty("lore");
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
