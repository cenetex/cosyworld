import { describe, it, expect } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { portrait } from "../v2/card-game/scene.mjs";
import { onlinePlayers } from "../v2/card-game/toolbar.mjs";
import {
  avatarImage,
  holdsScarf,
  rememberLocalUpgrades,
  scarfItemId,
  wearLocalUpgrades,
} from "../v2/card-game/scarves.mjs";

// The sewn scarf item arrives with the personal-buttons work; until then the
// test places a stand-in item with the agreed id.
const giveScarf = (world, actor, holder = actor) => {
  world.items[scarfItemId(actor)] = { holder, history: [] };
};

describe("scarf portraits follow the scarf", () => {
  it("shows every traveler plain in a new game", () => {
    const world = createWorld();
    for (const id of humanAvatarIds) {
      expect(holdsScarf(world, id)).toBe(false);
      expect(portrait(id, null, world)).toBe(
        `./assets/shared/characters/${id}.png`,
      );
    }
  });

  it("names each scarf by its traveler", () => {
    expect(scarfItemId("vale")).toBe("forest-scarf-vale");
    expect(scarfItemId("mara")).toBe("forest-scarf-mara");
  });

  it("wears the scarf only while holding it, and drops it when given away", () => {
    const world = createWorld();
    giveScarf(world, "vale");
    expect(portrait("vale", null, world)).toBe(
      "./assets/shared/characters/vale-scarf.png",
    );
    expect(portrait("vale", "left", world)).toBe(
      "./assets/shared/characters/vale-scarf.png",
    );
    world.items[scarfItemId("vale")].holder = "mara";
    expect(portrait("vale", null, world)).toBe(
      "./assets/shared/characters/vale.png",
    );
    // Mara carrying Vale's scarf keeps her own plain portrait.
    expect(portrait("mara", null, world)).toBe(
      "./assets/shared/characters/mara.png",
    );
    world.items[scarfItemId("vale")].holder = "station";
    expect(portrait("vale", null, world)).toBe(
      "./assets/shared/characters/vale.png",
    );
  });

  it("keeps the player list in step with the stage", () => {
    const world = createWorld();
    const state = {
      world,
      actor: "vale",
      present: humanAvatarIds.map((id) => Number(id === "vale")),
      claimed: humanAvatarIds.map((id) => Number(id === "vale")),
    };
    expect(onlinePlayers(state)[0].image).toBe(
      "assets/shared/characters/vale.png",
    );
    giveScarf(world, "vale");
    expect(onlinePlayers(state)[0].image).toBe(
      "assets/shared/characters/vale-scarf.png",
    );
    expect(avatarImage(world, "moth")).toBe(null);
  });

  // In-app browsers with DOM storage off throw on reading localStorage, and
  // a new local world still has to start (smoke-card-devices).
  it("starts a local world when the browser blocks storage", () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const world = createWorld();
      expect(wearLocalUpgrades(world)).toBe(world);
      expect(() => rememberLocalUpgrades(world)).not.toThrow();
    } finally {
      if (had) Object.defineProperty(globalThis, "localStorage", had);
      else delete globalThis.localStorage;
    }
  });
});
