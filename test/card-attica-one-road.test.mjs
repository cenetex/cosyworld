import { describe, expect, it } from "vitest";
import { createWorld, exits } from "../v2/card-game/world.mjs";
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
  "greek-road-athens-marathon",
  "greek-road-colonus-eleusis",
];

describe("one road in Attica", () => {
  const world = createWorld({ packScopes: { "greek-drama": "full" } });
  const walkableRoads = Object.entries(pack.places).filter(
    ([id, place]) => place.road && !place.retired && entityActive(world, id),
  );

  it("Athens and Piraeus are joined by exactly one road", () => {
    const joining = walkableRoads.filter(([, place]) =>
      ["greek-athens", "greek-piraeus"].every((end) =>
        place.road.includes(end),
      ),
    );
    expect(joining.map(([id]) => id)).toEqual(["greek-road-athens-piraeus"]);
    expect(exits(world, "greek-athens", "vale")).not.toContain("greek-piraeus");
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
