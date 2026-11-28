import { describe, expect, it } from "vitest";
import { createWorld, nameOf, places } from "../v2/card-game/world.mjs";
import { rememberSubjects, upgradeSubjectMemories, validSubjectRecords } from "../v2/card-game/memory.mjs";
import { createMemorySummaries, innerLifeChain, subjectMemories } from "../v2/card-game/inner-life.mjs";
import { privateView } from "../v2/card-game/learning.mjs";

describe("retained subject memories", () => {
  const setup = () => {
    const world = createWorld();
    world.turn = 3;
    world.eventSeq = 20;
    const entry = { seq: 20, turn: 3, actorId: "moth", targetId: "vale",
      locationId: "station", cast: ["moth", "vale"], verb: "give",
      itemId: "cloth", accepted: true, kind: "action", speaker: "Pip",
      text: "A sentence that should not be retained verbatim.",
      items: [{ id: "cloth", holder: "vale" }] };
    return { world, entry };
  };
  it("keeps a witnessed gift without the original words or journal", () => {
    const { world, entry } = setup();
    rememberSubjects(world, "vale", entry);
    const records = world.memories.vale.subjects;
    expect(validSubjectRecords(world, "vale", records)).toBe(true);
    expect(JSON.stringify(records)).not.toContain(entry.text);
    world.log = [];
    world.memories.vale.events = [];
    world.memories.vale.landmarks = [];
    const summary = subjectMemories(world, "vale").find((m) => m.id === "cloth");
    expect(summary.summary).toContain("Received Black cloth from Pip at Empty station.");
    expect(privateView(world, "moth").memories.vale.subjects).toBeUndefined();
    expect(subjectMemories(world, "vale", (id) => id !== "cloth").some((m) => m.id === "cloth")).toBe(false);
  });
  it("does not store invented or unwitnessed scenes", () => {
    const { world, entry } = setup();
    const before = JSON.stringify(world.memories.vale.subjects);
    rememberSubjects(world, "vale", { ...entry, generated: true });
    rememberSubjects(world, "vale", { ...entry, actorId: "moth", targetId: "moth", cast: ["moth"] });
    expect(JSON.stringify(world.memories.vale.subjects)).toBe(before);
  });
  it("migrates retained evidence only and rejects free text records", () => {
    const { world, entry } = setup();
    world.log = [entry];
    delete world.memories.vale.subjects;
    world.memories.vale.events = [{ seq: 20, turn: 3, kind: "event", text: `Pip: ${entry.text}` }];
    upgradeSubjectMemories(world);
    expect(world.memories.vale.subjects.cloth.deeds[0].verb).toBe("give");
    world.memories.vale.subjects.cloth.text = entry.text;
    expect(validSubjectRecords(world, "vale", world.memories.vale.subjects)).toBe(false);
  });
});

