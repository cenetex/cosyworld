import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

const greekRevision = packDefinition("greek-drama").revision;
function releasedRoad(road, version = 16) {
  const context = vm.createContext({});
  vm.runInContext(
    readFileSync(
      new URL(
        `../v2/orchestrator-rust/src/card_shared/engine-v${version}.js`,
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  const world = JSON.parse(
    context.cardShared(JSON.stringify({ op: "create" })),
  ).world;
  delete world.opening;
  world.packs["greek-drama"].scope = "full";
  world.actors.vale.place = road;
  world.actors.mara.place = road;
  world.crossings["pond-greek-harbor"].discovered = true;
  const request = {
    world,
    actor: "vale",
    claimed: ["vale", "mara"],
    present: ["vale", "mara"],
  };
  const view = JSON.parse(
    context.cardShared(JSON.stringify({ ...request, op: "view" })),
  );
  const action = view.actions.find((action) => action.kind === "wait");
  const played = JSON.parse(
    context.cardShared(JSON.stringify({ ...request, op: "play", action })),
  );
  expect(played.ok, played.error).toBe(true);
  return played.world;
}

describe("local town visits and road history", () => {
  // Athens Harbor has joined Piraeus: its old road folds into the quays.
  const quay = [
    "greek-road-athens-harbor",
    "greek-piraeus",
    "greek-road-athens-piraeus",
  ];


  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("sends a remembered harbor-to-Thebes step along the revived road", () => {
    const road = "greek-road-thebes";
    const before = releasedRoad("greek-harbor", 25);
    expect(before.packs["greek-drama"].revision).toBe(7);
    before.routeKnowledge.vale = [
      ["greek-harbor", "greek-courtyard"],
      ["greek-courtyard", "greek-harbor"],
      ["greek-harbor", road],
    ];
    const current = decodeSave(JSON.stringify(before));
    expect(current.packs["greek-drama"].revision).toBe(greekRevision);
    expect(current.routeKnowledge.vale).toEqual([
      ["greek-harbor", road],
      [road, "greek-courtyard"],
      ["greek-courtyard", road],
      [road, "greek-harbor"],
    ]);
    // The old help request for passage was a quest record; it is dropped.
    expect(current.quests).toBeUndefined();
    expect(decodeSave(encodeSave(current))).toEqual(current);
  });

  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("keeps a free place for a traveler when the port has four people", () => {
    const before = releasedRoad("greek-road-athens-harbor");
    for (const actor of ["mara", "ash", "nell", "tavi"])
      before.actors[actor].place = "greek-athens-harbor";
    before.controlledActors = ["vale", "mara", "ash", "nell", "tavi"];
    before.presentActors = before.controlledActors;
    const current = decodeSave(JSON.stringify(before));
    expect(current.actors.vale.place).toBe("greek-athens");
    expect(current.presentActors).toEqual(before.presentActors);
  });

  // package 6 fixtures: starts from a recorded old save, re-recorded after the bump.
it.skip("moves a want for the former road to the road's town", () => {
    const before = releasedRoad("greek-road-athens-harbor");
    before.actors.mara.want = {
      kind: "place",
      target: "greek-road-athens-harbor",
      since: 0,
      refusals: 0,
    };
    const current = decodeSave(JSON.stringify(before));
    expect(current.actors.mara.want).toMatchObject({
      kind: "place",
      target: "greek-piraeus",
    });
    expect(current.quests).toBeUndefined();
    expect(decodeSave(encodeSave(current))).toEqual(current);
  });

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
