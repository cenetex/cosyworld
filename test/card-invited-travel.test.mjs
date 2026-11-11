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
  s.actors.moth.trust.rue = friendly ? 2 : 1;
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
  it("does not take Pip where only a player could walk home (rules 133)", () => {
    // The train door answers only to a player: Pip, taken in, could never
    // walk out again, so he declines and nothing moves.
    const start = carriage();
    const action = invite(start);
    expect(action).toBeDefined();
    const s = play(start, action, start.revision, "rue").state;
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(false);
    expect(s.actors.rue.place).toBe("station");
    expect(s.actors.moth.place).toBe("station");
    expect(s.actors.rue.companion).toBeUndefined();
    expect(s.invitedPlaces).toBeUndefined();
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("keeps a refused invitation in the current room without adding visited places", () => {
    const start = carriage(false);
    const s = play(start, invite(start), start.revision, "rue").state;
    expect(s.log.findLast((e) => e.verb === "accompany").accepted).toBe(false);
    expect(s.actors.rue.place).toBe("station");
    expect(s.actors.moth.place).toBe("station");
    expect(s.invitedPlaces).toBeUndefined();
  });
  it("boards and lands a whole invited party through one saved ship trip", () => {
    let s = carriage();
    s.actors.rue.place = s.actors.moth.place = "pond";
    s.items.lamp.holder = "rue";
    s.actors.moth.trust.rue = 2;
    s.transports["greek-ship"].dock = "pond";
    s.crossings["pond-greek-harbor"].discovered = true;
    for (const destination of ["greek-ship", "greek-harbor"]) {
      if (destination === "greek-harbor") {
        // Rue sets the course; the party rides one round at sea.
        for (const kind of ["course", "wait"])
          s = play(
            s,
            legalActions(s, "rue").find((a) => a.kind === kind),
            s.revision,
            "rue",
          ).state;
        expect(s.transports["greek-ship"]).toMatchObject({
          phase: "arrived",
          dock: "greek-harbor",
          riders: ["moth", "rue"],
        });
      }
      // Once Pip is aboard with Rue he is her companion: the landing is a
      // plain move and he comes too (rules 133).
      const action = legalActions(s, "rue").find((a) =>
        destination === "greek-ship"
          ? a.kind === "accompany" &&
            a.target === "moth" &&
            a.destination === destination
          : a.kind === "move" && a.target === destination && !a.item,
      );
      expect(action).toBeDefined();
      s = play(s, action, s.revision, "rue").state;
      expect(s.actors.rue.place).toBe(destination);
      expect(s.actors.moth.place).toBe(destination);
      expect(decodeSave(encodeSave(s))).toEqual(s);
      if (destination === "greek-ship")
        expect(s.transports["greek-ship"]).toMatchObject({
          version: 3,
          phase: "docked",
          dock: "pond",
          destination: null,
          recall: null,
        });
    }
    expect(s.transports["greek-ship"]).toMatchObject({
      version: 3,
      phase: "docked",
      dock: "greek-harbor",
      destination: null,
      riders: [],
      recall: null,
    });
    expect(s.actors.rue.crossed).toBe(2);
    expect(s.actors.moth.crossed).toBe(2);
    expect(s.invitedPlaces.moth).toEqual(["greek-harbor", "greek-ship"]);
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
    start.actors.mara.place = "pond";
    expect(
      legalActions(start, "rue").some(
        (a) => a.kind === "accompany" && a.target === "mara",
      ),
    ).toBe(false);
  });
});