describe("first-person memory summaries", () => {
  const memory = { id: "cloth", summary: "Received Black cloth from Pip." };
  function setup(saved = null) {
    let value = saved;
    const requested = [];
    const storage = {
      getItem: () => value,
      setItem: (_, next) => { value = next; },
    };
    const request = (actor, subjects, signal) => {
      const reply = Promise.withResolvers();
      requested.push({ actor, subjects, signal, ...reply });
      return reply.promise;
    };
    const updated = [];
    const open = () => createMemorySummaries({
      storage, key: "summaries", request, update: () => updated.push(true),
    });
    return { open, requested, updated };
  }

  it("keeps facts visible, reuses a summary for the same evidence, and refreshes changed memories", async () => {
    const { open, requested, updated } = setup();
    const summary = open();
    expect(summary.show(1, "vale", [memory])).toEqual([memory]);
    summary.show(1, "vale", [memory]);
    expect(requested).toHaveLength(1);
    expect(requested[0].subjects).toEqual([{ id: "cloth", evidence: memory.summary }]);
    requested[0].resolve({ cloth: "I remember Pip giving me the black cloth.", pond: "I remember the pond." });
    await Promise.resolve();
    expect(updated).toHaveLength(1);
    const reloaded = open();
    expect(reloaded.show(1, "vale", [memory])[0].summary).toBe("I remember Pip giving me the black cloth.");
    expect(requested).toHaveLength(1);
    const changed = { ...memory, summary: "Left Black cloth at Station." };
    expect(reloaded.show(1, "vale", [changed])).toEqual([changed]);
    expect(requested[1].subjects[0].evidence).toBe(changed.summary);
  });

  it("prioritizes an older witnessed gift over newer sightings in the twelve-subject batch", () => {
    const { open, requested } = setup();
    const world = createWorld();
    world.turn = 4;
    world.eventSeq = 20;
    world.life.actors.vale.experiences = [
      { kind: "gift", other: "moth", item: "cloth", place: "station", turn: 1 },
    ];
    const visited = Object.keys(places).filter((id) => id !== "station").slice(0, 13);
    visited.forEach((locationId, index) => {
      rememberSubjects(world, "vale", { seq: index + 2, turn: 4, locationId, cast: ["vale"] });
    });
    const memories = subjectMemories(world, "vale");
    expect(memories.slice(0, 13).every((memory) => !memory.significant)).toBe(true);

    expect(open().show(1, "vale", memories)).toEqual(memories);
    const batch = requested[0].subjects;
    expect(batch).toHaveLength(12);
    expect(batch.slice(0, 3).map(({ id }) => id)).toEqual(expect.arrayContaining(["cloth", "moth", "station"]));
    expect(batch.find(({ id }) => id === "cloth").evidence).toContain("Received Black cloth from Pip at Empty station.");
  });

  it("discards the old cache and only reuses accepted provider text after reload", async () => {
    const { open, requested } = setup(JSON.stringify({
      scope: JSON.stringify([1, "vale"]),
      entries: [[memory.id, { evidence: memory.summary, text: "I remembered this in an old version." }]],
    }));
    const missing = { id: "pond", summary: "I have been here." };
    const rejected = { id: "moth", summary: "We have spoken." };
    const memories = [memory, missing, rejected];
    expect(open().show(1, "vale", memories)).toEqual(memories);
    const accepted = "I remember receiving the Black cloth from Pip.";
    requested[0].resolve({ cloth: accepted, moth: "Vale remembers speaking to Pip." });
    await Promise.resolve();

    const reloaded = open().show(1, "vale", memories);
    expect(reloaded).toEqual([{ ...memory, summary: accepted }, missing, rejected]);
    expect(requested[1].subjects).toEqual([
      { id: "pond", evidence: missing.summary },
      { id: "moth", evidence: rejected.summary },
    ]);
  });

  it("sends canonical evidence and only displays names visible to the avatar", async () => {
    const { open, requested } = setup();
    const world = createWorld();
    const room = "elysium-void-002", resident = "elysium-claude";
    world.turn = 3;
    world.eventSeq = 8;
    rememberSubjects(world, "vale", {
      seq: 8, turn: 3, locationId: room, cast: ["vale", resident, "moth"],
      items: [{ id: "cloth", holder: room }],
    });
    const canonicalName = nameOf(resident);
    const aliasName = "Ashen Veil";
    const read = (text) => text.replaceAll(canonicalName, aliasName);
    const known = (id) => id !== "moth" && id !== "cloth";
    const { memories } = innerLifeChain(world, "vale", read, known);
    const placeMemory = memories.find(({ id }) => id === room);
    expect(placeMemory).toMatchObject({
      evidence: `Met ${canonicalName} here.`,
      summary: `Met ${aliasName} here.`,
    });
    expect(memories.find(({ id }) => id === resident).name).toBe(aliasName);
    expect(JSON.stringify(memories)).not.toMatch(/Pip|Black cloth/);

    const summary = open();
    summary.show(1, "vale", memories, read);
    expect(requested[0].subjects).toContainEqual({ id: room, evidence: placeMemory.evidence });
    expect(JSON.stringify(requested[0].subjects)).not.toMatch(/Ashen Veil|Pip|Black cloth/);
    requested[0].resolve({ [room]: `I met ${canonicalName} there.` });
    await Promise.resolve();
    expect(summary.show(1, "vale", memories, read).find(({ id }) => id === room).summary)
      .toBe(`I met ${aliasName} there.`);
  });

  it("ignores replies after closing and separates worlds and characters", async () => {
    const { open, requested, updated } = setup();
    const summary = open();
    summary.show(1, "vale", [memory]);
    summary.close();
    expect(requested[0].signal.aborted).toBe(true);
    requested[0].resolve({ cloth: "I carried the cloth." });
    await Promise.resolve();
    expect(updated).toHaveLength(0);
    expect(summary.show(1, "moth", [memory])).toEqual([memory]);
    expect(requested[1].actor).toBe("moth");
    requested[1].resolve({ cloth: "I remember the cloth." });
    await Promise.resolve();
    expect(summary.show(2, "moth", [memory])).toEqual([memory]);
  });
});
