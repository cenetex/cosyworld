import { describe, expect, it, vi } from "vitest";
import { createHostedVoices } from "../v2/card-game/hosted-voices.mjs";

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
