import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { battleEvents, battleFacts } from "../v2/card-game/battle-context.mjs";
import {
  createWorld,
  legalActions,
  play,
  standoffFor,
  nameOf,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { playedEntry } from "../v2/card-game/speech-occasions.mjs";

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  const result = play(s, action);
  expect(result.ok).toBe(true);
  return result.state;
};
function coveredBlow(laterDefeat = false) {
  const s = createWorld();
  for (const id of [
    "moth",
    "keeper",
    ...(laterDefeat ? ["greek-antigone"] : []),
  ]) {
    s.actors[id].place = "station";
    s.actors[id].want = null;
    s.actors[id].metTurn = 0;
  }
  s.items.lamp.holder = "moth";
  s.turn = s.revision = 3;
  const next = act(s, "threaten", "moth");
  const c = standoffFor(next, "vale");
  c.covering.keeper = "moth";
  c.guarding.keeper = true;
  if (laterDefeat) {
    c.resolve.moth = 1;
    c.hitBy["greek-antigone"] = "moth";
  }
  return act(next, "attack", "moth");
}
const facts = (s, id) =>
  battleFacts(s, id, battleEvents(s, playedEntry(s)), nameOf);

it("records the covered recipient and consumed brace through actual replies", () => {
  const s = coveredBlow();
  const events = battleEvents(s, playedEntry(s));
  expect(events[0]).toMatchObject({
    actor: "vale",
    target: "keeper",
    intendedTarget: "moth",
    protected: "moth",
    braced: true,
    before: 4,
    after: 3,
    damage: 1,
  });
  expect(facts(s, "moth")[0]).toContain("The keeper took Vale's blow for me.");
  expect(facts(s, "keeper")[0]).toContain(
    "I took Vale's blow for Pip. I was braced.",
  );
  expect(facts(s, "vale")[0]).toContain("The keeper took my blow for Pip.");
  expect(facts(s, "keeper")).toContain(
    "I have 3 resolve now. My stance is open.",
  );
  expect(standoffFor(s, "keeper").covering).toEqual({});
  expect(facts(s, "keeper").join(" ")).not.toContain("I am covering");
});

it("retains the protected person's later defeat in the same exchange", () => {
  const s = coveredBlow(true);
  const personal = facts(s, "moth");
  expect(personal[0]).toContain("blow for me.");
  expect(personal[2]).toBe(
    "Antigone struck me. The blow dealt 2 damage; resolve fell from 1 to 0. I yielded.",
  );
  expect(personal[3]).toBe("I retreated to Black pond.");
  const context = narrativeContext(s);
  expect(
    context.entities.find((e) => e.id === "moth").facts.slice(0, 4),
  ).toEqual(personal);
  expect(narrativeContext(decodeSave(encodeSave(s)))).toEqual(context);
  for (const entity of context.entities) {
    expect(entity.facts.length).toBeLessThanOrEqual(16);
    expect(entity.facts.every((f) => f.length <= 240)).toBe(true);
  }
});

it("scopes simultaneous events to participants and committed witnesses", () => {
  const s = coveredBlow();
  const local = battleEvents(s, playedEntry(s));
  const distant = {
    ...local[0],
    seq: s.eventSeq + 1,
    actor: "ash",
    target: "mara",
    intendedTarget: "mara",
    protected: null,
    location: "belfry",
    witnesses: ["ash", "mara", "nell"],
  };
  const events = [...local, distant];
  expect(battleFacts(s, "vale", events, nameOf)).toEqual(facts(s, "vale"));
  expect(battleFacts(s, "nell", events, nameOf).join(" ")).toContain(
    "Ash struck Mara.",
  );
  expect(battleFacts(s, "nell", local, nameOf)).toEqual([]);
  expect(battleFacts(s, "mara", events, nameOf)[0]).toContain("Ash struck me.");
});

it("reads partial old events by field and bounds facts to this committed play", () => {
  const s = coveredBlow();
  const played = playedEntry(s);
  const event = s.log.find((e) => e.seq === played.seq);
  s.log = [
    { ...event, seq: played.seq - 1 },
    { ...event, turn: played.turn - 1 },
    { ...event, generated: true },
    { ...event, targetId: null },
    {
      ...event,
      coveredId: null,
      resolveBefore: undefined,
      resolveAfter: undefined,
      damage: undefined,
      guarded: undefined,
      outcome: undefined,
      text: "Unrelated old wording.",
    },
  ];
  expect(battleEvents(s, played)).toHaveLength(1);
  expect(facts(s, "keeper")[0]).toBe("Vale struck me.");
});

it("keeps committed battle facts equal in the browser and shared narrator", () => {
  const sandbox = {};
  runInNewContext(
    readFileSync("v2/orchestrator-rust/src/card_shared/narrator.js", "utf8"),
    sandbox,
  );
  const world = dispatchShared({
    op: "create",
    seed: 7,
    save: encodeSave(coveredBlow(true)),
  }).world;
  const request = {
    world,
    actor: "vale",
    claimed: ["vale"],
    present: ["vale"],
  };
  const result = JSON.parse(sandbox.cardNarrator(JSON.stringify(request)));
  expect(result.ok, result.error).toBe(true);
  expect(result.context).toEqual(
    narrativeContext({
      ...world,
      playerActorId: "vale",
      controlledActors: ["vale"],
      presentActors: ["vale"],
    }),
  );
  expect(
    result.context.entities.find((e) => e.id === "moth").facts.join(" "),
  ).toContain("I yielded.");
});
