import { describe, expect, it } from "vitest";
import {
  CLOSE_AFTER_MS,
  DISSOLVE,
  DISSOLVE_MS,
  ENTER_AFTER_MS,
  TRAVEL_LAYER,
  closeTiming,
  handedOver,
  heldFrom,
  travelFrames,
  tuckFrames,
} from "../v2/card-game/card-travel.mjs";

const entry = "vale:item:lamp:ordinary:";
const hand = [
  { id: "vale" },
  { id: "moth" },
  { id: "quest:from:moth", entry },
  { id: "station" },
];

describe("a quest becoming held", () => {
  it("comes from its offer card and keeps the selection it had", () => {
    expect(heldFrom(entry, hand, ["quest:from:moth"], "vale")).toEqual({
      id: "quest:from:moth",
      offer: true,
      handed: true,
    });
    expect(heldFrom(entry, hand, ["moth"], "vale")).toMatchObject({
      id: "quest:from:moth",
      handed: false,
    });
  });

  it("held with no offer card comes from the card last chosen", () => {
    const table = hand.filter((card) => !card.entry);
    expect(heldFrom(entry, table, ["vale", "moth"], "vale")).toEqual({
      id: "moth",
      offer: false,
      handed: false,
    });
    expect(heldFrom(entry, table, ["vale"], "vale")).toBeNull();
    expect(heldFrom(entry, table, ["lamp"], "vale")).toBeNull();
    expect(heldFrom(entry, table)).toBeNull();
  });

  it("travels from where it lay to its slot, above the stacks all the way", () => {
    const frames = travelFrames({ left: 300, top: 40 }, { left: 100, top: 50 });
    expect(frames[0].translate).toBe("200px -10px");
    expect(frames.at(-1).translate).toBe("0 0");
    expect(frames.every((frame) => frame.zIndex === TRAVEL_LAYER)).toBe(true);
    const [, mid] = frames;
    expect(mid.translate).toBe(`100px ${-5 - Math.hypot(200, 10) * 0.08}px`);
  });

  it("tucks behind its holder from where it lay", () => {
    expect(
      tuckFrames({ left: 300, top: 40 }, { left: 20, top: 50 }, { left: 100, top: 50 }),
    ).toEqual({
      start: "200px -10px",
      end: { translate: "-80px 0px", scale: "0.9" },
    });
  });
});

describe("a card changing hands", () => {
  const holders = new Map([
    ["beanie", "cottage"],
    ["lamp", "vale"],
    ["vale", undefined],
  ]);

  it("flies when its holder changed since the last look", () => {
    expect(handedOver(holders, "beanie", "vale")).toBe(true);
    expect(handedOver(holders, "lamp", "moth")).toBe(true);
    expect(handedOver(holders, "lamp", "cottage")).toBe(true);
  });

  it("only slides when it kept its holder, has none, or was not shown", () => {
    expect(handedOver(holders, "lamp", "vale")).toBe(false);
    expect(handedOver(holders, "vale", undefined)).toBe(false);
    expect(handedOver(holders, "thermos", "vale")).toBe(false);
  });
});

describe("a card dissolving", () => {
  it("fades as it sinks, and the row closes and fills only afterwards", () => {
    expect(DISSOLVE.every((frame) => !("opacity" in frame))).toBe(true);
    const timing = closeTiming(1);
    expect(timing.delay).toBe(CLOSE_AFTER_MS);
    expect(timing.enter).toBe(ENTER_AFTER_MS);
    expect(CLOSE_AFTER_MS).toBeLessThan(ENTER_AFTER_MS);
    expect(ENTER_AFTER_MS).toBeLessThan(DISSOLVE_MS);
  });

  it("holds nothing back when no card left or the scene changed", () => {
    for (const timing of [closeTiming(0), closeTiming(3, true)])
      expect(timing).toEqual({ delay: 0, duration: undefined, enter: 0 });
  });
});
