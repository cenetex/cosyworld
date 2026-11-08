import { beforeAll, describe, expect, it, vi } from "vitest";
let portableLampPool;
beforeAll(async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  ({ portableLampPool } = await import("../v2/card-game/stage-light-view.mjs"));
});
const rect = (left, top, width, height) => ({ left, top, width, height });
function stage({ lit = "true", covered = "false", hidden = false, width = 20 } = {}) {
  return {
    querySelector: () => ({ getBoundingClientRect: () => rect(10, 20, 400, 200) }),
    querySelectorAll: () => [{
      dataset: { lit, covered },
      closest: () => hidden,
      getBoundingClientRect: () => rect(200, 110, width, 20),
    }],
  };
}
describe("portable lamp pool", () => {
  it("centers on the visible prop in painting coordinates", () => {
    expect(portableLampPool(stage())).toMatchObject({ x: 50, y: 50, on: true, tint: "lamp" });
  });
  it.each([{lit: "false"}, {covered: "true"}, {hidden: true}, {width: 0}])("does not disclose or light hidden/unlit props %j", (options) => {
    expect(portableLampPool(stage(options))).toBeNull();
  });
});
