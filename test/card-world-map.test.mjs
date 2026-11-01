// The storybook map is an ordinary hub item: it waits at the station, can be
// taken like any item, and old saves gain it where it starts.
import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  things,
} from "../v2/card-game/world.mjs";
import { hub } from "../v2/card-game/pack-registry.mjs";
import { profiles } from "../v2/card-game/memory.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";

const root = new URL("../v2/card-game/", import.meta.url);
const published = new Set(publicAssets.map(({ file }) => file));

describe("the storybook map", () => {
  it("is a hub item with published card art and a full view", () => {
    const map = things["world-map"];
    expect(map.name).toBe("Map of the Wood and the Wine-Dark Sea");
    expect(hub.items).toContain("world-map");
    expect(profiles["world-map"].kind).toBe("item");
    for (const [file, limit] of [
      [map.art, 300_000],
      [map.view, 1_500_000],
    ]) {
      expect(published.has(file), file).toBe(true);
      expect(statSync(new URL(file, root)).size).toBeLessThanOrEqual(limit);
    }
    // The Willows keep their own map; the ids stay distinct.
    expect(existsSync(new URL("assets/willows/map.png", root))).toBe(true);
    expect(things["willows-map"].art).toBe("assets/willows/map.png");
  });

  it("waits at the station, outside the opening hand", () => {
    expect(createWorld().items["world-map"].holder).toBe("station");
    const opening = createWorld({ opening: true });
    expect(opening.items["world-map"].holder).toBe("station");
    expect(opening.actors.vale.place).not.toBe("station");
  });

  it("can be taken at the station", () => {
    const world = createWorld();
    expect(world.actors.vale.place).toBe("station");
    const take = legalActions(world).find(
      (a) => a.kind === "take" && a.item === "world-map",
    );
    expect(take).toBeDefined();
    const result = play(world, take);
    expect(result.ok).toBe(true);
    expect(result.state.items["world-map"].holder).toBe("vale");
    expect(cardPlay(result.state, ["world-map"]).hint).toContain("give it");
    expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
    expect(play(decodeSave(encodeSave(world)), take)).toEqual(result);
  });

  it("joins a save written before it existed", () => {
    const old = JSON.parse(encodeSave(createWorld()));
    const expected = structuredClone(old);
    delete old.items["world-map"];
    delete old.memories["world-map"];
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded).toEqual(expected);
    expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
    expect(loaded.items["world-map"]).toEqual({
      holder: "station",
      history: [],
    });
  });

  it("rejects a present but malformed map instead of replacing it", () => {
    const old = createWorld();
    old.items["world-map"] = null;
    expect(() => decodeSave(JSON.stringify(old))).toThrow();
  });
});
