use super::*;
use crate::routes::app_router;
use axum::body::{to_bytes, Body};
use tower::ServiceExt;

fn members_state() -> (AppState, PathBuf) {
    let path =
        std::env::temp_dir().join(format!("cosyworld-passkey-access-{}.sqlite", random_hex(8)));
    let mut state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
    state.account_auth = AccountAuth::for_test_with_access(Some(Arc::new(path.clone())), true);
    (state, path)
}

// Account ids are UUIDs.
const MEMBER: &str = "7d3f4b9e-2c1a-4e8b-9f60-1a2b3c4d5e6f";

fn member_cookie(state: &AppState) -> String {
    let conn = open_event_store(state.account_auth.path().unwrap()).unwrap();
    conn.execute(
        "INSERT INTO auth_users
         (id, username, display_name, status, created_at_unix, updated_at_unix)
         VALUES (?1, 'member', 'Member', 'active', ?2, ?2)",
        params![MEMBER, now_unix_secs() as i64],
    )
    .unwrap();
    let cookie = state.account_auth.issue_session(MEMBER).unwrap().1;
    cookie.split(';').next().unwrap().to_string()
}

async fn send(
    state: &AppState,
    method: &str,
    path: &str,
    cookie: Option<&str>,
) -> (u16, serde_json::Value) {
    let mut builder = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    let body = if method == "GET" {
        Body::empty()
    } else {
        Body::from("{}")
    };
    let mut request = builder.body(body).unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:8841".parse::<SocketAddr>().unwrap()));
    let response = app_router(state.clone()).oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
    )
}

#[tokio::test]
async fn members_mode_refuses_sign_ups_and_signed_out_play() {
    let (state, path) = members_state();

    let (status, body) = send(&state, "POST", "/auth/passkey/register/start", None).await;
    assert_eq!(status, 403);
    assert_eq!(body["error"], passkey_access::SIGNUPS_CLOSED);

    let (status, body) = send(&state, "GET", "/auth/account", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["authenticated"], false);
    assert_eq!(body["members_only"], true);

    // Existing passkeys still start sign-in, and the page stays public.
    let (status, _) = send(&state, "POST", "/auth/passkey/login/start", None).await;
    assert_eq!(status, 200);
    assert_eq!(send(&state, "GET", "/meta", None).await.0, 200);
    assert_eq!(
        send(&state, "GET", "/card-game/shared-auth.mjs", None)
            .await
            .0,
        200
    );

    for (method, route) in [
        ("POST", "/card-game/text"),
        ("GET", "/card-game/shared/worlds"),
        ("GET", "/state"),
    ] {
        let (status, body) = send(&state, method, route, None).await;
        assert_eq!(status, 401, "{method} {route}");
        assert_eq!(body["members_only"], true, "{method} {route}");
    }

    // A signed-in member passes the gate and may add a passkey.
    let cookie = member_cookie(&state);
    let (status, body) = send(&state, "GET", "/card-game/shared/worlds", Some(&cookie)).await;
    assert_eq!(status, 200, "{body}");
    let (status, body) = send(
        &state,
        "POST",
        "/auth/passkey/register/start",
        Some(&cookie),
    )
    .await;
    assert_eq!(status, 200, "{body}");

    drop(state);
    let _ = fs::remove_file(path);
}

#[tokio::test]
async fn open_mode_keeps_sign_ups_and_signed_out_reads() {
    let path =
        std::env::temp_dir().join(format!("cosyworld-passkey-open-{}.sqlite", random_hex(8)));
    let state = test_app_state(RuntimeWorld::seeded(), Some(path.clone()));
    let (status, body) = send(&state, "POST", "/auth/passkey/register/start", None).await;
    assert_eq!(status, 200, "{body}");
    let (_, body) = send(&state, "GET", "/auth/account", None).await;
    assert!(body.get("members_only").is_none());
    assert_ne!(send(&state, "GET", "/state", None).await.0, 401);
    drop(state);
    let _ = fs::remove_file(path);
}
