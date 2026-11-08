// Offline integrity and pinned Git evidence. Import and compiler admission follow.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  gitObjectId,
  PAYLOAD,
  verifySourceProof,
} from "./card-store-proof.mjs";

export const CONTRACT = "cosyworld.card-table/1";
export { PAYLOAD };
const idOk = (id) =>
  typeof id === "string" &&
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) &&
  id.length <= 64;
const partOk = (part) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(part);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const keys = (value, names) =>
  assert.deepEqual(
    Object.keys(value || {}).sort(),
    [...names].sort(),
    "Unexpected store fields",
  );
const native = new Set([
  "boardyai",
  "sleep",
  "title",
  "music",
  "voices",
  "attic",
  "optimized",
  "staging",
  "shared",
  "authoring-guide",
  "combat",
  "settings",
  "rest",
  "locked-card",
  "constructor",
  "prototype",
  "proofs",
]);

export function safePath(root, relative) {
  assert(
    fs.lstatSync(root).isDirectory(),
    "Store root must be a real directory",
  );
  const parts = relative.split("/");
  assert(parts.length <= 12 && parts.every(partOk), "Unsafe store path");
  let target = root;
  for (const part of parts) {
    target = path.join(target, part);
    assert(
      !fs.lstatSync(target).isSymbolicLink(),
      "Store paths cannot contain symlinks",
    );
  }
  return target;
}

export function scanFiles(root) {
  const files = [];
  let total = 0;
  let visited = 0;
  const walk = (dir, prefix = "", depth = 0) => {
    assert(
      depth <= 8 && fs.lstatSync(dir).isDirectory(),
      "Invalid store directory",
    );
    for (const name of fs.readdirSync(dir).sort()) {
      assert(++visited <= 1024, "Too many store paths");
      assert(partOk(name), "Unsafe store filename");
      const relative = prefix + name;
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      assert(!stat.isSymbolicLink(), "Store payload cannot contain symlinks");
      if (stat.isDirectory()) {
        walk(file, relative + "/", depth + 1);
        continue;
      }
      assert(
        stat.isFile() && !(stat.mode & 0o111),
        "Store payload must contain regular, non-executable files",
      );
      assert(
        stat.size <= 16 * 1024 * 1024 &&
          (total += stat.size) <= 128 * 1024 * 1024 &&
          files.length < 512,
        "Store payload exceeds its size limit",
      );
      const fd = fs.openSync(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      let bytes;
      try {
        bytes = fs.readFileSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      files.push({
        path: relative,
        size: bytes.length,
        sha256: hash(bytes),
        gitBlob: gitObjectId("blob", bytes),
      });
    }
  };
  walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export const payloadHash = (files) =>
  hash(files.map((f) => `${f.path}\n${f.size}\n${f.sha256}\n`).join(""));
const json = (root, relative) => {
  const file = safePath(root, relative);
  assert(
    fs.statSync(file).isFile() && fs.statSync(file).size <= 4 * 1024 * 1024,
    "Store JSON exceeds its size limit",
  );
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

export function verifyStore(v2, { check = true } = {}) {
  const store = json(v2, "worldpacks/store.json");
  keys(store, ["schemaVersion", "packs"]);
  assert(
    store.schemaVersion === 1 &&
      Array.isArray(store.packs) &&
      store.packs.length <= 32,
    "Invalid store index",
  );
  const table = json(v2, "worlds/card-table.json");
  const seen = new Set();
  const verified = [];
  for (const entry of store.packs) {
    keys(entry, ["id", "source", "pinned", "mounted"]);
    const { id, source, pinned, mounted } = entry;
    assert(
      idOk(id) && !seen.has(id) && !native.has(id) && !table.packs.includes(id),
      "Duplicate or reserved store id",
    );
    seen.add(id);
    keys(source, ["repo", "commit"]);
    keys(pinned, ["revision", "contract", "sha256"]);
    assert(
      typeof source.repo === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
          source.repo,
        ),
      "Invalid source repository",
    );
    assert(
      typeof source.commit === "string" &&
        /^[a-f0-9]{40}$/.test(source.commit) &&
        !/^0+$/.test(source.commit),
      "Pin an exact source commit",
    );
    assert(
      typeof mounted === "boolean" &&
        Number.isSafeInteger(pinned.revision) &&
        pinned.revision > 0 &&
        pinned.contract === CONTRACT &&
        typeof pinned.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(pinned.sha256),
      "Invalid contract, revision, mount state or hash",
    );
    const dir = `worldpacks/${id}`;
    const files = scanFiles(safePath(v2, dir));
    assert(
      files.every(
        (f) =>
          PAYLOAD.includes(f.path) ||
          f.path === "LICENSE" ||
          /^assets\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[a-z0-9-]+\.(png|webp|mp3)$/.test(
            f.path,
          ),
      ),
      "Unsupported payload file",
    );
    assert(
      PAYLOAD.every((name) => files.some((f) => f.path === name)),
      "Missing manifest or provenance payload",
    );
    assert.equal(
      payloadHash(files),
      pinned.sha256,
      "Vendored payload differs from its pin",
    );
    verifySourceProof(source, json(v2, `worldpacks/proofs/${id}.json`), files);
    const manifest = json(v2, `${dir}/worldpack.json`);
    const world = json(v2, `${dir}/card-world.json`);
    const bridge = json(v2, `${dir}/card-bridge.json`);
    assert(
      manifest.schemaVersion === 1 &&
        manifest.kind === "cosyworld.worldpack/1" &&
        manifest.id === id &&
        world.schemaVersion === 1 &&
        world.id === id &&
        world.packId === `cosyworld.${id}` &&
        bridge.schemaVersion === 1 &&
        bridge.pack === id,
      "Package identity mismatch",
    );
    assert(
      manifest.revision === pinned.revision &&
        world.revision === pinned.revision &&
        manifest.engine?.contract === pinned.contract &&
        manifest.engine.entry === world.entry &&
        manifest.source?.repo === source.repo,
      "Package contract, revision or source mismatch",
    );
    const assets = files
      .filter((f) => f.path.startsWith("assets/"))
      .map((f) => ({ ...f, path: f.path.slice(7) }));
    const published = scanFiles(safePath(v2, `card-game/assets/${id}`));
    assert.deepEqual(
      published,
      assets,
      "Published assets differ from the complete pinned asset set",
    );
    verified.push({ entry, world, bridge, files });
  }
  const admitted = verified.filter(({ entry }) => entry.mounted);
  const expected = {
    schemaVersion: 1,
    packs: admitted.map(({ entry }) => ({
      ...entry,
      dir: `worldpacks/${entry.id}`,
    })),
  };
  const manifestFile = safePath(v2, "worldpacks/vendor-manifest.json");
  if (check)
    assert.deepEqual(
      json(v2, "worldpacks/vendor-manifest.json"),
      expected,
      "Vendor manifest differs from verified store index",
    );
  else fs.writeFileSync(manifestFile, JSON.stringify(expected, null, 2) + "\n");
  return admitted;
}
