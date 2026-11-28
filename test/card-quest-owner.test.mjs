import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { recordOf } from "../v2/card-game/world/arcana-record.mjs";
import { newWant } from "../v2/card-game/want.mjs";
import { act as playOne, reload } from "./helpers/play.mjs";

const act = (s, pick) => reload(playOne(s, pick));
const talk = (s) => act(s, (a) => a.kind === "talk" && a.target === "moth");
const give = (s) =>
  act(s, (a) => a.kind === "give" && a.item === "lamp" && a.target === "moth");
const met = (s, turn = s.turn) =>
  s.log.filter((e) => e.verb === "want_met" && e.turn === turn);
function lampWanted() {
  const s = createWorld();
  for (const id of ["vale", "moth"]) s.actors[id].place = "station";
  s.items.lamp.holder = "vale";
  s.actors.moth.want = newWant("item", "lamp", s.turn);
  return s;
}

describe("a resident's card completed by a player", () => {
  it("names its owner and counts toward the Listener's call without Accept", () => {
    const s = give(talk(lampWanted()));
    expect(met(s)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorId: "moth", ownerId: "moth" }),
        expect.objectContaining({ actorId: "vale", ownerId: "moth" }),
      ]),
    );
    expect(recordOf(s, "vale")).toMatchObject({ calls: 1, callers: ["moth"] });
    expect(s.actors.moth.trust.vale).toBeGreaterThan(0);
  });

  it("completes for its owner alone when the player never learned it", () => {
    const s = give(lampWanted());
    expect(met(s).map((e) => [e.actorId, e.ownerId])).toEqual([["moth", "moth"]]);
    expect(recordOf(s, "vale").calls).toBe(0);
  });

  it("completes a taken copy once, with its owner's card", () => {
    let s = talk(lampWanted());
    s = act(s, (a) => a.kind === "accept" && a.target === "moth");
    s = give(s);
    expect(met(s).filter((e) => e.actorId === "vale")).toEqual([
      expect.objectContaining({ ownerId: "moth" }),
    ]);
    expect(recordOf(s, "vale")).toMatchObject({ calls: 1, callers: ["moth"] });
  });
});
