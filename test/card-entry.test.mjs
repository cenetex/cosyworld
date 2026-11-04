import { describe, expect, it, vi } from "vitest";
import {
  ENTRY_MS,
  ENTRY_STAGGER_MAX_MS,
  ENTRY_STAGGER_MS,
  createCardEntries,
  createQuestEntries,
  enteringKeys,
  entryDelays,
} from "../v2/card-game/card-entry.mjs";
import { revealPlan } from "../v2/card-game/card-reveal.mjs";

const element = () => {
  const animate = vi.fn(() => ({
    finished: new Promise(() => {}),
    cancel() {},
  }));
  return { animate };
};
const cards = (...keys) => keys.map((key) => ({ key, element: element() }));
const delays = (row) =>
  row.flatMap(({ element }) =>
    element.animate.mock.calls.map(([, o]) => o.delay),
  );

describe("card entry", () => {
  it("finds the keys drawn now that were not drawn before", () => {
    expect(
      enteringKeys(new Set(["vale@", "lamp@vale"]), [
        "vale@",
        "mara@",
        "lamp@vale",
        "key@attic",
      ]),
    ).toEqual(["mara@", "key@attic"]);
    expect(enteringKeys(new Set(), ["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("staggers cards entering together, briefly", () => {
    expect(entryDelays(3)).toEqual([0, ENTRY_STAGGER_MS, 2 * ENTRY_STAGGER_MS]);
    expect(Math.max(...entryDelays(20))).toBe(ENTRY_STAGGER_MAX_MS);
  });

  it("raises new cards once and never re-animates cards already there", () => {
    const entries = createCardEntries();
    const first = cards("attic@", "vale@", "lamp@vale");
    expect([...entries.draw(first, { now: 0 })]).toEqual([
      "attic@",
      "vale@",
      "lamp@vale",
    ]);
    expect(delays(first)).toEqual([0, 70, 140]);
    // A later redraw with fresh elements: only the newcomer rises.
    const later = cards("attic@", "vale@", "lamp@vale", "mara@");
    expect([...entries.draw(later, { now: 1000 })]).toEqual(["mara@"]);
    expect(later.map((c) => c.element.animate.mock.calls.length)).toEqual([
      0, 0, 0, 1,
    ]);
    // The same element drawn again does not restart its rise.
    entries.draw(later, { now: 1010 });
    expect(later[3].element.animate).toHaveBeenCalledTimes(1);
  });

  it("carries a rise on when its card is redrawn mid-way", () => {
    const entries = createCardEntries();
    entries.draw(cards("vale@"), { now: 0 });
    const redrawn = cards("vale@");
    entries.draw(redrawn, { now: 200 });
    expect(delays(redrawn)).toEqual([-200]);
    const settled = cards("vale@");
    entries.draw(settled, { now: ENTRY_MS + 1 });
    expect(settled[0].element.animate).not.toHaveBeenCalled();
  });

  it("lets a moved or folded card keep still, and re-deals a thing that changes hands", () => {
    const entries = createCardEntries();
    entries.draw(cards("vale@", "lamp@attic"), { now: 0 });
    const moved = [
      ...cards("vale@"),
      { key: "lamp@vale", element: element(), still: true },
    ];
    expect([...entries.draw(moved, { now: 2000 })]).toEqual([]);
    const dropped = cards("vale@", "lamp@attic");
    expect([...entries.draw(dropped, { now: 4000 })]).toEqual(["lamp@attic"]);
  });

  it("just shows cards under reduced motion", () => {
    const entries = createCardEntries();
    const row = cards("vale@", "mara@");
    expect([...entries.draw(row, { now: 0, reduced: true })]).toEqual([]);
    expect(row.every((c) => !c.element.animate.mock.calls.length)).toBe(true);
  });
});

describe("quests enter face down", () => {
  it("lies face down on every entry until it turns", () => {
    const quests = createQuestEntries();
    expect(quests.show(["vale:item:lamp:0:"])).toEqual(["vale:item:lamp:0:"]);
    expect(quests.down("vale:item:lamp:0:")).toBe(true);
    expect(quests.turned("vale:item:lamp:0:")).toBe(true);
    expect(quests.down("vale:item:lamp:0:")).toBe(false);
    // Still in view: it stays face up across redraws.
    expect(quests.show(["vale:item:lamp:0:"])).toEqual([]);
    expect(quests.down("vale:item:lamp:0:")).toBe(false);
    // Folded away and opened again, it enters face down again.
    quests.show([]);
    expect(quests.show(["vale:item:lamp:0:"])).toEqual(["vale:item:lamp:0:"]);
    expect(quests.down("vale:item:lamp:0:")).toBe(true);
  });

  it("deals a quest that moves on a step face down", () => {
    const quests = createQuestEntries();
    quests.show(["vale:item:lamp:0:2"]);
    quests.turned("vale:item:lamp:0:2");
    expect(quests.show(["vale:item:lamp:0:1"])).toEqual(["vale:item:lamp:0:1"]);
    expect(quests.down("vale:item:lamp:0:1")).toBe(true);
  });

  it("turns with a crossfade and no movement under reduced motion", () => {
    expect(revealPlan("rare", { reduced: true })).toMatchObject({
      crossfade: true,
      lift: 0,
    });
  });
});
