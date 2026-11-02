import { describe, expect, it } from "vitest";
import { DAYLIGHT_TURNS, locationDaylight } from "../v2/card-game/daylight.mjs";
import { backdrop } from "../v2/card-game/scene.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import {
  hub,
  latchRoutes,
  packDefinitions,
  packPlaces,
} from "../v2/card-game/pack-registry.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";

// The Theban City Gate shows its closed painting until the Gate Guard has held
// the Burial Decree at the gate, which opens the battlefield road for good.
// Night keeps the matching closed or open night painting.
const art = (file) => `./assets/greek-drama/${file}.webp`;
const gate = (s) => backdrop("greek-gate", s);
const night = (s) => ({ ...s, turn: DAYLIGHT_TURNS });

describe("the Theban City Gate backdrop", () => {
  it("is closed until the guard has held the decree at the gate", () => {
    const s = openingFixture("burial").decree;
    expect(s.items["greek-decree"].holder).toBe("greek-palace");
    s.turn = 0;
    expect(gate(s)).toBe(art("city-gate-closed-day"));
    expect(gate(night(s))).toBe(art("city-gate-closed-night"));
    // Vale carrying the decree to the gate is not enough.
    s.items["greek-decree"].holder = "vale";
    s.actors.vale.place = "greek-gate";
    expect(gate(s)).toBe(art("city-gate-closed-day"));
    // The guard holds it at his post: the gate opens, day and night.
    s.items["greek-decree"].holder = "greek-guard";
    expect(s.actors["greek-guard"].place).toBe("greek-gate");
    expect(gate(s)).toBe(art("city-gate-closed-day"));
    latchRoutes(s);
    expect(gate(s)).toBe(art("city-gate-day"));
    expect(gate(night(s))).toBe(art("city-gate-night"));
    // He leaves his post with it, or gives it away: it stays open.
    const away = structuredClone(s);
    away.actors["greek-guard"].place = "greek-well";
    expect(gate(away)).toBe(art("city-gate-day"));
    s.items["greek-decree"].holder = "greek-elder";
    expect(gate(s)).toBe(art("city-gate-day"));
  });

  it("validates state backdrops like poses", () => {
    const mounted = packDefinitions.flatMap((p) => Object.keys(p.places));
    const pack = structuredClone(
      packDefinitions.find((p) => p.id === "greek-drama"),
    );
    expect(packProblems(pack, hub, mounted)).toEqual([]);
    pack.places["greek-gate"].backdrops[0].requires = [
      {
        kind: "any",
        conditions: [
          { kind: "weather", place: "greek-ship", condition: "mist" },
          { kind: "ship_at", transport: "greek-ship", dock: "@sea" },
        ],
      },
    ];
    expect(packProblems(pack, hub, mounted)).toEqual([]);
    pack.places["greek-gate"].backdrops = [{ backdrop: "elsewhere.webp" }];
    expect(packProblems(pack, hub, mounted).join(" ")).toMatch(
      /greek-gate backdrops need/,
    );
  });

  it("keeps an explicit night sign instead of replacing it with ordinary night", () => {
    const place = packPlaces["willows-camp"];
    const previous = place.backdrops;
    try {
      place.backdrops = [
        {
          backdrop: "assets/willows/camp-lit-night-uncanny.webp",
          requires: [{ kind: "daylight", phase: "night" }],
        },
      ];
      const s = openingFixture("burial").decree;
      expect(backdrop("willows-camp", night(s))).toBe(
        "./assets/willows/camp-lit-night-uncanny.webp",
      );
      expect(backdrop("willows-camp", { ...s, turn: 0 })).toBe(
        "./assets/willows/camp.webp",
      );
    } finally {
      if (previous === undefined) delete place.backdrops;
      else place.backdrops = previous;
    }
  });

  it("recognizes authored lighting without revealing an unseen night sign", () => {
    const place = packPlaces["willows-thicket"];
    const previous = place.backdrops;
    try {
      place.backdrops = [
        {
          backdrop: "assets/willows/thicket-night.webp",
          requires: [
            { kind: "any", conditions: [{ kind: "daylight", phase: "night" }] },
            { kind: "flag", key: "willows-shapes-seen", value: true },
          ],
        },
      ];
      const s = night(openingFixture("burial").decree);
      expect(locationDaylight(s, "willows-thicket")).toMatchObject({
        phase: "night",
        description: "It is night at Willow Thicket.",
      });
      expect(backdrop("willows-thicket", s)).toBe(
        "./assets/willows/thicket.webp",
      );
      s.packs.willows.flags["willows-shapes-seen"] = true;
      expect(backdrop("willows-thicket", s)).toBe(
        "./assets/willows/thicket-night.webp",
      );
      expect(locationDaylight({ ...s, turn: 0 }, "willows-thicket").phase).toBe(
        "day",
      );
    } finally {
      if (previous === undefined) delete place.backdrops;
      else place.backdrops = previous;
    }
  });
});
