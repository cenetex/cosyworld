import { describe, it, expect } from "vitest";
import { createWorld, encodeSave, decodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  summonTransport,
  transportExits,
} from "../v2/card-game/pack-transport.mjs";
import { availableCards, playLabel } from "../v2/card-game/cards.mjs";
import {
  backdrop,
  locationOverlay,
  travelCard,
} from "../v2/card-game/scene.mjs";

const players = ["vale", "mara", "ash"];
function setup(dock) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  for (const id of players) s.actors[id].place = dock;
  s.actors.moth.place = "station";
  s.actors.keeper.place = "attic";
  summonTransport(s, "greek-ship", dock);
  s.crossings["pond-greek-harbor"].discovered = true;
  return s;
}
const ask = (world, actor, op = "view", extra = {}) =>
  dispatchShared({
    world,
    actor,
    op,
    claimed: players,
    present: players,
    ...extra,
  });
function move(world, actor, target) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === "move" && a.target === target,
  );
  expect(action, `${actor} can travel to ${target}`).toBeDefined();
  expect(playLabel(action)).toBe(
    target === "greek-ship" ? "Board" : "Disembark",
  );
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.world));
}

describe("shared ship boarding", () => {
  it("shares the first successful lamp signal and keeps access on later voyages", () => {
    let s = setup("greek-harbor");
    s.crossings["pond-greek-harbor"].discovered = false;
    for (const actor of players) s.actors[actor].place = "pond";
    Object.assign(s.items.lamp, { holder: "vale", lit: true, fuel: 12 });
    s.items.cloth.holder = "vale";
    for (const [kind, item] of [
      ["cover", "cloth"],
      ["take", "cloth"],
      ["cover", "cloth"],
      ["take", "cloth"],
    ]) {
      for (const actor of players)
        expect(
          ask(s, actor).actions.some((a) => a.target === "greek-ship"),
        ).toBe(false);
      const action = ask(s, "vale").actions.find(
        (a) =>
          a.kind === kind &&
          a.item === item &&
          (kind !== "cover" || a.target === "lamp"),
      );
      expect(action).toBeDefined();
      const result = ask(s, "vale", "play", { action });
      expect(result.ok, result.error).toBe(true);
      s = decodeSave(encodeSave(result.world));
    }
    expect(s.crossings["pond-greek-harbor"].discovered).toBe(true);
    for (const actor of players)
      expect(ask(s, actor).actions.some((a) => a.target === "greek-ship")).toBe(
        true,
      );
    s.items.lamp.lit = false;
    for (const target of ["greek-ship", "greek-harbor", "greek-ship", "pond"])
      s = move(s, "mara", target);
    expect(s.crossings["pond-greek-harbor"].discovered).toBe(true);
    expect(ask(s, "ash").actions.some((a) => a.target === "greek-ship")).toBe(
      true,
    );
  });

  it("uses authenticated passenger claims for an older shared voyage", () => {
    const old = setup("greek-harbor");
    old.crossings["pond-greek-harbor"].discovered = false;
    old.actors.mara.place = "greek-ship";
    old.transports["greek-ship"].destination = "pond";
    const npcOnly = ask(old, "vale", "view", {
      claimed: ["vale"],
      present: ["vale"],
    }).world;
    expect(npcOnly.crossings["pond-greek-harbor"].discovered).toBe(false);
    const humanVoyage = ask(old, "mara").world;
    expect(humanVoyage.crossings["pond-greek-harbor"].discovered).toBe(true);
    expect(humanVoyage.actors).toEqual({
      ...old.actors,
      boardyai: { ...old.actors.boardyai, place: "greek-harbor" },
    });
    expect(humanVoyage.transports).toEqual(old.transports);
  });

  it.each(["pond", "greek-harbor"])(
    "waits at %s for companions and moves on the first disembark",
    (origin) => {
      const destination = origin === "pond" ? "greek-harbor" : "pond";
      let s = setup(origin);
      s = move(s, "vale", "greek-ship");
      const shore = ask(s, "mara");
      expect(s.transports["greek-ship"].dock).toBe(origin);
      expect(availableCards(shore.world)).toContain("greek-ship");
      expect(travelCard(shore.world, "greek-ship")).toBeTruthy();
      if (origin === "greek-harbor")
        expect(backdrop(origin, shore.world)).toContain(
          "harbor-ship-at-berth.webp",
        );
      if (origin === "pond")
        expect(locationOverlay(shore.world, origin)).toBeTruthy();
      s = move(s, "mara", "greek-ship");
      const staleBoarding = ask(s, "ash").actions.find(
        (a) => a.kind === "move" && a.target === "greek-ship",
      );
      s = move(s, "vale", destination);
      expect(s.transports["greek-ship"].dock).toBe(destination);
      expect(s.actors.mara.place).toBe("greek-ship");
      expect(ask(s, "mara").exits).toContain(destination);
      expect(availableCards(ask(s, "ash").world)).not.toContain("greek-ship");
      if (origin === "greek-harbor")
        expect(backdrop(origin, ask(s, "ash").world)).toContain(
          "harbor-open-berth.webp",
        );
      expect(ask(s, "ash", "play", { action: staleBoarding }).ok).toBe(false);
      expect(availableCards(ask(s, "vale").world)).toContain("greek-ship");
      // Route search accounts for a new boarding reversing the next leg.
      expect(transportExits(s, "greek-ship", destination)).toEqual([origin]);
      s = move(s, "mara", destination);
      expect(s.actors.vale.place).toBe(destination);
      expect(s.actors.mara.place).toBe(destination);
    },
  );

  it("lets a passenger stay aboard through a return boarding and another round trip", () => {
    let s = setup("pond");
    s = move(s, "vale", "greek-ship");
    s = move(s, "mara", "greek-ship");
    s = move(s, "vale", "greek-harbor");
    const oldDisembark = ask(s, "mara").actions.find(
      (a) => a.kind === "move" && a.target === "greek-harbor",
    );
    s = move(s, "vale", "greek-ship");
    expect(s.transports["greek-ship"]).toMatchObject({
      dock: "greek-harbor",
      destination: "pond",
    });
    expect(ask(s, "mara", "play", { action: oldDisembark }).ok).toBe(false);
    s = move(s, "vale", "pond");
    expect(s.actors.mara.place).toBe("greek-ship");
    expect(availableCards(ask(s, "ash").world)).toContain("greek-ship");
    s = move(s, "ash", "greek-ship");
    s = move(s, "ash", "greek-harbor");
    s = move(s, "mara", "greek-harbor");
    expect(s.actors.vale.place).toBe("pond");
    expect(s.actors.mara.place).toBe("greek-harbor");
    expect(s.transports["greek-ship"]).toMatchObject({
      dock: "greek-harbor",
      destination: null,
    });
  });
});
