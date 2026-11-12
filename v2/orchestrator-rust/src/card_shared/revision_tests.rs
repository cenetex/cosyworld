use super::*;
use crate::account_revision::{Error, Revision, REVISION_HEADER, USER_HEADER};

#[test]
fn shared_command_rechecks_after_waiting_for_its_write_transaction() {
    let path =
        std::env::temp_dir().join(format!("shared-revision-{}.sqlite", crate::random_hex(12)));
    let state = crate::test_app_state(Some(path.clone()));
    let c = db(&state).unwrap();
    store::schema(&c).unwrap();
    let id = "a".repeat(48);
    super::super::store::create(&c, &id, "ann", now()).unwrap();
    store::seed(&c, &id, &World::create(None).unwrap(), "test-create", now()).unwrap();
    let admitted = Revision::capture(&c, "ann", &HeaderMap::new()).unwrap();
    c.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
        .unwrap();
    let command = Command {
        op: "claim".into(),
        avatar: Some("vale".into()),
        action: Value::Null,
        target: None,
        key: String::new(),
        moving: false,
        surface: crate::card_shared::Surface::Browser,
        revealed: None,
    };
    let count = || {
        c.query_row("SELECT count(*) FROM card_full_log", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
    };
    let before = count();
    assert_eq!(
        command_with_revision(&state, &id, &admitted, &command, None).unwrap_err(),
        Error::Changed.to_string()
    );
    assert_eq!(count(), before);
    assert_eq!(bindings::mine(&c, &id, "ann").unwrap(), None);
    let mut headers = HeaderMap::new();
    headers.insert(USER_HEADER, "ann".parse().unwrap());
    headers.insert(REVISION_HEADER, "1".parse().unwrap());
    let fresh = Revision::capture(&c, "ann", &headers).unwrap();
    assert!(command_with_revision(&state, &id, &fresh, &command, None).is_ok());
    assert!(count() > before);
    assert_eq!(bindings::mine(&c, &id, "ann").unwrap(), Some(0));
    drop(c);
    drop(state);
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn stale_shared_http_commands_keep_the_reload_code() {
    use axum::{
        body::{to_bytes, Body},
        extract::ConnectInfo,
        http::Request,
    };
    use tower::ServiceExt;
    let path = std::env::temp_dir().join(format!(
        "shared-revision-http-{}.sqlite",
        crate::random_hex(12)
    ));
    let state = crate::test_app_state(Some(path.clone()));
    let c = crate::open_event_store(&path).unwrap();
    c.execute(
        "INSERT INTO auth_users VALUES('ann','ann','Ann','active',0,0)",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
        .unwrap();
    let cookie = state.account_auth.test_session("ann");
    let router = crate::routes::card_app_router(
        state.clone(),
        crate::shutdown::ShutdownSubscription::idle(),
    );
    for route in [
        "/card-game/shared/worlds".to_string(),
        format!("/card-game/shared/worlds/{}/command", "a".repeat(48)),
        format!("/card-game/shared/worlds/{}/browser-chat", "a".repeat(48)),
    ] {
        for supplied in [false, true] {
            let mut builder = Request::builder()
                .method("POST")
                .uri(&route)
                .header("content-type", "application/json")
                .header("cookie", &cookie);
            if supplied {
                builder = builder
                    .header(USER_HEADER, "ann")
                    .header(REVISION_HEADER, "0");
            }
            let mut request = builder
                .body(Body::from(r#"{"op":"claim","key":"stale"}"#))
                .unwrap();
            // Create denies unknown fields: give each endpoint its actual body.
            if route.ends_with("worlds") {
                *request.body_mut() = Body::from("{}");
            }
            if route.ends_with("browser-chat") {
                *request.body_mut() = Body::from(r#"{"key":"stale","failure":true}"#);
            }
            request.extensions_mut().insert(ConnectInfo(
                "127.0.0.1:8841".parse::<std::net::SocketAddr>().unwrap(),
            ));
            let response = router.clone().oneshot(request).await.unwrap();
            assert_eq!(
                response.status(),
                axum::http::StatusCode::CONFLICT,
                "{route}"
            );
            let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["code"], "account_reset", "{body}");
        }
    }
    drop(c);
    drop(router);
    drop(state);
    let _ = std::fs::remove_file(path);
}

#[test]
fn late_shared_provider_result_cannot_cross_the_revision_fence() {
    let path = std::env::temp_dir().join(format!(
        "shared-worker-revision-{}.sqlite",
        crate::random_hex(12)
    ));
    let state = crate::test_app_state(Some(path.clone()));
    let c = db(&state).unwrap();
    store::schema(&c).unwrap();
    let revision = Revision::capture(&c, "ann", &HeaderMap::new()).unwrap();
    c.execute("INSERT INTO card_full_plays(id,world,actor,user,room,command,status,created) VALUES('job','world',0,'ann','room','{}','working',0)", []).unwrap();
    c.execute("INSERT INTO account_revisions VALUES('ann',1)", [])
        .unwrap();
    let work = Work {
        id: "job".into(),
        room: "room".into(),
        actor: 0,
        context: json!({}),
        attempt: 0,
        revision,
    };
    assert_eq!(
        finish_work(&state, "world", work, Err("late result".into())).unwrap_err(),
        Error::Changed.to_string()
    );
    let status: String = c
        .query_row(
            "SELECT status FROM card_full_plays WHERE id='job'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(status, "working");
    let count: i64 = c
        .query_row("SELECT count(*) FROM card_full_log", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    drop(c);
    drop(state);
    let _ = std::fs::remove_file(path);
}
