import { describe, expect, it } from "vitest";
import compiled from "../v2/card-game/packs.json" with { type: "json" };
import {
  AUTHORED_TOPIC_LIMIT,
  packCompositionProblems,
  packProblems,
} from "../v2/card-game/pack-schema.mjs";
import {
  KNOWLEDGE_FACT_LIMIT,
  KNOWLEDGE_PERSON_LIMIT,
  acceptKnowledgeSpeech,
  knowledgeDisclosures,
  knowsFact,
  newKnowledge,
  reserveKnowledge,
  validKnowledge,
  witnessKnowledge,
} from "../v2/card-game/knowledge.mjs";
import { dispatchShared } from "../v2/card-game/shared-world.mjs";
import { releasedCardEngine } from "./helpers/released-card-engine.mjs";

const greek = () => {
  const pack = structuredClone(
    compiled.packs.find((p) => p.id === "greek-drama"),
  );
  delete pack.release;
  return pack;
};
const problems = (pack) =>
  packProblems(
    pack,
    compiled.hub,
    compiled.packs.flatMap((p) => Object.keys(p.places)),
  );

describe("measured Greek catalog bounds", () => {
  it.each(["avatars", "items"])("accepts 256 %s and rejects 257", (field) => {
    const pack = greek();
    const sample =
      field === "avatars"
        ? pack.avatars["greek-ajax-teucer"]
        : pack.items["greek-ajax-tools"];
    while (Object.keys(pack[field]).length < 256)
      pack[field][`scale-${field}-${Object.keys(pack[field]).length}`] =
        structuredClone(sample);
    expect(problems(pack)).toEqual([]);
    pack[field][`scale-${field}-overflow`] = structuredClone(sample);
    expect(problems(pack)).toContain(
      `greek-drama: ${field} must be a bounded entity map`,
    );
  });

  it("keeps the 128-place bound", () => {
    const pack = greek();
    while (Object.keys(pack.places).length < 128) {
      const id = `scale-place-${Object.keys(pack.places).length}`;
      pack.places[id] = {
        ...structuredClone(pack.places["greek-ajax-grave"]),
        exits: ["greek-greek-camp"],
      };
      pack.places["greek-greek-camp"].exits.push(id);
    }
    expect(problems(pack)).toEqual([]);
    pack.places["scale-place-overflow"] = structuredClone(
      pack.places["greek-ajax-grave"],
    );
    expect(problems(pack)).toContain(
      "greek-drama: places must be a bounded entity map",
    );
  });

  it("accepts 512 authored topics and rejects 513 in a pack and a composition", () => {
    expect(AUTHORED_TOPIC_LIMIT).toBe(512);
    const pack = greek();
    const originalTopics = pack.topics;
    pack.topics = [
      ...originalTopics,
      ...Array.from({ length: 512 - originalTopics.length }, (_, i) => ({
        id: `scale-topic-${i}`,
        speaker: "greek-ajax-teucer",
        at: "greek-greek-camp",
        text: `The camp recorded household number ${i}.`,
        requires: [],
      })),
    ];
    expect(problems(pack)).toEqual([]);
    expect(
      packCompositionProblems([{ id: pack.id, topics: pack.topics }]),
    ).toEqual([]);
    const extra = { ...pack.topics[0], id: "scale-topic-overflow" };
    expect(
      packCompositionProblems([
        { id: pack.id, topics: pack.topics },
        { id: "second", topics: [extra] },
      ]),
    ).toContain("mounted packs have 513 topics; the shared limit is 512");
    pack.topics.push(extra);
    expect(problems(pack)).toContain(
      "greek-drama: topics must be a bounded record list",
    );
  });
});

