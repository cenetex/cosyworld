use super::*;
use std::path::PathBuf;

fn path() -> PathBuf {
    std::env::temp_dir().join(format!("card-table-{}.sqlite", crate::random_hex(12)))
}
fn command_for(op: &str, avatar: i32) -> Command {
    Command {
        op: op.into(),
        avatar,
        kind: 0,
        item: -1,
        target: -1,
        key: String::new(),
    }
}
fn fixture() -> (PathBuf, rusqlite::Connection, String) {
    let path = path();
    let c = store::open(&path).unwrap();
    let id = "a".repeat(48);
    store::create(&c, &id, "owner", 100_000).unwrap();
    (path, c, id)
}
fn run(
    c: &mut rusqlite::Connection,
    id: &str,
    user: &str,
    body: &Command,
    time: i64,
) -> Result<Value> {
    let tx = c
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    let value = run_command(&tx, id, user, body, time)?;
    tx.commit().unwrap();
    Ok(value)
}
#[test]
fn eight_claims_and_one_avatar_per_account_survive_reopen() {
    let (path, mut c, id) = fixture();
    for a in 0..8 {
        run(
            &mut c,
            &id,
            &format!("user{a}"),
            &command_for("claim", a),
            100_000,
        )
        .unwrap();
    }
    assert!(run(&mut c, &id, "ninth", &command_for("claim", 0), 100_001).is_err());
    assert!(run(&mut c, &id, "user0", &command_for("claim", 1), 100_001).is_err());
    let expected = store::world(&c, &id).unwrap();
    drop(c);
    let c = store::open(&path).unwrap();
    assert_eq!(expected, store::world(&c, &id).unwrap());
    assert_eq!(store::member(&c, &id, "user7").unwrap(), Some(7));
    c.execute("DELETE FROM card_checkpoints", []).unwrap();
    assert_eq!(expected, store::world(&c, &id).unwrap());
}
// The world list marks the person's own slots and which seats are held,
// and a passkey owns at most eight worlds (#1877).
#[test]
fn the_world_list_marks_owned_slots_and_held_seats() {
    let (_path, mut c, id) = fixture();
    run(&mut c, &id, "friend", &command_for("claim", 2), 100_000).unwrap();
    let owner = store::list(&c, "owner").unwrap();
    assert_eq!(owner["worlds"][0]["owner"], true);
    assert_eq!(owner["worlds"][0]["held"], json!([0, 0, 1, 0, 0, 0, 0, 0]));
    let friend = store::list(&c, "friend").unwrap();
    assert_eq!(friend["worlds"][0]["owner"], false);
    assert_eq!(friend["worlds"][0]["actor"], 2);
    for n in 1..8 {
        store::create(&c, &format!("{n:0>48}"), "owner", 100_000).unwrap();
    }
    let ninth = store::create(&c, &"9".repeat(48), "owner", 100_000);
    assert_eq!(
        ninth.unwrap_err().to_string(),
        "You have 8 worlds. Continue one of them."
    );
}
#[test]
fn claim_race_has_one_winner() {
    let (path, c, id) = fixture();
    drop(c);
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|i| {
            let p = path.clone();
            let id = id.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let mut c = store::open(&p).unwrap();
                barrier.wait();
                run(
                    &mut c,
                    &id,
                    &format!("racer{i}"),
                    &command_for("claim", 0),
                    100_000,
                )
                .is_ok()
            })
        })
        .collect();
    assert_eq!(
        handles
            .into_iter()
            .map(|h| usize::from(h.join().unwrap()))
            .sum::<usize>(),
        1
    );
}
#[test]
fn idle_heartbeat_preserves_presence_and_disconnect_releases_only_room() {
    let (_path, mut c, id) = fixture();
    run(&mut c, &id, "u", &command_for("claim", 0), 100_000).unwrap();
    run(&mut c, &id, "u", &command_for("heartbeat", 0), 150_000).unwrap();
    let mut w = store::world(&c, &id).unwrap();
    store::expire(&c, &id, &mut w, 205_000).unwrap();
    assert_eq!(w.present[0], 1);
    store::expire(&c, &id, &mut w, 211_000).unwrap();
    assert_eq!(w.present[0], 0);
    assert_eq!(w.claimed[0], 1);
    assert_eq!(w.holders[0], 0);
    run(&mut c, &id, "u", &command_for("heartbeat", 0), 212_000).unwrap();
    assert_eq!(store::world(&c, &id).unwrap().present[0], 1);
}
#[test]
fn release_preserves_items_and_another_account_can_claim() {
    let (_path, mut c, id) = fixture();
    run(&mut c, &id, "u", &command_for("claim", 0), 100_000).unwrap();
    run(&mut c, &id, "u", &command_for("release", 0), 100_001).unwrap();
    run(&mut c, &id, "v", &command_for("claim", 0), 100_002).unwrap();
    let w = store::world(&c, &id).unwrap();
    assert_eq!(w.holders[0], 9);
    assert_eq!(w.claimed[0], 1);
}
#[tokio::test]
async fn shared_routes_require_an_account_cookie() {
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    let state = crate::test_app_state(None);
    let response = router()
        .with_state(state)
        .oneshot(
            Request::builder()
                .uri("/card-game/shared/worlds")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
#[test]
fn a_world_on_newer_rules_is_updating_not_a_conflict() {
    let updating = reply(Err(engine::UPDATING.into()));
    assert_eq!(updating.status(), StatusCode::SERVICE_UNAVAILABLE);
    let migration = reply(Err("This world's rules need a saved migration.".into()));
    assert_eq!(migration.status(), StatusCode::CONFLICT);
}
