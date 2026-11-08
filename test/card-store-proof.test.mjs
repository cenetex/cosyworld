import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  payloadHash,
  scanFiles,
  verifyStore,
} from "../v2/scripts/card-store.mjs";
import {
  gitObjectId,
  PAYLOAD,
  selectSourceFiles,
  verifySourceProof,
} from "../v2/scripts/card-store-proof.mjs";
const fixture = fileURLToPath(
  new URL("./fixtures/card-store/", import.meta.url),
);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const source = read(path.join(fixture, "worldpacks/store.json")).packs[0]
  .source;
const proof = read(path.join(fixture, "worldpacks/proofs/sample.json"));
const files = scanFiles(path.join(fixture, "worldpacks/sample"));
const roots = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((r) => fs.rmSync(r, { recursive: true, force: true })),
);

it("binds every payload blob, including LICENSE, to raw Git evidence", () => {
  expect(files.some((file) => file.path === "LICENSE")).toBe(true);
  verifySourceProof(source, proof, files);
});
it.each([
  "commit",
  "tree",
  "missing-tree",
  "unused-tree",
  "repo",
  "encoded-array",
])("rejects %s proof tampering", (change) => {
  const changed = structuredClone(proof);
  const tree = Object.keys(changed.trees)[0];
  if (change === "commit")
    changed.commit = Buffer.from("tampered").toString("base64");
  if (change === "tree")
    changed.trees[tree] = Buffer.from("tampered").toString("base64");
  if (change === "missing-tree") delete changed.trees[tree];
  if (change === "unused-tree")
    changed.trees[gitObjectId("tree", Buffer.alloc(0))] = "";
  if (change === "repo") changed.source.repo = "other/repo";
  if (change === "encoded-array") changed.commit = [changed.commit];
  expect(() => verifySourceProof(source, changed, files)).toThrow();
});
it.each(["changed", "missing-license"])(
  "rejects %s payload even after a local re-pin",
  (change) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cosy-proof-"));
    roots.push(root);
    fs.cpSync(fixture, root, { recursive: true });
    const payload = path.join(root, "worldpacks/sample");
    if (change === "changed")
      fs.appendFileSync(path.join(payload, "card-world.json"), " ");
    else fs.unlinkSync(path.join(payload, "LICENSE"));
    for (const name of ["store.json", "vendor-manifest.json"]) {
      const file = path.join(root, "worldpacks", name);
      const data = read(file);
      data.packs[0].pinned.sha256 = payloadHash(scanFiles(payload));
      fs.writeFileSync(file, JSON.stringify(data));
    }
    expect(() => verifyStore(root)).toThrow(/differs from the source commit/);
  },
);

function selection(entries) {
  const trees = new Map();
  const tree = (items) => {
    const bytes = Buffer.concat(
      items.map(([mode, name, oid]) =>
        Buffer.concat([
          Buffer.from(`${mode} ${name}\0`),
          Buffer.from(oid, "hex"),
        ]),
      ),
    );
    const oid = gitObjectId("tree", bytes);
    trees.set(oid, bytes);
    return oid;
  };
  const empty = tree([]);
  const assets = tree(
    entries.map(([mode, name]) => [
      mode,
      name,
      mode === "40000" ? empty : "1".repeat(40),
    ]),
  );
  const root = tree([
    ...PAYLOAD.map((name) => ["100644", name, "1".repeat(40)]),
    ["40000", "assets", assets],
  ]);
  const commit = Buffer.from(
    `tree ${root}\nauthor Fixture <test@example.invalid> 0 +0000\ncommitter Fixture <test@example.invalid> 0 +0000\n\nFixture\n`,
  );
  return () =>
    selectSourceFiles(commit, gitObjectId("commit", commit), (id) =>
      trees.get(id),
    );
}
it.each([
  ["120000", "link.png"],
  ["100755", "executable.png"],
  ["160000", "module.png"],
  ["100644", "../escape.png"],
  ["100644", "con.png"],
  ["40000", "NUL"],
  ["40000", "trailing."],
])("rejects source mode %s or unsafe name %s", (mode, name) => {
  expect(selection([[mode, name]])).toThrow();
});
it("rejects paths that collide on case-insensitive filesystems", () => {
  expect(
    selection([
      ["40000", "Folder"],
      ["40000", "folder"],
    ]),
  ).toThrow(/Case-colliding/);
});
it("bounds proof object counts before walking trees", () => {
  const changed = structuredClone(proof);
  changed.trees = Object.fromEntries(
    Array.from({ length: 1025 }, (_, i) => [
      i.toString(16).padStart(40, "0"),
      "",
    ]),
  );
  expect(() => verifySourceProof(source, changed, files)).toThrow(/tree ids/);
});
