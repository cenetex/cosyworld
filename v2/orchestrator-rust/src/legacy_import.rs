use rusqlite::Connection;
use std::io;

pub(super) fn init_legacy_import_store(conn: &Connection) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS canonical_legacy_import_receipts (
            source_namespace TEXT PRIMARY KEY,
            receipt_id TEXT NOT NULL UNIQUE,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            source_hash TEXT NOT NULL,
            plan_hash TEXT NOT NULL,
            old_composition_hash TEXT NOT NULL,
            new_composition_hash TEXT NOT NULL,
            review_id TEXT NOT NULL,
            reviewed_by TEXT NOT NULL,
            mapping_count INTEGER NOT NULL,
            projection_count INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_legacy_import_mappings (
            source_ref TEXT PRIMARY KEY,
            source_namespace TEXT NOT NULL,
            world_id TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_record_hash TEXT NOT NULL,
            strategy TEXT NOT NULL,
            target_ref TEXT,
            review_id TEXT,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (source_namespace)
                REFERENCES canonical_legacy_import_receipts(source_namespace)
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_import_mappings_target
            ON canonical_legacy_import_mappings(world_id, source_kind, target_ref);
        CREATE TABLE IF NOT EXISTS canonical_legacy_import_projections (
            source_ref TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            projection_kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            active INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY (source_ref)
                REFERENCES canonical_legacy_import_mappings(source_ref)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_legacy_import_active_projection_target
            ON canonical_legacy_import_projections(world_id, projection_kind, target_ref)
            WHERE active = 1;
        CREATE TABLE IF NOT EXISTS canonical_legacy_composition_migrations (
            receipt_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            source_namespace TEXT NOT NULL,
            old_composition_hash TEXT NOT NULL,
            new_composition_hash TEXT NOT NULL,
            review_id TEXT NOT NULL,
            reviewed_by TEXT NOT NULL,
            transform_version TEXT NOT NULL,
            rationale TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_legacy_import_reports (
            report_id TEXT PRIMARY KEY,
            source_namespace TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            plan_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            report_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_import_reports_source
            ON canonical_legacy_import_reports(source_namespace, created_at_ms);",
    )
    .map_err(sqlite_error)
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}
