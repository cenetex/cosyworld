import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
  exits,
  plan,
} from "../v2/card-game/world.mjs";
import { addQuestRecord, joinQuest } from "../v2/card-game/shared-quests.mjs";
import { recordQuestCompletion } from "../v2/card-game/quest-completions.mjs";
import { rememberRoutes } from "../v2/card-game/roaming-quests.mjs";
import { humanAvatarIds } from "../v2/card-game/human-cast.mjs";
const singer = "greek-rhapsode";
function complete(
  s,
  location,
  actor = "vale",
  holder = { kind: "avatar", id: actor },
) {
  const q = addQuestRecord(s, {
    holder,
    program: {
      id: "test-deed",
      name: "A finished deed",
      steps: [{ items: [], avatars: [], location }],
    },
  });
  q.completedTurn = s.turn;
  q.step = 1;
  return recordQuestCompletion(s, q, { actorId: actor, locationId: location });
}
function act(s, kind = "wait", fields = {}, actor = "vale") {
  const action = legalActions(s, actor).find(
    (a) =>
      a.kind === kind && Object.entries(fields).every(([k, v]) => a[k] === v),
  );
  expect(action).toBeDefined();
  const result = play(s, action, s.revision, actor);
  expect(result.ok).toBe(true);
  expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
  return result.state;
}
function shared() {
  const s = createWorld();
  s.sharedVersion = 1;
  s.controlledActors = [...humanAvatarIds];
  s.presentActors = [...humanAvatarIds];
  s.actors.vale.place = "station";
  return s;
}
describe("ordinary bard travel", () => {
  it("starts at the active harbor and preserves an introduced bard's saved place", () => {
    const fresh = createWorld();
    expect(fresh.actors[singer].place).toBe("greek-harbor");
    const old = createWorld();
    old.packs["greek-drama"].scope = "full";
    old.actors[singer].place = "greek-argolid-road";
    old.actors[singer].lastTalk = 0;
    delete old.roamingQuests;
    delete old.routeKnowledge;
    const loaded = decodeSave(JSON.stringify(old));
    expect(loaded.actors[singer].place).toBe("greek-argolid-road");
    expect(loaded.actors[singer].lastTalk).toBe(0);
  });
  it("keeps an untouched old spawn through migration and explores its authored exit", () => {
    const old = createWorld();
    old.actors[singer].place = "greek-argolid-road";
    delete old.roamingQuests;
    delete old.routeKnowledge;
    complete(old, "station");
    let s = decodeSave(JSON.stringify(old));
    expect(s.actors[singer].place).toBe("greek-argolid-road");
    s = act(s);
    expect(s.actors[singer].place).toBe("greek-harbor");
    expect(s.roamingQuests[singer].target.locationId).toBe("station");
    expect(
      Object.values(s.quests.records).some(
        (q) => q.program.steps[0]?.passage?.kind === "directions",
      ),
    ).toBe(true);
  });
  it("takes one legal offscreen step each turn and stays at an exact AI completion site", () => {
    let s = createWorld();
    s.actors.vale.place = "attic";
    s.actors[singer].place = "greek-argolid-road";
    const receipt = complete(s, "greek-well", "keeper", {
      kind: "item",
      id: "bell",
    });
    s.items.bell.holder = "pond";
    s.actors.keeper.place = "station";
    const trace = [];
    for (let i = 0; i < 5; i++) {
      const before = s.actors[singer].place;
      const legal = exits(s, before, singer);
      s = act(s);
      const after = s.actors[singer].place;
      if (before !== after) expect(legal).toContain(after);
      trace.push(after);
      expect(
        s.log.filter(
          (e) =>
            e.turn === s.turn && e.kind === "action" && e.actorId === singer,
        ),
      ).toHaveLength(before === after ? 0 : 1);
    }
    expect(trace).toEqual([
      "greek-harbor",
      "greek-courtyard",
      "greek-well",
      "greek-well",
      "greek-well",
    ]);
    expect(s.roamingQuests[singer].target).toEqual(receipt);
    expect(
      s.quests.records[s.roamingQuests[singer].questKey].completedTurn,
    ).toBe(3);
  });
  it("uses the actual ship, waits for its return, and preserves destination through reload", () => {
    let s = createWorld();
    s.actors.vale.place = "pond";
    s.actors[singer].place = "greek-harbor";
    complete(s, "pond");
    s.transports["greek-ship"].dock = "pond";
    s = act(s);
    expect(s.actors[singer].place).toBe("greek-harbor");
    const help = s.roamingQuests[singer].blocked.questKey;
    s = act(s);
    expect(s.roamingQuests[singer].blocked.questKey).toBe(help);
    s = act(s, "move", { target: "greek-ship" });
    expect(s.actors[singer].place).toBe("greek-harbor");
    s = act(s, "move", { target: "greek-harbor" });
    expect(s.actors[singer].place).toBe("greek-ship");
    expect(s.transports["greek-ship"]).toMatchObject({
      dock: null,
      destination: "pond",
    });
    s = act(s);
    expect(s.actors[singer].place).toBe("pond");
    expect(s.transports["greek-ship"].dock).toBe("pond");
  });
  it("keeps a player-only home door subject to the real item gate and rejects stale travel", () => {
    let s = shared();
    s.actors[singer].place = "theatre";
    s.items.mask.holder = "theatre";
    s.actors.mara.place = "theatre";
    complete(s, "pond");
    s = act(s);
    expect(s.actors[singer].place).toBe("theatre");
    const key = s.roamingQuests[singer].blocked.questKey;
    expect(s.quests.records[key].program.steps[0].passage).toEqual({
      actor: singer,
      from: "theatre",
      to: "pond",
      kind: "passage",
    });
    s = act(s, "join-quest", { questKey: key }, "mara");
    s = act(s, "take", { item: "mask" }, "mara");
    expect(s.actors[singer].place).toBe("pond");
    const stale = legalActions(s, "mara").find(
      (a) => a.kind === "move" && a.target === "pond",
    );
    s = act(s, "drop", { item: "mask" }, "mara");
    expect(play(s, stale, s.revision, "mara").ok).toBe(false);
    expect(s.actors[singer].place).toBe("pond");
  });
  it("an eligible AI joins a directions request and shares its witnessed route", () => {
    let s = createWorld();
    s.actors[singer].place = "pond";
    s.actors.keeper.place = "pond";
    s.actors.vale.place = "attic";
    s.routeKnowledge[singer] = [];
    rememberRoutes(s, "keeper", [
      ["pond", "greek-ship"],
      ["greek-ship", "greek-harbor"],
      ["greek-harbor", "greek-courtyard"],
      ["greek-courtyard", "greek-well"],
    ]);
    complete(s, "greek-well");
    s = act(s);
    const q = Object.values(s.quests.records).find(
      (q) => q.program.steps[0]?.passage?.kind === "directions",
    ).key;
    // Give the helper a local turn next to the request.
    s.actors.keeper.place = "pond";
    expect(plan(s, "keeper").action).toMatchObject({
      kind: "join-quest",
      questKey: q,
    });
    s = act(s);
    expect(s.quests.records[q].completion).toMatchObject({
      actorId: "keeper",
      cause: { kind: "help" },
    });
    expect(s.roamingQuests[singer].target.locationId).toBe("greek-well");
  });
  it("uses new directions, retargets mid-trip and keeps the new completion site after its author moves", () => {
    let s = shared();
    s.actors[singer].place = "pond";
    s.actors.vale.place = "pond";
    s.routeKnowledge[singer] = [];
    complete(s, "greek-well");
    s = act(s);
    const q = Object.values(s.quests.records).find(
      (q) => q.program.steps[0]?.passage?.kind === "directions",
    ).key;
    expect(s.quests.records[q].holder).toEqual({ kind: "avatar", id: singer });
    joinQuest(s, "vale", q);
    // A helper's witnessed route is durable route knowledge.
    rememberRoutes(s, "vale", [
      ["pond", "greek-ship"],
      ["greek-ship", "greek-harbor"],
      ["greek-harbor", "greek-courtyard"],
      ["greek-courtyard", "greek-well"],
    ]);
    s.transports["greek-ship"].dock = "pond";
    s = act(s);
    expect(s.actors[singer].place).toBe("greek-ship");
    const latest = complete(s, "station", "mara", {
      kind: "place",
      id: "station",
    });
    s.actors.mara.place = "theatre";
    s = act(s);
    expect(s.roamingQuests[singer].target).toEqual(latest);
    expect(s.actors[singer].place).toBe("greek-harbor");
    // A ship's committed destination remains fixed while someone is aboard.
    expect(s.roamingQuests[singer].history.length).toBeGreaterThan(0);
  });
});
