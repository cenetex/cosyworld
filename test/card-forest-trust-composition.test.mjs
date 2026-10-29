import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import forest from "../v2/card-game/forest.json" with { type: "json" };

const compiled = JSON.parse(
  readFileSync(new URL("../v2/card-game/packs.json", import.meta.url), "utf8"),
);
const required = Object.entries(forest.initialState.actors).flatMap(
  ([id, actor]) => Object.keys(actor.trust).map((other) => [id, other]),
);

async function table(greek) {
  vi.doMock("../v2/card-game/packs.json", () => ({
    default: greek
      ? compiled
      : {
          ...compiled,
          packs: compiled.packs.filter((pack) => pack.id === "badger-forest"),
        },
  }));
  vi.resetModules();
  return import("../v2/card-game/world.mjs");
}

afterEach(() => {
  vi.doUnmock("../v2/card-game/packs.json");
  vi.resetModules();
});

describe("forest trust before the first Greek mount", () => {
  it("round trips a current sparse table without Greece in local and shared play", async () => {
    const api = await table(false);
    const world = api.createWorld();
    expect(world.packs["greek-drama"]).toBeUndefined();
    expect(world.actors.mara.trust).toEqual({});
    expect(world.actors.badger.trust).toEqual({});
    expect(api.decodeSave(api.encodeSave(world))).toEqual(world);
    const { dispatchShared } = await import("../v2/card-game/shared-world.mjs");
    const shared = dispatchShared({ op: "create", save: api.encodeSave(world) });
    expect(shared.ok, shared.error).toBe(true);
    expect(shared.world.packs["greek-drama"]).toBeUndefined();
    expect(shared.world.actors.mara.trust).toEqual({});
    expect(api.decodeSave(api.encodeSave(shared.world))).toEqual(shared.world);
  });

  it.each(["sparse", "dense"])("keeps earlier %s trust entries during the first mount", async (shape) => {
    const before = await table(false);
    const world = before.createWorld();
    for (const [i, [id, other]] of required.entries())
      world.actors[id].trust[other] = i % 4;
    if (shape === "dense")
      for (const [id, actor] of Object.entries(world.actors))
        actor.trust = Object.fromEntries(
          Object.keys(world.actors)
            .filter((other) => other !== id)
            .map((other) => [other, actor.trust[other] ?? 0]),
        );
    const save = before.encodeSave(world);
    const current = await table(true);
    const next = current.decodeSave(save);
    expect(next.packs["greek-drama"].revision).toBe(8);
    for (const [id, actor] of Object.entries(world.actors))
      expect(next.actors[id].trust).toEqual(actor.trust);
    expect(next.actors["greek-antigone"].trust).toEqual({});
    expect(current.decodeSave(current.encodeSave(next))).toEqual(next);
  });

  it.each(required)("requires original %s to %s during the first mount", async (id, other) => {
    const before = await table(false);
    const world = before.createWorld();
    delete world.actors[id].trust[other];
    const current = await table(true);
    expect(() => current.decodeSave(JSON.stringify(world))).toThrow();
  });
});
