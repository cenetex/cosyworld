//! A passkey unlocks the cast one hidden avatar at a time (#1936). Each new
//! world hides one of its creator's locked avatars and leaves the others out;
//! the pick is passed on `create`, so the seeded world records it and replay
//! never reads this table. A committed Talk's `unlock` line adds the avatar
//! for the talker's passkey here and opens that avatar's own world.
use super::full_world::{actor_id, actor_index};
use super::store::{sql_error, Result};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

// The table, and once, when it is new, the grandfather pass: every avatar a
// passkey already holds, took or carried a level for counts as unlocked.
pub(super) fn schema(c: &Connection) -> rusqlite::Result<()> {
    let new = c
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_unlocks'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_none();
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS card_unlocks(user TEXT NOT NULL, actor INTEGER NOT NULL, world TEXT, seq INTEGER, PRIMARY KEY(user,actor));",
    )?;
    if new {
        c.execute(
            "INSERT OR IGNORE INTO card_unlocks(user,actor) SELECT user,actor FROM card_bindings UNION SELECT user,actor FROM card_members UNION SELECT user,actor FROM card_avatar_progress",
            [],
        )?;
    }
    Ok(())
}

// Most tests seat any avatar for any passkey; the unlock tests opt in.
#[cfg(test)]
thread_local! {
    pub(super) static ENFORCED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
fn enforced() -> bool {
    #[cfg(test)]
    return ENFORCED.with(std::cell::Cell::get);
    #[cfg(not(test))]
    true
}

// Which of the eight this passkey has unlocked. Vale always is.
pub(super) fn unlocked(c: &Connection, user: &str) -> Result<[bool; 8]> {
    if !enforced() {
        return Ok([true; 8]);
    }
    let mut out = [false; 8];
    out[actor_index("vale")?] = true;
    let mut q = c
        .prepare("SELECT actor FROM card_unlocks WHERE user=?")
        .map_err(sql_error)?;
    for a in q
        .query_map([user], |r| r.get::<_, usize>(0))
        .map_err(sql_error)?
    {
        if let Some(seen) = out.get_mut(a.map_err(sql_error)?) {
            *seen = true;
        }
    }
    Ok(out)
}
pub(super) fn ids(c: &Connection, user: &str) -> Result<Value> {
    let open = unlocked(c, user)?;
    Ok(json!((0..8)
        .filter(|a| open[*a])
        .map(actor_id)
        .collect::<Vec<_>>()))
}
// A claim or a new world needs the avatar unlocked.
pub(super) fn require(c: &Connection, user: &str, a: usize) -> Result<()> {
    if unlocked(c, user)?[a] {
        return Ok(());
    }
    let name = super::cast()["avatars"][a]["name"]
        .as_str()
        .unwrap_or("That avatar");
    Err(format!(
        "{name} is still hidden from you. Find them in one of your worlds first."
    ))
}
// Once nobody is left to find, a passkey that has a world makes no more.
pub(super) fn may_create(c: &Connection, user: &str) -> Result<()> {
    let owned: i64 = c
        .query_row(
            "SELECT count(*) FROM card_tables WHERE owner=? AND retired_at IS NULL",
            [user],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    if enforced() && owned > 0 && unlocked(c, user)?.iter().all(|a| *a) {
        return Err("Everyone is found. Send an avatar to one of your worlds.".into());
    }
    Ok(())
}
// The new world's pick from its creator's locked avatars, by a hash of the
// passkey and the world: `hidden` and the rest `absent`. Empty once all are
// unlocked. `a` is the avatar the creator takes there.
pub(super) fn pick(c: &Connection, user: &str, world: &str, a: usize) -> Result<Value> {
    let open = unlocked(c, user)?;
    let locked: Vec<usize> = (0..8).filter(|i| !open[*i] && *i != a).collect();
    if locked.is_empty() {
        return Ok(json!({}));
    }
    let d = Sha256::digest(format!("cosyworld hidden\0{user}\0{world}").as_bytes());
    let n = u32::from_be_bytes([d[0], d[1], d[2], d[3]]) as usize % locked.len();
    let absent: Vec<_> = locked
        .iter()
        .filter(|i| **i != locked[n])
        .map(|i| actor_id(*i))
        .collect();
    Ok(json!({"hidden": actor_id(locked[n]), "absent": absent}))
}
