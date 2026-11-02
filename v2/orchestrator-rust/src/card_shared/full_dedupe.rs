//! One avatar per passkey per world, and an avatar in one world (#1846).
//! Shares before #1846 could leave a passkey holding the same avatar in
//! several worlds (avatar-menu.md). When that passkey next reads its world
//! list, the most recently used seat is kept and the others are emptied
//! exactly as a claim elsewhere empties them (`leave_elsewhere`): ordinary
//! reset or release commands, appended. No world or journal row is deleted.
//! Once clean, the check is one small read and writes nothing.
use super::{
    super::store::{sql_error, Result},
    bindings, leave_elsewhere,
};
use rusqlite::{params, Connection};

// The avatars this passkey holds in more than one world.
fn duplicated(c: &Connection, user: &str) -> Result<Vec<usize>> {
    let mut q = c
        .prepare(
            "WITH seats(world,actor) AS (
               SELECT world,actor FROM card_bindings WHERE user=?1
               UNION SELECT world,actor FROM card_members WHERE user=?1)
             SELECT actor FROM seats GROUP BY actor HAVING count(*)>1",
        )
        .map_err(sql_error)?;
    let actors = q
        .query_map([user], |r| r.get::<_, usize>(0))
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(actors)
}
pub(super) fn pending(c: &Connection, user: &str) -> Result<bool> {
    Ok(!duplicated(c, user)?.is_empty())
}
// Each duplicated avatar with the world whose seat it keeps.
fn duplicates(c: &Connection, user: &str) -> Result<Vec<(usize, String)>> {
    let actors = duplicated(c, user)?;
    let mut keep = Vec::new();
    for a in actors.into_iter().filter(|a| *a < 8) {
        // Most recently used: the latest heartbeat, or else the latest
        // journal command by this avatar there.
        let world: String = c
            .query_row(
                "WITH seats(world) AS (
                   SELECT world FROM card_bindings WHERE user=?1 AND actor=?2
                   UNION SELECT world FROM card_members WHERE user=?1 AND actor=?2)
                 SELECT world FROM seats s ORDER BY max(
                   coalesce((SELECT seen FROM card_members m
                     WHERE m.world=s.world AND m.user=?1 AND m.actor=?2),0),
                   coalesce((SELECT max(at) FROM card_full_log l
                     WHERE l.world=s.world AND json_extract(l.command,'$.actor')=?3),0)
                 ) DESC, world LIMIT 1",
                params![user, a, super::actor_id(a)],
                |r| r.get(0),
            )
            .map_err(sql_error)?;
        keep.push((a, world));
    }
    Ok(keep)
}
// Empties every seat but the kept one. Run inside one write transaction.
pub(super) fn run(c: &Connection, user: &str, time: i64) -> Result<usize> {
    let groups = duplicates(c, user)?;
    for (a, world) in &groups {
        // A stale seat's level must not reach the kept one on its next
        // claim, so the level kept between seats stays as it was.
        let kept = bindings::take_progress(c, user, *a)?;
        leave_elsewhere(c, world, user, *a, time)?;
        bindings::take_progress(c, user, *a)?;
        if let Some(progress) = kept {
            bindings::save_progress(c, user, *a, &progress)?;
        }
    }
    Ok(groups.len())
}

#[cfg(test)]
mod tests {
    use super::super::{
        super::store, actor_index, run as play, store as full_store, Command, World,
    };
    use super::*;

    const T: i64 = 1_000_000;
    fn body(op: &str, avatar: Option<&str>) -> Command {
        Command {
            op: op.into(),
            avatar: avatar.map(str::to_string),
            action: serde_json::Value::Null,
            target: None,
            key: String::new(),
            moving: false,
        }
    }
    fn count(c: &Connection, sql: &str, id: &str) -> i64 {
        c.query_row(sql, [id], |r| r.get(0)).unwrap()
    }
    // A Share before #1846 left Mara in two worlds; the newer seat stays.
    #[test]
    fn a_legacy_duplicate_seat_is_emptied_once_and_the_newest_kept() {
        let path =
            std::env::temp_dir().join(format!("card-dedupe-{}.sqlite", crate::random_hex(12)));
        let mut c = store::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        let (old, new) = ("f".repeat(48), "g".repeat(48));
        for id in [&old, &new] {
            store::create(&c, id, "owner", T).unwrap();
            full_store::seed(&c, id, &World::create(None).unwrap(), "test-create", T).unwrap();
        }
        let tx = c.transaction().unwrap();
        play(&tx, &old, "ann", &body("claim", Some("mara")), T).unwrap();
        // The legacy second seat, as an older Share wrote it.
        let mara = actor_index("mara").unwrap();
        let mut w = full_store::world(&tx, &new, T).unwrap();
        full_store::commit(
            &tx,
            &new,
            &mut w,
            serde_json::json!({"op":"claim","actor":"mara"}),
            T + 5,
        )
        .unwrap();
        for (id, seen) in [(&new, T + 5), (&old, T)] {
            tx.execute(
                "INSERT OR IGNORE INTO card_bindings(world,actor,user) VALUES(?,?,'ann')",
                params![id, mara],
            )
            .unwrap();
            tx.execute(
                "UPDATE card_members SET seen=? WHERE world=? AND user='ann'",
                params![seen, id],
            )
            .unwrap();
        }
        tx.execute(
            "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,'ann',?)",
            params![new, mara, T + 5],
        )
        .unwrap();
        bindings::save_progress(&tx, "ann", mara, &serde_json::json!({"xp":2})).unwrap();
        let log = |c: &Connection, id: &str| {
            count(c, "SELECT count(*) FROM card_full_log WHERE world=?", id)
        };
        let before = log(&tx, &old);
        assert!(pending(&tx, "ann").unwrap());
        assert_eq!(run(&tx, "ann", T + 10).unwrap(), 1);
        // The newer seat stays; the older one is emptied by appended commands.
        let seats = count(
            &tx,
            "SELECT count(*) FROM card_bindings WHERE user=?",
            "ann",
        );
        assert_eq!(seats, 1);
        assert_eq!(bindings::mine(&tx, &new, "ann").unwrap(), Some(mara));
        assert_eq!(
            full_store::world(&tx, &old, T + 10).unwrap().claimed[mara],
            0
        );
        assert_eq!(
            full_store::world(&tx, &new, T + 10).unwrap().claimed[mara],
            1
        );
        assert!(log(&tx, &old) > before);
        assert_eq!(
            count(&tx, "SELECT count(*) FROM card_tables WHERE id=?", &old),
            1
        );
        // The level kept between seats is untouched.
        let progress = bindings::take_progress(&tx, "ann", mara).unwrap();
        assert_eq!(progress, Some(serde_json::json!({"xp":2})));
        // Idempotent: nothing more to do, and nothing written.
        let after = log(&tx, &old);
        assert!(!pending(&tx, "ann").unwrap());
        assert_eq!(run(&tx, "ann", T + 20).unwrap(), 0);
        assert_eq!(log(&tx, &old), after);
    }
}
