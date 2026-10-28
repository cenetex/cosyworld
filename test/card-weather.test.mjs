import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { locationWeather, WEATHER_TURNS } from "../v2/card-game/weather.mjs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  currentScene,
  locationVariant,
  sceneScript,
} from "../v2/card-game/scene.mjs";
import { packPlaces } from "../v2/card-game/pack-registry.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

describe("regional Greece weather", () => {
  it("covers every Greek location and keeps local scenery within its region", () => {
    const ids = Object.keys(packPlaces).filter((id) => id.startsWith("greek-"));
    expect(ids).toEqual(
      expect.arrayContaining([
        "greek-harbor",
        "greek-aulis",
        "greek-susa-road",
        "greek-book-iv-helen-landing",
        "greek-comedy-wealth-healing-porch",
        "greek-vii-crag-camp",
        "greek-ares-hill",
      ]),
    );
    for (let turn = 0; turn < WEATHER_TURNS * 8; turn++) {
      const regions = new Map();
      for (const id of ids) {
        const weather = locationWeather({ turn }, id);
        expect(weather, id).toBeTruthy();
        expect(weather.description, id).toBeTruthy();
        const previous = regions.get(weather.region);
        if (previous) expect(weather.condition, id).toBe(previous.condition);
        regions.set(weather.region, weather);
      }
    }
    const world = { turn: WEATHER_TURNS * 2 };
    const coast = locationWeather(world, "greek-harbor");
    const court = locationWeather(world, "greek-courtyard");
    const grove = locationWeather(world, "greek-sanctuary");
    expect(coast.condition).toBe("rain");
    expect(new Set([coast.variant, court.variant, grove.variant]).size).toBe(3);
    expect(locationWeather(world, "greek-athens").condition).toBe("cloud");
    expect(locationWeather(world, "greek-thinkery").exposure).toBe("shelter");
    expect(locationWeather(world, "greek-underworld")).toMatchObject({
      condition: "mist",
      exposure: "underground",
    });
    expect(locationWeather(world, "pond")).toBeNull();
  });

  it.each([
    ["greek-danaid-refuge-court", "argolid", "court", "greek-argos-sanctuary"],
    ["greek-heracles-theban-house", "boeotia", "shelter", "greek-courtyard"],
    ["greek-heracles-athens-road", "attica", "open", "greek-athens"],
    ["greek-heracles-athens-guest-room", "attica", "shelter", "greek-athens"],
    ["greek-trachis-canae-approach", "thessaly", "open", "greek-trachis"],
  ])(
    "maps the Book II location %s to its region and exposure",
    (id, region, exposure, neighbor) => {
      for (const period of [0, 1, 2, 3, 4, 5, 6]) {
        const world = { turn: period * WEATHER_TURNS };
        const weather = locationWeather(world, id);
        expect(weather).toMatchObject({ region, exposure, period });
        expect(weather.condition).toBe(
          locationWeather(world, neighbor).condition,
        );
        expect(weather.variant).toBe(`${weather.condition}-${exposure}`);
        expect(weather.description).toBeTruthy();
      }
    },
  );

  it("holds through a weather period and advances on an accepted play", () => {
    let world = createWorld();
    world.actors.vale.place = "greek-courtyard";
    world.turn = WEATHER_TURNS - 1;
    world.revision = world.turn;
    expect(currentScene(world).weather.condition).toBe("clear");
    const before = encodeSave(world);
    expect(play(world, { key: "stale-weather-play" }).state).toBe(world);
    expect(encodeSave(world)).toBe(before);
    const wait = legalActions(world).find((a) => a.kind === "wait");
    world = play(world, wait).state;
    expect(currentScene(world).weather.condition).toBe("cloud");
    expect(currentScene(decodeSave(encodeSave(world))).weather).toEqual(
      currentScene(world).weather,
    );
    expect(locationVariant(world, "greek-courtyard")).toBe("base:cloud-court");
    const context = narrativeContext(world);
    const weather = currentScene(world).weather;
    expect(
      context.entities.find((e) => e.id === "greek-courtyard").facts,
    ).toContain(weather.description);
    const script = sceneScript(world);
    expect(script.current.weather).toEqual(weather);
    const beat = script.beats.findLast(
      (e) => e.locationId === "greek-courtyard",
    );
    expect(beat.weather).toEqual(weather);
  });

  it("matches shared views, browser rules, and the compiled server across regions and turns", () => {
    const version = readFileSync(
      new URL(
        "../v2/orchestrator-rust/src/card_shared/engine.rs",
        import.meta.url,
      ),
      "utf8",
    ).match(/const VERSION: &str = "full-card-world\/(\d+)"/)[1];
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
    const ask = (request) =>
      JSON.parse(runtime.cardShared(JSON.stringify(request)));
    const world = dispatchShared({
      op: "create",
      save: encodeSave(createWorld()),
    }).world;
    world.packs["greek-drama"].scope = "full";
    const claimed = ["vale", "mara"];
    for (const turn of [0, 11, 12, 23, 24, 36, 48, 60, 72]) {
      world.turn = turn;
      world.revision = turn;
      world.actors.vale.place = "greek-harbor";
      world.actors.mara.place = "greek-sanctuary";
      const views = claimed.map((actor) => {
        const request = { op: "view", world, actor, claimed, present: claimed };
        const browser = dispatchShared(request);
        expect(ask(request)).toEqual(browser);
        expect(browser.scene.weather).toEqual(
          locationWeather(world, world.actors[actor].place),
        );
        return browser.scene.weather;
      });
      expect(views[0].condition).toBe(views[1].condition);
      expect(views[0].region).toBe(views[1].region);
      expect(views[0].exposure).toBe("coast");
      expect(views[1].exposure).toBe("grove");
    }
  });
});
