import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { places } from "../v2/card-game/world.mjs";
import { crossings } from "../v2/card-game/pack-registry.mjs";

const dir = new URL("../v2/card-game/", import.meta.url);

// Places differ only through stage data (#1489). A selector keyed by a place,
// scene, pack or stage mode would fork the one stage layout again (#1486).
describe("one card stage", () => {
  it("keeps place, scene, pack and stage-mode selectors out of card CSS", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".css")))
      expect(
        readFileSync(new URL(file, dir), "utf8").match(
          /\[data-(place|scene|stage|location|world|pack)[=\]]|data-location-variant/g,
        ),
        file,
      ).toBeNull();
  });

  it("describes per-place staging as data", () => {
    expect(places.attic.stage).toEqual({
      focus: { x: 64, y: 50 },
      mark: 75,
      lamp: { x: 65, y: 60 },
    });
    expect(places.clearing.stage).toMatchObject({
      player: false,
      resident: "badger",
      focus: { x: 45, y: 25 },
    });
    expect(
      crossings.find(({ id }) => id === "attic-forest-cottage").scenery.focus,
    ).toEqual({ x: 0, y: 50 });
  });
});
