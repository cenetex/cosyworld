// Adding a place or a dock to a pack never invalidates a world.
// Every authored thing has a slot in a saved world; from rules 93 a world
// saved before the content grew gains the new slots as it loads, locally and
// on the server, which moves every shared world onto the current content.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";
import { newest } from "../v2/scripts/rules-pins.mjs";

const read = (path) =>
  readFileSync(
    new URL(`../v2/orchestrator-rust/src/card_shared/${path}`, import.meta.url),
    "utf8",
  );
const content = JSON.parse(read("content.json"));
const version = newest(read("rules.json"));

// A released bundle hosted as Rust hosts it, with the given pack content.
function engine(rules, files) {
  const runtime = vm.createContext({ structuredClone, cardContent: files });
  vm.runInContext(read(`engine-v${rules}.js`), runtime);
  return (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
}

// Grow the harbor and add a dock to the vessel serving the existing port.
function grow(base, port) {
  const grown = structuredClone(base);
  const greek = grown.files["v2/card-game/packs.json"].packs.find(
    (p) => p.id === "greek-drama",
  );
  greek.places["greek-test-quay"] = {
    name: "The Test Quay",
    text: "A short quay.",
    persona: "A short quay.",
    exits: ["greek-harbor"],
    backdrop: greek.places["greek-harbor"].backdrop,
  };
  greek.places["greek-harbor"].exits.push("greek-test-quay");
  greek.places["greek-test-dock"] = {
    ...structuredClone(greek.places["greek-lemnos"]),
    name: "The Test Dock",
  };
  const board = greek.crossings.find((c) => c.from === port && c.transport);
  const ship = greek.transports[board.transport];
  ship.docks.push("greek-test-dock");
  ship.lanes.push({ from: port, to: "greek-test-dock" });
  greek.crossings.push({
    ...structuredClone(board),
    id: "greek-test-dock-ship",
    from: "greek-test-dock",
  });
  return grown;
}
const grown = grow(content, "greek-sicily");
const filled = (world) => {
  expect(world.memories["greek-test-quay"]).toMatchObject({ events: [] });
  expect(world.memories["greek-test-dock"]).toMatchObject({ events: [] });
  expect(world.crossings["greek-test-dock-ship"]).toBeTruthy();
};

describe("content added after a world was saved", () => {
  it("joins a current shared world as it repacks", () => {
    const { world } = engine(version, content)({ op: "create", seed: 7 });
    expect(world.memories["greek-test-quay"]).toBeUndefined();
    const rules = `full-card-world/${version}`;
    const repack = engine(
      version,
      grown,
    )({
      op: "upgrade",
      from: rules,
      to: rules,
      world,
    });
    expect(repack.error).toBeUndefined();
    filled(repack.world);
    const next = engine(
      version,
      grown,
    )({
      op: "validate",
      world: repack.world,
    });
    expect(next.error).toBeUndefined();
  });

  it("joins an old local save as it loads", () => {
    const save = encodeSave(createWorld());
    const made = engine(version, grown)({ op: "create", seed: 7, save });
    expect(made.error).toBeUndefined();
    filled(made.world);
  });
});
