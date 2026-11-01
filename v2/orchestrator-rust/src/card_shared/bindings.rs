//! A person's passkey binds them to the avatar they take in a shared world
//! (#1825). The binding outlives Leave and Move: they always return as that
//! avatar, and nobody else can claim it. Only the world's owner frees it, by
//! deleting the avatar, which starts it over as a fresh starter.
use super::store::{sql_error, Result};
use rusqlite::{params, Connection, OptionalExtension};

// The avatar this person is bound to in this world.
pub(super) fn mine(c: &Connection, id: &str, user: &str) -> Result<Option<usize>> {
    c.query_row(
        "SELECT actor FROM card_bindings WHERE world=? AND user=?",
        params![id, user],
        |r| r.get(0),
    )
    .optional()
    .map_err(sql_error)
}
// Which of the eight avatars someone is bound to.
pub(super) fn bound(c: &Connection, id: &str) -> Result<[i32; 8]> {
    let mut q = c
        .prepare("SELECT actor FROM card_bindings WHERE world=?")
        .map_err(sql_error)?;
    let mut seats = [0; 8];
    for a in q
        .query_map([id], |r| r.get::<_, usize>(0))
        .map_err(sql_error)?
    {
        if let Some(seat) = seats.get_mut(a.map_err(sql_error)?) {
            *seat = 1;
        }
    }
    Ok(seats)
}
// A new claim: the person's own avatar, or a free one while the world has
// room. Refused before anything is journaled.
pub(super) fn claim(c: &Connection, id: &str, user: &str, a: usize) -> Result<()> {
    if let Some(own) = mine(c, id, user)? {
        return if own == a {
            Ok(())
        } else {
            Err(format!(
                "You play {} in this world.",
                super::cast()["avatars"][own]["name"]
                    .as_str()
                    .unwrap_or("another avatar")
            ))
        };
    }
    let seats = bound(c, id)?;
    if seats.iter().all(|s| *s == 1) {
        return Err("This world is full.".into());
    }
    if seats[a] == 1 {
        return Err("That avatar belongs to someone else in this world.".into());
    }
    c.execute(
        "INSERT INTO card_bindings(world,actor,user) VALUES(?,?,?)",
        params![id, a, user],
    )
    .map_err(sql_error)?;
    Ok(())
}
pub(super) fn owner(c: &Connection, id: &str, user: &str) -> Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_tables WHERE id=? AND owner=?)",
        params![id, user],
        |r| r.get(0),
    )
    .map_err(sql_error)
}
pub(super) fn free(c: &Connection, id: &str, a: usize) -> Result<()> {
    c.execute(
        "DELETE FROM card_bindings WHERE world=? AND actor=?",
        params![id, a],
    )
    .map_err(sql_error)?;
    c.execute(
        "DELETE FROM card_members WHERE world=? AND actor=?",
        params![id, a],
    )
    .map_err(sql_error)?;
    Ok(())
}
