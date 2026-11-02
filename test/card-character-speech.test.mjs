import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import {
  characterVoices,
  createCharacterSpeech,
  createVoiceClips,
} from "../v2/card-game/character-speech.mjs";
import { publicAssets } from "../v2/card-game/public-assets.mjs";

const tick = async () => {
  for (let i = 0; i < 12; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const audio = () =>
  new Blob([new Uint8Array([255, 251, 144, 0, 1, 2])], { type: "audio/mpeg" });
const immediateCrypto = {
  subtle: {
    digest: async (_algorithm, bytes) =>
      createHash("sha256").update(bytes).digest(),
  },
};
function cacheStore() {
  const saved = new Map();
  const cache = {
    match: async (key) => saved.get(key)?.clone(),
    put: async (key, value) => saved.set(key, value.clone()),
    keys: async () => [...saved.keys()],
    delete: async (key) => saved.delete(key),
  };
  return { saved, open: async () => cache };
}
function fixture() {
  const sources = [],
    events = [];
  const context = {
    state: "suspended",
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    suspend: vi.fn(async () => {
      context.state = "suspended";
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 5 })),
    createBufferSource: () => {
      const source = {
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(source);
      return source;
    },
  };
  const client = { available: () => true };
  const load = vi.fn(async () => audio());
  const speech = createCharacterSpeech({
    client,
    load,
    makeContext: () => context,
    changed: (state) => events.push(state),
  });
  return { speech, context, sources, events, load, client };
}

describe("the six card character voices", () => {
  it("keeps prepared speech through a waiting screen and shares it with playback", async () => {
    let finish;
    const client = {
      available: () => true,
      clip: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(audio());
          }),
      ),
    };
    const load = createVoiceClips({
      client,
      storage: cacheStore(),
      crypto: immediateCrypto,
    });
    const f = fixture();
    const speech = createCharacterSpeech({
      client,
      load,
      makeContext: () => f.context,
    });
    speech.prefetch("vale", "The lamp is warm.");
    await vi.waitFor(() => expect(client.clip).toHaveBeenCalledTimes(1));
    speech.clear({ keepPrefetch: true });
    expect(client.clip.mock.calls[0][2].aborted).toBe(false);
    speech.show("current", "vale", "The lamp is warm.");
    speech.unlock();
    await tick();
    expect(client.clip).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() =>
      expect(f.sources[0]?.start).toHaveBeenCalledTimes(1),
    );
    speech.clear();
  });
  it("shares a prepared clip with playback and cancels it after its last listener leaves", async () => {
    let finish;
    const client = {
      available: () => true,
      voiceIdentity: "local",
      clip: vi.fn(
        (speaker, text, signal) =>
          new Promise((resolve, reject) => {
            finish = () => resolve(audio());
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      ),
    };
    const load = createVoiceClips({
      client,
      storage: cacheStore(),
      crypto: immediateCrypto,
    });
    const preparation = new AbortController(),
      playback = new AbortController();
    const first = load("vale", "The lamp is warm.", preparation.signal);
    await vi.waitFor(() => expect(client.clip).toHaveBeenCalledTimes(1));
    const second = load("vale", "The lamp is warm.", playback.signal);
    await tick();
    expect(client.clip).toHaveBeenCalledTimes(1);
    preparation.abort();
    await expect(first).rejects.toBeDefined();
    expect(client.clip.mock.calls[0][2].aborted).toBe(false);
    finish();
    await expect(second).resolves.toBeInstanceOf(Blob);
  });
  it("ships the exact six audition references with their transcripts", async () => {
    expect(Object.keys(characterVoices)).toEqual([
      "vale",
      "mara",
      "moth",
      "keeper",
      "badger",
      "greek-baker",
    ]);
    for (const voice of Object.values(characterVoices)) {
      expect(
        publicAssets.find((asset) => asset.file === voice.file)?.contentType,
      ).toBe("audio/mpeg");
      expect(
        (
          await readFile(
            new URL(`../v2/card-game/${voice.file}`, import.meta.url),
          )
        ).length,
      ).toBeGreaterThan(10000);
      expect(voice.transcript.length).toBeGreaterThan(50);
      expect(
        createHash("sha256")
          .update(
            await readFile(
              new URL(`../v2/card-game/${voice.file}`, import.meta.url),
            ),
          )
          .digest("hex"),
      ).toBe(voice.reference_sha256);
    }
  });
  it("reuses clips across reloads and keeps the spoken words out of cache keys", async () => {
    const storage = cacheStore();
    let available = true;
    const client = {
      available: () => available,
      clip: vi.fn(async () => audio()),
    };
    const options = { client, storage, crypto: webcrypto };
    const signal = new AbortController().signal;
    const load = createVoiceClips(options);
    for (const speaker of Object.keys(characterVoices))
      await load(speaker, "A fair trade.", signal);
    expect(client.clip).toHaveBeenCalledTimes(6);
    expect(client.clip.mock.calls[0].slice(0, 2)).toEqual([
      "vale",
      "A fair trade.",
    ]);
    available = false;
    await createVoiceClips(options)("vale", "A fair trade.", signal);
    expect(client.clip).toHaveBeenCalledTimes(6);
    expect([...storage.saved.keys()].join()).not.toContain("fair trade");
  });
  it("bounds the persistent cache and evicts damaged clips for a fresh retry", async () => {
    const storage = cacheStore();
    const client = { available: () => true, clip: vi.fn(async () => audio()) };
    const load = createVoiceClips({ client, storage, crypto: webcrypto });
    const signal = new AbortController().signal;
    for (let i = 0; i < 35; i++) await load("vale", `Line ${i}`, signal);
    expect(storage.saved.size).toBe(32);
    await load.remove("vale", "Line 34");
    await load("vale", "Line 34", signal);
    expect(client.clip).toHaveBeenCalledTimes(36);
    await expect(load("unknown", "Line", signal)).rejects.toThrow(
      "current character",
    );
    client.clip.mockResolvedValueOnce(new Blob(["bad"], { type: "text/html" }));
    await expect(load("vale", "Bad data", signal)).rejects.toThrow(
      "another try",
    );
  });
  it("waits for a gesture, plays the line once, pauses, and settles at audio end", async () => {
    const f = fixture();
    f.speech.show("first", "vale", "Hello.");
    await tick();
    expect(f.load).not.toHaveBeenCalled();
    f.speech.unlock();
    await tick();
    expect(f.speech.busy).toBe(true);
    expect(f.sources[0].start).toHaveBeenCalledOnce();
    f.speech.show("first", "vale", "Hello.");
    expect(f.load).toHaveBeenCalledOnce();
    f.speech.pause(true);
    expect(f.context.state).toBe("suspended");
    f.speech.pause(false);
    await tick();
    expect(f.context.state).toBe("running");
    expect(f.sources).toHaveLength(1);
    f.sources[0].onended();
    expect(f.speech.busy).toBe(false);
    expect(f.events.at(-1).state).toBe("ready");
  });
  it("drops late speech after skipping and stops speech immediately when muted", async () => {
    const f = fixture();
    let release;
    f.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    f.speech.unlock();
    f.speech.show("old", "vale", "Old line.");
    await tick();
    f.speech.show("new", "mara", "New line.");
    await tick();
    release(audio());
    await tick();
    expect(f.sources).toHaveLength(1);
    expect(f.events.at(-1).key).toBe("new");
    f.speech.setEnabled(false);
    expect(f.sources[0].stop).toHaveBeenCalledOnce();
    expect(f.speech.busy).toBe(false);
    f.speech.show("muted", "keeper", "Quiet.");
    await tick();
    expect(f.load).toHaveBeenCalledTimes(2);
  });
  it("clears a failed decode from cache and supports retry and unsupported speakers", async () => {
    const f = fixture();
    f.load.remove = vi.fn();
    f.context.decodeAudioData.mockRejectedValueOnce(new Error("Broken audio"));
    f.speech.unlock();
    f.speech.show("retry", "moth", "Please.");
    await tick();
    expect(f.events.at(-1).state).toBe("error");
    expect(f.speech.busy).toBe(false);
    expect(f.load.remove).toHaveBeenCalledWith("moth", "Please.");
    f.speech.retry();
    await tick();
    expect(f.events.at(-1).state).toBe("playing");
    f.speech.show("other", "echo", "bong");
    expect(f.speech.busy).toBe(false);
    expect(f.sources[0].stop).toHaveBeenCalledOnce();
  });
});
