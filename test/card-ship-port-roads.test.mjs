// The ship is the quick way to a port, never the only way (#2049). Every dock
// a world can sail to has a walking way to its pack's start, so a traveler
// whose ship is called away can always walk home.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  currentActor,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  entityActive,
  packDefinitions,
  transports,
} from "../v2/card-game/pack-registry.mjs";
import { callTransport } from "../v2/card-game/pack-transport.mjs";

const ships = new Set(Object.values(transports).map((t) => t.place));
const flags = (world, ...keys) => {
  for (const key of keys) world.packs["greek-drama"].flags[key] = true;
  return world;
};
// A new world, each lasting opening, and an old full-scope world.
const stages = {
  opening: () => createWorld(),
  "open door": () => flags(createWorld(), "greek-open-door-open"),
  ajax: () => flags(createWorld(), "greek-open-door-open", "greek-ajax-open"),
  full: () =>
    createWorld({
      packScopes: Object.fromEntries(
        packDefinitions.filter((p) => p.release).map((p) => [p.id, "full"]),
      ),
    }),
};
// Old full-scope worlds keep four one-place island and far-shore stops whose
// roads retired. New and shared worlds never open them.
const FAR_SHORES = [
  "greek-lemnos",
  "greek-thrace",
  "greek-tauris",
  "greek-sicily",
];

function walkable(world, from) {
  const seen = new Set([from]);
  for (const place of seen)
    for (const to of exits(world, place, "vale"))
      if (!ships.has(to)) seen.add(to);
  return seen;
}
const start = (dock) =>
  packDefinitions.find((pack) => pack.places[dock])?.entry ?? "station";

function shipOnly(world) {
  return Object.values(transports)
    .flatMap((t) => t.docks)
    .filter((dock) => entityActive(world, dock))
    .filter((dock) => !walkable(world, dock).has(start(dock)));
}

describe("ports reachable by land", () => {
  for (const [stage, make] of Object.entries(stages))
    it(`leaves no dock ship-only: ${stage}`, () => {
      expect(shipOnly(make())).toEqual(stage === "full" ? FAR_SHORES : []);
    });

  it("walks home from Piraeus when another traveler calls the ship away", () => {
    // The #2049 strand: Vale ashore at Piraeus before Dione's invitation, the
    // ship called to the harbor and the provisions carried ashore there.
    let s = createWorld();
    s.crossings["pond-greek-harbor"].discovered = true;
    s.controlledActors = ["vale", "mara"];
    s.actors.vale.place = "greek-piraeus";
    s.transports["greek-ship"].dock = "greek-piraeus";
    s.items["greek-provisions"].holder = "greek-ship";
    callTransport(s, "greek-harbor");
    s.items["greek-provisions"].holder = "greek-harbor";
    const step = (fields) => {
      const action = legalActions(s, "vale").find((a) =>
        Object.entries(fields).every(([k, v]) => a[k] === v),
      );
      expect(action, JSON.stringify(fields)).toBeTruthy();
      const result = play(s, action, s.revision);
      expect(result.ok, result.error).toBe(true);
      s = result.state;
    };
    for (let i = 0; i < 20 && currentActor(s) === "vale"; i++)
      step({ kind: "wait" });
    // The ship stays away: the lanes and the call are unchanged.
    expect(s.transports["greek-ship"].dock).not.toBe("greek-piraeus");
    expect(exits(s, "greek-harbor", "vale")).not.toContain("greek-road-coast");
    step({ kind: "move", target: "greek-road-coast" });
    step({ kind: "move", target: "greek-harbor" });
    expect(s.actors.vale.place).toBe("greek-harbor");
  });

  it("walks home from the Trojan landing by the Northern Road", () => {
    const s = stages.ajax();
    expect(exits(s, "greek-ajax-landing", "vale")).toContain(
      "greek-road-north",
    );
    expect(walkable(s, "greek-ajax-landing").has("greek-harbor")).toBe(true);
    // The road waits for Myrto's invitation.
    expect(entityActive(stages["open door"](), "greek-road-north")).toBe(false);
  });
});
