import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import Database from "better-sqlite3";

import {
  migratePackRemount,
  migratePackUnmount,
  retireRoomRopesForPackMigration,
} from "./migrate-pack-unmount.mjs";

const sourceRegistry = JSON.parse(
  await readFile(
    new URL("../content/core-ruby/registry.json", import.meta.url),
    "utf8",
  ),
);
const targetRegistry = JSON.parse(
  await readFile(
    new URL("../content/core-only/registry.json", import.meta.url),
    "utf8",
  ),
);

function item(id, locationId) {
  return {
    id,
    location_id: locationId,
    holder_actor_id: 0,
    container_item_id: 0,
  };
}

function actorJobDatabase() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE actor_jobs (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      lease_until_ms INTEGER,
      last_error TEXT,
      updated_at_ms INTEGER NOT NULL
    )
  `);
  return database;
}

test("pack migration retires pending room ropes", () => {
  const database = actorJobDatabase();
  database.prepare(`
    INSERT INTO actor_jobs
      (id, kind, status, lease_until_ms, last_error, updated_at_ms)
    VALUES (1, 'room_rope', 'pending', NULL, NULL, 10)
  `).run();

  assert.equal(retireRoomRopesForPackMigration(database, 20), 1);
  assert.deepEqual(
    database.prepare(`
      SELECT status, lease_until_ms, last_error, updated_at_ms
      FROM actor_jobs WHERE id = 1
    `).get(),
    {
      status: "completed",
      lease_until_ms: null,
      last_error: "retired_for_pack_migration",
      updated_at_ms: 20,
    },
  );
  database.close();
});

test("pack migration still rejects other active actor jobs", () => {
  for (const [kind, status] of [
    ["player_tick_observation", "pending"],
    ["room_rope", "running"],
  ]) {
    const database = actorJobDatabase();
    database.prepare(`
      INSERT INTO actor_jobs
        (id, kind, status, lease_until_ms, last_error, updated_at_ms)
      VALUES (1, ?, ?, NULL, NULL, 10)
    `).run(kind, status);
    assert.throws(
      () => retireRoomRopesForPackMigration(database, 20),
      /cannot migrate while 1 actor job\(s\) are pending or running/,
    );
    database.close();
  }
});

test("soft unmount evacuates retained-pack items before a restorative remount", () => {
  const snapshot = {
    worldpack_bundle_hash: sourceRegistry.manifest.bundle_hash,
    rules_profile: sourceRegistry.manifest.rules_profile,
    active_rules_variants: sourceRegistry.manifest.active_rules_variants,
    active_rules_extensions: sourceRegistry.manifest.active_rules_extensions,
    world_actors: [],
    world_items: [item(2015, 11), item(2110, 11)],
    world_locations: [{ id: 1 }, { id: 11 }],
    world_exits: [],
    world_evolution_tracks: [],
    world_combat_encounters: [],
  };

  const unmounted = migratePackUnmount(
    snapshot,
    sourceRegistry,
    "ruby-high.first-bell",
    targetRegistry,
  );
  assert.deepEqual(
    unmounted.snapshot.world_items,
    [item(2015, 1)],
    "the retained Core item must evacuate instead of becoming frozen Ruby state",
  );
  assert.deepEqual(
    unmounted.snapshot.pack_mount_state.frozen[
      "ruby-high.first-bell"
    ].arrays.world_items.map((entry) => entry.value),
    [item(2110, 11)],
  );

  const remounted = migratePackRemount(
    unmounted.snapshot,
    targetRegistry,
    "ruby-high.first-bell",
    sourceRegistry,
  );
  assert.deepEqual(remounted.snapshot.world_items, [
    item(2015, 1),
    item(2110, 11),
  ]);
  assert.equal(
    new Set(remounted.snapshot.world_items.map(({ id }) => id)).size,
    remounted.snapshot.world_items.length,
    "remount must not collide with a newly materialized retained-pack identity",
  );
});
