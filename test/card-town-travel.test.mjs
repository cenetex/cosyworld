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
import { backdrop, locationVariant } from "../v2/card-game/scene.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { addQuestRecord } from "../v2/card-game/shared-quests.mjs";
import { recordQuestCompletion } from "../v2/card-game/quest-completions.mjs";

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
  it.each([
    ["greek-road-thebes", "greek-harbor", "greek-courtyard", 16],
    ["greek-road-athens-harbor", "greek-athens-harbor", "greek-athens", 16],
    ["greek-road-thebes", "greek-harbor", "greek-courtyard", 17],
    ["greek-road-athens-harbor", "greek-athens-harbor", "greek-athens", 17],
  ])(
    "continues a released visit on %s inside its town",
    (road, port, town, version) => {
      const before = releasedRoad(road, version);
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
      expect(current.memories[road]).toMatchObject(before.memories[road]);
      expect(current.packs["greek-drama"].revision).toBe(
        packDefinition("greek-drama").revision,
      );
      expect(exits(current, port, "vale")).toContain(town);
      expect(
        legalActions(current, "vale").some(
          (a) => a.kind === "move" && a.target === town,
        ),
      ).toBe(true);
      expect(availableCards(current)).not.toContain(road);
      expect(decodeSave(encodeSave(current))).toEqual(current);
    },
  );

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
    const shared = addQuestRecord(before, {
      holder: { kind: "place", id: "greek-road-athens-harbor" },
      program: {
        id: "road-visit",
        name: "A visit by the harbor",
        steps: [
          { items: [], avatars: [], location: "greek-road-athens-harbor" },
        ],
      },
    });
    const current = decodeSave(JSON.stringify(before));
    expect(current.quests.records[quest.key].program.steps[0].location).toBe(
      "greek-athens-harbor",
    );
    expect(current.quests.records[quest.key].key).toBe(quest.key);
    expect(current.quests.records[shared.key].holder).toEqual({
      kind: "place",
      id: "greek-athens-harbor",
    });
    expect(current.quests.records[shared.key].program.steps[0].location).toBe(
      "greek-athens-harbor",
    );
  });

  it("offers eight exact roads and direct visits inside each town", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    const roads = Object.entries(packDefinition("greek-drama").places).filter(
      ([id, p]) => p.road && entityActive(w, id),
    );
    expect(Object.fromEntries(roads.map(([id, p]) => [id, p.road]))).toEqual({
      "greek-road-athens-piraeus": ["greek-piraeus", "greek-athens"],
      "greek-road-athens-colonus": ["greek-athens", "greek-colonus"],
      "greek-road-athens-eleusis": ["greek-athens", "greek-eleusis"],
      "greek-road-athens-marathon": ["greek-athens", "greek-marathon"],
      "greek-road-piraeus-eleusis": ["greek-piraeus", "greek-eleusis"],
      "greek-road-colonus-eleusis": ["greek-colonus", "greek-eleusis"],
      "greek-road-colonus-marathon": ["greek-colonus", "greek-marathon"],
      "greek-susa-road": ["greek-troy", "greek-susa"],
    });
    for (const [id, road] of roads) {
      expect(exits(w, id, "vale").sort(), id).toEqual([...road.road].sort());
      for (const endpoint of road.road)
        expect(exits(w, endpoint, "vale"), endpoint).toContain(id);
    }
    expect(exits(w, "greek-vii-crag-camp", "vale")).toEqual([
      "greek-susa",
      "greek-scythian-crag",
    ]);
    for (const endpoint of ["greek-susa", "greek-scythian-crag"])
      expect(exits(w, endpoint, "vale")).toContain("greek-vii-crag-camp");
    expect(exits(w, "greek-athens-harbor", "vale")).toContain("greek-athens");
    expect(exits(w, "greek-harbor", "vale")).toContain("greek-courtyard");
  });

  it("lets the Bard visit a completed deed from an earlier internal road", () => {
    const before = releasedRoad("greek-road-athens-harbor");
    const quest = addQuestRecord(before, {
      holder: { kind: "place", id: "greek-road-athens-harbor" },
      program: {
        id: "road-deed",
        name: "A deed by the harbor",
        steps: [
          { items: [], avatars: [], location: "greek-road-athens-harbor" },
        ],
      },
    });
    quest.completedTurn = before.turn;
    quest.step = 1;
    const receipt = recordQuestCompletion(before, quest, {
      actorId: "vale",
      locationId: "greek-road-athens-harbor",
    });
    const current = decodeSave(JSON.stringify(before));
    const wait = legalActions(current).find((action) => action.kind === "wait");
    const result = play(current, wait);
    expect(result.ok, result.error).toBe(true);
    expect(result.state.roamingQuests["greek-rhapsode"].target.locationId).toBe(
      "greek-athens-harbor",
    );
    expect(
      result.state.questCompletions.recent.find(
        (record) => record.id === receipt.id,
      ).locationId,
    ).toBe("greek-road-athens-harbor");
  });
});

it("changes the Athens berth painting with the shared ship's dock", () => {
  const w = createWorld({ packScopes: { "greek-drama": "full" } });
  w.crossings["pond-greek-harbor"].discovered = true;
  w.transports["greek-ship"].dock = "pond";
  expect(backdrop("greek-athens-harbor", w)).toBe(
    "./assets/greek-drama/athens-harbor-open-berth.webp",
  );
  const empty = locationVariant(w, "greek-athens-harbor");
  w.transports["greek-ship"].dock = "greek-athens-harbor";
  expect(backdrop("greek-athens-harbor", w)).toBe(
    "./assets/greek-drama/athens-harbor.webp",
  );
  expect(locationVariant(w, "greek-athens-harbor")).not.toBe(empty);
});
