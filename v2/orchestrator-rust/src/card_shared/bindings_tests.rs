//! Passkey bindings and the owner's delete (#1825).
use super::{
    full, full_store,
    full_world::{actor_id, actor_index, World},
    store,
};
use rusqlite::TransactionBehavior;

fn now() -> i64 {
    1_000_000
}
fn fixture() -> (std::path::PathBuf, rusqlite::Connection, String) {
    let path = std::env::temp_dir().join(format!("card-bindings-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    let id = "d".repeat(48);
    store::create(&c, &id, "owner", now()).unwrap();
    full_store::seed(&c, &id, &World::create(None).unwrap(), "test-create", now()).unwrap();
    (path, c, id)
}
fn body(op: &str, avatar: Option<&str>) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: avatar.map(str::to_string),
        action: serde_json::Value::Null,
        target: None,
        key: String::new(),
        moving: false,
    }
}
fn run(
    c: &mut rusqlite::Connection,
    id: &str,
    user: &str,
    b: &full::Command,
) -> Result<serde_json::Value, String> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let result = full::run(&tx, id, user, b, now());
    if result.is_ok() {
        tx.commit().unwrap();
    }
    result
}

#[test]
fn a_released_avatar_stays_bound_to_its_person() {
    let (_path, mut c, id) = fixture();
    run(&mut c, &id, "ann", &body("claim", Some("mara"))).unwrap();
    run(&mut c, &id, "ann", &body("release", None)).unwrap();
    let taken = run(&mut c, &id, "bob", &body("claim", Some("mara"))).unwrap_err();
    assert_eq!(taken, "That avatar belongs to someone else in this world.");
    // Ann returns as Mara, and only as Mara.
    let other = run(&mut c, &id, "ann", &body("claim", Some("ash"))).unwrap_err();
    assert_eq!(other, "You play Mara in this world.");
    run(&mut c, &id, "ann", &body("claim", Some("mara"))).unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(w.claimed[actor_index("mara").unwrap()], 1);
}

#[test]
fn a_world_with_every_avatar_bound_is_full() {
    let (_path, mut c, id) = fixture();
    for a in 0..8 {
        run(
            &mut c,
            &id,
            &format!("p{a}"),
            &body("claim", Some(actor_id(a))),
        )
        .unwrap();
        run(&mut c, &id, &format!("p{a}"), &body("release", None)).unwrap();
    }
    let full = run(&mut c, &id, "late", &body("claim", Some("vale"))).unwrap_err();
    assert_eq!(full, "This world is full.");
    let view = full_store::snapshot(&c, &id, "late", now()).unwrap();
    assert_eq!(view["bound"], serde_json::json!([1, 1, 1, 1, 1, 1, 1, 1]));
    assert_eq!(view["mine"], serde_json::Value::Null);
    let back = full_store::snapshot(&c, &id, "p3", now()).unwrap();
    assert_eq!(back["mine"], actor_id(3));
}

#[test]
fn current_members_are_bound_when_the_table_arrives() {
    let path = std::env::temp_dir().join(format!("card-bindings-{}.sqlite", crate::random_hex(12)));
    {
        let c = store::open(&path).unwrap();
        c.execute_batch(
            "DROP TABLE card_bindings;
             INSERT INTO card_members(world,actor,user,seen) VALUES('w',2,'ann',0);",
        )
        .unwrap();
    }
    let c = store::open(&path).unwrap();
    let actor: i32 = c
        .query_row(
            "SELECT actor FROM card_bindings WHERE world='w' AND user='ann'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(actor, 2);
}

#[test]
fn only_the_owner_deletes_an_avatar() {
    let (_path, mut c, id) = fixture();
    run(&mut c, &id, "ann", &body("claim", Some("mara"))).unwrap();
    let refused = run(&mut c, &id, "ann", &body("reset", Some("mara"))).unwrap_err();
    assert_eq!(refused, "Only this world's owner can delete an avatar.");
}

// The reset op needs the batch's new rules bundle; released rules refuse it.
#[test]
#[ignore = "needs the batch rules mint that adds the reset op"]
fn the_owner_deletes_an_avatar_and_frees_its_place() {
    let (_path, mut c, id) = fixture();
    run(&mut c, &id, "ann", &body("claim", Some("mara"))).unwrap();
    run(&mut c, &id, "owner", &body("reset", Some("mara"))).unwrap();
    let mara = actor_index("mara").unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    assert_eq!((w.claimed[mara], w.present[mara]), (0, 0));
    assert_eq!(w.game["actors"]["mara"]["xp"], 0);
    // Anyone may now take the fresh Mara, Ann included.
    run(&mut c, &id, "bob", &body("claim", Some("mara"))).unwrap();
    // The journal replays to the same world.
    let replayed = full_store::world(&c, &id, now()).unwrap();
    assert_eq!(replayed.claimed[mara], 1);
}
