//! The rules floor (rules 133, "we can reset"). A shared world saved under
//! rules older than `FLOOR` is retired: it is never opened or replayed, so no
//! frozen bundle runs for it. Retiring is non-destructive. It sets the same
//! `retired_at` mark a closed world has and keeps every row (journal,
//! checkpoint, plays, bindings, members). The traveler is offered a new world
//! through the usual create.
//!
//! What a traveler keeps lives outside the journal, per passkey: unlocked
//! avatars (`card_unlocks`), cosmetic upgrades (`card_avatar_upgrades`) and
//! each avatar's level and experience (`card_avatar_progress`). Retiring
//! writes the last two from the world's last checkpoint, without replay, and
//! the next claim journals them as `progress` (full.rs).
use super::{
    bindings,
    full_world::{actor_id, World},
    store::{sql_error, Result},
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

/// The oldest rules a shared world may still run on. Raise it deliberately
/// and never together with `engine::VERSION` in one change: doing both would
/// retire every live world at once.
pub(super) const FLOOR: u32 = 133;
pub(super) const CLOSED: &str = "This world has closed.";

/// Rules older than the floor. A version this server cannot read counts as old.
pub(super) fn old(version: &str) -> bool {
    version
        .strip_prefix("full-card-world/")
        .and_then(|n| n.parse::<u32>().ok())
        .is_none_or(|n| n < FLOOR)
}
// The saved world: its last checkpoint, else its seed record.
fn saved(c: &Connection, id: &str) -> Result<Option<World>> {
    let sql = "SELECT state FROM card_full_checkpoints WHERE world=?1 UNION ALL \
               SELECT json_extract(command,'$.state') FROM (SELECT command FROM card_full_log \
               WHERE world=?1 AND json_extract(command,'$.op')='seed' ORDER BY seq LIMIT 1)";
    let text: Option<String> = c
        .query_row(sql, [id], |r| r.get(0))
        .optional()
        .map_err(sql_error)?;
    Ok(text.and_then(|t| serde_json::from_str(&t).ok()))
}
/// Whether this world's saved rules are older than the floor. A world that
/// never reached the full format (the nine-room one) is older too. Only the
/// version is read: nothing is replayed.
pub(super) fn below(c: &Connection, id: &str) -> Result<bool> {
    let sql = "SELECT json_extract(state,'$.version') FROM card_full_checkpoints WHERE world=?1 \
               UNION ALL SELECT json_extract(command,'$.state.version') FROM (SELECT command \
               FROM card_full_log WHERE world=?1 AND json_extract(command,'$.op')='seed' \
               ORDER BY seq LIMIT 1)";
    let version: Option<Option<String>> = c
        .query_row(sql, [id], |r| r.get(0))
        .optional()
        .map_err(sql_error)?;
    Ok(version.flatten().is_none_or(|v| old(&v)))
}
// Keep an avatar's level and experience for its holder's next seat (the higher
// of any already waiting stays: bindings::save_progress), and its upgrades.
fn keep(c: &Connection, user: &str, a: usize, game: &Value) -> Result<()> {
    bindings::save_progress(c, user, a, &bindings::progress_of(game, actor_id(a)))?;
    bindings::record_upgrades(c, user, a, game)
}
/// Retire the world when its rules are older than the floor: keep each
/// holder's avatar progress and upgrades, then mark it. True when it did.
pub(super) fn retire(c: &Connection, id: &str, time: i64) -> Result<bool> {
    let live: Option<Option<i64>> = c
        .query_row("SELECT retired_at FROM card_tables WHERE id=?", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(sql_error)?;
    if live != Some(None) {
        return Ok(false);
    }
    let world = saved(c, id)?;
    if world.as_ref().is_some_and(|w| !old(&w.version)) {
        return Ok(false);
    }
    if let Some(world) = world {
        let mut q = c
            .prepare(
                "SELECT actor,user FROM card_bindings WHERE world=?1 \
                 UNION SELECT actor,user FROM card_members WHERE world=?1",
            )
            .map_err(sql_error)?;
        let seats = q
            .query_map([id], |r| {
                Ok((r.get::<_, usize>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(sql_error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        for (a, user) in seats.into_iter().filter(|(a, _)| *a < 8) {
            keep(c, &user, a, &world.game)?;
        }
    }
    // Unfinished plays will not run on a world nobody opens.
    c.execute(
        "UPDATE card_full_plays SET status='cancelled' WHERE world=? \
         AND status IN ('waiting','working','playing','retry')",
        [id],
    )
    .map_err(sql_error)?;
    c.execute(
        "UPDATE card_tables SET retired_at=? WHERE id=? AND retired_at IS NULL",
        params![time, id],
    )
    .map_err(sql_error)?;
    Ok(true)
}
// The passkey's worlds that are not retired yet and are older than the floor:
// the ones it owns, sits in, or is bound to.
fn stale(c: &Connection, user: &str) -> Result<Vec<String>> {
    let mut q = c
        .prepare(
            "SELECT t.id FROM card_tables t WHERE t.retired_at IS NULL AND (t.owner=?1 \
             OR EXISTS(SELECT 1 FROM card_members m WHERE m.world=t.id AND m.user=?1) \
             OR EXISTS(SELECT 1 FROM card_bindings b WHERE b.world=t.id AND b.user=?1))",
        )
        .map_err(sql_error)?;
    let ids = q
        .query_map([user], |r| r.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let mut old = vec![];
    for id in ids {
        if below(c, &id)? {
            old.push(id);
        }
    }
    Ok(old)
}
/// Whether this passkey has a world still waiting to be retired.
pub(super) fn pending(c: &Connection, user: &str) -> Result<bool> {
    Ok(!stale(c, user)?.is_empty())
}
/// Retire this passkey's old worlds. Run inside one write transaction; once
/// clean it writes nothing.
pub(super) fn sweep(c: &Connection, user: &str, time: i64) -> Result<usize> {
    let mut n = 0;
    for id in stale(c, user)? {
        n += usize::from(retire(c, &id, time)?);
    }
    Ok(n)
}
