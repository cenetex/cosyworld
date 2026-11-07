import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
  wantAPI,
} from "../v2/card-game/world.mjs";
import {
  newWant,
  offerLevelQuest,
  questsOf,
  questRewardsOf,
  questSteps,
  questXp,
} from "../v2/card-game/want.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { questing } from "./helpers/first-quest.mjs";
import { questRewardCards } from "../v2/card-game/quest-card.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";

const reload = (s) => decodeSave(encodeSave(s));
const choose = (s, kind) => legalActions(s).find((a) => a.kind === kind);
function act(s, kind) {
  const result = play(s, choose(s, kind));
  expect(result.ok, result.error).toBe(true);
  return result.state;
}
function completed() {
  const s = questing(createWorld());
  s.actors.vale.want = newWant("place", "station", 0);
  return act(s, "wait");
}

describe("saved quest receipts", () => {
  it("saves the deed and collects once without spending a turn", () => {
    const s = reload(completed());
    const [receipt] = questRewardsOf(s, "vale");
    expect(receipt).toMatchObject({
      actor: "vale",
      xp: 1,
      paid: false,
      level: null,
    });
    expect(receipt.id).toBe(
      s.log.find((e) => e.verb === "want_met" && e.actorId === "vale").seq,
    );
    const claim = choose(s, "claim");
    const next = play(s, { ...claim, receipt: -1, xp: 9000 }).state;
    expect(next.turn).toBe(s.turn);
    expect(next.revision).toBe(s.revision + 1);
    expect(s.actors.vale.xp).toBe(0);
    expect(next.actors.vale.xp).toBe(1);
    expect(next.actors.vale.level).toBe(s.actors.vale.level);
    expect(next.actors.keeper).toEqual(s.actors.keeper);
    expect(narrativeContext(next)).toMatchObject({
      speakers: [],
      resting: null,
      scenery: false,
    });
    expect(questRewardsOf(reload(next), "vale")).toEqual([]);
    expect(play(next, claim).ok).toBe(false);
    expect(play(s, claim, s.revision - 1).ok).toBe(false);
    expect(play(s, claim, s.revision, "mara").ok).toBe(false);
    expect(play(reload(s), claim).state).toEqual(next);
    const sleep = legalActions(next).find((a) => a.sleep);
    expect(sleep).toBeTruthy();
    expect(play(next, sleep).ok).toBe(true);
  });

  it("keeps receipt identity across focus, recurrence and trimmed history", () => {
    let s = completed();
    const first = structuredClone(questRewardsOf(s, "vale")[0]);
    s.actors.vale.want = newWant("item", "oil", s.turn);
    s.actors.vale.under = [newWant("place", "station", s.turn)];
    s = act(s, "focus");
    expect(questRewardsOf(s, "vale")).toEqual([first]);
    s = act(s, "wait");
    const receipts = questRewardsOf(s, "vale");
    expect(receipts).toHaveLength(2);
    expect(receipts[1].id).toBeGreaterThan(first.id);
    s.log = s.log.slice(-1);
    expect(questRewardsOf(reload(s), "vale")).toEqual(receipts);
  });

  it("preserves combat and sleep while collecting", () => {
    let s = completed();
    s.actors.moth.place = s.actors.vale.place;
    s = act(s, "threaten");
    const next = act(s, "claim");
    expect(next.standoffs).toEqual(s.standoffs);
    expect(next.peaceUntil).toEqual(s.peaceUntil);
    expect(next.turn).toBe(s.turn);
    s = completed();
    s.actors.vale.sleeping = {
      since: s.turn,
      place: s.actors.vale.place,
      present: [],
    };
    expect(act(s, "claim").actors.vale.sleeping).toEqual(
      s.actors.vale.sleeping,
    );
  });

  it("keeps same-play and recurrent quest receipts through a pack toggle", () => {
    let s = questing(createWorld({ packScopes: { "greek-drama": "full" } }));
    s.actors.vale.place = "greek-well";
    s.actors.vale.want = newWant("place", "greek-well", 0);
    s.actors.vale.under = [newWant("item", "greek-water-jar", 0)];
    s.items["greek-water-jar"].holder = "vale";
    s = act(s, "wait");
    expect(questRewardsOf(s, "vale")).toHaveLength(2);
    s.actors.vale.want = newWant("place", "greek-well", 0);
    s = act(s, "wait");
    const receipts = structuredClone(questRewardsOf(s, "vale"));
    expect(new Set(receipts.map((r) => r.id)).size).toBe(3);
    expect(receipts[2].want).toEqual(receipts[0].want);
    s = play(s, { kind: "pack", pack: "sea", enable: false }).state;
    expect(questRewardsOf(reload(s), "vale")).toEqual(receipts);
    expect(act(s, "claim").actors.vale.xp).toBe(s.actors.vale.xp + questRewardsOf(s, "vale")[0].xp);
  });

  it("keeps resident rewards automatic and old paid saves intact", () => {
    let s = questing(createWorld());
    s.items.bell.holder = "keeper";
    const xp = s.actors.keeper.xp;
    s = act(s, "wait");
    expect(s.actors.keeper.xp).toBeGreaterThan(xp);
    expect(questRewardsOf(s, "keeper")).toEqual([]);
    s = completed();
    delete s.actors.vale.questRewards;
    const old = reload(s);
    expect(questRewardsOf(old, "vale")).toEqual([]);
    expect(old.actors.vale.xp).toBe(s.actors.vale.xp);
    expect(choose(old, "claim")).toBeUndefined();
  });

  it("rejects repeated receipt IDs and invalid collection history", () => {
    const s = completed();
    s.actors.vale.questRewards.push(s.actors.vale.questRewards[0]);
    expect(() => validateWorld(s)).toThrow();
    const done = act(completed(), "claim");
    done.log.at(-1).receipt = done.eventSeq;
    expect(() => validateWorld(done)).toThrow();
    done.log.at(-1).receipt = 1;
    delete done.log.at(-1).seq;
    expect(() => validateWorld(done)).toThrow();
  });

  it.each([
    [5, 1],
    [10, 2],
    [50, 5],
    [100, 6],
  ])("records level %i with its unpaid %i XP", (level, xp) => {
    let s = questing(createWorld());
    s.turn = s.revision = 24 * (level + 1);
    Object.assign(s.actors.vale, {
      place: "attic",
      level: level - 1,
      xp: questXp(level) + questSteps(level),
      want: {
        ...newWant("place", "attic", s.turn),
        step: { verb: "rest" },
        quest: { level, left: 1 },
      },
    });
    s = act(s, "wait");
    const sleeping = legalActions(s).find((a) => a.sleep);
    s = reload(play(s, sleeping).state);
    expect(questRewardsOf(s, "vale")).toMatchObject([
      { paid: false, level, xp },
    ]);
    expect(questRewardCards(s)).toMatchObject([{ earnedLevel: level, earnedXp: xp }]);
    expect(s.actors.vale.level).toBe(level - 1);
    expect(act(s, "claim").actors.vale.level).toBe(level);
    expect(act(s, "claim").actors.vale.xp).toBe(s.actors.vale.xp + questRewardsOf(s, "vale")[0].xp);
  });

  it.each([
    (r) => {
      r.paid = "unpaid";
    },
    (r) => {
      r.actor = "mara";
    },
    (r) => {
      r.xp = 999;
    },
    (r) => {
      r.level = 100;
    },
    (r) => {
      r.id = Number.MAX_SAFE_INTEGER;
    },
    (r) => {
      r.turn = -1;
    },
  ])("rejects an invalid receipt", (change) => {
    const s = completed();
    change(s.actors.vale.questRewards[0]);
    expect(() => validateWorld(s)).toThrow();
  });

  it("replays the compiled shared claim with the same actor and revision checks", () => {
    const engine = currentSharedEngine();
    const both = (request) => {
      const local = dispatchShared(structuredClone(request));
      expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(
        local,
      );
      return local;
    };
    const seats = {
      actor: "vale",
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
    };
    let s = dispatchShared({ op: "create", seed: 19 }).world;
    delete s.opening;
    s.actors.vale.visited = ["station", "pond"];
    s.actors.vale.want = newWant("place", s.actors.vale.place, s.turn);
    const action = both({ op: "view", world: s, ...seats }).actions.find(
      (a) => a.kind === "wait",
    );
    s = both({ op: "play", world: s, action, ...seats }).world;
    const claim = both({ op: "view", world: s, ...seats }).actions.find(
      (a) => a.kind === "claim",
    );
    expect(claim).toBeTruthy();
    const request = {
      op: "play",
      world: s,
      action: claim,
      revision: s.revision,
      ...seats,
    };
    const done = both(request);
    expect(done.ok).toBe(true);
    expect(both(request)).toEqual(done);
    expect(done.world.actors.vale.xp).toBe(s.actors.vale.xp + 1);
    expect(both({ ...request, world: done.world }).ok).toBe(false);
    expect(
      both({ ...request, world: done.world, revision: done.world.revision }).ok,
    ).toBe(false);
    expect(both({ ...request, actor: "mara" }).ok).toBe(false);
    expect(both({ ...request, present: ["mara"] }).ok).toBe(false);
  });
});

