import { describe, it, expect } from "vitest";
import { createWorld, encodeSave, decodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  summonTransport,
  transportExits,
} from "../v2/card-game/pack-transport.mjs";
import { availableCards, playLabel } from "../v2/card-game/cards.mjs";
import { locationOverlay, travelCard } from "../v2/card-game/scene.mjs";

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
