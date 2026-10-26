import { describe, it, expect } from "vitest";
import {
  addQuestRecord,
  joinQuest,
  questRecords,
} from "../v2/card-game/shared-quests.mjs";
import { recordQuestCompletion } from "../v2/card-game/quest-completions.mjs";
import {
  installRoamingQuests,
  roamingPlan,
  settleRoamingArrival,
  rememberRoutes,
  JOURNEY_HISTORY_LIMIT,
} from "../v2/card-game/roaming-quests.mjs";
function fixture() {
  const world = {
    turn: 1,
    eventSeq: 1,
    actors: {
      singer: { place: "a" },
      human: { place: "b" },
      helper: { place: "a" },
    },
  };
  let closed = false;
  const edges = [
    ["a", "b"],
    ["b", "c"],
    ["c", "b"],
  ];
  const api = {
    nameOf: (id) => id || "a traveler",
    initialEdges: () => edges,
    visibleEdges: (from) => edges.filter(([a]) => a === from),
    exits: (from) =>
      edges.filter(([a]) => a === from && !closed).map(([, b]) => b),
    actions: (actor) =>
      api
        .exits(world.actors[actor].place)
        .map((target) => ({ kind: "move", actor, target })),
    witnessedEdges: () => edges,
    present: () => true,
    arrive: () => {},
  };
  installRoamingQuests(world, ["singer"], api);
  const complete = (location, actor = "human", cause = null) => {
    const q = addQuestRecord(world, {
      holder: { kind: "place", id: location },
      program: {
        id: "deed",
        name: "A deed",
        steps: [{ items: [], avatars: [], location }],
      },
      cause,
    });
    q.completedTurn = world.turn;
    q.step = 1;
    return recordQuestCompletion(world, q, {
      actorId: actor,
      locationId: location,
      cause,
    });
  };
  const step = () => {
    const action = roamingPlan(world, "singer", api);
    if (action) world.actors.singer.place = action.target;
    settleRoamingArrival(world, "singer", api);
    return action;
  };
  return {
    world,
    api,
    complete,
    step,
    close: (value) => {
      closed = value;
    },
  };
}
describe("saved roaming quests", () => {
  it("uses the exact latest site, with distinct same-turn completion order", () => {
    const f = fixture();
    f.complete("b");
    const latest = f.complete("c", "helper");
    f.world.actors.helper.place = "a";
    expect(f.step()?.target).toBe("b");
    expect(f.world.roamingQuests.singer.target).toEqual(latest);
    expect(f.step()).toBeNull();
    f.world.turn++;
    expect(f.step()?.target).toBe("c");
    f.world.turn++;
    expect(f.step()).toBeNull();
    expect(f.world.actors.singer.place).toBe("c");
  });
  it("keeps an exact blocked edge and reuses one help card until passage opens", () => {
    const f = fixture();
    f.complete("c");
    f.close(true);
    expect(f.step()).toBeNull();
    const key = f.world.roamingQuests.singer.blocked.questKey;
    expect(f.world.roamingQuests.singer.blocked).toMatchObject({
      from: "a",
      to: "b",
      kind: "passage",
    });
    f.world.turn++;
    f.step();
    expect(f.world.roamingQuests.singer.blocked.questKey).toBe(key);
    joinQuest(f.world, "helper", key);
    f.close(false);
    f.world.turn++;
    expect(f.step()?.target).toBe("b");
    expect(f.world.quests.records[key].completion).toMatchObject({
      actorId: "helper",
      cause: { kind: "help" },
    });
    f.world.turn++;
    f.step();
    expect(f.world.roamingQuests.singer.target.actorId).toBe("human");
  });
  it("shares witnessed directions through a joined help card", () => {
    const f = fixture();
    f.world.routeKnowledge.singer = [];
    f.api.visibleEdges = () => [];
    f.complete("c");
    f.step();
    const key = f.world.roamingQuests.singer.blocked.questKey;
    expect(f.world.roamingQuests.singer.blocked.kind).toBe("directions");
    joinQuest(f.world, "helper", key);
    f.world.turn++;
    expect(f.step()?.target).toBe("b");
    expect(f.world.quests.records[key].completedTurn).toBe(f.world.turn);
  });
  it("replaces only its causal family and preserves unrelated focus", () => {
    const f = fixture();
    f.complete("c");
    f.close(true);
    f.step();
    const old = f.world.roamingQuests.singer.questKey;
    const unrelated = addQuestRecord(f.world, {
      holder: { kind: "avatar", id: "singer" },
      program: {
        id: "other",
        name: "Other",
        steps: [{ items: [], avatars: [], location: "c" }],
      },
    });
    f.world.quests.focus.helper = unrelated.key;
    unrelated.participants.push("helper");
    f.complete("b");
    f.world.turn++;
    f.step();
    expect(f.world.quests.records[old].retired.reason).toBe("superseded");
    expect(
      f.world.roamingQuests.singer.history.some(
        (q) => q.key === old && q.retiredTurn !== null,
      ),
    ).toBe(true);
    expect(f.world.quests.records[unrelated.key]).toBe(unrelated);
    expect(f.world.quests.focus.helper).toBe(unrelated.key);
  });
  it("excludes journey and helper completions and retains a bounded history", () => {
    const f = fixture();
    const first = f.complete("b");
    f.step();
    f.complete("c", "helper", { kind: "help", rootId: first.id });
    f.world.turn++;
    f.step();
    expect(f.world.roamingQuests.singer.target.id).toBe(first.id);
    for (let i = 0; i < 40; i++) {
      f.complete(i % 2 ? "b" : "c");
      f.world.turn++;
      f.step();
    }
    expect(f.world.roamingQuests.singer.history).toHaveLength(
      JOURNEY_HISTORY_LIMIT,
    );
    expect(
      questRecords(f.world).filter(
        (q) =>
          q.cause?.kind === "journey" && !q.retired && q.completedTurn === null,
      ),
    ).toHaveLength(0);
    expect(
      f.world.quests.records[f.world.roamingQuests.singer.questKey]
        .completedTurn,
    ).not.toBeNull();
  });
  it("keeps route knowledge and pending progress across a plain save round trip", () => {
    const f = fixture();
    f.complete("c");
    f.step();
    const saved = JSON.parse(JSON.stringify(f.world));
    installRoamingQuests(saved, ["singer"], f.api);
    expect(saved.roamingQuests).toEqual(f.world.roamingQuests);
    rememberRoutes(saved, "singer", [["a", "b"]]);
    expect(saved.routeKnowledge).toEqual(f.world.routeKnowledge);
  });
});
