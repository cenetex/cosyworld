import { describe, expect, it } from "vitest";
import compiled from "../v2/card-game/packs.json" with { type: "json" };
import frozen from "../v2/content/greek-drama/recital-rules20.json" with { type: "json" };
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { packDefinition } from "../v2/card-game/pack-registry.mjs";
import { storyQuestProblems } from "../v2/card-game/pack-story-schema.mjs";
import { authoredStoryDefinitions } from "../v2/card-game/pack-story-quests.mjs";
import {
  createStoryQuestValidator,
  validStoryQuest,
  syncStoryQuests,
} from "../v2/card-game/story-quests.mjs";
import { recitalPoem, validRecitals } from "../v2/card-game/pack-recital.mjs";
import { frozenVerseProblems } from "../v2/scripts/frozen-card-verses.mjs";
import {
  createWorld,
  encodeSave,
  decodeSave,
  legalActions,
  play,
} from "../v2/card-game/world.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

const previous = releasedCardEngine();
const greek = () =>
  structuredClone(compiled.packs.find((p) => p.id === "greek-drama"));
const problems = (pack) =>
  packProblems(
    pack,
    compiled.hub,
    compiled.packs.flatMap((p) => Object.keys(p.places)),
  );
function capacityPack() {
  const p = greek();
  delete p.release;
  while (p.choices.length < 512) {
    const id = `scale-choice-${p.choices.length}`;
    p.choices.push({
      id,
      subject: "greek-baker",
      at: "greek-courtyard",
      label: "Record a deed",
      text: "The traveler records a witnessed deed.",
      requires: [],
      effects: [{ kind: "set_flag", key: id, value: true }],
    });
  }
  const verseChoices = new Set(p.recital.verses.map((v) => v.choice));
  for (const c of p.choices)
    if (!verseChoices.has(c.id))
      p.recital.verses.push({
        choice: c.id,
        quest: `scale-quest-${p.recital.verses.length}`,
        lines: [
          "I carried water through the gate.",
          "The people kept a place for me.",
        ],
        summons: false,
      });
  p.storyQuests = Array.from({ length: 256 }, (_, i) => ({
    id: `story-scale-${i}`,
    line: "A deed enters the shared account.",
    holder: { kind: "place", id: "greek-courtyard" },
    art: "greek-water-jar",
    start: { kind: "receipt", choice: "greek-return-water-jar" },
    endings: [{ choice: "greek-return-water-jar" }],
  }));
  return p;
}

describe("bounded room for the Greek epic", () => {
  it("accepts 512 choices and verses with 256 story definitions", () => {
    const p = capacityPack();
    expect(p.recital.verses).toHaveLength(512);
    expect(problems(p)).toEqual([]);
    expect(storyQuestProblems(p, compiled.hub)).toEqual([]);
  });
  it("checks the choice, verse and both story boundaries", () => {
    const p = capacityPack();
    p.choices.push({ ...p.choices.at(-1), id: "scale-overflow" });
    expect(problems(p)).toContain(
      "greek-drama: choices must be a bounded record list",
    );
    p.choices.pop();
    p.recital.verses.push({ ...p.recital.verses.at(-1) });
    expect(problems(p)).toContain(
      "greek-drama: recital needs a singer, a title and up to 512 verses",
    );
    p.recital.verses.pop();
    p.storyQuests.push({ ...p.storyQuests.at(-1), id: "story-scale-overflow" });
    expect(problems(p)).toContain(
      "greek-drama: storyQuests must be a bounded record list",
    );
    expect(storyQuestProblems(p, compiled.hub)).toContain(
      "greek-drama: storyQuests must contain at most 256 definitions",
    );
  });
  it("bounds 64 claim groups with 512 supporting choices and 16 phrases", () => {
    const p = capacityPack();
    p.recital.claims = Array.from({ length: 64 }, () => ({
      phrases: Array.from({ length: 16 }, (_, i) => `i carried the gift ${i}`),
      anyChoices: p.recital.verses.map((v) => v.choice),
    }));
    expect(problems(p)).toEqual([]);
    const reason =
      "greek-drama: recital claims need bounded phrases and supporting verse choices";
    p.recital.claims.push(structuredClone(p.recital.claims[0]));
    expect(problems(p)).toContain(reason);
    p.recital.claims.pop();
    p.recital.claims[0].anyChoices.push(p.recital.verses[0].choice);
    expect(problems(p)).toContain(reason);
    p.recital.claims[0].anyChoices.pop();
    p.recital.claims[0].phrases.push("i carried another gift");
    expect(problems(p)).toContain(reason);
    p.recital.claims[0].phrases.pop();
    p.recital.verses[0].lines[0] = "x".repeat(91);
    expect(problems(p).join("\n")).toContain("recital verse needs");
  });
  it("matches the released resolver at capacity across changed receipts and account choices", () => {
    const p = capacityPack();
    for (const receipts of [{}, { "greek-return-water-jar": 3 }])
      for (const account of [undefined, "egypt", "troy"]) {
        const w = {
          packs: {
            [p.id]: {
              receipts,
              flags: {},
              choices: account ? { "greek-helen-account": account } : {},
              met: {},
            },
          },
        };
        for (const options of [
          {},
          { history: true },
          { history: true, group: "opening" },
        ])
          expect(authoredStoryDefinitions(w, [p], options)).toEqual(
            previous.definitions(w, [p], options),
          );
      }
  });
});

