import { expect, it } from "vitest";
import { createAuthoringSession } from "../v2/card-game/authoring-session.mjs";
import { sourceEdit } from "../v2/card-game/authoring-edits.mjs";
import { assetMetadata } from "../v2/card-game/authoring-draft.mjs";
import fixture from "./fixtures/authoring-session.json" with { type: "json" };

async function setup() {
  let disk = structuredClone(fixture),
    writes = 0;
  const store = {
    async write(key, value, generation, assets) {
      expect(generation).toBe(disk.generation);
      disk = {
        ...structuredClone(value),
        key,
        generation: generation + 1,
        assets: structuredClone(assets ?? disk.assets),
      };
      writes++;
      return disk.generation;
    },
  };
  const session = createAuthoringSession({ store });
  session.open({ key: "local", record: disk });
  const before = session.snapshot();
  const bytes = new TextEncoder().encode('{"name":"Vale"}');
  const meta = await assetMetadata(
    "assets/test/output.json",
    "application/json",
    bytes,
  );
  const prepared = {
    baseline: JSON.stringify([
      before.key,
      before.generation,
      before.draft,
      before.launch ?? null,
    ]),
    edit: sourceEdit(session.state.source, "Accept Vale", [
      { path: ["pack", "avatars"], value: { vale: { name: "Vale" } } },
    ]),
    assets: [meta],
    bytes: new Map([[meta.path, bytes]]),
  };
  return {
    session,
    store,
    prepared,
    before,
    read: () => disk,
    writes: () => writes,
  };
}

it("keeps prior output on a failed save, then accepts the same bytes once and supports Undo", async () => {
  const { session, store, prepared, before, read, writes } = await setup();
  const write = store.write;
  store.write = async () => {
    throw new Error("Storage full");
  };
  await expect(session.accept(prepared)).rejects.toThrow("Storage full");
  expect(session.snapshot()).toEqual(before);
  expect(session.state.undo).toHaveLength(0);
  expect(session.status).toMatchObject({ accepting: false, writing: false });
  expect(writes()).toBe(0);
  store.write = write;
  const result = await session.run((ctx) => ctx.accept(prepared));
  expect(result.generation).toBe(before.generation + 1);
  expect(read().assets).toEqual(prepared.bytes);
  expect(session.status.dirty).toBe(false);
  expect(writes()).toBe(1);
  await expect(session.accept(prepared)).rejects.toThrow("draft changed");
  session.dispatch({ type: "undo" });
  expect(session.snapshot().draft.pack).toEqual(before.draft.pack);
  expect(session.snapshot({ assets: true }).assets).toEqual(prepared.bytes);
  await session.save();
  expect(read().draft.pack).toEqual(before.draft.pack);
  expect(read().assets).toEqual(prepared.bytes);
});

it("keeps the accepted source stable during its atomic write and copies saved bytes", async () => {
  const { session, store, prepared, before } = await setup();
  const write = store.write,
    wait = Promise.withResolvers();
  store.write = async (...args) => {
    await wait.promise;
    return write(...args);
  };
  const pending = session.accept(prepared);
  expect(session.status.accepting).toBe(true);
  session.stage({ title: "Late title" });
  session.dispatch({
    type: "edit",
    edit: sourceEdit(session.state.source, "Late", [
      { path: ["pack", "name"], value: "Late" },
    ]),
  });
  expect(session.snapshot()).toEqual(before);
  expect(() => session.open({ key: "other", record: before })).toThrow(
    "accepted card",
  );
  await expect(session.save()).rejects.toThrow("current save");
  wait.resolve();
  await pending;
  expect(session.snapshot().draft.title).toBe(before.draft.title);
  const copy = session.snapshot({ assets: true });
  copy.assets.values().next().value.fill(0);
  expect(session.snapshot({ assets: true }).assets).toEqual(prepared.bytes);
  const throughTool = await session.run((ctx) =>
    ctx.snapshot({ assets: true }),
  );
  expect(throughTool.assets).toEqual(prepared.bytes);
});

it("rejects stale acceptance before writing and keeps pending field edits", async () => {
  const { session, prepared, writes } = await setup();
  session.stage({ title: "A changed world" });
  await expect(session.accept(prepared)).rejects.toThrow("draft changed");
  expect(writes()).toBe(0);
  expect(session.snapshot().draft.title).toBe("A changed world");
});
