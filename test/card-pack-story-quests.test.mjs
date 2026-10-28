import { describe, expect, it } from "vitest";
import compiled from "../v2/card-game/packs.json" with { type: "json" };
import greekSource from "../v2/content/greek-drama/card-world.json" with { type: "json" };
import { packProblems } from "../v2/card-game/pack-schema.mjs";
import { storyQuestProblems } from "../v2/card-game/pack-story-schema.mjs";
import {
  authoredStoryDefinitions,
  authoredStoryIds,
  authoredStoryRelated,
} from "../v2/card-game/pack-story-quests.mjs";

const receipt = (choice) => ({ kind: "receipt", choice });
const first = "story-quest-orchard-help";
const second = "story-quest-orchard-return";
function orchard() {
  return {
    id: "orchard",
    avatars: { "orchard-host": {} },
    places: { "orchard-gate": {} },
    items: { "orchard-basket": {} },
    choices: ["ask", "prepare", "accept", "decline", "report"].map((name) => ({
      id: `orchard-${name}`,
      effects: [{ kind: "set_flag", key: `orchard-${name}`, value: true }],
    })),
    storyQuests: [
      {
        id: first,
        line: "The harvest needs a pair of hands.",
        holder: { kind: "avatar", id: "orchard-host" },
        art: "orchard-basket",
        start: receipt("orchard-ask"),
        progress: ["orchard-prepare"],
        endings: [
          { choice: "orchard-accept" },
          { choice: "orchard-decline", outcome: "Declined" },
        ],
      },
      {
        id: second,
        line: "Bring the harvest account home.",
        holder: { kind: "place", id: "orchard-gate" },
        art: "orchard-basket",
        start: { kind: "quest", key: first, status: "resolved" },
        endings: [{ choice: "orchard-report", outcome: "Shared" }],
        created: {
          earliest: [receipt("orchard-accept"), receipt("orchard-decline")],
        },
      },
    ],
  };
}
const world = (receipts = {}) => ({
  packs: {
    orchard: { receipts, choices: {}, flags: {}, met: {} },
  },
});

