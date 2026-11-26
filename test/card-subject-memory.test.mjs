import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { rememberSubjects, upgradeSubjectMemories, validSubjectRecords } from "../v2/card-game/memory.mjs";
import { createMemorySummaries, subjectMemories } from "../v2/card-game/inner-life.mjs";
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
    expect(summary.summary).toContain("Received Black cloth from Pip.");
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
  function setup() {
    let value = null;
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
