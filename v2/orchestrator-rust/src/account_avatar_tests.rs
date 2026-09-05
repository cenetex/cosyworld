use super::*;
use crate::routes::app_router;
use axum::body::{to_bytes, Body};
use tower::ServiceExt;

fn account_cookie(state: &AppState, id: &str) -> String {
    let conn = open_event_store(state.account_auth.path().unwrap()).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO auth_users
         (id, username, display_name, status, created_at_unix, updated_at_unix)
         VALUES (?1, ?1, ?1, 'active', ?2, ?2)",
        params![id, now_unix_secs() as i64],
    )
    .unwrap();
    // Use the same durable session issuer as successful passkey ceremonies.
    state
        .account_auth
        .issue_session(id)
        .unwrap()
        .1
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

async fn request_avatar(
    state: &AppState,
    cookie: Option<&str>,
    payload: serde_json::Value,
) -> (u16, serde_json::Value) {
    request_route(state, cookie, "POST", "/auth/avatar", payload).await
}

async fn request_route(
    state: &AppState,
    cookie: Option<&str>,
    method: &str,
    path: &str,
    payload: serde_json::Value,
) -> (u16, serde_json::Value) {
    let mut builder = axum::http::Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, cookie);
    }
    let mut request = builder.body(Body::from(payload.to_string())).unwrap();
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:8840".parse::<SocketAddr>().unwrap()));
    let response = app_router(state.clone()).oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    if path == "/auth/avatar" {
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
    }
    let body = serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
        .unwrap();
    (status, body)
}

fn fixture() -> (AppState, PathBuf) {
    let path =
        std::env::temp_dir().join(format!("cosyworld-account-avatar-{}.sqlite", random_hex(8)));
    let mut runtime = RuntimeWorld::seeded();
    create_test_human(
        &mut runtime,
        884_001,
        COSY_COTTAGE_LOCATION_ID,
        "Moss Lantern",
    );
    (test_app_state(runtime, Some(path.clone())), path)
}

#[tokio::test]
async fn signed_in_creation_and_rescue_use_account_ownership_through_the_router() {
    let (state, _) = fixture();
    let owner = account_cookie(&state, "owner");
    let other = account_cookie(&state, "other");
    let (_, created) = request_route(
        &state,
        Some(&owner),
        "POST",
        "/avatar",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(created["ok"], true, "{created}");
    let actor_id = created["actor"]["id"].as_u64().unwrap();
    let token = created["actor_session"].as_str().unwrap();
    let (_, again) = request_route(
        &state,
        Some(&owner),
        "POST",
        "/avatar",
        serde_json::json!({}),
    )
    .await;
    assert_eq!(again["actor"]["id"], actor_id);
    assert_eq!(again["events"], serde_json::json!([]));
    {
        let mut runtime = state.inner.lock().await;
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == actor_id)
            .unwrap()
            .status = CW_ACTOR_KNOCKED_OUT;
    }
    let path = format!("/state?actor_id={actor_id}&actor_session={token}");
    let (_, scene) = request_route(&state, Some(&owner), "GET", &path, serde_json::json!({})).await;
    assert_eq!(scene["primary_action"]["kind"], "summon_avatar");
    let (_, denied) = request_route(
        &state,
        Some(&other),
        "POST",
        "/avatar",
        serde_json::json!({
            "summon_from_actor_id":actor_id,
        }),
    )
    .await;
    assert_eq!(denied["status"], 403);
    let (_, rescuer) = request_route(
        &state,
        Some(&owner),
        "POST",
        "/avatar",
        serde_json::json!({
            "summon_from_actor_id":actor_id,
        }),
    )
    .await;
    assert_eq!(rescuer["ok"], true, "{rescuer}");
    assert_ne!(rescuer["actor"]["id"], actor_id);
    let (_, recovered) = request_avatar(&state, Some(&owner), serde_json::json!({})).await;
    assert_eq!(recovered["actor"]["id"], rescuer["actor"]["id"]);
    assert!(state.wallet_actor_links.lock().unwrap().is_empty());
}