const claim = (s, id) => play(s, legalActions(s).find((a) => a.kind === "claim" && a.receipt === id)).state;
function finalReward(level) {
  let s = questing(createWorld());
  s.turn = s.revision = 24 * (level + 1);
  Object.assign(s.actors.vale, { level: level - 1, xp: questXp(level) + questSteps(level) - 1,
    want: { ...newWant("place", "station", s.turn), quest: { level, left: 2 } } });
  s = act(s, "wait");
  s.actors.vale.place = "attic";
  s = act(s, "wait");
  return reload(play(s, legalActions(s).find((a) => a.sleep)).state);
}
it.each([5, 10, 50, 100])("pays level %i once in either step/final claim order", (level) => {
  for (const order of [[0, 1], [1, 0]]) {
    let s = finalReward(level);
    const receipts = questRewardsOf(s, "vale"), xp = s.actors.vale.xp, turn = s.turn;
    expect(receipts).toHaveLength(2);
    expect(receipts[1]).toMatchObject({ level, paid: false });
    expect(s.actors.vale.level).toBe(level - 1);
    let paid = 0;
    for (const i of order) {
      s = reload(claim(s, receipts[i].id));
      paid += receipts[i].xp;
      expect(s.actors.vale.xp).toBe(xp + paid);
      expect(s.turn).toBe(turn);
      expect(s.actors.vale.level).toBe(i === 1 || order[0] === 1 ? level : level - 1);
    }
    expect(questRewardsOf(s, "vale")).toEqual([]);
  }
});
it("holds level progress through more rests and ordinary claims, then checks the new threshold", () => {
  let s = finalReward(10);
  const final = questRewardsOf(s, "vale").find((r) => r.level);
  s.actors.vale.want = { ...newWant("place", "attic", s.turn), step: { verb: "rest" } };
  for (let i = 0; i < 2; i++) {
    s = act(s, "wait");
    s = play(s, legalActions(s).find((a) => a.sleep)).state;
    expect(questRewardsOf(s, "vale")).toContainEqual(final);
    expect(offerLevelQuest(s, "vale", wantAPI(s))).toBeNull();
    expect(questsOf(s, "vale").some((w) => w.quest)).toBe(false);
    expect(s.log.filter((e) => e.turn === s.turn && e.dream)).toEqual([]);
  }
  while (s.actors.vale.xp < questXp(11)) {
    const move = legalActions(s).find((a) => a.kind === "move");
    s.actors.vale.want = newWant("place", move.target, s.turn);
    const count = questRewardsOf(s, "vale").length;
    s = play(s, move).state;
    expect(questRewardsOf(s, "vale")).toHaveLength(count + 1);
    const receipt = questRewardsOf(s, "vale").at(-1);
    s = claim(s, receipt.id);
    expect(questsOf(s, "vale").some((w) => w.step?.verb === "rest")).toBe(false);
  }
  s = reload(claim(s, final.id));
  expect(s.actors.vale.level).toBe(10);
  expect(questsOf(s, "vale").some((w) => w.step?.verb === "rest")).toBe(false);
  expect(s.actors.vale.glimpse).toBeUndefined();
});
it("acknowledges an actual rules109 paid reward after upgrade", () => {
  const engine = currentSharedEngine(109), seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  const old = (request) => JSON.parse(engine.cardShared(JSON.stringify({ ...request, ...seats })));
  let s = old({ op: "create", seed: 19 }).world;
  delete s.opening;
  s.actors.vale.want = newWant("place", s.actors.vale.place, s.turn);
  s = old({ op: "play", world: s, action: old({ op: "view", world: s }).actions.find((a) => a.kind === "wait") }).world;
  const receipt = questRewardsOf(s, "vale")[0];
  expect(receipt.paid).toBe(true);
  const next = claim(decodeSave(JSON.stringify(s)), receipt.id);
  expect(next.actors.vale.xp).toBe(s.actors.vale.xp);
  expect(next.actors.vale.level).toBe(s.actors.vale.level);
  expect(questRewardsOf(next, "vale")).toEqual([]);
});

