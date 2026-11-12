//! The rules floor: a world on rules older than 133 retires without opening,
//! its travelers keep level, experience and upgrades, and a current world
//! still replays exactly (full_floor.rs).
use super::{
    bindings, engine, full, full_floor as floor, full_store,
    full_world::{actor_index, World},
    store,
};
use rusqlite::{params, Connection, TransactionBehavior};
use serde_json::{json, Value};

const T: i64 = 1_000_000;

fn open() -> (std::path::PathBuf, Connection) {
    let path = std::env::temp_dir().join(format!("card-floor-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    (path, c)
}
// Ann's world saved by older rules, with Vale at level 2 holding a scarf.
fn old_world(c: &Connection, id: &str, version: &str) {
    let vale = actor_index("vale").unwrap();
    let mut w = World::create(None).unwrap();
    w.version = version.into();
    w.game["actors"]["vale"]["xp"] = json!(7);
    w.game["actors"]["vale"]["level"] = json!(2);
    w.game["actors"]["vale"]["upgrades"] = json!(["scarf"]);
    w.claimed[vale] = 1;
    store::create(c, id, "ann", T).unwrap();
    full_store::seed(c, id, &w, "test-old-world", T).unwrap();
    c.execute(
        "INSERT INTO card_members(world,actor,user,seen) VALUES(?,?,?,?)",
        params![id, vale, "ann", T],
    )
    .unwrap();
    bindings::claim(c, id, "ann", vale).unwrap();
}
fn found(c: &mut Connection, user: &str) -> Result<String, String> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let id = full::found(&tx, user, actor_index("vale")?, None, T)?;
    tx.commit().unwrap();
    Ok(id)
}
fn count(c: &Connection, sql: &str, id: &str) -> i64 {
    c.query_row(sql, [id], |r| r.get(0)).unwrap()
}
fn retired(c: &Connection, id: &str) -> bool {
    c.query_row("SELECT retired_at FROM card_tables WHERE id=?", [id], |r| {
        r.get::<_, Option<i64>>(0)
    })
    .unwrap()
    .is_some()
}

#[test]
fn only_rules_before_133_are_old() {
    assert!(floor::old("full-card-world/132"));
    assert!(floor::old("full-card-world/2"));
    assert!(floor::old("something else"));
    assert!(!floor::old("full-card-world/133"));
    assert!(!floor::old("full-card-world/134"));
}

#[test]
fn an_old_world_is_refused_retired_and_keeps_its_travelers_progress() {
    let (path, mut c) = open();
    old_world(&c, "old", "full-card-world/132");
    let rows = count(
        &c,
        "SELECT count(*) FROM card_full_log WHERE world=?",
        "old",
    );
    // It is never opened, whoever asks.
    assert_eq!(full_store::world(&c, "old", T).unwrap_err(), floor::CLOSED);
    let command = full::Command {
        op: "enter".into(),
        avatar: Some("vale".into()),
        action: Value::Null,
        target: None,
        key: String::new(),
        moving: false,
        revealed: None,
    };
    assert_eq!(
        full::run(&c, "old", "ann", &command, T).unwrap_err(),
        floor::CLOSED
    );
    assert!(floor::pending(&c, "ann").unwrap());
    assert!(!floor::pending(&c, "bob").unwrap());
    assert_eq!(floor::sweep(&c, "ann", T).unwrap(), 1);
    assert!(retired(&c, "old"));
    // Non-destructive: journal, checkpoint and seat rows are all still there.
    assert_eq!(
        count(
            &c,
            "SELECT count(*) FROM card_full_log WHERE world=?",
            "old"
        ),
        rows
    );
    assert_eq!(
        count(
            &c,
            "SELECT count(*) FROM card_full_checkpoints WHERE world=?",
            "old"
        ),
        1
    );
    assert_eq!(
        count(
            &c,
            "SELECT count(*) FROM card_bindings WHERE world=?",
            "old"
        ),
        1
    );
    // The traveler keeps the avatar's level, experience and upgrade.
    let vale = actor_index("vale").unwrap();
    let kept: String = c
        .query_row(
            "SELECT progress FROM card_avatar_progress WHERE user='ann' AND actor=?",
            [vale],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&kept).unwrap(),
        json!({"xp":7,"level":2})
    );
    assert_eq!(bindings::upgrades(&c, "ann", vale).unwrap(), ["scarf"]);
    // Once clean it writes nothing, and the list no longer shows the world.
    assert!(!floor::pending(&c, "ann").unwrap());
    assert_eq!(floor::sweep(&c, "ann", T + 1).unwrap(), 0);
    assert_eq!(store::list(&c, "ann").unwrap()["worlds"], json!([]));
    // A fresh world is offered by the usual create, carrying the upgrade.
    let fresh = found(&mut c, "ann").unwrap();
    let w = full_store::world(&c, &fresh, T).unwrap();
    assert_eq!(w.version, engine::VERSION);
    let vale_state = &w.game["actors"]["vale"];
    assert_eq!(
        (vale_state["xp"].clone(), vale_state["level"].clone()),
        (json!(0), Value::Null)
    );
    assert_eq!(vale_state["upgrades"], json!(["scarf"]));
    drop(c);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn a_claim_elsewhere_retires_the_old_world_instead_of_opening_it() {
    let (path, mut c) = open();
    old_world(&c, "old", "full-card-world/131");
    let fresh = found(&mut c, "ann").unwrap();
    assert!(retired(&c, "old"));
    assert!(!retired(&c, &fresh));
    let w = full_store::world(&c, &fresh, T).unwrap();
    assert_eq!(w.game["actors"]["vale"]["xp"], json!(0));
    assert!(w.game["actors"]["vale"]["level"].is_null());
    drop(c);
    std::fs::remove_file(path).unwrap();
}

fn offers_a_level(w: &World, a: usize) -> bool {
    let view = w.project(a).unwrap();
    let mut actions = view["actions"].as_array().unwrap().iter();
    actions.any(|o| o["offer"] == "quest:level")
}

#[test]
fn a_new_world_starts_at_no_level_and_keeps_the_upgrade() {
    let (path, mut c) = open();
    let vale = actor_index("vale").unwrap();
    bindings::save_progress(&c, "ann", vale, &json!({"xp":3,"level":1})).unwrap();
    c.execute(
        "INSERT INTO card_avatar_upgrades(user,actor,upgrade) VALUES('ann',?,'scarf')",
        [vale],
    )
    .unwrap();
    let mut carried = World::create(None).unwrap();
    carried
        .apply(&json!({"op":"claim","actor":"vale","progress":{"xp":3,"level":1}}))
        .unwrap();
    assert!(offers_a_level(&carried, vale));
    let fresh = found(&mut c, "ann").unwrap();
    let w = full_store::world(&c, &fresh, T).unwrap();
    let state = &w.game["actors"]["vale"];
    assert_eq!(w.game["turn"], json!(0));
    assert_eq!(state["xp"], json!(0));
    assert!(state["level"].is_null());
    assert!(state["carried"].is_null());
    assert_eq!(state["upgrades"], json!(["scarf"]));
    assert!(!offers_a_level(&w, vale));
    assert_eq!(
        bindings::take_progress(&c, "ann", vale).unwrap(),
        Some(json!({"xp":3,"level":1}))
    );
    drop(c);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn the_higher_of_two_waiting_levels_is_kept() {
    let (path, c) = open();
    let vale = actor_index("vale").unwrap();
    bindings::save_progress(&c, "ann", vale, &json!({"xp":20,"level":4})).unwrap();
    old_world(&c, "old", "full-card-world/132");
    assert_eq!(floor::sweep(&c, "ann", T).unwrap(), 1);
    assert_eq!(
        bindings::take_progress(&c, "ann", vale).unwrap(),
        Some(json!({"xp":20,"level":4}))
    );
    drop(c);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn a_current_world_is_never_swept_and_still_replays_exactly() {
    let (path, mut c) = open();
    let id = found(&mut c, "ann").unwrap();
    let vale = actor_index("vale").unwrap();
    let mut w = full_store::world(&c, &id, T).unwrap();
    let action = w.project(vale).unwrap()["actions"][0].clone();
    full_store::commit(
        &c,
        &id,
        &mut w,
        json!({"op":"play","actor":"vale","action":action}),
        T + 1,
    )
    .unwrap();
    assert!(!floor::pending(&c, "ann").unwrap());
    assert_eq!(floor::sweep(&c, "ann", T + 2).unwrap(), 0);
    assert!(!retired(&c, &id));
    let live = full_store::world(&c, &id, T + 2).unwrap();
    assert_eq!(live, w);
    c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&id])
        .unwrap();
    assert_eq!(full_store::world(&c, &id, T + 2).unwrap(), live);
    drop(c);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn waiting_progress_is_never_lowered_by_a_later_save() {
    let (path, c) = open();
    let vale = actor_index("vale").unwrap();
    bindings::save_progress(&c, "ann", vale, &json!({"xp":20,"level":4})).unwrap();
    // A seat that empties later with less keeps the higher level waiting.
    bindings::save_progress(&c, "ann", vale, &json!({"xp":3,"level":1})).unwrap();
    bindings::save_progress(&c, "ann", vale, &json!({"xp":30})).unwrap();
    assert_eq!(
        bindings::take_progress(&c, "ann", vale).unwrap(),
        Some(json!({"xp":20,"level":4}))
    );
    // Once taken by a claim, a new save starts afresh.
    bindings::save_progress(&c, "ann", vale, &json!({"xp":1})).unwrap();
    assert_eq!(
        bindings::take_progress(&c, "ann", vale).unwrap(),
        Some(json!({"xp":1}))
    );
    drop(c);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn a_shared_world_from_a_retired_local_save_is_refused_as_a_fresh_start() {
    let (path, mut c) = open();
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let schema_7 = r#"{"schema":7,"turn":4}"#;
    let error =
        full::found(&tx, "ann", actor_index("vale").unwrap(), Some(schema_7), T).unwrap_err();
    assert!(error.contains("fresh start"), "{error}");
    // The failed founding is rolled back: no world, no row.
    drop(tx);
    assert_eq!(store::list(&c, "ann").unwrap()["worlds"], json!([]));
    drop(c);
    std::fs::remove_file(path).unwrap();
}
