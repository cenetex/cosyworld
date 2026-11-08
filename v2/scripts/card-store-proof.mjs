// Raw Git evidence binds payload bytes to a commit, not to a repository owner.
import assert from "node:assert/strict";
import crypto from "node:crypto";

export const PAYLOAD = [
  "worldpack.json",
  "card-world.json",
  "card-bridge.json",
  "PROVENANCE.md",
];
export const gitObjectId = (type, bytes) =>
  crypto
    .createHash("sha1")
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
const portable = (name) =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name) &&
  !name.endsWith(".") &&
  !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

function treeEntries(bytes) {
  assert(
    Buffer.isBuffer(bytes) && bytes.length <= 256 * 1024,
    "Git tree exceeds limit",
  );
  const entries = [];
  const names = new Set();
  for (let at = 0; at < bytes.length; ) {
    const end = bytes.indexOf(0, at);
    assert(end > at && end + 21 <= bytes.length, "Malformed Git tree");
    const header = bytes.subarray(at, end).toString("utf8");
    const space = header.indexOf(" ");
    const mode = header.slice(0, space);
    const name = header.slice(space + 1);
    assert(
      /^(40000|100644|100755|120000|160000)$/.test(mode) &&
        name &&
        !name.includes("/") &&
        name !== "." &&
        name !== ".." &&
        !names.has(name),
      "Invalid or duplicate Git tree entry",
    );
    names.add(name);
    entries.push({
      mode,
      name,
      oid: bytes.subarray(end + 1, end + 21).toString("hex"),
    });
    at = end + 21;
  }
  return entries;
}

// The importer uses this same selection before fetching any payload blobs.
export function selectSourceFiles(commit, oid, readTree) {
  assert(
    Buffer.isBuffer(commit) && commit.length <= 256 * 1024,
    "Git commit exceeds limit",
  );
  assert.equal(
    gitObjectId("commit", commit),
    oid,
    "Source commit object mismatch",
  );
  const root = /^tree ([a-f0-9]{40})\n/.exec(commit.toString("utf8"))?.[1];
  assert(root, "Source commit has no root tree");
  let visited = 0;
  const names = new Set();
  const files = [];
  const tree = (id) => {
    const bytes = readTree(id);
    assert.equal(gitObjectId("tree", bytes), id, "Source tree object mismatch");
    return treeEntries(bytes);
  };
  const visit = (entry, prefix = "", depth = 0) => {
    const relative = prefix + entry.name;
    assert(
      ++visited <= 1024 && depth <= 8 && portable(entry.name),
      "Unsafe source path",
    );
    assert(!names.has(relative.toLowerCase()), "Case-colliding source paths");
    names.add(relative.toLowerCase());
    if (entry.mode === "40000") {
      for (const child of tree(entry.oid))
        visit(child, relative + "/", depth + 1);
    } else {
      assert(
        entry.mode === "100644",
        "Source payload must be regular, non-executable files",
      );
      assert(files.length < 512, "Too many source payload files");
      assert(
        PAYLOAD.includes(relative) ||
          relative === "LICENSE" ||
          /^assets\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[a-z0-9-]+\.(png|webp|mp3)$/.test(
            relative,
          ),
        "Unsupported source payload file",
      );
      files.push({ path: relative, gitBlob: entry.oid });
    }
  };
  const entries = tree(root);
  for (const name of PAYLOAD)
    assert(
      entries.some((e) => e.name === name),
      "Source is missing required payload",
    );
  for (const entry of entries) {
    if (PAYLOAD.includes(entry.name) || entry.name === "LICENSE") {
      assert(
        entry.mode === "100644",
        "Source root payload must be a regular file",
      );
      visit(entry);
    } else if (entry.name === "assets") {
      assert(entry.mode === "40000", "Source assets must be a directory");
      visit(entry);
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const decode = (encoded) => {
  assert(
    typeof encoded === "string" && encoded.length <= 350 * 1024,
    "Invalid Git proof encoding",
  );
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(
    bytes.toString("base64"),
    encoded,
    "Noncanonical Git proof encoding",
  );
  return bytes;
};
export function verifySourceProof(source, proof, files) {
  assert.deepEqual(Object.keys(proof || {}).sort(), [
    "commit",
    "schemaVersion",
    "source",
    "trees",
  ]);
  assert.equal(proof.schemaVersion, 1, "Unsupported source proof");
  assert.deepEqual(
    proof.source,
    source,
    "Source proof repository or commit mismatch",
  );
  assert(
    proof.trees &&
      typeof proof.trees === "object" &&
      !Array.isArray(proof.trees),
    "Invalid proof trees",
  );
  const ids = Object.keys(proof.trees);
  assert(
    ids.length <= 1024 && ids.every((id) => /^[a-f0-9]{40}$/.test(id)),
    "Invalid proof tree ids",
  );
  const used = new Set();
  const expected = selectSourceFiles(
    decode(proof.commit),
    source.commit,
    (id) => {
      assert(Object.hasOwn(proof.trees, id), "Missing source tree proof");
      used.add(id);
      return decode(proof.trees[id]);
    },
  );
  assert.deepEqual(
    [...used].sort(),
    ids.sort(),
    "Unexpected source tree proof",
  );
  assert.deepEqual(
    files.map(({ path, gitBlob }) => ({ path, gitBlob })),
    expected,
    "Vendored payload differs from the source commit",
  );
}
