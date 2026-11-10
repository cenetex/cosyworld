use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    io,
    ops::{Deref, DerefMut},
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) enum EventStoreConnection<'a> {
    Shared(MutexGuard<'a, Connection>),
    Owned(Connection),
}

impl Deref for EventStoreConnection<'_> {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        match self {
            Self::Shared(connection) => connection,
            Self::Owned(connection) => connection,
        }
    }
}

impl DerefMut for EventStoreConnection<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        match self {
            Self::Shared(connection) => connection,
            Self::Owned(connection) => connection,
        }
    }
}

/// Reuse the process-lifetime WAL connection for durable commits. Besides
/// preserving SQLite's page cache, the mutex queues in-process writers before
/// they enter SQLite's cross-process busy loop.
pub(super) fn event_store_writer<'a>(
    shared: Option<&'a Mutex<Connection>>,
    path: &Path,
) -> io::Result<EventStoreConnection<'a>> {
    match shared {
        Some(connection) => connection
            .lock()
            .map(EventStoreConnection::Shared)
            .map_err(|_| io::Error::other("event-store writer lock is poisoned")),
        None => open_event_store(path).map(EventStoreConnection::Owned),
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct CanonicalRegionAuthority {
    pub(super) world_id: String,
    pub(super) world_epoch: u64,
    pub(super) active_region_id: String,
    pub(super) promotion_epoch: u64,
    pub(super) durable_world_seq: u64,
    pub(super) updated_at_ms: u64,
}

pub(super) fn init_canonical_journal(
    conn: &Connection,
    world_id: &str,
    world_epoch: u64,
) -> io::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS canonical_world_state (
            world_id TEXT PRIMARY KEY,
            world_epoch INTEGER NOT NULL,
            committed_seq INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_store_identity (
            world_id TEXT PRIMARY KEY,
            world_epoch INTEGER NOT NULL,
            store_id TEXT NOT NULL UNIQUE,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_partition_leases (
            world_id TEXT NOT NULL,
            partition_key TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            fencing_epoch INTEGER NOT NULL,
            lease_expires_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, partition_key)
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_partition_leases_owner
            ON canonical_partition_leases(world_id, owner_id, lease_expires_at_ms);
        CREATE TABLE IF NOT EXISTS canonical_ownership_checkpoints (
            checkpoint_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            world_seq INTEGER NOT NULL,
            leases_json TEXT NOT NULL,
            reason TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_ownership_checkpoints_world_seq
            ON canonical_ownership_checkpoints(world_id, world_epoch, world_seq);
        CREATE TABLE IF NOT EXISTS canonical_entity_versions (
            world_id TEXT NOT NULL,
            entity_ref TEXT NOT NULL,
            entity_version INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, entity_ref)
        );
        CREATE TABLE IF NOT EXISTS canonical_claims (
            world_id TEXT NOT NULL,
            claim_kind TEXT NOT NULL,
            claim_key TEXT NOT NULL,
            source_intent_id TEXT,
            source_world_seq INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, claim_kind, claim_key)
        );
        CREATE TABLE IF NOT EXISTS canonical_commits (
            commit_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            first_world_seq INTEGER NOT NULL,
            last_world_seq INTEGER NOT NULL,
            intent_id TEXT,
            request_hash TEXT,
            owner_id TEXT NOT NULL,
            owner_fencing_epoch INTEGER NOT NULL,
            partitions_json TEXT NOT NULL,
            entity_versions_json TEXT NOT NULL,
            claims_json TEXT NOT NULL,
            action_journal_seq INTEGER NOT NULL UNIQUE,
            created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_commits_world_seq
            ON canonical_commits(world_id, world_epoch, last_world_seq);
        CREATE INDEX IF NOT EXISTS idx_canonical_commits_intent
            ON canonical_commits(world_id, intent_id);
        CREATE TABLE IF NOT EXISTS canonical_compacted_commit_ranges (
            commit_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            first_world_seq INTEGER NOT NULL,
            last_world_seq INTEGER NOT NULL,
            action_journal_seq INTEGER NOT NULL UNIQUE
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_compacted_commit_ranges_world_seq
            ON canonical_compacted_commit_ranges(
                world_id, world_epoch, last_world_seq
            );
        CREATE TABLE IF NOT EXISTS canonical_process_routes (
            world_id TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            process_id TEXT NOT NULL,
            base_url TEXT NOT NULL,
            heartbeat_expires_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, owner_id)
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_process_routes_live
            ON canonical_process_routes(world_id, heartbeat_expires_at_ms, process_id);
        CREATE TABLE IF NOT EXISTS canonical_region_authority (
            world_id TEXT PRIMARY KEY,
            world_epoch INTEGER NOT NULL,
            active_region_id TEXT NOT NULL,
            promotion_epoch INTEGER NOT NULL,
            durable_world_seq INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS canonical_region_replicas (
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            region_id TEXT NOT NULL,
            store_id TEXT NOT NULL,
            durable_world_seq INTEGER NOT NULL,
            action_journal_seq INTEGER NOT NULL,
            prefix_hash TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, region_id)
        );
        CREATE TABLE IF NOT EXISTS canonical_region_promotions (
            promotion_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            source_region_id TEXT NOT NULL,
            target_region_id TEXT NOT NULL,
            promotion_epoch INTEGER NOT NULL,
            durable_world_seq INTEGER NOT NULL,
            action_journal_seq INTEGER NOT NULL,
            prefix_hash TEXT NOT NULL,
            promoted_at_ms INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_region_promotions_epoch
            ON canonical_region_promotions(world_id, promotion_epoch);
        CREATE TABLE IF NOT EXISTS canonical_invites (
            invite_id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            actor_ref TEXT NOT NULL,
            created_location_ref TEXT NOT NULL,
            created_world_seq INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_canonical_invites_actor
            ON canonical_invites(world_id, actor_ref, expires_at_ms);",
    )
    .map_err(sqlite_error)?;

    ensure_column(
        conn,
        "canonical_process_routes",
        "region_id",
        "ALTER TABLE canonical_process_routes ADD COLUMN region_id TEXT NOT NULL DEFAULT 'local'",
    )?;

    for (column, alter_sql) in [
        (
            "commit_id",
            "ALTER TABLE canonical_command_receipts ADD COLUMN commit_id TEXT",
        ),
        (
            "world_epoch",
            "ALTER TABLE canonical_command_receipts ADD COLUMN world_epoch INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "world_seq",
            "ALTER TABLE canonical_command_receipts ADD COLUMN world_seq INTEGER NOT NULL DEFAULT 0",
        ),
        (
            "owner_id",
            "ALTER TABLE canonical_command_receipts ADD COLUMN owner_id TEXT",
        ),
        (
            "owner_fencing_epoch",
            "ALTER TABLE canonical_command_receipts ADD COLUMN owner_fencing_epoch INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "finalized",
            "ALTER TABLE canonical_command_receipts ADD COLUMN finalized INTEGER NOT NULL DEFAULT 1",
        ),
        (
            "updated_at_ms",
            "ALTER TABLE canonical_command_receipts ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0",
        ),
    ] {
        ensure_column(
            conn,
            "canonical_command_receipts",
            column,
            alter_sql,
        )?;
    }

    let max_seq = conn
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) FROM world_events",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    conn.execute(
        "INSERT OR IGNORE INTO canonical_world_state
            (world_id, world_epoch, committed_seq, updated_at_ms)
         VALUES (?1, ?2, ?3, 0)",
        params![world_id, as_i64(world_epoch)?, max_seq],
    )
    .map_err(sqlite_error)?;
    // Read the cursor, durable suffix, and commit count in one SQLite snapshot.
    // Separate autocommit SELECTs can straddle another process's commit and
    // briefly pair the new cursor with the old event maximum.
    let (stored_epoch, committed_seq, durable_max_seq, commit_count) = conn
        .query_row(
            "SELECT state.world_epoch,
                    state.committed_seq,
                    (SELECT COALESCE(MAX(seq), 0) FROM world_events),
                    (SELECT COUNT(*) FROM canonical_commits WHERE world_id = ?1)
             FROM canonical_world_state AS state
             WHERE state.world_id = ?1",
            params![world_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(sqlite_error)?;
    if stored_epoch != as_i64(world_epoch)? {
        return Err(invalid_data(format!(
            "canonical world epoch mismatch: storage has {stored_epoch}, runtime expects {world_epoch}"
        )));
    }
    if commit_count == 0 {
        conn.execute(
            "UPDATE canonical_world_state
             SET committed_seq = MAX(committed_seq, ?2)
             WHERE world_id = ?1",
            params![world_id, durable_max_seq],
        )
        .map_err(sqlite_error)?;
    } else {
        let committed_seq = as_u64(committed_seq, "committed world sequence")?;
        let durable_max_seq = as_u64(durable_max_seq, "maximum world event sequence")?;
        if committed_seq != durable_max_seq {
            return Err(invalid_data(format!(
                "canonical world cursor {committed_seq} does not match durable event suffix {durable_max_seq}"
            )));
        }
    }
    Ok(())
}

pub(super) fn ensure_canonical_store_identity(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    proposed_store_id: &str,
    created_at_ms: u64,
) -> io::Result<String> {
    validate_storage_label(proposed_store_id, "canonical store id")?;
    let mut conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    tx.execute(
        "INSERT OR IGNORE INTO canonical_store_identity
            (world_id, world_epoch, store_id, created_at_ms)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            world_id,
            as_i64(world_epoch)?,
            proposed_store_id,
            as_i64(created_at_ms)?
        ],
    )
    .map_err(sqlite_error)?;
    let store_id = canonical_store_identity_in_connection(&tx, world_id, world_epoch)?;
    tx.commit().map_err(sqlite_error)?;
    Ok(store_id)
}

fn canonical_store_identity_in_connection(
    conn: &Connection,
    world_id: &str,
    world_epoch: u64,
) -> io::Result<String> {
    let stored = conn
        .query_row(
            "SELECT world_epoch, store_id
             FROM canonical_store_identity
             WHERE world_id = ?1",
            params![world_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(sqlite_error)?
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "canonical store identity is missing; refusing to create an isolated world fork",
            )
        })?;
    if stored.0 != as_i64(world_epoch)? {
        return Err(invalid_data(format!(
            "canonical store epoch mismatch: storage has {}, runtime expects {world_epoch}",
            stored.0
        )));
    }
    validate_storage_label(&stored.1, "canonical store id")?;
    Ok(stored.1)
}

pub(super) fn ensure_region_authority(
    path: &Path,
    world_id: &str,
    world_epoch: u64,
    initial_region_id: &str,
    updated_at_ms: u64,
) -> io::Result<CanonicalRegionAuthority> {
    validate_storage_label(initial_region_id, "canonical region id")?;
    let mut conn = open_canonical_store(path)?;
    init_canonical_journal(&conn, world_id, world_epoch)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(sqlite_error)?;
    let durable_world_seq = current_world_seq(&tx, world_id)?;
    tx.execute(
        "INSERT OR IGNORE INTO canonical_region_authority
            (world_id, world_epoch, active_region_id, promotion_epoch,
             durable_world_seq, updated_at_ms)
         VALUES (?1, ?2, ?3, 1, ?4, ?5)",
        params![
            world_id,
            as_i64(world_epoch)?,
            initial_region_id,
            as_i64(durable_world_seq)?,
            as_i64(updated_at_ms)?
        ],
    )
    .map_err(sqlite_error)?;
    let authority = current_region_authority_in_connection(&tx, world_id, world_epoch)?;
    tx.commit().map_err(sqlite_error)?;
    Ok(authority)
}

fn current_region_authority_in_connection(
    conn: &Connection,
    world_id: &str,
    world_epoch: u64,
) -> io::Result<CanonicalRegionAuthority> {
    let row = conn
        .query_row(
            "SELECT world_epoch, active_region_id, promotion_epoch,
                    durable_world_seq, updated_at_ms
             FROM canonical_region_authority
             WHERE world_id = ?1",
            params![world_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(sqlite_error)?
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "canonical region authority is missing",
            )
        })?;
    if row.0 != as_i64(world_epoch)? {
        return Err(invalid_data(format!(
            "canonical region epoch mismatch: authority has {}, runtime expects {world_epoch}",
            row.0
        )));
    }
    Ok(CanonicalRegionAuthority {
        world_id: world_id.to_string(),
        world_epoch,
        active_region_id: row.1,
        promotion_epoch: as_u64(row.2, "promotion_epoch")?,
        durable_world_seq: as_u64(row.3, "durable_world_seq")?,
        updated_at_ms: as_u64(row.4, "updated_at_ms")?,
    })
}

fn validate_storage_label(value: &str, field: &str) -> io::Result<()> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':' | '.'))
    {
        return Err(invalid_data(format!(
            "{field} must be 1-160 ASCII letters, numbers, '-', '_', ':' or '.'"
        )));
    }
    Ok(())
}