describe("authored pack stories", () => {
  it("shows a pending card before any ending gate matches", () => {
    const pack = orchard();
    const story = pack.storyQuests[0];
    story.defaultEnding = "orchard-decline";
    for (const ending of story.endings)
      ending.when = { kind: "flag", key: ending.choice, value: true };
    expect(storyQuestProblems(pack, compiled.hub)).toEqual([]);
    const before = world({ "orchard-ask": 2 });
    expect(authoredStoryDefinitions(before, [pack])[0]).toMatchObject({
      key: `orchard:${first}`,
      choiceId: "orchard-decline",
      createdTurn: 2,
      resolved: false,
      status: "pending",
    });
    before.packs.orchard.receipts["orchard-accept"] = 9;
    expect(authoredStoryDefinitions(before, [pack])[0].resolved).toBe(false);
    before.packs.orchard.flags["orchard-accept"] = true;
    expect(authoredStoryDefinitions(before, [pack])[0]).toMatchObject({
      choiceId: "orchard-accept",
      resolved: true,
      completion: "Fulfilled",
    });
  });
  it("runs a second pack's branches and dependent story from its data", () => {
    const pack = orchard();
    expect(storyQuestProblems(pack, compiled.hub)).toEqual([]);
    expect(authoredStoryIds([pack])).toEqual([first, second]);
    expect(authoredStoryDefinitions(world(), [pack])).toEqual([]);
    const began = authoredStoryDefinitions(world({ "orchard-ask": 2 }), [pack]);
    expect(began).toHaveLength(1);
    expect(began[0]).toMatchObject({
      key: `orchard:${first}`,
      resolved: false,
      createdTurn: 2,
    });
    for (const [ending, outcome] of [
      ["accept", "Fulfilled"],
      ["decline", "Declined"],
    ]) {
      const progress = world({
        "orchard-ask": 2,
        "orchard-prepare": 7,
        [`orchard-${ending}`]: 9,
      });
      const definitions = authoredStoryDefinitions(progress, [pack]);
      expect(definitions).toHaveLength(2);
      expect(definitions[0]).toMatchObject({
        choiceId: `orchard-${ending}`,
        completion: outcome,
        resolved: true,
        createdTurn: 2,
      });
      expect(definitions[1]).toMatchObject({
        key: `orchard:${second}`,
        resolved: false,
        createdTurn: 9,
      });
      progress.packs.orchard.receipts["orchard-report"] = 15;
      expect(authoredStoryDefinitions(progress, [pack])[1]).toMatchObject({
        completion: "Shared",
        resolved: true,
      });
    }
  });

  it("keeps packs separate and follows the first completed report", () => {
    const pack = orchard();
    const quest = pack.storyQuests[0];
    quest.endingOrder = "earliest";
    quest.related = "start-and-ending";
    const progress = world({
      "orchard-ask": 2,
      "orchard-accept": 8,
      "orchard-decline": 5,
    });
    const definitions = authoredStoryDefinitions(progress, [
      ...compiled.packs,
      pack,
    ]);
    expect(definitions[0]).toMatchObject({
      choiceId: "orchard-decline",
      completion: "Declined",
    });
    expect(
      authoredStoryRelated([pack], definitions[0], {
        packId: "orchard",
        choiceId: "orchard-ask",
      }),
    ).toBe(true);
    expect(
      authoredStoryRelated([pack], definitions[0], {
        packId: "orchard",
        choiceId: "orchard-accept",
      }),
    ).toBe(false);
    expect(
      authoredStoryRelated([pack], definitions[0], {
        packId: "another-pack",
        choiceId: "orchard-decline",
      }),
    ).toBe(false);
  });

  it.each([
    [
      "missing action",
      (p) => {
        p.storyQuests[0].start.choice = "unknown-action";
      },
    ],
    [
      "missing ending",
      (p) => {
        p.storyQuests[0].endings[0].choice = "unknown-action";
      },
    ],
    [
      "unknown flag",
      (p) => {
        p.storyQuests[0].start = {
          kind: "flag",
          key: "unknown-flag",
          value: true,
        };
      },
    ],
    [
      "unknown story",
      (p) => {
        p.storyQuests[1].start.key = "unknown-story";
      },
    ],
    [
      "duplicate key",
      (p) => {
        p.storyQuests[1].key = first;
      },
    ],
    [
      "unknown holder",
      (p) => {
        p.storyQuests[0].holder.id = "unknown-host";
      },
    ],
    [
      "personal knowledge in a world story",
      (p) => {
        p.storyQuests[0].start = {
          kind: "knows",
          topic: "orchard-news",
          role: "actor",
        };
      },
    ],
    [
      "empty requirements",
      (p) => {
        p.storyQuests[0].start = { any: [] };
      },
    ],
    [
      "unknown source",
      (p) => {
        p.storyQuests[0].created = receipt("unknown-action");
      },
    ],
  ])("rejects %s", (_name, change) => {
    const pack = orchard();
    change(pack);
    expect(storyQuestProblems(pack, compiled.hub).length).toBeGreaterThan(0);
  });

  it("rejects cycles through conditions and created-turn sources", () => {
    const pack = orchard();
    pack.storyQuests[0].start = {
      kind: "quest",
      key: second,
      status: "started",
    };
    expect(storyQuestProblems(pack, compiled.hub)).toContain(
      "orchard: story quest requirements contain a cycle",
    );
    pack.storyQuests[0].start = receipt("orchard-ask");
    pack.storyQuests[0].created = { kind: "quest", key: second };
    expect(storyQuestProblems(pack, compiled.hub)).toContain(
      "orchard: story quest requirements contain a cycle",
    );
    expect(
      authoredStoryDefinitions(world({ "orchard-ask": 2 }), [pack]),
    ).toHaveLength(1);
  });
});

describe("pack disclosure declarations", () => {
  const greek = () =>
    structuredClone(compiled.packs.find((pack) => pack.id === "greek-drama"));
  const problems = (pack) =>
    packProblems(
      pack,
      compiled.hub,
      compiled.packs.flatMap((p) => Object.keys(p.places)),
    );
  it("validates every migrated story and disclosure", () => {
    const pack = greek();
    expect(problems(pack)).toEqual([]);
    for (const field of ["storyQuests", "topics"])
      expect(pack[field].map(({ id }) => id)).toEqual(
        greekSource[field].map(({ id }) => id),
      );
  });
  it("allows an authored choice to require its actor's learned topic", () => {
    const pack = greek();
    pack.choices[0].requires.push({
      kind: "knows",
      topic: pack.topics[0].id,
      role: "actor",
    });
    expect(problems(pack)).toEqual([]);
  });
  it.each([
    [
      "short fact",
      (p) => {
        p.topics[0].text = "Mara arrived.";
      },
    ],
    [
      "unknown topic",
      (p) => {
        p.choices[0].requires.push({
          kind: "knows",
          topic: "missing-topic",
          role: "actor",
        });
      },
    ],
    [
      "wrong speaker",
      (p) => {
        p.topics[0].speaker = "greek-aethra";
      },
    ],
    [
      "wrong place",
      (p) => {
        p.topics[0].at = "greek-eleusis";
      },
    ],
    [
      "duplicate topic",
      (p) => {
        p.topics.push(structuredClone(p.topics[0]));
      },
    ],
  ])("rejects %s", (_name, change) => {
    const pack = greek();
    change(pack);
    expect(problems(pack).length).toBeGreaterThan(0);
  });
});
