//! One-time removal of the retired classic game's event store tables (#1652).
//!
//! Existing deployments still carry the classic world's tables in the same
//! SQLite file as accounts, shared card worlds and their append-only journal.
//! The owner decided on 2026-11-10 that those rows are not needed. Dropping
//! them cannot be undone except from a volume backup, so this runs only behind
//! `COSYWORLD_ONE_TIME_DROP_CLASSIC_ROWS=1`, only for the named tables below,
//! and says what it did at warn level.
use super::*;
use crate::util::sqlite_error;

const BUSY_TIMEOUT: Duration = Duration::from_secs(30);

/// Flag name, spelled out once so the log lines and the docs agree.
const FLAG: &str = "COSYWORLD_ONE_TIME_DROP_CLASSIC_ROWS";

/// The classic tables to drop. This is a hard-coded list, never a pattern.
///
/// How it was built: every `CREATE TABLE` in `v2/orchestrator-rust/src` on the
/// commit before #2598 removed the classic schema init, minus every table the
/// current tree creates, reads or writes (accounts and passkeys, `card_*`,
/// authoring, play metrics, signing keys). The last readers of `action_journal`
/// and `persistence_compaction` (`card-policy-lab export-shadow` and
/// `inspect-action-journal.mjs`) were deleted so both could join the list.
/// The source-scan test fails if
/// any name here is created or queried by the current source. `DROP TABLE`
/// takes the table's indexes and triggers with it.
const CLASSIC_TABLES: [&str; 51] = [
    "activation_events",
    "activation_backfills",
    "ai_publication_attempts",
    "ai_voice_jobs",
    "ai_voice_attempt_decisions",
    "ai_voice_content_evidence",
    "ai_voice_provider_health",
    "ai_voice_family_accepts",
    "canonical_world_state",
    "canonical_store_identity",
    "canonical_partition_leases",
    "canonical_ownership_checkpoints",
    "canonical_entity_versions",
    "canonical_claims",
    "canonical_commits",
    "canonical_compacted_commit_ranges",
    "canonical_process_routes",
    "canonical_region_authority",
    "canonical_region_replicas",
    "canonical_region_promotions",
    "canonical_invites",
    "canonical_hosted_parties",
    "canonical_hosted_party_members",
    "canonical_hosted_access_entries",
    "canonical_hosted_access_events",
    "canonical_legacy_import_receipts",
    "canonical_legacy_import_mappings",
    "canonical_legacy_import_projections",
    "canonical_legacy_composition_migrations",
    "canonical_legacy_import_reports",
    "canonical_command_receipts",
    "world_events",
    "action_journal",
    "persistence_compaction",
    "room_memory_chapters",
    "actor_jobs",
    "actor_sessions",
    "avatar_session_handoffs",
    "wallet_avatar_links",
    "actor_suspensions",
    "moderation_reports",
    "orb_ledger",
    "ai_usage_ledger",
    "wooden_box_receipts",
    "avatar_pack_openings",
    "economy_reconciliation_runs",
    "media_jobs",
    "media_budget_days",
    "model_interaction_batches",
    "story_metric_events",
    "story_metric_backfills",
];

pub(crate) fn drop_requested() -> bool {
    std::env::var(FLAG)
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// What the drop did, for the log and for tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct DropReport {
    /// Dropped tables with the rows each held.
    pub(crate) dropped: Vec<(&'static str, i64)>,
    pub(crate) missing: usize,
    /// Free pages times page size once the drop committed.
    pub(crate) freed_bytes: u64,
}

/// Drop every allowlisted table that exists, in one transaction. A failure
/// before the commit rolls everything back.
pub(crate) fn drop_classic_tables(path: &Path) -> io::Result<DropReport> {
    let mut conn = Connection::open(path).map_err(sqlite_error)?;
    conn.busy_timeout(BUSY_TIMEOUT).map_err(sqlite_error)?;
    let tx = conn.transaction().map_err(sqlite_error)?;
    let mut report = DropReport::default();
    for table in CLASSIC_TABLES {
        let exists = tx
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |_| Ok(()),
            )
            .optional()
            .map_err(sqlite_error)?
            .is_some();
        if !exists {
            warn!(table, exists = false, "classic table not present; skipped");
            report.missing += 1;
            continue;
        }
        let rows: i64 = tx
            .query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
                row.get(0)
            })
            .map_err(sqlite_error)?;
        warn!(table, exists = true, rows, "dropping classic table");
        tx.execute_batch(&format!("DROP TABLE \"{table}\""))
            .map_err(sqlite_error)?;
        report.dropped.push((table, rows));
    }
    tx.commit().map_err(sqlite_error)?;
    let free_pages: u64 = conn
        .query_row("PRAGMA freelist_count", [], |row| row.get(0))
        .map_err(sqlite_error)?;
    let page_size: u64 = conn
        .query_row("PRAGMA page_size", [], |row| row.get(0))
        .map_err(sqlite_error)?;
    report.freed_bytes = free_pages * page_size;
    Ok(report)
}

/// Return the freed pages to the filesystem: convert to incremental
/// auto_vacuum (a full VACUUM) or, when already converted, run the
/// incremental pass, then truncate the WAL.
pub(crate) fn shrink_store(path: &Path) -> io::Result<&'static str> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.busy_timeout(BUSY_TIMEOUT).map_err(sqlite_error)?;
    let mode: i64 = conn
        .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
        .map_err(sqlite_error)?;
    let how = if mode == 2 {
        conn.execute_batch("PRAGMA incremental_vacuum")
            .map_err(sqlite_error)?;
        "incremental_vacuum"
    } else {
        drop(conn);
        convert_existing_store_to_incremental_auto_vacuum(path)?;
        "vacuum"
    };
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .map_err(sqlite_error)?;
    Ok(how)
}

/// Boot step for the operator flag. A failed drop (rolled back) stops the
/// boot; a failed shrink after a committed drop is logged and boot continues.
pub(crate) fn run_requested_drop(path: &Path) -> io::Result<DropReport> {
    warn!(
        path = %path.display(),
        "{FLAG} is set: dropping the retired classic tables. This cannot be undone except from a volume backup"
    );
    let report = drop_classic_tables(path).map_err(|error| {
        deployment_config_error(format!(
            "dropping classic tables failed for {}: {error}; nothing was dropped, fix the volume before deploying",
            path.display()
        ))
    })?;
    if report.dropped.is_empty() {
        warn!(
            missing = report.missing,
            "no classic tables found; unset {FLAG} so later deploys skip this step"
        );
        return Ok(report);
    }
    warn!(
        tables = report.dropped.len(),
        rows = report.dropped.iter().map(|(_, rows)| rows).sum::<i64>(),
        freed_bytes = report.freed_bytes,
        "classic tables dropped; unset {FLAG} on the next deploy"
    );
    match shrink_store(path) {
        Ok(how) => warn!(how, "event store file shrunk after the classic drop"),
        Err(error) => error!(
            %error,
            path = %path.display(),
            "the classic drop stands but the file could not be shrunk (not enough free space?); the freed pages are reusable and COSYWORLD_ONE_TIME_AUTO_VACUUM=1 retries the shrink"
        ),
    }
    Ok(report)
}

#[cfg(test)]
pub(crate) fn classic_tables() -> &'static [&'static str] {
    &CLASSIC_TABLES
}
