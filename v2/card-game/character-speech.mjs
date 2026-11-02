import cast from "./voices.json" with { type: "json" };
import { packEntity } from "./pack-registry.mjs";
import { expressionOf } from "./expression.mjs";
import { localVoiceClient } from "./local-service.mjs";

const connected = (client) => Boolean(client.available?.());
// Hosted voices return as a credits purchase on the server (#1924).
const voiceClient = () => localVoiceClient() || { available: () => false };
const audioType = (blob) => ["audio/mpeg", "audio/wav"].includes(blob.type);

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CLIPS = 32;
const CACHE = "cosyworld.card-voices.v1";
export const characterVoices = Object.freeze(
  Object.fromEntries(
    Object.entries(cast.voices).filter(
      ([id]) => expressionOf(packEntity(id)) === "speech",
    ),
  ),
);

// Cache only generated audio; the voice client makes each clip.
export function createVoiceClips({
  client = voiceClient(),
  storage = globalThis.caches,
  crypto = globalThis.crypto,
} = {}) {
  const memory = new Map(),
    pending = new Map();
  const remember = (key, blob) => {
    memory.set(key, blob);
    if (memory.size > MAX_CLIPS) memory.delete(memory.keys().next().value);
  };
  async function cacheKey(speaker, text) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([
          cast.revision,
          cast.model,
          client.voiceIdentity || "openrouter",
          characterVoices[speaker],
          speaker,
          text,
        ]),
      ),
    );
    const id = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return new URL(`./voice-cache/${id}.mp3`, import.meta.url).href;
  }
  async function generate(speaker, text, signal) {
    const voice = characterVoices[speaker];
    if (!voice || !text.trim() || text.length > 1200)
      throw new Error("Choose a current character line.");
    const key = await cacheKey(speaker, text);
    if (memory.has(key)) return memory.get(key);
    let cache;
    try {
      cache = await storage?.open(CACHE);
      const saved = await cache?.match(key);
      if (saved) {
        const blob = await saved.blob();
        if (audioType(blob) && blob.size > 0 && blob.size <= MAX_BYTES) {
          remember(key, blob);
          return blob;
        }
        await cache.delete(key);
      }
    } catch {
      /* Memory still holds recent clips when storage is full. */
    }
    signal.throwIfAborted();
    if (!connected(client))
      throw new Error("Character voices are not available here yet.");
    const blob = await client.clip(speaker, text, signal);
    signal.throwIfAborted();
    if (!audioType(blob) || !blob.size || blob.size > MAX_BYTES)
      throw new Error("This voice needs another try.");
    remember(key, blob);
    try {
      await cache?.put(
        key,
        new Response(blob, {
          headers: {
            "Content-Type": blob.type,
            "Content-Length": String(blob.size),
          },
        }),
      );
      const keys = (await cache?.keys()) || [];
      let bytes = 0;
      // Keep the newest clips within 16 MiB, even across reloads.
      for (let i = keys.length - 1; i >= 0; i--) {
        const entry = await cache.match(keys[i]);
        bytes += Number(entry?.headers.get("content-length") || MAX_BYTES);
        if (keys.length - i > MAX_CLIPS || bytes > 16 * 1024 * 1024)
          await cache.delete(keys[i]);
      }
    } catch {
      /* The current clip remains available in memory. */
    }
    return blob;
  }
  async function clip(speaker, text, signal) {
    signal.throwIfAborted();
    const key = await cacheKey(speaker, text);
    signal.throwIfAborted();
    let job = pending.get(key);
    if (!job) {
      const controller = new AbortController();
      job = {
        controller,
        users: 0,
        promise: generate(speaker, text, controller.signal),
      };
      pending.set(key, job);
      const clear = () => {
        if (pending.get(key) === job) pending.delete(key);
      };
      void job.promise.then(clear, clear);
    }
    job.users++;
    let abort;
    const stopped = new Promise((_, reject) => {
      abort = () => reject(signal.reason || new Error("Voice stopped."));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([job.promise, stopped]);
    } finally {
      signal.removeEventListener("abort", abort);
      if (--job.users === 0 && pending.get(key) === job) {
        pending.delete(key);
        job.controller.abort();
      }
    }
  }
  clip.remove = async (speaker, text) => {
    const key = await cacheKey(speaker, text);
    memory.delete(key);
    try {
      await (await storage?.open(CACHE))?.delete(key);
    } catch {}
  };
  return clip;
}