const bare = () => ({
  turn: 0,
  eventSeq: 0,
  actors: { moth: { place: "station" }, vale: { place: "station" } },
  knowledge: newKnowledge(),
});
function news(world, number) {
  return witnessKnowledge(world, {
    seq: ++world.eventSeq,
    turn: ++world.turn,
    kind: "action",
    verb: "give",
    actorId: "moth",
    locationId: "station",
    cast: ["moth", "vale"],
    text: `Moth carried parcel number ${number} to the station.`,
  });
}
function lesson(world, topic) {
  world.turn++;
  const eventSeq = ++world.eventSeq;
  reserveKnowledge(world, "moth", "vale", { seq: eventSeq, turn: world.turn }, [
    topic,
  ]);
  const disclosures = knowledgeDisclosures(
    world,
    ["moth"],
    ["moth", "vale"],
    "station",
    eventSeq,
  );
  expect(disclosures[0]?.factId).toBe(topic.id);
  acceptKnowledgeSpeech(
    world,
    {
      seq: ++world.eventSeq,
      turn: world.turn,
      generated: true,
      kind: "dialogue",
      actorId: "moth",
      locationId: "station",
      cast: ["moth", "vale"],
      text: topic.text,
    },
    disclosures,
  );
}

describe("512 stored facts with protected source knowledge", () => {
  it("upgrades a valid released-20 snapshot at its 256-fact limit before new learning", () => {
    const old = releasedCardEngine(20),
      world = old.dispatch({ op: "create" }).world;
    for (let i = 0; i < 256; i++) {
      news(world, i);
      world.revision++;
    }
    expect(old.dispatch({ op: "validate", world }).ok).toBe(true);
    const before = structuredClone(world.knowledge);
    const result = dispatchShared({
      op: "upgrade",
      world,
      from: "full-card-world/20",
      to: "full-card-world/21",
    });
    expect(result.ok, result.error).toBe(true);
    expect(result.world.knowledge).toEqual(before);
    const added = news(result.world, 256);
    expect(Object.keys(result.world.knowledge.facts)).toHaveLength(257);
    expect(dispatchShared({ op: "validate", world: result.world }).ok).toBe(
      true,
    );
    expect(old.dispatch({ op: "validate", world: result.world }).ok).toBe(
      false,
    );
    const earlierSize = structuredClone(result.world);
    delete earlierSize.knowledge.facts[added.id];
    for (const known of Object.values(earlierSize.knowledge.known))
      delete known[added.id];
    expect(old.dispatch({ op: "validate", world: earlierSize }).ok).toBe(true);
  });
  it("keeps exactly 512 global and per-person event facts and prunes the oldest", () => {
    expect(KNOWLEDGE_FACT_LIMIT).toBe(512);
    expect(KNOWLEDGE_PERSON_LIMIT).toBe(512);
    const world = bare(),
      first = news(world, 0);
    for (let i = 1; i < 512; i++) news(world, i);
    expect(Object.keys(world.knowledge.facts)).toHaveLength(512);
    expect(Object.keys(world.knowledge.known.vale)).toHaveLength(512);
    expect(validKnowledge(world, ["moth", "vale"], ["station"])).toBe(true);
    const overflow = structuredClone(world);
    const added = news(world, 512);
    expect(Object.keys(world.knowledge.facts)).toHaveLength(512);
    expect(knowsFact(world, "vale", first.id)).toBe(false);
    expect(knowsFact(world, "vale", added.id)).toBe(true);
    overflow.knowledge.facts[added.id] = structuredClone(
      world.knowledge.facts[added.id],
    );
    overflow.turn = world.turn;
    overflow.eventSeq = world.eventSeq;
    expect(validKnowledge(overflow, ["moth", "vale"], ["station"])).toBe(false);
  });

  it("evicts event news for the 512th authored fact and preserves all authored facts", () => {
    const world = bare(),
      event = news(world, 0);
    const topics = Array.from({ length: 512 }, (_, i) => ({
      id: `source-topic-${i}`,
      packId: "scale",
      speaker: "moth",
      at: "station",
      text: `Moth recorded household number ${i}.`,
    }));
    for (const topic of topics.slice(0, 511)) lesson(world, topic);
    expect(Object.keys(world.knowledge.facts)).toHaveLength(512);
    expect(knowsFact(world, "vale", event.id)).toBe(true);
    lesson(world, topics.at(-1));
    expect(knowsFact(world, "vale", event.id)).toBe(false);
    expect(Object.keys(world.knowledge.known.vale)).toHaveLength(512);
    const before = structuredClone(world.knowledge);
    expect(news(world, 1)).toBeNull();
    expect(world.knowledge).toEqual(before);
    for (const topic of topics)
      expect(knowsFact(world, "vale", topic.id)).toBe(true);
    expect(validKnowledge(world, ["moth", "vale"], ["station"], topics)).toBe(
      true,
    );
  });
});
