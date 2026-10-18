import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";

const shore = JSON.parse(
  readFileSync(new URL("../v2/card-game/seeds/shore.json", import.meta.url)),
);
const move = (s, actor, to) =>
  play(
    s,
    legalActions(s, actor).find(
      (a) => a.kind === "move" && !a.item && a.target === to,
    ),
  ).state;
const wait = (s, actor) => play(s, legalActions(s, actor)[0]).state;

// Two places joined by one exit. The yard's rule fires on the given trigger.
function yardWorld(when, make, extra = {}) {
  return createWorld({
    id: "yard",
    rules: extra.rules,
    places: [
      {
        id: "yard",
        name: "Yard",
        exits: ["lane"],
        spawn: [{ id: "grow", when, make, max: extra.max ?? 2 }],
      },
      { id: "lane", name: "Lane", exits: ["yard"] },
    ],
    avatars: [
      { id: "ana", name: "Ana", role: "player", place: "lane" },
      ...(extra.avatars || []),
    ],
    items: extra.items || [],
    tables: {
      rooms: [
        {
          name: "Back room",
          text: "Shelves of jars.",
          spawn: [
            {
              id: "jars",
              when: { kind: "visits", count: 1 },
              make: { kind: "add_item", table: "things" },
              max: 1,
            },
          ],
        },
      ],
      things: [{ name: "Jar", tags: ["glass"] }, { name: "Coin" }],
      folk: [{ name: "Tamsin", text: "A tinker." }],
    },
  });
}

describe("spawn rules", () => {
  it("opens a place with exits both ways once per claim", () => {
    let s = yardWorld(
      { kind: "visits", count: 1 },
      { kind: "open_place", table: "rooms" },
      { max: 1 },
    );
    s = move(s, "ana", "yard");
    const opened = Object.keys(s.places).find((id) => id.startsWith("rooms-"));
    expect(opened).toBeTruthy();
    expect(s.places.yard.exits).toContain(opened);
    expect(s.places[opened].exits).toEqual(["yard"]);
    expect(s.claims["yard:grow:1"]).toEqual({ turn: 1, created: opened });
    expect(s.log.at(-1)).toMatchObject({ kind: "spawn", spawnId: opened });
    s = move(move(s, "ana", "lane"), "ana", "yard");
    expect(
      Object.keys(s.places).filter((id) => id.startsWith("rooms-")),
    ).toHaveLength(1);
    // The new place carries its own rule, so the world keeps growing.
    s = move(s, "ana", opened);
    expect(Object.values(s.items).map((i) => i.holder)).toContain(opened);
  });

  it("counts visits and stops at the rule's cap", () => {
    let s = yardWorld(
      { kind: "visits", count: 2 },
      { kind: "add_item", table: "things" },
      { max: 2 },
    );
    const items = () => Object.keys(s.items).length;
    s = move(s, "ana", "yard");
    expect(items()).toBe(0);
    s = move(move(s, "ana", "lane"), "ana", "yard");
    expect(items()).toBe(1);
    for (let i = 0; i < 6; i++) s = move(move(s, "ana", "lane"), "ana", "yard");
    expect(items()).toBe(2);
  });

  it("reacts to an item brought by tag", () => {
    let s = yardWorld(
      { kind: "item_brought", tag: "glass" },
      { kind: "bring_resident", table: "folk" },
      { items: [{ id: "cup", name: "Cup", holder: "ana" }] },
    );
    s = move(s, "ana", "yard");
    expect(Object.keys(s.avatars)).toEqual(["ana"]);
    s.items.cup.tags = ["glass"];
    s = move(move(s, "ana", "lane"), "ana", "yard");
    const arrived = Object.keys(s.avatars).find((id) => id !== "ana");
    expect(s.avatars[arrived]).toMatchObject({
      name: "Tamsin",
      role: "resident",
      place: "yard",
    });
    expect(s.avatars[arrived].progress.current.steps.length).toBeGreaterThan(0);
  });

  it("grows only when play causes it", () => {
    let s = yardWorld(
      { kind: "gathered", count: 2 },
      { kind: "add_item", table: "things" },
      {
        avatars: [{ id: "bo", name: "Bo", role: "resident", place: "yard" }],
        rules: { actRadius: 1 },
      },
    );
    // Ana waits in the lane; nothing is played in the yard, so it stays still.
    const before = Object.keys(s.items).length;
    s = wait(s, "ana");
    expect(Object.keys(s.items).length).toBe(before);
    s = move(s, "ana", "yard");
    expect(Object.keys(s.items).length).toBe(before + 1);
  });

  it("rejects rules outside the closed vocabulary", () => {
    expect(() =>
      yardWorld({ kind: "moon_rises" }, { kind: "add_item", table: "things" }),
    ).toThrow(/cannot be loaded/);
    expect(() =>
      yardWorld({ kind: "visits", count: 1 }, { kind: "summon", table: "x" }),
    ).toThrow(/cannot be loaded/);
  });

  it("replays growth exactly and saves it", () => {
    const run = () => {
      let s = createWorld(shore);
      for (let i = 0; i < 300; i++) s = play(s, plan(s, "vale").action).state;
      return s;
    };
    const a = run();
    expect(a.spawned).toBeGreaterThan(3);
    expect(Object.keys(a.places).length).toBeGreaterThan(3);
    expect(encodeSave(run())).toBe(encodeSave(a));
    expect(decodeSave(encodeSave(a))).toEqual(a);
  });
});
