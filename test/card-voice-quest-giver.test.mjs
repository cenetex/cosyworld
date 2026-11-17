import { describe, expect, it, vi } from "vitest";
import { addLog, createWorld } from "../v2/card-game/world.mjs";
import { narrativeContext, speechOccasions } from "../v2/card-game/narrative.mjs";
import { dialogueCast } from "../v2/card-game/scene-cast.mjs";
import { questLine, voicedLine } from "../v2/card-game/character-speech.mjs";
import { createHostedVoices } from "../v2/card-game/hosted-voices.mjs";
import { VOICE_CHANCE, chanceLine } from "../v2/card-game/voice-chance.mjs";
import fixture from "./fixtures/voice-chance.json" with { type: "json" };

const completed = ({ verb, giverAt = "station", quest = true, met = true }) => {
  const s = createWorld();
  s.actors.moth.want = s.actors.keeper.want = null;
  s.actors.moth.metTurn = s.actors.keeper.metTurn = 0;
  s.turn = s.revision = 6;
  s.actors.vale.place = "station";
  s.actors.moth.place = giverAt;
  s.actors.keeper.place = "pond";
  const target = verb === "give" ? "moth" : null;
  addLog(s, "World", "Vale plays.", {
    kind: "action",
    verb,
    actorId: "vale",
    targetId: target,
    ...(verb === "move" ? { fromLocationId: "pond" } : {}),
  });
  if (met)
    addLog(s, "World", "Vale and Pip talk at last.", {
      kind: "narration",
      verb: "want_met",
      actorId: "vale",
    });
  if (verb === "give")
    addLog(s, "World", "Pip has the Lamp at last.", {
      kind: "narration",
      verb: "want_met",
      actorId: "moth",
    });
  if (quest) s.actors.vale.closed = { "quest:from:moth": [s.turn, "k"] };
  return s;
};
const speakers = (s) => speechOccasions(s, dialogueCast(s)).speakers;
const said = (s, actorId) => ({
  turn: s.turn,
  actorId,
  kind: "dialogue",
  generated: true,
  text: "Line 52.",
});

describe("a quest's giver speaks when its quest is completed", () => {
  it("voices a present giver when a Move completes the quest", () => {
    const s = completed({ verb: "move" });
    expect(speakers(s)).toContain("moth");
    expect(questLine(s, said(s, "moth"))).toBe(true);
    const moth = narrativeContext(s).entities.find((e) => e.id === "moth");
    expect(moth.facts[0]).toBe("Vale did what I asked.");
  });

  it("voices the giver of a Give quest once", () => {
    const s = completed({ verb: "give" });
    expect(speakers(s).filter((id) => id === "moth")).toEqual(["moth"]);
  });

  it("gives no line and no voice to an absent giver", () => {
    const s = completed({ verb: "move", giverAt: "attic" });
    expect(speakers(s)).not.toContain("moth");
    for (const id of speakers(s)) expect(voicedLine(s, said(s, id))).toBe(false);
  });

  it("adds no speaker when no quest was completed", () => {
    for (const verb of ["move", "give"]) {
      expect(speakers(completed({ verb, met: false }))).toEqual(
        speakers(completed({ verb, quest: false, met: false })),
      );
      const others = (s) => speakers(s).filter((id) => id !== "moth");
      expect(others(completed({ verb }))).toEqual(others(completed({ verb, quest: false })));
    }
  });
});

describe("other character lines are voiced by a fixed chance", () => {
  it("voices about five lines in a hundred", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => chanceLine("vale", `Line ${i}.`));
    const share = lines.filter(Boolean).length / lines.length;
    expect(Math.abs(share - VOICE_CHANCE)).toBeLessThanOrEqual(0.01);
  });

  it("decides each line the same way as the server", () => {
    for (const { speaker, text, voiced } of fixture)
      expect(chanceLine(speaker, text), text).toBe(voiced);
  });

  it("voices no caption or narration", () => {
    const s = completed({ verb: "move", quest: false });
    expect(voicedLine(s, { ...said(s, null), text: "Line 51." })).toBe(false);
    expect(voicedLine(s, { ...said(s, "moth"), text: "Line 51." })).toBe(true);
    expect(voicedLine(s, { ...said(s, "moth"), text: "Line 51.", silent: true })).toBe(false);
  });

  it("names the chance occasion in a personal request", async () => {
    const fetcher = vi.fn(async (path) =>
      path === "/auth/account"
        ? Response.json({ authenticated: true })
        : new Response(new Uint8Array([255, 251]), {
            headers: { "Content-Type": "audio/mpeg" },
          }),
    );
    const hosted = createHostedVoices({ fetcher });
    await hosted.refresh();
    await hosted.voices.clip("moth", "Line 51.");
    const [, request] = fetcher.mock.calls.find(([p]) => p.endsWith("speech"));
    expect(JSON.parse(request.body)).toEqual({
      speaker: "moth",
      text: "Line 51.",
      occasion: "chance",
    });
  });
});
