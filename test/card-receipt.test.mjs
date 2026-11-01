import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { describe, it, expect } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { witnessed } from "../v2/card-game/scene.mjs";

function act(s, kind, target) {
  const action = legalActions(s).find(
    (a) =>
      a.kind === kind && (!target || a.target === target || a.item === target),
  );
  expect(action, `${kind} ${target ?? ""}`).toBeTruthy();
  return play(s, action).state;
}
// At the station Pip wants the keeper's oil and the keeper wants Pip's
// cloth. Pip asks, then trades on a cast turn, then sets off for the pond.
function stationTrade() {
  let s = enableMotives(createWorld());
  for (const id of ["vale", "moth", "keeper"]) s.actors[id].place = "station";
  s.items.cloth.holder = "moth";
  s.items.oil.holder = "keeper";
  s.items.lamp.holder = "attic";
  s.actors.moth.want = { kind: "item", target: "oil", since: 0, refusals: 0 };
  s.actors.keeper.want = { kind: "item", target: "cloth", since: 0, refusals: 0 };
  for (let i = 0; i < 4; i++) {
    s = act(s, "wait");
    if (s.log.some((e) => e.verb === "trade")) break;
  }
  // Then Pip, rested, sets off for the pond.
  delete s.actors.moth.metTurn;
  s.actors.moth.want = { kind: "place", target: "pond", since: s.turn, refusals: 0 };
  return act(s, "wait");
}
describe("witnessed History events", () => {
  it("keeps a visible event for every turn before generated words arrive", () => {
    let s = enableMotives(atticOpening());
    for (let turn = 0; turn < 6; turn++) {
      const action = legalActions(s).find((a) => a.kind === "wait");
      s = play(s, action).state;
      expect(s.log.some((e) => e.generated && e.turn === s.turn)).toBe(false);
      expect(
        s.log.some((entry) => entry.turn === s.turn && witnessed(entry)),
        `turn ${s.turn}`,
      ).toBe(true);
    }
  });

  it("includes a cast trade and departure Vale watched", () => {
    const s = stationTrade();
    const trade = s.log.find((entry) => entry.verb === "trade");
    expect(trade.text).toMatch(
      /^Pip trades the Black cloth for .*Oil flask\.$/,
    );
    expect(witnessed(trade)).toBe(true);
    // Pip's departure is seen from where it started.
    const departure = s.log.findLast(
      (entry) => entry.actorId === "moth" && entry.verb === "move",
    );
    expect(departure.text).toBe("Pip goes to Black pond.");
    expect(departure.cast).not.toContain("vale");
    expect(witnessed(departure)).toBe(true);
  });

  it("hides offscreen events from History while preserving the world log", () => {
    const s = stationTrade();
    const savedLog = structuredClone(s.log);
    const elsewhere = s.log.filter(
      (entry) =>
        entry.turn === s.turn &&
        entry.locationId !== s.actors.vale.place &&
        entry.kind === "narration",
    );
    // Pip reaching the pond is a want met out of Vale's sight.
    expect(elsewhere.map((entry) => entry.verb)).toContain("want_met");
    const visible = s.log.filter(witnessed);
    for (const entry of elsewhere) {
      expect(entry.cast).not.toContain("vale");
      expect(visible).not.toContain(entry);
    }
    expect(s.log).toEqual(savedLog);
  });

  it("never treats generated words as the world's account", () => {
    const s = stationTrade();
    const line = { ...s.log.at(-1), generated: true, kind: "dialogue" };
    expect(witnessed(line)).toBe(false);
  });
});