pub(super) fn current_world_seq(conn: &Connection, world_id: &str) -> io::Result<u64> {
    let value = conn
        .query_row(
            "SELECT committed_seq FROM canonical_world_state WHERE world_id = ?1",
            params![world_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    as_u64(value, "committed_seq")
}

/// Durable receipts back every idempotent retry, so retention must comfortably
/// exceed the window in which a client can resubmit an intent. Fourteen days is
/// far longer than any live retry and still bounds a table whose rows carry a
/// full state projection.
pub(super) const DEFAULT_COMMAND_RECEIPT_RETENTION_DAYS: u64 = 14;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct CommandReceiptRetention {
    pub(super) days: Option<u64>,
}

impl CommandReceiptRetention {}

impl Default for CommandReceiptRetention {
    fn default() -> Self {
        Self {
            days: Some(DEFAULT_COMMAND_RECEIPT_RETENTION_DAYS),
        }
    }
}

fn ensure_column(conn: &Connection, table: &str, column: &str, alter_sql: &str) -> io::Result<()> {
    let pragma = format!("PRAGMA table_info({table})");
    let mut stmt = conn.prepare(&pragma).map_err(sqlite_error)?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sqlite_error)?;
    for row in rows {
        if row.map_err(sqlite_error)? == column {
            return Ok(());
        }
    }
    conn.execute(alter_sql, []).map_err(sqlite_error)?;
    Ok(())
}

pub(super) fn open_event_store(path: &Path) -> io::Result<Connection> {
    open_canonical_store(path)
}

/// Retain an activated WAL reader for the process lifetime so closing each
/// short-lived writer does not checkpoint the whole database.
pub(super) fn open_event_store_keepalive(path: &Path) -> io::Result<Connection> {
    let connection = open_event_store(path)?;
    let _: i64 = connection
        .query_row("SELECT COUNT(*) FROM world_events", [], |row| row.get(0))
        .map_err(sqlite_error)?;
    Ok(connection)
}

/// Opens a store that is about to be given its schema, choosing the vacuum
/// mode before WAL is enabled.
///
/// `auto_vacuum` is recorded in the database header and SQLite silently
/// ignores a change to it once the store is in WAL mode or holds any table.
/// `open_canonical_store` enables WAL on first open, so a store initialized
/// through it could never accept the mode afterwards, and every deployment ran
/// with `auto_vacuum = none`: compaction freed pages onto the freelist and the
/// file could only ever grow. Ordering the pragma ahead of WAL on the same
/// connection that then creates the tables is what makes the header stick.
///
/// An existing store cannot be converted during ordinary initialization. That
/// needs one full `VACUUM` in a maintenance window; run the opt-in conversion
/// below with `COSYWORLD_ONE_TIME_AUTO_VACUUM=1`, and
/// `/meta.persistence.event_store_auto_vacuum` reports which stores still
/// need it.
pub(super) fn open_canonical_store_for_initialization(path: &Path) -> io::Result<Connection> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(sqlite_error)?;
    let journal_mode = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .map_err(sqlite_error)?;
    let table_count = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    if table_count == 0 && !journal_mode.eq_ignore_ascii_case("wal") {
        conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")
            .map_err(sqlite_error)?;
    }
    if !journal_mode.eq_ignore_ascii_case("wal") {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(sqlite_error)?;
    }
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(sqlite_error)?;
    Ok(conn)
}

