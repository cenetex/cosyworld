import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  encodeSave,
  decodeSave,
  reflectionOpen,
} from "../v2/card-game/world.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
function cards(s, ...ids) {
  const { action } = cardPlay(s, ids);
  expect(action, ids.join(" + ")).toBeTruthy();
  const result = play(s, action, s.revision);
  expect(result.ok).toBe(true);
  expect(result.state.turn).toBe(s.turn + 1);
  return result.state;
}
describe("playing the world through cards", () => {
  it("offers reachable items, local avatars, exits and the current place", () => {
    let s = createWorld();
    expect(availableCards(s)).toEqual([
      "station",
      "lamp",
      "bell",
      "vale",
      "pond",
    ]);
    s = cards(s, "lamp");
    expect(availableCards(s)).toContain("moth");
    expect(availableCards(s)).toContain("keeper");
    s = cards(s, "lamp");
    s = cards(s, "pond");
    s = cards(s, "attic");
    expect(availableCards(s)).toEqual([
      "attic", "vale", "lamp", "moth", "cloth", "keeper", "oil", "bell", "pond",
    ]);
  });
  it("previews single cards and pairs freely, then spends one turn per play", () => {
    const s = createWorld(),
      before = encodeSave(s);
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("take");
    expect(cardPlay(s, ["pond"]).action.kind).toBe("move");
    expect(cardPlay(s, ["attic"]).action).toBeNull();
    expect(cardPlay(s, ["station"]).action.kind).toBe("wait");
    expect(cardPlay(s, ["lamp", "bell"]).action).toBeFalsy();
    expect(cardPlay(s, ["oil"]).action).toBeFalsy();
    expect(cardPlay(s, ["lamp", "attic", "station"]).action).toBeFalsy();
    expect(encodeSave(s)).toBe(before);
    expect(cards(s, "lamp").items.lamp.holder).toBe("vale");
  });
  it("plays a route using light, oil, a reflected path, and a cloth", () => {
    const start = createWorld();
    start.items.oil.holder = "vale";
    start.items.cloth.holder = "vale";
    let s = cards(start, "lamp");
    s = cards(s, "lamp");
    s = cards(s, "pond");
    s = cards(s, "lamp", "attic");
    expect(reflectionOpen(s)).toBe(true);
    s = cards(s, "oil", "lamp");
    expect(s.items.oil.doses).toBe(2);
    expect(s.items.lamp.fuel).toBe(8);
    s = cards(s, "pond");
    expect(s.actors.vale.crossed).toBe(2);
    s = cards(s, "cloth", "lamp");
    expect(s.items.cloth.holder).toBe("lamp");
    expect(reflectionOpen(s)).toBe(false);
    s = cards(s, "cloth");
    expect(s.items.cloth.holder).toBe("vale");
    expect(reflectionOpen(s)).toBe(true);
    s = cards(s, "lamp");
    expect(s.items.lamp.lit).toBe(false);
    expect(decodeSave(encodeSave(s))).toEqual(s);
  });
  it("talks and gives through avatar cards while the cast pursues its goals", () => {
    let s = cards(createWorld(), "lamp");
    s = cards(s, "moth");
    expect(s.log.some((e) => e.verb === "talk" && e.targetId === "moth")).toBe(
      true,
    );
    s = cards(s, "lamp", "moth");
    expect(s.items.lamp.holder).toBe("moth");
    expect(s.items.lamp.lit).toBe(true);
    s = cards(s, "station");
    expect(s.actors.moth.place).toBe("pond");
    expect(s.actors.vale.place).toBe("station");
  });
  it("lets a current-place card put down a carried item", () => {
    let s = createWorld();
    s.items.bell.holder = "vale";
    s = cards(s, "bell", "station");
    expect(s.items.bell.holder).toBe("station");
    expect(cardPlay(s, ["bell", "pond"]).action).toBeFalsy();
  });
  it("uses a lamp or bell lying here when paired with the current place", () => {
    let s = createWorld();
    expect(s.items.bell.holder).toBe("station");
    expect(cardPlay(s, ["bell"]).action.kind).toBe("take");
    s = cards(s, "bell", "station");
    expect(s.items.bell).toMatchObject({ holder: "station", ringing: 3 });
    s.items.lamp.holder = "station";
    expect(cardPlay(s, ["station", "lamp"]).action.kind).toBe("light");
    cards(s, "station", "lamp");
    s.items.lamp.lit = true;
    expect(cardPlay(s, ["lamp", "station"]).action.kind).toBe("snuff");
    cards(s, "lamp", "station");
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("take");
  });
  it("rings a carried bell and covers it with a cloth", () => {
    const start = createWorld();
    start.items.cloth.holder = "pond";
    let s = cards(start, "bell");
    s = cards(s, "bell");
    expect(s.items.bell.ringing).toBe(3);
    expect(s.actors.keeper.place).toBe("station");
    s = cards(s, "pond");
    s = cards(s, "bell", "cloth");
    expect(s.items.bell.ringing).toBe(0);
    expect(s.items.cloth.holder).toBe("bell");
    expect(cardPlay(s, ["bell"]).action).toBeFalsy();
  });
  it("honors the owner's answer and carrying space for card handovers", () => {
    let s = createWorld();
    s.actors.moth.place = "station";
    s.items.lamp.holder = "moth";
    expect(cardPlay(s, ["lamp"]).action.kind).toBe("ask");
    s = cards(s, "lamp", "moth");
    expect(s.items.lamp.holder).toBe("moth");
    s = createWorld();
    s.actors.keeper.place = "station";
    s.items.bell.holder = "keeper";
    s = cards(s, "oil");
    expect(s.items.oil.holder).toBe("vale");
    s.items.bell.holder = "vale";
    s.items.lamp.holder = "vale";
    s.items.oil.holder = "vale";
    s.items.cloth.holder = "station";
    expect(cardPlay(s, ["cloth"]).action).toBeFalsy();
    expect(cardPlay(s, ["cloth", "lamp"]).action).toBeFalsy();
    expect(cardPlay(s, ["oil", "keeper"]).action).toBeFalsy();
  });
});
