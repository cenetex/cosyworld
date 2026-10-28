import { describe, expect, it } from "vitest";
import {
  AUTHORED_TOPIC_LIMIT,
  packCompositionProblems,
  topicCompositionProblems,
} from "../v2/card-game/pack-schema.mjs";
import { KNOWLEDGE_FACT_LIMIT } from "../v2/card-game/knowledge.mjs";
import { packDefinitions } from "../v2/card-game/pack-registry.mjs";

const pack = (id, count) => ({
  id,
  topics: Array.from({ length: count }, (_, index) => ({
    id: `${id}-news-${index}`,
  })),
});

describe("mounted topic identities and budget", () => {
  it("keeps story family IDs distinct across packs and shares them within a pack", () => {
    const first = {
      id: "orchard",
      storyQuests: [
        { id: "story-quest-help", key: "story-quest-help:first" },
        { id: "story-quest-help", key: "story-quest-help:later" },
      ],
    };
    expect(packCompositionProblems([first])).toEqual([]);
    const second = { id: "harbor", storyQuests: [{ id: "story-quest-help" }] };
    expect(packCompositionProblems([first, second])).toEqual([
      "harbor: story family story-quest-help is also defined by orchard",
    ]);
    second.storyQuests[0].id = "story-quest-harbor-help";
    expect(packCompositionProblems([first, second])).toEqual([]);
  });
  it("accepts distinct topics across several packs", () => {
    expect(
      topicCompositionProblems([pack("orchard", 4), pack("harbor", 3)]),
    ).toEqual([]);
    expect(topicCompositionProblems(packDefinitions)).toEqual([]);
  });

  it("rejects a topic ID reused by another mounted pack", () => {
    const orchard = pack("orchard", 1),
      harbor = pack("harbor", 1);
    harbor.topics[0].id = orchard.topics[0].id;
    expect(topicCompositionProblems([orchard, harbor])).toEqual([
      "harbor: topic orchard-news-0 is also defined by orchard",
    ]);
  });

  it("keeps an event budget when several packs fill their own topic lists", () => {
    expect(AUTHORED_TOPIC_LIMIT).toBeLessThanOrEqual(KNOWLEDGE_FACT_LIMIT / 2);
    expect(
      topicCompositionProblems([pack("orchard", 64), pack("harbor", 64)]),
    ).toEqual([]);
    expect(
      topicCompositionProblems([pack("orchard", 65), pack("harbor", 64)]),
    ).toEqual(["mounted packs have 129 topics; the shared limit is 128"]);
    expect(
      topicCompositionProblems([pack("orchard", 128), pack("harbor", 128)])
        .length,
    ).toBeGreaterThan(0);
  });

  it("accepts packs whose content has no authored topics", () => {
    expect(
      topicCompositionProblems([{ id: "first" }, { id: "second", topics: [] }]),
    ).toEqual([]);
  });
});
