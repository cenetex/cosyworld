use axum::http::{header, HeaderMap};

use crate::AppState;

// ---------------------------------------------------------------------------
// HTTP handlers and auth (extracted from main.rs)
// ---------------------------------------------------------------------------

pub(crate) fn moderation_authorized(state: &AppState, headers: &HeaderMap) -> bool {
    moderation_authorized_token(
        state.moderation_token.as_deref().map(String::as_str),
        headers,
    )
}

pub(crate) fn moderation_authorized_token(expected: Option<&str>, headers: &HeaderMap) -> bool {
    let Some(expected) = expected else {
        return false;
    };
    let Some(value) = headers.get(header::AUTHORIZATION) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    value
        .trim()
        .strip_prefix("Bearer ")
        .is_some_and(|provided| crate::config::token_matches(provided, expected))
}