describe("frozen earned wording", () => {
  it("pins all 56 verse definitions to the exact Ajax interpreter", () => {
    const released = previous.packs.find((p) => p.id === frozen.packId);
    expect(frozen.rulesVersion).toBe("full-card-world/20");
    expect(frozen.verses).toHaveLength(56);
    expect(frozen.verses).toEqual(released.recital.verses);
    expect(frozenVerseProblems(greek(), frozen)).toEqual([]);
  });
  it.each(["lines", "after-lines", "after-choice", "remove"])(
    "requires a new identity for a released %s change",
    (field) => {
      const p = greek(),
        verse = p.recital.verses.find((v) => v.after);
      if (field === "lines") verse.lines[0] = "I heard a different song today.";
      if (field === "after-lines")
        verse.after.lines[0] = "I heard a different song today.";
      if (field === "after-choice")
        verse.after.choice = "greek-return-water-jar";
      if (field === "remove")
        p.recital.verses = p.recital.verses.filter((v) => v !== verse);
      expect(frozenVerseProblems(p, frozen)).toHaveLength(1);
    },
  );
  it("earns new wording through a new choice while the earlier receipt keeps its lines", () => {
    const p = packDefinition("greek-drama"),
      original = p.recital.verses[0];
    const addition = {
      ...structuredClone(original),
      choice: "greek-new-earned-verse",
      summons: false,
      lines: [
        "I carried news beside the bread.",
        "The room received another song.",
      ],
    };
    // Extend the mounted pack for this authored-action fixture, then restore it.
    p.recital.verses.push(addition);
    p.choices.push({
      id: addition.choice,
      subject: "greek-baker",
      at: "greek-courtyard",
      label: "Read the new verse",
      text: "Vale reads a new verse beside Dione.",
      requires: [{ kind: "met", actor: "greek-baker" }],
      effects: [{ kind: "set_flag", key: "greek-new-verse-read", value: true }],
    });
    try {
      expect(frozenVerseProblems(p, frozen)).toEqual([]);
      let w = createWorld({ packScopes: { "greek-drama": "full" } });
      w.actors.vale.place = "greek-courtyard";
      w.items["greek-water-jar"].holder = "vale";
      w.crossings["pond-greek-harbor"].discovered = true;
      w = play(
        w,
        legalActions(w).find((a) => a.choiceId === original.choice),
      ).state;
      const before = recitalPoem(w, p);
      expect(before.stanzas.map((s) => s.id)).toEqual([original.choice]);
      const action = legalActions(w).find(
        (a) => a.choiceId === addition.choice,
      );
      expect(action).toBeDefined();
      const result = play(w, action);
      expect(result.ok).toBe(true);
      w = result.state;
      expect(
        w.log.findLast((e) => e.choiceId === addition.choice),
      ).toMatchObject({
        verb: "choose",
        actorId: "vale",
        packId: p.id,
        turn: w.turn,
      });
      expect(w.packs[p.id].recitals[addition.choice]).toEqual({
        actor: "vale",
        visit: null,
      });
      expect(recitalPoem(decodeSave(encodeSave(w)), p).stanzas).toEqual([
        ...before.stanzas,
        {
          id: addition.choice,
          turn: w.turn,
          questId: addition.quest,
          lines: addition.lines,
        },
      ]);
    } finally {
      p.choices.pop();
      p.recital.verses.pop();
    }
  });
  it("preserves conditional wording for either visit order", () => {
    const p = greek(),
      v = p.recital.verses.find((v) => v.after);
    for (const earlier of [true, false]) {
      const w = {
        packs: {
          [p.id]: {
            receipts: { [v.choice]: 5, [v.after.choice]: earlier ? 2 : 8 },
          },
        },
      };
      expect(recitalPoem(w, p)).toEqual(previous.poem(w, p));
      expect(
        recitalPoem(w, p).stanzas.find((s) => s.id === v.choice).lines,
      ).toEqual(earlier ? v.after.lines : v.lines);
    }
  });
});