export function createCharacterSpeech({
  client = voiceClient(),
  load = createVoiceClips({ client }),
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  changed = () => {},
} = {}) {
  let context,
    source,
    current,
    prefetch,
    enabled = true,
    paused = false;
  const publish = (state, message = "") =>
    changed({ key: current?.key, state, message });
  function stop(notify = true, keepPrefetch = false) {
    if (!keepPrefetch) {
      prefetch?.controller.abort();
      prefetch = null;
    }
    current?.controller?.abort();
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
      source = null;
    }
    if (current) {
      current.busy = false;
      current.attempted = true;
    }
    if (notify) publish(enabled ? "ready" : "off");
  }
  async function run() {
    if (
      !enabled ||
      paused ||
      !current ||
      current.attempted ||
      !context ||
      context.state !== "running"
    )
      return;
    const line = current;
    line.attempted = true;
    line.busy = true;
    line.controller = new AbortController();
    const signal = AbortSignal.any([
      line.controller.signal,
      AbortSignal.timeout(client.timeoutMs || 25_000),
    ]);
    publish("loading");
    try {
      const blob = await load(line.speaker, line.text, signal);
      signal.throwIfAborted();
      let buffer;
      try {
        buffer = await context.decodeAudioData(await blob.arrayBuffer());
      } catch (error) {
        await load.remove?.(line.speaker, line.text);
        throw error;
      }
      signal.throwIfAborted();
      if (current !== line) return;
      if (
        !Number.isFinite(buffer.duration) ||
        buffer.duration <= 0 ||
        buffer.duration > 90
      )
        throw new Error("This voice needs another try.");
      const playing = context.createBufferSource();
      source = playing;
      playing.buffer = buffer;
      playing.connect(context.destination);
      playing.onended = () => {
        if (current !== line || source !== playing) return;
        playing.disconnect();
        source = null;
        line.busy = false;
        publish("ready");
      };
      playing.start();
      publish("playing");
    } catch (error) {
      if (current !== line || line.controller.signal.aborted) return;
      line.busy = false;
      publish(
        connected(client) ? "error" : "connect",
        signal.aborted ? "This voice needs another try." : error.message,
      );
    }
  }
  return {
    prefetch(speaker, text) {
      if (
        !enabled ||
        !connected(client) ||
        !characterVoices[speaker] ||
        (prefetch?.speaker === speaker && prefetch.text === text)
      )
        return;
      prefetch?.controller.abort();
      const controller = new AbortController();
      prefetch = { speaker, text, controller };
      void load(speaker, text, controller.signal).catch(() => {});
    },
    supports: (speaker) => Boolean(characterVoices[speaker]),
    speaks: (speaker) =>
      Boolean(
        enabled &&
          characterVoices[speaker] &&
          (connected(client) || current?.busy),
      ),
    show(key, speaker, text) {
      if (current?.key === key) return;
      stop(false, prefetch?.speaker === speaker && prefetch.text === text);
      current = characterVoices[speaker]
        ? { key, speaker, text, attempted: false, busy: false }
        : null;
      publish(
        !enabled ? "off" : current && !connected(client) ? "connect" : "ready",
      );
      void run();
    },
    unlock() {
      if (!enabled) return;
      try {
        context ||= makeContext();
        if (!paused)
          void context
            .resume()
            .then(run)
            .catch(() => publish("error", "Tap the line to hear its voice."));
      } catch {
        publish("error", "Voice playback needs another try.");
      }
    },
    pause(value) {
      paused = value;
      if (!context) return;
      if (paused) void context.suspend().catch(() => {});
      else
        void context
          .resume()
          .then(run)
          .catch(() => {});
    },
    setEnabled(value) {
      enabled = value;
      if (!enabled) stop();
      else {
        if (current) current.attempted = false;
        void run();
      }
    },
    connectionChanged() {
      stop(false);
      if (current) current.attempted = false;
      publish(connected(client) ? "ready" : "connect");
      void run();
    },
    retry() {
      stop(false);
      if (current) current.attempted = false;
      void run();
    },
    stop,
    clear({ keepPrefetch = false } = {}) {
      stop(false, keepPrefetch);
      current = null;
      publish("ready");
    },
    get busy() {
      return Boolean(current?.busy);
    },
  };
}
