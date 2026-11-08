import { beforeAll, describe, expect, it, vi } from "vitest";
let portableLampPool, renderStageLight, stageLight;
beforeAll(async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("getComputedStyle", (el) => ({
    visibility: el.visibility || "visible",
  }));
  ({ portableLampPool, renderStageLight, stageLight } = await import(
    "../v2/card-game/stage-light-view.mjs"
  ));
});
const rect = (left, top, width, height) => ({ left, top, width, height });
function stage({
  lit = "true",
  covered = "false",
  hidden = false,
  width = 20,
  visibility = "visible",
} = {}) {
  return {
    querySelector: (selector) => {
      expect(selector).toBe(".stage-figures");
      return { getBoundingClientRect: () => rect(10, 20, 400, 200) };
    },
    querySelectorAll: () => [
      {
        dataset: { lit, covered },
        visibility,
        closest: () => hidden,
        getBoundingClientRect: () => rect(200, 110, width, 20),
      },
    ],
  };
}
describe("portable lamp pool", () => {
  it("centers on the visible prop in painting coordinates", () => {
    expect(portableLampPool(stage())).toMatchObject({
      x: 50,
      y: 50,
      on: true,
      tint: "lamp",
    });
  });
  it("uses the cropped painting frame rather than the viewport-sized backdrop", () => {
    const shown = stage();
    shown.querySelector = (selector) => ({
      getBoundingClientRect: () =>
        selector === ".stage-figures"
          ? rect(-200, 0, 800, 400)
          : rect(0, 0, 400, 200),
    });
    expect(portableLampPool(shown)).toMatchObject({ x: 51.25, y: 30 });
  });
  it.each([
    { lit: "false" },
    { covered: "true" },
    { hidden: true },
    { width: 0 },
    { visibility: "hidden" },
  ])("does not disclose or light hidden/unlit props %j", (options) => {
    expect(portableLampPool(stage(options))).toBeNull();
  });
});

it("moves a pool without cutting an active time-of-day ease", () => {
  let clock = 0,
    sequence = 0,
    changed;
  const frames = new Map();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("document", { hidden: false, documentElement: {} });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback) {
        changed = callback;
      }
      observe() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id) => frames.delete(id));
  const tick = () => {
    clock += 16;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  };
  const shown = stage();
  const lamp = shown.querySelectorAll()[0];
  let x = 200;
  lamp.getBoundingClientRect = () => rect(x, 110, 20, 20);
  shown.querySelectorAll = () => [lamp];
  shown.style = { setProperty() {} };
  shown.dataset = {};
  renderStageLight(shown, { turn: 20, lamp: true, ease: false });
  renderStageLight(shown, { turn: 24, lamp: true, ease: true });
  tick();
  const before = stageLight(shown).hour;
  x += 2;
  changed();
  tick();
  expect(stageLight(shown).hour).toBeGreaterThanOrEqual(before);
  expect(stageLight(shown).hour).toBeLessThan(18);
  expect(stageLight(shown).pools[0].x).toBe(portableLampPool(shown).x);
  for (let i = 0; i < 260; i++) tick();
  expect(stageLight(shown).hour).toBe(18);
  expect(frames.size).toBe(0);
  vi.restoreAllMocks();
});
