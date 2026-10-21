import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  itemPlace,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

function pond(opening = true) {
  let s = createWorld({ opening });
  if (opening) {
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "light"),
    ).state;
    s = play(
      s,
      legalActions(s).find((a) => a.kind === "move" && a.target === "pond"),
    ).state;
  }
  s.actors.vale.place = s.actors.moth.place = "pond";
  s.items.lamp.holder = "moth";
  s.items.lamp.lit = true;
  s.items.lamp.fuel = 8;
  return s;
}

describe.each([true, false])("pond access (opening: %s)", (opening) => {
  it.each(["pond", "vale", "moth"])(
    "allows a shining lamp held by %s at the pond",
    (holder) => {
      const s = pond(opening);
      s.items.lamp.holder = holder;
      expect(itemPlace(s, "lamp")).toBe("pond");
      expect(exits(s, "pond")).toContain("attic");
      expect(availableCards(s)).toContain("attic");
      const action = cardPlay(s, ["attic"]).action;
      expect(action?.kind).toBe("move");
      const result = play(s, action);
      expect(result.ok).toBe(true);
      expect(result.state.actors.vale.place).toBe("attic");
    },
  );

  it.each(["station", "attic"])(
    "closes when the carrier leaves for %s and rejects stale choices",
    (destination) => {
      const s = pond(opening);
      s.items.bell.holder = "vale";
      const stale = legalActions(s).filter(
        (a) =>
          (a.kind === "move" && a.target === "attic") ||
          (a.kind === "accompany" && a.destination === "attic"),
      );
      expect(stale.map((a) => a.kind)).toContain("accompany");
      expect(stale.some((a) => a.kind === "move" && a.item === "bell")).toBe(
        true,
      );
      s.actors.moth.place = destination;
      expect(itemPlace(s, "lamp")).toBe(destination);
      const before = encodeSave(s);
      expect(exits(s, "pond")).not.toContain("attic");
      expect(availableCards(s)).not.toContain("attic");
      expect(cardPlay(s, ["attic"]).action).toBeNull();
      for (const action of stale) {
        const result = play(s, action, s.revision);
        expect(result.ok).toBe(false);
        expect(result.state).toBe(s);
      }
      expect(encodeSave(s)).toBe(before);
      expect(availableCards(decodeSave(before))).not.toContain("attic");
      const facts = narrativeContext(s).entities.find(
        (e) => e.id === "pond",
      ).facts;
      expect(
        facts.find((f) => f.startsWith("Paths visible now:")),
      ).not.toContain("Mirror attic");
      s.actors.moth.place = "pond";
      expect(cardPlay(s, ["attic"]).action?.kind).toBe("move");
    },
  );

  it.each(["unlit", "empty", "covered"])(
    "does not offer entry with a %s lamp, even after discovery",
    (condition) => {
      const s = pond(opening);
      if (condition === "unlit") s.items.lamp.lit = false;
      if (condition === "empty") {
        s.items.lamp.lit = false;
        s.items.lamp.fuel = 0;
      }
      if (condition === "covered") s.items.cloth.holder = "lamp";
      expect(exits(s, "pond")).not.toContain("attic");
      expect(availableCards(decodeSave(encodeSave(s)))).not.toContain("attic");
    },
  );
});

it("removes entry after an autonomous carrier departure in the same completed turn", () => {
  const start = pond();
  // Pip first completes the lamp hand at the pond, then seeks the keeper's oil.
  const s = play(
    start,
    legalActions(start).find((a) => a.kind === "wait"),
  ).state;
  const stale = cardPlay(s, ["attic"]).action;
  const result = play(
    s,
    legalActions(s).find((a) => a.kind === "wait"),
  );
  expect(result.ok).toBe(true);
  const next = result.state;
  expect(next.actors.moth.place).toBe("station");
  expect(next.items.lamp).toMatchObject({ holder: "moth", lit: true });
  expect(availableCards(next)).not.toContain("attic");
  expect(play(next, stale, next.revision).ok).toBe(false);
  expect(play(next, stale, s.revision).ok).toBe(false);
});
