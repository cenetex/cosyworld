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
import { greekErrands } from "./helpers/greek-opening.mjs";

// The Theban City Gate shows its closed painting while the Gate Guard guards
// it, and its open painting when both paper fixtures allow the road.
// The route is live, not latched. Night keeps the matching closed or
// open night painting.
const art = (file) => `./assets/greek-drama/${file}.webp`;
const gate = (s) => backdrop("greek-gate", s);
const night = (s) => ({ ...s, turn: DAYLIGHT_TURNS });

describe("the Theban City Gate backdrop", () => {
  it("follows the live road as the guard's papers change hands", () => {
    const s = greekErrands().decree;
    expect(s.items["greek-decree"].holder).toBe("greek-guard");
    s.turn = 0;
    expect(gate(s)).toBe(art("city-gate-closed-day"));
    expect(gate(night(s))).toBe(art("city-gate-closed-night"));
    // Vale carrying the writ to the gate is not enough.
    s.items["greek-creon-writ"].holder = "vale";
    s.actors.vale.place = "greek-gate";
    expect(gate(s)).toBe(art("city-gate-closed-day"));
    // The guard has the Writ and no duty order: the road is open, with no latch.
    s.items["greek-creon-writ"].holder = "greek-guard";
    s.items["greek-decree"].holder = "greek-elder";
    expect(s.actors["greek-guard"].place).toBe("greek-gate");
    expect(gate(s)).toBe(art("city-gate-day"));
    expect(gate(night(s))).toBe(art("city-gate-night"));
    latchRoutes(s);
    expect(s.openedRoutes ?? []).not.toContain("greek-gate>greek-battlefield");
    // Moving the order between other holders leaves the road open.
    s.items["greek-decree"].holder = "greek-creon";
    expect(gate(s)).toBe(art("city-gate-day"));
    // The guard has his duty order but no Writ: the road closes again.
    s.items["greek-creon-writ"].holder = "greek-gate";
    s.items["greek-decree"].holder = "greek-guard";
    expect(gate(s)).toBe(art("city-gate-closed-day"));
    expect(gate(night(s))).toBe(art("city-gate-closed-night"));
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
      const s = greekErrands().decree;
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
      const s = night(greekErrands().decree);
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
