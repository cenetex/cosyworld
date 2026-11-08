import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  payloadHash,
  safePath,
  scanFiles,
  verifyStore,
} from "./card-store.mjs";
import { gitObjectId, verifySourceProof } from "./card-store-proof.mjs";
import { sourceUrl } from "./card-store-fetch.mjs";
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

export function installSnapshot(v2, source, { proof, files }) {
  sourceUrl(source);
  assert(
    Array.isArray(files) && files.length <= 512,
    "Invalid source snapshot",
  );
  let total = 0;
  const records = files
    .map(({ path, bytes }) => {
      assert(
        Buffer.isBuffer(bytes) &&
          bytes.length <= 16 * 1024 * 1024 &&
          (total += bytes.length) <= 128 * 1024 * 1024,
        "Snapshot exceeds payload limit",
      );
      return {
        path,
        size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        gitBlob: gitObjectId("blob", bytes),
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const proofBytes = jsonBytes(proof);
  assert(proofBytes.length <= 4 * 1024 * 1024, "Snapshot proof exceeds limit");
  verifySourceProof(source, proof, records);
  const manifestBytes = files.find(
    (file) => file.path === "worldpack.json",
  ).bytes;
  assert(manifestBytes.length <= 4 * 1024 * 1024, "Manifest exceeds limit");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const { id } = manifest;
  assert(
    typeof id === "string" &&
      id.length <= 64 &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id),
    "Invalid imported pack id",
  );
  const entry = {
    id,
    source: { ...source },
    pinned: {
      revision: manifest.revision,
      contract: manifest.engine?.contract,
      sha256: payloadHash(records),
    },
    mounted: false,
  };
  const storeDir = safePath(v2, "worldpacks");
  const assetDir = safePath(v2, "card-game/assets");
  assert(
    fs.lstatSync(assetDir).isDirectory(),
    "Asset root must be a directory",
  );
  const lockFile = path.join(storeDir, ".import.lock");
  const lock = fs.openSync(lockFile, "wx", 0o600);
  const made = [];
  const proofsDir = path.join(storeDir, "proofs");
  let stage,
    madeProofs = false,
    committed = false;
  try {
    verifyStore(v2);
    const indexFile = safePath(v2, "worldpacks/store.json");
    const previous = fs.readFileSync(indexFile);
    const index = JSON.parse(previous);
    assert(
      index.packs.length < 32 && !index.packs.some((pack) => pack.id === id),
      "Existing or full store: use a reviewed update",
    );
    const tableFile = safePath(v2, "worlds/card-table.json");
    const table = fs.readFileSync(tableFile);
    stage = fs.mkdtempSync(path.join(storeDir, ".import-"));
    const write = (relative, bytes) => {
      const target = path.join(stage, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o644 });
      return target;
    };
    write("worlds/card-table.json", table);
    write(
      "worldpacks/store.json",
      jsonBytes({ schemaVersion: 1, packs: [entry] }),
    );
    write(
      "worldpacks/vendor-manifest.json",
      jsonBytes({ schemaVersion: 1, packs: [] }),
    );
    write(`worldpacks/proofs/${id}.json`, proofBytes);
    fs.mkdirSync(path.join(stage, `card-game/assets/${id}`), {
      recursive: true,
    });
    for (const file of files) {
      write(`worldpacks/${id}/${file.path}`, file.bytes);
      if (file.path.startsWith("assets/"))
        write(`card-game/assets/${id}/${file.path.slice(7)}`, file.bytes);
    }
    verifyStore(stage);
    const proofStat = fs.lstatSync(proofsDir, { throwIfNoEntry: false });
    assert(
      !proofStat || proofStat.isDirectory(),
      "Proof root must be a real directory",
    );
    if (!proofStat) {
      fs.mkdirSync(proofsDir);
      madeProofs = true;
    }
    for (const [parent, name] of [
      [storeDir, id],
      [assetDir, id],
      [proofsDir, `${id}.json`],
    ])
      assert(
        !fs
          .readdirSync(parent)
          .some((nameHere) => nameHere.toLowerCase() === name.toLowerCase()),
        "Import destination already exists",
      );
    for (const relative of [`worldpacks/${id}`, `card-game/assets/${id}`]) {
      const target = path.join(v2, relative);
      fs.mkdirSync(target, { mode: 0o700 });
      made.push(target);
      for (const name of fs.readdirSync(path.join(stage, relative)))
        fs.cpSync(path.join(stage, relative, name), path.join(target, name), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      assert.deepEqual(
        scanFiles(target),
        scanFiles(path.join(stage, relative)),
        "Installed payload copy differs",
      );
      fs.chmodSync(target, 0o755);
    }
    const proofFile = path.join(proofsDir, `${id}.json`);
    const fd = fs.openSync(proofFile, "wx", 0o644);
    made.push(proofFile);
    try {
      fs.writeFileSync(fd, proofBytes);
    } finally {
      fs.closeSync(fd);
    }
    assert.deepEqual(
      fs.readFileSync(proofFile),
      proofBytes,
      "Installed proof differs",
    );
    assert.deepEqual(
      fs.readFileSync(indexFile),
      previous,
      "Store changed during import",
    );
    assert.deepEqual(
      fs.readFileSync(tableFile),
      table,
      "Native table changed during import",
    );
    index.packs.push(entry);
    const next = write("next-index.json", jsonBytes(index));
    fs.chmodSync(next, fs.statSync(indexFile).mode & 0o777);
    fs.renameSync(next, indexFile);
    committed = true;
    return entry;
  } finally {
    const cleanup = () => {
      try {
        if (!committed) {
          for (const target of made.reverse())
            fs.rmSync(target, { recursive: true, force: true });
          if (madeProofs) fs.rmdirSync(proofsDir);
        }
        if (stage) fs.rmSync(stage, { recursive: true, force: true });
      } finally {
        fs.closeSync(lock);
        fs.unlinkSync(lockFile);
      }
    };
    try {
      cleanup();
    } catch (error) {
      if (!committed) throw error;
      console.warn(
        "Import committed; temporary cleanup failed:",
        error.message,
      );
    }
  }
}
