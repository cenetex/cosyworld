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
  const client = { connection: () => ({ key: "fixture-key" }) };
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
  it("clones each saved reference with Drama 3 and reuses clips across reloads", async () => {
    const storage = cacheStore();
    const client = {
      connection: () => ({ key: "private-fixture-key" }),
      request: vi.fn(async () => audio()),
    };
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const options = { client, fetcher, storage, crypto: webcrypto };
    const signal = new AbortController().signal;
    const load = createVoiceClips(options);
    for (const speaker of Object.keys(characterVoices)) {
      await load(speaker, "A fair trade.", signal);
      const [path, request] = client.request.mock.calls.at(-1);
      expect(path).toBe("audio/speech");
      expect(request.body.model).toBe("fish-audio/drama-3");
      expect(request.body.input).toBe("A fair trade.");
      expect(request.body.instructions).toBe(
        characterVoices[speaker].direction,
      );
      expect(request.body.input_references[1].text).toBe(
        characterVoices[speaker].transcript,
      );
      expect(request.body.input_references[0].input_audio.data).toBe(
        "data:audio/mpeg;base64,AQID",
      );
      expect(request.raw).toBe(true);
    }
    expect(client.request).toHaveBeenCalledTimes(6);
    await load("vale", "A fair trade.", signal);
    client.connection = () => null;
    await createVoiceClips(options)("vale", "A fair trade.", signal);
    expect(client.request).toHaveBeenCalledTimes(6);
    expect([...storage.saved.keys()].join()).not.toContain(
      "private-fixture-key",
    );
    expect([...storage.saved.keys()].join()).not.toContain("fair trade");
  });
  it("bounds the persistent cache and evicts damaged clips for a fresh retry", async () => {
    const storage = cacheStore();
    const client = {
      connection: () => ({ key: "fixture" }),
      request: vi.fn(async () => audio()),
    };
    const load = createVoiceClips({
      client,
      storage,
      crypto: webcrypto,
      fetcher: async () => new Response("reference"),
    });
    const signal = new AbortController().signal;
    for (let i = 0; i < 35; i++) await load("vale", `Line ${i}`, signal);
    expect(storage.saved.size).toBe(32);
    await load.remove("vale", "Line 34");
    await load("vale", "Line 34", signal);
    expect(client.request).toHaveBeenCalledTimes(36);
    await expect(load("unknown", "Line", signal)).rejects.toThrow(
      "current character",
    );
    client.request.mockResolvedValueOnce(
      new Blob(["bad"], { type: "text/html" }),
    );
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
