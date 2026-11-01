import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { describe, it, expect } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { openingFixture } from "./helpers/greek-opening.mjs";
import { recitalContext, recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
  entityActive,
  packDefinition,
} from "../v2/card-game/pack-registry.mjs";
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { hub } from "../v2/card-game/pack-registry.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import lore from "../v2/content/greek-drama/lore/bard-couplets.json" with { type: "json" };

const openingPoem = (world) =>
  recitalPoem(world, packDefinition("greek-drama"));
const stanzas = (world) => openingPoem(world).stanzas;
const ids = (world) => stanzas(world).map((s) => s.id);
// Every authored couplet line, kept as lore outside the rules and prompts.
const couplets = Object.values(lore.verses).flatMap((v) => [
  ...v.lines,
  ...(v.after?.lines || []),
]);
const quotesLore = (value) =>
  couplets.some((line) => JSON.stringify(value).includes(line));
const reload = (world) => decodeSave(encodeSave(world));
const act = (world, kind, target) => {
  if (kind === "move") {
    const steps = greekTravelTargets(world.actors.vale.place, target);
    if (steps.length > 1)
      return steps.reduce((w, to) => act(w, "move", to), world);
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
// The Bard follows its own want: give it this place and let it travel there.
const untilBard = (world, place) => {
  world = structuredClone(world);
  world.actors[bard].want = {
    kind: "place",
    target: place,
    since: world.turn,
    refusals: 0,
  };
  for (let turn = 0; turn < 24 && world.actors[bard].place !== place; turn++)
    world = act(reload(world), "wait");
  return world;
};
const facts = (world) =>
  narrativeContext(world).entities.find((e) => e.id === bard)?.facts || [];

const poem = (world) =>
  recitalContext(world, [packDefinition("greek-drama")], bard);
const poemIds = (world) => poem(world)?.stanzas.map((s) => s.id) || [];

describe("the opening poem", () => {
  it("keeps every couplet as lore keyed by its verse choice", () => {
    const pack = packDefinition("greek-drama");
    expect(lore.title).toBe(pack.recital.title);
    expect(Object.keys(lore.verses).sort()).toEqual(
      pack.recital.verses.map((v) => v.choice).sort(),
    );
    expect(couplets).toHaveLength(76);
    expect(quotesLore(pack.recital)).toBe(false);
    expect(lore.verses["greek-courtyard-concession"].after.choice).toBe(
      "greek-perform-permitted-burial",
    );
  });

  it("names each traveler of a long earned poem without couplet text", () => {
    const verses = Array.from({ length: 12 }, (_, i) => ({
      choice: `verse-${i}`,
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
    expect(Object.keys(context)).toEqual(["title", "stanzas"]);
    expect(context.stanzas).toHaveLength(12);
    expect(context.stanzas[0]).toEqual({
      id: "verse-0",
      turn: 1,
      authorId: "vale",
      authorName: "Vale",
    });
  });

  it.each(["burial", "concession", "exposure"])(
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
      expect(poemIds(talked)).toEqual(ids(s.closed));
      expect(quotesLore(context)).toBe(false);
      expect(poem(reload(talked))).toEqual(poem(talked));
      expect(song.length).toBeLessThanOrEqual(16);
      expect(
        song.every((f) => f.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(f)),
      ).toBe(true);
      expect(facts(reload(talked))).toEqual(song);
    },
  );

  it("adds the report when the bard reaches its saved site", () => {
    const s = openingFixture("exposure");
    expect(poemIds(s.returning)).toContain("greek-report-plan");
    const closed = untilBard(s.closed, "greek-courtyard");
    expect(closed.actors[bard].place).toBe("greek-courtyard");
    expect(poemIds(act(closed, "talk", bard))).toContain(
      "greek-courtyard-exposure",
    );
  });

  it("upgrades an older completed save and rejects invented visit records", () => {
    const s = openingFixture("exposure");
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

  it("validates authored recital choices and keeps couplets out of the pack", () => {
    for (const change of [
      (p) => (p.recital.verses[0].choice = "missing"),
      (p) => (p.recital.verses[0].lines = ["A couplet.", "Belongs in lore."]),
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
    ["burial", "greek-perform-burial"],
    ["exposure", "greek-report-plan"],
  ])(
    "weaves water, %s, and the public return from actual deeds",
    (branch, choice) => {
      const s = openingFixture(branch);
      expect(stanzas(s.arrival)).toEqual([]);
      expect(stanzas(s.waterOffer)).toEqual([]);
      expect(stanzas(s.closed).map((s) => s.id)).toEqual([
        "greek-return-water-jar",
        choice,
        `greek-courtyard-${branch}`,
      ]);
      expect(stanzas(reload(s.closed))).toEqual(stanzas(s.closed));
      expect(stanzas(s.closed).map((s) => s.turn)).toEqual(
        stanzas(s.closed)
          .map((s) => s.turn)
          .sort((a, b) => a - b),
      );
    },
  );

  it("keeps a permission report intact when the rite happens later, then reopens Dione's return", () => {
    const s = openingFixture("concession");
    expect(ids(s.permission)).toContain("greek-petition-burial");
    expect(ids(s.permission)).not.toContain("greek-perform-permitted-burial");
    expect(stanzas(s.buried).slice(0, 3)).toEqual(stanzas(s.permissionShared));
    expect(ids(s.buried)).toContain("greek-courtyard-concession");
    expect(
      s.permissionShared.packs["greek-drama"].receipts[
        "greek-courtyard-permitted-burial"
      ],
    ).toBeUndefined();
    expect(ids(s.closed).at(-1)).toBe("greek-courtyard-permitted-burial");
    expect(stanzas(reload(s.closed))).toEqual(stanzas(s.closed));
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
    expect(stanzas(reload(s.permissionShared))).toEqual(
      stanzas(s.permissionShared),
    );
  });

  it("allows water to enter the poem after the other quests and survives time away", () => {
    let world = openingFixture("exposure", { water: false }).closed;
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
    act(
      (a) =>
        a.kind === "give" &&
        a.item === "greek-water-jar" &&
        a.target === "greek-baker",
    );
    const poem = openingPoem(world);
    expect(poem.stanzas.at(-1).id).toBe("greek-return-water-jar");
    act((a) => a.kind === "move" && a.target === "greek-road-thebes");
    act((a) => a.kind === "move" && a.target === "greek-harbor");
    act((a) => a.kind === "wait");
    expect(openingPoem(reload(world))).toEqual(poem);
  });

  it("keeps completed verses through log pruning and rejects repeat or forged reports", () => {
    const s = openingFixture("concession");
    const world = structuredClone(s.closed);
    world.log = [];
    const before = encodeSave(world);
    const report = legalActions(s.beforeGraveReport).find(
      (a) =>
        a.kind === "give" &&
        a.item === "greek-burial-account" &&
        a.target === "greek-baker",
    );
    expect(report).toBeTruthy();
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
    openingFixture("exposure", { water: false }).decree,
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
  const marasPlay = (world, match) => {
    const offered = request(world, "view", "mara");
    const result = request(world, "play", "mara", {
      action: offered.actions.find(match),
    });
    expect(result.ok, result.error || JSON.stringify(result)).toBe(true);
    return result;
  };
  // Mara reports the plan by handing the guard the shovel.
  const taken = marasPlay(
    imported,
    (a) => a.kind === "take" && a.item === "greek-shovel",
  ).world;
  const result = marasPlay(
    taken,
    (a) =>
      a.kind === "give" &&
      a.item === "greek-shovel" &&
      a.target === "greek-guard",
  );
  expect(
    result.world.packs["greek-drama"].recitals["greek-report-plan"].actor,
  ).toBe("mara");
  const old = structuredClone(result.world);
  delete old.packs["greek-drama"].recitals;
  old.log = [];
  const upgraded = request(old, "upgrade", "vale", {
    from: "full-card-world/3",
  }).world;
  expect(upgraded.packs["greek-drama"].recitals["greek-report-plan"]).toEqual({
    actor: null,
    visit: null,
  });
  expect(stanzas(upgraded)).toEqual(stanzas(result.world));
  let moved = upgraded;
  const playAsVale = (match) => {
    const view = request(moved, "view", "vale");
    const result = request(moved, "play", "vale", {
      action: view.actions.find(match),
    });
    expect(result.ok, result.error || JSON.stringify(result)).toBe(true);
    moved = result.world;
  };
  playAsVale((a) => a.kind === "take" && a.item === "greek-guard-tablet");
  expect(
    moved.packs["greek-drama"].recitals["greek-report-plan"].actor,
  ).toBeNull();
  playAsVale((a) => a.kind === "move" && a.target === "greek-courtyard");
  playAsVale(
    (a) =>
      a.kind === "give" &&
      a.item === "greek-guard-tablet" &&
      a.target === "greek-baker",
  );
  playAsVale((a) => a.kind === "wait");
  expect(entityActive(moved, bard)).toBe(true);
  expect(poem(moved).stanzas[0]).toMatchObject({
    authorId: null,
    id: "greek-report-plan",
    authorName: "an earlier traveler",
  });
  expect(
    reload(moved).packs["greek-drama"].recitals["greek-report-plan"].actor,
  ).toBeNull();
});
