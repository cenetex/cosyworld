import {
  CAST_SIZE,
  addDistinctCharacters,
  characterKeys,
  readCharacter,
  readSuggestedCharacter,
  sampleSource,
} from "./authoring-cast.mjs";

import { holdJob, releaseJob, runJob } from "./authoring-jobs.mjs";

const noTrack = { accepted() {}, settled() {}, dropped() {} };
const WAITING = new Set(["generation_waiting", "network"]);
// Generation requests carry session text. Callers persist acceptedOutput only.
export async function generateCharacter(input, options = {}) {
  const { signal, fetch, env, onJob, onUpdate } = options;
  const result = await runJob("avatars", input, {
    signal,
    fetch,
    env,
    onJob,
    onUpdate,
  });
  if (!result || !Object.hasOwn(result, "candidate"))
    throw new Error("Character generation returned an incomplete result.");
  return result.candidate;
}

export function acceptedOutput({
  name,
  specialAbility,
  description,
  aliases,
  suggested,
}) {
  return {
    name,
    specialAbility,
    description,
    aliases: [...aliases],
    ...(suggested === true ? { suggested: true } : {}),
  };
}

export function createCharacterDraw({
  generate = generateCharacter,
  changed = () => {},
  randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0],
  id = () => crypto.randomUUID(),
  track = noTrack,
  fetch,
  env,
} = {}) {
  let text = "",
    mode = "extract",
    cards = [],
    selected = new Set(),
    epoch = 0,
    controller;
  let busy = false,
    error = "",
    completed = 0,
    status = 0,
    queued = false,
    code = "",
    retryAfterMs = 0;
  const notify = () => changed(api.state);
  function cancel() {
    epoch++;
    controller?.abort();
    busy = false;
  }
  function append(checked, reserved) {
    if (characterKeys(checked).some((key) => reserved.has(key))) return false;
    const candidate = { id: id(), ...acceptedOutput(checked) };
    cards = addDistinctCharacters(
      cards.filter((card) => selected.has(card.id)),
      [...cards.filter((card) => !selected.has(card.id)), candidate],
    ).characters;
    return true;
  }
  // One paid reply, held while this tab waits for it and applies it.
  async function ask(input, signal, sample, draftKey) {
    const askedMode = mode;
    let job;
    try {
      const value = await generate(input, {
        signal,
        fetch,
        env,
        onJob(accepted) {
          holdJob(accepted.id);
          job = {
            id: accepted.id,
            ...(draftKey ? { draftKey } : {}),
            kind: "avatars",
            mode: askedMode,
            // Story text stays out of the record unless adopting a reply needs it.
            ...(askedMode === "extract" ? { sample } : {}),
          };
          return Promise.resolve(track.accepted(job)).catch(() => {});
        },
        onUpdate(next) {
          if ((next.status === "queued") === queued) return;
          queued = next.status === "queued";
          notify();
        },
      });
      return { value, job };
    } catch (failure) {
      if (job) {
        releaseJob(job.id);
        if (!signal?.aborted && !WAITING.has(failure.code))
          await track.settled(job.id);
      }
      throw failure;
    } finally {
      queued = false;
    }
  }
  const api = {
    // A reply found again after a reload: it joins the cards like any other.
    adopt(value, sample, known = []) {
      if (value === null) return false;
      const checked =
        mode === "idea"
          ? readSuggestedCharacter(value)
          : readCharacter(value, sample);
      const added = append(checked, new Set(known.flatMap(characterKeys)));
      notify();
      return added;
    },
    get text() {
      return text;
    },
    get state() {
      return {
        mode,
        cards: structuredClone(cards),
        selected: [...selected],
        busy,
        error,
        completed,
        queued,
        status,
        code,
        retryAfterMs,
      };
    },
    setMode(value) {
      if (!["extract", "idea"].includes(value))
        throw new Error("Choose World idea or Story text.");
      if (value === mode) return;
      cancel();
      mode = value;
      error = "";
      completed = status = retryAfterMs = 0;
      code = "";
      notify();
    },
    setText(value) {
      if (typeof value !== "string") throw new Error("Enter world seed text.");
      if (value === text) return;
      cancel();
      text = value;
      error = "";
      status = retryAfterMs = 0;
      code = "";
      notify();
    },
    select(key) {
      if (!cards.some((card) => card.id === key)) return;
      if (selected.has(key)) selected.delete(key);
      else selected.add(key);
      notify();
    },
    chosen() {
      return cards.filter((card) => selected.has(card.id)).map(acceptedOutput);
    },
    remove(ids) {
      cancel();
      const removed = new Set(ids);
      cards = cards.filter((card) => !removed.has(card.id));
      for (const key of removed) selected.delete(key);
      notify();
    },
    clear() {
      cancel();
      text = "";
      mode = "extract";
      cards = [];
      selected.clear();
      error = "";
      completed = status = retryAfterMs = 0;
      code = "";
      notify();
    },
    cancel() {
      cancel();
      notify();
    },
    async find(known = [], draftKey) {
      cancel();
      const token = epoch;
      controller = new AbortController();
      const signal = controller.signal;
      busy = true;
      error = "";
      completed = status = retryAfterMs = 0;
      code = "";
      notify();
      try {
        const samples = sampleSource(text, { seed: randomSeed() });
        const reserved = new Set(known.flatMap(characterKeys));
        const names = known.flatMap((card) => [
          card.name,
          ...(card.aliases || []),
        ]);
        cards = cards.filter((card) => selected.has(card.id));
        names.push(...cards.flatMap((card) => [card.name, ...card.aliases]));
        for (
          let attempt = 0;
          attempt < CAST_SIZE && cards.length < CAST_SIZE;
          attempt++
        ) {
          const sample = samples[attempt % samples.length];
          const asked = await ask(
            {
              sample,
              excluded: [...new Set(names)].slice(-54),
              ...(mode === "idea" ? { mode } : {}),
            },
            signal,
            sample,
            draftKey,
          );
          try {
            const value = asked.value;
            if (token !== epoch) return;
            completed++;
            if (value === null) {
              notify();
              if (samples.length === 1) break;
              continue;
            }
            const checked =
              mode === "idea"
                ? readSuggestedCharacter(value)
                : readCharacter(value, sample);
            names.push(checked.name, ...checked.aliases);
            append(checked, reserved);
            notify();
          } finally {
            if (asked.job) {
              releaseJob(asked.job.id);
              if (token === epoch) await track.settled(asked.job.id);
            }
          }
        }
      } catch (failure) {
        if (token !== epoch) return;
        error =
          failure.name === "TimeoutError"
            ? "The request timed out. Choose Find more to try again."
            : failure.message;
        status = failure.status || 0;
        code = failure.code || "";
        retryAfterMs = Math.max(0, Number(failure.retryAfterMs) || 0);
      } finally {
        if (token === epoch) {
          busy = false;
          notify();
        }
      }
    },
  };
  return api;
}
