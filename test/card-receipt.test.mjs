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
// Vale gives Pip the lamp, they meet the keeper at the station, and Pip
// trades the cloth for the keeper's oil on a cast turn.
function stationTrade() {
  let s = enableMotives(createWorld({ opening: true }), {
    questPrograms: true,
  });
  for (const [kind, target] of [
    ["light"],
    ["move", "pond"],
    ["give", "lamp"],
    ["wait"],
    ["move", "station"],
    ["wait"],
    ["wait"],
  ])
    s = act(s, kind, target);
  return s;
}

describe("witnessed History events", () => {
  it("keeps a visible event for every turn before generated words arrive", () => {
    let s = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
    });
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
    const trade = s.log.findLast((entry) => entry.verb === "trade");
    expect(trade.text).toMatch(
      /^Pip trades the Black cloth for .*Oil flask\.$/,
    );
    expect(witnessed(trade)).toBe(true);
    // The keeper's departure is seen from where it started.
    const departure = s.log.findLast(
      (entry) => entry.actorId === "keeper" && entry.verb === "move",
    );
    expect(departure.text).toBe("The keeper goes to Black pond.");
    expect(departure.cast).not.toContain("vale");
    expect(witnessed(departure)).toBe(true);
  });

  it("hides offscreen events from History while preserving the world log", () => {
    let s = stationTrade();
    s = act(s, "wait");
    const savedLog = structuredClone(s.log);
    const elsewhere = s.log.filter(
      (entry) =>
        entry.turn === s.turn &&
        entry.locationId !== s.actors.vale.place &&
        ["narration", "quest"].includes(entry.kind),
    );
    expect(elsewhere.map((entry) => entry.kind)).toEqual(["narration", "quest"]);
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
