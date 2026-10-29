import { describe, expect, it } from "vitest";
import forest from "../v2/card-game/forest.json" with { type: "json" };
import {
  createWorld,
  decodeSave,
  encodeSave,
  validateWorld,
} from "../v2/card-game/world.mjs";
import { trustValue } from "../v2/card-game/trust.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

const required = Object.entries(forest.initialState.actors).flatMap(
  ([id, actor]) => Object.keys(actor.trust).map((other) => [id, other]),
);

describe("original forest trust fields", () => {
  it.each(required)("keeps %s to %s required", (id, other) => {
    const world = createWorld();
    delete world.actors[id].trust[other];
    expect(() => validateWorld(world)).toThrow();
    expect(() => encodeSave(world)).toThrow();
    expect(() => decodeSave(JSON.stringify(world))).toThrow();
  });

  it.each([0, 1, 2, 3])("retains every original field at %i", (value) => {
    const world = createWorld();
    for (const [id, other] of required) world.actors[id].trust[other] = value;
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("keeps empty new pack rows and implicit new peers", () => {
    const world = createWorld();
    expect(world.actors.mara.trust).toEqual({});
    expect(world.actors.badger.trust).toEqual({});
    expect(trustValue(world, "mara", "vale")).toBe(0);
    expect(trustValue(world, "vale", "mara")).toBe(0);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });

  it("keeps all released dense entries exact through upgrade", () => {
    const old = releasedCardEngine(20).dispatch({ op: "create" }).world;
    for (const [i, actor] of Object.values(old.actors).entries())
      for (const [j, other] of Object.keys(actor.trust).entries())
        actor.trust[other] = (i + j) % 4;
    const next = decodeSave(JSON.stringify(old));
    for (const [id, actor] of Object.entries(old.actors))
      expect(next.actors[id].trust).toEqual(actor.trust);
    expect(decodeSave(encodeSave(next))).toEqual(next);
  });

  it("checks completeness in a released dense row", () => {
    const old = releasedCardEngine(20).dispatch({ op: "create" }).world;
    delete old.actors.mara.trust.vale;
    expect(() => decodeSave(JSON.stringify(old))).toThrow("trust records");
  });
});
