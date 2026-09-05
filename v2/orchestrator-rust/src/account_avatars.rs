use super::*;
use axum::http::HeaderValue;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS account_avatar_links (
            world_id TEXT NOT NULL,
            world_epoch INTEGER NOT NULL,
            actor_id INTEGER NOT NULL,
            account_id TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (world_id, world_epoch, actor_id)
        );
        CREATE INDEX IF NOT EXISTS idx_account_avatar_owner
            ON account_avatar_links(world_id, world_epoch, account_id, updated_at_ms);";

#[derive(Default, Deserialize)]
pub(super) struct AccountAvatarRequest {
    actor_id: Option<u64>,
    actor_session: Option<String>,
}

pub(super) fn account_avatar_store(state: &AppState) -> io::Result<Connection> {
    let path = state
        .event_store_path
        .as_deref()
        .ok_or_else(|| io::Error::other("avatar ownership requires a durable store"))?;
    let conn = open_event_store(path)?;
    conn.execute_batch(SCHEMA).map_err(sqlite_error)?;
    Ok(conn)
}

pub(super) fn claim_account_avatar(
    conn: &Connection,
    account: &str,
    actor_id: u64,
) -> io::Result<bool> {
    conn.execute(
        "INSERT INTO account_avatar_links
            (world_id, world_epoch, actor_id, account_id, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(world_id, world_epoch, actor_id) DO UPDATE
            SET updated_at_ms = excluded.updated_at_ms
            WHERE account_avatar_links.account_id = excluded.account_id",
        params![
            official_world_id(),
            official_world_epoch() as i64,
            actor_id as i64,
            account,
            now_millis() as i64
        ],
    )
    .map(|changed| changed == 1)
    .map_err(sqlite_error)
}

pub(super) fn owned_account_avatars(conn: &Connection, account: &str) -> io::Result<Vec<u64>> {
    let mut statement = conn
        .prepare(
            "SELECT actor_id FROM account_avatar_links
         WHERE world_id = ?1 AND world_epoch = ?2 AND account_id = ?3
         ORDER BY updated_at_ms DESC, actor_id DESC",
        )
        .map_err(sqlite_error)?;
    let rows = statement
        .query_map(
            params![official_world_id(), official_world_epoch() as i64, account],
            |row| row.get::<_, u64>(0),
        )
        .map_err(sqlite_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sqlite_error)
}

fn avatar_error(status: u16, message: &str) -> Response {
    let mut response = (
        StatusCode::from_u16(status).unwrap(),
        Json(serde_json::json!({
            "ok": false, "status": status, "error": message,
        })),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

pub(super) fn wallet_avatar_is_unclaimed(state: &AppState, actor_id: u64) -> bool {
    if state.event_store_path.is_none() {
        return true;
    }
    account_avatar_store(state)
        .and_then(|conn| {
            conn.query_row(
                "SELECT NOT EXISTS(SELECT 1 FROM account_avatar_links
         WHERE world_id = ?1 AND world_epoch = ?2 AND actor_id = ?3)",
                params![
                    official_world_id(),
                    official_world_epoch() as i64,
                    actor_id as i64
                ],
                |row| row.get::<_, bool>(0),
            )
            .map_err(sqlite_error)
        })
        .unwrap_or(false)
}

pub(super) async fn create_avatar_for_account(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAvatarRequest>,
) -> Response {
    match state.account_auth.authenticated_user_id(&headers) {
        Ok(Some(account)) => {
            avatar_links::create_avatar_with_account(client_addr, state, payload, Some(account))
                .await
                .into_response()
        }
        Ok(None) => create_avatar(ConnectInfo(client_addr), State(state), Json(payload))
            .await
            .into_response(),
        Err(_) => avatar_error(503, "Account sign-in is temporarily unavailable."),
    }
}

pub(super) async fn state_for_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<StateQuery>,
) -> Json<StateResponse> {
    let actor_id = query.actor_id;
    let actor_session = query.actor_session.clone();
    let mut response = state_view(State(state.clone()), Query(query)).await;
    let Some(account) = state
        .account_auth
        .authenticated_user_id(&headers)
        .ok()
        .flatten()
    else {
        return response;
    };
    let owned = account_avatar_store(&state)
        .ok()
        .and_then(|conn| owned_account_avatars(&conn, &account).ok())
        .unwrap_or_default();
    if let Some(actor_id) = actor_id.filter(|id| owned.contains(id)) {
        let authorized = actor_session.as_deref().is_some_and(|token| {
            actor_session_active_for_actor(&state.actor_sessions, actor_id, token).is_some()
        });
        if authorized
            && !actor_is_suspended(&state, actor_id)
            && state
                .inner
                .lock()
                .await
                .avatar_rescue_creation_context(
                    actor_id,
                    avatar_rescue_account_key(&format!("account:{account}")),
                )
                .is_some()
        {
            let action = actor_presence::summon_avatar_primary_action();
            response.primary_action = action.clone();
            response.visible_primary_action = action;
        }
    }
    response
}

pub(super) async fn account_avatar(
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AccountAvatarRequest>,
) -> Response {
    if !state.allow_rate_limit(
        rate_limit_key("account-avatar-ip", client_ip_key(client_addr)),
        GENERAL_ACTION_LIMIT,
    ) {
        return avatar_error(429, "Please try again shortly.");
    }
    let account = match state.account_auth.authenticated_user_id(&headers) {
        Ok(Some(account)) => account,
        Ok(None) => return avatar_error(401, "Sign in with your passkey to recover your avatar."),
        Err(_) => return avatar_error(503, "Account sign-in is temporarily unavailable."),
    };
    let _guard = state.avatar_creation_lock.lock().await;
    let conn = match account_avatar_store(&state) {
        Ok(conn) => conn,
        Err(_) => return avatar_error(503, "Avatar ownership storage is temporarily unavailable."),
    };
    if let Some(token) = payload.actor_session.as_deref() {
        if refresh_actor_session_from_store(&state, token).is_err() {
            return avatar_error(503, "Avatar sessions are temporarily unavailable.");
        }
    }
    let runtime = state.inner.lock().await;
    if let Some(actor_id) = payload.actor_id {
        let has_session = payload.actor_session.as_deref().is_some_and(|token| {
            actor_session_active_for_actor(&state.actor_sessions, actor_id, token).is_some()
        });
        if has_session {
            if actor_is_suspended(&state, actor_id) || !runtime.client_actor_can_observe(actor_id) {
                return avatar_error(403, "This avatar is unavailable for account recovery.");
            }
            match claim_account_avatar(&conn, &account, actor_id) {
                Ok(true) => {}
                Ok(false) => return avatar_error(409, "This avatar belongs to another account."),
                Err(_) => {
                    return avatar_error(503, "Your avatar could not be saved to your account yet.")
                }
            }
        }
    }
    let owned = match owned_account_avatars(&conn, &account) {
        Ok(owned) => owned,
        Err(_) => return avatar_error(503, "Your saved avatar is temporarily unavailable."),
    };
    for original_id in owned {
        if payload
            .actor_id
            .is_some_and(|requested| requested != original_id)
        {
            continue;
        }
        if actor_is_suspended(&state, original_id) {
            return avatar_error(403, "This avatar is unavailable for account recovery.");
        }
        let actor_id =
            match super::actor_presence::avatar_session_handoff_target(&state, original_id) {
                Ok(target) => target.unwrap_or(original_id),
                Err(_) => return avatar_error(503, "Avatar recovery is temporarily unavailable."),
            };
        if actor_is_suspended(&state, actor_id) {
            return avatar_error(403, "This avatar is unavailable for account recovery.");
        }
        let Some(actor) = runtime
            .actor_by_id(actor_id)
            .filter(|actor| runtime.client_actor_can_observe(actor.id))
            .map(|actor| runtime.actor_view(actor))
        else {
            continue;
        };
        match claim_account_avatar(&conn, &account, actor_id) {
            Ok(true) => {}
            Ok(false) => return avatar_error(409, "This avatar belongs to another account."),
            Err(_) => return avatar_error(503, "Avatar recovery could not be saved yet."),
        }
        drop(runtime);
        let (token, session) = issue_actor_session(&state, actor_id);
        record_daily_visit(&state, actor_id);
        let mut response = Json(AvatarResponse {
            ok: true,
            status: CW_OK,
            actor: Some(actor),
            actor_session: Some(token),
            actor_session_expires_at_unix: Some(session.expires_at_unix),
            events: Vec::new(),
        })
        .into_response();
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        return response;
    }
    avatar_error(404, "Your account is ready for a new tale.")
}
