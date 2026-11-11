import { describe, expect, it, vi } from "vitest";
import {
  ENTRY_MS,
  ENTRY_STAGGER_MAX_MS,
  ENTRY_STAGGER_MS,
  createCardEntries,
  createQuestEntries,
  enteringKeys,
  entryDelays,
  questEntryKey,
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

describe("the quest is dealt face down and turns once", () => {
  const lamp = { actor: "vale", kind: "item", target: "lamp" };
  const key = questEntryKey(lamp);

  it("names a quest by whose it is, its kind and its target", () => {
    expect(key).toContain("vale:item:lamp:");
    // Progress on the same quest is the same card.
    expect(questEntryKey({ ...lamp, left: 1, index: 2 })).toBe(key);
    expect(
      questEntryKey({ actor: "vale", kind: "place", target: null }),
    ).toContain("vale:place:");
  });

  it("lies face down until seen, then turns once", () => {
    const quests = createQuestEntries();
    // Dealt into the fold: face down, nothing to turn yet.
    expect(quests.show(key, false)).toBe(false);
    expect(quests.down(key)).toBe(true);
    // Seen: due to turn, and only once however often it is drawn.
    expect(quests.show(key, true)).toBe(true);
    expect(quests.show(key, true)).toBe(false);
    expect(quests.turned(key)).toBe(true);
    expect(quests.down(key)).toBe(false);
    expect(quests.turned(key)).toBe(false);
  });

  it("stays face up across redraws, plays, folds, progress and revisions", () => {
    const quests = createQuestEntries();
    quests.show(key, true);
    quests.turned(key);
    // Hand redraws, the avatar's stack folding and opening again, and a
    // revision bump all draw the same key.
    for (const seen of [true, true, false, true, false, true, true]) {
      expect(quests.show(key, seen)).toBe(false);
      expect(quests.down(key)).toBe(false);
    }
  });

  it("deals a changed quest face down, as a new card", () => {
    const quests = createQuestEntries();
    quests.show(key, true);
    quests.turned(key);
    const other = questEntryKey({
      actor: "vale",
      kind: "person",
      target: "mara",
    });
    expect(quests.show(other, true)).toBe(true);
    expect(quests.down(other)).toBe(true);
    expect(quests.down(key)).toBe(false);
  });

  it("deals a quest again when it truly leaves and comes back", () => {
    const quests = createQuestEntries();
    quests.show(key, true);
    quests.turned(key);
    expect(quests.show(null)).toBe(false);
    expect(quests.show(key, true)).toBe(true);
    expect(quests.down(key)).toBe(true);
  });

  it("puts back a turn that finds the quest folded again", () => {
    const quests = createQuestEntries();
    expect(quests.show(key, true)).toBe(true);
    quests.unseen(key);
    expect(quests.down(key)).toBe(true);
    expect(quests.show(key, false)).toBe(false);
    expect(quests.show(key, true)).toBe(true);
  });

  it("opens a page or a new game on a quest already dealt", () => {
    const quests = createQuestEntries();
    // In view as the page opens: face up at once, no turn.
    expect(quests.show(key, true, { opening: true })).toBe(false);
    expect(quests.down(key)).toBe(false);
    // Folded away as it opens: it turns when first seen, and only then.
    const folded = createQuestEntries();
    expect(folded.show(key, false, { opening: true })).toBe(false);
    expect(folded.down(key)).toBe(true);
    expect(folded.show(key, true)).toBe(true);
  });

  it("turns with a crossfade and no movement under reduced motion", () => {
    expect(revealPlan("rare", { reduced: true })).toMatchObject({
      crossfade: true,
      lift: 0,
    });
  });
});
