import { describe, it, expect } from "vitest";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  moveTransport,
  summonTransport,
  transportExits,
} from "../v2/card-game/pack-transport.mjs";
const people = ["vale", "mara"];
function start(dock) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(createWorld()),
  }).world;
  for (const id of people) s.actors[id].place = dock;
  s.actors.moth.place = "station";
  s.actors.keeper.place = "attic";
  summonTransport(s, "greek-ship", dock);
  s.crossings["pond-greek-harbor"].discovered = true;
  return s;
}
function move(s, actor, target) {
  const req = { world: s, actor, claimed: people, present: people };
  const view = dispatchShared({ op: "view", ...req });
  const a = view.actions.find(
    (a) => a.kind === "move" && !a.item && a.target === target,
  );
  expect(a, `${actor} can move to ${target}`).toBeDefined();
  const r = dispatchShared({ op: "play", ...req, action: a });
  expect(r.ok, r.error).toBe(true);
  return r.world;
}
function arrived(origin) {
  const dest = origin === "pond" ? "greek-harbor" : "pond";
  let s = start(origin);
  s = move(s, "vale", "greek-ship");
  s = move(s, "mara", "greek-ship");
  s = move(s, "vale", dest);
  expect(s.actors.mara.place).toBe("greek-ship");
  expect(s.transports["greek-ship"].dock).toBe(dest);
  expect(s.transports["greek-ship"].destination).toBe(dest);
  return s;
}
describe("resident boarding after arrival", () => {
  it.each(["pond", "greek-harbor"])(
    "leaves the arrived exit open after a trip from %s",
    (origin) => {
      const s = arrived(origin),
        dock = s.transports["greek-ship"].dock;
      // Isolate the resident boarding that follows the accepted human arrival.
      s.controlledActors = people;
      s.presentActors = people;
      s.actors.moth.place = "greek-ship";
      moveTransport(s, dock, "greek-ship", ["moth"]);
      expect(s.transports["greek-ship"].destination).toBe(dock);
      expect(transportExits(s, "greek-ship", null, "mara")).toContain(dock);
    },
  );
  it("lets an intentional human boarding start the next leg", () => {
    let s = arrived("pond");
    s = move(s, "vale", "greek-ship");
    expect(s.transports["greek-ship"].destination).toBe("pond");
  });
  it("lets a resident start an NPC-only voyage after the humans disembark", () => {
    let s = arrived("pond");
    s = move(s, "mara", "greek-harbor");
    s.controlledActors = people;
    s.presentActors = people;
    s.actors.moth.place = "greek-ship";
    moveTransport(s, "greek-harbor", "greek-ship", ["moth"]);
    expect(s.transports["greek-ship"].destination).toBe("pond");
  });
});
