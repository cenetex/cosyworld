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
import { packDefinition } from "../v2/card-game/pack-registry.mjs";

const greek = packDefinition("greek-drama");
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
const atticRoads = [
  "greek-road-athens-harbor",
  "greek-road-athens-piraeus",
  "greek-road-athens-colonus",
  "greek-road-athens-eleusis",
  "greek-road-athens-marathon",
  "greek-road-piraeus-eleusis",
  "greek-road-colonus-eleusis",
  "greek-road-colonus-marathon",
];
function wait(world) {
  const result = play(
    world,
    legalActions(world).find((action) => action.kind === "wait"),
  );
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

describe("day and night in Greece", () => {
  it("gives released places and painted Trojan shores a night painting on the saved world clock", () => {
    let world = createWorld({ packScopes: { "greek-drama": "full" } });
    world.actors.vale.place = "greek-courtyard";
    const places = [
      ...greek.release.places,
      "greek-aulis",
      "greek-troy",
      "greek-trojan-camp",
      "greek-troy-beach",
      "greek-lemnos",
      "greek-thrace",
    ];
    const day = new Map(places.map((place) => [place, backdrop(place, world)]));
    for (const place of places)
      expect(locationDaylight(world, place)?.phase, place).toBe("day");
    world.turn = world.revision = DAYLIGHT_TURNS - 1;
    world = wait(world);
    const restored = decodeSave(encodeSave(world));
    for (const place of places) {
      expect(locationDaylight(world, place)?.phase, place).toBe("night");
      expect(night(world, place), place).toBe(true);
      expect(backdrop(place, world), place).not.toBe(day.get(place));
      expect(backdrop(place, restored), place).toBe(backdrop(place, world));
    }
    world.turn = world.revision = DAYLIGHT_TURNS * 2 - 1;
    world = wait(world);
    for (const place of places) {
      expect(locationDaylight(world, place)?.phase, place).toBe("day");
      expect(backdrop(place, world), place).toBe(day.get(place));
    }
  });

  it.each([
    ["greek-athens", "athens-grand-agora", "in the Athenian Agora"],
    ["greek-colonus", "open-door-colonus", "in Colonus Grove"],
    ["greek-eleusis", "open-door-eleusis", "at the Eleusinian Sanctuary"],
    ["greek-marathon", "open-door-marathon", "at Marathon Altar"],
    ["greek-ship", "ship-deck", "aboard the Greek ship"],
  ])(
    "gives %s its own night painting and place facts",
    (place, file, where) => {
      const world = createWorld({ packScopes: { "greek-drama": "full" } });
      world.actors.vale.place = place;
      expect(backdrop(place, world)).toBe(`./assets/greek-drama/${file}.webp`);
      world.turn = world.revision = DAYLIGHT_TURNS;
      const scene = currentScene(world);
      expect(scene.background).toBe(`./assets/greek-drama/${file}-night.webp`);
      expect(scene.daylight.description).toBe(`It is night ${where}.`);
      expect(locationVariant(world, place)).toMatch(/:night$/);
      expect(
        narrativeContext(world).entities.find((entity) => entity.id === place)
          .facts,
      ).toContain(`It is night ${where}.`);
    },
  );

  it.each(atticRoads)(
    "keeps both approach cards and the scene for %s in the same light",
    (road) => {
      const world = createWorld({ packScopes: { "greek-drama": "full" } });
      for (const turn of [0, DAYLIGHT_TURNS, DAYLIGHT_TURNS * 2]) {
        world.turn = world.revision = turn;
        const phase = turn === DAYLIGHT_TURNS ? "night" : "day";
        const suffix = phase === "night" ? "-night" : "";
        const painting = `./assets/greek-drama/attic-road${suffix}.webp`;
        for (const from of greek.places[road].road) {
          world.actors.vale.place = from;
          expect(travelCard(world, road).art).toBe(painting);
        }
        world.actors.vale.place = road;
        const scene = currentScene(world);
        expect(scene.background).toBe(painting);
        expect(scene.daylight.description).toBe(
          `It is ${phase} on the Attic roads.`,
        );
      }
    },
  );

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

  it("keeps the unpainted Argive sanctuary on its current backdrop", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    const place = "greek-argos-sanctuary";
    const day = backdrop(place, world);
    world.turn = world.revision = DAYLIGHT_TURNS;
    expect(locationDaylight(world, place)).toBeNull();
    expect(backdrop(place, world)).toBe(day);
  });

  it("gives the Trojan camp's local places a shared day and night", () => {
    const world = createWorld({ packScopes: { "greek-drama": "full" } });
    for (const place of [
      "greek-greek-camp",
      "greek-ajax-landing",
      "greek-ajax-household",
      "greek-ajax-grave",
    ]) {
      world.turn = world.revision = 0;
      expect(backdrop(place, world)).toBe(
        "./assets/greek-drama/ajax-camp-day.webp",
      );
      world.turn = world.revision = DAYLIGHT_TURNS;
      expect(backdrop(place, world)).toBe(
        "./assets/greek-drama/ajax-camp-night.webp",
      );
      expect(locationDaylight(world, place).description).toBe(
        "It is night at the Greek camp near Troy.",
      );
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

describe("Willows night paintings", () => {
  it("shows the ship at the landing only in dark mist at Black Pond, and the lit camp at night", () => {
    const at = (turn, dock = "pond", phase = "docked") => ({
      turn,
      transports: { "greek-ship": { dock, phase } },
    });
    const night = at(DAYLIGHT_TURNS);
    const day = at(0);
    // Night and Boeotian mist at the ship's rail: turns 120-131 of every 144,
    // and only while the ship lies at Black Pond.
    const darkMist = at(120);
    const mistyDay = at(48);
    expect(backdrop("willows-landing", day)).toBe(
      "./assets/willows/landing.webp",
    );
    for (const clock of [
      night,
      mistyDay,
      at(132),
      at(120, "greek-harbor"),
      at(120, "pond", "sea"),
    ])
      expect(backdrop("willows-landing", clock)).toBe(
        "./assets/willows/landing.webp",
      );
    expect(backdrop("willows-landing", darkMist)).toBe(
      "./assets/willows/landing-ship-night.webp",
    );
    expect(backdrop("willows-camp", night)).toBe(
      "./assets/willows/camp-lit-night.webp",
    );
    expect(locationDaylight(night, "willows-camp").description).toBe(
      "It is night on the Danube island.",
    );
    expect(locationDaylight(night, "willows-thicket")).toBeNull();
    expect(backdrop("willows-bank", night)).toBe("./assets/willows/bank.webp");
  });
});
