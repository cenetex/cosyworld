import { describe, it, expect } from "vitest";
import {
  createWorld,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

describe("local town visits and road history", () => {
  // Athens Harbor has joined Piraeus: its old road folds into the quays.
  const quay = [
    "greek-road-athens-harbor",
    "greek-piraeus",
    "greek-road-athens-piraeus",
  ];


  it("keeps one road between towns and direct visits inside each town", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    const roads = Object.entries(packDefinition("greek-drama").places).filter(
      ([id, p]) => p.road && entityActive(w, id),
    );
    const attic = [
      "greek-athens",
      "greek-piraeus",
      "greek-colonus",
      "greek-eleusis",
      "greek-marathon",
    ];
    expect(
      roads
        .filter(([, p]) => p.road.some((end) => attic.includes(end)))
        .map(([id]) => id)
        .sort(),
    ).toEqual([
      "greek-cithaeron",
      "greek-road-athens-eleusis",
      "greek-road-athens-piraeus",
      "greek-road-sacred-way",
    ]);
    // The Long Walls open from either end only with the herald's truce.
    expect(exits(w, "greek-athens", "vale")).toEqual(
      expect.arrayContaining(["greek-road-athens-eleusis", "greek-assembly"]),
    );
    expect(exits(w, "greek-colonus", "vale")).toEqual(
      expect.arrayContaining(["greek-eleusis", "greek-marathon"]),
    );
    expect(exits(w, "greek-piraeus", "vale")).toEqual([]);
    expect(roads.map(([id]) => id).sort()).toEqual([
      "greek-cithaeron",
      "greek-oeta",
      "greek-road-athens-eleusis",
      "greek-road-athens-piraeus",
      "greek-road-north",
      "greek-road-sacred-way",
      "greek-road-thebes",
    ]);
    expect(entityActive(w, "greek-athens-harbor")).toBe(false);
  });

  it("the Wine-Dark Harbor reaches Thebes only by the Theban Harbor Road", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    w.crossings["pond-greek-harbor"].discovered = true;
    const road = "greek-road-thebes";
    expect(entityActive(w, road)).toBe(true);
    expect(exits(w, "greek-harbor", "vale")).not.toContain("greek-courtyard");
    expect(exits(w, "greek-courtyard", "vale")).not.toContain("greek-harbor");
    expect(exits(w, "greek-harbor", "vale")).toEqual(
      expect.arrayContaining([road, "greek-argolid-road"]),
    );
    expect(exits(w, road, "vale")).toEqual(["greek-harbor", "greek-courtyard"]);
    w.actors.vale.place = "greek-harbor";
    let s = w;
    for (const target of [road, "greek-courtyard"]) {
      const move = legalActions(s, "vale").find(
        (a) => a.kind === "move" && a.target === target,
      );
      expect(move, target).toBeTruthy();
      const result = play(s, move);
      expect(result.ok, result.error).toBe(true);
      s = result.state;
      expect(s.actors.vale.place).toBe(target);
    }
  });

  it("gives every walkable road its own painting", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    const paintings = Object.entries(packDefinition("greek-drama").places)
      .filter(([id, p]) => p.road && entityActive(w, id))
      .map(([, p]) => p.backdrop || p.art);
    expect(new Set(paintings).size).toBe(paintings.length);
  });
});
