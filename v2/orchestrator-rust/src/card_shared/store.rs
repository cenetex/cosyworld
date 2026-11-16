use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

pub(super) type Result<T> = std::result::Result<T, String>;
pub(super) fn open(path: &Path) -> Result<Connection> {
    open_sqlite(path, busy_timeout()).map_err(err)
}
#[cfg(not(test))]
fn busy_timeout() -> Duration {
    Duration::from_secs(5)
}
#[cfg(test)]
thread_local! {
    /// A test thread can shorten the wait so any SQLite writer contention
    /// fails at once instead of hiding behind the five-second timeout.
    pub(super) static TEST_BUSY_TIMEOUT: std::cell::Cell<Duration> =
        const { std::cell::Cell::new(Duration::from_secs(5)) };
}
#[cfg(test)]
fn busy_timeout() -> Duration {
    TEST_BUSY_TIMEOUT.with(std::cell::Cell::get)
}
pub(super) fn open_sqlite(path: &Path, busy_timeout: Duration) -> rusqlite::Result<Connection> {
    let c = Connection::open(path)?;
    c.busy_timeout(busy_timeout)?;
    // Back-fill bindings only when their table is new: a write on every open
    // would contend with the world's writers.
    let new_bindings = c
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_bindings'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_none();
    c.execute_batch("
      CREATE TABLE IF NOT EXISTS card_tables(id TEXT PRIMARY KEY, owner TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS card_members(world TEXT NOT NULL, actor INTEGER NOT NULL, user TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(world,actor), UNIQUE(world,user));
      CREATE INDEX IF NOT EXISTS card_tables_owner ON card_tables(owner);
      CREATE INDEX IF NOT EXISTS card_members_user ON card_members(user);
      -- A passkey's avatar in a world (bindings.rs).
      CREATE TABLE IF NOT EXISTS card_bindings(world TEXT NOT NULL, actor INTEGER NOT NULL, user TEXT NOT NULL, PRIMARY KEY(world,actor), UNIQUE(world,user));
      -- An avatar's level between seats (bindings.rs).
      CREATE TABLE IF NOT EXISTS card_avatar_progress(user TEXT NOT NULL, actor INTEGER NOT NULL, progress TEXT NOT NULL, PRIMARY KEY(user,actor));
      -- A passkey's one-way cosmetic upgrades for an avatar (bindings.rs).
      CREATE TABLE IF NOT EXISTS card_avatar_upgrades(user TEXT NOT NULL, actor INTEGER NOT NULL, upgrade TEXT NOT NULL, PRIMARY KEY(user,actor,upgrade));
      CREATE TABLE IF NOT EXISTS card_nudges(world TEXT NOT NULL, target INTEGER NOT NULL, sender INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(world,target));
    ")?;
    // A world nobody is in retires (full_retire.rs): it leaves the list and
    // the eight, and its journal and rows stay for replay.
    let retired = c
        .prepare("SELECT 1 FROM pragma_table_info('card_tables') WHERE name='retired_at'")?
        .exists([])?;
    if !retired {
        if let Err(e) = c.execute("ALTER TABLE card_tables ADD COLUMN retired_at INTEGER", []) {
            // Another connection added it first.
            if !e.to_string().contains("duplicate column") {
                return Err(e);
            }
        }
    }
    // Current members are bound; an avatar released before bindings existed
    // was never recorded.
    if new_bindings {
        c.execute(
            "INSERT OR IGNORE INTO card_bindings(world,actor,user) SELECT world,actor,user FROM card_members",
            [],
        )?;
    }
    super::unlocks::schema(&c)?;
    Ok(c)
}
pub(super) const STORAGE_BUSY: &str = "The shared world is taking a moment. Try again.";
pub(super) const STORAGE_FAULT: &str =
    "The shared world could not be read or saved. This is a storage fault.";
fn err(e: impl std::fmt::Display) -> String {
    storage_error(&e.to_string()).into()
}
fn storage_error(text: &str) -> &'static str {
    if text.to_lowercase().contains("is locked") {
        tracing::warn!(error = text, "shared world storage busy");
        STORAGE_BUSY
    } else {
        tracing::error!(error = text, "shared world storage fault");
        STORAGE_FAULT
    }
}
pub(super) fn exists(c: &Connection, id: &str) -> Result<()> {
    if c.query_row("SELECT 1 FROM card_tables WHERE id=?", [id], |r| {
        r.get::<_, i32>(0)
    })
    .optional()
    .map_err(err)?
    .is_some()
    {
        Ok(())
    } else {
        Err("Open a shared world from its invitation.".into())
    }
}
pub(super) fn member(c: &Connection, id: &str, user: &str) -> Result<Option<i32>> {
    c.query_row(
        "SELECT actor FROM card_members WHERE world=? AND user=?",
        params![id, user],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
pub(super) fn create(c: &Connection, id: &str, user: &str, now: i64) -> Result<()> {
    let count: i64 = c
        .query_row(
            "SELECT count(*) FROM card_tables WHERE owner=? AND retired_at IS NULL",
            [user],
            |r| r.get(0),
        )
        .map_err(err)?;
    // Eight world slots per passkey (#1846).
    if count >= 8 {
        return Err("You have 8 worlds. Continue one of them.".into());
    }
    c.execute(
        "INSERT INTO card_tables(id,owner,created) VALUES(?,?,?)",
        params![id, user, now],
    )
    .map_err(err)?;
    Ok(())
}
pub(super) fn list(c: &Connection, user: &str) -> Result<Value> {
    // `bound` is the avatar this person returns as there (bindings.rs), and
    // `full` says every avatar there belongs to someone. `owner` marks the
    // person's own world slots, and `held` the seats someone holds (#1877).
    let mut q=c.prepare("SELECT t.id,m.actor,(SELECT count(*) FROM card_members c WHERE c.world=t.id),b.actor,(SELECT count(*) FROM card_bindings f WHERE f.world=t.id),t.owner=?,(SELECT group_concat(actor) FROM card_members c WHERE c.world=t.id),(SELECT group_concat(actor) FROM card_bindings f WHERE f.world=t.id) FROM card_tables t LEFT JOIN card_members m ON m.world=t.id AND m.user=? LEFT JOIN card_bindings b ON b.world=t.id AND b.user=? WHERE t.retired_at IS NULL AND (t.owner=? OR m.user=? OR b.user=?) ORDER BY t.created DESC LIMIT 64").map_err(err)?;
    let rows=q.query_map(params![user,user,user,user,user,user],|r|{
        let mut held=[0;8];
        for seats in [r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?].into_iter().flatten() {
            for a in seats.split(',').filter_map(|a| a.parse::<usize>().ok()).filter(|a| *a < 8) {
                held[a]=1;
            }
        }
        Ok(json!({"id":r.get::<_,String>(0)?,"actor":r.get::<_,Option<i32>>(1)?,"claimed":r.get::<_,i32>(2)?,"bound":r.get::<_,Option<i32>>(3)?,"full":r.get::<_,i32>(4)?>=8,"owner":r.get::<_,bool>(5)?,"held":held}))
    }).map_err(err)?.collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    Ok(json!({"worlds":rows}))
}
pub(super) fn sql_error(e: impl std::fmt::Display) -> String {
    err(e)
}
