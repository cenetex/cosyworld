import { describe, expect, it } from "vitest";
import { createWorld, exits, legalActions, play } from "../v2/card-game/world.mjs";
import {
  entityActive,
  localRoadEnds,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

const pack = packDefinition("greek-drama");
const cut = [
  "greek-road-athens-colonus",
  "greek-road-colonus-marathon",
  "greek-road-piraeus-eleusis",
  "greek-road-colonus-eleusis",
];

describe("one road in Attica", () => {
  const world = createWorld({ packScopes: { "greek-drama": "full" } });
  const walkableRoads = Object.entries(pack.places).filter(
    ([id, place]) => place.road && !place.retired && entityActive(world, id),
  );

  it("Athens and Piraeus are joined by exactly one road", () => {
    const athens = [
      "greek-athens",
      "greek-civic-avenue",
      "greek-city-road-fork",
      "greek-north-gate",
    ];
    const joining = walkableRoads.filter(
      ([, place]) => place.road.includes("greek-piraeus") &&
        athens.some((end) => place.road.includes(end)),
    );
    expect(joining.map(([id]) => id)).toEqual(["greek-road-athens-piraeus"]);
    expect(joining[0][1].road).toEqual(["greek-piraeus", "greek-city-road-fork"]);
    expect(exits(world, "greek-athens", "vale")).not.toContain("greek-piraeus");
  });

  it("reaches Marathon Altar only by the plain road from the North Gate", () => {
    const road = "greek-road-athens-marathon";
    const athens = "greek-athens";
    const gate = "greek-north-gate";
    const altar = "greek-marathon";
    expect(exits(world, gate, "vale")).toContain(road);
    expect(exits(world, athens, "vale")).not.toContain(road);
    expect(exits(world, athens, "vale")).not.toContain(altar);
    expect(exits(world, road, "vale")).toEqual([gate, altar]);
    expect(exits(world, altar, "vale")).toEqual([road]);
    const neighbors = [
      "greek-eleusis",
      "greek-eleusis-lower-precinct",
      "greek-colonus",
      "greek-attic-farm",
    ];
    for (const neighbor of neighbors) {
      const ways = exits(world, neighbor, "vale");
      expect(ways).not.toContain(altar);
    }
  });

  it("keeps the Eleusis approach open while routing local visits through the Lower Precinct", () => {
    const sanctuary = "greek-eleusis";
    const precinct = "greek-eleusis-lower-precinct";
    const farm = "greek-attic-farm";
    const grove = "greek-colonus";
    const landing = "greek-underworld";
    let local = createWorld();
    local.actors.vale.place = sanctuary;
    expect(local.packs[pack.id].scope).toBe("opening");
    expect(exits(local, sanctuary, "vale")).toEqual([
      "greek-cithaeron",
      "greek-road-athens-eleusis",
      precinct,
    ]);
    expect(exits(local, precinct, "vale")).toEqual([sanctuary, landing, farm]);
    expect(exits(local, farm, "vale")).toEqual([
      precinct,
      grove,
      "greek-acharnae",
    ]);
    expect(exits(local, grove, "vale")).toEqual([farm]);
    expect(exits(local, landing, "vale")).toEqual([precinct]);

    const visit = [precinct, landing, precinct, farm, grove, farm, precinct, sanctuary];
    for (const target of visit) {
      const move = legalActions(local, "vale").find((action) =>
        action.kind === "move" && action.target === target,
      );
      expect(move, target).toBeDefined();
      const result = play(local, move);
      expect(result.ok, result.error).toBe(true);
      local = result.state;
      expect(local.actors.vale.place).toBe(target);
    }
  });

  it("no walkable road shares a backdrop with another walkable road", () => {
    const backdrops = walkableRoads.map(
      ([, place]) => place.backdrop || place.art,
    );
    expect(backdrops.every(Boolean)).toBe(true);
    expect(new Set(backdrops).size).toBe(backdrops.length);
  });

  it("keeps the cut roads for history but no exit leads onto them", () => {
    for (const id of cut) {
      expect(pack.places[id].retired).toBe(true);
      expect(localRoadEnds(id)).toEqual(pack.places[id].road);
      for (const place of Object.values(pack.places))
        expect(place.exits).not.toContain(id);
    }
    expect(pack.sections[0].places).not.toEqual(
      expect.arrayContaining([cut[0]]),
    );
    // The Eleusis road returned as the Sacred Way between two districts.
    expect(pack.places["greek-road-athens-eleusis"].retired).toBeUndefined();
    // It is a plain road: no gate reads anything on it.
    expect(
      pack.routes.filter((r) => r.to === "greek-road-athens-eleusis"),
    ).toEqual([]);
  });
});
