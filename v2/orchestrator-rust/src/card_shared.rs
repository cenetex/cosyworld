#[cfg(test)]
mod ajax_tests;
mod bindings;
#[cfg(test)]
mod bindings_tests;
#[cfg(test)]
mod boardy_tests;
#[cfg(test)]
mod classic_drop_tests;
#[cfg(test)]
mod concurrency_tests;
mod content;
mod engine;
#[cfg(test)]
mod js_bridge_tests;
#[cfg(test)]
mod live_rules_tests;
#[cfg(test)]
mod move_tests;
pub(crate) fn rules_version() -> &'static str {
    engine::version()
}
pub(crate) use engine::check_rules;
mod full;
pub(crate) use full::elysium_models::{
    elysium_model, elysium_resident_at, is_legacy_elysium_introduction, resident_introduction,
    valid_elysium_name,
};
mod full_floor;
#[cfg(test)]
mod full_floor_tests;
mod full_speech;
mod full_store;
#[cfg(test)]
mod full_tests;
mod full_world;
mod guild_view;
pub(crate) use guild_view::{guild_talked, guild_view};
#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod meet_on_arrival_tests;
mod narrator;
#[cfg(test)]
pub(crate) fn narrator_context(request: &Value) -> Result<Value> {
    narrator::context(request)
}
#[cfg(test)]
mod opening_tests;
#[cfg(test)]
mod polynices_tests;
#[cfg(test)]
mod quest_core_tests;
#[cfg(test)]
mod quest_loop_tests;
#[cfg(test)]
mod rules_agree_tests;
#[cfg(test)]
mod sea_steps;
mod store;
mod sync;
#[cfg(test)]
mod tests;
mod unlocks;
#[cfg(test)]
mod unlocks_tests;
#[cfg(test)]
mod world_life_tests;
mod world_list;

use crate::AppState;
use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
#[cfg(test)]
use rusqlite::{params, TransactionBehavior};
use serde_json::{json, Value};
use std::{
    sync::{Arc, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use store::{sql_error, Result};
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
pub(super) fn cast() -> &'static Value {
    static CAST: OnceLock<Value> = OnceLock::new();
    CAST.get_or_init(|| {
        serde_json::from_str(cosyworld_orchestrator::card_assets::text(
            "card-game/shared-cast.json",
        ))
        .expect("shared cast")
    })
}
fn capacity() -> &'static Arc<tokio::sync::Semaphore> {
    static CAP: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    CAP.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
}
pub(super) fn router() -> Router<AppState> {
    full::router()
}

fn reply(r: Result<Value>) -> Response {
    if let Err(message) = &r {
        if let Some(error) = crate::account_revision::Error::from_message(message) {
            return error.response();
        }
    }
    let (status, body) = match r {
        Ok(v) => (StatusCode::OK, v),
        Err(e) if e == engine::UPDATING => (
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":e, "code":"updating"}),
        ),
        Err(e) => (
            if e == "Sign in with your passkey." {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::CONFLICT
            },
            json!({"error":e}),
        ),
    };
    (
        status,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
        .into_response()
}
pub(super) fn user(state: &AppState, h: &HeaderMap, mutation: bool) -> Result<String> {
    if mutation {
        // JSON and same-origin requests keep the account cookie out of cross-site commands.
        if h.get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v != "same-origin" && v != "none")
        {
            return Err("Open this world on its own site.".into());
        }
        if let Some(origin) = h.get("origin").and_then(|v| v.to_str().ok()) {
            let url = webauthn_rs::prelude::Url::parse(origin).map_err(sql_error)?;
            let host = h.get("host").and_then(|v| v.to_str().ok()).unwrap_or("");
            let authority = match url.port() {
                Some(p) => format!("{}:{p}", url.host_str().unwrap_or("")),
                None => url.host_str().unwrap_or("").to_string(),
            };
            if authority != host {
                return Err("Open this world on its own site.".into());
            }
        }
    }
    state
        .account_auth
        .authenticated_user_id(h)
        .map_err(sql_error)?
        .ok_or_else(|| "Sign in with your passkey.".into())
}
pub(crate) fn revision(
    state: &AppState,
    h: &HeaderMap,
    mutation: bool,
) -> Result<crate::account_revision::Revision> {
    let user = user(state, h, mutation)?;
    let c = db(state)?;
    if !mutation {
        let epoch = crate::account_revision::current(&c, &user).map_err(sql_error)?;
        return Ok(crate::account_revision::Revision { user, epoch });
    }
    crate::account_revision::Revision::capture(&c, &user, h).map_err(|error| error.to_string())
}

pub(super) fn gateway_user(state: &AppState, h: &HeaderMap, mutation: bool) -> Result<String> {
    if let Some(account) = state.account_auth.account_for_bot_request(h) {
        return Ok(account);
    }
    user(state, h, mutation)
}
fn admit(user: &str) -> Result<()> {
    use crate::rate_limit::{RateLimit, RateLimiter};
    use std::{
        sync::Mutex,
        time::{Duration, Instant},
    };
    static LIMITS: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    let mut limits = LIMITS
        .get_or_init(|| Mutex::new(RateLimiter::default()))
        .lock()
        .map_err(sql_error)?;
    if limits.allow(
        format!("shared:{user}"),
        RateLimit {
            max_hits: 120,
            window: Duration::from_secs(60),
        },
        Instant::now(),
    ) {
        Ok(())
    } else {
        Err("Give the table a moment, then try again.".into())
    }
}
fn db(state: &AppState) -> Result<rusqlite::Connection> {
    store::open(
        state
            .event_store_path
            .as_deref()
            .ok_or("Shared worlds need the saved-world service.")?,
    )
}
fn valid_id(id: &str) -> Result<()> {
    if id.len() == 48 && id.bytes().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Open the complete world invitation.".into())
    }
}
