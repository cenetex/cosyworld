import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { judge, loadSources, scanSkips } from "../scripts/check-test-skips.mjs";
import { judgeSaves, scanSaves } from "../scripts/check-recorded-saves.mjs";

// Made-up inputs are assembled here so this file holds no skip of its own.
const SKIP = "sk" + "ip";
const IGNORE = "#[" + "ignore";
const dirs = [];
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "guards-"));
  dirs.push(root);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), body);
  }
  return loadSources({ root });
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("skip ledger", () => {
  it("counts each pattern once and skips comments and non-test files", () => {
    const js = [
      `it.${SKIP}("a", () => {}); // why`,
      `describe.${SKIP}("b", () => {}); // why`,
      `test.${SKIP}.each([1])("c", () => {}); // why`,
      `it.${"to" + "do"}("d"); // why`,
      `const it2 = check.${SKIP}If(x); // why`,
      `x${"it"}("e", () => {}); // why`,
      `// it.${SKIP}("in a comment")`,
      `ctx.${SKIP}(); // why`,
      `it.each([1])("fine", () => {});`,
    ].join("\n");
    const rs = `// reason\n${IGNORE}]\n#[test]\nfn a() {}\n// reason\n${IGNORE} = "slow"]\nfn b() {}\n`;
    const skips = scanSkips(
      tree({
        "test/a.test.mjs": js,
        "v2/src/lib.rs": rs,
        "scripts/not-a-test.mjs": `it.${SKIP}("x");`,
      }),
    );
    expect(skips.map((s) => `${s.file}:${s.line}`)).toEqual([
      ...[1, 2, 3, 4, 5, 6, 8].map((n) => `test/a.test.mjs:${n}`),
      "v2/src/lib.rs:2",
      "v2/src/lib.rs:6",
    ]);
    expect(skips.every((s) => s.reason)).toBe(true);
  });

  it("needs a reason and names file:line without one", () => {
    const skips = scanSkips(
      tree({
        "test/a.test.mjs": `// slow on CI\nit.${SKIP}("a");\nit.${SKIP}("b");\n`,
        "x/lib.rs": `fn a() {}\n${IGNORE}]\nfn b() {}\n`,
      }),
    );
    const { ok, messages } = judge(skips, 10);
    expect(ok).toBe(false);
    expect(messages.filter((m) => m.includes("no reason")).map((m) => m.split(":").slice(0, 2).join(":"))).toEqual([
      "test/a.test.mjs:3",
      "x/lib.rs:2",
    ]);
  });

  it("fails above the ceiling and asks to lower it below", () => {
    const skips = scanSkips(tree({ "test/a.test.mjs": `it.${SKIP}("a"); // why\nit.${SKIP}("b"); // why\n` }));
    expect(judge(skips, 1).ok).toBe(false);
    expect(judge(skips, 2)).toEqual({ ok: true, messages: ["test skips: 2 (ceiling: 2)"] });
    const below = judge(skips, 5);
    expect(below.ok).toBe(true);
    expect(below.messages.join(" ")).toMatch(/lower .*to 2/);
  });
});

const world = { schema: 9, locations: {}, actors: {}, items: {}, eventSeq: 1, pad: "x".repeat(30000) };

describe("recorded saves", () => {
  const files = {
    "test/fixtures/old.json": JSON.stringify(world),
    "test/fixtures/wrapped.json": JSON.stringify({ steps: [], initial: world }),
    "test/fixtures/packed.json.gz": gzipSync("{}"),
    "test/fixtures/east-save.json": "{}",
    "test/fixtures/plain-data.json": JSON.stringify({ actors: ["a"], pad: "x".repeat(3000) }),
    "v2/content/pack.json": JSON.stringify({ items: {}, pad: "x".repeat(3000) }),
  };

  it("tells a save from ordinary json by its world envelope, gzip or name", () => {
    const found = scanSaves(tree(files));
    expect(Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.why]))).toEqual({
      "test/fixtures/old.json": "envelope",
      "test/fixtures/wrapped.json": "envelope",
      "test/fixtures/packed.json.gz": "gzip",
      "test/fixtures/east-save.json": "name",
    });
  });

  it("rejects a new save, a grown one and a stale entry", () => {
    const found = scanSaves(tree(files));
    const allowed = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.bytes]));
    expect(judgeSaves(found, allowed)).toEqual({ ok: true, messages: [] });

    const { "test/fixtures/old.json": _gone, ...fewer } = allowed;
    const added = judgeSaves(found, fewer);
    expect(added.ok).toBe(false);
    expect(added.messages[0]).toMatch(/old\.json: new recorded save.*createWorld.*journey/);

    const grown = judgeSaves(found, { ...allowed, "test/fixtures/old.json": allowed["test/fixtures/old.json"] / 2 });
    expect(grown.messages[0]).toMatch(/old\.json: recorded save grew/);
    const small = judgeSaves(found, { ...allowed, "test/fixtures/old.json": allowed["test/fixtures/old.json"] - 40 });
    expect(small.ok).toBe(true);

    const stale = judgeSaves(found, { ...allowed, "test/fixtures/deleted.json": 10 });
    expect(stale.ok).toBe(false);
    expect(stale.messages[0]).toMatch(/deleted\.json: allow-listed but gone/);
  });
});
