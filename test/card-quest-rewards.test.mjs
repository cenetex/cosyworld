import { describe, expect, it } from "vitest";
import {
  createWorld,
  decodeSave,
  encodeSave,
  legalActions,
  play,
  validateWorld,
} from "../v2/card-game/world.mjs";
import {
  newWant,
  questRewardsOf,
  questSteps,
  questXp,
} from "../v2/card-game/want.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { currentSharedEngine } from "./fixtures/shared-engine.mjs";
import { questing } from "./helpers/first-quest.mjs";
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

describe("saved paid quest receipts", () => {
  it("saves the deed and collects once without spending a turn", () => {
    const s = reload(completed());
    const [receipt] = questRewardsOf(s, "vale");
    expect(receipt).toMatchObject({
      actor: "vale",
      xp: 1,
      paid: true,
      level: null,
    });
    expect(receipt.id).toBe(
      s.log.find((e) => e.verb === "want_met" && e.actorId === "vale").seq,
    );
    const claim = choose(s, "claim");
    const next = play(s, { ...claim, receipt: -1, xp: 9000 }).state;
    expect(next.turn).toBe(s.turn);
    expect(next.revision).toBe(s.revision + 1);
    expect(next.actors.vale.xp).toBe(s.actors.vale.xp);
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
    expect(act(s, "claim").actors.vale.xp).toBe(s.actors.vale.xp);
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
  });

  it.each([
    [5, 1],
    [10, 2],
    [50, 5],
    [100, 6],
  ])("records level %i with its paid %i XP", (level, xp) => {
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
      { paid: true, level, xp },
    ]);
    expect(s.actors.vale.level).toBe(level);
    expect(act(s, "claim").actors.vale.xp).toBe(s.actors.vale.xp);
  });

  it.each([
    (r) => {
      r.paid = false;
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
    expect(done.world.actors.vale.xp).toBe(s.actors.vale.xp);
    expect(both({ ...request, world: done.world }).ok).toBe(false);
    expect(
      both({ ...request, world: done.world, revision: done.world.revision }).ok,
    ).toBe(false);
    expect(both({ ...request, actor: "mara" }).ok).toBe(false);
    expect(both({ ...request, present: ["mara"] }).ok).toBe(false);
  });
});
