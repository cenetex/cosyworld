import { describe, expect, it } from "vitest";
import {
  AUTHORED_TOPIC_LIMIT,
  packCompositionProblems,
  topicCompositionProblems,
} from "../v2/card-game/pack-schema.mjs";
import {
  KNOWLEDGE_FACT_LIMIT,
  newKnowledge,
  reserveKnowledge,
  validKnowledge,
  witnessKnowledge,
} from "../v2/card-game/knowledge.mjs";
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

  it("enforces the current topic boundary across mounted packs", () => {
    expect(AUTHORED_TOPIC_LIMIT).toBe(512);
    expect(AUTHORED_TOPIC_LIMIT).toBeLessThanOrEqual(KNOWLEDGE_FACT_LIMIT);
    expect(
      topicCompositionProblems([pack("orchard", 255), pack("harbor", 256)]),
    ).toEqual([]);
    expect(
      topicCompositionProblems([pack("orchard", 256), pack("harbor", 256)]),
    ).toEqual([]);
    expect(
      topicCompositionProblems([pack("orchard", 257), pack("harbor", 256)]),
    ).toEqual(["mounted packs have 513 topics; the shared limit is 512"]);
  });

  it("retains authored facts and rotates news within the saved fact budget", () => {
    const topics = [pack("orchard", 256), pack("harbor", 255)].flatMap((p) =>
      p.topics.map((topic) => ({
        ...topic,
        packId: p.id,
        speaker: "moth",
        at: "station",
        text: "The keeper recorded the earlier orchard account.",
      })),
    );
    expect(topicCompositionProblems([{ id: "mounted", topics }])).toEqual([]);
    const world = {
      turn: 1,
      eventSeq: 1,
      actors: { moth: { place: "station" }, vale: { place: "station" } },
      knowledge: newKnowledge(),
    };
    reserveKnowledge(world, "moth", "vale", { seq: 1, turn: 1 }, topics);
    expect(Object.keys(world.knowledge.facts)).toHaveLength(511);
    const news = () =>
      witnessKnowledge(world, {
        seq: ++world.eventSeq,
        turn: world.turn,
        kind: "action",
        verb: "give",
        actorId: "moth",
        locationId: "station",
        cast: ["moth"],
        text: "Pip carried a shell to the pond.",
      });
    const earlier = news();
    expect(earlier).toBeTruthy();
    expect(Object.keys(world.knowledge.facts)).toHaveLength(
      KNOWLEDGE_FACT_LIMIT,
    );
    const later = news();
    expect(later).toBeTruthy();
    expect(Object.keys(world.knowledge.facts)).toHaveLength(
      KNOWLEDGE_FACT_LIMIT,
    );
    expect(world.knowledge.facts[earlier.id]).toBeUndefined();
    expect(world.knowledge.known.moth[earlier.id]).toBeUndefined();
    expect(world.knowledge.facts[later.id]).toEqual(later);
    for (const topic of topics)
      expect(world.knowledge.facts[topic.id]?.source.kind, topic.id).toBe(
        "topic",
      );
    expect(
      validKnowledge(world, ["moth", "vale"], ["station"], topics),
    ).toBe(true);

    const oversized = structuredClone(world),
      eventSeq = ++oversized.eventSeq;
    oversized.knowledge.facts[`event:${eventSeq}`] = {
      ...later,
      id: `event:${eventSeq}`,
      source: { ...later.source, eventSeq },
    };
    expect(
      validKnowledge(oversized, ["moth", "vale"], ["station"], topics),
    ).toBe(false);
  });

  it("accepts packs whose content has no authored topics", () => {
    expect(
      topicCompositionProblems([{ id: "first" }, { id: "second", topics: [] }]),
    ).toEqual([]);
  });
});
