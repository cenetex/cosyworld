import { describe, it, expect } from "vitest";
import {
  createWorld,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import {
  reconsiderPlan,
  requestConditions,
} from "../v2/card-game/learning.mjs";
import {
  actionEstimate,
  TRIAL_LIMIT,
} from "../v2/card-game/adaptive-learning.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

function setup() {
  const w = enableMotives(createWorld());
  w.actors.keeper.place = "station";
  w.items.lamp.holder = "vale";
  w.items.bell.holder = "vale";
  w.items.cloth.holder = "keeper";
  return w;
}
function act(w, kind, item, target) {
  const a = legalActions(w).find(
    (a) =>
      a.kind === kind &&
      (item === undefined || a.item === item) &&
      (target === undefined || a.target === target),
  );
  expect(a, `${kind} ${item || ""} must be a legal play`).toBeDefined();
  const result = play(w, a);
  expect(result.ok).toBe(true);
  expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
  return result.state;
}
const history = (w) => w.memories.vale.learning || [];
function choice(w, item = "oil") {
  const action = legalActions(w).find(
    (a) => a.kind === "ask" && a.item === item,
  );
  expect(action).toBeDefined();
  return reconsiderPlan(
    w,
    "vale",
    { action, reason: "Seek the item." },
    legalActions(w),
  );
}
// A controlled evaluation holds the present state and legal choices fixed.
// Only the retained records from real completed plays change between probes.
function probe(records) {
  const w = setup();
  w.log = [];
  w.turn = records.length * 5 + 1;
  w.revision = w.turn;
  w.eventSeq = records.length + 2;
  w.memories.vale.learning = structuredClone(records).map((t, i) => ({
    ...t,
    seq: i + 2,
    turn: i * 5 + 1,
  }));
  return decodeSave(encodeSave(w));
}
function estimate(w, trial) {
  return actionEstimate(w, "vale", trial.goal, trial.conditions, trial.action);
}
describe("adaptive action learning", () => {
  it("chooses different actions in the same situation from different measured histories", () => {
    const spare = setup();
    spare.items.oil.doses = 0;
    const asked = act(spare, "ask", "oil");
    const traded = act(setup(), "trade", "bell");
    expect(history(asked)[0].reward).toBe(23);
    expect(history(traded)[0].reward).toBe(19);
    const byRequest = choice(probe(history(asked)));
    const byTrade = choice(probe(history(traded)));
    expect(byRequest.action.kind).toBe("ask");
    expect(byTrade.action.kind).toBe("trade");
    expect(byTrade.action.item).toBe("bell");
    expect(byTrade.learning.expected.samples).toBe(1);
    expect(byTrade.learning.expected.value).toBe(19);
  });
  it("revises a successful approach after recent failures", () => {
    const spare = setup();
    spare.items.oil.doses = 0;
    const success = history(act(spare, "ask", "oil"));
    expect(choice(probe(success)).action.kind).toBe("ask");
    const failures = Array.from(
      { length: 6 },
      () => history(act(setup(), "ask", "oil"))[0],
    );
    const learned = probe([...success, ...failures]);
    const next = choice(learned);
    expect(next.action.kind).not.toBe("ask");
    expect(next.learning.exploring).toBe(true);
    const ask = next.learning.alternatives.find((a) => a.action.kind === "ask");
    expect(ask.samples).toBe(7);
    expect(ask.value).toBeLessThan(0);
  });
  it("gives an earlier helpful gift credit when the later request reaches the goal", () => {
    let w = act(setup(), "ask", "cloth");
    w = act(w, "give", "bell", "keeper");
    const gift = history(w).at(-1);
    expect(gift.action.kind).toBe("give");
    expect(gift.reward).toBe(-3);
    expect(estimate(w, gift).value).toBe(-3);
    w = act(w, "ask", "cloth");
    expect(w.items.cloth.holder).toBe("vale");
    expect(estimate(w, gift).value).toBe(13.1);
    expect(history(w).at(-1).after.met).toBe(true);
  });
  it("keeps a changed situation outside the earlier action's credit chain", () => {
    let w = act(setup(), "ask", "cloth");
    w = act(w, "give", "bell", "keeper");
    const gift = history(w).at(-1);
    w = act(w, "light", "lamp");
    w = act(w, "ask", "cloth");
    expect(history(w).at(-1).after.met).toBe(true);
    expect(estimate(w, gift).value).toBe(-3);
  });
  it("records an idle attempt's actual result and lowers its value as time passes", () => {
    let w = setup();
    w.items.bell.holder = "keeper";
    w = act(w, "ask", "oil");
    w = act(w, "wait");
    const first = history(w).at(-1);
    expect(first.action.kind).toBe("wait");
    expect(first.reward).toBe(-1);
    w = act(w, "wait");
    expect(history(w).at(-1).expected.samples).toBe(1);
    expect(estimate(w, first).value).toBeLessThan(-1);
  });
  it("keeps exploration, values and measured outcomes through a save round trip", () => {
    let w = act(setup(), "ask", "oil");
    w = act(w, "talk", undefined, "keeper");
    const before = structuredClone(w);
    const next = choice(w);
    expect(next.learning.alternatives.length).toBeGreaterThan(1);
    expect(next.action.key).toBeDefined();
    expect(choice(decodeSave(encodeSave(w)))).toEqual(next);
    expect(w).toEqual(before);
  });
  it("learns independently for each avatar and target", () => {
    const traded = act(setup(), "trade", "bell");
    const w = probe(history(traded));
    expect(choice(w).action.kind).toBe("trade");
    expect(w.memories.keeper.learning || []).toEqual([]);
    const action = legalActions(w).find(
      (a) => a.kind === "talk" && a.target === "moth",
    );
    if (action)
      expect(reconsiderPlan(w, "vale", { action }, legalActions(w))).toEqual({
        action,
      });
  });
  it("keeps a bounded recent history with usable source evidence", () => {
    let w = setup();
    w.items.bell.holder = "keeper";
    w = act(w, "ask", "oil");
    for (let i = 0; i < TRIAL_LIMIT + 2; i++) w = act(w, "wait");
    expect(history(w)).toHaveLength(TRIAL_LIMIT);
    expect(history(w)[0].seq).toBeGreaterThan(2);
    expect(
      history(w).every((t) => t.evidence.length && t.before && t.after),
    ).toBe(true);
  });
  it("checks rewards, observations, action fields and source events in saves", () => {
    const w = act(setup(), "ask", "oil");
    for (const change of [
      (t) => (t.reward = 19),
      (t) => (t.before.trust = 3),
      (t) => (t.after.met = true),
      (t) => (t.action.receive = "bell"),
      (t) => (t.expected.samples = 33),
      (t) => (t.conditions = "[]"),
      (t) => (t.afterConditions = "invalid"),
      (t) => (t.evidence = "A different event."),
    ]) {
      const broken = structuredClone(w);
      change(history(broken)[0]);
      expect(() => decodeSave(JSON.stringify(broken))).toThrow();
    }
  });
  it("keeps measured trials private in shared views", () => {
    const w = act(setup(), "ask", "oil");
    const shared = dispatchShared({ op: "create", save: encodeSave(w) }).world;
    for (const actor of ["vale", "mara"]) {
      const view = dispatchShared({
        op: "view",
        world: shared,
        actor,
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
      }).world;
      expect(Boolean(view.memories.vale.learning)).toBe(actor === "vale");
    }
  });
  it("starts a fresh local estimate after conditions change", () => {
    const w = act(setup(), "ask", "oil");
    const previous = requestConditions(w, {
      kind: "ask",
      actor: "vale",
      target: "keeper",
      item: "oil",
    });
    w.actors.keeper.trust.vale = 2;
    const next = choice(w);
    const ask = next.learning.alternatives.find((a) => a.action.kind === "ask");
    expect(ask.local).toBe(0);
    expect(ask.samples).toBe(1);
    expect(
      requestConditions(w, {
        kind: "ask",
        actor: "vale",
        target: "keeper",
        item: "oil",
      }),
    ).not.toBe(previous);
  });
  it("keeps an older open goal out of a new quest step", () => {
    const w = act(setup(), "ask", "oil");
    const action = legalActions(w).find(
      (a) => a.kind === "talk" && a.target === "keeper",
    );
    const selected = { action, reason: "Wait for the next meeting." };
    expect(
      reconsiderPlan(w, "vale", selected, legalActions(w)).learning,
    ).toBeDefined();
    w.actors.vale.progress.step++;
    expect(reconsiderPlan(w, "vale", selected, legalActions(w))).toEqual(
      selected,
    );
  });
  it("keeps shared quest focus separate from an older open goal", () => {
    const w = act(setup(), "ask", "oil");
    const action = legalActions(w).find(
      (a) => a.kind === "talk" && a.target === "keeper",
    );
    const selected = { action, reason: "Attend to a shared hand." };
    expect(
      reconsiderPlan(w, "vale", selected, legalActions(w)).learning,
    ).toBeDefined();
    w.quests.focus.vale = "another-shared-hand";
    expect(reconsiderPlan(w, "vale", selected, legalActions(w))).toEqual(
      selected,
    );
  });
});
