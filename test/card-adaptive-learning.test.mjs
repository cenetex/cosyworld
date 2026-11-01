import { questing } from "./helpers/first-quest.mjs";
import { describe, it, expect } from "vitest";
import {
  createWorld as baseCreateWorld,
  expects,
  legalActions,
  play,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
// Play here starts past the pond, where the first quest begins.
const createWorld = (...args) => questing(baseCreateWorld(...args));
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
  // Vale's own want stays open through each measured exchange.
  w.actors.vale.want = { kind: "place", target: "pond", since: 0, refusals: 0 };
  // Pip wants nothing for now, so it does not contest Vale's lamp.
  w.actors.moth.want = null;
  return w;
}
// A flask is always full, so the keeper's spare item is the lamp it values
// least; the flask rests on the station floor.
function spareWorld() {
  const w = setup();
  w.items.lamp.holder = "keeper";
  w.items.oil.holder = "station";
  return w;
}
// Ringing beside the keeper leaves a grudge: it refuses the spare lamp as a
// gift but still accepts the bell in trade, under different conditions.
function grudgeWorld() {
  return act(spareWorld(), "ring", "bell");
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
function choice(w, item = "oil", kind = "ask") {
  // The planner only weighs offers it expects the other side to accept.
  const offers = legalActions(w).filter((a) => expects(w, a));
  const action = offers.find(
    (a) => a.kind === kind && (kind === "trade" ? a.receive : a.item) === item,
  );
  expect(action).toBeDefined();
  return reconsiderPlan(w, "vale", { action, reason: "Seek the item." }, offers);
}
// A controlled evaluation holds the present state and legal choices fixed.
// Only the retained records from real completed plays change between probes.
function probe(records, start = setup) {
  const w = start();
  w.log = [];
  w.turn = records.length * 5 + 1;
  w.revision = w.turn;
  // Travellers far away may have acted already; their events stay counted.
  w.eventSeq = Math.max(w.eventSeq, records.length + 2);
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
    const asked = act(spareWorld(), "ask", "lamp");
    const traded = act(spareWorld(), "trade", "bell");
    expect(history(asked)[0].reward).toBe(23);
    expect(history(traded)[0].reward).toBe(19);
    const byRequest = choice(probe(history(asked), spareWorld), "lamp");
    const byTrade = choice(probe(history(traded), spareWorld), "lamp");
    expect(byRequest.action.kind).toBe("ask");
    expect(byTrade.action.kind).toBe("trade");
    expect(byTrade.action.item).toBe("bell");
    expect(byTrade.learning.expected.samples).toBe(1);
    expect(byTrade.learning.expected.value).toBe(19);
  });
  it.each([false, true])(
    "keeps a ready trade above an old request success after a fresh refusal: %s",
    (withRefusal) => {
      const success = history(act(spareWorld(), "ask", "lamp"));
      const refusal = withRefusal ? history(act(grudgeWorld(), "ask", "lamp")) : [];
      const w = probe([...success, ...refusal], grudgeWorld);
      const before = structuredClone(w);
      const next = choice(w, "lamp", "trade");
      expect(next.action.kind).toBe("trade");
      expect(next.learning).toBeUndefined();
      expect(w).toEqual(before);
      const result = play(w, next.action);
      expect(result.ok).toBe(true);
      expect(result.state.items.lamp.holder).toBe("vale");
      expect(history(result.state).at(-1)).toMatchObject({
        action: { kind: "trade" },
        reward: 19,
        after: { met: true },
      });
      expect(decodeSave(encodeSave(result.state))).toEqual(result.state);
    },
  );
  it("chooses a higher learned request value over a ready trade in matched conditions", () => {
    const w = probe(history(act(spareWorld(), "ask", "lamp")), spareWorld);
    const next = choice(w, "lamp", "trade");
    expect(next.action.kind).toBe("ask");
    expect(next.learning.expected).toEqual({ value: 23, samples: 1, local: 1 });
    const result = play(w, next.action);
    expect(result.ok).toBe(true);
    expect(result.state.items.lamp.holder).toBe("vale");
    expect(history(result.state).at(-1).reward).toBe(23);
  });
  it("revises a successful approach after recent failures", () => {
    const success = history(act(spareWorld(), "ask", "lamp"));
    expect(choice(probe(success, grudgeWorld), "lamp").action.kind).toBe("ask");
    const failures = Array.from(
      { length: 6 },
      () => history(act(grudgeWorld(), "ask", "lamp")).at(-1),
    );
    const learned = probe([...success, ...failures], grudgeWorld);
    const next = choice(learned, "lamp");
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
    // The keeper has just met a want and stays content at the station for
    // the whole measured run, so the open request stays the same.
    w.turn = w.revision = 10;
    w.actors.keeper.want = null;
    w.actors.keeper.metTurn = 10;
    w.actors.moth.metTurn = 10;
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
  it("keeps an older open goal out of a new want", () => {
    const w = act(setup(), "ask", "oil");
    const action = legalActions(w).find(
      (a) => a.kind === "talk" && a.target === "keeper",
    );
    const selected = { action, reason: "Wait for the next meeting." };
    expect(
      reconsiderPlan(w, "vale", selected, legalActions(w)).learning,
    ).toBeDefined();
    w.actors.vale.want = { kind: "place", target: "attic", since: w.turn, refusals: 0 };
    expect(reconsiderPlan(w, "vale", selected, legalActions(w))).toEqual(
      selected,
    );
  });
});
