import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  backdrop,
  currentScene,
  locationVariant,
  travelCard,
} from "../v2/card-game/scene.mjs";
import { locationDaylight, DAYLIGHT_TURNS } from "../v2/card-game/daylight.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";

const thebes = [
  "greek-harbor",
  "greek-courtyard",
  "greek-well",
  "greek-palace",
  "greek-gate",
  "greek-battlefield",
  "greek-sanctuary",
  "greek-road-thebes",
];
const night = (world, place) => backdrop(place, world).endsWith("-night.webp");
function wait(world) {
  const result = play(
    world,
    legalActions(world).find((action) => action.kind === "wait"),
  );
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

describe("day and night in Thebes", () => {
  it("changes the Theban places and road on the same accepted turn and restores them from a save", () => {
    let world = createWorld();
    world.actors.vale.place = "greek-courtyard";
    world.turn = world.revision = DAYLIGHT_TURNS - 1;
    for (const place of thebes) {
      expect(locationDaylight(world, place).phase).toBe("day");
      expect(night(world, place)).toBe(false);
    }
    world = wait(world);
    for (const place of thebes) {
      expect(locationDaylight(world, place).phase).toBe("night");
      expect(night(world, place)).toBe(true);
      expect(backdrop(place, decodeSave(encodeSave(world)))).toBe(
        backdrop(place, world),
      );
    }
    expect(currentScene(world).daylight.phase).toBe("night");
    expect(locationVariant(world, "greek-courtyard")).toBe(
      "base:rain-court:night",
    );
    const context = narrativeContext(world);
    expect(
      context.entities.find((entity) => entity.id === "greek-courtyard").facts,
    ).toContain("It is night in Thebes.");
    world.turn = world.revision = DAYLIGHT_TURNS * 2 - 1;
    world = wait(world);
    for (const place of thebes) expect(night(world, place)).toBe(false);
  });

  it.each([
    [
      "greek-harbor",
      "harbor-open-berth",
      "harbor-ship-at-berth",
      "harbor-ship-at-berth",
    ],
    [
      "greek-athens-harbor",
      "athens-harbor-open-berth",
      "athens-harbor",
      "athens-harbor-ship-at-berth",
    ],
    [
      "greek-piraeus",
      "piraeus-open-berth",
      "open-door-piraeus",
      "piraeus-ship-at-berth",
    ],
  ])(
    "keeps %s tied to the saved ship dock in day and night",
    (place, open, docked, nightDocked) => {
      const world = createWorld({ packScopes: { "greek-drama": "full" } });
      world.crossings["pond-greek-harbor"].discovered = true;
      for (const turn of [0, DAYLIGHT_TURNS, DAYLIGHT_TURNS * 2]) {
        world.turn = world.revision = turn;
        const suffix = turn === DAYLIGHT_TURNS ? "-night" : "";
        summonTransport(world, "greek-ship", place);
        expect(backdrop(place, world)).toBe(
          `./assets/greek-drama/${suffix ? nightDocked : docked}${suffix}.webp`,
        );
        expect(backdrop(place, decodeSave(encodeSave(world)))).toBe(
          backdrop(place, world),
        );
        summonTransport(world, "greek-ship", "pond");
        expect(backdrop(place, world)).toBe(
          `./assets/greek-drama/${open}${suffix}.webp`,
        );
        expect(backdrop(place, decodeSave(encodeSave(world)))).toBe(
          backdrop(place, world),
        );
      }
    },
  );

  it("keeps the other coastal places on their current paintings", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    for (const place of [
      "greek-aulis",
      "greek-argos-sanctuary",
      "greek-greek-camp",
      "greek-thrace",
    ]) {
      const day = backdrop(place, world);
      world.turn = world.revision = DAYLIGHT_TURNS;
      expect(locationDaylight(world, place)).toBeNull();
      expect(backdrop(place, world)).toBe(day);
      world.turn = world.revision = 0;
    }
  });

  it("shows the road's night painting on both approach cards and in the scene", () => {
    const world = createWorld();
    world.turn = world.revision = DAYLIGHT_TURNS;
    for (const place of ["greek-harbor", "greek-courtyard"]) {
      world.actors.vale.place = place;
      expect(travelCard(world, "greek-road-thebes").art).toBe(
        "./assets/greek-drama/theban-harbor-road-night.webp",
      );
    }
    world.actors.vale.place = "greek-road-thebes";
    expect(currentScene(world).background).toBe(
      "./assets/greek-drama/theban-harbor-road-night.webp",
    );
    expect(currentScene(world).daylight.description).toBe(
      "It is night in Thebes.",
    );
  });

  it("gives both Attic harbors the shared phase and their own place facts", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    world.turn = world.revision = DAYLIGHT_TURNS;
    for (const [place, name] of [
      ["greek-athens-harbor", "Athens Harbor"],
      ["greek-piraeus", "Piraeus Quays"],
    ]) {
      world.actors.vale.place = place;
      expect(locationDaylight(world, place).phase).toBe("night");
      expect(
        narrativeContext(world).entities.find((entity) => entity.id === place)
          .facts,
      ).toContain(`It is night at ${name}.`);
    }
  });
});
