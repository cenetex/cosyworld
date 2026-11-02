import { atticOpening } from "./fixtures/card-attic-opening.mjs";
import { describe, it, expect } from "vitest";
import { legalActions, nameOf, play } from "../v2/card-game/world.mjs";
import { enableMotives } from "../v2/card-game/motives.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import { movementCaption } from "../v2/card-game/scene.mjs";
import {
  BEAT_MS,
  combatBeats,
  createBeatRunner,
  defeatSummary,
  isCombatLine,
  outcomeWord,
  sequencePlan,
  telegraphText,
  theName,
} from "../v2/card-game/combat-beats.mjs";

const act = (s, kind, target) => {
  const action = legalActions(s).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action, kind).toBeTruthy();
  const result = play(s, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
// Vale and Pip share the pond; Pip has the upper hand in an open standoff.
const atPond = (resolve = { vale: 1, moth: 4 }) => {
  let s = enableMotives(atticOpening());
  s = act(s, "snuff");
  s.actors.moth.place = "pond";
  s = act(s, "move", "pond");
  s.standoffs = [
    {
      challenger: "moth",
      defender: "vale",
      location: "pond",
      item: "lamp",
      opened: s.turn - 1,
      answered: true,
      resolve,
      guarding: { vale: false, moth: false },
      struck: { vale: true, moth: true },
      steppedBack: { vale: false, moth: false },
      hitBy: { moth: "vale" },
    },
  ];
  return s;
};

describe("combat beats from today's rule lines", () => {
  it("reads a lost standoff as guard, hit, defeat and a relocation", () => {
    const before = atPond();
    const after = act(before, "guard");
    const beats = combatBeats(before, after, { viewer: "vale" });
    expect(beats.map((b) => b.kind)).toEqual(["guard", "attack", "defeat"]);
    const [, hit, defeat] = beats;
    expect(hit).toMatchObject({
      actorId: "moth",
      targetId: "vale",
      damage: 1,
      resolveBefore: 1,
      resolveAfter: 0,
      outcome: "yield",
    });
    expect(defeat).toMatchObject({
      loserId: "vale",
      winnerId: "moth",
      fromLocationId: "pond",
      locationId: after.actors.vale.place,
      moved: true,
      droppedItemIds: ["lamp"],
      sentHome: false,
      viewerLost: true,
    });
    const summary = defeatSummary(defeat);
    expect(summary.title).toBe("Pip drove you off");
    expect(summary.changes).toContain("You dropped the Lamp.");
    expect(summary.arrival).toMatch(/^You come to at /u);
    // Every beat is a committed log line the viewer saw.
    for (const beat of beats)
      expect(
        isCombatLine(
          after.log.find((e) => e.seq === beat.seq),
          "vale",
        ),
      ).toBe(true);
  });

  it("drains resolve in order when both sides strike in one play", () => {
    const before = atPond({ vale: 4, moth: 4 });
    const after = act(before, "attack", "moth");
    const beats = combatBeats(before, after, { viewer: "vale" });
    const hits = beats.filter((b) => b.kind === "attack");
    expect(hits.map((b) => [b.targetId, b.resolveBefore])).toEqual([
      ["moth", 4],
      ["vale", 4],
    ]);
    expect(hits[0].resolveAfter).toBe(4 - hits[0].damage);
    expect(outcomeWord(hits[1])).toBe(`−${hits[1].damage} resolve`);
  });

  it("opens a standoff with full resolve and an eyed item", () => {
    let s = enableMotives(atticOpening());
    s = act(s, "snuff");
    s.actors.moth.place = "pond";
    s.items.cloth.holder = "moth";
    s = act(s, "move", "pond");
    const after = act(s, "threaten", "moth");
    const [threat] = combatBeats(s, after, { viewer: "vale" });
    expect(threat).toMatchObject({ kind: "threaten", actorId: "vale" });
    expect(threat.resolve).toEqual({ vale: 4, moth: 4 });
    expect(telegraphText(threat)).toMatch(/^Vale (eyes the|squares up)/u);
  });

  it("lowercases a name's article inside a caption", () => {
    const beat = { kind: "attack", actorId: "keeper", targetId: "vale" };
    expect(telegraphText(beat)).toBe("The keeper strikes Vale");
    expect(
      telegraphText({ ...beat, actorId: "vale", targetId: "keeper" }),
    ).toBe("Vale strikes the keeper");
  });

  it("names a thing with one article", () => {
    expect(theName("greek-decree")).toBe("the Burial Decree");
    expect(theName("keeper")).toBe("the keeper");
    expect(theName("lamp")).toBe(`the ${nameOf("lamp")}`);
  });

  it("ignores plays with no standoff", () => {
    const s = enableMotives(atticOpening());
    expect(combatBeats(s, act(s, "snuff"), { viewer: "vale" })).toEqual([]);
  });
});

describe("combat beats from structured rule fields", () => {
  const log = (entries) => ({
    actors: { vale: { place: "home" }, moth: { place: "pond" } },
    items: { lamp: { holder: "pond" } },
    standoffs: [],
    log: entries.map((e, i) => ({ seq: 11 + i, turn: 5, ...e })),
  });
  const before = {
    actors: { vale: { place: "pond" }, moth: { place: "pond" } },
    items: { lamp: { holder: "vale" } },
    standoffs: [],
    log: [{ seq: 10, turn: 4 }],
  };
  it("prefers the rules' numbers and the sent-home move", () => {
    const after = log([
      {
        verb: "attack",
        actorId: "moth",
        targetId: "vale",
        locationId: "pond",
        fromLocationId: "pond",
        text: "Pip attacks Vale.",
        damage: 3,
        resolveBefore: 2,
        resolveAfter: 0,
        outcome: "sent-home",
        lossCount: 3,
      },
      {
        verb: "sent-home",
        actorId: "vale",
        fromLocationId: "pond",
        locationId: "home",
        droppedItemIds: ["lamp", "oil"],
        text: "Vale is sent home.",
      },
    ]);
    const beats = combatBeats(before, after, { viewer: "vale" });
    expect(beats[0]).toMatchObject({
      damage: 3,
      resolveBefore: 2,
      resolveAfter: 0,
      outcome: "sent-home",
      lossCount: 3,
      structured: true,
    });
    expect(outcomeWord(beats[0])).toBe("Sent home");
    expect(beats[1]).toMatchObject({
      kind: "defeat",
      seq: 12,
      locationId: "home",
      droppedItemIds: ["lamp", "oil"],
      sentHome: true,
    });
    const summary = defeatSummary(beats[1]);
    expect(summary.changes).toContain("Sent home.");
    expect(summary.changes).toContain("Standoffs lost: 3 of 3.");
    expect(isCombatLine(after.log[1], "vale")).toBe(true);
  });
  it("reads a guarded hit and a retreat move", () => {
    const after = log([
      {
        verb: "attack",
        actorId: "moth",
        targetId: "vale",
        locationId: "pond",
        text: "Pip attacks Vale.",
        damage: 1,
        resolveBefore: 3,
        resolveAfter: 2,
        outcome: "guarded",
      },
    ]);
    const [hit] = combatBeats(before, after, { viewer: "vale" });
    expect(outcomeWord(hit)).toBe("Braced −1");
  });
});

describe("beat timing", () => {
  it("keeps a whole fight inside the budget and halves it at 2×", () => {
    const beats = [
      { kind: "guard" },
      { kind: "attack" },
      { kind: "attack" },
      { kind: "defeat" },
    ];
    const once = sequencePlan(beats);
    expect(once.total).toBeLessThanOrEqual(BEAT_MS.budget + 1e-6);
    const twice = sequencePlan(beats, { speed: 2 });
    expect(twice.total).toBeCloseTo(once.total / 2);
    const attack = once.plans[1];
    expect(attack.steps.map((s) => s.phase)).toEqual([
      "telegraph",
      "strike",
      "impact",
      "resolve",
    ]);
  });

  it("finishing a beat still applies every phase in order", async () => {
    const applied = [],
      waits = [];
    const runner = createBeatRunner({
      apply: (beat, phase, { skipped }) =>
        applied.push(`${beat.kind}:${phase}:${skipped}`),
      delay: (ms, done) => {
        waits.push(done);
        return { cancel() {} };
      },
    });
    const run = runner.run([{ kind: "attack" }, { kind: "defeat" }]);
    await Promise.resolve();
    expect(applied).toEqual(["attack:telegraph:false"]);
    runner.finishBeat();
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toEqual([
      "attack:telegraph:false",
      "attack:strike:true",
      "attack:impact:true",
      "attack:resolve:true",
      "defeat:beaten:false",
    ]);
    // The defeat beat runs at its own pace again.
    waits.at(-1)();
    expect(await run).toBe(true);
  });

  it("cancel stops the remaining beats", async () => {
    const applied = [];
    const runner = createBeatRunner({
      apply: (beat, phase) => applied.push(phase),
      delay: () => ({ cancel() {} }),
    });
    const run = runner.run([{ kind: "attack" }]);
    await Promise.resolve();
    runner.cancel();
    expect(await run).toBe(false);
    expect(applied).toEqual(["telegraph"]);
  });
});

describe("battle beats", () => {
  it("reads a Guard and the redirected hit, and alignment from the latest plays", () => {
    const before = {
      actors: { vale: { place: "station" } },
      standoffs: [
        {
          location: "station",
          resolve: { vale: 4, moth: 4, keeper: 4 },
          covering: { vale: "moth" },
        },
      ],
      log: [],
    };
    const at = { fromLocationId: "station", locationId: "station" };
    const after = {
      log: [
        {
          seq: 1,
          verb: "intercept",
          actorId: "keeper",
          targetId: "moth",
          ...at,
        },
        {
          ...{ seq: 2, verb: "attack", actorId: "vale", targetId: "keeper" },
          ...{
            coveredId: "moth",
            damage: 1,
            resolveBefore: 4,
            resolveAfter: 3,
          },
          ...{ outcome: "hit", ...at },
        },
      ],
    };
    const [guard, hit] = combatBeats(before, after, { viewer: "vale" });
    expect(telegraphText(guard)).toBe("The keeper sides with Pip");
    expect(outcomeWord(guard)).toBe("Guarding");
    // Vale had been guarding Pip, so striking at Pip is turning on Pip; the
    // keeper steps between and takes the hit.
    expect(hit).toMatchObject({
      front: ["vale", "keeper", "moth"],
      turnsOn: true,
      resolve: { vale: 4, moth: 4, keeper: 3 },
    });
    expect(telegraphText(hit)).toBe("Vale turns on Pip");
  });
});

describe("coming to after a defeat", () => {
  it("names the arrival and gives the line to one voice", () => {
    const after = act(atPond(), "guard");
    const here = after.actors.vale.place;
    expect(movementCaption(after)).toMatch(/^You come to at /u);
    const context = narrativeContext(after);
    expect(context.location).toBe(here);
    expect(context.speakers).toHaveLength(1);
    const [speaker] = context.speakers;
    const present = Object.keys(after.actors).filter(
      (id) => id !== "vale" && after.actors[id].place === here,
    );
    if (!present.length) expect(speaker).toBe("vale");
    const facts = context.entities.find((e) => e.id === speaker).facts;
    expect(facts[0]).toBe(
      `Vale was beaten by Pip and came to at ${nameOf(here)}. Say one line.`,
    );
  });
});
