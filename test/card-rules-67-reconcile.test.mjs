// Save reconcile checks that still hold on the current rules. The rules-67
// shared-world upgrade (the Theban refusal's Open Door steps, a reworded
// topic, a told sea lane) was retired with every earlier save by the rules
// 133 bump (docs/current-game.md), so its recorded world is gone.
import { describe, expect, it } from "vitest";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { createWorld, decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { reconcilePackProgress } from "../v2/card-game/legacy-saves.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";

const context = (actor = "vale") => ({
  actor,
  claimed: ["vale"],
  present: ["vale"],
});

describe("a save that named the retired storybook map", () => {
  const withMap = (change) => {
    const s = JSON.parse(encodeSave(createWorld()));
    s.items["world-map"] = { holder: "vale", history: [] };
    s.memories["world-map"] = structuredClone(s.memories.bell);
    change(s);
    return decodeSave(JSON.stringify(s));
  };
  it("lets go of a keepsake, an experience and a wish for it", () => {
    const loaded = withMap((s) => {
      s.life.actors.moth.attachments["world-map"] = { from: "vale", turn: 0 };
      s.life.actors.moth.experiences.push({
        kind: "gift",
        turn: 0,
        other: "vale",
        item: "world-map",
        place: "station",
      });
      s.actors.keeper.want = {
        kind: "item",
        target: "world-map",
        since: 0,
        refusals: 0,
      };
    });
    expect(loaded.life.actors.moth.attachments["world-map"]).toBeUndefined();
    expect(loaded.life.actors.moth.experiences.at(-1).item).toBeNull();
    expect(loaded.actors.keeper.want?.target).not.toBe("world-map");
  });
});

describe("pack progress reconcile", () => {
  it("leaves a current save unchanged", () => {
    for (const s of [
      createWorld(),
      createWorld({ opening: true }),
      dispatchShared({ op: "create", seed: 12345 }).world,
    ]) {
      const copy = structuredClone(s);
      reconcilePackProgress(copy, new Set(packDefinitions.map((p) => p.id)));
      expect(copy).toEqual(s);
    }
  });
});

describe("a refused shared save", () => {
  it("names where the rules refused it, and nothing of the world", async () => {
    await import("../v2/card-game/shared-world-entry.mjs");
    const world = dispatchShared({ op: "create", seed: 12345 }).world;
    world.items.lamp.holder = "nowhere";
    const reply = JSON.parse(
      globalThis.cardShared(
        JSON.stringify({ op: "validate", world, ...context() }),
      ),
    );
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatch(
      /^This save needs a fresh start\..*\(validateWorld:\d+ < decodeSave:\d+/,
    );
    expect(reply.error).not.toMatch(/nowhere|lamp/);
  });
});
