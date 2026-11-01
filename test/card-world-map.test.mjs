// The storybook map left the game (2026-11-01). New games never place it, and
// every load retires it from an older save, at the station or in a hand.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  things,
} from "../v2/card-game/world.mjs";
import { hub } from "../v2/card-game/pack-registry.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const oldSave = (holder) => {
  const s = JSON.parse(encodeSave(createWorld()));
  s.items["world-map"] = { holder, history: [] };
  s.memories["world-map"] = structuredClone(s.memories.bell);
  return JSON.stringify(s);
};

describe("the retired storybook map", () => {
  it("is not authored, placed or published", () => {
    expect(things["world-map"]).toBeUndefined();
    expect(hub.items).not.toContain("world-map");
    expect(profiles["world-map"]).toBeUndefined();
    expect(createWorld().items["world-map"]).toBeUndefined();
    expect(createWorld({ opening: true }).items["world-map"]).toBeUndefined();
    expect(publicAssets.some(({ file }) => file.includes("world-map"))).toBe(
      false,
    );
  });

  it("leaves a save where it lay at the station", () => {
    const loaded = decodeSave(oldSave("station"));
    expect(loaded.items["world-map"]).toBeUndefined();
    expect(loaded.memories["world-map"]).toBeUndefined();
    expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
  });

  it("leaves a save where Vale held it", () => {
    const loaded = decodeSave(oldSave("vale"));
    expect(loaded.items["world-map"]).toBeUndefined();
    expect(loaded).toEqual(decodeSave(encodeSave(createWorld())));
  });
});
