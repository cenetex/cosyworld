import {
  CAST_SIZE,
  addDistinctCharacters,
  characterKeys,
  readCharacter,
  readSuggestedCharacter,
  sampleSource,
} from "./authoring-cast.mjs";

// Generation requests carry session text. Callers persist acceptedOutput only.
export async function generateCharacter(input, { signal } = {}) {
  const response = await fetch("/card-game/authoring/generate/avatars", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.any(
      [signal, AbortSignal.timeout(65_000)].filter(Boolean),
    ),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || value.error)
    throw Object.assign(
      new Error(value.error || "Character generation needs another try."),
      {
        status: response.status,
        code: value.code,
        retryAfterMs: value.retryAfterMs,
      },
    );
  if (!Object.hasOwn(value, "candidate"))
    throw new Error("Character generation returned an incomplete result.");
  return value.candidate;
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
    code = "",
    retryAfterMs = 0;
  const notify = () => changed(api.state);
  function cancel() {
    epoch++;
    controller?.abort();
    busy = false;
  }
  const api = {
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
    async find(known = []) {
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
          const value = await generate(
            {
              sample,
              excluded: [...new Set(names)].slice(-54),
              ...(mode === "idea" ? { mode } : {}),
            },
            { signal },
          );
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
          if (!characterKeys(checked).some((key) => reserved.has(key))) {
            const candidate = { id: id(), ...acceptedOutput(checked) };
            cards = addDistinctCharacters(
              cards.filter((card) => selected.has(card.id)),
              [...cards.filter((card) => !selected.has(card.id)), candidate],
            ).characters;
          }
          notify();
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
