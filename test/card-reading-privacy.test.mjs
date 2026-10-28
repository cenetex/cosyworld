import { describe, expect, it } from "vitest";
import {
  audienceMemory,
  validPrivateAudience,
  privateAudienceAllows,
} from "../v2/card-game/reading-privacy.mjs";
import {
  createWorld,
  addLog,
  validateWorld,
  encodeSave,
  decodeSave,
} from "../v2/card-game/world.mjs";
import { privateView } from "../v2/card-game/learning.mjs";

describe("private reading memories", () => {
  it("keeps private words with their original listeners during later public talk", () => {
    const privateTo = ["vale", "poet"];
    const memory = {
      text: "A private account.",
      turn: 4,
      privateTo,
      events: [
        { text: "Public words." },
        { text: "Private words.", privateTo },
      ],
      landmarks: [{ text: "A private deed.", privateTo }],
    };
    expect(audienceMemory(memory, ["vale", "poet"]).text).toBe(memory.text);
    const later = audienceMemory(memory, ["vale", "poet", "ash"]);
    expect(later.text).toBe(null);
    expect(later.events).toEqual([{ text: "Public words." }]);
    expect(later.landmarks).toEqual([]);
    expect(JSON.stringify(later)).not.toContain("privateTo");
    expect(privateAudienceAllows(memory, ["ash"])).toBe(false);
    expect(privateAudienceAllows(memory, [])).toBe(false);
  });
  it("keeps the server record while filtering another player's raw world view", () => {
    const world = createWorld();
    addLog(world, "Pip", "This account belongs to our small company.", {
      kind: "dialogue",
      actorId: "moth",
      generated: true,
      privateTo: ["vale", "moth"],
      cast: ["vale", "moth"],
    });
    Object.assign(world.memories.moth, {
      text: "Our private words.",
      turn: world.turn,
      privateTo: ["vale", "moth"],
    });
    validateWorld(world);
    const saved = decodeSave(encodeSave(world));
    expect(saved.log.at(-1).text).toBe(world.log.at(-1).text);
    expect(privateView(saved, "vale").log.at(-1).text).toBe(
      world.log.at(-1).text,
    );
    const outsider = privateView(saved, "ash");
    expect(JSON.stringify(outsider)).not.toContain("Our private words.");
    expect(JSON.stringify(outsider)).not.toContain(
      "This account belongs to our small company.",
    );
    expect(world.memories.moth.text).toBe("Our private words.");
    outsider.readingView = { actor: "ash", packs: {}, actions: [] };
    expect(() => validateWorld(outsider)).toThrow();
  });
  it("accepts bounded distinct real listeners", () => {
    const world = { actors: { vale: {}, poet: {} } };
    expect(validPrivateAudience(world, ["vale", "poet"])).toBe(true);
    expect(validPrivateAudience(world, ["vale", "vale"])).toBe(false);
    expect(validPrivateAudience(world, ["outsider"])).toBe(false);
  });
});
