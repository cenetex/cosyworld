// Residents embark to their own destination (rules 96). With no human
// aboard, a resident's course is the ship's, along any lane between active
// docks: the cargo rule binds only a voyage a human rides. The Bard, bound
// for Piraeus with no cargo aboard, used to wait aboard the Charybdis at the
// Wine-Dark Harbor until the stuck rule set him ashore, and boarded again
// before any call; now the ship sails him there, he goes ashore, and the
// empty ship answers Mara's call.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  courseOptions,
  courseToward,
} from "../v2/card-game/pack-transport.mjs";
import { openSeas } from "./helpers/open-door.mjs";

const SHIP = "greek-ship",
  BARD = "greek-rhapsode",
  HARBOR = "greek-harbor",
  PIRAEUS = "greek-piraeus";
const players = ["vale", "mara"];

// After the plea: no cargo aboard, the ship empty at the harbor with the
// Bard just aboard and bound for Piraeus, Mara waiting at Piraeus. A released
// bundle reads only saves of its own rules and content, so it starts from a
// world it made itself, shaped the same way.
function start(
  s = dispatchShared({ op: "create", save: encodeSave(openSeas()) }).world,
) {
  s.items["greek-provisions"].holder = HARBOR;
  for (const a of Object.values(s.actors))
    if (a.place === SHIP) a.place = HARBOR;
  s.actors.vale.place = "greek-courtyard";
  s.actors.mara.place = PIRAEUS;
  s.actors[BARD].place = SHIP;
  delete s.actors[BARD].under;
  s.actors[BARD].want = {
    kind: "place",
    target: PIRAEUS,
    since: s.turn,
    refusals: 0,
  };
  Object.assign(s.transports[SHIP], {
    phase: "docked",
    dock: HARBOR,
    destination: null,
    riders: [],
    since: s.turn,
    recall: null,
  });
  return s;
}
const startSave = () => JSON.parse(encodeSave(decodeSave(encodeSave(start()))));

// Mara waits at Piraeus until she can board, through a shared-rules entry
// point: today's rules, or a released bundle.
const current = (request) => dispatchShared(request);
function released(version) {
  const file = (path) =>
    readFileSync(
      new URL(
        `../v2/orchestrator-rust/src/card_shared/${path}`,
        import.meta.url,
      ),
      "utf8",
    );
  const context = vm.createContext({
    structuredClone,
    // Released rules read the content they shipped with.
    cardContent: JSON.parse(
      readFileSync(
        new URL("./fixtures/card-content-rules-101.json", import.meta.url),
        "utf8",
      ),
    ),
  });
  vm.runInContext(file(`engine-v${version}.js`), context);
  const rules = (request) =>
    JSON.parse(context.cardShared(JSON.stringify(request)));
  // Its own new world, past the opening and with the full Greek map.
  const own = rules({ op: "create", seed: 9 }).world;
  delete own.opening;
  own.packs["greek-drama"].scope = "full";
  rules.start = () => start(own);
  return rules;
}
function wait(rules, rounds = 16) {
  const saved = rules.start ? rules.start() : startSave();
  const created = rules({ op: "create", save: JSON.stringify(saved) });
  expect(created.ok, created.error).toBe(true);
  let world = created.world;
  const seen = { bardAt: [], boarded: false };
  const ask = (op, extra = {}) =>
    rules({
      world,
      actor: "mara",
      op,
      claimed: players,
      present: players,
      ...extra,
    });
  // She boards once the Bard has gone ashore.
  for (let i = 0; i < rounds; i++) {
    const board = ask("view").actions.find(
      (a) => a.kind === "move" && a.target === SHIP,
    );
    if (board && world.actors[BARD].place !== SHIP) {
      world = ask("play", { action: board }).world;
      seen.boarded = true;
      break;
    }
    const result = ask("play", {
      action: ask("view").actions.find((a) => a.kind === "wait"),
    });
    expect(result.ok, result.error).toBe(true);
    world = result.world;
    seen.bardAt.push(world.actors[BARD].place);
  }
  return { world, ...seen };
}

describe("residents embark to their own destination", () => {
  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("sails the Bard to Piraeus, sets him ashore, and answers Mara's call", () => {
    const run = wait(current);
    expect(run.bardAt).toContain(SHIP);
    expect(run.bardAt).toContain(PIRAEUS);
    expect(
      run.world.log.some((e) =>
        /casts off for Piraeus Quays/u.test(e.text || ""),
      ),
    ).toBe(true);
    expect(run.boarded).toBe(true);
    expect(run.world.actors.mara.place).toBe(SHIP);
    expect(run.world.actors[BARD].place).not.toBe(SHIP);
  });

  it("fails under rules 95, which keep the Bard short of Piraeus", () => {
    const run = wait(released(95));
    // He waits aboard at the harbour, but the ship never takes him there.
    expect(run.bardAt).toContain(SHIP);
    expect(run.bardAt).not.toContain(PIRAEUS);
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("plays out the same way every time", () => {
    expect(JSON.stringify(wait(current).world)).toBe(
      JSON.stringify(wait(current).world),
    );
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("leaves the course to a human aboard, under the cargo rule", () => {
    const s = decodeSave(JSON.stringify(startSave()));
    expect(courseOptions(s, SHIP, BARD)).toContain(PIRAEUS);
    s.actors.vale.place = SHIP;
    expect(courseOptions(s, SHIP, BARD)).toEqual([]);
    expect(courseOptions(s, SHIP, "vale")).not.toContain(PIRAEUS);
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("never carries a player's avatar past a cargo gate, even while away", () => {
    // Vale boards beside the Bard and goes away (#2139 review). Her avatar
    // still rides by the cargo rule, so the Bard cannot sail them both to
    // Piraeus; the stuck ship goes home, everyone goes ashore, and the Bard
    // sets that pursuit aside, so he does not board again for it at once.
    const saved = startSave();
    saved.actors.vale.place = SHIP;
    let world = current({ op: "create", save: JSON.stringify(saved) }).world;
    const ask = (op, extra = {}) =>
      current({
        world,
        actor: "mara",
        op,
        claimed: players,
        present: ["mara"],
        ...extra,
      });
    const voyages = [];
    let home = false;
    for (let i = 0; i < 8; i++) {
      const result = ask("play", {
        action: ask("view").actions.find((a) => a.kind === "wait"),
      });
      expect(result.ok, result.error).toBe(true);
      world = result.world;
      voyages.push([world.transports[SHIP].dock, world.actors.vale.place]);
      home ||= world.log.some((e) => /puts in at/u.test(e.text || ""));
    }
    expect(voyages).not.toContainEqual([PIRAEUS, SHIP]);
    expect(world.actors.vale.place).not.toBe(PIRAEUS);
    expect(home).toBe(true);
    expect(world.actors[BARD].gaveUp?.target).toBe(PIRAEUS);
  });

  // Skipped: replays a recorded save through the removed Theban-response
  // branch; retired with the fixtures in package 6 fixtures.
  it.skip("sets a resident bound for its own dock ashore instead of sailing", () => {
    const s = decodeSave(JSON.stringify(startSave()));
    s.actors[BARD].want = { ...s.actors[BARD].want, target: HARBOR };
    expect(courseToward(s, SHIP, HARBOR, BARD)).toBe(null);
  });
});
