import { describe, expect, it, vi } from "vitest";
import { questLine } from "../v2/card-game/character-speech.mjs";
import { createHostedVoices } from "../v2/card-game/hosted-voices.mjs";

const play = (turn, verb, actorId, targetId = null) => ({
  turn,
  verb,
  actorId,
  targetId,
  kind: "action",
});
const say = (turn, actorId, text) => ({
  turn,
  text,
  generated: true,
  kind: actorId ? "dialogue" : "narration",
  actorId,
  entityId: actorId || "forest-cottage",
});

describe("voices speak only a completed quest's resident", () => {
  const world = {
    actors: {
      vale: { closed: { "quest:from:rati": [5, "k"], "quest:from:keeper": [4, "k"] } },
      rati: {},
      keeper: {},
    },
    log: [
      play(1, "move", "vale"),
      play(2, "wait", "vale"),
      play(3, "talk", "vale", "rati"),
      play(4, "drop", "vale"),
      play(5, "give", "vale", "rati"),
      play(5, "want_met", "vale"),
    ],
  };
  const lines = {
    arrival: say(1, "vale", "I have arrived."),
    caption: say(1, null, "Smoke rises from the cottage."),
    waited: say(2, "vale", "I will wait here."),
    asked: say(3, "vale", "Rati, what do you know?"),
    answered: say(3, "rati", "More than I say."),
    dropped: say(4, "keeper", "So you set it down."),
    giver: say(5, "vale", "Here it is."),
    thanked: say(5, "rati", "You found it for me."),
  };

  it("voices the resident whose quest the play completed", () => {
    expect(questLine(world, lines.thanked)).toBe(true);
    expect(questLine(world, { ...lines.thanked, silent: true })).toBe(false);
  });

  it("keeps a Wait, an arrival, a caption, a Talk and the player as text", () => {
    for (const name of ["arrival", "caption", "waited", "asked", "answered", "dropped", "giver"])
      expect(questLine(world, lines[name]), name).toBe(false);
  });

  it("names the quest occasion in a personal voice request", async () => {
    const fetcher = vi.fn(async (path) =>
      path === "/auth/account"
        ? Response.json({ authenticated: true })
        : new Response(new Uint8Array([255, 251]), {
            headers: { "Content-Type": "audio/mpeg" },
          }),
    );
    const hosted = createHostedVoices({ fetcher });
    await hosted.refresh();
    await hosted.voices.clip("rati", lines.thanked.text);
    const [, request] = fetcher.mock.calls.find(([p]) => p.endsWith("speech"));
    expect(JSON.parse(request.body)).toEqual({
      speaker: "rati",
      text: lines.thanked.text,
      occasion: "quest",
    });
  });
});
