use rusqlite::Connection;
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

pub(super) fn open_event_store(path: &Path) -> io::Result<Connection> {
    open_canonical_store(path)
}

/// Retain an activated WAL reader for the process lifetime so closing each
/// short-lived writer does not checkpoint the whole database.
pub(super) fn open_event_store_keepalive(path: &Path) -> io::Result<Connection> {
    let connection = open_event_store(path)?;
    let _: i64 = connection
        .query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))
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

fn invalid_data(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

fn sqlite_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(error)
}
