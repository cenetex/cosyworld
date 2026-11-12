// The sea route and the land route to Athens are alternatives. Burying
// Polynices is its own story and gates neither: a traveler who sails to
// Piraeus with the Travel Provisions on deck walks the Long Walls to Athens.
import { describe, expect, it } from "vitest";
import {
  createWorld,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
import { sailTo } from "./helpers/voyage.mjs";

const WALLS = "greek-road-athens-piraeus";
const step = (world, kind, fields) => {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  if (!action) throw new Error(`No ${kind} ${JSON.stringify(fields)}`);
  const result = play(world, action, world.revision);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

describe("Piraeus to Athens needs no burial", () => {
  it("walks from the quay to the Agora by sea, with the burial undone", () => {
    const pack = packDefinition("greek-drama");
    const world = createWorld();
    world.crossings["pond-greek-harbor"].discovered = true;
    const flags = world.packs["greek-drama"].flags;
    expect(flags["greek-burial-performed"]).toBeFalsy();
    expect(flags["greek-open-door-open"]).toBeFalsy();
    // Aboard the Charybdis at the harbor with the provisions on deck.
    world.actors.vale.place = "greek-ship";
    world.transports["greek-ship"].dock = "greek-harbor";
    stowProvisions(world, "greek-ship");
    let s = sailTo(world, "greek-piraeus", { actor: "vale" });
    expect(s.actors.vale.place).toBe("greek-piraeus");
    expect(exits(s, "greek-piraeus", "vale")).toContain(WALLS);
    s = step(s, "move", { target: WALLS });
    expect(exits(s, WALLS, "vale")).toContain("greek-athens");
    s = step(s, "move", { target: "greek-athens" });
    expect(s.actors.vale.place).toBe("greek-athens");
    expect(s.packs["greek-drama"].flags["greek-burial-performed"]).toBeFalsy();
    // Neither end of the Walls waits on the land gate, the herald or a burial.
    const seals = pack.routes.filter((r) => r.to === WALLS);
    expect(seals.every((r) => !r.requires?.length)).toBe(true);
  });
});
