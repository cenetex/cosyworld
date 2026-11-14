import { greekTravelTargets } from "./helpers/greek-travel.mjs";
import { describe, it, expect } from "vitest";
import {
  decodeSave,
  encodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { funeralJourney } from "./helpers/greek-funeral.mjs";
import { greekErrands } from "./helpers/greek-opening.mjs";
import { openDoorStart } from "./helpers/open-door.mjs";
import { recitalContext, recitalPoem } from "../v2/card-game/pack-recital.mjs";
import { narrativeContext } from "../v2/card-game/narrative.mjs";
import {
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
    expect(couplets).toHaveLength(60);
    expect(quotesLore(pack.recital)).toBe(false);
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
  it("carries the whole burial poem into a later conversation", () => {
    // Home at Dione's table after the burial; the Bard follows his own want.
    const buried = openDoorStart();
    const next = untilBard(act(reload(buried), "wait"), "greek-courtyard");
    expect(next.actors[bard].place).toBe("greek-courtyard");
    const talked = act(reload(next), "talk", bard);
    const context = narrativeContext(talked);
    expect(context.speakers).toContain(bard);
    expect(context.entities.find((e) => e.id === bard).poem).toEqual(
      poem(talked),
    );
    const song = facts(talked);
    expect(poemIds(talked)).toEqual(ids(buried));
    expect(quotesLore(context)).toBe(false);
    expect(poem(reload(talked))).toEqual(poem(talked));
    expect(song.length).toBeLessThanOrEqual(16);
    expect(
      song.every((f) => f.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(f)),
    ).toBe(true);
    expect(facts(reload(talked))).toEqual(song);
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
  it("weaves water, the burial, and the public return from actual deeds", () => {
    const errands = greekErrands();
    const { buried } = funeralJourney();
    expect(stanzas(errands.arrival)).toEqual([]);
    expect(stanzas(errands.waterOffer)).toEqual([]);
    // The water comes first: the bread that carries the rest needs it.
    expect(ids(buried)[0]).toBe("greek-return-water-jar");
    expect(ids(buried)).toContain("greek-bury-polynices");
    expect(stanzas(reload(buried))).toEqual(stanzas(buried));
    expect(stanzas(buried).map((s) => s.turn)).toEqual(
      stanzas(buried)
        .map((s) => s.turn)
        .sort((a, b) => a - b),
    );
  });
  it("keeps completed verses through log pruning and rejects a forged report", () => {
    const { buried } = funeralJourney();
    const world = structuredClone(buried);
    world.log = [];
    expect(openingPoem(reload(world))).toEqual(openingPoem(buried));
    // A burial receipt without the deed that sets its flag is forged.
    const fake = structuredClone(funeralJourney().veiled);
    fake.packs["greek-drama"].receipts["greek-bury-polynices"] = fake.turn;
    expect(() => decodeSave(JSON.stringify(fake))).toThrow(/fresh start/);
  });
});
it("credits a second player's burial deed to her in a shared world's poem", () => {
  const source = structuredClone(funeralJourney().veiled);

  const imported = dispatchShared({
    op: "create",
    save: encodeSave(source),
  }).world;
  imported.actors.mara.place = "greek-polynices-hollow";
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
  // Mara completes the last rite in the shared world.
  imported.items["greek-shovel"].holder = "mara";
  const result = marasPlay(
    imported,
    (a) =>
      a.kind === "give" &&
      a.item === "greek-shovel" &&
      a.target === "greek-antigone",
  );
  expect(
    result.world.packs["greek-drama"].recitals["greek-bury-polynices"].actor,
  ).toBe("mara");
});