describe("story validation within one unchanged operation", () => {
  it("keeps output and saved authors equal to the current shared interpreter through real plays", () => {
    const current = releasedCardEngine(21);
    let w = createWorld();
    delete w.opening;
    w.actors.vale.place = "greek-courtyard";
    w.crossings["pond-greek-harbor"].discovered = true;
    w.items["greek-water-jar"].holder = "vale";
    for (const match of [
      (a) => a.choiceId === "greek-return-water-jar",
      (a) => a.kind === "wait",
      (a) => a.kind === "move" && a.target === "greek-well",
    ]) {
      const action = legalActions(w).find(match);
      expect(action).toBeDefined();
      const request = {
        op: "play",
        world: w,
        actor: "vale",
        claimed: ["vale"],
        present: ["vale"],
        action,
      };
      expect(dispatchShared(request)).toEqual(current.dispatch(request));
      w = play(w, action).state;
      expect(decodeSave(encodeSave(w))).toEqual(w);
    }
    const p = greek(),
      record = w.packs[p.id].recitals["greek-return-water-jar"];
    expect(Object.keys(record).sort()).toEqual(["actor", "visit"]);
    expect(record.actor).toBe("vale");
    record.actor = null;
    w.log = [];
    const restored = decodeSave(encodeSave(w));
    expect(
      restored.packs[p.id].recitals["greek-return-water-jar"].actor,
    ).toBeNull();
    expect(validRecitals(restored, p)).toBe(true);
    expect(recitalPoem(restored, p)).toEqual(previous.poem(restored, p));
    let older = previous.dispatch({ op: "create" }).world;
    delete older.opening;
    older.actors.vale.place = "greek-courtyard";
    older.items["greek-water-jar"].holder = "vale";
    older.crossings["pond-greek-harbor"].discovered = true;
    const oldAction = previous.dispatch({ op: "view", world: older }).actions.find(
      (action) => action.choiceId === "greek-return-water-jar",
    );
    expect(oldAction).toBeDefined();
    older = previous.dispatch({ op: "play", world: older, action: oldAction }).world;
    delete older.packs[p.id].recitals;
    older.log = [];
    const upgraded = decodeSave(JSON.stringify(older));
    expect(upgraded.packs[p.id].recitals["greek-return-water-jar"]).toEqual({
      actor: null,
      visit: null,
    });
    expect(decodeSave(encodeSave(upgraded))).toEqual(upgraded);
    expect(recitalPoem(upgraded, p)).toEqual(previous.poem(restored, p));
  });
  it("uses one definition snapshot for the batch and a fresh one for the next operation", () => {
    const w = createWorld();
    w.packs["greek-drama"].met["greek-baker"] = 0;
    w.packs["greek-drama"].met["greek-antigone"] = 0;
    w.packs["greek-drama"].receipts["greek-return-water-jar"] = 1;
    w.turn = w.revision = 1;
    syncStoryQuests(w);
    const quests = Object.values(w.quests.records).filter(
      (q) => q.mode === "story",
    );
    let reads = 0;
    const packs = w.packs;
    Object.defineProperty(w, "packs", {
      get() {
        reads++;
        return packs;
      },
      configurable: true,
    });
    const batch = createStoryQuestValidator(w);
    const together = quests.map(batch),
      batchReads = reads;
    reads = 0;
    expect(quests.map((q) => validStoryQuest(w, q))).toEqual(together);
    expect(reads).toBeGreaterThan(batchReads);
    expect(together.every(Boolean)).toBe(true);
    delete packs["greek-drama"].receipts["greek-return-water-jar"];
    delete packs["greek-drama"].met["greek-baker"];
    expect(
      createStoryQuestValidator(w)(
        quests.find((q) => q.key.endsWith("story-quest-greek-table")),
      ),
    ).toBe(false);
  });
});
