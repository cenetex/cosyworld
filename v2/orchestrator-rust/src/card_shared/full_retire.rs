//! Worlds vanish when nobody is in them (owner, 2026-11-01). A world is
//! empty when no avatar is claimed there (no member row: entered, present or
//! stepped away) and nobody but its owner is bound there. The last avatar's
//! release, reset or claim elsewhere retires it at once; the owner's next
//! world list retires any left over. Its owner's released avatar starts over
//! there with an ordinary reset that keeps its level, and the world is marked
//! `retired_at`: it leaves the list and the eight, and a link to it says it has
//! closed. Journal rows, checkpoints and plays are kept, so replay is as it was.
use super::{
    super::store::{sql_error, Result},
    bindings, store, vacate,
};
use rusqlite::{params, Connection, OptionalExtension};

const EMPTY: &str = "t.retired_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM card_members m WHERE m.world=t.id)
    AND NOT EXISTS (SELECT 1 FROM card_bindings b WHERE b.world=t.id AND b.user<>t.owner)";

// This passkey's own empty worlds.
pub(super) fn pending(c: &Connection, user: &str) -> Result<Vec<String>> {
    let mut q = c
        .prepare(&format!(
            "SELECT id FROM card_tables t WHERE t.owner=? AND {EMPTY}"
        ))
        .map_err(sql_error)?;
    let ids = q
        .query_map([user], |r| r.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(ids)
}
// Retires the world when it is `by`'s own and empty: only its owner's passkey
// retires a world. A play still finishing for the owner's avatar there leaves
// it for the next list.
pub(super) fn if_empty(c: &Connection, id: &str, by: &str, time: i64) -> Result<bool> {
    let empty = c
        .query_row(
            &format!("SELECT 1 FROM card_tables t WHERE t.id=? AND t.owner=? AND {EMPTY}"),
            params![id, by],
            |_| Ok(()),
        )
        .optional()
        .map_err(sql_error)?;
    if empty.is_none() {
        return Ok(false);
    }
    if let Some(a) = bindings::mine(c, id, by)? {
        let mut w = store::world(c, id, time)?;
        if vacate(c, id, &mut w, a, time).is_err() {
            // Rules that cannot reset a seat carry no level; free the binding.
            if bindings::carries_progress(&w.version) {
                return Ok(false);
            }
            bindings::free(c, id, a)?;
        }
    }
    c.execute(
        "UPDATE card_tables SET retired_at=? WHERE id=? AND retired_at IS NULL",
        params![time, id],
    )
    .map_err(sql_error)?;
    Ok(true)
}
// The owner's list retires its leftover empty worlds. Run inside one write
// transaction; once clean it writes nothing.
pub(super) fn sweep(c: &Connection, user: &str, time: i64) -> Result<usize> {
    let mut n = 0;
    for id in pending(c, user)? {
        n += usize::from(if_empty(c, &id, user, time)?);
    }
    Ok(n)
}
// A retired world takes no more commands or views.
pub(super) fn open(c: &Connection, id: &str) -> Result<()> {
    let retired: Option<i64> = c
        .query_row("SELECT retired_at FROM card_tables WHERE id=?", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(sql_error)?
        .flatten();
    match retired {
        Some(_) => Err("This world has closed.".into()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        super::store as tables, actor_index, run as play, store as full_store, Command, World,
    };
    use super::*;

    const T: i64 = 1_000_000;
    fn op(op: &str, avatar: Option<&str>) -> Command {
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
    fn retired(c: &Connection, id: &str) -> bool {
        open(c, id).is_err()
    }
    fn listed(c: &Connection, user: &str) -> Vec<String> {
        tables::list(c, user).unwrap()["worlds"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["id"].as_str().unwrap().to_string())
            .collect()
    }
    // Ann's worlds: Mara claimed in the first, Vale in the second.
    fn setup(ids: &[&str]) -> Connection {
        let path =
            std::env::temp_dir().join(format!("card-retire-{}.sqlite", crate::random_hex(12)));
        let c = tables::open(&path).unwrap();
        full_store::schema(&c).unwrap();
        for (id, avatar) in ids.iter().zip(["mara", "vale"]) {
            tables::create(&c, id, "ann", T).unwrap();
            full_store::seed(&c, id, &World::create(None).unwrap(), "test-create", T).unwrap();
            play(&c, id, "ann", &op("claim", Some(avatar)), T).unwrap();
        }
        c
    }
    fn log(c: &Connection, id: &str) -> i64 {
        count(c, "SELECT count(*) FROM card_full_log WHERE world=?", id)
    }

    #[test]
    fn the_last_release_retires_the_world_and_keeps_its_journal_and_level() {
        let w = "a".repeat(48);
        let c = setup(&[&w]);
        let mara = actor_index("mara").unwrap();
        let before: Vec<String> = c
            .prepare("SELECT command FROM card_full_log WHERE world=? ORDER BY seq")
            .unwrap()
            .query_map([&w], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        play(&c, &w, "ann", &op("release", None), T + 1).unwrap();
        assert!(retired(&c, &w));
        assert!(listed(&c, "ann").is_empty());
        // Mara started over there and keeps her level for her next seat.
        assert_eq!(bindings::mine(&c, &w, "ann").unwrap(), None);
        assert!(bindings::take_progress(&c, "ann", mara).unwrap().is_some());
        // Nothing was deleted: the journal only grew, and replays as it was.
        let after: Vec<String> = c
            .prepare("SELECT command FROM card_full_log WHERE world=? ORDER BY seq")
            .unwrap()
            .query_map([&w], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(after[..before.len()], before[..]);
        assert_eq!(
            count(&c, "SELECT count(*) FROM card_tables WHERE id=?", &w),
            1
        );
        let cached = full_store::world(&c, &w, T + 2).unwrap();
        c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&w])
            .unwrap();
        assert_eq!(full_store::world(&c, &w, T + 2).unwrap(), cached);
        // A link to it says it has closed.
        let closed = play(&c, &w, "bob", &op("claim", Some("ash")), T + 3).unwrap_err();
        assert_eq!(closed, "This world has closed.");
        // It no longer counts toward the eight.
        for i in 0..8 {
            tables::create(&c, &format!("{i}").repeat(48), "ann", T + 4).unwrap();
        }
        assert!(tables::create(&c, &"9".repeat(48), "ann", T + 4).is_err());
    }

    #[test]
    fn a_world_with_anyone_elses_binding_never_retires() {
        let w = "b".repeat(48);
        let c = setup(&[&w]);
        play(&c, &w, "bob", &op("claim", Some("ash")), T).unwrap();
        play(&c, &w, "ann", &op("release", None), T + 1).unwrap();
        assert!(!retired(&c, &w));
        // Bob released too, but his binding waits for his return.
        play(&c, &w, "bob", &op("release", None), T + 2).unwrap();
        assert!(!retired(&c, &w));
        assert!(pending(&c, "ann").unwrap().is_empty());
        assert_eq!(sweep(&c, "ann", T + 3).unwrap(), 0);
        assert_eq!(listed(&c, "ann"), vec![w.clone()]);
        // The owner frees Ash: now nobody is there.
        play(&c, &w, "ann", &op("reset", Some("ash")), T + 4).unwrap();
        assert!(retired(&c, &w));
    }

    #[test]
    fn a_claim_elsewhere_retires_the_world_it_leaves() {
        let (a, b) = ("c".repeat(48), "d".repeat(48));
        let c = setup(&[&a]);
        tables::create(&c, &b, "ann", T).unwrap();
        full_store::seed(&c, &b, &World::create(None).unwrap(), "test-create", T).unwrap();
        play(&c, &b, "ann", &op("claim", Some("mara")), T + 1).unwrap();
        assert!(retired(&c, &a));
        assert!(!retired(&c, &b));
        assert_eq!(listed(&c, "ann"), vec![b]);
    }

    // Only the owner's passkey retires a world: a guest who empties it by
    // claiming elsewhere leaves it for the owner's next list.
    #[test]
    fn a_guest_emptying_the_world_leaves_it_for_the_owners_list() {
        let (a, b) = ("g".repeat(48), "h".repeat(48));
        let c = setup(&[&a]);
        play(&c, &a, "bob", &op("claim", Some("ash")), T).unwrap();
        play(&c, &a, "ann", &op("release", None), T + 1).unwrap();
        tables::create(&c, &b, "bob", T).unwrap();
        full_store::seed(&c, &b, &World::create(None).unwrap(), "test-create", T).unwrap();
        play(&c, &b, "bob", &op("claim", Some("ash")), T + 2).unwrap();
        assert!(!retired(&c, &a));
        assert_eq!(pending(&c, "ann").unwrap(), vec![a.clone()]);
        assert!(pending(&c, "bob").unwrap().is_empty());
        assert_eq!(sweep(&c, "ann", T + 3).unwrap(), 1);
        assert!(retired(&c, &a));
        assert_eq!(listed(&c, "bob"), vec![b]);
    }

    // A world emptied before retirement existed goes on the owner's next
    // list, once: the second sweep finds nothing and writes nothing.
    #[test]
    fn the_list_sweep_retires_leftover_empty_worlds_once() {
        let (a, b) = ("e".repeat(48), "f".repeat(48));
        let c = setup(&[&a, &b]);
        play(&c, &a, "ann", &op("release", None), T + 1).unwrap();
        c.execute("UPDATE card_tables SET retired_at=NULL WHERE id=?", [&a])
            .unwrap();
        // Ann's other world, where she is still seated, is not empty.
        assert_eq!(pending(&c, "ann").unwrap(), vec![a.clone()]);
        assert!(pending(&c, "bob").unwrap().is_empty());
        assert_eq!(sweep(&c, "ann", T + 2).unwrap(), 1);
        let written = log(&c, &a);
        assert!(retired(&c, &a) && !retired(&c, &b));
        assert_eq!(sweep(&c, "ann", T + 3).unwrap(), 0);
        assert_eq!(log(&c, &a), written);
        assert_eq!(listed(&c, "ann"), vec![b]);
    }
}