it("keeps a later earned level and its glimpse when an older final reward is claimed", () => {
  const s = finalReward(10), receipt = questRewardsOf(s, "vale").find((r) => r.level);
  s.actors.vale.level = 12;
  s.actors.vale.glimpse = { level: 13, kind: "place", id: "attic", at: "attic" };
  const next = claim(s, receipt.id);
  expect(next.actors.vale.level).toBe(12);
  expect(next.actors.vale.glimpse).toEqual(s.actors.vale.glimpse);
  expect(next.actors.vale.xp).toBe(s.actors.vale.xp + receipt.xp);
});
it("replays final and step payments through compiled shared rules in either order", () => {
  const engine = currentSharedEngine(), seats = { actor: "vale", claimed: ["vale"], present: ["vale"] };
  for (const order of [[0, 1], [1, 0]]) {
    let s = finalReward(10);
    const receipts = questRewardsOf(s, "vale"), xp = s.actors.vale.xp;
    for (const i of order) {
      const action = legalActions(s).find((a) => a.kind === "claim" && a.receipt === receipts[i].id);
      const request = { op: "play", world: s, action, revision: s.revision, ...seats };
      const result = dispatchShared(request);
      expect(JSON.parse(engine.cardShared(JSON.stringify(request)))).toEqual(result);
      expect(dispatchShared(request)).toEqual(result);
      expect(result.ok).toBe(true);
      s = reload(result.world);
    }
    expect(s.actors.vale.level).toBe(10);
    expect(s.actors.vale.xp).toBe(xp + receipts.reduce((n, r) => n + r.xp, 0));
  }
});
