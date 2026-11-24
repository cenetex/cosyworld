import cast from "./voices.json" with { type: "json" };
import { packEntity } from "./pack-registry.mjs";
import { expressionOf } from "./expression.mjs";
import { localVoiceClient } from "./local-service.mjs";
import { hostedVoices } from "./hosted-voices.mjs";
import { voiceTone } from "./voice-tone.mjs";
import { chanceLine } from "./voice-chance.mjs";

const connected = (client) => Boolean(client.available?.());
const voiceClient = () => localVoiceClient() || hostedVoices().voices;
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
  async function cacheKey(speaker, text, reference) {
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
          ...(reference ? [reference] : []),
        ]),
      ),
    );
    const id = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    return new URL(`./voice-cache/${id}.mp3`, import.meta.url).href;
  }
  async function generate(speaker, text, signal, reference) {
    const voice = characterVoices[speaker];
    if (!voice || !text.trim() || text.length > 1200)
      throw new Error("Choose a current character line.");
    const key = await cacheKey(speaker, text, reference);
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
      throw new Error("Sign in with your passkey to hear character voices.");
    const blob = await client.clip(speaker, text, signal, reference);
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
  async function clip(speaker, text, signal, reference) {
    signal.throwIfAborted();
    const key = await cacheKey(speaker, text, reference);
    signal.throwIfAborted();
    let job = pending.get(key);
    if (!job) {
      const controller = new AbortController();
      job = {
        controller,
        users: 0,
        promise: generate(speaker, text, controller.signal, reference),
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
  clip.remove = async (speaker, text, reference) => {
    const key = await cacheKey(speaker, text, reference);
    memory.delete(key);
    try {
      await (await storage?.open(CACHE))?.delete(key);
    } catch {}
  };
  return clip;
}

export const questLine = (world, line) =>
  Boolean(line?.actorId) &&
  !line.silent &&
  Number.isInteger(line.turn) &&
  world.log.some(
    (entry) =>
      !entry.generated &&
      entry.turn === line.turn &&
      entry.verb === "want_met" &&
      entry.ownerId === line.actorId &&
      entry.actorId !== line.actorId,
  );

export const voicedLine = (world, line) =>
  questLine(world, line) ||
  (Boolean(line?.actorId) && !line.silent && chanceLine(line.actorId, line.text));

// Reveal keys include words; listening history only needs the saved occurrence.
export const voiceLineIdentity = (line) =>
  JSON.stringify([line.seq, line.entityId || line.actorId || line.locationId]);

// Listening history belongs to presentation, never to the shared rules journal.
// Read storage each time so open tabs see one another's completed writes.
// This is not a cross-tab playback lock; simultaneous starts may still overlap.
export function createVoiceHistory(storage) {
  const memory = new Map(),
    unsaved = new Map();
  function entries(scope) {
    let keys = memory.get(scope) || new Set();
    try {
      const saved = JSON.parse(
        storage?.getItem(`cosyworld.voice-heard:${scope}`),
      );
      if (Array.isArray(saved))
        keys = new Set(
          saved.filter((key) => typeof key === "string").slice(-2048),
        );
    } catch {}
    for (const key of unsaved.get(scope) || []) keys.add(key);
    while (keys.size > 2048) keys.delete(keys.values().next().value);
    memory.set(scope, keys);
    return keys;
  }
  return {
    has: (scope, key) => entries(scope).has(key),
    add(scope, key) {
      const keys = entries(scope);
      keys.add(key);
      while (keys.size > 2048) keys.delete(keys.values().next().value);
      try {
        storage?.setItem(
          `cosyworld.voice-heard:${scope}`,
          JSON.stringify([...keys]),
        );
        unsaved.delete(scope);
      } catch {
        const pending = unsaved.get(scope) || new Set();
        pending.add(key);
        while (pending.size > 2048)
          pending.delete(pending.values().next().value);
        unsaved.set(scope, pending);
      }
    },
  };
}

const QUEUE_LINES = 3;
const QUEUE_SECONDS = 30;
const STALE_MS = 60_000;
const LETTERS_PER_SECOND = 14;
const spokenSeconds = (text) => text.length / LETTERS_PER_SECOND;

export function createCharacterSpeech({
  client = voiceClient(),
  load = createVoiceClips({ client }),
  makeContext = () =>
    new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  changed = () => {},
  history = createVoiceHistory(),
  scope = () => "session",
  now = () => Date.now(),
} = {}) {
  let context,
    source = null,
    playing = null,
    shown = null,
    failed = null,
    prefetch,
    enabled = true,
    paused = false;
  const queue = [];
  const running = () => Boolean(context && context.state === "running");
  const pending = (entry) =>
    Boolean(entry && (playing === entry || queue.includes(entry)));
  function state() {
    if (!enabled) return "off";
    const entry = shown?.entry;
    if (failed && failed.entry === entry && entry) return failed.state;
    if (
      shown &&
      characterVoices[shown.speaker] &&
      !connected(client) &&
      !pending(entry)
    )
      return "connect";
    if (entry && playing === entry) return source ? "playing" : "loading";
    return "ready";
  }
  const publish = () =>
    changed({
      key: shown?.key,
      state: state(),
      message: failed && failed.entry === shown?.entry ? failed.message : "",
    });
  const warn = (message) =>
    shown && changed({ key: shown.key, state: "error", message });
  function drop(entry) {
    entry.controller.abort();
    queue.splice(queue.indexOf(entry), 1);
  }
  function trim() {
    const fresh = scope();
    for (const entry of [...queue])
      if (entry.scope !== fresh || now() - entry.at > STALE_MS) drop(entry);
    while (
      queue.length > 1 &&
      (queue.length > QUEUE_LINES ||
        queue.reduce((sum, entry) => sum + spokenSeconds(entry.text), 0) >
          QUEUE_SECONDS)
    )
      drop(queue[0]);
  }
  function prepare(entry) {
    if (!entry.clip) {
      entry.clip = load(
        entry.speaker,
        entry.text,
        AbortSignal.any([
          entry.controller.signal,
          AbortSignal.timeout(client.timeoutMs || 25_000),
        ]),
        entry.reference,
      );
      entry.clip.catch(() => {});
    }
    return entry.clip;
  }
  function finished(entry) {
    if (playing !== entry) return;
    playing = null;
    publish();
    pump();
  }
  async function play(entry) {
    publish();
    try {
      if (entry.retry || !history.has(entry.scope, entry.key)) {
        const blob = await prepare(entry);
        let buffer;
        try {
          buffer = await context.decodeAudioData(await blob.arrayBuffer());
        } catch (error) {
          await load.remove?.(entry.speaker, entry.text, entry.reference);
          throw error;
        }
        if (playing !== entry) return;
        if (entry.retry || !history.has(entry.scope, entry.key)) {
          if (
            !Number.isFinite(buffer.duration) ||
            buffer.duration <= 0 ||
            buffer.duration > 90
          )
            throw new Error("This voice needs another try.");
          const node = context.createBufferSource();
          source = node;
          node.buffer = buffer;
          node.connect(voiceTone(context));
          node.onended = () => {
            if (source !== node) return;
            node.disconnect();
            source = null;
            finished(entry);
          };
          node.start();
          history.add(entry.scope, entry.key);
          publish();
          return;
        }
      }
    } catch (error) {
      if (playing !== entry || entry.controller.signal.aborted) return;
      failed = {
        entry,
        state: connected(client) ? "error" : "connect",
        message:
          error?.name === "TimeoutError"
            ? "This voice needs another try."
            : error?.message || "This voice needs another try.",
      };
    }
    finished(entry);
  }
  function pump() {
    if (!enabled || paused || playing || !running()) return;
    trim();
    for (const entry of queue) prepare(entry);
    const entry = queue.shift();
    if (!entry) return;
    playing = entry;
    void play(entry);
  }
  function enqueue({ retry = false } = {}) {
    if (
      !shown ||
      !enabled ||
      !characterVoices[shown.speaker] ||
      !connected(client) ||
      pending(shown.entry) ||
      (!retry && history.has(shown.scope, shown.key))
    )
      return;
    shown.entry = {
      ...shown,
      retry,
      at: now(),
      controller: new AbortController(),
    };
    queue.push(shown.entry);
    trim();
    if (running() && !paused) for (const entry of queue) prepare(entry);
  }
  function silence() {
    prefetch?.controller.abort();
    prefetch = null;
    for (const entry of [...queue]) drop(entry);
    if (playing) playing.controller.abort();
    playing = null;
    failed = null;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
      source = null;
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
          (connected(client) || pending(shown?.entry)),
      ),
    show(key, speaker, text, reference) {
      if (shown?.key === key && shown.scope === scope()) return;
      if (
        prefetch &&
        (prefetch.speaker !== speaker || prefetch.text !== text)
      ) {
        prefetch.controller.abort();
        prefetch = null;
      }
      shown = { key, speaker, text, reference, scope: scope() };
      shown.entry = [playing, ...queue].find(
        (entry) => entry && entry.key === key && entry.scope === shown.scope,
      );
      enqueue();
      publish();
      pump();
    },
    unlock() {
      if (!enabled) return;
      try {
        context ||= makeContext();
        if (!paused)
          void context
            .resume()
            .then(pump)
            .catch(() => warn("Tap the line to hear its voice."));
      } catch {
        warn("Voice playback needs another try.");
      }
    },
    pause(value) {
      paused = value;
      if (!context) return;
      if (paused) void context.suspend().catch(() => {});
      else
        void context
          .resume()
          .then(pump)
          .catch(() => {});
    },
    setEnabled(value) {
      enabled = value;
      if (!enabled) silence();
      else enqueue();
      publish();
      pump();
    },
    connectionChanged() {
      if (!connected(client)) for (const entry of [...queue]) drop(entry);
      else enqueue();
      publish();
      pump();
    },
    retry() {
      if (!shown) return;
      if (failed?.entry === shown.entry) failed = null;
      if (queue.includes(shown.entry)) drop(shown.entry);
      if (playing !== shown.entry) shown.entry = null;
      enqueue({ retry: true });
      publish();
      pump();
    },
    clear({ keepPrefetch = false } = {}) {
      if (!keepPrefetch) {
        prefetch?.controller.abort();
        prefetch = null;
      }
      shown = null;
      publish();
    },
    get busy() {
      return Boolean(enabled && running() && pending(shown?.entry));
    },
  };
}
