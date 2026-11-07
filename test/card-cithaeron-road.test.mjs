import "./helpers/still-cast.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { sailTo } from "./helpers/voyage.mjs";
import { greekTravelTargets } from "./helpers/greek-travel.mjs";

const GATE = "greek-gate",
  ROAD = "greek-cithaeron",
  COURT = "greek-courtyard";
const reload = (s) => decodeSave(encodeSave(s));
function start(place) {
  const s = createWorld();
  s.actors.vale.place = place;
  s.crossings["pond-greek-harbor"].discovered = true;
  return reload(s);
}
function act(s, kind, fields = {}) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind &&
      Object.entries(fields).every(([key, value]) => a[key] === value),
  );
  expect(
    action,
    `${kind} ${JSON.stringify(fields)} at ${s.actors.vale.place}`,
  ).toBeTruthy();
  const done = play(s, action);
  expect(done.ok, done.error).toBe(true);
  return done.state;
}
const walk = (s, ...places) =>
  places.reduce(
    (w, target) =>
      greekTravelTargets(w.actors.vale.place, target).reduce(
        (world, target) => act(world, "move", { target }),
        w,
      ),
    s,
  );

describe("the road outside the City Gate", () => {
  it.each([COURT, "greek-battlefield"])(
    "lets a traveller leave from %s while city entry is guarded",
    (place) => {
      let s = walk(start(place), GATE);
      expect(s.actors["greek-guard"].guarding).toBe(COURT);
      expect(exits(s, GATE, "vale")).not.toContain(COURT);
      expect(exits(s, COURT, "vale")).toContain(GATE);
      expect(exits(s, GATE, "vale")).toEqual(
        expect.arrayContaining([ROAD, "greek-battlefield"]),
      );
      s = walk(s, ROAD, "greek-eleusis");
      expect(s.packs["greek-drama"].flags["greek-open-door-open"]).toBe(true);
      expect(reload(s)).toEqual(s);
    },
  );

  it("repairs the old road knowledge while keeping people and items in place", () => {
    const old = start(ROAD);
    old.packs["greek-drama"].revision = 22;
    old.items["greek-water-jar"].holder = ROAD;
    old.routeKnowledge.vale = [["greek-battlefield", ROAD]];
    old.actors["greek-guard"].guarding = "greek-battlefield";
    const s = decodeSave(JSON.stringify(old));
    expect(s.actors.vale.place).toBe(ROAD);
    expect(s.items["greek-water-jar"].holder).toBe(ROAD);
    expect(s.routeKnowledge.vale).toEqual(
      expect.arrayContaining([
        ["greek-battlefield", GATE],
        [GATE, ROAD],
      ]),
    );
    expect(s.actors["greek-guard"].guarding).toBe(COURT);
    expect(reload(s)).toEqual(s);
  });

  it("reaches Athens from the guarded gate and returns to Thebes by ship", () => {
    let s = walk(start(COURT), GATE, ROAD, "greek-eleusis");
    s = act(s, "take", { item: "greek-burial-petition" });
    s = walk(s, "greek-athens");
    s = act(s, "give", {
      item: "greek-burial-petition",
      target: "greek-theseus",
    });
    s = walk(s, "greek-piraeus");
    for (
      let i = 0;
      i < 12 && !exits(s, "greek-piraeus", "vale").includes("greek-ship");
      i++
    )
      s = act(s, "wait");
    s = walk(s, "greek-ship");
    s = sailTo(s, "greek-harbor");
    s = walk(s, COURT);
    expect(s.actors.vale.place).toBe(COURT);
    expect(s.actors["greek-guard"].guarding).toBe(COURT);
    expect(reload(s)).toEqual(s);
  });
});
