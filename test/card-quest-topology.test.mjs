import { describe, it, expect } from "vitest";
import { createWorld, places, things } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  installQuestCollection,
  ensureCollectedQuest,
  collectExperienceQuests,
} from "../v2/card-game/quests.mjs";
import { offerWorld } from "./fixtures/card-quest-offers.mjs";

const unusedPlaces = () => {
  throw new Error("This saved purpose already has its route requirements.");
};

describe("quest topology on demand", () => {
  it("keeps an active saved purpose without walking the map", () => {
    const world = enableMotives(createWorld({ opening: true }), {
      personalQuests: true,
    });
    installQuestCollection(world, "vale");
    const expected = structuredClone(world);
    ensureCollectedQuest(expected, "vale", places, things);
    expect(() =>
      ensureCollectedQuest(world, "vale", unusedPlaces, things),
    ).not.toThrow();
    expect(world).toEqual(expected);
  });

  it("consumes quiet experiences without building routes for a blocked offer", () => {
    const world = offerWorld();
    world.turn = world.revision = 4;
    const life = world.life.actors.vale;
    life.collection.lastOfferTurn = 3;
    life.experiences.push({
      kind: "talk",
      turn: 4,
      other: "mara",
      item: null,
      place: "station",
    });
    const expected = structuredClone(world);
    collectExperienceQuests(expected, "vale", places, things);
    expect(() =>
      collectExperienceQuests(world, "vale", unusedPlaces, things),
    ).not.toThrow();
    expect(world).toEqual(expected);
    expect(life.collection.collectedThrough).toBe(4);
  });

  it.each(["fallback", "experience"])(
    "resolves fresh routes for each actual %s purpose and preserves its saved result",
    (kind) => {
      let currentPlaces;
      let reads = 0;
      const source = () => {
        reads += 1;
        return currentPlaces;
      };
      for (const exits of [[], ["pond"]]) {
        const world = offerWorld();
        world.life.actors.vale.phase = "active";
        world.turn = world.revision = 8;
        world.life.actors.vale.experiences.push({
          kind: "talk",
          turn: 8,
          other: "mara",
          item: null,
          place: "station",
        });
        currentPlaces = {
          ...places,
          station: { ...places.station, exits },
        };
        const expected = structuredClone(world);
        const before = reads;
        if (kind === "fallback") {
          ensureCollectedQuest(expected, "vale", currentPlaces, things);
          ensureCollectedQuest(world, "vale", source, things);
        } else {
          collectExperienceQuests(expected, "vale", currentPlaces, things);
          collectExperienceQuests(world, "vale", source, things);
        }
        expect(reads).toBeGreaterThan(before);
        expect(world).toEqual(expected);
        expect(world.life.actors.vale.collection.cards.length).toBeGreaterThan(
          0,
        );
      }
    },
  );
});
