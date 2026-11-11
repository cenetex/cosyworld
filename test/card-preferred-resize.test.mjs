import { afterEach, expect, it, vi } from "vitest";
import { createPreferredLocationsView } from "../v2/card-game/preferred-locations-view.mjs";

afterEach(() => vi.unstubAllGlobals());
it("reclamps an expanding awake portrait and releases departed figures", () => {
  let pending, resize;
  const observed = new Set();
  vi.stubGlobal("requestAnimationFrame", (fn) => {
    pending = fn;
    return 1;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn) {
        resize = fn;
      }
      observe(el) {
        observed.add(el);
      }
      unobserve(el) {
        observed.delete(el);
      }
    },
  );
  const box = {
    top: 0,
    bottom: 900,
    left: 0,
    right: 1000,
    width: 1000,
    height: 900,
  };
  const element = (rect) => ({
    style: { setProperty() {}, getPropertyValue: () => "0.5" },
    getBoundingClientRect: () => rect,
  });
  const stage = element(box),
    art = element(box),
    cast = element(box);
  const dock = element({ top: 800, left: 0, right: 1000 });
  vi.stubGlobal("document", { querySelector: () => dock });
  let height = 200;
  const figure = {
    parentElement: cast,
    dataset: { avatar: "greek-baker" },
    style: {},
    getBoundingClientRect: () => ({ height, width: (height * 2) / 3 }),
  };
  cast.children = [figure];
  const show = createPreferredLocationsView(stage, art, cast);
  show([{ id: "greek-baker", paintedSpot: [50, 40, 1] }]);
  pending();
  const oldBottom = parseFloat(figure.style.bottom);
  height = 600;
  expect(box.bottom - oldBottom - height).toBeLessThan(0);
  expect(observed.has(figure)).toBe(true);
  resize();
  pending();
  expect(
    box.bottom - parseFloat(figure.style.bottom) - height,
  ).toBeGreaterThanOrEqual(0);
  figure.parentElement = null;
  cast.children = [];
  show([]);
  expect(observed.has(figure)).toBe(false);
});
