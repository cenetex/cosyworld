use super::*;
use std::path::PathBuf;

fn path() -> PathBuf {
    std::env::temp_dir().join(format!("card-table-{}.sqlite", crate::random_hex(12)))
}
fn fixture() -> (PathBuf, rusqlite::Connection, String) {
    let path = path();
    let c = store::open(&path).unwrap();
    let id = "a".repeat(48);
    store::create(&c, &id, "owner", 100_000).unwrap();
    (path, c, id)
}
// The world list marks the person's own slots and which seats are held,
// and a passkey owns at most eight worlds (#1877).
#[test]
fn the_world_list_marks_owned_slots_and_held_seats() {
    let (_path, c, id) = fixture();
    c.execute(
        "INSERT INTO card_members(world,actor,user,seen) VALUES(?,2,'friend',100000)",
        [&id],
    )
    .unwrap();
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
