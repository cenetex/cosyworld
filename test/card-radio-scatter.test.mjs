import { onTestFinished } from "vitest";
import { dwellRule } from "../v2/card-game/world/dwell.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";
import { selectLamp } from "./fixtures/card-attic-opening.mjs";
import { expect, it } from "vitest";
import { createWorld, decodeSave, encodeSave, legalActions, play } from "../v2/card-game/world.mjs";
import { entityActive, packDefinition, packDefinitions, packIdOf, validatePackDefinition } from "../v2/card-game/pack-registry.mjs";
import { installItemCycle, settleItemCycle } from "../v2/card-game/pack-items.mjs";
import { DAYLIGHT_TURNS } from "../v2/card-game/pack-rules.mjs";
const radio = packDefinition("ratiradio");
const items = Object.keys(radio.items).filter((id) => radio.items[id].scatterOutside);
const holders = (s) => items.map((id) => s.items[id].holder);

it("spreads keepsakes across distinct enabled external worlds, deterministically", () => {
  const exteriorEntries = new Set(["station", ...packDefinitions.map((pack) => pack.entry)]);
  const seen = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const s = createWorld({ opening: true, seed }), places = holders(s);
    expect(places).toEqual(holders(createWorld({ opening: true, seed })));
    expect(new Set(places.map(packIdOf)).size).toBe(items.length);
    for (const [i, p] of places.entries()) {
      expect(packIdOf(p)).not.toBe("ratiradio");
      expect(entityActive(s, p)).toBe(true);
      expect(exteriorEntries.has(p)).toBe(true);
      expect(radio.items[items[i]].scatterOutside).toContain(p);
      seen.add(packIdOf(p));
    }
    expect(places).not.toContain("attic");
    expect(places).not.toContain("pond");
    expect(s.items["ratiradio-station-key"].holder).toBe("pond");
    expect(holders(decodeSave(encodeSave(s)))).toEqual(places);
  }
  expect([...seen].sort()).toEqual(["badger-forest", "elysium", "greek-drama", "hoppycat-archive", "hub", "lonely-forest", "willows"]);
});


it("avoids sleeping worlds on installation and never reshuffles when they wake", () => {
  for (const seed of [0, 1, 17, 26]) {
    const s = createWorld({ seed });
    s.disabledPacks = ["sea", "cottage"];
    for (const id of items) s.items[id] = { holder: radio.items[id].holder, history: [] };
    installItemCycle(s);
    const before = holders(s);
    for (const p of before) expect(entityActive(s, p)).toBe(true);
    expect(new Set(before.map(packIdOf)).size).toBe(items.length);
    expect(s.items["ratiradio-thermos"].holder).toBe("clearing");
    expect(s.items["ratiradio-red-beanie"].holder).toBe("station");
    delete s.disabledPacks;
    installItemCycle(s);
    expect(holders(s)).toEqual(before);
  }
});

it("keeps old Attic placements, carried keepsakes, and deliberate Radio deposits on reload", () => {
  const s = createWorld({ opening: true, seed: 17 });
  s.items["ratiradio-red-beanie"].holder = "attic";
  s.items["ratiradio-thermos"].holder = "vale";
  s.items["ratiradio-raven-figurine"].holder = "ratiradio-listening-room";
  s.items["ratiradio-raven-figurine"].history = ["Turn 0: Vale set the figurine down."];
  const reloaded = decodeSave(encodeSave(s));
  for (const id of items) expect(reloaded.items[id]).toEqual(s.items[id]);
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
  for (const bad of ["yes", [], ["station", "station"], ["lost-room"], [radio.entry]]) {
    const pack = structuredClone(radio);
    pack.items[items[0]].scatterOutside = bad;
    expect(() => validatePackDefinition(pack)).toThrow(/scatterOutside/u);
  }
});

