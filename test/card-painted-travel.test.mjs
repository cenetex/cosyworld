import { describe, expect, it } from "vitest";
import { backdrop, stageOf, travelCard } from "../v2/card-game/scene.mjs";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { isNight, locationDaylight } from "../v2/card-game/daylight.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import {
  argosPaintings,
  argosPaintingWorld,
  shipPaintingWorld,
} from "./helpers/painted-travel.mjs";

const art = (file) => `./assets/greek-drama/${file}.webp`;
describe("painted sea phases", () => {
  for (const phase of ["docked", "sea", "arrived"])
    it.each([false, true])(
      `${phase} chooses its saved lighting (night=%s)`,
      (night) => {
        const world = shipPaintingWorld(phase, night);
        expect(isNight(world)).toBe(night);
        const file =
          phase === "sea"
            ? `ship-deck-at-sea-${night ? "night" : "day"}`
            : `ship-deck${night ? "-night" : ""}`;
        expect(backdrop("greek-ship", world)).toBe(art(file));
        expect(backdrop("greek-ship", decodeSave(encodeSave(world)))).toBe(
          art(file),
        );
        // The boarding card remains the outside view of the ship.
        world.actors.vale.place = "pond";
        if (phase === "docked")
          expect(travelCard(world, "greek-ship").art).not.toMatch(/ship-deck/);
      },
    );
});

describe("Argos account paintings", () => {
  for (const [place, account, painting] of argosPaintings)
    it.each([false, true])(
      `${place} keeps its account and doorway (night=%s)`,
      (night) => {
        const world = argosPaintingWorld(place, account, night);
        const file = art(`${painting}${night ? "-night" : ""}`);
        expect(backdrop(place, world)).toBe(file);
        expect(backdrop(place, decodeSave(encodeSave(world)))).toBe(file);
        expect(locationDaylight(world, place).phase).toBe(
          night ? "night" : "day",
        );
        expect(stageOf(world, place).focus).toEqual({ x: 31, y: 50 });
        expect(packDefinition("greek-drama").release.places).not.toContain(
          place,
        );
      },
    );
});
