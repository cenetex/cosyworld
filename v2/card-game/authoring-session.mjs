import * as controller from "./authoring-controller.mjs";
import { authoringField, authoringFieldEdit } from "./authoring-fields.mjs";
import { parseDraft, exportManifest } from "./authoring-draft.mjs";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const copyDraft = (draft) => parseDraft(exportManifest(draft));
const changeField = (state, field, text) =>
  controller.reduceAuthoring(state, {
    type: "edit",
    edit: authoringFieldEdit(state.source, field, text),
  });

export function createAuthoringSession({ store, onChange = () => {} }) {
  let state,
    manifest,
    key,
    generation,
    savedSequence,
    savedMeta = 0,
    meta = 0;
  let busy = false,
    writing = false,
    epoch = 0,
    session = 0;
  const pending = new Map();
  function set(next) {
    state = next;
    onChange();
  }
  function candidate() {
    let next = state;
    for (const { field, text } of pending.values())
      next = changeField(next, field, text);
    return next;
  }
  function snapshot(next = candidate(), patch = {}, base = manifest, raw) {
    need(
      Object.entries(patch).every(
        ([name, value]) =>
          ["document", "title"].includes(name) && typeof value === "string",
      ),
      "Enter source text or title as text.",
    );
    const draft = {
      ...base,
      ...patch,
      pack: next.source.pack,
      bridge: next.source.bridge,
    };
    const launch = structuredClone(next.source.launch ?? null);
    need(
      launch === null ||
        (Object.keys(launch).length === 2 &&
          launch.schemaVersion === 1 &&
          typeof launch.place === "string" &&
          Object.hasOwn(draft.pack?.places || {}, launch.place)),
      "Choose a starting location in this draft.",
    );
    const clone = raw ? structuredClone(draft) : copyDraft(draft);
    return { key, generation, draft: clone, launch };
  }
  function open(value) {
    const draft = copyDraft(value.record?.draft);
    need(
      Number.isSafeInteger(value.record.generation) &&
        value.record.generation >= 0,
      "Read the saved draft before opening it.",
    );
    const next = controller.createAuthoringState({
      pack: draft.pack,
      bridge: draft.bridge,
      launch: value.record.launch ?? null,
    });
    snapshot(next, {}, draft);
    key = value.key;
    manifest = draft;
    generation = value.record.generation;
    savedSequence = savedMeta = meta = 0;
    pending.clear();
    session++;
    epoch++;
    set(next);
  }
  function remember(draft) {
    meta += Number(
      ["title", "document"].some((name) => manifest[name] !== draft[name]),
    );
    manifest = draft;
  }
  async function save(patch = {}) {
    need(!writing, "Wait for the current save.");
    const next = candidate(),
      record = snapshot(next, patch),
      token = session;
    remember(record.draft);
    const savedVersion = meta;
    pending.clear();
    writing = true;
    try {
      set(next);
      record.generation = await store.write(key, record, generation);
      if (session === token) {
        generation = record.generation;
        savedSequence = next.sequence;
        savedMeta = savedVersion;
      }
      return record;
    } finally {
      writing = false;
      onChange();
    }
  }
  const api = {
    get state() {
      return state;
    },
    get status() {
      return {
        key,
        title: manifest?.title,
        generation,
        busy,
        writing,
        dirty: Boolean(
          state &&
            (state.sequence !== savedSequence ||
              meta !== savedMeta ||
              pending.size),
        ),
      };
    },
    open,
    save,
    snapshot(options = {}) {
      const raw = options.pending === false;
      return snapshot(raw ? state : candidate(), {}, manifest, raw);
    },
    stage(patch) {
      remember(snapshot(state, patch, manifest, true).draft);
      epoch++;
      onChange();
    },
    touch() {
      epoch++;
    },
    dispatch(event) {
      epoch++;
      set(controller.reduceAuthoring(state, event));
    },
    field(card) {
      const current = authoringField(state.source, card);
      if (!current) return null;
      return {
        field: current,
        text: pending.get(current.key)?.text ?? current.text,
      };
    },
    input(field, text) {
      epoch++;
      if (text === field.text) pending.delete(field.key);
      else pending.set(field.key, { field, text });
      onChange();
    },
    saveField(field) {
      const entry = pending.get(field.key);
      const next = changeField(
        state,
        entry?.field || field,
        field.type === "boolean" ? undefined : (entry?.text ?? field.text),
      );
      pending.delete(field.key);
      epoch++;
      set(next);
    },
    async run(callback) {
      need(!busy && !writing, "Wait for the current action.");
      busy = true;
      let at = epoch;
      const token = session;
      const guard = () =>
        need(
          at === epoch && token === session,
          "This editor changed. Save it, then open the prepared draft.",
        );
      try {
        onChange();
        return await callback({
          snapshot() {
            guard();
            return api.snapshot();
          },
          stage(patch) {
            guard();
            api.stage(patch);
            at = epoch;
          },
          save(patch) {
            guard();
            return save(patch);
          },
          open(value) {
            guard();
            open(value);
          },
        });
      } finally {
        busy = false;
        epoch++;
        onChange();
      }
    },
  };
  return api;
}
