import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import sharp from "sharp";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { locationWeather } from "../v2/card-game/weather.mjs";
import { locationDaylight } from "../v2/card-game/daylight.mjs";
import {
  backdrop,
  currentScene,
  locationVariant,
  sceneScript,
} from "../v2/card-game/scene.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const pack = packDefinitions.find((p) => p.id === "willows");
const places = Object.keys(pack.places);
function bundled() {
  const source = readFileSync(
    new URL(
      "../v2/orchestrator-rust/src/card_shared/engine.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const version = source.match(
    /const VERSION: &str = "full-card-world\/(\d+)"/,
  )[1];
  const runtime = vm.createContext({ structuredClone });
  vm.runInContext(
    readFileSync(
      new URL(
        `../v2/orchestrator-rust/src/card_shared/engine-v${version}.js`,
        import.meta.url,
      ),
      "utf8",
    ),
    runtime,
  );
  return (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
}

describe("the Willows sky and item art", () => {
  it("keeps the whole island on one saved sky through two weather cycles", () => {
    const phases = new Set(),
      conditions = new Set();
    for (let turn = 0; turn < 144; turn++) {
      const expected =
        turn % 48 < 8
          ? "dawn"
          : turn % 48 < 24
            ? "day"
            : turn % 48 < 32
              ? "dusk"
              : "night";
      for (const id of places) {
        expect(locationDaylight({ turn }, id).phase).toBe(expected);
        const weather = locationWeather({ turn }, id);
        expect(weather.region).toBe("danube");
        expect(weather.condition).toBe(
          locationWeather({ turn }, places[0]).condition,
        );
        expect(weather.description).toBeTruthy();
        expect(weather.description).not.toContain("Sea mist");
        phases.add(expected);
        conditions.add(weather.condition);
      }
    }
    expect([...phases]).toEqual(["dawn", "day", "dusk", "night"]);
    expect([...conditions].sort()).toEqual(["clear", "cloud", "mist", "rain"]);
  });

  it("changes dusk and rain on an accepted play and carries them into saves, cards, dialogue and exports", () => {
    let world = createWorld();
    world.actors.vale.place = "willows-camp";
    world.turn = world.revision = 23;
    const before = encodeSave(world);
    expect(play(world, { key: "old-choice" }).state).toBe(world);
    expect(encodeSave(world)).toBe(before);
    world = play(
      world,
      legalActions(world).find((a) => a.kind === "wait"),
    ).state;
    const scene = currentScene(world);
    expect(scene.daylight.phase).toBe("dusk");
    expect(scene.weather.condition).toBe("rain");
    expect(locationVariant(world, "willows-camp")).toBe(
      "base:rain-shelter:dusk",
    );
    expect(currentScene(decodeSave(encodeSave(world)))).toEqual(scene);
    const facts = narrativeContext(world).entities.find(
      (e) => e.id === "willows-camp",
    ).facts;
    expect(facts).toContain(scene.weather.description);
    expect(facts).toContain(scene.daylight.description);
    expect(sceneScript(world).current.weather).toEqual(scene.weather);
    expect(sceneScript(world).current.daylight).toEqual(scene.daylight);
    for (const id of places) {
      const file = backdrop(id, world).slice(2);
      expect(publicAssets.some((asset) => asset.file === file)).toBe(true);
      expect(file).toMatch(/-day\.webp$/);
    }
  });

  it("gives shared viewers and the compiled host the same local light and weather", () => {
    const ask = bundled();
    let world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    const claimed = ["vale", "mara"];
    for (const turn of [
      0, 7, 8, 11, 12, 23, 24, 31, 32, 47, 48, 60, 72, 96, 120,
    ]) {
      world.turn = world.revision = turn;
      world.actors.vale.place = "willows-camp";
      world.actors.mara.place = "willows-bank";
      const views = claimed.map((actor) => {
        const request = { op: "view", world, actor, claimed, present: claimed };
        const browser = dispatchShared(request);
        expect(ask(request)).toEqual(browser);
        expect(browser.scene.daylight).toEqual(
          locationDaylight(world, world.actors[actor].place),
        );
        return browser.scene;
      });
      expect(views[0].weather.condition).toBe(views[1].weather.condition);
      expect(views[0].daylight).toEqual(views[1].daylight);
      expect(views[0].weather.exposure).toBe("shelter");
      expect(views[1].weather.exposure).toBe("open");
    }
  });

  it("publishes eight painted cutouts with transparent margins and visible subjects", async () => {
    expect(Object.keys(pack.items)).toHaveLength(8);
    for (const item of Object.values(pack.items)) {
      expect(item.art).toMatch(/\.webp$/);
      expect(publicAssets.some((asset) => asset.file === item.art)).toBe(true);
      const { data, info } = await sharp(
        new URL(`../v2/card-game/${item.art}`, import.meta.url).pathname,
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let clear = 0,
        solid = 0;
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          const alpha = data[(y * info.width + x) * 4 + 3];
          if (alpha === 0) clear++;
          if (alpha > 200) solid++;
          if (
            x === 0 ||
            y === 0 ||
            x === info.width - 1 ||
            y === info.height - 1
          )
            expect(alpha, item.name).toBeLessThanOrEqual(1);
        }
      expect(clear / (info.width * info.height), item.name).toBeGreaterThan(
        0.2,
      );
      expect(solid / (info.width * info.height), item.name).toBeGreaterThan(
        0.02,
      );
    }
  });
});
