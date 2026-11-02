//! A shared world's voiced lines (#1924). The world's pool pays for a line
//! once; its clip is kept here so every player hears the same audio free.
//! The newest clips stay; an evicted line replays on the server's key.
use rusqlite::{params, Connection, OptionalExtension};

const KEEP: i64 = 256;

fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS credit_world_clips (
            world_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            audio BLOB NOT NULL,
            created_at_unix INTEGER NOT NULL,
            PRIMARY KEY (world_id, request_id)
        );",
    )
}

/// Whether the account plays in the shared world, seated now or bound.
pub(crate) fn plays_in(c: &Connection, world: &str, user: &str) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_members WHERE world = ?1 AND user = ?2)
             OR EXISTS(SELECT 1 FROM card_bindings WHERE world = ?1 AND user = ?2)",
        params![world, user],
        |row| row.get(0),
    )
}

pub(crate) fn clip(c: &Connection, world: &str, id: &str) -> rusqlite::Result<Option<Vec<u8>>> {
    schema(c)?;
    c.query_row(
        "SELECT audio FROM credit_world_clips WHERE world_id = ?1 AND request_id = ?2",
        params![world, id],
        |row| row.get(0),
    )
    .optional()
}

pub(crate) fn keep(c: &Connection, world: &str, id: &str, audio: &[u8]) -> rusqlite::Result<()> {
    schema(c)?;
    c.execute(
        "INSERT OR IGNORE INTO credit_world_clips VALUES (?1, ?2, ?3, ?4)",
        params![world, id, audio, crate::util::now_unix_secs() as i64],
    )?;
    c.execute(
        "DELETE FROM credit_world_clips WHERE world_id = ?1 AND rowid NOT IN
            (SELECT rowid FROM credit_world_clips WHERE world_id = ?1
             ORDER BY rowid DESC LIMIT ?2)",
        params![world, KEEP],
    )?;
    Ok(())
}
