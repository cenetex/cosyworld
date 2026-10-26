import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import {
  observableStates,
  packDefinitions,
  hub,
} from "../v2/card-game/pack-registry.mjs";
import {
  observationProblems,
  packProblems,
} from "../v2/card-game/pack-schema.mjs";

describe("world pack observations", () => {
  it("reads a mounted avatar's final state through the same path as hub items", () => {
    const world = createWorld();
    world.actors.badger.awake = false;
    expect(observableStates(world, ["badger"])).toEqual([
      { id: "badger-awake", value: false },
    ]);
    world.actors.badger.awake = true;
    expect(observableStates(world, ["badger"])).toEqual([
      { id: "badger-awake", value: true },
    ]);
    expect(observableStates(world, ["vale"])).toEqual([]);
  });

  it("accepts a new pack item and vocabulary through data", () => {
    const definition = {
      id: "gate-open",
      entity: "iron-gate",
      subjects: ["iron gate"],
      source: { kind: "item_flag", field: "open" },
      values: {
        true: { fact: "The iron gate is open.", claims: ["is open"] },
        false: { fact: "The iron gate is closed.", claims: ["is closed"] },
      },
    };
    expect(observationProblems([definition], { items: ["iron-gate"] })).toEqual(
      [],
    );
    const world = { actors: {}, items: { "iron-gate": { open: true } } };
    expect(observableStates(world, ["iron-gate"], [definition])).toEqual([
      { id: "gate-open", value: true },
    ]);
    world.items["iron-gate"].open = false;
    expect(observableStates(world, ["iron-gate"], [definition])).toEqual([
      { id: "gate-open", value: false },
    ]);
  });

  it("rejects malformed definitions at the pack boundary", () => {
    const source = packDefinitions.find((p) => p.id === "badger-forest");
    for (const change of [
      (d) => {
        d.entity = "vale";
      },
      (d) => {
        d.source.kind = "execute";
      },
      (d) => {
        d.source.field = "__proto__";
      },
      (d) => {
        d.values.false = null;
      },
      (d) => {
        d.values.true.claims = [".*"];
      },
      (d) => {
        d.subjects = [];
      },
      (d) => {
        d.values.false.claims = d.values.true.claims;
      },
    ]) {
      const pack = structuredClone(source);
      change(pack.observations[0]);
      expect(packProblems(pack, hub).join(" ")).toContain(
        "invalid observation",
      );
    }
    expect(
      observationProblems([source.observations[0], source.observations[0]], {
        avatars: ["badger"],
      }).length,
    ).toBeGreaterThan(0);
  });
});
