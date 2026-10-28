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
  it("changes all seven places on the same accepted turn and restores them from a save", () => {
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

  it("keeps each harbor painting tied to the saved ship dock in both light settings", () => {
    const world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    for (const turn of [0, DAYLIGHT_TURNS, DAYLIGHT_TURNS * 2]) {
      world.turn = world.revision = turn;
      const suffix = turn === DAYLIGHT_TURNS ? "-night" : "";
      summonTransport(world, "greek-ship", "greek-harbor");
      expect(backdrop("greek-harbor", world)).toBe(
        `./assets/greek-drama/harbor-ship-at-berth${suffix}.webp`,
      );
      summonTransport(world, "greek-ship", "pond");
      expect(backdrop("greek-harbor", world)).toBe(
        `./assets/greek-drama/harbor-open-berth${suffix}.webp`,
      );
    }
  });

  it("keeps the other harbors on their current paintings through the Theban night", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    for (const place of [
      "greek-piraeus",
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
});
