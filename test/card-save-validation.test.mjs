import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  rootHolder,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { entityActive } from "../v2/card-game/pack-registry.mjs";

import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const played = () => {
  const world = createWorld();
  return play(world, legalActions(world)[0]).state;
};

describe("save validation on the play path", () => {
  it("validates even the first save of a world the rules just validated", () => {
    const world = played();
    world.turn = -1;
    expect(() => encodeSave(world)).toThrow(/fresh start/);
    expect(() => encodeSave(world)).toThrow(/fresh start/);
  });
  it("rejects nested mutation after explicit validation", () => {
    const world = played();
    validateWorld(world);
    world.items.lamp.holder = "missing-holder";
    expect(() => encodeSave(world)).toThrow();
    expect(() => encodeSave(world)).toThrow();
  });
  it.each(["local", "shared"])(
    "round-trips valid %s state repeatedly",
    (mode) => {
      const world =
        mode === "shared"
          ? dispatchShared({ op: "create", seed: 17 }).world
          : played();
      for (let i = 0; i < 3; i++) {
        const text = encodeSave(world);
        expect(encodeSave(decodeSave(text))).toBe(text);
      }
    },
  );
  it("validates a world the rules did not return", () => {
    const world = structuredClone(played());
    world.turn = -1;
    expect(() => encodeSave(world)).toThrow(/fresh start/);
  });
  it("validates every decoded save", () => {
    const text = encodeSave(played());
    expect(() => decodeSave(text)).not.toThrow();
    const bad = JSON.parse(text);
    bad.turn = -1;
    expect(() => decodeSave(JSON.stringify(bad))).toThrow(/fresh start/);
    expect(validateWorld(decodeSave(text))).toBeTruthy();
  });
});

describe("holder chains", () => {
  it("finds the root and rejects loops of any length", () => {
    const world = createWorld();
    world.items.cloth.holder = "lamp";
    world.items.lamp.holder = "vale";
    expect(rootHolder(world, "cloth")).toBe("vale");
    world.items.lamp.holder = "cloth";
    expect(() => rootHolder(world, "cloth")).toThrow(/holds itself/);
    world.items.cloth.holder = "bell";
    world.items.bell.holder = "lamp";
    world.items.lamp.holder = "bell";
    expect(() => rootHolder(world, "cloth")).toThrow(/holds itself/);
    expect(typeof entityActive(world, "cloth")).toBe("boolean");
  });
});