it("agrees between browser source and bundled host for fresh shared saves", async () => {
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
  for (const legacy of [false]) {
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


it("keeps the Station Key at Black Pond on direct Radio landings", async () => {
  const { createLandingWorld } = await import("../v2/card-game/pack-landing.mjs");
  const s = createLandingWorld(radio, 17);
  expect(s.items["ratiradio-station-key"].holder).toBe("pond");
  for (const p of holders(s)) expect(packIdOf(p)).not.toBe("ratiradio");
});

it("retrieves a Cottage Thermos from a fresh attic using the shore lamp and cloth", () => {
  let s = createWorld({ opening: true, seed: 0 });
  const thermos = "ratiradio-thermos";
  expect(s.items[thermos].holder).toBe("forest-cottage");
  const act = (fields) => {
    const action = legalActions(s).find((candidate) =>
      Object.entries(fields).every(([key, value]) => candidate[key] === value));
    expect(action, JSON.stringify(fields)).toBeDefined();
    const result = play(s, action);
    expect(result.ok, result.error).toBe(true);
    s = result.state;
  };
  s = selectLamp(s);
  act({ kind: "move", target: "pond" });
  act({ kind: "talk", target: "moth" });
  s = selectLamp(s, "lamp");
  act({ kind: "give", item: "lamp", target: "moth" });
  act({ kind: "ask", item: "cloth", target: "moth" });
  act({ label: "Borrow Lamp" });
  s = selectLamp(s, "lamp");
  act({ kind: "move", target: "attic" });
  act({ kind: "move", target: "forest-cottage" });
  act({ kind: "take", item: thermos });
  act({ kind: "move", target: "attic" });
  s = selectLamp(s);
  act({ kind: "move", target: "pond" });
  expect(s.items[thermos].holder).toBe("vale");
});

it("retrieves a naturally scattered Hoppy keepsake via Piraeus, not the retired shortcut", async () => {
  // A scripted route written for a cast that walks on at once (rules 132).
  dwellRule.on = false;
  onTestFinished(() => (dwellRule.on = true));
  const { endStandoff } = await import("./helpers/standoff.mjs");
  let s = createWorld({ seed: 5 });
  // This journey tests the scattered keepsake and real transport route, not gift refusal.
  s.actors.moth.trust.vale = 1;
  expect(s.items["ratiradio-raven-figurine"].holder).toBe("hoppycat-signal-jetty");
  const route = [
    ["take", "lamp"], ["move", "pond"],
    ["ask", "cloth"], ["hold", "cloth"], ["drop", "lamp"],
    ["move", "greek-ship"], ["course", "greek-harbor"], ["wait"], ["move", "greek-harbor"],
    // Piraeus needs the provisions on deck; the jetty, a Hoppy Cat thing aboard.
    ["move", "greek-ship"], ["stow"], ["course", "greek-piraeus"], ["wait"], ["move", "greek-piraeus"],
    ["move", "greek-ship"], ["token"], ["course", "hoppycat-signal-jetty"], ["wait"],
    ["move", "hoppycat-signal-jetty"],
    ["drop", "cloth"], ["take", "ratiradio-raven-figurine"],
    ["move", "greek-ship"], ["course", "pond"], ["wait"], ["move", "pond"],
  ];
  for (const [kind, id, target] of route) {
    s = endStandoff(s);
    if (kind === "hold") { s = selectLamp(s, id); continue; }
    if (kind === "stow") { s = stowProvisions(s, "greek-ship"); continue; }
    if (kind === "token") { s.items["hoppycat-red-thread-spool"].holder = "greek-ship"; continue; }
    const action = legalActions(s).find((a) => a.kind === kind &&
      (!id || a.item === id || a.target === id) && (!target || a.target === target));
    expect(action, `${kind} ${id || ""}`).toBeDefined();
    const result = play(s, action);
    expect(result.ok, result.error).toBe(true);
    s = decodeSave(encodeSave(result.state));
  }
  expect(s.items["ratiradio-raven-figurine"].holder).toBe("vale");
  expect(s.actors.vale.place).toBe("pond");
  expect(s.crossings["hoppycat-pond-garden"].discovered).toBe(false);
}, 15000);
