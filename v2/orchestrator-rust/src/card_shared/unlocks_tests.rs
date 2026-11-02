//! One hidden avatar per world, unlocked by Talk (#1936).
use super::{
    full, full_store,
    full_world::{actor_id, actor_index},
    store, unlocks,
};
use rusqlite::{Connection, TransactionBehavior};
use serde_json::{json, Value};

fn now() -> i64 {
    1_000_000
}
fn open() -> (std::path::PathBuf, Connection) {
    unlocks::ENFORCED.with(|e| e.set(true));
    let path = std::env::temp_dir().join(format!("card-unlocks-{}.sqlite", crate::random_hex(12)));
    let c = store::open(&path).unwrap();
    full_store::schema(&c).unwrap();
    (path, c)
}
fn body(op: &str, avatar: Option<&str>) -> full::Command {
    full::Command {
        op: op.into(),
        avatar: avatar.map(str::to_string),
        action: Value::Null,
        target: None,
        key: String::new(),
        moving: false,
    }
}
fn found(c: &mut Connection, user: &str, avatar: &str) -> Result<String, String> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    unlocks::may_create(&tx, user)?;
    let id = full::found(&tx, user, actor_index(avatar)?, None, now())?;
    tx.commit().unwrap();
    Ok(id)
}
fn run(c: &mut Connection, id: &str, user: &str, b: &full::Command) -> Result<Value, String> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let result = full::run(&tx, id, user, b, now());
    if result.is_ok() {
        tx.commit().unwrap();
    }
    result
}
fn unlocked(c: &Connection, user: &str) -> Value {
    unlocks::ids(c, user).unwrap()
}
#[test]
fn a_new_passkey_has_only_vale_and_its_first_world_hides_one_of_the_others() {
    let (_path, mut c) = open();
    assert_eq!(unlocked(&c, "ann"), json!(["vale"]));
    let id = found(&mut c, "ann", "vale").unwrap();
    let w = full_store::world(&c, &id, now()).unwrap();
    let hidden = w.game["hidden"]["actor"].as_str().unwrap();
    assert_ne!(hidden, "vale");
    let absent = w.game["absent"].as_array().unwrap();
    assert_eq!(absent.len(), 6);
    assert!(!absent.iter().any(|a| a == hidden || a == "vale"));
    // The pick is per passkey: another passkey's world can hide someone else.
    let picks: std::collections::HashSet<_> = (0..12)
        .map(|n| unlocks::pick(&c, &format!("p{n}"), &id, 3).unwrap()["hidden"].clone())
        .collect();
    assert!(picks.len() > 1);
}

#[test]
fn a_locked_avatar_cannot_be_claimed_or_given_a_world() {
    let (_path, mut c) = open();
    let id = found(&mut c, "ann", "vale").unwrap();
    let refused = run(&mut c, &id, "bob", &body("claim", Some("mara"))).unwrap_err();
    assert!(refused.contains("Mara is still hidden"), "{refused}");
    assert!(found(&mut c, "bob", "mara")
        .unwrap_err()
        .contains("still hidden"));
    run(&mut c, &id, "bob", &body("claim", Some("vale"))).unwrap_err();
}

#[test]
fn existing_passkeys_keep_every_avatar_they_took() {
    let (path, c) = open();
    c.execute_batch(
        "DROP TABLE card_unlocks;
         INSERT INTO card_bindings(world,actor,user) VALUES('w',4,'ann');
         INSERT INTO card_members(world,actor,user) VALUES('x',0,'ann');
         INSERT INTO card_avatar_progress(user,actor,progress) VALUES('ann',1,'{}');",
    )
    .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    let kept = json!((0..8)
        .filter(|a| [0, 1, 4].contains(a) || actor_id(*a) == "vale")
        .map(actor_id)
        .collect::<Vec<_>>());
    assert_eq!(unlocked(&c, "ann"), kept);
    // The pass runs once: a later binding is not an unlock.
    c.execute(
        "INSERT INTO card_bindings(world,actor,user) VALUES('y',5,'ann')",
        [],
    )
    .unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(unlocked(&c, "ann"), kept);
}

#[test]
fn seek_gives_the_quest_to_talk_to_the_hidden_avatar() {
    let (_path, mut c) = open();
    let id = found(&mut c, "ann", "vale").unwrap();
    let view = run(&mut c, &id, "ann", &body("seek", None)).unwrap();
    let hidden = view["world"]["hidden"]["actor"].clone();
    assert_eq!(view["world"]["actors"]["vale"]["want"]["target"], hidden);
    assert_eq!(view["world"]["actors"]["vale"]["want"]["kind"], "person");
}

#[test]
fn once_everyone_is_found_no_new_world_opens() {
    let (_path, mut c) = open();
    found(&mut c, "ann", "vale").unwrap();
    for a in 0..8 {
        c.execute(
            "INSERT OR IGNORE INTO card_unlocks(user,actor) VALUES('ann',?)",
            [a],
        )
        .unwrap();
    }
    assert_eq!(unlocks::pick(&c, "ann", "z", 3).unwrap(), json!({}));
    assert!(found(&mut c, "ann", actor_id(0))
        .unwrap_err()
        .contains("Everyone is found"));
}
