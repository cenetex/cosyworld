#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function boundedInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  assert(
    Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum,
    `${name} must be an integer from 0 through ${maximum}`,
  );
  return parsed;
}

function registryIndex(registry) {
  assert(
    typeof registry?.manifest?.bundle_hash === "string"
      && registry.manifest.bundle_hash.length > 0,
    "registry manifest has no bundle hash",
  );
  assert(Array.isArray(registry.manifest.packs), "registry manifest has no pack list");
  assert(
    Number.isSafeInteger(registry.content_references?.mapping_version),
    "registry has no content reference mapping version",
  );
  assert(
    Array.isArray(registry.content_references?.entries),
    "registry has no content reference entries",
  );
  return {
    packs: new Map(registry.manifest.packs.map((pack) => [pack.id, pack])),
    references: new Map(
      registry.content_references.entries.map((entry) => [entry.canonical_ref, entry]),
    ),
  };
}

function inspectReference(reference, index, declaredMigration) {
  const pack = index.packs.get(reference.pack_id);
  if (!pack) return "missing_pack";
  if (!declaredMigration && pack.version !== reference.pack_version) {
    return "version_mismatch";
  }
  const current = index.references.get(reference.canonical_ref);
  if (!current) return "unknown_reference";
  if (current.runtime_handle !== reference.runtime_handle) return "remapped";
  return "available";
}

function bundleStatus(persistedHash, registry) {
  if (!persistedHash) return "legacy_unversioned";
  if (persistedHash === registry.manifest.bundle_hash) return "exact";
  if (
    registry.manifest.persistence_compatibility?.replay_compatible_bundle_hashes
      ?.includes(persistedHash)
  ) {
    return "declared_migration";
  }
  return "incompatible";
}

function jsonInteger(value) {
  if (typeof value !== "bigint") return value;
  if (
    value <= BigInt(Number.MAX_SAFE_INTEGER)
    && value >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  return value.toString();
}

function recordDigest(payload) {
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

function emptySummary() {
  return {
    available_records: 0,
    degraded_records: 0,
    legacy_records: 0,
    malformed_records: 0,
    incompatible_bundle_records: 0,
    available_references: 0,
    missing_pack_references: 0,
    version_mismatch_references: 0,
    unknown_references: 0,
    remapped_references: 0,
  };
}

function referenceSummaryKey(status) {
  return status === "unknown_reference" ? "unknown_references" : `${status}_references`;
}

function inspectRecord(row, registry, index, summary) {
  const base = {
    journal_seq: jsonInteger(row.journal_seq),
    action_kind: jsonInteger(row.action_kind),
    seed: jsonInteger(row.seed),
    created_at_ms: jsonInteger(row.created_at_ms),
    record_bytes: Buffer.byteLength(row.record_json),
    record_sha256: recordDigest(row.record_json),
  };
  let record;
  try {
    record = JSON.parse(row.record_json);
  } catch (error) {
    summary.malformed_records += 1;
    return {
      ...base,
      status: "malformed",
      replayable: false,
      error: `record_json is not valid JSON: ${error.message}`,
    };
  }

  const context = record.content_context ?? {};
  const mappingVersion = Number(context.mapping_version ?? 0);
  const persistedBundleHash = record.worldpack_bundle_hash ?? "";
  const persistedBundleStatus = bundleStatus(persistedBundleHash, registry);
  const declaredMigration = persistedBundleStatus === "declared_migration";
  const references = Array.isArray(context.references)
    ? context.references.map((reference) => {
      const status = inspectReference(reference, index, declaredMigration);
      summary[referenceSummaryKey(status)] += 1;
      return {
        canonical_ref: reference.canonical_ref,
        pack_id: reference.pack_id,
        pack_version: reference.pack_version,
        kind: reference.kind,
        local_id: reference.local_id,
        runtime_handle: reference.runtime_handle,
        status,
        ...(status === "available" ? {} : { tombstone: true }),
      };
    })
    : [];
  const mappingMatches = mappingVersion === registry.content_references.mapping_version;
  const legacyContext = mappingVersion === 0;
  const legacyBundle = persistedBundleStatus === "legacy_unversioned";
  const incompatibleBundle = persistedBundleStatus === "incompatible";
  if (incompatibleBundle) summary.incompatible_bundle_records += 1;
  const degraded = incompatibleBundle || (
    !legacyContext
    && (
      !mappingMatches
      || references.some((reference) => reference.status !== "available")
    )
  );
  const legacy = !degraded && (legacyContext || legacyBundle);
  const status = degraded ? "degraded" : legacy ? "legacy" : "available";
  summary[`${status}_records`] += 1;
  return {
    ...base,
    status,
    replayable: !degraded,
    worldpack_bundle_hash: persistedBundleHash,
    bundle_status: persistedBundleStatus,
    content_mapping_version: mappingVersion,
    active_mapping_version: registry.content_references.mapping_version,
    content_references: references,
    ...(mappingMatches || legacy ? {} : { mapping_status: "mapping_version_mismatch" }),
  };
}

export function inspectActionJournal(eventDbPath, registry, options = {}) {
  const afterSeq = boundedInteger(options.afterSeq, 0, "after-seq");
  const limit = boundedInteger(options.limit, DEFAULT_LIMIT, "limit", MAX_LIMIT);
  assert(limit > 0, "limit must be greater than 0");
  const index = registryIndex(registry);
  let database;
  try {
    database = new Database(path.resolve(eventDbPath), {
      readonly: true,
      fileMustExist: true,
    });
    database.defaultSafeIntegers(true);
    const rows = database.prepare(
      `SELECT journal_seq, action_kind, seed, record_json, created_at_ms
       FROM action_journal
       WHERE journal_seq > ?
       ORDER BY journal_seq ASC
       LIMIT ?`,
    ).all(afterSeq, limit);
    const summary = emptySummary();
    const records = rows.map((row) => inspectRecord(row, registry, index, summary));
    return {
      schema_version: 1,
      ok: true,
      inspectable: true,
      registry: {
        bundle_hash: registry.manifest.bundle_hash,
        content_mapping_version: registry.content_references.mapping_version,
        pack_ids: registry.manifest.packs.map((pack) => pack.id),
      },
      window: {
        after_seq: afterSeq,
        limit,
        returned: records.length,
        first_seq: records[0]?.journal_seq ?? null,
        last_seq: records.at(-1)?.journal_seq ?? null,
      },
      summary,
      records,
    };
  } finally {
    database?.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  try {
    const args = process.argv.slice(2);
    const eventDbPath = option(args, "--event-db");
    const registryPath = option(args, "--registry");
    if (!eventDbPath || !registryPath) {
      throw new Error(
        "usage: inspect-action-journal.mjs --event-db events.sqlite --registry registry.json [--after-seq N] [--limit N]",
      );
    }
    const registry = JSON.parse(fs.readFileSync(path.resolve(registryPath), "utf8"));
    const result = inspectActionJournal(eventDbPath, registry, {
      afterSeq: option(args, "--after-seq"),
      limit: option(args, "--limit"),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`action journal inspection failed: ${error.message}`);
    process.exit(1);
  }
}
