import { describe, expect, it } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import {
  backdrop,
  currentScene,
  locationVariant,
  locationOverlay,
  sceneScript,
} from "../v2/card-game/scene.mjs";
import { summonTransport } from "../v2/card-game/pack-transport.mjs";
import {
  packDefinition,
  packDefinitions,
  hub,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";

const harbor = "greek-harbor";
const open = "./assets/greek-drama/harbor-open-berth.webp";
const docked = "./assets/greek-drama/harbor-ship-at-berth.webp";
function move(world, target) {
  const action = legalActions(world).find(
    (a) => a.kind === "move" && a.target === target,
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function check(world, expected) {
  expect(backdrop(harbor, world)).toBe(expected);
  expect(
    sceneScript(world).locations.find((p) => p.id === harbor).background,
  ).toBe(expected);
  expect(locationVariant(world, harbor)).toBe(
    expected === docked ? "greek-harbor-pond" : "base",
  );
  expect(locationOverlay(world, harbor)).toBeNull();
  expect(backdrop(harbor, decodeSave(encodeSave(world)))).toBe(expected);
  if (world.actors.vale.place === harbor)
    expect(currentScene(world).background).toBe(expected);
}
describe("harbor scenery follows the ship", () => {
  it("keeps the ship visible while boarding and follows its dock through a return trip", () => {
    let world = createWorld();
    world.actors.vale.place = harbor;
    check(world, docked);
    world = move(world, "greek-ship");
    check(world, docked);
    world = move(world, "pond");
    check(world, open);
    world = move(world, "greek-ship");
    check(world, open);
    world = move(world, harbor);
    check(world, docked);
  });
  it("updates a viewer ashore when the ship is recalled, and waits for passengers", () => {
    let world = createWorld();
    world.actors.vale.place = harbor;
    summonTransport(world, "greek-ship", "pond");
    check(world, open);
    summonTransport(world, "greek-ship", harbor);
    check(world, docked);
    world = move(world, "greek-ship");
    summonTransport(world, "greek-ship", harbor);
    check(world, docked);
    world = move(world, "pond");
    check(world, docked);
  });
  it("checks the crossing backdrop path against the pack media rules", () => {
    const pack = structuredClone(packDefinition("greek-drama"));
    expect(
      packProblems(
        pack,
        hub,
        packDefinitions.flatMap((p) => Object.keys(p.places)),
      ),
    ).toEqual([]);
    pack.crossings.find((c) => c.from === harbor).scenery.backdrop =
      "https://example.com/ship.webp";
    expect(
      packProblems(
        pack,
        hub,
        packDefinitions.flatMap((p) => Object.keys(p.places)),
      ).some((p) => p.includes("scenery")),
    ).toBe(true);
  });
});
