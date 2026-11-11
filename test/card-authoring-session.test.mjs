import { it } from "vitest";
import assert from "node:assert/strict";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { sourceEdit } from "../v2/card-game/authoring-edits.mjs";
import fixture from "./fixtures/authoring-session.json" with { type: "json" };
import * as tree from "../v2/card-game/authoring-tree.mjs";
const fail = (message) => Promise.reject(new Error(message));
function setup() {
  let record = structuredClone(fixture);
  const store = {
    async write(_key, value, generation) {
      assert.equal(generation, record.generation);
      record = { ...structuredClone(value), generation: generation + 1 };
      return record.generation;
    },
  };
  const session = createAuthoringSession({ store });
  session.open({ key: "local", record });
  const field = (name) =>
    session.field(
      tree
        .buildAuthoringTree(session.state.source)
        .cards.find((c) => c.source?.join("/") === `pack/choices/0/${name}`),
    ).field;
  const select = (place) =>
    session.dispatch({
      type: "select",
      id: tree.authoringCardId(["pack", "places", place], "entity"),
    });
  return { session, store, field, select };
}

it("validates pending fields and keeps their identity through Undo", async () => {
  const { session, field } = setup(),
    before = JSON.stringify(session.state);
  session.input(field("text"), "Second\n雪");
  session.input(field("cost"), "2");
  const snapshot = session.snapshot();
  assert.equal(snapshot.draft.pack.choices[0].cost, 2);
  snapshot.draft.pack.choices[0].unknown.push("caller");
  session.input(field("cost"), " ");
  session.stage({ document: "Staged book", title: "x".repeat(81) });
  const read = session.snapshot({ pending: false });
  assert.equal(read.draft.pack.choices[0].cost, 1);
  assert.equal(read.draft.title.length, 81);
  await assert.rejects(session.save(), /number/);
  assert.equal(JSON.stringify(session.state), before);
  session.input(field("cost"), "3");
  await assert.rejects(session.save(), /title/);
  session.stage({ title: "Corrected title" });
  const saved = await session.save();
  assert.deepEqual(saved.draft.pack.choices[0], {
    id: "gate",
    cost: 3,
    text: "Second\n雪",
    unknown: ["kept"],
  });
  session.input(field("text"), "Saved field");
  session.saveField(field("text"));
  session.input(field("text"), "Pending field");
  session.input(field("cost"), "4");
  session.dispatch({ type: "undo" });
  const pending = session.snapshot().draft.pack.choices[0];
  assert.deepEqual([pending.text, pending.cost], ["Pending field", 4]);
  session.saveField(field("text"));
  const current = (await session.save()).draft.pack.choices;
  assert.equal(current[0].cost, 4);
  assert.equal(current[0].text, current[1].text);
  const path = ["pack", "choices"],
    value = current.slice(1);
  const edit = sourceEdit(session.state.source, "Shift", [{ path, value }]);
  session.dispatch({ type: "edit", edit });
  session.input(field("text"), "For B");
  session.dispatch({ type: "undo" });
  assert.throws(() => session.saveField(field("text")), /moved/);
  await assert.rejects(session.save(), /moved/);
  assert.equal(session.state.source.pack.choices[0].text, current[0].text);
  session.input(field("text"), "For A");
  assert.equal(session.snapshot().draft.pack.choices[0].text, "For A");
});

it("retains failed field and document saves, then retries with the same generation", async () => {
  const { session, store, field } = setup(),
    write = store.write;
  session.input(field("text"), "Keep this field");
  store.write = () => fail("Storage full");
  session.stage({ document: "Keep this book", title: "New title" });
  await assert.rejects(session.save(), /Storage full/);
  assert.equal(session.status.generation, 1);
  assert.equal(session.status.dirty, true);
  assert.equal(session.snapshot().draft.document, "Keep this book");
  assert.equal(session.state.undo.length, 1);
  store.write = write;
  const saved = await session.save();
  assert.equal(saved.draft.pack.choices[0].text, "Keep this field");
  assert.equal(saved.draft.title, "New title");
  assert.deepEqual([saved.generation, session.status.dirty], [2, false]);
  const kept = session.snapshot();
  ["title", "document"].forEach((key) => (saved.draft[key] = "Caller"));
  [saved.draft.assets, saved.draft.sources].forEach((list) => list.push({}));
  assert.deepEqual(session.snapshot(), kept);
});

it("keeps newer launch edits dirty while a save finishes", async () => {
  const { session, store, select } = setup(),
    wait = Promise.withResolvers(),
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
    wait = Promise.withResolvers();
  let started = false;
  const incoming = session.snapshot();
  const running = session.run(async (ctx) => {
    started = true;
    await wait.promise;
    assert.throws(() => ctx.stage({ document: "Old" }), /editor changed/);
    ctx.open({ key: "imported", record: incoming });
  });
  assert.equal(started, true);
  await assert.rejects(
    session.run(() => null),
    /current action/,
  );
  session.input(field("text"), "New typing");
  wait.resolve();
  await assert.rejects(running, /editor changed/);
  assert.equal(session.status.key, "local");
  assert.equal(session.snapshot().draft.pack.choices[0].text, "New typing");
});

it("preserves the old session on failed reload and accepts a saved import explicitly", async () => {
  const { session, store, select } = setup();
  select("a");
  const before = session.snapshot();
  store.read = () => fail("Read failed");
  await assert.rejects(
    session.run(async (ctx) =>
      ctx.open({ key: "local", record: await store.read() }),
    ),
    /Read failed/,
  );
  assert.deepEqual(session.snapshot(), before);
  before.launch.place = "absent";
  assert.throws(() => session.open({ key: "bad", record: before }), /starting/);
  await session.run(async (ctx) => {
    ctx.stage({ document: "Context book" });
    const record = await ctx.save();
    ctx.open({ key: "local", record });
  });
  const retained = await session.run((ctx) => ctx);
  assert.throws(() => retained.stage({ document: "Late" }), /editor changed/);
  const replacement = { key: "late", record: before };
  assert.throws(() => retained.open(replacement), /editor changed/);
  assert.equal(session.state.undo.length, 0);
  assert.equal(session.snapshot().draft.document, "Context book");
});

it("lets a selection-only change pass an action in flight, but not a real edit", async () => {
  const { session, select } = setup();
  const place = Object.keys(session.state.source.pack.places)[0];
  const during = (change) =>
    session.run(async (context) => {
      change();
      return context.snapshot();
    });
  await assert.doesNotReject(
    during(() => session.dispatch({ type: "cancel" })),
  );
  await assert.rejects(
    during(() => select(place)),
    /editor changed/,
  );
  await assert.rejects(
    during(() => session.dispatch({ type: "undo" })),
    /editor changed/,
  );
  await assert.rejects(
    during(() => session.touch()),
    /editor changed/,
  );
});
