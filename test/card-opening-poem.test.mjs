import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { latestQuestCompletion } from "../v2/card-game/quest-completions.mjs";
import { describe, it, expect } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import {
  openingPoem,
  storyQuests,
  fulfilledQuests,
  STORY_QUEST_CARDS,
} from "../v2/card-game/quest-cards.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { recitalContext } from "../v2/card-game/pack-recital.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { hub } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";

const stanzas = (world) => openingPoem(world).stanzas;
const lines = (world) => stanzas(world).flatMap((s) => s.lines);
const reload = (world) => decodeSave(encodeSave(world));
const courtyard = (world) =>
  storyQuests(world).find((q) => q.id === STORY_QUEST_CARDS[2]);
const act = (world, kind, target) => {
  if (kind === "move") {
    const steps=greekTravelTargets(world.actors.vale.place,target);
    if(steps.length>1) return steps.reduce((w,to)=>act(w,"move",to),world);
  }
  const action = legalActions(world).find(
    (a) => a.kind === kind && (!target || a.target === target),
  );
  expect(action).toBeTruthy();
  const result = play(world, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
};
const bard = "greek-rhapsode";
// The Bard may still be at sea; a voyage takes a world round.
const untilBard = (world, place) => {
  for (let turn = 0; turn < 8 && world.actors[bard].place !== place; turn++)
    world = act(reload(world), "wait");
  return world;
};
const facts = (world) =>
  narrativeContext(world).entities.find((e) => e.id === bard)?.facts || [];

const poem = (world) =>
  recitalContext(world, [packDefinition("greek-drama")], bard);
const poemText = (world) =>
  poem(world)
    ?.stanzas.flatMap((stanza) => stanza.lines)
    .join(" ") || "";

describe("the opening poem", () => {
  it("keeps long earned poems outside the ordinary fact limits", () => {
    const verses = Array.from({ length: 12 }, (_, i) => ({
      choice: `verse-${i}`,
      lines: [
        `I remember the path we took on journey ${i}.`,
        "The shore still holds the marks we left behind.",
      ],
    }));
    const pack = {
      id: "long-poem",
      recital: { actor: bard, title: "A long journey", verses },
    };
    const world = {
      packs: {
        "long-poem": {
          receipts: Object.fromEntries(verses.map((v, i) => [v.choice, i + 1])),
          recitals: Object.fromEntries(
            verses.map((v) => [v.choice, { actor: "vale", visit: null }]),
          ),
        },
      },
    };
    const context = recitalContext(world, [pack], bard);
    expect(context.stanzas).toHaveLength(12);
    expect(
      context.stanzas.flatMap((stanza) => stanza.lines).join(" ").length,
    ).toBeGreaterThan(240);
    expect(context.stanzas[0].lines).toEqual(verses[0].lines);
    expect(context.newLines).toEqual(verses.at(-1).lines);
  });

  it("keeps each card to the same single line across every branch", () => {
    for (const branch of ["burial", "concession", "refusal", "exposure"])
      for (const world of Object.values(openingFixture(branch)))
        for (const quest of storyQuests(world)) {
          expect(quest.singleLine).toBe(true);
          expect(quest.title).toBe(
            [
              "A place beside the bread.",
              "Her brother waits for earth.",
              "What words will you bring home?",
            ][STORY_QUEST_CARDS.indexOf(quest.id)],
          );
          expect(quest.purpose).toBe(quest.title);
        }
  });

  it("reaches the completed quest site and stays when the player leaves", () => {
    const s = openingFixture("refusal");
    expect(latestQuestCompletion(s.water).locationId).toBe("greek-courtyard");
    expect(s.water.roamingQuests[bard].target.locationId).toBe(
      "greek-courtyard",
    );
    // The Bard is still at sea. Keep the shore cast's own quests from
    // naming a newer site while he sails back.
    const water = structuredClone(s.water);
    water.actors.moth.place = water.actors.keeper.place = "greek-battlefield";
    const arrived = untilBard(act(reload(water), "wait"), "greek-courtyard");
    expect(arrived.actors[bard].place).toBe("greek-courtyard");
    const waiting = act(reload(arrived), "wait");
    expect(waiting.actors[bard].place).toBe("greek-courtyard");
    expect(poemText(act(waiting, "talk", bard))).toContain(
      lines(s.water).join(" "),
    );
    const away = act(reload(waiting), "move", "greek-well");
    expect(away.actors[bard].place).toBe("greek-courtyard");
    expect(away.packs["greek-drama"].recitals).toEqual(
      waiting.packs["greek-drama"].recitals,
    );
  });

  it.each(["burial", "concession", "refusal", "exposure"])(
    "carries the whole %s poem into a later conversation",
    (branch) => {
      const s = openingFixture(branch);
      const next = untilBard(act(reload(s.closed), "wait"), "greek-courtyard");
      expect(next.actors[bard].place).toBe("greek-courtyard");
      const talked = act(reload(next), "talk", bard);
      const context = narrativeContext(talked);
      expect(context.speakers).toContain(bard);
      expect(context.entities.find((e) => e.id === bard).poem).toEqual(
        poem(talked),
      );
      const song = facts(talked);
      expect(
        poem(talked).stanzas.map((stanza) => stanza.lines.join(" ")),
      ).toEqual(stanzas(s.closed).map((stanza) => stanza.lines.join(" ")));
      expect(poem(talked).newLines).toEqual(stanzas(s.closed).at(-1).lines);
      expect(poem(reload(talked))).toEqual(poem(talked));
      expect(song.length).toBeLessThanOrEqual(16);
      expect(
        song.every((f) => f.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(f)),
      ).toBe(true);
      expect(facts(reload(talked))).toEqual(song);
    },
  );

  it("adds the report when the bard reaches its saved site", () => {
    const s = openingFixture("refusal");
    expect(poemText(s.returning)).toContain("I told her I would turn away.");
    const closed = untilBard(s.closed, "greek-courtyard");
    expect(closed.actors[bard].place).toBe("greek-courtyard");
    expect(poemText(act(closed, "talk", bard))).toContain(
      "I told her how I turned away.",
    );
  });

  it("upgrades an older completed save and rejects invented visit records", () => {
    const s = openingFixture("refusal");
    const old = structuredClone(s.water);
    delete old.packs["greek-drama"].recitals;
    old.log = [];
    const upgraded = decodeSave(JSON.stringify(old));
    expect(stanzas(upgraded)).toEqual(stanzas(s.water));
    expect(
      upgraded.packs["greek-drama"].recitals["greek-return-water-jar"],
    ).toEqual({ actor: null, visit: null });
    expect(
      act(upgraded, "move", "greek-well").packs["greek-drama"].recitals[
        "greek-return-water-jar"
      ].actor,
    ).toBeNull();
    for (const value of [
      { actor: "missing-traveler", visit: null },
      { actor: "vale", visit: -1 },
      { actor: "vale", visit: s.water.turn + 1 },
    ]) {
      const forged = structuredClone(s.water);
      forged.packs["greek-drama"].recitals["greek-return-water-jar"] = value;
      expect(() => reload(forged)).toThrow(/fresh start/);
    }
  });

  it("follows the latest shared completion and retains each verse author", () => {
    const imported = dispatchShared({
      op: "create",
      save: encodeSave(openingFixture("refusal").water),
    }).world;
    const request = (world, op, actor, extra = {}) =>
      dispatchShared({
        world,
        op,
        actor,
        claimed: ["vale", "mara"],
        present: ["vale", "mara"],
        ...extra,
      });
    const home = request(imported, "view", "mara");
    const picked = request(imported, "play", "mara", {
      action: home.actions.find((a) => a.kind === "take" && a.item === "mask"),
    });
    expect(picked.ok).toBe(true);
    const other = request(picked.world, "view", "mara");
    const moved = request(picked.world, "play", "mara", {
      action: other.actions.find(
        (a) => a.kind === "move" && a.target === "pond",
      ),
    });
    expect(moved.ok).toBe(true);
    expect(moved.world.roamingQuests[bard].target).toEqual(
      latestQuestCompletion(moved.world),
    );
    const view = request(moved.world, "view", "vale");
    const arrived = request(moved.world, "play", "vale", {
      action: view.actions.find(
        (a) => a.kind === "move" && a.target === "greek-well",
      ),
    });
    expect(arrived.ok).toBe(true);
    expect(arrived.world.roamingQuests[bard].target).toEqual(
      latestQuestCompletion(arrived.world),
    );
    const again = request(moved.world, "play", "vale", {
      action: view.actions.find(
        (a) => a.kind === "move" && a.target === "greek-well",
      ),
    });
    expect(again.world).toEqual(arrived.world);
    expect(
      recitalContext(arrived.world, [packDefinition("greek-drama")], bard)
        .stanzas.flatMap((stanza) => stanza.lines)
        .join(" "),
    ).toContain("I set the water by her hands.");
  });

  it("validates authored recital choices and bounded couplets", () => {
    for (const change of [
      (p) => (p.recital.verses[0].choice = "missing"),
      (p) => (p.recital.verses[0].lines = ["one"]),
      (p) => (p.recital.actor = "missing"),
      (p) => (p.recital.claims[0].anyChoices = ["missing"]),
      (p) => (p.recital.claims[0].phrases = []),
      (p) => (p.recital.claims[0].phrases = ["x".repeat(161)]),
    ]) {
      const p = structuredClone(packDefinition("greek-drama"));
      change(p);
      expect(packProblems(p, hub).join(" ")).toMatch(/recital/);
    }
  });
  it.each([
    ["burial", "greek-perform-burial", "I laid her brother in the earth."],
    ["refusal", "greek-decline-burial", "I told her I would turn away."],
    ["exposure", "greek-report-plan", "I gave the guard the hidden plan."],
  ])(
    "weaves water, %s, and the public return from actual deeds",
    (branch, choice, line) => {
      const s = openingFixture(branch);
      expect(stanzas(s.arrival)).toEqual([]);
      expect(stanzas(s.waterOffer)).toEqual([]);
      expect(stanzas(s.closed).map((s) => s.id)).toEqual([
        "greek-return-water-jar",
        choice,
        `greek-courtyard-${branch}`,
      ]);
      expect(lines(s.closed)).toContain(line);
      expect(lines(s.closed).slice(0, 2)).toEqual([
        "I set the water by her hands.",
        "She kept a loaf of bread for me.",
      ]);
      expect(stanzas(reload(s.closed))).toEqual(stanzas(s.closed));
      expect(stanzas(s.closed).map((s) => s.turn)).toEqual(
        stanzas(s.closed)
          .map((s) => s.turn)
          .sort((a, b) => a - b),
      );
      if (branch !== "burial")
        expect(lines(s.closed)).not.toContain(
          "I laid her brother in the earth.",
        );
      expect(storyQuests(s.closed).every((q) => q.resolved)).toBe(true);
    },
  );

  it("keeps a permission report intact when the rite happens later, then reopens Dione's return", () => {
    const s = openingFixture("concession");
    expect(lines(s.permission)).toContain("Her brother waits for earth.");
    expect(lines(s.permission)).not.toContain(
      "I laid her brother in the earth.",
    );
    expect(courtyard(s.permissionShared).resolved).toBe(true);
    expect(stanzas(s.buried).slice(0, 3)).toEqual(stanzas(s.permissionShared));
    expect(lines(s.buried)).toContain("His body waited in the sun.");
    expect(courtyard(s.buried)).toMatchObject({
      resolved: false,
      key: expect.stringMatching(/:grave$/),
    });
    expect(
      legalActions(s.permissionShared).some(
        (a) => a.choiceId === "greek-courtyard-permitted-burial",
      ),
    ).toBe(false);
    expect(fulfilledQuests(s.beforeGraveReport, s.closed)).toContainEqual(
      expect.objectContaining({
        id: STORY_QUEST_CARDS[2],
        completion: "Shared",
      }),
    );
    expect(lines(s.closed).slice(-2)).toEqual([
      "The grave I promised holds him now.",
      "I brought that word to Dione.",
    ]);
    expect(stanzas(reload(s.closed))).toEqual(stanzas(s.closed));
    expect(storyQuests(s.closed).every((q) => q.resolved)).toBe(true);
  });

  it("records permission shared after the burial in its actual place in the poem", () => {
    const s = openingFixture("concession", { reportFirst: false });
    expect(stanzas(s.closed).map((s) => s.id)).toEqual([
      "greek-return-water-jar",
      "greek-petition-burial",
      "greek-perform-permitted-burial",
      "greek-courtyard-concession",
      "greek-courtyard-permitted-burial",
    ]);
    expect(lines(s.closed)).not.toContain("His body waited in the sun.");
    expect(lines(s.closed)).toContain("I told her of the king's consent.");
    expect(stanzas(reload(s.permissionShared))).toEqual(
      stanzas(s.permissionShared),
    );
  });

  it("allows water to enter the poem after the other quests and survives time away", () => {
    let world = openingFixture("refusal", { water: false }).closed;
    expect(stanzas(world)).toHaveLength(2);
    const act = (match) => {
      const a = legalActions(world).find(match);
      expect(a).toBeTruthy();
      const result = play(world, a, world.revision);
      expect(result.ok, result.error || JSON.stringify(result)).toBe(true);
      world = result.state;
    };
    act((a) => a.kind === "move" && a.target === "greek-well");
    act((a) => a.kind === "take" && a.item === "greek-water-jar");
    act((a) => a.kind === "move" && a.target === "greek-courtyard");
    act((a) => a.choiceId === "greek-return-water-jar");
    const poem = openingPoem(world);
    expect(poem.stanzas.at(-1).id).toBe("greek-return-water-jar");
    act((a) => a.kind === "move" && a.target === "greek-harbor");
    act((a) => a.kind === "wait");
    expect(openingPoem(reload(world))).toEqual(poem);
    expect(fulfilledQuests(world, reload(world))).toEqual([]);
  });

  it("keeps completed verses through log pruning and rejects repeat or forged reports", () => {
    const s = openingFixture("concession");
    const world = structuredClone(s.closed);
    world.log = [];
    const before = encodeSave(world);
    const report = legalActions(s.beforeGraveReport).find(
      (a) => a.choiceId === "greek-courtyard-permitted-burial",
    );
    expect(play(world, report, world.revision).ok).toBe(false);
    expect(encodeSave(world)).toBe(before);
    expect(openingPoem(reload(world))).toEqual(openingPoem(s.closed));
    const fake = structuredClone(s.permissionShared);
    fake.packs["greek-drama"].receipts["greek-courtyard-permitted-burial"] =
      fake.turn;
    fake.packs["greek-drama"].flags["greek-permitted-burial-public"] = true;
    expect(() => decodeSave(JSON.stringify(fake))).toThrow(/fresh start/);
  });
});

it("keeps a pruned shared deed's author unknown when Vale loads Mara's saved deed", () => {
  const source = structuredClone(
    openingFixture("refusal", { water: false }).decree,
  );

  const imported = dispatchShared({
    op: "create",
    save: encodeSave(source),
  }).world;
  imported.actors.mara.place = "greek-gate";
  const request = (world, op, actor, extra = {}) =>
    dispatchShared({
      world,
      op,
      actor,
      claimed: ["vale", "mara"],
      present: ["vale", "mara"],
      ...extra,
    });
  const offered = request(imported, "view", "mara");
  const result = request(imported, "play", "mara", {
    action: offered.actions.find((a) => a.choiceId === "greek-decline-burial"),
  });
  expect(result.ok, result.error || JSON.stringify(result)).toBe(true);
  expect(
    result.world.packs["greek-drama"].recitals["greek-decline-burial"].actor,
  ).toBe("mara");
  const old = structuredClone(result.world);
  delete old.packs["greek-drama"].recitals;
  old.log = [];
  const upgraded = request(old, "upgrade", "vale", {
    from: "full-card-world/3",
  }).world;
  expect(
    upgraded.packs["greek-drama"].recitals["greek-decline-burial"],
  ).toEqual({ actor: null, visit: null });
  expect(stanzas(upgraded)).toEqual(stanzas(result.world));
  const view = request(upgraded, "view", "vale");
  let moved = request(upgraded, "play", "vale", {
    action: view.actions.find(
      (a) => a.kind === "move" && a.target === "greek-courtyard",
    ),
  }).world;
  expect(
    moved.packs["greek-drama"].recitals["greek-decline-burial"].actor,
  ).toBeNull();
  const playAsVale = (match) => {
    const view = request(moved, "view", "vale");
    const result = request(moved, "play", "vale", {
      action: view.actions.find(match),
    });
    expect(result.ok, result.error || JSON.stringify(result)).toBe(true);
    moved = result.world;
  };
  playAsVale((a) => a.choiceId === "greek-courtyard-refusal");
  playAsVale((a) => a.kind === "wait");
  expect(entityActive(moved, bard)).toBe(true);
  expect(poem(moved).stanzas[0]).toMatchObject({
    authorId: null,
    authorName: "an earlier traveler",
    lines: ["I told her I would turn away.", "Her brother waited by the wall."],
  });
  expect(
    reload(moved).packs["greek-drama"].recitals["greek-decline-burial"].actor,
  ).toBeNull();
});
