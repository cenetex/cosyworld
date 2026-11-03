// Words the story service wrote come back to it with the signed envelope it
// issued (docs/design/signed-envelopes.md). The service accepts a remembered
// line, thought, persona or dream only with its envelope, so the browser
// keeps them here, keyed by kind, speaker and exact text, and sends only
// signed words. Words without one (older saves) stay out of the request.
// One entry per word: the last 800 lines, thoughts, personas and dreams.
import { profiles } from "./memory.mjs";

const STORE = "cosyworld-card-signed-words";
const LIMIT = 800;
const key = (kind, id, text) => `${kind}\u0000${id}\u0000${text}`;
let cache = null;

function load(storage) {
  if (cache) return cache;
  cache = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(STORE) || "[]");
    if (Array.isArray(saved))
      for (const [k, envelope] of saved.slice(-LIMIT))
        if (typeof k === "string" && envelope?.claims) cache.set(k, envelope);
  } catch {
    /* A blocked or corrupt store starts empty. */
  }
  return cache;
}

function save(storage) {
  try {
    storage?.setItem(STORE, JSON.stringify([...cache].slice(-LIMIT)));
  } catch {
    /* Words stay signed for this page only. */
  }
}

function put(map, k, envelope) {
  map.delete(k);
  map.set(k, envelope);
  while (map.size > LIMIT) map.delete(map.keys().next().value);
}

// Keep the envelopes from a scene or reflection reply.
export function rememberSigned(response, storage = globalThis.localStorage) {
  const map = load(storage);
  for (const entry of response?.entries || []) {
    if (!entry?.signed || typeof entry.text !== "string") continue;
    put(map, key("line", entry.id, entry.text), entry.signed);
  }
  for (const entry of response?.reflections || [])
    for (const kind of ["thought", "persona", "dream"]) {
      const text = entry?.reflection?.[kind];
      if (typeof text === "string" && entry.signed?.[kind])
        put(map, key(kind, entry.id, text), entry.signed[kind]);
    }
  save(storage);
  return response;
}

// The request body: the scene with each remembered word's envelope, and
// unsigned remembered words left out.
export function withSignatures(context, storage = globalThis.localStorage) {
  const map = load(storage);
  const find = (kind, id, text) => map.get(key(kind, id, text));
  // A memory of a line reads "Name: line" (memory.mjs).
  const said = (text) => {
    for (const [id, profile] of Object.entries(profiles)) {
      const prefix = `${profile.name}: `;
      const signed =
        text.startsWith(prefix) && find("line", id, text.slice(prefix.length));
      if (signed) return signed;
    }
    return null;
  };
  const conversation = (context.conversation || []).flatMap((line) => {
    const signed = find("line", line.actorId, line.text);
    return signed ? [{ ...line, signed }] : [];
  });
  const entities = context.entities.map((entity) => {
    const next = { ...entity };
    const previous =
      entity.previous && find("line", entity.id, entity.previous);
    next.previous = previous ? entity.previous : null;
    if (previous) next.previous_signed = previous;
    next.memories = entity.memories.flatMap((memory) => {
      if (memory.kind !== "expression") return [memory];
      const signed = said(memory.text);
      return signed ? [{ ...memory, signed }] : [];
    });
    // "Between us" quotes signed lines too (between-us.mjs).
    if (entity.between)
      next.between = entity.between.map((b) => ({
        ...b,
        said: b.said.flatMap((line) => {
          const signed = find("line", line.actorId, line.text);
          return signed ? [{ ...line, signed }] : [];
        }),
      }));
    const life = entity.inner_life;
    if (life) {
      const persona = life.persona && find("persona", entity.id, life.persona);
      const moments = (kind, list) =>
        (list || []).flatMap((moment) => {
          const signed = find(kind, entity.id, moment.text);
          return signed ? [{ ...moment, signed }] : [];
        });
      next.inner_life = {
        ...life,
        persona: persona ? life.persona : null,
        ...(persona ? { persona_signed: persona } : {}),
        thoughts: moments("thought", life.thoughts),
        dreams: moments("dream", life.dreams),
      };
    }
    return next;
  });
  return { ...context, conversation, entities };
}

// Wrap a story request so it sends signed words and keeps new envelopes.
export const signedRequest =
  (send) =>
  async (context, ...rest) =>
    rememberSigned(await send(withSignatures(context), ...rest));

// Every kept envelope, once each: a save shared into a new world sends them
// so the server keeps the words they cover (#2067).
export function signedEnvelopes(storage = globalThis.localStorage) {
  const all = [...load(storage).values()];
  return [...new Map(all.map((e) => [e.sig, e])).values()];
}

// Tests start from an empty store.
export function forgetSigned() {
  cache = null;
}
