import { describe, expect, it } from "vitest";
import {
  createWorld,
  play,
  encodeSave,
  decodeSave,
  reflectionOpen,
} from "../v2/card-game/world.mjs";
import { availableCards, cardPlay } from "../v2/card-game/cards.mjs";
import { endStandoff } from "./helpers/standoff.mjs";
function cards(s, ...ids) {
  s = endStandoff(s);
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
      "vale",
      "station",
      // The Hoppy Cat spool lies here while the keeper's oil is at the pond.
      "hoppycat-red-thread-spool",
      "lamp",
      "bell",
      "pond",
    ]);
    s = cards(s, "lamp");
    expect(availableCards(s)).toContain("moth");
    expect(availableCards(s)).toContain("keeper");
    s = cards(s, "lamp");
    s = cards(s, "pond");
    s = cards(s, "attic");
    // The lit attic holds only itself: Pip cannot follow the lamp through
    // the pond's dark mirror, and the attic mirror stays shut (#1600).
    expect(availableCards(s)).toEqual(["vale", "lamp", "attic"]);
    s = cards(s, "lamp");
    expect(availableCards(s)).toContain("pond");
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
    expect(reflectionOpen(s)).toBe(false);
    s = cards(s, "lamp");
    expect(reflectionOpen(s)).toBe(true);
    // The flask has no pour play; it waits until the lamp runs dry.
    expect(cardPlay(s, ["oil", "lamp"]).action).toBeFalsy();
    expect(s.items.oil.holder).toBe("vale");
    s = cards(s, "pond");
    expect(s.actors.vale.crossed).toBe(2);
    expect(reflectionOpen(s)).toBe(false);
    s = cards(s, "lamp");
    expect(reflectionOpen(s)).toBe(true);
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
    const xp = s.actors.moth.xp;
    s = cards(s, "lamp", "moth");
    expect(s.items.lamp.holder).toBe("moth");
    // The lamp is Pip's want: Pip meets it and trusts the giver.
    expect(s.actors.moth.xp).toBeGreaterThan(xp);
    expect(s.actors.moth.trust.vale).toBe(1);
    s = cards(s, "station");
    // Met away from home, Pip heads home to the pond.
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
    // The keeper hands over the lamp it values little.
    s = createWorld();
    s.actors.keeper.place = "station";
    s.items.lamp.holder = "keeper";
    s = cards(s, "lamp");
    expect(s.items.lamp.holder).toBe("vale");
    s.actors.moth.place = "station";
    s.items.bell.holder = "vale";
    s.items.lamp.holder = "vale";
    s.items.oil.holder = "vale";
    s.items.cloth.holder = "station";
    expect(cardPlay(s, ["cloth"]).action).toBeFalsy();
    expect(cardPlay(s, ["cloth", "lamp"]).action).toBeFalsy();
    // Give is always offered. Pip's refusal of the bell costs the turn.
    expect(cardPlay(s, ["bell", "moth"]).action.kind).toBe("give");
    s = cards(s, "bell", "moth");
    expect(s.items.bell.holder).toBe("vale");
    expect(s.log.findLast((e) => e.verb === "give")).toMatchObject({
      accepted: false,
      reason: "wants-something-else",
    });
  });
});
