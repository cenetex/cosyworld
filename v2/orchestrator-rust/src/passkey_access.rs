//! Members-only passkey access (`COSYWORLD_PASSKEYS=members`).
//!
//! The `.dev` test server is for existing passkey holders. In members mode it
//! refuses new sign-ups and every play, text, and shared-world request that
//! lacks a valid passkey session. The page, its static files, health,
//! metadata, sign-in, moderation (own token), and internal process calls stay
//! reachable. The default mode, `open`, changes nothing.

use std::{io, sync::Arc};

use axum::{
    extract::{Request, State},
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};

use crate::account_auth::AccountAuth;

pub(super) const PASSKEYS_ENV: &str = "COSYWORLD_PASSKEYS";
pub(super) const SIGNUPS_CLOSED: &str = "Sign-ups are closed on this test server.";
pub(super) const MEMBERS_ONLY: &str =
    "This test server is for invited players. Sign in with your passkey.";

/// Whether this process runs members-only. Unknown values stop startup so a
/// typo never opens a server that was meant to be closed.
pub(super) fn members_only_from_env() -> io::Result<bool> {
    parse_mode(std::env::var(PASSKEYS_ENV).ok().as_deref())
}

fn parse_mode(value: Option<&str>) -> io::Result<bool> {
    match value.map(str::trim).unwrap_or("") {
        "" | "open" => Ok(false),
        "members" => Ok(true),
        other => Err(io::Error::other(format!(
            "{PASSKEYS_ENV} must be \"open\" or \"members\", not {other:?}"
        ))),
    }
}

fn public_path(method: &Method, path: &str) -> bool {
    if path.starts_with("/auth/")
        || path.starts_with("/internal/")
        || path.starts_with("/health")
        || path.starts_with("/moderation")
        || method == Method::OPTIONS
    {
        return true;
    }
    if method != Method::GET && method != Method::HEAD {
        return false;
    }
    matches!(path, "/" | "/meta" | "/licenses" | "/content-packs")
        || path.starts_with("/assets/")
        || (path.starts_with("/card-game")
            && !path.starts_with("/card-game/shared/")
            && path != "/card-game/local"
            && !path.starts_with("/card-game/local/"))
}

pub(super) async fn members_only_gate(
    State(auth): State<Arc<AccountAuth>>,
    request: Request,
    next: Next,
) -> Response {
    if !auth.members_only() || public_path(request.method(), request.uri().path()) {
        return next.run(request).await;
    }
    match auth.authenticated_user_id(request.headers()) {
        Ok(Some(_)) => next.run(request).await,
        _ => (
            StatusCode::UNAUTHORIZED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(serde_json::json!({
                "ok": false,
                "error": MEMBERS_ONLY,
                "members_only": true,
            })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_defaults_open_and_rejects_typos() {
        assert!(!parse_mode(None).unwrap());
        assert!(!parse_mode(Some("open")).unwrap());
        assert!(parse_mode(Some(" members ")).unwrap());
        assert!(parse_mode(Some("closed")).is_err());
    }

    #[test]
    fn page_and_sign_in_stay_public_but_play_does_not() {
        for (method, path) in [
            (Method::GET, "/"),
            (Method::GET, "/meta"),
            (Method::GET, "/card-game/app.mjs"),
            (Method::GET, "/card-game/shared-auth.mjs"),
            (Method::GET, "/card-game/local-service.mjs"),
            (Method::GET, "/assets/packs/x/y.png"),
            (Method::GET, "/auth/account"),
            (Method::POST, "/auth/passkey/login/start"),
            (Method::POST, "/internal/canonical/commands"),
        ] {
            assert!(public_path(&method, path), "{method} {path}");
        }
        for (method, path) in [
            (Method::POST, "/card-game/text"),
            (Method::POST, "/card-game/text/prepare"),
            (Method::GET, "/card-game/shared/worlds"),
            (Method::GET, "/card-game/local"),
            (Method::POST, "/commands"),
            (Method::GET, "/state"),
            (Method::GET, "/stream"),
        ] {
            assert!(!public_path(&method, path), "{method} {path}");
        }
    }
}
