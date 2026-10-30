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
function playKind(world, actor, kind, target, label) {
  const action = ask(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action, `${actor} can ${kind} ${target ?? ""}`).toBeDefined();
  if (label) expect(playLabel(action)).toBe(label);
  const result = ask(world, actor, "play", { action });
  expect(result.ok, result.error).toBe(true);
  return decodeSave(encodeSave(result.world));
}
const move = (world, actor, target) =>
  playKind(
    world,
    actor,
    "move",
    target,
    target === "greek-ship" ? "Board" : "Disembark",
  );
const course = (world, actor, target) =>
  playKind(world, actor, "course", target, "Set course");
const wait = (world, actor) => playKind(world, actor, "wait");
// A whole voyage for one passenger: course, a round at sea, Disembark.
const sail = (world, actor, target) =>
  move(wait(course(world, actor, target), actor), actor, target);

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
    s = move(s, "mara", "greek-ship");
    s = sail(s, "mara", "greek-harbor");
    s = move(s, "mara", "greek-ship");
    s = sail(s, "mara", "pond");
    expect(s.crossings["pond-greek-harbor"].discovered).toBe(true);
    expect(ask(s, "ash").actions.some((a) => a.target === "greek-ship")).toBe(
      true,
    );
  });

  it("uses authenticated passenger claims for an older shared voyage", () => {
    const old = ask(setup("greek-harbor"), "vale").world;
    old.crossings["pond-greek-harbor"].discovered = false;
    old.actors.mara.place = "greek-ship";
    const npcOnly = ask(old, "vale", "view", {
      claimed: ["vale"],
      present: ["vale"],
    }).world;
    expect(npcOnly.crossings["pond-greek-harbor"].discovered).toBe(false);
    const humanVoyage = ask(old, "mara").world;
    expect(humanVoyage.crossings["pond-greek-harbor"].discovered).toBe(true);
    expect(humanVoyage.actors).toEqual(old.actors);
    expect(humanVoyage.transports).toEqual(old.transports);
  });

  it.each(["pond", "greek-harbor"])(
    "waits at %s for companions, sails one round and stays where the first passenger lands",
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
      // Mara's course card goes stale once Vale sets the course.
      const staleCourse = ask(s, "mara").actions.find(
        (a) => a.kind === "course",
      );
      s = course(s, "vale", destination);
      expect(s.transports["greek-ship"].phase).toBe("sea");
      expect(ask(s, "mara", "play", { action: staleCourse }).ok).toBe(false);
      // At sea the ship has left the shore.
      expect(availableCards(ask(s, "ash").world)).not.toContain("greek-ship");
      if (origin === "greek-harbor")
        expect(backdrop(origin, ask(s, "ash").world)).toContain(
          "harbor-open-berth.webp",
        );
      expect(ask(s, "ash", "play", { action: staleBoarding }).ok).toBe(false);
      s = wait(s, "mara");
      s = move(s, "vale", destination);
      expect(s.transports["greek-ship"].dock).toBe(destination);
      expect(s.actors.mara.place).toBe("greek-ship");
      expect(ask(s, "mara").exits).toContain(destination);
      expect(availableCards(ask(s, "vale").world)).toContain("greek-ship");
      // Route search through a new boarding plans the next voyage.
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
    s = sail(s, "vale", "greek-harbor");
    const oldDisembark = ask(s, "mara").actions.find(
      (a) => a.kind === "move" && a.target === "greek-harbor",
    );
    s = move(s, "vale", "greek-ship");
    // A new boarder cannot step straight back ashore.
    expect(
      ask(s, "vale").actions.some(
        (a) => a.kind === "move" && a.target === "greek-harbor",
      ),
    ).toBe(false);
    s = course(s, "vale", "pond");
    expect(ask(s, "mara", "play", { action: oldDisembark }).ok).toBe(false);
    s = wait(s, "vale");
    s = move(s, "vale", "pond");
    expect(s.actors.mara.place).toBe("greek-ship");
    expect(availableCards(ask(s, "ash").world)).toContain("greek-ship");
    s = move(s, "ash", "greek-ship");
    s = course(s, "ash", "greek-harbor");
    s = wait(s, "ash");
    s = move(s, "mara", "greek-harbor");
    expect(s.actors.vale.place).toBe("pond");
    expect(s.actors.mara.place).toBe("greek-harbor");
    expect(s.transports["greek-ship"]).toMatchObject({
      phase: "arrived",
      dock: "greek-harbor",
      destination: null,
      riders: ["ash"],
    });
  });
});
