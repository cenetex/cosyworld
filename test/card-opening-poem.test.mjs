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

const stanzas = (world) => openingPoem(world).stanzas;
const lines = (world) => stanzas(world).flatMap((s) => s.lines);
const reload = (world) => decodeSave(encodeSave(world));
const courtyard = (world) =>
  storyQuests(world).find((q) => q.id === STORY_QUEST_CARDS[2]);

describe("the opening poem", () => {
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
      expect(result.ok).toBe(true);
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
