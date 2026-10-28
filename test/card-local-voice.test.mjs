import { it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import {
  createVoiceClips,
  createCharacterSpeech,
} from "../v2/card-game/character-speech.mjs";

it("loads local WAV voices through the same playback and cache boundary", async () => {
  const client = {
    available: () => true,
    voiceIdentity: ["turbo", "local-v1"],
    clip: vi.fn(async () => new Blob(["audio"], { type: "audio/wav" })),
  };
  const load = createVoiceClips({ client, crypto: webcrypto });
  const signal = new AbortController().signal;
  expect((await load("vale", "Hello.", signal)).type).toBe("audio/wav");
  await load("vale", "Hello.", signal);
  expect(client.clip).toHaveBeenCalledTimes(1);
  expect(client.clip.mock.calls[0].slice(0, 2)).toEqual(["vale", "Hello."]);
  const speech = createCharacterSpeech({ client, load });
  expect(speech.speaks("vale")).toBe(true);
  expect(speech.speaks("unknown")).toBe(false);
  speech.connectionChanged();
});
