import { describe, expect, it } from "vitest";
import { createWorld } from "../v2/card-game/world.mjs";
import { rememberSubjects, upgradeSubjectMemories, validSubjectRecords } from "../v2/card-game/memory.mjs";
import { subjectMemories } from "../v2/card-game/inner-life.mjs";
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
