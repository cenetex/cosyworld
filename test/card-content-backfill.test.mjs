// Adding a place or a dock to a pack never invalidates a world.
// Every authored thing has a slot in a saved world; from rules 93 a world
// saved before the content grew gains the new slots as it loads, locally and
// on the server, which moves every shared world onto the current content.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { createWorld, encodeSave } from "../v2/card-game/world.mjs";

const read = (path) =>
  readFileSync(
    new URL(`../v2/orchestrator-rust/src/card_shared/${path}`, import.meta.url),
    "utf8",
  );
const content = JSON.parse(read("content.json"));
// Released rules before 94 read the content they shipped with: rules 94's
// two ships are content they refuse.
const rules93 = JSON.parse(
  readFileSync(
    new URL("./fixtures/card-content-rules-93.json", import.meta.url),
    "utf8",
  ),
);
const version = read("engine.rs").match(
  /const VERSION: &str = "full-card-world\/(\d+)"/,
)[1];

// A released bundle hosted as Rust hosts it, with the given pack content.
function engine(rules, files) {
  const runtime = vm.createContext({ structuredClone, cardContent: files });
  vm.runInContext(read(`engine-v${rules}.js`), runtime);
  return (request) => JSON.parse(runtime.cardShared(JSON.stringify(request)));
}

// The content with one more harbor place and one more dock for the ship,
// whose boarding shore copies an existing one.
function grow(base, port, shore) {
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
  const ship = greek.transports["greek-ship"];
  ship.docks.push("greek-test-dock");
  ship.lanes.push({ from: port, to: "greek-test-dock" });
  greek.crossings.push({
    ...structuredClone(greek.crossings.find((c) => c.id === shore)),
    id: "greek-test-dock-ship",
    from: "greek-test-dock",
  });
  return grown;
}
const grown = grow(content, "greek-piraeus", "greek-piraeus-ship");
const grown93 = grow(rules93, "greek-harbor", "greek-lemnos-ship");
const filled = (world) => {
  expect(world.memories["greek-test-quay"]).toMatchObject({ events: [] });
  expect(world.memories["greek-test-dock"]).toMatchObject({ events: [] });
  expect(world.crossings["greek-test-dock-ship"]).toBeTruthy();
};

describe("content added after a world was saved", () => {
  // The backfill arrived in rules 93; every later release keeps it.
  it("runs on rules 93 or later", () =>
    expect(Number(version)).toBeGreaterThanOrEqual(93));

  it("asked rules 92 worlds for a fresh start", () => {
    const { world } = engine(92, rules93)({ op: "create", seed: 7 });
    const result = engine(92, grown93)({ op: "validate", world });
    expect(result.error).toMatch(/fresh start/);
  });

  it("joins a rules 92 shared world as it upgrades", () => {
    const { world } = engine(92, rules93)({ op: "create", seed: 7 });
    const up = engine(
      version,
      grown,
    )({
      op: "upgrade",
      from: "full-card-world/92",
      to: `full-card-world/${version}`,
      world,
    });
    expect(up.error).toBeUndefined();
    filled(up.world);
  });

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
    // The repacked world plays on.
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
