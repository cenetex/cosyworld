import { describe, it, expect } from "vitest";
import {
  recordQuestCompletion,
  questCompletions,
  latestQuestCompletion,
  validQuestCompletions,
  COMPLETION_HISTORY_LIMIT,
} from "../v2/card-game/quest-completions.mjs";
const world = () => ({ turn: 7, eventSeq: 19 });
const finish = (s, key, fields = {}) =>
  recordQuestCompletion(
    s,
    { key },
    {
      actorId: "keeper",
      locationId: "station",
      ...fields,
    },
  );
describe("durable quest completion receipts", () => {
  it("orders separate completions in the same turn and preserves the captured site", () => {
    const s = world();
    const first = finish(s, "vale:quest:0", {
      actorId: "vale",
      participants: ["keeper", "vale"],
    });
    const second = finish(s, "keeper:quest:0", {
      locationId: "pond",
      outcome: "reported",
    });
    expect([first.seq, second.seq]).toEqual([1, 2]);
    expect(first.participants).toEqual(["keeper", "vale"]);
    expect(latestQuestCompletion(s, { afterSeq: first.seq })).toEqual(second);
    expect(
      validQuestCompletions(s, ["vale", "keeper"], ["station", "pond"]),
    ).toBe(true);
    expect(latestQuestCompletion(JSON.parse(JSON.stringify(s)))).toEqual(
      second,
    );
  });
  it("publishes one receipt per immutable terminal revision", () => {
    const s = world(),
      quest = { key: "vale:quest:4" };
    const receipt = recordQuestCompletion(s, quest, {
      actorId: "vale",
      locationId: "station",
    });
    expect(
      recordQuestCompletion(s, quest, {
        actorId: "keeper",
        locationId: "pond",
        outcome: "changed copy",
      }),
    ).toBe(receipt);
    expect(questCompletions(s)).toHaveLength(1);
    expect(s.questCompletions.next).toBe(2);
  });
  it("keeps the latest meaningful site after helper history is pruned", () => {
    const s = world(),
      source = finish(s, "world:quest:1");
    for (let n = 0; n <= COMPLETION_HISTORY_LIMIT; n++)
      finish(s, `helper:quest:${n}`, {
        cause: { kind: n % 2 ? "journey" : "help", rootId: source.id },
      });
    expect(questCompletions(s)).toHaveLength(COMPLETION_HISTORY_LIMIT);
    expect(latestQuestCompletion(s)).toEqual(source);
    expect(latestQuestCompletion(s, { afterSeq: source.seq })).toBeNull();
    expect(validQuestCompletions(s, ["keeper"], ["station"])).toBe(true);
  });
  it("preserves unknown old sites and selects sites supported by evidence", () => {
    const s = world();
    const known = finish(s, "known:quest:0");
    const unknown = finish(s, "old:quest:0", {
      actorId: null,
      locationId: null,
      outcome: "declined",
    });
    expect(latestQuestCompletion(s)).toEqual(known);
    expect(latestQuestCompletion(s, { requireLocation: false })).toEqual(
      unknown,
    );
    expect(unknown.participants).toEqual([]);
  });
  it("rejects reused sequence numbers and invalid participant/site references", () => {
    const s = world();
    finish(s, "a");
    finish(s, "b");
    s.questCompletions.recent[1].seq = 1;
    expect(validQuestCompletions(s, ["keeper"], ["station"])).toBe(false);
    s.questCompletions.recent[1].seq = 2;
    s.questCompletions.recent[1].participants.push("missing");
    expect(validQuestCompletions(s, ["keeper"], ["station"])).toBe(false);
  });
  it("keeps the latest pointer consistent with retained receipt facts", () => {
    const s = world();
    finish(s, "a");
    finish(s, "b");
    const valid = () =>
      validQuestCompletions(s, ["keeper"], ["station", "pond"]);
    const latest = structuredClone(s.questCompletions.latest);
    s.questCompletions.latest = null;
    expect(valid()).toBe(false);
    s.questCompletions.latest = latest;
    s.questCompletions.latest.locationId = "pond";
    expect(valid()).toBe(false);
    s.questCompletions.latest = structuredClone(s.questCompletions.recent[0]);
    expect(valid()).toBe(false);
  });
  it("returns a copy and checks retained canonical completion facts", () => {
    const s = world(),
      q = { key: "a" };
    s.quests = { records: { a: q } };
    recordQuestCompletion(s, q, { actorId: "keeper", locationId: "station" });
    latestQuestCompletion(s).locationId = "pond";
    expect(latestQuestCompletion(s).locationId).toBe("station");
    q.completion.locationId = "pond";
    expect(validQuestCompletions(s, ["keeper"], ["station", "pond"])).toBe(
      false,
    );
  });
  it("keeps retired goals in history while selecting meaningful outcomes", () => {
    const s = world(),
      first = finish(s, "story");
    finish(s, "old-goal", { outcome: "superseded" });
    finish(s, "retired-goal", { outcome: "retired" });
    expect(questCompletions(s)).toHaveLength(3);
    expect(latestQuestCompletion(s)).toEqual(first);
    expect(() => finish(s, "invalid", { outcome: "arbitrary" })).toThrow();
    expect(validQuestCompletions(s, ["keeper"], ["station"])).toBe(true);
  });
});
