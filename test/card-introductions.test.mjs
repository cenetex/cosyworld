import { describe, expect, it } from "vitest";
import {
  createWorld,
  encodeSave,
  decodeSave,
  plan,
  places,
  things,
  nameOf,
} from "../v2/card-game/world.mjs";
import { generateProgram } from "../v2/card-game/quests.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { questCards } from "../v2/card-game/quest-cards.mjs";
import { introductionPrograms } from "../v2/card-game/introductions.mjs";
import { conditionMet } from "../v2/card-game/situations.mjs";
import { boardyFacts } from "../v2/card-game/boardyai.mjs";

const humans = ["vale", "mara"];
function fresh() {
  const w = dispatchShared({
    op: "create",
    save: encodeSave(enableMotives(createWorld(), { personalQuests: true })),
  }).world;
  w.actors.mara.place = "pond";
  return w;
}
const view = (world, actor = "vale", present = humans) =>
  dispatchShared({ op: "view", world, actor, claimed: humans, present });
function step(world, actor = "vale", kind = "wait", target) {
  const action = view(world, actor).actions.find(
    (a) => a.kind === kind && (target === undefined || a.target === target),
  );
  expect(action).toBeDefined();
  const r = dispatchShared({
    op: "play",
    world,
    actor,
    claimed: humans,
    present: humans,
    action,
  });
  expect(r.ok).toBe(true);
  return r.world;
}
const contextual = (world) => ({
  ...world,
  controlledActors: humans,
  presentActors: humans,
  playerActorId: "vale",
});

