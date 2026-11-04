import { describe, expect, it } from "vitest";
import { BEAT_MS } from "../v2/card-game/combat-beats.mjs";
import {
  RECEDE_MS,
  backdropHolds,
  recedeBackdrop,
} from "../v2/card-game/combat-backdrop.mjs";

const fakeStage = () => {
  const props = {};
  return {
    dataset: {},
    props,
    style: { setProperty: (name, value) => (props[name] = value) },
  };
};

describe("the backdrop recedes behind a fight", () => {
  it("falls back over a beat's telegraph and returns as a slower fade", () => {
    const stage = fakeStage();
    expect(RECEDE_MS.in).toBe(BEAT_MS.telegraph);
    expect(RECEDE_MS.out).toBeGreaterThan(RECEDE_MS.in);
    expect(recedeBackdrop(stage, "beats", true)).toBe(true);
    expect(stage.dataset.recede).toBe("true");
    expect(stage.props["--recede-ms"]).toBe(`${RECEDE_MS.in}ms`);
    expect(recedeBackdrop(stage, "beats", false)).toBe(false);
    expect(stage.dataset.recede).toBeUndefined();
    expect(stage.props["--recede-ms"]).toBe(`${RECEDE_MS.out}ms`);
  });

  it("stays back while any hold remains, and returns once none does", () => {
    const stage = fakeStage();
    recedeBackdrop(stage, "standoff", true);
    recedeBackdrop(stage, "beats", true);
    // The beats end inside an open standoff: the room stays back.
    expect(recedeBackdrop(stage, "beats", false)).toBe(true);
    expect(stage.dataset.recede).toBe("true");
    expect(backdropHolds(stage)).toEqual(["standoff"]);
    // A repeated hold changes nothing.
    stage.props["--recede-ms"] = "kept";
    recedeBackdrop(stage, "standoff", true);
    expect(stage.props["--recede-ms"]).toBe("kept");
    expect(recedeBackdrop(stage, "standoff", false)).toBe(false);
    expect(stage.dataset.recede).toBeUndefined();
  });

  it("returns at once under the loss screen's black", () => {
    const stage = fakeStage();
    recedeBackdrop(stage, "beats", true);
    recedeBackdrop(stage, "beats", false, { instant: true });
    expect(stage.dataset.recede).toBeUndefined();
    expect(stage.props["--recede-ms"]).toBe("0ms");
  });

  it("does nothing without a stage", () => {
    expect(recedeBackdrop(null, "beats", true)).toBe(false);
  });
});
