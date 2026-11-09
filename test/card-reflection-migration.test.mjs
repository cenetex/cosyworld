import { describe, expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { upgradeReflectionGatesSave } from "../v2/card-game/legacy-saves.mjs";

// #1550 turned the pond-clearing and pond-greek-harbor crossings from signals
// (with a saved phase/until) into static `requires` gates. `upgradeReflectionGatesSave`
// drops the orphaned signal state so a pre-#1550 save loads under the new rules.

describe("reflection-gates migration (#1550)", () => {
  it("drops orphaned phase/until from the two static-gate crossings", () => {
    const s = {
      crossings: {
        "pond-clearing": { discovered: false, phase: 2, until: 10 },
        "pond-greek-harbor": { discovered: true, phase: 1, until: 5 },
        "clearing-pond": { discovered: false },
      },
    };
    upgradeReflectionGatesSave(s);
    expect(s.crossings["pond-clearing"]).toEqual({ discovered: false });
    expect(s.crossings["pond-greek-harbor"]).toEqual({ discovered: true });
    expect(s.crossings["clearing-pond"]).toEqual({ discovered: false });
  });

  it("is idempotent for saves already on the new shape", () => {
    const s = {
      crossings: {
        "pond-clearing": { discovered: true },
        "pond-greek-harbor": { discovered: false },
      },
    };
    const before = structuredClone(s);
    upgradeReflectionGatesSave(s);
    expect(s).toEqual(before);
  });

  it("lets a pre-#1550 save with orphaned signal state decode", () => {
    const world = createWorld();
    const raw = JSON.parse(encodeSave(world));
    raw.crossings["pond-clearing"] = { discovered: false, phase: 2, until: 10 };
    raw.crossings["pond-greek-harbor"] = {
      discovered: true,
      phase: 1,
      until: 5,
    };
    const next = decodeSave(JSON.stringify(raw));
    expect(next.crossings["pond-clearing"]).toEqual({ discovered: false });
    expect(next.crossings["pond-greek-harbor"]).toEqual({ discovered: true });
  });
});

describe("pre-#1550 save compatibility", () => {
  it("keeps old lamp lit/fuel state and item ownership untouched", () => {
    const world = createWorld();
    world.items.lamp.lit = true;
    world.items.lamp.fuel = 9;
    world.items.cloth.holder = "lamp"; // old covering relationship
    world.actors.vale.place = "pond";
    const round = decodeSave(encodeSave(world));
    // The rules no longer read lit/fuel, but the fields survive for replay.
    expect(round.items.lamp.lit).toBe(true);
    expect(round.items.lamp.fuel).toBe(9);
    expect(round.items.cloth.holder).toBe("lamp");
    expect(round.actors.vale.place).toBe("pond");
  });
});
