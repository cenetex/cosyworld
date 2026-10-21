import { describe, it, expect } from "vitest";
import { createWorld, legalActions, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { turnReceipt, witnessed } from "../v2/card-game/scene.mjs";

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

describe("turn receipts", () => {
  it("gives every turn a plain account before any words arrive", () => {
    let s = enableMotives(createWorld({ opening: true }), {
      questPrograms: true,
    });
    for (let turn = 0; turn < 6; turn++) {
      const action = legalActions(s).find((a) => a.kind === "wait");
      s = play(s, action).state;
      expect(s.log.some((e) => e.generated && e.turn === s.turn)).toBe(false);
      expect(turnReceipt(s).length, `turn ${s.turn}`).toBeGreaterThan(0);
    }
  });

  it("marks a cast trade Vale watched as an item changing hands", () => {
    const s = stationTrade();
    const receipt = turnReceipt(s);
    const trade = receipt.find((entry) => entry.moved);
    expect(trade.text).toMatch(
      /^Pip trades the Black cloth for .*Oil flask\.$/,
    );
    expect(receipt.filter((entry) => entry.moved)).toHaveLength(1);
    // The keeper's departure is seen from where it started.
    expect(receipt.map((entry) => entry.text)).toContain(
      "The keeper goes to Black pond.",
    );
  });

  it("leaves out what happened where Vale was not", () => {
    let s = stationTrade();
    s = act(s, "wait");
    const elsewhere = s.log.filter(
      (e) => e.turn === s.turn && !e.generated && !witnessed(e),
    );
    expect(elsewhere.length).toBeGreaterThan(0);
    for (const entry of elsewhere) expect(entry.cast).not.toContain("vale");
    expect(turnReceipt(s).map((e) => e.seq)).not.toEqual(
      expect.arrayContaining(elsewhere.map((e) => e.seq)),
    );
  });

  it("never treats generated words as the world's account", () => {
    const s = stationTrade();
    const line = { ...s.log.at(-1), generated: true, kind: "dialogue" };
    expect(witnessed(line)).toBe(false);
  });
});
