//! Moving a seat keeps its progress and its transaction together.
use super::{
    bindings, full, full_store,
    full_world::{actor_index, World},
    now, store,
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

fn command(op: &str) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: Some("mara".into()),
        action: Value::Null,
        target: None,
        key: String::new(),
        moving: false,
        surface: "browser".to_string(),
        revealed: None,
    }
}

fn fixture() -> (std::path::PathBuf, Connection, String, String) {
    let path = std::env::temp_dir().join(format!("seat-move-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let first = "a".repeat(48);
    let second = "b".repeat(48);
    for id in [&first, &second] {
        store::create(&c, id, "owner", now()).unwrap();
    }
    full_store::seed(&c, &second, &World::create(None).unwrap(), "test", now()).unwrap();
    (path, c, first, second)
}

fn journal(c: &Connection) -> Vec<String> {
    c.prepare("SELECT command FROM card_full_log ORDER BY seq")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn a_reading_scene_keeps_the_seat_and_progress_until_the_move_can_finish() {
    for released in [false, true] {
        let (path, c, first, second) = fixture();
        let mut grown = World::create(None).unwrap();
        grown.game["actors"]["mara"]["carried"] = json!(6);
        grown.game["actors"]["mara"]["xp"] = json!(6);
        grown.game["actors"]["mara"]["level"] = json!(3);
        full_store::seed(&c, &first, &grown, "test", now()).unwrap();
        let app = crate::test_app_state(Some(path.clone()));
        full::command_as(&app, &first, "player", &command("claim"), None).unwrap();
        let a = actor_index("mara").unwrap();
        // A published scene stays at the table while its words are read.
        c.execute(
            "INSERT INTO card_full_plays(id,world,actor,user,room,command,status,created,until_at)
             VALUES('reading',?,?,'player',?,'{}','playing',?,?)",
            params![first, a, grown.room(a).unwrap(), now(), now() + 120_000],
        )
        .unwrap();
        if released {
            full::command_as(&app, &first, "player", &command("release"), None).unwrap();
        }
        let before = full_store::world(&c, &first, now()).unwrap();
        let history = journal(&c);
        let error = full::command_as(&app, &second, "player", &command("claim"), None).unwrap_err();
        assert_eq!(
            error,
            "That avatar's play is finishing. Try again in a moment."
        );
        assert_eq!(
            journal(&c),
            history,
            "the refused move rolls back every write"
        );
        assert_eq!(full_store::world(&c, &first, now()).unwrap(), before);
        assert_eq!(bindings::mine(&c, &first, "player").unwrap(), Some(a));
        assert_eq!(bindings::mine(&c, &second, "player").unwrap(), None);
        assert_eq!(store::member(&c, &second, "player").unwrap(), None);
        assert_eq!(bindings::take_progress(&c, "player", a).unwrap(), None);

        c.execute(
            "UPDATE card_full_plays SET until_at=0 WHERE id='reading'",
            [],
        )
        .unwrap();
        let moved = full::command_as(&app, &second, "player", &command("claim"), None).unwrap();
        assert_eq!(moved["world"]["actors"]["mara"]["xp"], 0);
        assert!(moved["world"]["actors"]["mara"]["level"].is_null());
        assert_eq!(bindings::mine(&c, &first, "player").unwrap(), None);
        for id in [&first, &second] {
            let saved = full_store::world(&c, id, now()).unwrap();
            c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [id])
                .unwrap();
            assert_eq!(full_store::world(&c, id, now()).unwrap(), saved);
        }
        drop(c);
        std::fs::remove_file(path).unwrap();
    }
}
