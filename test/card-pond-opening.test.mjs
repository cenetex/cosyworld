import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  places,
  plan,
  play,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
const wantPlace = (target) => ({ kind: "place", target, since: 0, refusals: 0 });
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatars, humanAvatarIds } from "../v2/card-game/human-cast.mjs";
import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { pondOpening } from "./fixtures/card-pond-opening.mjs";
import { createLandingWorld } from "../v2/card-game/pack-landing.mjs";
import { sceneCast } from "../v2/card-game/scene.mjs";

const fresh = () => enableMotives(pondOpening());
const act = (world, kind, target) => {
  const action = legalActions(world).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action, `${kind} at ${world.actors.vale.place}`).toBeDefined();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  return result.state;
};

describe("the attic opening and saved pond journeys", () => {
  it("starts new local and shared worlds alone in the dark attic", () => {
    for (const world of [
      createLandingWorld(),
      dispatchShared({ op: "create" }).world,
    ]) {
      expect(world.actors.vale.place).toBe("attic");
      expect(world.items.lamp).toMatchObject({ holder: "vale", lit: false });
      expect(world.opening).toEqual({
        version: 1,
        crossed: false,
        met: { vale: 0 },
      });
      expect(sceneCast(world)).toEqual(["vale", null]);
      expect(world.actors.moth.place).toBe("pond");
      expect(world.actors.vale.want).toMatchObject({
        kind: "item",
        target: "lamp",
      });
      expect(world.log[0]).toMatchObject({
        locationId: "attic",
        cast: ["vale"],
        light: false,
      });
      expect(decodeSave(encodeSave(world))).toEqual(world);
      for (const avatar of humanAvatars.filter((a) => a.id !== "vale"))
        expect(world.actors[avatar.id].place).toBe(avatar.home.id);
    }
  });

  it("keeps a released pond save beside Pip with Vale's authored want", () => {
    const before = pondOpening();
    const world = decodeSave(encodeSave(before));
    expect(world).toEqual(before);
    expect(world.actors.vale.place).toBe("pond");
    expect(world.opening).toEqual({
      version: 2,
      crossed: true,
      met: { vale: 0, moth: 0 },
    });
    expect(world.actors.vale.want).toMatchObject({ kind: "item", target: "lamp" });
  });

  it("meets Vale's lamp want and then the keeper through the pond and station", () => {
    let world = fresh();
    world = act(world, "light");
    expect(world.actors.vale.xp).toBe(1);
    expect(exits(world, "pond")).toEqual(["station", "attic"]);
    world = act(world, "wait");
    world = act(world, "move", "station");
    expect(world.opening.met.keeper).toBe(3);
    world = act(world, "move", "pond");
    expect(world.actors.vale.place).toBe("pond");
  });

  it("keeps the attic reflection and its dry-lamp recovery on the pond", () => {
    let world = act(fresh(), "light");
    world = act(world, "move", "attic");
    expect(exits(world, "attic")).toEqual(["pond"]);
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.cloth.holder = "pond";
    world = decodeSave(encodeSave(world));
    expect(exits(world, "attic")).toEqual(["pond"]);
    world = act(world, "move", "pond");
    world = act(world, "move", "station");
    expect(world.actors.vale.place).toBe("station");
  });

  it("prepares a carried lamp before planning a return through the mirror", () => {
    const world = fresh();
    world.actors.vale.place = "attic";
    world.actors.vale.want = wantPlace("pond");
    expect(plan(world).action.kind).toBe("light");
    const lit = play(world, plan(world).action).state;
    expect(plan(lit).action).toMatchObject({ kind: "move", target: "pond" });
  });

  it("keeps a way to the pond when the cloth opens an isolated cottage loop", () => {
    let world = act(fresh(), "light");
    world = act(world, "move", "attic");
    world.items.cloth.holder = "attic";
    world.items.lamp.fuel = 0;
    world.items.lamp.lit = false;
    world.items.oil.holder = "station";
    world = decodeSave(encodeSave(world));
    world.actors.vale.want = wantPlace("pond");
    expect(exits(world, "attic", "vale")).toContain("pond");
    if (places["forest-cottage"]) {
      expect(exits(world, "attic", "vale")).toContain("forest-cottage");
      world = act(world, "move", "forest-cottage");
      expect(plan(world).action).toMatchObject({
        kind: "move",
        target: "attic",
      });
      world = act(world, "move", "attic");
      expect(exits(world, "attic", "vale")).toContain("pond");
    }
    world = act(world, "move", "pond");
    expect(world.actors.vale.place).toBe("pond");
  });

  it("lets a stranded resident return from the attic through the pond", () => {
    const world = fresh();
    world.actors.moth.place = "attic";
    world.items.lamp.holder = "moth";
    world.items.lamp.fuel = 0;
    world.actors.moth.want = wantPlace("pond");
    expect(exits(world, "attic", "moth")).toEqual(["pond"]);
    const action = legalActions(world, "moth").find(
      (a) => a.kind === "move" && a.target === "pond",
    );
    expect(action).toBeDefined();
    const result = play(
      world,
      legalActions(world).find((a) => a.kind === "wait"),
    );
    expect(result.ok).toBe(true);
    expect(result.state.actors.moth.place).toBe("pond");
    expect(result.state.items.lamp.holder).toBe("moth");
  });

  it("gives the station one path, plus the parlour door while the card is there", () => {
    const world = dispatchShared({ op: "create" }).world;
    world.sharedVersion = 1;
    world.controlledActors = humanAvatarIds;
    world.presentActors = humanAvatarIds;
    world.items.lamp.lit = true;
    for (const avatar of humanAvatars)
      world.items[avatar.item.id].holder = "pond";
    world.items["boardyai-calling-card"].holder = "pond";
    const neighbors = [];
    for (const place of Object.keys(places)) {
      world.actors.vale.place = place;
      const roads = exits(world, place, "vale");
      if (place === "station") expect(roads).toEqual(["pond"]);
      if (roads.includes("station")) neighbors.push(place);
    }
    expect(neighbors).toEqual(["pond", "boardyai-parlour"]);
    world.items["boardyai-calling-card"].holder = "station";
    expect(exits(world, "station", "vale").sort()).toEqual(["boardyai-parlour", "pond"]);
  });

  it("preserves saved attic purposes, positions, possessions and history", () => {
    const before = atticOpening();
    before.actors.vale.place = "station";
    before.locations.attic.anchored = true;
    const restored = decodeSave(encodeSave(before));
    expect(restored).toEqual(before);
    expect(restored.actors.vale.want).toMatchObject({ kind: "item", target: "lamp" });
    expect(exits(restored, "station")).toEqual(["pond"]);
    const lit = act(restored, "light");
    const shore = act(lit, "move", "pond");
    const attic = act(shore, "move", "attic");
    expect(attic.actors.vale.xp).toBeGreaterThan(0);
    expect(attic.opening.version).toBe(1);
    expect(attic.items.lamp.holder).toBe("vale");
    expect(attic.log[0]).toEqual(before.log[0]);
  });
});
