import cast from "./voices.json" with { type: "json" };
import { playerOpenRouter } from "./openrouter.mjs";
import { localVoiceClient } from "./local-service.mjs";

const connected = (client) =>
  client.available?.() ?? Boolean(client.connection?.()?.key);
const voiceClient = () => localVoiceClient() || playerOpenRouter();
const audioType = (blob) => ["audio/mpeg", "audio/wav"].includes(blob.type);

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CLIPS = 32;
const CACHE = "cosyworld.card-voices.v1";
export const characterVoices = Object.freeze(cast.voices);

function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}

// Cache only generated audio. Credentials stay in the OpenRouter client.
export function createVoiceClips({
  client = voiceClient(),
  fetcher = globalThis.fetch,
  storage = globalThis.caches,
  crypto = globalThis.crypto,
} = {}) {
  const memory = new Map(),
    references = new Map();
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
  async function clip(speaker, text, signal) {
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
      throw new Error(
        "Connect OpenRouter in Settings to hear character voices.",
      );
    if (!client.clip && !references.has(speaker)) {
      const response = await fetcher(new URL(voice.file, import.meta.url), {
        signal,
      });
      if (!response.ok)
        throw new Error("The voice reference needs another try.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES)
        throw new Error("The voice reference needs another try.");
      references.set(speaker, `data:audio/mpeg;base64,${base64(bytes)}`);
    }
    const blob = client.clip
      ? await client.clip(speaker, text, signal)
      : await client.request("audio/speech", {
          signal,
          raw: true,
          body: {
            model: cast.model,
            input: text,
            instructions: voice.direction,
            response_format: "mp3",
            input_references: [
              {
                type: "input_audio",
                input_audio: { data: references.get(speaker) },
              },
              { type: "text", text: voice.transcript },
            ],
          },
        });
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
    enabled = true,
    paused = false;
  const publish = (state, message = "") =>
    changed({ key: current?.key, state, message });
  function stop(notify = true) {
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
    supports: (speaker) => Boolean(characterVoices[speaker]),
    speaks: (speaker) =>
      Boolean(
        enabled &&
          characterVoices[speaker] &&
          (connected(client) || current?.busy),
      ),
    show(key, speaker, text) {
      if (current?.key === key) return;
      stop(false);
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
    clear() {
      stop(false);
      current = null;
      publish("ready");
    },
    get busy() {
      return Boolean(current?.busy);
    },
  };
}
