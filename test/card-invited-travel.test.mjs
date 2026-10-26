import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
  exits,
} from "../v2/card-game/world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
function carriage(friendly = true) {
  const s = createWorld();
  s.sharedVersion = 1;
  s.controlledActors = [...humanAvatarIds];
  s.presentActors = [...humanAvatarIds];
  s.playerActorId = "rue";
  s.actors.rue.place = s.actors.moth.place = "station";
  s.items.routes.holder = "rue";
  s.actors.moth.trust.rue = friendly ? 1 : 0;
  return s;
}
const invite = (s) =>
  legalActions(s, "rue").find(
    (a) =>
      a.kind === "accompany" &&
      a.target === "moth" &&
      a.destination === "train",
  );
describe("invited companion travel", () => {
  it("carries the door token with Rue and Pip in one agreed trip and retains the visited place", () => {
    const start = carriage();
    const action = invite(start);
    expect(action).toBeDefined();
    const result = play(start, action, start.revision, "rue");
    expect(result.ok).toBe(true);
    const s = result.state;
    expect(s.actors.rue.place).toBe("train");
    expect(s.actors.moth.place).toBe("train");
    expect(s.items.routes.holder).toBe("rue");
    expect(s.invitedPlaces).toEqual({ moth: ["train"] });
    expect(s.log.filter((e) => e.verb === "accompany")).toHaveLength(1);
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(true);
    expect(decodeSave(encodeSave(s))).toEqual(s);
    expect(start.invitedPlaces).toBeUndefined();
    expect(exits(s, "station", "moth")).not.toContain("train");
    const bad = structuredClone(s);
    bad.invitedPlaces.moth.push("missing-room");
    expect(() => encodeSave(bad)).toThrow();
  });
  it("keeps a refused invitation in the current room without adding visited places", () => {
    const start = carriage(false);
    const s = play(start, invite(start), start.revision, "rue").state;
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(false);
    expect(s.actors.rue.place).toBe("station");
    expect(s.actors.moth.place).toBe("station");
    expect(s.invitedPlaces).toBeUndefined();
  });
  it("requires the current token route, room capacity and human authority", () => {
    const start = carriage(),
      action = invite(start);
    const closed = structuredClone(start);
    closed.items.routes.holder = "train";
    expect(invite(closed)).toBeUndefined();
    expect(play(closed, action, closed.revision, "rue").ok).toBe(false);
    expect(closed.invitedPlaces).toBeUndefined();
    expect(play(start, action, start.revision - 1, "rue").ok).toBe(false);
    const full = structuredClone(start);
    for (const actor of ["vale", "mara", "ash", "nell"])
      full.actors[actor].place = "train";
    expect(invite(full)).toBeUndefined();
    start.actors.mara.place = "station";
    expect(
      legalActions(start, "rue").some(
        (a) => a.kind === "accompany" && a.target === "mara",
      ),
    ).toBe(false);
  });
});
