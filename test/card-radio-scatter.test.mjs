import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, play, seedRun } from "../v2/card-game/world.mjs";
import { entityActive, packDefinition, packIdOf, validatePackDefinition } from "../v2/card-game/pack-registry.mjs";
import { installItemCycle, settleItemCycle } from "../v2/card-game/pack-items.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
const radio = packDefinition("ratiradio");
const items = Object.keys(radio.items).filter((id) => radio.items[id].scatterOutside);
const holders = (s) => items.map((id) => s.items[id].holder);

it("spreads keepsakes across distinct enabled external worlds, deterministically", () => {
  const seen = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const s = createWorld({ seed }), places = holders(s);
    expect(places).toEqual(holders(createWorld({ seed })));
    expect(new Set(places.map(packIdOf)).size).toBe(items.length);
    for (const p of places) {
      expect(packIdOf(p)).not.toBe("ratiradio");
      expect(entityActive(s, p)).toBe(true);
      seen.add(packIdOf(p));
    }
    expect(s.items["ratiradio-station-key"].holder).toBe("pond");
    expect(holders(decodeSave(encodeSave(s)))).toEqual(places);
  }
  expect([...seen].sort()).toEqual(["badger-forest", "greek-drama", "hoppycat-archive", "hub", "lonely-forest", "willows"]);
});

it("moves only untouched old starts, never carried items or deliberate Radio deposits", () => {
  const s = createWorld({ seed: 17 });
  for (const id of items) s.items[id] = { holder: radio.items[id].holder, history: [] };
  s.packs.ratiradio.revision = 1;
  s.items[items[0]].holder = "vale";
  s.items[items[1]] = { holder: radio.items[items[1]].holder, history: ["Turn 0: Left here deliberately."] };
  const before = structuredClone(s.items);
  const loaded = decodeSave(JSON.stringify(s));
  expect(loaded.items[items[0]]).toEqual(before[items[0]]);
  expect(loaded.items[items[1]]).toEqual(before[items[1]]);
  for (const id of items.slice(2)) expect(packIdOf(loaded.items[id].holder)).not.toBe("ratiradio");
  expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
});

it("avoids sleeping worlds on installation and never reshuffles when they wake", () => {
  const s = createWorld({ seed: 17 });
  s.disabledPacks = ["sea", "cottage"];
  for (const id of items) s.items[id] = { holder: radio.items[id].holder, history: [] };
  installItemCycle(s);
  for (const p of holders(s)) expect(entityActive(s, p)).toBe(true);
  const before = holders(s);
  delete s.disabledPacks;
  installItemCycle(s);
  expect(holders(s)).toEqual(before);
});

it("evacuates keepsakes when a destination world sleeps, without duplicating them", () => {
  let s = createWorld({ seed: 17 });
  for (const group of ["sea", "cottage"]) {
    const result = play(s, { kind: "pack", pack: group, enable: false });
    expect(result.ok, result.error).toBe(true);
    s = result.state;
  }
  for (const p of holders(s)) {
    expect(entityActive(s, p)).toBe(true);
    expect(packIdOf(p)).not.toBe("ratiradio");
  }
  expect(holders(decodeSave(encodeSave(s)))).toEqual(holders(s));
});

it("returns absent custody outside Radio and leaves intentional Listening Room deposits", () => {
  const s = createWorld({ seed: 17 });
  s.sharedVersion = 1; s.controlledActors = ["vale", "mara"]; s.presentActors = ["vale"];
  s.turn = DAYLIGHT_TURNS * 2;
  s.items[items[0]].holder = "mara";
  s.items[items[1]].holder = "ratiradio-listening-room";
  settleItemCycle(s, String, () => {});
  expect(s.items[items[0]].holder).toBe("pond");
  expect(s.items[items[1]].holder).toBe("ratiradio-listening-room");
});

it("rejects malformed scatter declarations", () => {
  const pack = structuredClone(radio);
  pack.items[items[0]].scatterOutside = "yes";
  expect(() => validatePackDefinition(pack)).toThrow(/scatterOutside/u);
});

