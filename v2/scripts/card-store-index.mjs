import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Caller holds the import lock and prepares next on the same filesystem.
// Retaining the old inode preserves later writes through an editor's open fd.
export function publishStoreIndex(indexFile, next, previous) {
  fs.linkSync(next, `${next}.probe`);
  fs.unlinkSync(`${next}.probe`);
  const directory = fs.mkdtempSync(path.join(path.dirname(indexFile), ".index-recovery-"));
  const recovery = path.join(directory, "store.json");
  let moved = false;
  try {
    fs.renameSync(indexFile, recovery);
    moved = true;
    assert.deepEqual(fs.readFileSync(recovery), previous, "Store changed during import");
    fs.linkSync(next, indexFile);
    return recovery;
  } catch (error) {
    if (!moved) {
      fs.rmdirSync(directory);
      throw error;
    }
    try {
      fs.linkSync(recovery, indexFile);
    } catch (restore) {
      if (restore.code !== "EEXIST")
        error = new AggregateError([error, restore], `${error.message}; index restore failed: ${restore.message}`);
    }
    throw new Error(`Index update stopped; recovery retained at ${recovery}: ${error.message}`, { cause: error });
  }
}
