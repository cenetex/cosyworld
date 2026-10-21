import { describe, expect, it } from "vitest";
import { createWorld, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { cardPlay } from "../v2/card-game/cards.mjs";
import { nextLesson } from "../v2/card-game/lessons.mjs";

const start = () =>
  enableMotives(createWorld({ opening: true }), { questPrograms: true });
function cards(s, ...ids) {
  const action = cardPlay(s, ids).action;
  expect(action, ids.join(" + ")).toBeTruthy();
  return play(s, action).state;
}

describe("first pairing tips", () => {
  it("says nothing until a gift, trade, or shared journey can be played", () => {
    const s = start();
    expect(nextLesson(s, new Set())).toBeNull();
    expect(nextLesson(cards(s, "lamp"), new Set())).toBeNull();
  });

  it("names a pair that plays as the lesson, gift first", () => {
    const s = cards(cards(start(), "lamp"), "pond");
    const tip = nextLesson(s, new Set());
    expect(tip).toEqual({
      kind: "give",
      cards: ["lamp", "moth"],
      text: "Pair the Lamp with Pip to give it.",
    });
    expect(cardPlay(s, tip.cards).action.kind).toBe("give");
  });

  it("moves on once a kind is learned", () => {
    const s = cards(cards(start(), "lamp"), "pond");
    const trade = nextLesson(s, new Set(["give"]));
    expect(trade.kind).toBe("trade");
    expect(trade.text).toMatch(/^Pair the .+ with the .+ to trade\.$/);
    expect(cardPlay(s, trade.cards).action.kind).toBe("trade");
    const journey = nextLesson(s, new Set(["give", "trade"]));
    expect(journey.text).toBe(
      "Pair Pip with Empty station to travel together.",
    );
    expect(cardPlay(s, journey.cards).action.kind).toBe("accompany");
    expect(nextLesson(s, new Set(["give", "trade", "accompany"]))).toBeNull();
  });
});
