import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  localRoadEnds,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { authoredRouteEdges } from "../v2/card-game/roaming-routes.mjs";
import { homecomingJourney } from "./helpers/greek-homecoming.mjs";

const pack = packDefinition("greek-drama");
const cut = [
  "greek-road-athens-colonus",
  "greek-road-colonus-marathon",
  "greek-road-piraeus-eleusis",
  "greek-road-athens-eleusis",
  "greek-road-athens-marathon",
  "greek-road-colonus-eleusis",
];

// A world saved by rules 25, the last release with seven Attic roads.
function rules25(edit) {
  const context = vm.createContext({});
  vm.runInContext(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/engine-v25.js",
        import.meta.url,
      ),
      "utf8",
    ),
    context,
  );
  const call = (request) =>
    JSON.parse(context.cardShared(JSON.stringify(request)));
  const world = call({ op: "create" }).world;
  delete world.opening;
  world.packs["greek-drama"].scope = "full";
  world.crossings["pond-greek-harbor"].discovered = true;
  edit(world);
  const request = {
    world,
    actor: "vale",
    claimed: ["vale", "mara"],
    present: ["vale", "mara"],
  };
  const action = call({ ...request, op: "view" }).actions.find(
    (a) => a.kind === "wait",
  );
  const played = call({ ...request, op: "play", action });
  expect(played.ok, played.error).toBe(true);
  expect(played.world.packs["greek-drama"].revision).toBe(7);
  return played.world;
}

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
    expect(pack.avatars["greek-household-witness"].journey.path).toEqual([
      "greek-eleusis",
      "greek-piraeus",
    ]);
  });

  it("moves an earlier visit off a cut road and repairs known routes", () => {
    const before = rules25((world) => {
      world.actors.vale.place = "greek-road-athens-eleusis";
      world.actors.mara.place = "greek-road-colonus-marathon";
      world.items.lamp.holder = "greek-road-colonus-eleusis";
      world.routeKnowledge.vale = [
        ["greek-athens", "greek-road-athens-eleusis"],
        ["greek-road-athens-eleusis", "greek-eleusis"],
        ["greek-colonus", "greek-road-colonus-marathon"],
        ["greek-road-colonus-marathon", "greek-marathon"],
      ];
    });
    const current = decodeSave(JSON.stringify(before));
    expect(current.packs["greek-drama"].revision).toBe(pack.revision);
    expect(current.actors.vale.place).toBe("greek-athens");
    expect(current.actors.mara.place).toBe("greek-colonus");
    expect(current.items.lamp.holder).toBe("greek-colonus");
    expect(current.log).toEqual(before.log);
    for (const id of cut)
      expect(current.memories[id]).toEqual(before.memories[id]);
    // Every known step is a live exit or route, and Athens to Eleusis now
    // passes through Piraeus.
    const authored = new Set(authoredRouteEdges().map((e) => e.join(">")));
    for (const edge of current.routeKnowledge.vale)
      expect(authored.has(edge.join(">")), edge.join(">")).toBe(true);
    expect(current.routeKnowledge.vale).toEqual(
      expect.arrayContaining([
        ["greek-athens", "greek-road-athens-piraeus"],
        ["greek-road-athens-piraeus", "greek-piraeus"],
        ["greek-piraeus", "greek-eleusis"],
        ["greek-colonus", "greek-marathon"],
      ]),
    );
    expect(exits(current, "greek-athens", "vale")).toContain("greek-colonus");
    for (const id of cut) expect(entityActive(current, id)).toBe(false);
    expect(decodeSave(encodeSave(current))).toEqual(current);
  });

  // Myrine's journey progress is only her saved place on the authored path,
  // so a revision-7 save is the agreed world with its earlier pack revision.
  const agreedAtRevision7 = (place) => {
    const world = structuredClone(
      homecomingJourney().after["greek-homecoming-agree-journey"],
    );
    world.packs["greek-drama"].revision = 7;
    if (place)
      for (const id of ["vale", "greek-household-witness"])
        world.actors[id].place = place;
    return world;
  };

  it("finishes an agreed journey that was halfway along the coast road", () => {
    const before = agreedAtRevision7("greek-road-piraeus-eleusis");
    const current = decodeSave(JSON.stringify(before));
    expect(current.packs["greek-drama"].revision).toBe(pack.revision);
    expect(current.actors["greek-household-witness"].place).toBe(
      "greek-piraeus",
    );
    expect(current.actors.vale.place).toBe("greek-piraeus");
    const receipt = (w) =>
      w.packs["greek-drama"].receipts["greek-homecoming-agree-journey"];
    expect(receipt(current)).toBe(receipt(before));
    expect(decodeSave(encodeSave(current))).toEqual(current);
  });

  it("starts an agreed journey at Eleusis straight to Piraeus", () => {
    const current = decodeSave(JSON.stringify(agreedAtRevision7()));
    expect(current.actors["greek-household-witness"].place).toBe(
      "greek-eleusis",
    );
    expect(
      legalActions(current, "vale").some(
        (a) =>
          a.kind === "accompany" &&
          a.target === "greek-household-witness" &&
          a.destination === "greek-piraeus",
      ),
    ).toBe(true);
  });
});
