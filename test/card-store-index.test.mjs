import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishStoreIndex } from "../v2/scripts/card-store-index.mjs";

const roots = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-index-"));
  roots.push(root);
  const index = path.join(root, "store.json");
  const next = path.join(root, "next.json");
  const previous = Buffer.from('{"schemaVersion":1,"packs":[]}\n');
  fs.writeFileSync(index, previous);
  fs.writeFileSync(next, "prepared index");
  return { root, index, next, previous };
}
const recoveryAt = (root) => path.join(root,
  fs.readdirSync(root).find((name) => name.startsWith(".index-recovery-")), "store.json");
afterEach(() => {
  vi.restoreAllMocks();
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

it("publishes prepared bytes and retains the actual old index", () => {
  const { root, index, next, previous } = setup();
  const recovery = publishStoreIndex(index, next, previous);
  expect(fs.readFileSync(index, "utf8")).toBe("prepared index");
  expect(fs.readFileSync(recovery)).toEqual(previous);
  expect(recovery).toBe(recoveryAt(root));
});
it("preserves a late edit immediately before moving the old index", () => {
  const { root, index, next, previous } = setup();
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (from === index || to === index) fs.writeFileSync(index, "late edit");
    return rename(from, to);
  });
  expect(() => publishStoreIndex(index, next, previous)).toThrow(/Store changed/);
  expect(fs.readFileSync(index, "utf8")).toBe("late edit");
  expect(fs.readFileSync(recoveryAt(root), "utf8")).toBe("late edit");
});
it.each([false, true])("never overwrites a replacement during restore=%s", (restoring) => {
  const { root, index, next, previous } = setup();
  const link = fs.linkSync;
  vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
    const publishing = to === index && from === next;
    if (restoring && publishing) throw new Error("publication failed");
    if (to === index && (restoring || publishing)) fs.writeFileSync(index, "replacement");
    return link(from, to);
  });
  expect(() => publishStoreIndex(index, next, previous)).toThrow(/recovery retained/);
  expect(fs.readFileSync(index, "utf8")).toBe("replacement");
  expect(fs.readFileSync(recoveryAt(root))).toEqual(previous);
});
it("retains later edits through an already-open file", () => {
  const { index, next, previous } = setup();
  const fd = fs.openSync(index, "r+");
  try {
    const recovery = publishStoreIndex(index, next, previous);
    fs.ftruncateSync(fd);
    fs.writeFileSync(fd, "editor finished later");
    expect(fs.readFileSync(recovery, "utf8")).toBe("editor finished later");
    expect(fs.readFileSync(index, "utf8")).toBe("prepared index");
  } finally {
    fs.closeSync(fd);
  }
});
it.each([false, true])("retains recovery after failed publication, restore failure=%s", (restoreFails) => {
  const { root, index, next, previous } = setup();
  const link = fs.linkSync;
  vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
    if (to === index && (restoreFails || from === next)) throw new Error("links unavailable");
    return link(from, to);
  });
  expect(() => publishStoreIndex(index, next, previous)).toThrow(/recovery retained.*links unavailable/);
  expect(fs.readFileSync(recoveryAt(root))).toEqual(previous);
  if (restoreFails) expect(fs.existsSync(index)).toBe(false);
  else expect(fs.readFileSync(index)).toEqual(previous);
});
it("refuses unsupported links before removing the live index", () => {
  const { root, index, next, previous } = setup();
  vi.spyOn(fs, "linkSync").mockImplementation(() => { throw new Error("links unsupported"); });
  expect(() => publishStoreIndex(index, next, previous)).toThrow(/links unsupported/);
  expect(fs.readFileSync(index)).toEqual(previous);
  expect(fs.readdirSync(root).some((name) => name.startsWith(".index-recovery-"))).toBe(false);
});
