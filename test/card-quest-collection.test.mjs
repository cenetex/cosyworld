import { describe, it, expect } from "vitest";
import {
  createWorld,
  play,
  legalActions,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives, valueOf } from "../v2/card-game/motives.mjs";
import {
  actorQuests,
  activeQuestKey,
  installQuestCollection,
  pursueQuest,
  recordQuestProgress,
  hand,
  at,
  hold,
} from "../v2/card-game/quests.mjs";
import { lifeOf } from "../v2/card-game/life.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
const fresh = () => enableMotives(createWorld(), { personalQuests: true });
function deck(world, actor, programs) {
  installQuestCollection(world, actor);
  const collection = lifeOf(world, actor).collection;
  collection.cards = programs.map((program, serial) => ({
    key: `${actor}:quest:${serial}`,
    program,
    step: 0,
    origin: null,
    createdTurn: world.turn,
    completedTurn: null,
  }));
  collection.next = programs.length;
  collection.active = collection.cards[0]?.key || null;
  return collection;
}
const program = (id, steps) => ({ id, name: id, steps });
function act(world, kind, fields = {}) {
  const action = legalActions(world).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok).toBe(true);
  expect(play(decodeSave(encodeSave(world)), action)).toEqual(result);
  return result.state;
}
describe("collected personal quests", () => {
  it("advances matching cards once each and applies their shared consequence once", () => {
    let world = fresh();
    world.actors.vale.place = "station";
    const target = {
      ...hand(at("station")),
      consequence: { kind: "trust", avatar: "keeper" },
    };
    deck(world, "vale", [
      program("First purpose", [target, target]),
      program("Second purpose", [target, target]),
    ]);
    world = act(world, "wait");
    expect(actorQuests(world, "vale").map((q) => q.step)).toEqual([1, 1]);
    expect(world.actors.vale.progress.marks).toEqual([1, 1]);
    world = act(world, "wait");
    const done = actorQuests(world, "vale").filter(
      (q) => q.status === "fulfilled",
    );
    expect(done.map((q) => q.step)).toEqual([2, 2]);
    expect(
      world.log.filter(
        (e) =>
          e.turn === world.turn &&
          e.consequence?.kind === "trust" &&
          e.actorId === "vale",
      ),
    ).toHaveLength(1);
    const receipts = world.log.filter(
      (e) =>
        e.turn === world.turn && e.kind === "quest" && e.actorId === "vale",
    );
    expect(new Set(receipts.map((e) => e.questKey)).size).toBe(2);
    expect(decodeSave(encodeSave(world))).toEqual(world);
  });
  it("keeps progress and origin when the player changes focus", () => {
    let world = fresh();
    world.actors.vale.place = "station";
    const c = deck(world, "vale", [
      program("A journey", [hand(at("station")), hand(at("pond"))]),
      program("A visit", [hand(at("attic"))]),
    ]);
    c.cards[1].origin = {
      kind: "talk",
      turn: 0,
      other: "keeper",
      item: null,
      place: "station",
    };
    world = act(world, "wait");
    world = act(world, "pursue", { questKey: "vale:quest:1" });
    expect(activeQuestKey(world, "vale")).toBe("vale:quest:1");
    const old = actorQuests(world, "vale").find(
      (q) => q.key === "vale:quest:0",
    );
    expect(old.step).toBe(1);
    expect(old.status).toBe("pending");
    expect(actorQuests(world, "vale")[0].origin.kind).toBe("talk");
    world = act(world, "pursue", { questKey: "vale:quest:0" });
    expect(world.actors.vale.progress.step).toBe(1);
  });
  it("lets a pending desire add bounded weight to an NPC's item choices", () => {
    const world = fresh();
    const before = valueOf(world, "moth", "bell");
    deck(world, "moth", [
      program("Keep light", [hand(hold("lamp"))]),
      program("Bring a bell", [hand(hold("bell"))]),
    ]);
    expect(valueOf(world, "moth", "bell")).toBe(before + 1);
  });
  it("keeps old fulfilled cards as compact collection history", () => {
    const world = fresh();
    const c = deck(world, "vale", []);
    for (let i = 0; i < 25; i++) {
      world.turn += 1;
      const key = `vale:quest:${i}`;
      c.cards.push({
        key,
        program: program(`Memory ${i}`, [hand(at("station"))]),
        step: 0,
        origin: {
          kind: "journey",
          turn: 0,
          other: null,
          item: null,
          place: "station",
        },
        createdTurn: 0,
        completedTurn: null,
      });
      c.next += 1;
      c.active = key;
      recordQuestProgress(world, "vale", true, key);
    }
    expect(c.cards).toHaveLength(24);
    expect(c.archive).toHaveLength(1);
    expect(actorQuests(world, "vale")).toHaveLength(25);
    expect(
      actorQuests(world, "vale").find((q) => q.key === "vale:quest:0"),
    ).toMatchObject({
      status: "fulfilled",
      totalSteps: 1,
      completedTurn: 1,
      program: { name: "Memory 0" },
      origin: { kind: "journey" },
    });
  });
  it("migrates the old lamp-refill memory into a valid care experience", () => {
    const world = fresh();
    world.turn = world.revision = 2;
    world.life.version = 1;
    for (const life of Object.values(world.life.actors)) {
      Object.assign(life, { inspiration: 0, restUntil: 0 });
      for (const key of ["hope", "finished", "restLeft", "quiet"])
        delete life[key];
    }
    world.life.actors.vale.experiences = [
      { kind: "care", key: "care:lamp:oil:station", turn: 1 },
    ];
    const loaded = decodeSave(JSON.stringify(world));
    expect(lifeOf(loaded, "vale").experiences[0]).toEqual({
      kind: "care",
      turn: 1,
      other: null,
      item: "lamp",
      place: "station",
    });
    expect(decodeSave(encodeSave(loaded))).toEqual(loaded);
  });
  it("counts a human's rest on their own shared turns", () => {
    const world = fresh();
    world.sharedVersion = 1;
    for (const actor of ["vale", "mara"]) {
      world.actors[actor].place = "station";
      const c = deck(world, actor, [program("Later", [hand(at("pond"))])]);
      c.active = null;
      Object.assign(lifeOf(world, actor), { phase: "content", restLeft: 3 });
    }
    const req = {
      world,
      actor: "vale",
      claimed: humanAvatarIds,
      present: humanAvatarIds,
    };
    const view = dispatchShared({ ...req, op: "view" });
    const result = dispatchShared({
      ...req,
      op: "play",
      action: view.actions.find((a) => a.kind === "wait"),
    });
    expect(lifeOf(result.world, "vale").restLeft).toBe(2);
    expect(lifeOf(result.world, "mara").restLeft).toBe(3);
  });
});
