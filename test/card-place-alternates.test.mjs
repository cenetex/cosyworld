import { describe, expect, it } from "vitest";
import { createWorld, places } from "../v2/card-game/world.mjs";
import { backdrop } from "../v2/card-game/scene.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
import before from "./fixtures/place-backdrops.json" with { type: "json" };

// Every place's painting in a new world by day and by night, before any
// alternate painting was wired (#1622). Alternates may only change the
// places and states listed here.
const paintings = (world) =>
  Object.fromEntries(
    Object.keys(places)
      .sort()
      .map((id) => [id, backdrop(id, world)]),
  );
const night = (world) => ({ ...world, turn: DAYLIGHT_TURNS });

describe("alternate place paintings", () => {
  it("shows today's painting everywhere no alternate condition holds", () => {
    expect(paintings(createWorld())).toEqual(before.day);
    expect(paintings(night(createWorld()))).toEqual({
      ...before.night,
      "willows-landing": "./assets/willows/landing-night.webp",
      "willows-thicket": "./assets/willows/thicket-night.webp",
      "willows-bank": "./assets/willows/bank-night.webp",
    });
  });

  it("shows the open Agora once the Open Door story has returned to Dione", () => {
    const world = createWorld();
    world.packs["greek-drama"].flags["greek-open-door-returned"] = true;
    expect(backdrop("greek-athens", world)).toBe(
      "./assets/greek-drama/open-door-agora.webp",
    );
    expect(backdrop("greek-athens", night(world))).toBe(
      before.night["greek-athens"],
    );
  });
});
