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
    ["greek-road-athens-harbor", "greek-athens-harbor", "greek-athens", 16],
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
      expect(current.packs["greek-drama"].revision).toBe(8);
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

  it.each([16, 17])(
    "keeps a released rules %i visit on the Theban Harbor Road",
    (version) => {
      const road = "greek-road-thebes";
      const before = releasedRoad(road, version);
      before.items.lamp.holder = road;
      const known = [
        ["greek-harbor", road],
        [road, "greek-courtyard"],
      ];
      before.routeKnowledge.vale = known;
      const current = decodeSave(JSON.stringify(before));
      expect(current.actors.vale.place).toBe(road);
      expect(current.actors.mara.place).toBe(road);
      expect(current.items.lamp.holder).toBe(road);
      expect(current.routeKnowledge.vale).toEqual(known);
      expect(current.packs["greek-drama"].revision).toBe(8);
      expect(exits(current, road, "vale")).toEqual([
        "greek-harbor",
        "greek-courtyard",
      ]);
      expect(decodeSave(encodeSave(current))).toEqual(current);
    },
  );

  it("sends a remembered harbor-to-Thebes step along the revived road", () => {
    const road = "greek-road-thebes";
    const before = releasedRoad("greek-harbor", 25);
    expect(before.packs["greek-drama"].revision).toBe(7);
    before.routeKnowledge.vale = [
      ["greek-harbor", "greek-courtyard"],
      ["greek-courtyard", "greek-harbor"],
      ["greek-harbor", road],
    ];
    const help = addQuestRecord(before, {
      holder: { kind: "place", id: "greek-harbor" },
      program: {
        id: "help:greek-rhapsode:old",
        name: "Open the way to Theban Courtyard",
        steps: [
          {
            items: [],
            avatars: [],
            location: "greek-harbor",
            passage: {
              actor: "greek-rhapsode",
              from: "greek-harbor",
              to: "greek-courtyard",
              kind: "passage",
            },
          },
        ],
      },
    });
    const current = decodeSave(JSON.stringify(before));
    expect(current.packs["greek-drama"].revision).toBe(8);
    expect(current.routeKnowledge.vale).toEqual([
      ["greek-harbor", road],
      [road, "greek-courtyard"],
      ["greek-courtyard", road],
      [road, "greek-harbor"],
    ]);
    expect(current.quests.records[help.key].program.steps[0].passage.to).toBe(
      road,
    );
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

  it("offers eight roads between towns and direct visits inside each town", () => {
    const w = createWorld({ packScopes: { "greek-drama": "full" } });
    const roads = Object.entries(packDefinition("greek-drama").places).filter(
      ([id, p]) => p.road && entityActive(w, id),
    );
    expect(roads).toHaveLength(8);
    expect(exits(w, "greek-athens-harbor", "vale")).toContain("greek-athens");
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
