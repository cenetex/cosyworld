import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { backdrop, placeBackdrop, stageOf } from "../v2/card-game/scene.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";
import catalogue from "../v2/card-game/sign-art.json" with { type: "json" };
import images from "../v2/card-game/image-variants.json" with { type: "json" };

const file = (name) => `assets/willows/${name}.webp`;
// Exercise pending assets without claiming their files are published on main.
const published = { ...images.images };
for (const { signs } of Object.values(catalogue))
  for (const art of Object.values(signs))
    for (const path of Object.values(art)) published[path] = { stage: path };
const clock = (world, turn) => Object.assign(world, { turn, revision: turn });
const at = (place, turn = 0) => {
  const world = clock(createWorld(), turn);
  world.actors.vale.place = `willows-${place}`;
  return world;
};
function discover(world, id) {
  const choiceId = `willows-${id}`;
  // Named choices now; the Observe conversion preserves the same receipts.
  for (let i = 0; i < 12 && !world.packs.willows.receipts[choiceId]; i++) {
    const actions = legalActions(world);
    const action =
      actions.find((a) => a.choiceId === choiceId) ||
      actions.find((a) => a.kind === "wait");
    const result = play(world, action);
    expect(result.ok, result.error).toBe(true);
    world = result.state;
  }
  expect(world.packs.willows.receipts[choiceId]).toBeGreaterThan(0);
  return world;
}
const painting = (world, place) =>
  placeBackdrop(world, `willows-${place}`, published);

describe("newest recorded sign paintings", () => {
  it.each([
    ["landing", "examine-hull", 0, "landing-uncanny"],
    ["landing", "watch-otter", 0, "landing-otter"],
    ["landing", "watch-boatman", 0, "landing-boatman"],
    ["camp", "listen-tent", 24, "camp-tent-pressure"],
    ["thicket", "examine-hollows", 0, "thicket-hollows"],
    ["thicket", "look-up-willows", 24, "thicket-bronze"],
    ["bank", "hear-humming", 0, "bank-humming"],
    ["bank", "look-beneath-roots", 0, "bank-roots"],
    ["bank", "look-beneath-roots", 24, "bank-drowned"],
  ])(
    "holds %s/%s after its receipt and reload",
    (place, sign, turn, target) => {
      const before = at(place, turn);
      expect(painting(before, place)).not.toBe(file(target));
      const world = discover(before, sign);
      const saved = encodeSave(world);
      const restored = decodeSave(saved);
      expect(restored).not.toBeNull();
      expect(painting(restored, place)).toBe(file(target));
      expect(encodeSave(restored)).toBe(saved); // Rendering never writes state.
    },
  );

  it("chooses numeric order before phase or availability, including base-only signs", () => {
    let world = discover(
      clock(discover(at("camp"), "pace-willows"), 24),
      "pace-again",
    );
    expect(painting(world, "camp")).toBe(file("camp-closer"));
    expect(painting(clock(world, 48), "camp")).toBe(file("camp"));
    expect(painting(clock(world, 72), "camp")).toBe(file("camp-closer"));
    world = discover(world, "listen-tent");
    world.packs.willows.receipts = Object.fromEntries(
      Object.entries(world.packs.willows.receipts).reverse(),
    );
    for (const lit of [false, true]) {
      world.items.lamp.holder = "vale";
      world.items.lamp.lit = lit;
      expect(painting(world, "camp")).toBe(file("camp-tent-pressure"));
    }
    const missing = { ...published };
    delete missing[file("camp-tent-pressure")];
    expect(placeBackdrop(world, "willows-camp", missing)).toBe(
      file("camp-lit-night"),
    );
    missing[file("camp-tent-pressure")] = {};
    expect(placeBackdrop(world, "willows-camp", missing)).toBe(
      file("camp-lit-night"),
    );
    expect(stageOf(world, "willows-camp").focus).toEqual({ x: 82, y: 50 });
    world = discover(world, "count-stores");
    expect(painting(decodeSave(encodeSave(world)), "camp")).toBe(
      file("camp-lit-night"),
    );
    world = discover(at("thicket"), "examine-hollows");
    world = discover(clock(world, 24), "look-up-willows");
    expect(painting(clock(world, 48), "thicket")).toBe(file("thicket"));
  });

  it("keeps ship crossing priority and the quiet night when the ship leaves", () => {
    const world = clock(discover(at("landing"), "examine-hull"), 24);
    const ship = world.transports["greek-ship"];
    for (const [dock, phase, target] of [
      ["pond", "docked", "landing-ship-night"],
      ["greek-harbor", "docked", "landing-night"],
      ["pond", "sea", "landing-ship-night"],
    ]) {
      Object.assign(ship, { dock, phase });
      expect(backdrop("willows-landing", world)).toBe(`./${file(target)}`);
    }
    expect(backdrop("willows-landing", clock(world, 36))).toBe(
      `./${file("landing-night")}`,
    );
  });

  it("maps exactly the twelve existing signs at their current places", () => {
    const pack = packDefinitions.find((p) => p.id === "willows");
    const ids = Object.values(catalogue).flatMap(({ signs }) =>
      Object.keys(signs),
    );
    expect(ids).toHaveLength(12);
    for (const [place, { signs }] of Object.entries(catalogue))
      for (const id of Object.keys(signs))
        expect(pack.choices.find((c) => c.id === id)?.at).toBe(place);
    expect(JSON.stringify(catalogue)).not.toMatch(
      /mended|notebook|choose-watch|lay-out/,
    );
  });
});
