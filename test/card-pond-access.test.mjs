import { newWant } from "../v2/card-game/want.mjs";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  exits,
  itemPlace,
  legalActions,
  placeText,
  play,
  reflectionOpen,
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

  it.each(["station"])(
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

describe.each([true, false])("attic access (opening: %s)", (opening) => {
  function attic() {
    const s = pond(opening);
    s.actors.vale.place = s.actors.moth.place = "attic";
    s.locations.attic.anchored = true;
    s.items.lamp.holder = "vale";
    return s;
  }

  it.each(["attic", "vale", "moth"])(
    "allows departure with a shining lamp held by %s at the attic",
    (holder) => {
      const s = attic();
      s.items.lamp.holder = holder;
      const result = play(s, cardPlay(s, ["pond"]).action);
      expect(result.ok).toBe(true);
      expect(result.state.actors.vale.place).toBe("pond");
    },
  );

  it.each(["unlit", "empty", "covered", "at the station"])(
    "closes with the lamp %s and checks saved and selected routes again",
    (condition) => {
      const s = attic();
      s.items.bell.holder = "vale";
      const stale = legalActions(s).filter(
        (a) =>
          (a.kind === "move" && a.target === "pond") ||
          (a.kind === "accompany" && a.destination === "pond"),
      );
      expect(stale.map((a) => a.kind)).toContain("accompany");
      expect(stale.some((a) => a.kind === "move" && a.item === "bell")).toBe(
        true,
      );
      if (condition === "unlit") s.items.lamp.lit = false;
      if (condition === "empty") {
        s.items.lamp.lit = false;
        s.items.lamp.fuel = 0;
      }
      if (condition === "covered") s.items.cloth.holder = "lamp";
      if (condition === "at the station") s.items.lamp.holder = "station";
      const before = encodeSave(s);
      const rescue = condition === "empty" || condition === "at the station";
      expect(exits(s, "attic").includes("pond")).toBe(rescue);
      expect(availableCards(s).includes("pond")).toBe(rescue);
      const move = cardPlay(s, ["pond"]).action;
      if (rescue) {
        expect(move.kind).toBe("move");
        expect(play(s, move).state.actors.vale.place).toBe("pond");
      } else {
        expect(move).toBeNull();
        for (const action of stale) {
          const result = play(s, action);
          expect(result.ok).toBe(false);
          expect(result.state).toBe(s);
        }
      }
      expect(encodeSave(s)).toBe(before);
      const restored = decodeSave(before);
      expect(availableCards(restored).includes("pond")).toBe(rescue);
      expect(exits(restored, "attic")).toEqual(rescue ? ["pond"] : []);
      if (opening)
        expect(placeText(restored, "attic")).toContain("Dust gathers");
    },
  );
});

describe.each([true, false])(
  "return toward light in the attic (opening: %s)",
  (opening) => {
    it.each([
      ["pond", "attic", "attic"],
      ["pond", "attic", "moth"],
    ])("opens %s to %s with the lamp held by %s", (from, to, holder) => {
      const s = pond(opening);
      s.actors.vale.place = from;
      s.actors.moth.place = to;
      s.items.lamp.holder = holder;
      expect(itemPlace(s, "lamp")).toBe(to);
      expect(exits(s, from)).toContain(to);
      expect(exits(s, to)).toContain(from);
      const restored = decodeSave(encodeSave(s));
      expect(availableCards(restored)).toContain(to);
      const result = play(restored, cardPlay(restored, [to]).action);
      expect(result.ok).toBe(true);
      expect(result.state.actors.vale.place).toBe(to);
    });
    it.each(["pond", "moth"])(
      "keeps the attic mirror dark when a distant lamp is held by %s",
      (holder) => {
        const s = pond(opening);
        s.actors.vale.place = "attic";
        s.items.lamp.holder = holder;
        expect(itemPlace(s, "lamp")).toBe("pond");
        const restored = decodeSave(encodeSave(s));
        expect(reflectionOpen(restored, "attic")).toBe(false);
        expect(reflectionOpen(restored, "pond")).toBe(true);
        expect(placeText(restored, "attic")).toContain("mirror stands dark and empty");
        // Losing the local lamp keeps the existing emergency escape, not a mirror gate.
        const rescue = cardPlay(restored, ["pond"]).action;
        expect(rescue?.text).toContain("along a narrow path");
        const result = play(restored, rescue);
        expect(result.ok).toBe(true);
        expect(result.state.actors.vale.place).toBe("pond");
      },
    );
  },
);

it("removes entry after an autonomous carrier departure in the same completed turn", () => {
  const start = pond();
  // Pip first takes the wanted lamp at the pond, then wants the station.
  const s = play(
    start,
    legalActions(start).find((a) => a.kind === "wait"),
  ).state;
  s.actors.moth.want = newWant("place", "station", s.turn);
  delete s.actors.moth.metTurn;
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
