import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
} from "../v2/card-game/world.mjs";
import { availableCards } from "../v2/card-game/cards.mjs";
import { backdrop, locationVariant } from "../v2/card-game/scene.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";

function releasedRoad(road) {
  const context = vm.createContext({});
  vm.runInContext(
    readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/engine-v16.js",
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
  it.each([
    ["greek-road-thebes", "greek-harbor", "greek-courtyard"],
    ["greek-road-athens-harbor", "greek-athens-harbor", "greek-athens"],
  ])("continues a released visit on %s inside its town", (road, port, town) => {
    const before = releasedRoad(road);
    before.items.lamp.holder = road;
    before.routeKnowledge.vale = [
      [port, road],
      [road, town],
      [town, road],
      [road, port],
    ];
    const current = decodeSave(JSON.stringify(before));
    expect(current.actors.vale.place).toBe(port);
    expect(current.actors.mara.place).toBe(port);
    expect(current.items.lamp.holder).toBe(port);
    expect(current.routeKnowledge.vale).toEqual([
      [port, town],
      [town, port],
    ]);
    expect(current.log).toEqual(before.log);
    expect(current.memories[road]).toEqual(before.memories[road]);
    expect(current.packs["greek-drama"].revision).toBe(6);
    expect(exits(current, port, "vale")).toContain(town);
    expect(
      legalActions(current, "vale").some(
        (a) => a.kind === "move" && a.target === town,
      ),
    ).toBe(true);
    expect(availableCards(current)).not.toContain(road);
    expect(decodeSave(encodeSave(current))).toEqual(current);
  });

  it("keeps a free place for a traveler when the port has four people", () => {
    const before = releasedRoad("greek-road-athens-harbor");
    for (const actor of ["mara", "ash", "nell", "tavi"])
      before.actors[actor].place = "greek-athens-harbor";
    before.controlledActors = ["vale", "mara", "ash", "nell", "tavi"];
    before.presentActors = before.controlledActors;
    const current = decodeSave(JSON.stringify(before));
    expect(current.actors.vale.place).toBe("greek-athens");
    expect(current.presentActors).toEqual(before.presentActors);
  });

  it("continues an unfinished quest at the former road's town", () => {
    const before = releasedRoad("greek-road-athens-harbor");
    const quest = Object.values(before.quests.records).find(
      (q) => q.completedTurn === null,
    );
    quest.program.steps[0].location = "greek-road-athens-harbor";
    const current = decodeSave(JSON.stringify(before));
    expect(current.quests.records[quest.key].program.steps[0].location).toBe(
      "greek-athens-harbor",
    );
    expect(current.quests.records[quest.key].key).toBe(quest.key);
  });

  it("offers seven roads between towns and direct visits inside each town", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    const roads = Object.entries(packDefinition("greek-drama").places).filter(
      ([id, p]) => p.road && entityActive(w, id),
    );
    expect(roads).toHaveLength(7);
    expect(exits(w, "greek-athens-harbor", "vale")).toContain("greek-athens");
    expect(exits(w, "greek-harbor", "vale")).toContain("greek-courtyard");
  });
});

it("changes the Athens berth painting with the shared ship's dock", () => {
  const w = createWorld({ packScopes: { "greek-drama": "full" } });
  w.crossings["pond-greek-harbor"].discovered = true;
  w.transports["greek-ship"].dock = "pond";
  expect(backdrop("greek-athens-harbor", w)).toBe(
    "./assets/greek-drama/athens-harbor-empty.webp",
  );
  const empty = locationVariant(w, "greek-athens-harbor");
  w.transports["greek-ship"].dock = "greek-athens-harbor";
  expect(backdrop("greek-athens-harbor", w)).toBe(
    "./assets/greek-drama/athens-harbor.webp",
  );
  expect(locationVariant(w, "greek-athens-harbor")).not.toBe(empty);
});