#[tokio::test]
async fn account_recovery_follows_a_saved_handoff_and_checks_suspension() {
    let (state, _) = fixture();
    let cookie = account_cookie(&state, "player");
    let (token, _) = issue_actor_session(&state, 884_001);
    assert_eq!(
        request_avatar(
            &state,
            Some(&cookie),
            serde_json::json!({
                "actor_id":884_001,"actor_session":token,
            })
        )
        .await
        .0,
        200
    );
    create_test_human(
        &mut *state.inner.lock().await,
        884_002,
        COSY_COTTAGE_LOCATION_ID,
        "Fern Lantern",
    );
    crate::avatar_rescue::stage_avatar_session_handoff(&state, 884_001, 884_002).unwrap();
    let (status, recovered) = request_avatar(&state, Some(&cookie), serde_json::json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(recovered["actor"]["id"], 884_002);
    state.actor_suspensions.lock().unwrap().insert(
        884_002,
        ActorSuspension {
            reason: "test suspension".to_string(),
            created_at_unix: now_unix_secs(),
        },
    );
    assert_eq!(
        request_avatar(&state, Some(&cookie), serde_json::json!({}))
            .await
            .0,
        403
    );
}

#[tokio::test]
async fn passkey_account_recovers_walletless_avatar_after_restart_and_session_expiry() {
    let (state, path) = fixture();
    let first_device = account_cookie(&state, "player-one");
    let (token, _) = issue_actor_session(&state, 884_001);
    let (status, first) = request_avatar(
        &state,
        Some(&first_device),
        serde_json::json!({
            "actor_id": 884_001, "actor_session": token,
        }),
    )
    .await;
    assert_eq!(status, 200, "{first}");
    assert_eq!(first["actor"]["name"], "Moss Lantern");
    assert!(state.wallet_actor_links.lock().unwrap().is_empty());
    let restored = RuntimeSnapshot::from_runtime(&*state.inner.lock().await)
        .into_runtime()
        .unwrap();
    let restarted = test_app_state(restored, Some(path.clone()));
    // Every avatar session has expired on the server. Only a new account
    // cookie from another successful passkey sign-in remains.
    open_event_store(&path)
        .unwrap()
        .execute("DELETE FROM actor_sessions", [])
        .unwrap();
    restarted.actor_sessions.lock().unwrap().sessions.clear();
    let second_device = account_cookie(&restarted, "player-one");
    let (status, recovered) =
        request_avatar(&restarted, Some(&second_device), serde_json::json!({})).await;
    assert_eq!(status, 200, "{recovered}");
    assert_eq!(recovered["actor"]["id"], 884_001);
    assert_ne!(recovered["actor_session"], first["actor_session"]);
    assert!(restarted.wallet_actor_links.lock().unwrap().is_empty());
}

#[tokio::test]
async fn account_claim_requires_live_actor_proof_and_preserves_the_existing_owner() {
    let (state, _) = fixture();
    let owner = account_cookie(&state, "owner");
    let other = account_cookie(&state, "other");
    let (token, _) = issue_actor_session(&state, 884_001);
    let payload = serde_json::json!({"actor_id":884_001,"actor_session":token});
    assert_eq!(request_avatar(&state, None, payload.clone()).await.0, 401);
    assert_eq!(
        request_avatar(
            &state,
            Some(&other),
            serde_json::json!({"actor_id":884_001,"actor_session":"wrong"})
        )
        .await
        .0,
        404
    );
    assert_eq!(
        request_avatar(&state, Some(&owner), payload.clone())
            .await
            .0,
        200
    );
    assert_eq!(request_avatar(&state, Some(&other), payload).await.0, 409);
    assert_eq!(
        request_avatar(&state, Some(&other), serde_json::json!({}))
            .await
            .0,
        404
    );
    assert_eq!(
        request_avatar(&state, Some(&owner), serde_json::json!({}))
            .await
            .0,
        200
    );
}

#[tokio::test]
async fn expired_unclaimed_session_cannot_claim_an_avatar() {
    let (state, path) = fixture();
    let cookie = account_cookie(&state, "player");
    let (token, _) = issue_actor_session(&state, 884_001);
    open_event_store(&path)
        .unwrap()
        .execute("UPDATE actor_sessions SET expires_at_unix = 1", [])
        .unwrap();
    state.actor_sessions.lock().unwrap().sessions.clear();
    assert_eq!(
        request_avatar(
            &state,
            Some(&cookie),
            serde_json::json!({
                "actor_id":884_001,"actor_session":token,
            })
        )
        .await
        .0,
        404
    );
}

#[tokio::test]
async fn knockout_keeps_account_recovery_and_terminal_avatar_allows_a_new_tale() {
    let (state, _) = fixture();
    let cookie = account_cookie(&state, "player");
    let (token, _) = issue_actor_session(&state, 884_001);
    {
        let mut runtime = state.inner.lock().await;
        runtime
            .world
            .actors
            .iter_mut()
            .find(|actor| actor.id == 884_001)
            .unwrap()
            .status = CW_ACTOR_KNOCKED_OUT;
    }
    let (status, recovered) = request_avatar(
        &state,
        Some(&cookie),
        serde_json::json!({
            "actor_id":884_001,"actor_session":token,
        }),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(recovered["actor"]["status"], "knocked_out");
    {
        let mut runtime = state.inner.lock().await;
        runtime
            .actor_autonomy
            .entry(884_001)
            .or_default()
            .control_mode = ActorControlMode::LocalAi;
    }
    assert_eq!(
        request_avatar(&state, Some(&cookie), serde_json::json!({}))
            .await
            .0,
        404
    );
}