fn open_canonical_store(path: &Path) -> io::Result<Connection> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(sqlite_error)?;
    // WAL lets readers continue beside the single writer; NORMAL avoids an
    // fsync per commit while retaining crash-safe journal recovery.
    //
    // journal_mode persists in the database. Re-applying the write-form
    // pragma on every short-lived connection asks SQLite to take the mode
    // change lock even when the store is already WAL. On the production Fly
    // volume that lock round-trip sat on every command path. Inspect first and
    // only mutate the persistent setting while initializing a non-WAL store.
    let journal_mode = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .map_err(sqlite_error)?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(sqlite_error)?;
    }
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(sqlite_error)?;
    Ok(conn)
}

/// One-time maintenance conversion of an existing store to incremental
/// `auto_vacuum`.
///
/// SQLite silently ignores an `auto_vacuum` change once a store is in WAL mode
/// or holds tables, so every pre-#877 store runs with `auto_vacuum = none`:
/// compaction frees pages onto the freelist and the file can only ever grow.
/// Setting the pragma ahead of one full `VACUUM` rewrites the file with the
/// header set (the confirmed ordering: `WAL -> CREATE TABLE -> auto_vacuum ->
/// VACUUM => 2`). The rewrite holds the write lock for its duration, so the
/// caller must invoke this at boot before serving traffic, behind the
/// `COSYWORLD_ONE_TIME_AUTO_VACUUM` operator flag. Roughly 2x the store size
/// must be free on the volume for the rewrite.
///
/// Returns whether a conversion ran. New stores already choose the mode ahead
/// of WAL, and already-converted stores report `false` without touching the
/// file.
pub(super) fn convert_existing_store_to_incremental_auto_vacuum(path: &Path) -> io::Result<bool> {
    let conn = Connection::open(path).map_err(sqlite_error)?;
    conn.busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(sqlite_error)?;
    let table_count = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(sqlite_error)?;
    if table_count == 0 {
        // A fresh store chooses its mode during schema initialization.
        return Ok(false);
    }
    let current_mode = conn
        .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, i64>(0))
        .map_err(sqlite_error)?;
    if current_mode == 2 {
        return Ok(false);
    }
    conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")
        .map_err(sqlite_error)?;
    conn.execute("VACUUM", []).map_err(sqlite_error)?;
    let converted_mode = conn
        .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, i64>(0))
        .map_err(sqlite_error)?;
    if converted_mode != 2 {
        return Err(invalid_data(format!(
            "auto_vacuum conversion did not stick; PRAGMA auto_vacuum reports {converted_mode}"
        )));
    }
    Ok(true)
}

fn as_i64(value: u64) -> io::Result<i64> {
    i64::try_from(value).map_err(|_| invalid_data(format!("value {value} exceeds SQLite INTEGER")))
}

fn as_u64(value: i64, field: &str) -> io::Result<u64> {
    u64::try_from(value).map_err(|_| invalid_data(format!("negative {field} in canonical journal")))
}

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}
