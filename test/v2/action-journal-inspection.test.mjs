import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inspectActionJournal } from "../../v2/scripts/inspect-action-journal.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const inspectorPath = path.join(repoRoot, "v2/scripts/inspect-action-journal.mjs");

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function context(references, mappingVersion = 1) {
  return {
    mapping_version: mappingVersion,
    references,
    active_rulesets: [],
  };
}

describe("read-only action journal inspection", () => {
  let tempRoot;
  let eventDbPath;
  let registryPath;
  let registry;
  let degradedPayload;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "cosyworld-journal-inspection-"));
    eventDbPath = path.join(tempRoot, "events.sqlite");
    registryPath = path.join(tempRoot, "registry.json");
    const available = {
      canonical_ref: "pack://active.pack/location/home",
      pack_id: "active.pack",
      pack_version: "1.0.0",
      kind: "location",
      local_id: "home",
      runtime_handle: 1_000_000_000_001,
    };
    const remapped = {
      canonical_ref: "pack://active.pack/item/charm",
      pack_id: "active.pack",
      pack_version: "1.0.0",
      kind: "item",
      local_id: "charm",
      runtime_handle: 1_000_000_000_009,
    };
    registry = {
      manifest: {
        bundle_hash: `sha256:${"a".repeat(64)}`,
        packs: [{ id: "active.pack", version: "1.0.0" }],
      },
      content_references: {
        mapping_version: 1,
        entries: [available, remapped],
      },
    };
    await writeFile(registryPath, JSON.stringify(registry));

    const missing = {
      canonical_ref: "pack://missing.pack/creature/goblin",
      pack_id: "missing.pack",
      pack_version: "2.0.0",
      kind: "creature",
      local_id: "goblin",
      runtime_handle: 1_000_000_000_010,
    };
    degradedPayload = JSON.stringify({
      version: 7,
      worldpack_bundle_hash: `sha256:${"b".repeat(64)}`,
      content_context: context([
        missing,
        { ...available, pack_version: "0.9.0" },
        {
          ...available,
          canonical_ref: "pack://active.pack/location/removed",
          local_id: "removed",
        },
        { ...remapped, runtime_handle: 1_000_000_000_008 },
      ]),
    });
    const database = new Database(eventDbPath);
    database.exec(`
      CREATE TABLE action_journal (
        journal_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        action_kind INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        record_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      )
    `);
    const insert = database.prepare(
      `INSERT INTO action_journal (action_kind, seed, record_json, created_at_ms)
       VALUES (?, ?, ?, ?)`,
    );
    insert.run(1, 11, JSON.stringify({
      version: 7,
      worldpack_bundle_hash: registry.manifest.bundle_hash,
      content_context: context([available]),
    }), 101);
    insert.run(2, 22, degradedPayload, 102);
    insert.run(3, 33, "{broken record", 103);
    insert.run(4, 44, JSON.stringify({
      version: 1,
      worldpack_bundle_hash: "",
      content_context: context([], 0),
    }), 104);
    database.close();
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("keeps unavailable identities inspectable without mutating or replaying the journal", async () => {
    const before = digest(await readFile(eventDbPath));
    const result = inspectActionJournal(eventDbPath, registry, { limit: 10 });
    const after = digest(await readFile(eventDbPath));

    expect(after).toBe(before);
    expect(result).toMatchObject({
      schema_version: 1,
      ok: true,
      inspectable: true,
      window: { returned: 4, first_seq: 1, last_seq: 4 },
      summary: {
        available_records: 1,
        degraded_records: 1,
        legacy_records: 1,
        malformed_records: 1,
        incompatible_bundle_records: 1,
        available_references: 1,
        missing_pack_references: 1,
        version_mismatch_references: 1,
        unknown_references: 1,
        remapped_references: 1,
      },
    });
    const degraded = result.records.find((record) => record.journal_seq === 2);
    expect(degraded).toMatchObject({
      status: "degraded",
      replayable: false,
      bundle_status: "incompatible",
      record_bytes: Buffer.byteLength(degradedPayload),
      record_sha256: digest(degradedPayload),
    });
    expect(degraded.content_references.map((reference) => reference.status)).toEqual([
      "missing_pack",
      "version_mismatch",
      "unknown_reference",
      "remapped",
    ]);
    expect(degraded.content_references[0]).toMatchObject({
      canonical_ref: "pack://missing.pack/creature/goblin",
      pack_id: "missing.pack",
      pack_version: "2.0.0",
      kind: "creature",
      local_id: "goblin",
      runtime_handle: 1_000_000_000_010,
      status: "missing_pack",
      tombstone: true,
    });
    expect(result.records.find((record) => record.journal_seq === 3)).toMatchObject({
      status: "malformed",
      replayable: false,
      record_sha256: digest("{broken record"),
    });
    expect(result.records.find((record) => record.journal_seq === 4)).toMatchObject({
      status: "legacy",
      replayable: true,
      bundle_status: "legacy_unversioned",
    });
  });

  it("exposes the same bounded degraded view through the CLI", () => {
    const inspected = spawnSync(process.execPath, [
      inspectorPath,
      "--event-db",
      eventDbPath,
      "--registry",
      registryPath,
      "--after-seq",
      "1",
      "--limit",
      "2",
    ], { cwd: repoRoot, encoding: "utf8" });
    expect(inspected.status, inspected.stderr).toBe(0);
    const output = JSON.parse(inspected.stdout);
    expect(output.window).toMatchObject({
      after_seq: 1,
      limit: 2,
      returned: 2,
      first_seq: 2,
      last_seq: 3,
    });
    expect(output.summary).toMatchObject({
      degraded_records: 1,
      malformed_records: 1,
      missing_pack_references: 1,
    });
  });

  it("uses declared bundle migrations for pack-version compatibility", () => {
    registry.manifest.persistence_compatibility = {
      schema_version: 1,
      replay_compatible_bundle_hashes: [`sha256:${"b".repeat(64)}`],
    };
    const result = inspectActionJournal(eventDbPath, registry, { limit: 10 });
    const degraded = result.records.find((record) => record.journal_seq === 2);

    expect(degraded.bundle_status).toBe("declared_migration");
    expect(degraded.content_references.map((reference) => reference.status)).toEqual([
      "missing_pack",
      "available",
      "unknown_reference",
      "remapped",
    ]);
    expect(result.summary.version_mismatch_references).toBe(0);
  });

  it("reports compacted journal history without mutating the persistence store", async () => {
    const database = new Database(eventDbPath);
    database.exec(`
      CREATE TABLE persistence_compaction (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        action_journal_floor_seq INTEGER NOT NULL DEFAULT 0,
        world_event_floor_seq INTEGER NOT NULL DEFAULT 0,
        last_compacted_at_ms INTEGER,
        deleted_action_journal_rows INTEGER NOT NULL DEFAULT 0,
        deleted_world_event_rows INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO persistence_compaction (
        singleton, action_journal_floor_seq, world_event_floor_seq,
        last_compacted_at_ms, deleted_action_journal_rows, deleted_world_event_rows
      ) VALUES (1, 3, 41, 123456, 2, 40);
    `);
    database.close();
    const before = digest(await readFile(eventDbPath));

    const result = inspectActionJournal(eventDbPath, registry, { limit: 10 });

    expect(digest(await readFile(eventDbPath))).toBe(before);
    expect(result.compaction).toEqual({
      action_journal_floor_seq: 3,
      world_event_floor_seq: 41,
      last_compacted_at_ms: 123456,
      deleted_action_journal_rows: 2,
      deleted_world_event_rows: 40,
    });
  });
});
