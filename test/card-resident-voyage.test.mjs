// Residents embark to their own destination. Alone aboard, a resident sets
// the course himself, under the same cargo rule as a player.
import { describe, expect, it } from "vitest";
import { decodeSave, encodeSave } from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import {
  courseOptions,
  courseToward,
  learnLane,
} from "../v2/card-game/pack-transport.mjs";
import { openSeas } from "./helpers/open-door.mjs";
import { stowProvisions } from "./helpers/provisions.mjs";

const SHIP = "greek-ship",
  BARD = "greek-rhapsode",
  HARBOR = "greek-harbor",
  PIRAEUS = "greek-piraeus";
const players = ["vale", "mara"];

// After the plea: the ship empty at the harbor with the Bard just aboard and
// bound for Piraeus, Mara waiting at Piraeus.
function start(cargo) {
  const s = dispatchShared({
    op: "create",
    save: encodeSave(openSeas()),
  }).world;
  stowProvisions(s, cargo);
  for (const a of Object.values(s.actors))
    if (a.place === SHIP) a.place = HARBOR;
  s.actors.vale.place = "greek-courtyard";
  s.actors.mara.place = PIRAEUS;
  learnLane(s, "mara", PIRAEUS, HARBOR);
  s.actors[BARD].place = SHIP;
  delete s.actors[BARD].under;
  // Set aboard by hand, he is not still staying where he last arrived.
  delete s.actors[BARD].dwellUntil;
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
const startSave = (cargo = SHIP) =>
  JSON.parse(encodeSave(decodeSave(encodeSave(start(cargo)))));

const current = (request) => dispatchShared(request);
function wait(rules, cargo, rounds = 16) {
  const saved = startSave(cargo);
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
  it("sails the Bard to Piraeus with cargo aboard and sets him ashore", () => {
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

  it("leaves the Bard aboard at the harbor with no cargo", () => {
    const run = wait(current, HARBOR);
    expect(new Set(run.bardAt)).toEqual(new Set([SHIP]));
    expect(run.world.transports[SHIP].dock).toBe(HARBOR);
  });
  it("plays out the same way every time", () => {
    expect(JSON.stringify(wait(current).world)).toBe(
      JSON.stringify(wait(current).world),
    );
  });
  it("leaves the course to a human aboard, under the cargo rule", () => {
    const s = decodeSave(JSON.stringify(startSave()));
    expect(courseOptions(s, SHIP, BARD)).toContain(PIRAEUS);
    s.actors.vale.place = SHIP;
    expect(courseOptions(s, SHIP, BARD)).toEqual([]);
    const bare = decodeSave(JSON.stringify(startSave(HARBOR)));
    expect(courseOptions(bare, SHIP, BARD)).not.toContain(PIRAEUS);
  });
  it("sets a resident bound for its own dock ashore instead of sailing", () => {
    const s = decodeSave(JSON.stringify(startSave()));
    s.actors[BARD].want = { ...s.actors[BARD].want, target: HARBOR };
    expect(courseToward(s, SHIP, HARBOR, BARD)).toBe(null);
  });
});
