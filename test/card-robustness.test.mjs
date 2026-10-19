import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  join,
  legalActions,
  play,
  rest,
  standoffFor,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";
import { carried } from "../v2/card-game/core/goals.mjs";
import { latentItem, latentPlace } from "../v2/card-game/core/growth.mjs";

const shore = JSON.parse(
  readFileSync(new URL("../v2/card-game/seeds/shore.json", import.meta.url)),
);
const find = (s, actor, kind, extra = {}) =>
  legalActions(s, actor).find(
    (a) =>
      a.kind === kind && Object.entries(extra).every(([k, v]) => a[k] === v),
  );
const act = (s, action) => {
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const latentItems = (s) =>
  Object.keys(s.items).filter((id) => latentItem(s, id));

describe("card core robustness", () => {
  it("refuses an actor that is not a player's own id", () => {
    const s = createWorld(shore);
    for (const actor of [["vale"], { id: "vale" }, "constructor", "__proto__"])
      expect(legalActions(s, actor)).toEqual([]);
    const self = { actor: ["vale"], key: "threaten:vale::vale" };
    expect(play(s, self).ok).toBe(false);
    expect(play(s, { actor: ["vale"], key: "wait:vale::" }).ok).toBe(false);
    expect(rest(s, ["vale"]).ok).toBe(false);
  });

  it("refuses a join it cannot place, instead of throwing", () => {
    let s = createWorld(shore);
    for (
      let i = 0;
      i < 400 && !Object.values(s.places).some((p) => p.latent);
      i++
    )
      s = act(s, plan(s, "vale").action);
    const closed = Object.keys(s.places).find((id) => latentPlace(s, id));
    expect(closed).toBeTruthy();
    for (const place of [closed, "constructor", "__proto__", "nowhere"])
      expect(join(s, { id: "ash", name: "Ash", place }).ok).toBe(false);
    for (const name of [undefined, "", "x".repeat(81), 7])
      expect(join(s, { id: "ash", name, place: "pond" }).ok).toBe(false);
    expect(join(s, { id: "ash", name: "Ash", text: 5, place: "pond" }).ok).toBe(
      false,
    );
    expect(join(s, { id: "ash", name: "Ash", place: "pond" }).ok).toBe(true);
  });

  it("never gives a new place or item an id already in the world", () => {
    // A player joins under a name that looks generated.
    let s = createWorld(shore);
    for (const id of ["finds-1", "finds-2", "shore-places-3", "finds-3"])
      s = join(s, { id, name: "Copy", place: "station" }).state;
    const players = Object.keys(s.avatars).filter(
      (id) => s.avatars[id].role === "player",
    );
    for (let i = 0; i < 600; i++)
      s = act(s, plan(s, players[i % players.length]).action);
    expect(s.spawned).toBeGreaterThan(4);
    // A seed item already uses the first id a place would make.
    const t = createWorld({
      id: "seeded",
      tables: { makes: [{ name: "Lens" }] },
      places: [
        { id: "hall", name: "Hall", exits: ["forge"] },
        { id: "forge", name: "Forge", exits: ["hall"], makes: "makes" },
      ],
      avatars: [{ id: "ana", name: "Ana", role: "player", place: "hall" }],
      items: [{ id: "makes-1", name: "Old coin", holder: "ana" }],
    });
    expect(t.items["makes-1"].name).toBe("Old coin");
    expect(t.places.forge.quest.reward).not.toBe("makes-1");
  });

  it("lets an offer be accepted for at most offerTurns turns", () => {
    let s = createWorld({ ...shore, rules: { offerTurns: 2 } });
    s = join(s, { id: "ash", name: "Ash", place: "station" }).state;
    s = act(s, find(s, "vale", "take", { item: "lamp" }));
    s = act(s, find(s, "ash", "take", { item: "bell" }));
    s = act(s, find(s, "vale", "offer", { item: "lamp", receive: "bell" }));
    const made = s.turn;
    s = act(s, find(s, "vale", "wait"));
    expect(find(s, "ash", "accept")).toBeTruthy();
    s = act(s, find(s, "vale", "wait"));
    expect(s.turn + 1 - made).toBeGreaterThan(2);
    expect(find(s, "ash", "accept")).toBeUndefined();
    expect(carried(s, "vale")).toContain("lamp");
  });

  it("keeps a place's promise when a sleeper blocks its inputs", () => {
    let s = createWorld({
      id: "orphan",
      tables: { makes: [{ name: "Lens" }] },
      places: [
        { id: "hall", name: "Hall", exits: ["forge"] },
        { id: "forge", name: "Forge", exits: ["hall"], makes: "makes" },
      ],
      avatars: [
        { id: "ana", name: "Ana", role: "player", place: "hall" },
        { id: "bo", name: "Bo", role: "player", place: "forge" },
      ],
      items: [{ id: "cup", name: "Cup", holder: "hall" }],
    });
    const promised = s.places.forge.quest.reward;
    s = act(s, find(s, "ana", "take", { item: "cup" }));
    s = rest(s, "ana").state;
    s = act(s, find(s, "bo", "wait"));
    // No other item can stand in, so the blocked quest stays.
    expect(s.places.forge.quest?.reward).toBe(promised);
    s = act(s, find(s, "ana", "move", { item: "cup", target: "forge" }));
    s = act(s, find(s, "ana", "drop", { item: "cup" }));
    expect(s.items[promised].holder).toBe("forge");
    // Every promise still waiting has a quest that makes it.
    for (const id of latentItems(s))
      expect(s.places[s.items[id].maker].quest?.reward).toBe(id);
  });

  it("keeps a doorway step when a stalled doorway quest is refreshed", () => {
    let s = createWorld({
      id: "workshop",
      rules: { growthStart: 8 },
      tables: {
        makes: [{ name: "Lens" }],
        rooms: [{ name: "Room", beyond: "rooms" }],
      },
      places: [
        { id: "hall", name: "Hall", exits: ["forge"], beyond: "rooms" },
        { id: "forge", name: "Forge", exits: ["hall"], makes: "makes" },
      ],
      avatars: [{ id: "ana", name: "Ana", role: "player", place: "hall" }],
      items: [{ id: "cup", name: "Cup", holder: "hall" }],
    });
    // The forge makes a key, and Ana brings it to the hall.
    s.items[s.places.forge.quest.items[0]].holder = "forge";
    s = act(s, find(s, "ana", "move", { item: null, target: "forge" }));
    const key = Object.keys(s.items).find(
      (id) => s.items[id].maker === "forge",
    );
    expect(s.items[key].holder).toBe("forge");
    s = act(s, find(s, "ana", "take", { item: key }));
    s = act(s, find(s, "ana", "move", { item: key, target: "hall" }));
    // At level 9 her next goal opens a doorway from the hall, where she
    // already stands with the key. Her current goal has stalled.
    const p = s.avatars.ana.progress;
    Object.assign(p, {
      program: 8,
      xp: (s.rules.xpPerLevel * 8 * 9) / 2,
      step: 0,
      idle: s.rules.stallActs,
      current: {
        id: "quest-ana-9",
        name: "A stalled goal",
        steps: [{ items: ["cup"], location: "hall", avatars: [] }],
        xp: 10,
        generated: { turn: s.turn, item: "cup", owner: "forge", partner: null },
      },
    });
    s = act(s, find(s, "ana", "wait"));
    const steps = s.avatars.ana.progress.current.steps;
    const door = steps.find((step) => step.opens)?.opens;
    expect(door).toBeTruthy();
    expect(latentPlace(s, door)).toBe(true);
    for (const step of steps)
      if (step.location && latentPlace(s, step.location))
        expect(steps.some((other) => other.opens === step.location)).toBe(true);
  });

  it("makes the holder of the only wanted item let it go", () => {
    let s = createWorld({
      id: "hoard",
      places: [
        { id: "p0", name: "P0", exits: ["p1"] },
        { id: "p1", name: "P1", exits: ["p0"] },
      ],
      avatars: [
        { id: "a0", name: "A0", role: "player", place: "p0" },
        { id: "r0", name: "R0", role: "resident", place: "p0" },
      ],
      items: [{ id: "i0", name: "I0", holder: "r0" }],
    });
    let real = 0;
    for (let i = 0; i < 300; i++) {
      const before = s.avatars.a0.progress;
      s = act(s, plan(s, "a0").action);
      if (
        s.avatars.a0.progress.program > before.program &&
        !before.current.generated.solo
      )
        real += 1;
    }
    expect(real).toBeGreaterThan(20);
  });

  it("moves on after a standoff instead of waiting to be threatened again", () => {
    let s = createWorld({
      id: "peace",
      places: [
        { id: "p0", name: "P0", exits: ["p1"] },
        { id: "p1", name: "P1", exits: ["p0", "p2"] },
        { id: "p2", name: "P2", exits: ["p1"] },
      ],
      avatars: [
        { id: "pl0", name: "Pl0", role: "player", place: "p0" },
        { id: "pl1", name: "Pl1", role: "player", place: "p2" },
        ...["r0", "r1", "r2", "r3"].map((id) => ({
          id,
          name: id.toUpperCase(),
          role: "resident",
          place: "p0",
        })),
      ],
      items: [{ id: "i0", name: "I0", holder: "pl0" }],
    });
    let worst = 0,
      fights = 0;
    for (let i = 0; i < 1200; i++) {
      const p = i % 2 ? "pl1" : "pl0";
      s = act(s, plan(s, p).action);
      if (standoffFor(s, "pl0")) fights += 1;
      if (i > 300) worst = Math.max(worst, s.avatars.pl0.progress.drift);
    }
    expect(worst).toBeLessThan(60);
    expect(fights).toBeLessThan(600);
  }, 60_000);
});
