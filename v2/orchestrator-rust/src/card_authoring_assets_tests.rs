use super::*;
use sha2::{Digest, Sha256};
use std::{fs, sync::Arc};
use tower::ServiceExt;

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn cookie(state: &AppState, id: &str) -> String {
    crate::open_event_store(state.event_store_path.as_deref().unwrap()).unwrap().execute(
        "INSERT INTO auth_users(id,username,display_name,status,created_at_unix,updated_at_unix)
        VALUES(?1,?1,?1,'active',0,0)", [id]).unwrap();
    state.account_auth.test_session(id)
}
async fn send(
    state: &AppState,
    cookie: &str,
    method: &str,
    sha: &str,
    body: Body,
    extra: Option<(&str, &str)>,
) -> Response {
    let request = Request::builder()
        .method(method)
        .uri(format!("/card-game/authoring/assets/{sha}"))
        .header("host", "localhost:3102")
        .header("cookie", cookie)
        .header("content-type", "application/octet-stream");
    let mut request = request.body(body).unwrap();
    if let Some((key, value)) = extra {
        request.headers_mut().insert(
            axum::http::HeaderName::from_bytes(key.as_bytes()).unwrap(),
            value.parse().unwrap(),
        );
    }
    request.extensions_mut().insert(axum::extract::ConnectInfo(
        "127.0.0.1:8845".parse::<std::net::SocketAddr>().unwrap(),
    ));
    let response = crate::routes::card_app_router(
        state.clone(),
        crate::shutdown::ShutdownSubscription::idle(),
    )
    .oneshot(request)
    .await
    .unwrap();
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert!(response
        .extensions()
        .get::<crate::routes::ExplicitResponseStatus>()
        .is_some());
    response
}
async fn status(state: &AppState, cookie: &str, method: &str, sha: &str, bytes: &[u8]) -> u16 {
    send(state, cookie, method, sha, Body::from(bytes.to_vec()), None)
        .await
        .status()
        .as_u16()
}

#[tokio::test]
async fn private_asset_http_is_owned_bounded_durable_and_retryable() {
    let _transfer = crate::card_authoring::ASSET_TEST_LOCK.lock().await;
    let root = std::env::temp_dir().join(format!("private-assets-http-{}", crate::random_hex(12)));
    fs::create_dir(&root).unwrap();
    let db = root.join("events.sqlite");
    let mut state = crate::test_app_state(crate::RuntimeWorld::empty(), Some(db.clone()));
    let generated = root.join("generated");
    fs::create_dir(&generated).unwrap();
    state.generated_asset_dir = Arc::new(generated.clone());
    let (a, b, c) = (
        cookie(&state, "a"),
        cookie(&state, "b"),
        cookie(&state, "c"),
    );
    let sha = digest(b"accepted");
    let unread = || {
        Body::from_stream(futures_util::stream::once(async {
            panic!("unauthorized request consumed its body");
            #[allow(unreachable_code)]
            Ok::<_, std::io::Error>(Bytes::new())
        }))
    };
    assert_eq!(
        send(&state, "", "PUT", &sha, unread(), None).await.status(),
        401
    );
    let cross = Some(("origin", "https://other.example"));
    assert_eq!(
        send(&state, &a, "PUT", &sha, unread(), cross)
            .await
            .status(),
        403
    );
    assert_eq!(status(&state, &a, "PUT", "bad", b"accepted").await, 400);
    assert_eq!(status(&state, &a, "PUT", &sha, b"changed").await, 400);
    let plain = Some(("content-type", "text/plain"));
    let bad_mime = send(&state, &a, "PUT", &sha, Body::empty(), plain).await;
    assert_eq!(bad_mime.status(), 415);
    for _ in 0..2 {
        assert_eq!(status(&state, &a, "PUT", &sha, b"accepted").await, 200);
    }
    for (account, expected) in [("", 401), (b.as_str(), 404)] {
        assert_eq!(status(&state, account, "GET", &sha, b"").await, expected);
    }
    let response = send(&state, &a, "GET", &sha, Body::empty(), None).await;
    for (name, value) in [
        (header::CONTENT_TYPE, "application/octet-stream"),
        (header::CONTENT_DISPOSITION, "attachment"),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
    ] {
        assert_eq!(response.headers()[name], value);
    }
    assert_eq!(
        to_bytes(response.into_body(), MAX_FILE).await.unwrap(),
        b"accepted"[..]
    );
    let head = send(&state, &a, "HEAD", &sha, Body::empty(), None).await;
    assert_eq!(head.headers()[header::CONTENT_LENGTH], "8");
    let head_bytes = to_bytes(head.into_body(), MAX_FILE).await.unwrap();
    assert!(head_bytes.is_empty());
    let empty = digest(b"");
    assert_eq!(status(&state, &a, "PUT", &empty, b"").await, 200);
    let large = vec![0; MAX_FILE];
    assert_eq!(
        status(&state, &a, "PUT", &digest(&large), &large).await,
        200
    );
    let chunks = vec![
        Ok::<_, std::io::Error>(Bytes::from(large)),
        Ok(Bytes::from_static(b"x")),
    ];
    let oversized = Body::from_stream(futures_util::stream::iter(chunks));
    assert_eq!(
        send(&state, &a, "PUT", &sha, oversized, None)
            .await
            .status(),
        413
    );
    let sql = crate::open_event_store(&db).unwrap();
    sql.execute_batch("CREATE TRIGGER fail_ready BEFORE INSERT ON authoring_assets BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
    let retry = digest(b"retry");
    assert_eq!(status(&state, &a, "PUT", &retry, b"retry").await, 503);
    assert_eq!(status(&state, &a, "GET", &retry, b"").await, 404);
    let stored = PrivateAssetStore::new(&generated, "a").unwrap();
    assert_eq!(stored.read(&retry).unwrap().unwrap(), b"retry");
    sql.execute_batch("DROP TRIGGER fail_ready;").unwrap();
    assert_eq!(status(&state, &a, "PUT", &retry, b"retry").await, 200);
    let mut reopened = crate::test_app_state(crate::RuntimeWorld::empty(), Some(db.clone()));
    reopened.generated_asset_dir = state.generated_asset_dir.clone();
    assert_eq!(status(&reopened, &a, "GET", &retry, b"").await, 200);
    sql.execute(
        "UPDATE authoring_assets SET size=1 WHERE owner='a' AND sha256=?",
        [&retry],
    )
    .unwrap();
    assert_eq!(status(&state, &a, "GET", &retry, b"").await, 503);
    assert_eq!(status(&state, &a, "PUT", &retry, b"retry").await, 200);
    assert_eq!(status(&state, &a, "GET", &retry, b"").await, 200);
    let file = generated.join(format!("authoring-private/{}/{sha}", digest(b"a")));
    fs::write(&file, b"tampered").unwrap();
    assert_eq!(status(&state, &a, "GET", &sha, b"").await, 503);
    assert_eq!(status(&state, &a, "PUT", &sha, b"accepted").await, 503);

    assert_eq!(status(&state, &b, "PUT", &empty, b"").await, 200);
    let held_a = send(&state, &a, "GET", &empty, Body::empty(), None).await;
    assert_eq!(status(&state, &a, "GET", &empty, b"").await, 429);
    let held_b = send(&state, &b, "GET", &empty, Body::empty(), None).await;
    assert_eq!(status(&state, &c, "GET", &empty, b"").await, 429);
    drop((held_a, held_b));
    assert_eq!(status(&state, &c, "GET", &empty, b"").await, 404);

    let guard =
        crate::generated_asset_budget::GeneratedAssetWriteGuard::acquire(&generated, 0).unwrap();
    let (task_state, task_cookie) = (state.clone(), a.clone());
    let disconnected = digest(b"disconnect");
    let task_sha = disconnected.clone();
    let task = tokio::spawn(async move {
        status(&task_state, &task_cookie, "PUT", &task_sha, b"disconnect").await
    });
    sql.busy_timeout(Duration::from_millis(1)).unwrap();
    let mut blocked = false;
    for _ in 0..1000 {
        if sql.execute_batch("BEGIN IMMEDIATE; ROLLBACK;").is_err() {
            blocked = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(blocked, "upload worker reached the durable file write");
    task.abort();
    let _ = task.await;
    assert_eq!(admit("a").err().unwrap().0, StatusCode::TOO_MANY_REQUESTS);
    drop(guard);
    let mut complete = false;
    for _ in 0..1000 {
        if status(&state, &a, "GET", &disconnected, b"").await == 200 {
            complete = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(
        complete,
        "disconnected upload finished and released admission"
    );
    drop((sql, reopened, state));
    fs::remove_dir_all(root).unwrap();
}
