import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  reclaim,
  rest,
} from "../v2/card-game/core/world.mjs";
import { plan } from "../v2/card-game/core/planner.mjs";
import { carried, generateQuest } from "../v2/card-game/core/goals.mjs";
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
const tables = {
  makes: [{ name: "Lens" }, { name: "Rope" }],
  rooms: [{ name: "Room", makes: "makes", beyond: "rooms" }],
};
// A forge that makes items, a hall that leads beyond, one player.
function workshop(rules = {}) {
  return createWorld({
    id: "workshop",
    rules,
    tables,
    places: [
      { id: "hall", name: "Hall", exits: ["forge"], beyond: "rooms" },
      { id: "forge", name: "Forge", exits: ["hall"], makes: "makes" },
    ],
    avatars: [{ id: "ana", name: "Ana", role: "player", place: "hall" }],
    items: [
      { id: "cup", name: "Cup", holder: "hall" },
      { id: "key", name: "Key", holder: "hall" },
    ],
  });
}

describe("growth through quests", () => {
  it("makes a place's promised item once its inputs are put down there", () => {
    let s = workshop();
    const work = s.places.forge.quest;
    expect(work.items).toHaveLength(1);
    expect(latentItem(s, work.reward)).toBe(true);
    const input = work.items[0];
    s = act(s, find(s, "ana", "take", { item: input }));
    s = act(s, find(s, "ana", "move", { item: null, target: "forge" }));
    expect(latentItem(s, work.reward)).toBe(true);
    s = act(s, find(s, "ana", "drop", { item: input }));
    expect(s.items[work.reward].holder).toBe("forge");
    expect(s.claims["forge:make:1"]).toMatchObject({ created: work.reward });
    expect(
      s.log.some((e) => e.kind === "growth" && e.itemId === work.reward),
    ).toBe(true);
    // The next quest never counts items already here, so it is not met at once.
    const next = s.places.forge.quest;
    expect(next?.reward).not.toBe(work.reward);
    if (next)
      for (const id of next.items) expect(s.items[id].holder).not.toBe("forge");
  });

  it("asks higher levels for items that do not exist yet, and the planner makes them", () => {
    let s = workshop();
    s.avatars.ana.progress.program = 4; // Level 5, every third goal asks for a make.
    s.avatars.ana.progress.current = null;
    const quest = generateQuest(structuredClone(s), "ana");
    expect(quest.generated.item).toBe(s.places.forge.quest.reward);
    s.avatars.ana.progress.current = quest;
    const made = quest.generated.item;
    for (let i = 0; i < 12 && !carried(s, "ana").includes(made); i++)
      s = act(s, plan(s, "ana").action);
    expect(carried(s, "ana")).toContain(made);
  });

  it("opens a doorway with a made key, then sends the avatar through it", () => {
    let s = workshop({ growthStart: 8 });
    // Make a key first.
    const work = s.places.forge.quest;
    s.items[work.items[0]].holder = "forge";
    s = act(s, find(s, "ana", "move", { item: null, target: "forge" }));
    expect(s.items[work.reward].holder).toBe("forge");
    s.avatars.ana.progress.program = 8; // Level 9, every third goal opens a way.
    s.avatars.ana.progress.current = null;
    const scratch = structuredClone(s);
    const quest = generateQuest(scratch, "ana");
    const door = quest.generated.door;
    expect(door).toBeTruthy();
    expect(s.items[quest.generated.item].maker).toBe("forge");
    expect(latentPlace(scratch, door)).toBe(true);
    Object.assign(s, { places: scratch.places, spawned: scratch.spawned });
    s.avatars.ana.progress.current = quest;
    for (let i = 0; i < 16 && s.avatars.ana.place !== door; i++)
      s = act(s, plan(s, "ana").action);
    expect(s.avatars.ana.place).toBe(door);
    const from = s.places[door].exits[0];
    expect(s.places[from].exits).toContain(door);
    expect(s.claims[`${from}:door:${door}`]).toMatchObject({ created: door });
    expect(s.log.some((e) => / opens a way from /.test(e.text))).toBe(true);
  });

  it("grows only as levels are gained, and only where play happens", () => {
    let s = workshop({ growthStart: 1, levelsPerGrowth: 1000 });
    const reward = s.places.forge.quest.reward;
    expect(s.spawned).toBe(1);
    s.items[s.places.forge.quest.items[0]].holder = "forge";
    // The hall is touched, the forge is not: nothing is made.
    s = act(s, find(s, "ana", "wait"));
    expect(latentItem(s, reward)).toBe(true);
    s = act(s, find(s, "ana", "move", { item: null, target: "forge" }));
    expect(s.items[reward].holder).toBe("forge");
    // The budget is spent, so the forge promises nothing more.
    expect(s.places.forge.quest).toBeNull();
    expect(s.spawned).toBe(1);
  });

  it("turns a long-abandoned player into a resident, and can give it back", () => {
    let s = createWorld({
      ...shore,
      avatars: [
        ...shore.avatars,
        { id: "ash", name: "Ash", role: "player", place: "pond" },
      ],
    });
    s = rest(s, "ash").state;
    const held = carried(s, "ash");
    for (let i = 0; i < 95; i++) s = act(s, plan(s, "vale").action);
    expect(s.avatars.ash).toMatchObject({ role: "player", asleep: true });
    expect(carried(s, "ash")).toEqual(held);
    s = act(s, plan(s, "vale").action);
    expect(s.avatars.ash).toMatchObject({
      role: "resident",
      asleep: false,
      former: true,
    });
    expect(play(s, legalActions(s, "ash")[0]).ok).toBe(false);
    expect(reclaim(s, "vale").ok).toBe(false);
    const back = reclaim(s, "ash");
    expect(back.ok).toBe(true);
    expect(back.state.avatars.ash).toMatchObject({
      role: "player",
      former: false,
    });
    expect(play(back.state, legalActions(back.state, "ash")[0]).ok).toBe(true);
  });

  it("grows the shore slowly, stays alive, and replays exactly", () => {
    const run = () => {
      let s = createWorld(shore);
      for (let i = 0; i < 600; i++) s = act(s, plan(s, "vale").action);
      return s;
    };
    const s = run();
    const open = Object.keys(s.places).filter((id) => !latentPlace(s, id));
    expect(open.length).toBeGreaterThan(4);
    expect(open.length).toBeLessThan(20);
    expect(Object.keys(s.avatars)).toHaveLength(3);
    const marks = Object.values(s.avatars).map((a) => a.progress.marks.at(-1));
    for (const mark of marks) expect(s.turn - mark).toBeLessThan(40);
    expect(encodeSave(run())).toBe(encodeSave(s));
    expect(decodeSave(encodeSave(s))).toEqual(s);
  }, 60_000);
});
