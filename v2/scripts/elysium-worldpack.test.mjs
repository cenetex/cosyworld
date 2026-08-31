import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertLootTableConfig } from "./loot-table-schema.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(
  fs.readFileSync(path.resolve(scriptDir, "../content/elysium/pack.json"), "utf8"),
);

test("Elysium preserves production generated descendants across its catalog upgrade", () => {
  const policy = pack.extensions?.["x-cosyworld-generation"];

  assert.equal(pack.version, "0.3.0");
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
    {
      from_policy_id: "cosyworld.elysium/generation/1",
      from_migration_version: 1,
      from_pack_version: "0.2.2",
      mode: "preserve_descendants",
    },
  ]);
});

test("Elysium void markers resolve through one authored identity table", () => {
  const items = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, "../content/elysium/items.json"), "utf8"),
  );
  const catalog = assertLootTableConfig(
    pack.extensions?.["x-cosyworld-loot-tables"],
    "Elysium loot tables",
  );
  const tableId = "cosyworld.elysium:loot/void-marker-identities";

  assert.equal(items.length, 500);
  assert(items.every((item) => item.name.startsWith("Unresolved Void Marker ")));
  assert(items.every((item) => item.identity_table_id === tableId));
  assert.equal(catalog.tables.length, 1);
  assert.deepEqual(catalog.tables[0].quantity, { min: 1, max: 1 });
  assert(catalog.item_templates.some((item) => item.mechanics));
  assert(catalog.item_templates.some((item) => item.container_capacity_tenths > 0));
  assert(new Set(catalog.item_templates.map((item) => item.role)).size >= 5);
});
