import { expect, it } from "vitest";
import { createWorld, validateWorld } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { reconcilePackProgress } from "../v2/card-game/legacy-saves.mjs";

const radio = packDefinition("ratiradio");
const rati = "ratiradio-rati";
const wake = "ratiradio-wake-rati";

it.each(["local opening", "local without opening", "shared"])(
  "removes a retired encounter consistently in a %s world",
  (mode) => {
    const world =
      mode === "shared"
        ? dispatchShared({ op: "create", seed: 17 }).world
        : createWorld({ opening: mode === "local opening", seed: 17 });
    world.turn = world.revision = 8;
    world.packs.ratiradio.receipts[wake] = 8;
    world.packs.ratiradio.flags["rati-awake"] = true;
    world.packs.ratiradio.met[rati] = 8;
    if (world.opening) world.opening.met[rati] = 8;
    // A progressed, valid synthetic save, not a player's private data.
    expect(validateWorld(structuredClone(world))).toBeTruthy();
    const openingBefore = structuredClone(world.opening);
    const choice = radio.choices.find((c) => c.id === wake);
    const requires = choice.requires;
    try {
      // Revised content no longer allows the saved awakening receipt.
      choice.requires = [
        { kind: "flag", key: "retired-awakening", value: true },
      ];
      reconcilePackProgress(world, new Set([radio.id]));
      expect(world.packs.ratiradio.receipts[wake]).toBeUndefined();
      expect(world.packs.ratiradio.flags["rati-awake"]).toBeUndefined();
      expect(world.packs.ratiradio.met[rati]).toBeUndefined();
      expect(world.opening?.met?.[rati]).toBeUndefined();
      if (openingBefore) delete openingBefore.met[rati];
      expect(world.opening).toEqual(openingBefore);
      expect(validateWorld(structuredClone(world))).toBeTruthy();
      const once = structuredClone(world);
      reconcilePackProgress(world, new Set([radio.id]));
      expect(world).toEqual(once);
    } finally {
      choice.requires = requires;
    }
  },
);
