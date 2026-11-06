import { it } from "vitest";
import assert from "node:assert/strict";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { importPack } from "../v2/card-game/authoring-draft.mjs";
import {
  authoringCardId,
  buildAuthoringTree,
} from "../v2/card-game/authoring-tree.mjs";
const gate = ["pack", "choices", 0];
const deferred = () => Promise.withResolvers();
function setup() {
  let record = {
    generation: 1,
    launch: null,
    draft: importPack({
      pack: {
        name: "Crossing",
        places: { a: { name: "Yard" }, b: { name: "Port" } },
        choices: [{ id: "gate", cost: 1, text: "First", unknown: ["kept"] }],
      },
    }),
  };
  const store = {
    async read() {
      return structuredClone(record);
    },
    async write(key, value, generation) {
      assert.equal(key, "local");
      if (generation !== record.generation)
        throw new Error("This draft changed in another tab.");
      record = { ...structuredClone(value), generation: generation + 1 };
      return record.generation;
    },
  };
  const session = createAuthoringSession({ store });
  session.open({ key: "local", record });
  const field = (name) =>
    session.field(
      buildAuthoringTree(session.state.source).cards.find(
        (c) => c.id === authoringCardId([...gate, name], "field"),
      ),
    ).field;
  const select = (place) =>
    session.dispatch({
      type: "select",
      id: authoringCardId(["pack", "places", place], "entity"),
    });
  return { session, store, field, select };
}

it("validates pending fields as one candidate and gives tools a detached snapshot", async () => {
  const { session, field } = setup(),
    before = JSON.stringify(session.state);
  session.input(field("text"), "Second\n雪");
  session.input(field("cost"), "2");
  const snapshot = session.snapshot();
  assert.equal(snapshot.draft.pack.choices[0].cost, 2);
  snapshot.draft.pack.choices[0].unknown.push("caller");
  assert.equal(JSON.stringify(session.state), before);
  session.input(field("cost"), " ");
  session.stage({ document: "Staged book" });
  const read = session.snapshot({ pending: false });
  assert.equal(read.draft.pack.choices[0].cost, 1);
  assert.equal(read.draft.document, "Staged book");
  await assert.rejects(session.save(), /number/);
  assert.equal(JSON.stringify(session.state), before);
  session.input(field("cost"), "3");
  const saved = await session.save();
  assert.deepEqual(saved.draft.pack.choices[0], {
    id: "gate",
    cost: 3,
    text: "Second\n雪",
    unknown: ["kept"],
  });
  assert.equal(session.status.dirty, false);
  session.dispatch({ type: "undo" });
  session.dispatch({ type: "undo" });
  assert.equal(session.state.source.pack.choices[0].text, "First");
  assert.equal(session.status.dirty, true);
});

it("retains failed field and document saves, then retries with the same generation", async () => {
  const { session, store, field } = setup(),
    write = store.write;
  session.input(field("text"), "Keep this field");
  store.write = async () => {
    throw new Error("Storage full");
  };
  session.stage({ document: "Keep this book", title: "New title" });
  await assert.rejects(session.save(), /Storage full/);
  assert.equal(session.status.generation, 1);
  assert.equal(session.status.writing, false);
  assert.equal(session.status.dirty, true);
  assert.equal(session.snapshot().draft.document, "Keep this book");
  assert.equal(session.state.undo.length, 1);
  store.write = write;
  const saved = await session.save();
  assert.equal(saved.draft.pack.choices[0].text, "Keep this field");
  assert.equal(saved.draft.title, "New title");
  assert.equal(saved.generation, 2);
  assert.equal(session.status.dirty, false);
});

it("keeps newer launch edits dirty while a save finishes", async () => {
  const { session, store, select } = setup(),
    wait = deferred(),
    write = store.write;
  select("a");
  store.write = async (...args) => {
    await wait.promise;
    return write(...args);
  };
  const saving = session.save();
  await assert.rejects(session.save(), /current save/);
  select("b");
  wait.resolve();
  const saved = await saving;
  assert.equal(saved.launch.place, "a");
  assert.equal(session.state.source.launch.place, "b");
  assert.equal(session.status.dirty, true);
});

it("runs tools in the original gesture and guards completed imports after interaction", async () => {
  const { session, field } = setup(),
    wait = deferred();
  let started = false;
  const incoming = session.snapshot();
  const running = session.run(async (ctx) => {
    started = true;
    await wait.promise;
    assert.throws(
      () => ctx.stage({ document: "Stale book" }),
      /editor changed/,
    );
    ctx.open({ key: "imported", record: incoming });
  });
  assert.equal(started, true);
  await assert.rejects(
    session.run(() => {}),
    /current action/,
  );
  session.input(field("text"), "New typing");
  wait.resolve();
  await assert.rejects(running, /editor changed/);
  assert.equal(session.status.key, "local");
  assert.equal(session.snapshot().draft.pack.choices[0].text, "New typing");
  assert.equal(session.status.busy, false);
});

it("preserves the old session on failed reload and accepts a saved import explicitly", async () => {
  const { session, store, select } = setup();
  select("a");
  const before = session.snapshot();
  store.read = async () => {
    throw new Error("Read failed");
  };
  await assert.rejects(
    session.run(async (ctx) =>
      ctx.open({ key: "local", record: await store.read() }),
    ),
    /Read failed/,
  );
  assert.deepEqual(session.snapshot(), before);
  assert.throws(
    () =>
      session.open({
        key: "bad",
        record: { ...before, launch: { schemaVersion: 1, place: "absent" } },
      }),
    /starting location/,
  );
  assert.deepEqual(session.snapshot(), before);
  await session.run(async (ctx) => {
    ctx.stage({ document: "Context book" });
    const record = await ctx.save();
    ctx.open({ key: "local", record });
  });
  assert.equal(session.status.dirty, false);
  assert.equal(session.state.undo.length, 0);
  assert.equal(session.snapshot().draft.document, "Context book");
});
