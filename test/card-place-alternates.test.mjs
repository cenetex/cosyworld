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

  it("shows each Willows sign's painting in its own light", () => {
    const world = createWorld();
    const flags = world.packs.willows.flags;
    const art = (name) => `./assets/willows/${name}.webp`;
    const at = (w) =>
      ["willows-camp", "willows-thicket", "willows-bank"].map((id) =>
        backdrop(id, w),
      );
    flags["willows-hollows-seen"] = true;
    flags["willows-humming-heard"] = true;
    expect(at(world)).toEqual([
      before.day["willows-camp"],
      art("thicket-hollows"),
      art("bank-humming"),
    ]);
    expect(at(night(world))).toEqual([
      art("camp-lit-night"),
      art("thicket-night"),
      art("bank-night"),
    ]);
    flags["willows-willows-nearer"] = true;
    flags["willows-shapes-seen"] = true;
    flags["willows-mark-seen"] = true;
    expect(at(night(world))).toEqual([
      art("camp-closer"),
      art("thicket-bronze"),
      art("bank-drowned"),
    ]);
    expect(backdrop("willows-bank", world)).toBe(art("bank-roots"));
    flags["willows-patterings-heard"] = true;
    expect(backdrop("willows-camp", night(world))).toBe(
      art("camp-tent-pressure"),
    );
  });
});
