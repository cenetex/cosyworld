import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(
  fs.readFileSync(path.resolve(scriptDir, "../content/elysium/pack.json"), "utf8"),
);

test("Elysium preserves production generated descendants across its catalog upgrade", () => {
  const policy = pack.extensions?.["x-cosyworld-generation"];

  assert.equal(pack.version, "0.2.2");
  assert.equal(policy?.schema_version, 1);
  assert.equal(policy?.policy_id, "cosyworld.elysium/generation/1");
  assert.equal(policy?.migration_version, 1);
  assert.deepEqual(policy?.migrations, [
    {
      from_policy_id: "cosyworld.compatibility.host-generation/1",
      from_migration_version: 0,
      from_pack_version: "0.2.0",
      mode: "preserve_descendants",
    },
  ]);
});
