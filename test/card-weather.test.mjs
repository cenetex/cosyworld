import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { describe, expect, it } from "vitest";
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
import { dispatchShared, load } from "../v2/card-game/shared-world.mjs";

describe("regional Greece weather", () => {
  it("covers every Greek location and keeps local scenery within its region", () => {
    const ids = Object.keys(packPlaces).filter((id) => id.startsWith("greek-"));
    expect(ids).toHaveLength(67);
    for (let turn = 0; turn < WEATHER_TURNS * 8; turn++) {
      const regions = new Map();
      for (const id of ids) {
        const weather = locationWeather({ turn }, id);
        expect(weather.condition, id).toBeTruthy();
        expect(weather.description, id).toBeUndefined();
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

  it("keeps the Willows rainy or misty, apart from the landing", () => {
    const seen = { day: new Set(), night: new Set() };
    for (let turn = 0; turn < WEATHER_TURNS * 16; turn++) {
      const phase = Math.floor(turn / (WEATHER_TURNS * 2)) % 2 ? "night" : "day";
      for (const id of ["willows-camp", "willows-thicket", "willows-bank"]) {
        const weather = locationWeather({ turn }, id);
        expect(weather.exposure, id).toBe("river");
        expect(["rain", "mist"], id).toContain(weather.condition);
        seen[phase].add(weather.condition);
      }
      expect(locationWeather({ turn }, "willows-landing")).toBeNull();
    }
    expect([...seen.day].sort()).toEqual(["mist", "rain"]);
    expect([...seen.night].sort()).toEqual(["mist", "rain"]);
  });

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
    ).toContain(`Weather: ${weather.condition}.`);
    const script = sceneScript(world);
    expect(script.current.weather).toEqual(weather);
    const beat = script.beats.findLast(
      (e) => e.locationId === "greek-courtyard",
    );
    expect(beat.weather).toEqual(weather);
  });

  it("matches shared views, browser rules, and the compiled server across regions and turns", () => {
    const runtime = currentSharedEngine();
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
        // The scene is drawn in the browser from the shared world.
        const { weather } = currentScene(load(request));
        expect(weather).toEqual(
          locationWeather(world, world.actors[actor].place),
        );
        return weather;
      });
      expect(views[0].condition).toBe(views[1].condition);
      expect(views[0].region).toBe(views[1].region);
      expect(views[0].exposure).toBe("coast");
      expect(views[1].exposure).toBe("grove");
    }
  });
});