it("agrees between browser source and bundled host for fresh and migrated shared saves", async () => {
  const { build } = await import("esbuild");
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { runInNewContext } = await import("node:vm");
  const { sharedContentInput } = await import("../v2/scripts/shared-content-input.mjs");
  const { dispatchShared } = await import("../v2/card-game/shared-world.mjs");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({ absWorkingDir: root, entryPoints: ["v2/card-game/shared-world-entry.mjs"],
    bundle: true, write: false, platform: "neutral", format: "iife", target: "es2022",
    plugins: [sharedContentInput(root)] });
  const content = JSON.parse(readFileSync(`${root}v2/orchestrator-rust/src/card_shared/content.json`, "utf8"));
  content.files["v2/card-game/packs.json"] = JSON.parse(readFileSync(`${root}v2/card-game/packs.json`, "utf8"));
  const vm = { structuredClone, cardContent: content };
  runInNewContext(result.outputFiles[0].text, vm);
  const compiled = (request) => JSON.parse(vm.cardShared(JSON.stringify(request)));
  const draws = new Set();
  for (const seed of [1, 2, 17, 26]) {
    const request = { op: "create", seed };
    const source = dispatchShared(request);
    expect(source.ok, source.error).toBe(true);
    expect(holders(source.world)).toEqual(holders(createWorld({ seed })));
    expect(compiled(request)).toEqual(source);
    draws.add(holders(source.world).join());
  }
  expect(draws.size).toBeGreaterThan(1);
  for (const legacy of [false, true]) {
    const initial = createWorld({ seed: 17 });
    if (legacy) {
      initial.packs.ratiradio.revision = 1;
      for (const id of items) initial.items[id] = { holder: radio.items[id].holder, history: [] };
    }
    const create = { op: "create", save: JSON.stringify(initial) };
    const source = dispatchShared(create);
    expect(source.ok, source.error).toBe(true);
    expect(compiled(create)).toEqual(source);
    const request = { op: "view", world: source.world, actor: "vale", claimed: ["vale"], present: ["vale"] };
    const action = dispatchShared(request).actions.find((a) => a.kind === "wait");
    const command = { ...request, op: "play", action };
    expect(compiled(command)).toEqual(dispatchShared(command));
  }
});

it("waits for the host seed on seedless legacy imports", () => {
  const s = createWorld();
  s.packs.ratiradio.revision = 1;
  const loaded = decodeSave(JSON.stringify(s));
  expect(holders(seedRun(loaded, 26))).toEqual(holders(createWorld({ seed: 26 })));
});

it("keeps the Station Key at Black Pond on direct Radio landings", async () => {
  const { createLandingWorld } = await import("../v2/card-game/pack-landing.mjs");
  const s = createLandingWorld(radio, 17);
  expect(s.items["ratiradio-station-key"].holder).toBe("pond");
  for (const p of holders(s)) expect(packIdOf(p)).not.toBe("ratiradio");
});

it("retrieves a naturally scattered Hoppy keepsake via Piraeus, not the retired shortcut", async () => {
  const { legalActions } = await import("../v2/card-game/world.mjs");
  const { endStandoff } = await import("./helpers/standoff.mjs");
  let s = createWorld({ seed: 1 });
  // This journey tests the scattered keepsake and real transport route, not gift refusal.
  s.actors.moth.trust.vale = 1;
  expect(s.items["ratiradio-red-beanie"].holder).toBe("hoppycat-halfway-tea-garden");
  const route = [
    ["take", "hoppycat-red-thread-spool"], ["take", "lamp"], ["move", "pond"],
    ["ask", "cloth"], ["hold", "cloth"], ["drop", "lamp"],
    ["move", "greek-ship"], ["course", "greek-harbor"], ["wait"], ["move", "greek-harbor"],
    ["move", "greek-ship"], ["course", "greek-piraeus"], ["wait"], ["move", "greek-piraeus"],
    ["move", "greek-ship"], ["course", "hoppycat-signal-jetty"], ["wait"],
    ["move", "hoppycat-signal-jetty"], ["move", "hoppycat-halfway-tea-garden"],
    ["drop", "cloth"], ["take", "ratiradio-red-beanie"], ["move", "pond"],
  ];
  for (const [kind, id, target] of route) {
    s = endStandoff(s);
    if (kind === "hold") { s = selectLamp(s, id); continue; }
    const action = legalActions(s).find((a) => a.kind === kind &&
      (!id || a.item === id || a.target === id) && (!target || a.target === target));
    expect(action, `${kind} ${id || ""}`).toBeDefined();
    const result = play(s, action);
    expect(result.ok, result.error).toBe(true);
    s = decodeSave(encodeSave(result.state));
  }
  expect(s.items["ratiradio-red-beanie"].holder).toBe("vale");
  expect(s.actors.vale.place).toBe("pond");
  expect(s.crossings["hoppycat-pond-garden"].discovered).toBe(false);
}, 15000);
