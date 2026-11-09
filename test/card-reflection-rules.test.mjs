import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { conditionMet } from "../v2/card-game/pack-rules.mjs";
import { reflectionsFrom } from "../v2/card-game/world/senses.mjs";

// Explicit new expectations for the #1550 lamp/reflection changes. These are
// intentional behaviour changes, so they assert the new rules rather than
// byte-for-byte parity with the old engine.

const lit = (world, at) =>
  conditionMet(world, { kind: "light", item: "lamp", at }, null);

describe("#1550 simplified lamp rule", () => {
  it("is lit only when the oil and lamp are co-located", () => {
    const world = createWorld();
    world.actors.vale.place = "pond";
    world.items.lamp.holder = "pond"; // grounded at the pond
    world.items.oil.holder = "attic"; // oil kept elsewhere
    expect(lit(world, ["pond"])).toBe(false);
    world.items.oil.holder = "pond"; // oil brought beside the lamp
    expect(lit(world, ["pond"])).toBe(true);
    world.items.oil.holder = "attic"; // oil taken away again
    expect(lit(world, ["pond"])).toBe(false);
    // Held together also works, not just grounded.
    world.items.oil.holder = "vale";
    world.items.lamp.holder = "vale";
    expect(lit(world, ["pond"])).toBe(true);
  });
});

describe("#1550 mirror rules", () => {
  it("opens the mirror to the attic for a lit lamp held at the pond", () => {
    const world = createWorld();
    world.actors.vale.place = "pond";
    world.items.oil.holder = "vale";
    world.items.lamp.holder = "vale"; // held, so at the pond with the player
    expect(reflectionsFrom(world, "pond")).toContain("attic");
    world.items.lamp.holder = "pond"; // grounded is not "held"
    expect(reflectionsFrom(world, "pond")).not.toContain("attic");
  });

  it("opens the mirror to the pond only when the attic is dark", () => {
    const world = createWorld();
    world.actors.vale.place = "attic";
    world.items.lamp.holder = "attic"; // lamp present but dark (no oil held)
    expect(reflectionsFrom(world, "attic")).toContain("pond");
    world.items.oil.holder = "vale"; // now the attic lamp is lit
    expect(reflectionsFrom(world, "attic")).not.toContain("pond");
  });
});