describe("introduction quests", () => {
  it("offers the quest type to the cast and favours a fresh pair", () => {
    const w = fresh(),
      base = {
        id: "test",
        generated: {
          turn: 0,
          level: 1,
          item: "lamp",
          owner: "vale",
          partner: "keeper",
        },
      };
    const first = introductionPrograms(
      w,
      "moth",
      base,
      ["vale", "keeper", "mara"],
      nameOf,
    )[0];
    expect(first.generated.situation).toBe("introduction");
    expect(first.generated.pair).toEqual(["vale", "keeper"]);
    w.quests = {
      records: {
        old: { subjectActor: "moth", completedTurn: 1, program: first },
      },
    };
    expect(
      introductionPrograms(
        w,
        "moth",
        base,
        ["vale", "keeper", "mara"],
        nameOf,
      )[0].generated.pair,
    ).not.toEqual(first.generated.pair);
  });
  it("gives Boardy an introduction quest, searches, then visits both humans in turn", () => {
    let w = fresh();
    const original = humans.map((id) => w.actors[id].place);
    const path = [];
    for (let n = 0; n < 8; n++) {
      w = step(w);
      path.push(w.actors.boardyai.place);
      expect(humans.map((id) => w.actors[id].place)).toEqual(original);
    }
    expect(w.actors.boardyai.progress.current.generated.pair).toEqual(humans);
    expect(path.slice(-4)).toEqual(["station", "pond", "station", "pond"]);
    expect(w.memories.boardyai.seen.vale.place).toBe("station");
    expect(w.memories.boardyai.seen.mara.place).toBe("pond");
    expect(decodeSave(encodeSave(w)).introductionVisits).toEqual(
      w.introductionVisits,
    );
    expect(step(decodeSave(encodeSave(w)))).toEqual(step(w));
  });
  it("uses remembered sightings when a human moves unseen", () => {
    let w = fresh();
    for (let n = 0; n < 5; n++) w = step(w);
    const a = contextual(w),
      b = structuredClone(a);
    a.actors.mara.place = "theatre";
    b.actors.mara.place = "glasshouse";
    expect(a.actors.boardyai.place).toBe("station");
    expect(plan(a, "boardyai").action.target).toBe("pond");
    expect(plan(b, "boardyai")).toEqual(plan(a, "boardyai"));
    expect(boardyFacts(a, nameOf)).toEqual(boardyFacts(b, nameOf));
    expect(boardyFacts(a, nameOf).join(" ")).toContain(
      "I last saw Mara at Black pond",
    );
    expect(boardyFacts(a, nameOf).join(" ")).not.toMatch(
      /Paper theatre|Wild glasshouse/,
    );
  });
  it("keeps looking when the remembered place is empty", () => {
    let w = fresh();
    for (let n = 0; n < 5; n++) w = step(w);
    w.actors.mara.place = "theatre";
    w = step(w);
    expect(w.actors.boardyai.place).toBe("pond");
    const next = plan(contextual(w), "boardyai");
    expect(next.action.kind).toBe("move");
    expect(next.action.target).not.toBe("theatre");
    expect(w.introductionVisits.boardyai.next).toBe("mara");
  });
  it("completes when the humans meet, rests, then takes an ordinary quest", () => {
    let w = fresh();
    for (let n = 0; n < 5; n++) w = step(w);
    const key = w.life.actors.boardyai.collection.active;
    w = step(w, "mara", "move", "station");
    expect(w.quests.records[key].completedTurn).toBe(w.turn);
    expect(w.life.actors.boardyai.restLeft).toBe(3);
    expect(w.life.actors.boardyai.phase).toBe("content");
    for (let n = 0; n < 2; n++) {
      w = step(w);
      expect(w.life.actors.boardyai.phase).toBe("content");
    }
    for (let n = 0; n < 20 && !w.life.actors.boardyai.collection.active; n++)
      w = step(w);
    expect(w.life.actors.boardyai.collection.active).not.toBe(key);
    expect(w.actors.boardyai.progress.current.generated.situation).not.toBe(
      "introduction",
    );
    expect(
      questCards(view(w).world, "boardyai").some(
        (q) => q.status === "fulfilled" || q.status === "active",
      ),
    ).toBe(true);
  });
  it("lets Boardy board the shared ship as its first rider", () => {
    let w = fresh();
    for (let n = 0; n < 5; n++) w = step(w);
    w.actors.vale.place = "greek-harbor";
    w.actors.mara.place = "pond";
    w.actors.boardyai.place = "pond";
    w.crossings["pond-greek-harbor"].discovered = true;
    w.transports["greek-ship"] = {
      version: 3,
      phase: "docked",
      dock: "pond",
      destination: null,
      riders: [],
      since: w.turn,
      recall: null,
    };
    w.memories.boardyai.seen.vale = {
      place: "greek-harbor",
      turn: w.turn,
      seq: w.eventSeq,
    };
    w.introductionVisits.boardyai.next = "vale";
    w = step(w);
    expect(w.actors.boardyai.place).toBe("greek-ship");
    expect(decodeSave(encodeSave(w))).toEqual(w);
    // Alone aboard, Boardy sets the course and lands after a round at sea.
    w = step(w);
    expect(w.transports["greek-ship"].destination).toBe("greek-harbor");
    for (let n = 0; n < 3 && w.actors.boardyai.place !== "greek-harbor"; n++)
      w = step(w);
    expect(w.actors.boardyai.place).toBe("greek-harbor");
    expect(w.transports["greek-ship"].destination).toBeNull();
  });
  it("requires both chosen humans to be present for the meeting", () => {
    const w = contextual(fresh());
    w.actors.mara.place = w.actors.vale.place;
    const c = { kind: "together", avatars: humans };
    expect(conditionMet(w, c)).toBe(true);
    w.presentActors = ["vale"];
    expect(conditionMet(w, c)).toBe(false);
  });
});

it("lets other residents choose introductions while Boardy favours them", () => {
  const w = contextual(fresh());
  w.actors.keeper.place = "attic";
  w.life.actors.moth.hope.steps[0] = ["gathering"];
  w.actors.moth.progress.recentKinds = ["gathering", "gathering", "gathering"];
  expect(generateProgram(w, "moth", places, things).generated.situation).toBe(
    "introduction",
  );
  const kinds = [];
  for (let n = 0; n < 20; n++) {
    const p = generateProgram(w, "boardyai", places, things);
    kinds.push(p.generated.situation);
    w.actors.boardyai.progress.recentKinds = [
      ...(w.actors.boardyai.progress.recentKinds || []),
      p.generated.situation,
    ].slice(-4);
  }
  expect(kinds.filter((k) => k === "introduction").length).toBeGreaterThan(5);
  expect(kinds.some((k) => k !== "introduction")).toBe(true);
});

it("keeps a sighting when its short event window is pruned", () => {
  let w = fresh();
  for (let n = 0; n < 5; n++) w = step(w);
  const seen = structuredClone(w.memories.boardyai.seen.mara);
  w.actors.mara.place = "theatre";
  for (let n = 0; n < 100; n++) w = step(w);
  expect(w.memories.boardyai.events.some((e) => e.seq === seen.seq)).toBe(
    false,
  );
  expect(w.memories.boardyai.seen.mara).toEqual(seen);
  expect(decodeSave(encodeSave(w)).memories.boardyai.seen.mara).toEqual(seen);
});
