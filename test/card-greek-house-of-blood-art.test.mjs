import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { backdrop, currentScene } from "../v2/card-game/scene.mjs";
import {
  DAYLIGHT_TURNS,
  daylightBackdrop,
  locationDaylight,
} from "../v2/card-game/daylight.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";
import { housePlay, housePrepared } from "./helpers/greek-house-of-blood.mjs";

const art = (file) => `assets/greek-drama/house-of-blood/${file}.png`;
const scenes = [
  ["eumenides", "greek-ares-hill", "ares-hill-scene", "on Ares Hill"],
  [
    "orestes",
    "greek-argos-refuge",
    "argos-refuge-scene",
    "at the Argive Refuge",
  ],
  [
    "tauris",
    "greek-tauris-shore",
    "tauris-shore-scene",
    "on the Taurian Shore",
  ],
];

describe("House of Blood scenery", () => {
  it.each(scenes)(
    "changes the %s scene on an accepted turn and keeps its location words after reload",
    (chapter, place, file, words) => {
      let world = housePrepared(chapter);
      const cycle = DAYLIGHT_TURNS * 2;
      const morning = Math.ceil(world.turn / cycle) * cycle;
      world.turn = world.revision = morning + DAYLIGHT_TURNS - 1;
      expect(world.actors.vale.place).toBe(place);
      expect(currentScene(world).background).toBe("./" + art(file));

      world = housePlay(world, "wait");
      expect(locationDaylight(world, place).description).toBe(
        `It is night ${words}.`,
      );
      expect(currentScene(world).background).toBe("./" + art(file + "-night"));
      expect(
        narrativeContext(world).entities.find((entity) => entity.id === place)
          .facts,
      ).toContain(`It is night ${words}.`);
      const restored = decodeSave(encodeSave(world));
      expect(currentScene(restored).background).toBe(
        currentScene(world).background,
      );
      expect(locationDaylight(restored, place)).toEqual(
        locationDaylight(world, place),
      );

      world.turn = world.revision = morning + cycle - 1;
      world = housePlay(world, "wait");
      expect(backdrop(place, world)).toBe("./" + art(file));
      expect(locationDaylight(world, place).description).toBe(
        `It is day ${words}.`,
      );
    },
  );

  it("maps the occupied Tauris painting to its own night view", () => {
    const occupied = art("tauris-shore-ship-at-berth");
    const open = art("tauris-shore-scene");
    for (const turn of [0, DAYLIGHT_TURNS, DAYLIGHT_TURNS * 2]) {
      const suffix = turn === DAYLIGHT_TURNS ? "-night" : "";
      expect(daylightBackdrop({ turn }, "greek-tauris-shore", occupied)).toBe(
        art("tauris-shore-ship-at-berth" + suffix),
      );
      expect(daylightBackdrop({ turn }, "greek-tauris-shore", open)).toBe(
        art("tauris-shore-scene" + suffix),
      );
    }
  });

  it("publishes all eight native paintings and their checked display copies", () => {
    const root = new URL("../v2/card-game/", import.meta.url);
    const provenance = JSON.parse(
      readFileSync(
        new URL(
          "assets/greek-drama/house-of-blood/scene-provenance.json",
          root,
        ),
        "utf8",
      ),
    );
    const variants = JSON.parse(
      readFileSync(new URL("image-variants.json", root), "utf8"),
    );
    const published = new Set(publicAssets.map(({ file }) => file));
    expect(provenance.assets).toHaveLength(8);
    for (const source of provenance.assets) {
      const file = "assets/greek-drama/house-of-blood/" + source.file;
      const body = readFileSync(new URL(file, root));
      expect(createHash("sha256").update(body).digest("hex")).toBe(
        source.sourceSha256,
      );
      expect(body.readUInt32BE(16)).toBe(1536);
      expect(body.readUInt32BE(20)).toBe(1024);
      expect(published.has(file), file).toBe(true);
      expect(variants.images[file].sourceHash).toBe(source.sha256);
      for (const size of ["stage", "card"]) {
        const display = variants.images[file][size];
        expect(published.has(display), display).toBe(true);
        expect(
          createHash("sha256")
            .update(readFileSync(new URL(display, root)))
            .digest("hex"),
        ).toBe(variants.images[file][size + "Hash"]);
      }
    }
  });
});
