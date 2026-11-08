import { beforeAll, describe, expect, it, vi } from "vitest";
let portableLampPool;
beforeAll(async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("getComputedStyle", (el) => ({
    visibility: el.visibility || "visible",
  }));
  ({ portableLampPool } = await import("../v2/card-game/stage-light-view.mjs"));
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
