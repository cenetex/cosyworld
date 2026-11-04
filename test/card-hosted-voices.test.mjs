import { describe, expect, it, vi } from "vitest";
import { createHostedVoices } from "../v2/card-game/hosted-voices.mjs";
import { createVoiceClips } from "../v2/card-game/character-speech.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const audio = () =>
  new Response(new Uint8Array([255, 251]), {
    headers: { "Content-Type": "audio/mpeg" },
  });

describe("hosted voices in the browser", () => {
  it.each(["", "saved-world"])(
    "loads saved speech with an empty browser cache in %s",
    async (world) => {
      const fetcher = vi.fn(async (path) =>
        path === "/auth/account" ? json({ authenticated: true }) : audio(),
      );
      const hosted = createHostedVoices({ fetcher, world });
      const options = { client: hosted.voices, storage: null };
      const load = createVoiceClips(options);
      const signal = new AbortController().signal;
      const reference = world ? { play: "saved-play", line: 0 } : undefined;
      await expect(
        load("vale", "The lamp is steady.", signal, reference),
      ).rejects.toThrow("Sign in with your passkey");
      expect(fetcher).not.toHaveBeenCalled();

      await hosted.refresh();
      const clip = await load("vale", "The lamp is steady.", signal, reference);
      expect(clip.type).toBe("audio/mpeg");
      await load("vale", "The lamp is steady.", signal, reference);
      const calls = () =>
        fetcher.mock.calls.filter(([p]) => p.endsWith("speech"));
      expect(calls()).toHaveLength(1);
      expect(JSON.parse(calls()[0][1].body)).toEqual(
        world
          ? { world, ...reference }
          : { speaker: "vale", text: "The lamp is steady." },
      );
      // A new browser can fetch the same saved line from the server.
      await createVoiceClips(options)(
        "vale",
        "The lamp is steady.",
        signal,
        reference,
      );
      expect(calls()).toHaveLength(2);
    },
  );

  it("allows a fresh attempt after the server rate limit clears", async () => {
    let limited = true;
    const fetcher = vi.fn(async (path) =>
      path === "/auth/account"
        ? json({ authenticated: true })
        : limited
          ? json({ error: "Give the voices a moment." }, 429)
          : audio(),
    );
    const hosted = createHostedVoices({ fetcher });
    await hosted.refresh();
    const load = createVoiceClips({ client: hosted.voices, storage: null });
    const signal = new AbortController().signal;
    await expect(load("vale", "Hello.", signal)).rejects.toThrow(
      "Give the voices a moment.",
    );
    limited = false;
    await expect(load("vale", "Hello.", signal)).resolves.toBeInstanceOf(Blob);
    expect(
      fetcher.mock.calls.filter(([p]) => p.endsWith("speech")),
    ).toHaveLength(2);
  });

  it("offers free voices to a signed-in passkey", async () => {
    let authenticated = true;
    const fetcher = vi.fn(async (path) =>
      path === "/auth/account" ? json({ authenticated }) : audio(),
    );
    const voices = createHostedVoices({ fetcher });
    expect(voices.voices.available()).toBe(false);
    await voices.refresh();
    expect(voices.voices.available()).toBe(true);
    for (let i = 0; i < 3; i++) {
      const clip = await voices.voices.clip("vale", `Hello ${i}.`, undefined);
      expect(clip.type).toBe("audio/mpeg");
    }
    const [, request] = fetcher.mock.calls.find(([p]) => p.endsWith("speech"));
    expect(JSON.parse(request.body)).toEqual({
      speaker: "vale",
      text: "Hello 0.",
    });
    authenticated = false;
    await voices.refresh();
    expect(voices.voices.available()).toBe(false);
  });

  it("shows the server's reason when a voice is refused", async () => {
    const fetcher = async (path) =>
      path === "/card-game/speech"
        ? json({ error: "Give the voices a moment." }, 429)
        : json({ authenticated: true });
    const voices = createHostedVoices({ fetcher });
    await expect(voices.voices.clip("vale", "Hi.")).rejects.toThrow(
      "Give the voices a moment.",
    );
  });

  it("asks a shared world for a saved scene line", async () => {
    const calls = [];
    const fetcher = vi.fn(async (path, init = {}) => {
      calls.push([path, init.body && JSON.parse(init.body)]);
      return path === "/auth/account" ? json({ authenticated: true }) : audio();
    });
    const voices = createHostedVoices({ fetcher, world: "w1" });
    await voices.refresh();
    expect(voices.voices.available()).toBe(true);
    await expect(voices.voices.clip("vale", "Hello.")).rejects.toThrow(
      "Choose a saved character line",
    );
    await voices.voices.clip("vale", "Hello.", undefined, {
      play: "committed-play",
      line: 0,
    });
    expect(calls.find(([path]) => path.endsWith("speech"))[1]).toEqual({
      world: "w1",
      play: "committed-play",
      line: 0,
    });
  });
});
