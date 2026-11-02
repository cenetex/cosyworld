//! Credits owned by a signed-in passkey account (#1924).
//!
//! `credit_events` is append-only: a grant adds credits, a spend takes them
//! before a paid provider call, and a refund returns a spend whose call
//! failed. A balance is the sum of an account's rows. Every spend and refund
//! carries a request id, so a retried request never charges twice. A new paid
//! feature is one more `SpendKind` with its price.
// The credit-gated speech and video routes spend and refund next (#1924).
#![cfg_attr(not(test), allow(dead_code))]

use std::path::Path;

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::AppState;

/// The operator grant endpoint stays off (404) until this is set.
pub(crate) const OPERATOR_TOKEN_ENV: &str = "COSYWORLD_CREDITS_OPERATOR_TOKEN";
const MAX_GRANT: i64 = 100_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SpendKind {
    Tts,
    Video,
}

impl SpendKind {
    pub(crate) const ALL: [SpendKind; 2] = [Self::Tts, Self::Video];
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Tts => "tts",
            Self::Video => "video",
        }
    }
    /// One spoken line costs one credit; a scene video costs a speech pack.
    pub(crate) fn price(self) -> i64 {
        match self {
            Self::Tts => 1,
            Self::Video => 100,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Spend {
    Spent { balance: i64 },
    AlreadyPaid { balance: i64 },
    Insufficient { balance: i64, price: i64 },
}

fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS credit_events (
            id INTEGER PRIMARY KEY,
            user_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('grant', 'spend', 'refund')),
            spend_kind TEXT,
            delta INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at_unix INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_credit_events_request
            ON credit_events(user_id, request_id);
        CREATE TRIGGER IF NOT EXISTS credit_events_no_update BEFORE UPDATE ON credit_events
            BEGIN SELECT RAISE(ABORT, 'credit_events is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS credit_events_no_delete BEFORE DELETE ON credit_events
            BEGIN SELECT RAISE(ABORT, 'credit_events is append-only'); END;",
    )
}

fn insert(
    c: &Connection,
    user: &str,
    request_id: &str,
    kind: &str,
    spend_kind: Option<SpendKind>,
    delta: i64,
    note: &str,
) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO credit_events
         (user_id, request_id, kind, spend_kind, delta, note, created_at_unix)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            user,
            request_id,
            kind,
            spend_kind.map(SpendKind::name),
            delta,
            note,
            crate::util::now_unix_secs() as i64
        ],
    )?;
    Ok(())
}

fn sum(c: &Connection, user: &str) -> rusqlite::Result<i64> {
    c.query_row(
        "SELECT COALESCE(SUM(delta), 0) FROM credit_events WHERE user_id = ?1",
        params![user],
        |row| row.get(0),
    )
}

/// What a request still owes back: negative while its spend stands.
fn request_net(
    c: &Connection,
    user: &str,
    kind: SpendKind,
    request_id: &str,
) -> rusqlite::Result<i64> {
    c.query_row(
        "SELECT COALESCE(SUM(delta), 0) FROM credit_events
         WHERE user_id = ?1 AND request_id = ?2 AND spend_kind = ?3
           AND kind IN ('spend', 'refund')",
        params![user, request_id, kind.name()],
        |row| row.get(0),
    )
}

pub(crate) fn balance(c: &Connection, user: &str) -> rusqlite::Result<i64> {
    schema(c)?;
    sum(c, user)
}

/// Take a feature's price before its provider call. A request that already
/// paid and was not refunded is not charged again.
pub(crate) fn spend(
    c: &mut Connection,
    user: &str,
    kind: SpendKind,
    request_id: &str,
) -> rusqlite::Result<Spend> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    schema(&tx)?;
    let balance = sum(&tx, user)?;
    if request_net(&tx, user, kind, request_id)? < 0 {
        return Ok(Spend::AlreadyPaid { balance });
    }
    let price = kind.price();
    if balance < price {
        return Ok(Spend::Insufficient { balance, price });
    }
    insert(&tx, user, request_id, "spend", Some(kind), -price, "")?;
    tx.commit()?;
    Ok(Spend::Spent {
        balance: balance - price,
    })
}

/// Return a standing spend once its provider call failed. Returns whether a
/// refund row was written.
pub(crate) fn refund(
    c: &mut Connection,
    user: &str,
    kind: SpendKind,
    request_id: &str,
    reason: &str,
) -> rusqlite::Result<bool> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    schema(&tx)?;
    let net = request_net(&tx, user, kind, request_id)?;
    if net >= 0 {
        return Ok(false);
    }
    insert(&tx, user, request_id, "refund", Some(kind), -net, reason)?;
    tx.commit()?;
    Ok(true)
}

/// Add credits once per request id. Returns the balance and whether this
/// call wrote the grant.
pub(crate) fn grant(
    c: &mut Connection,
    user: &str,
    credits: i64,
    request_id: &str,
    note: &str,
) -> rusqlite::Result<(i64, bool)> {
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    schema(&tx)?;
    let seen = tx
        .query_row(
            "SELECT 1 FROM credit_events WHERE user_id = ?1 AND request_id = ?2 AND kind = 'grant'",
            params![user, request_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !seen {
        insert(&tx, user, request_id, "grant", None, credits, note)?;
    }
    let balance = sum(&tx, user)?;
    tx.commit()?;
    Ok((balance, !seen))
}

pub(crate) fn open(path: &Path) -> std::io::Result<Connection> {
    crate::canonical_journal::open_event_store(path)
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/card-game/credits", get(view))
        .route("/internal/credits/grant", post(operator_grant))
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn prices() -> Value {
    SpendKind::ALL
        .iter()
        .map(|kind| (kind.name().to_string(), json!(kind.price())))
        .collect::<serde_json::Map<_, _>>()
        .into()
}

async fn view(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = state
        .account_auth
        .authenticated_user_id(&headers)
        .ok()
        .flatten();
    let (Some(user), Some(path)) = (user, state.event_store_path.clone()) else {
        return reply(
            StatusCode::OK,
            json!({"signed_in": false, "balance": 0, "prices": prices()}),
        );
    };
    let result = tokio::task::spawn_blocking(move || -> Result<i64, String> {
        balance(&open(&path).map_err(|e| e.to_string())?, &user).map_err(|e| e.to_string())
    })
    .await;
    match result {
        Ok(Ok(balance)) => reply(
            StatusCode::OK,
            json!({"signed_in": true, "balance": balance, "prices": prices()}),
        ),
        _ => reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "Credits need another moment."}),
        ),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantRequest {
    /// An account id or username.
    user: String,
    credits: i64,
    request_id: String,
    note: String,
}

fn operator_authorized(expected: Option<&str>, headers: &HeaderMap) -> bool {
    expected
        .is_some_and(|token| crate::moderation::moderation_authorized_token(Some(token), headers))
}

async fn operator_grant(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Json<GrantRequest>,
) -> Response {
    let token = std::env::var(OPERATOR_TOKEN_ENV)
        .ok()
        .filter(|t| t.trim().len() >= 16);
    if token.is_none() {
        return reply(StatusCode::NOT_FOUND, json!({"error": "Not found."}));
    }
    if !operator_authorized(token.as_deref().map(str::trim), &headers) {
        return reply(
            StatusCode::UNAUTHORIZED,
            json!({"error": "Operator token required."}),
        );
    }
    let Json(body) = body;
    let bounded = |v: &str, n: usize| {
        !v.trim().is_empty() && v.len() <= n && !v.chars().any(char::is_control)
    };
    if !(1..=MAX_GRANT).contains(&body.credits)
        || !bounded(&body.user, 128)
        || !bounded(&body.request_id, 128)
        || !bounded(&body.note, 300)
    {
        return reply(
            StatusCode::BAD_REQUEST,
            json!({"error": "Give a user, 1-100000 credits, a request id and a note."}),
        );
    }
    let Some(path) = state.event_store_path.clone() else {
        return reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "Credits need the event store."}),
        );
    };
    let result = tokio::task::spawn_blocking(move || -> Result<Option<(String, i64, bool)>, String> {
        let mut c = open(&path).map_err(|e| e.to_string())?;
        let user: Option<String> = c
            .query_row(
                "SELECT id FROM auth_users WHERE (id = ?1 OR username = ?1) AND status = 'active'",
                params![body.user.trim()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(user) = user else { return Ok(None) };
        let (balance, fresh) =
            grant(&mut c, &user, body.credits, body.request_id.trim(), body.note.trim()).map_err(|e| e.to_string())?;
        tracing::info!(user = %user, credits = body.credits, request_id = %body.request_id.trim(),
            note = %body.note.trim(), fresh, balance, "operator granted credits");
        Ok(Some((user, balance, fresh)))
    })
    .await;
    match result {
        Ok(Ok(Some((user, balance, fresh)))) => reply(
            StatusCode::OK,
            json!({"user": user, "balance": balance, "granted": fresh}),
        ),
        Ok(Ok(None)) => reply(
            StatusCode::NOT_FOUND,
            json!({"error": "No active account by that id or username."}),
        ),
        _ => reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "Credits need another moment."}),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        schema(&c).unwrap();
        c
    }

    #[test]
    fn grants_spends_and_refunds_sum_to_the_balance() {
        let mut c = db();
        assert_eq!(
            grant(&mut c, "u1", 100, "pack-1", "speech pack").unwrap(),
            (100, true)
        );
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Tts, "line-a").unwrap(),
            Spend::Spent { balance: 99 }
        );
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Tts, "line-b").unwrap(),
            Spend::Spent { balance: 98 }
        );
        assert!(refund(&mut c, "u1", SpendKind::Tts, "line-b", "provider 503").unwrap());
        assert_eq!(balance(&c, "u1").unwrap(), 99);
        assert_eq!(balance(&c, "u2").unwrap(), 0);
    }

    #[test]
    fn repeated_requests_never_charge_or_grant_twice() {
        let mut c = db();
        grant(&mut c, "u1", 100, "pack-1", "speech pack").unwrap();
        assert_eq!(
            grant(&mut c, "u1", 100, "pack-1", "again").unwrap(),
            (100, false)
        );
        spend(&mut c, "u1", SpendKind::Tts, "line-a").unwrap();
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Tts, "line-a").unwrap(),
            Spend::AlreadyPaid { balance: 99 }
        );
        // The same id under another kind is a different request.
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Video, "line-a").unwrap(),
            Spend::Insufficient {
                balance: 99,
                price: 100
            }
        );
        assert!(refund(&mut c, "u1", SpendKind::Tts, "line-a", "failed").unwrap());
        assert!(!refund(&mut c, "u1", SpendKind::Tts, "line-a", "failed").unwrap());
        assert!(!refund(&mut c, "u1", SpendKind::Tts, "never-spent", "failed").unwrap());
        // A refunded request may pay again on retry.
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Tts, "line-a").unwrap(),
            Spend::Spent { balance: 99 }
        );
    }

    #[test]
    fn a_spend_above_the_balance_writes_nothing() {
        let mut c = db();
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Tts, "line").unwrap(),
            Spend::Insufficient {
                balance: 0,
                price: 1
            }
        );
        grant(&mut c, "u1", 99, "gift", "almost a video").unwrap();
        assert_eq!(
            spend(&mut c, "u1", SpendKind::Video, "film").unwrap(),
            Spend::Insufficient {
                balance: 99,
                price: 100
            }
        );
        assert_eq!(balance(&c, "u1").unwrap(), 99);
        let rows: i64 = c
            .query_row("SELECT COUNT(*) FROM credit_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn the_ledger_refuses_edits_and_deletes() {
        let mut c = db();
        grant(&mut c, "u1", 100, "pack", "note").unwrap();
        assert!(c
            .execute("UPDATE credit_events SET delta = 1000", [])
            .is_err());
        assert!(c.execute("DELETE FROM credit_events", []).is_err());
        assert_eq!(balance(&c, "u1").unwrap(), 100);
    }

    #[test]
    fn the_operator_endpoint_needs_its_own_token() {
        let mut headers = HeaderMap::new();
        assert!(!operator_authorized(None, &headers));
        headers.insert(
            header::AUTHORIZATION,
            "Bearer operator-secret-token".parse().unwrap(),
        );
        assert!(!operator_authorized(None, &headers));
        assert!(operator_authorized(Some("operator-secret-token"), &headers));
        assert!(!operator_authorized(Some("another-secret-token"), &headers));
    }

    #[tokio::test]
    async fn the_grant_route_is_off_until_its_token_is_set_and_grants_once() {
        use tower::ServiceExt;
        let path =
            std::env::temp_dir().join(format!("cosyworld-credits-{}.sqlite", crate::random_hex(8)));
        let state =
            crate::test_support::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
        open(&path).unwrap().execute_batch(
            "CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL, status TEXT NOT NULL, created_at_unix INTEGER NOT NULL,
                updated_at_unix INTEGER NOT NULL);
             INSERT INTO auth_users VALUES ('user-1', 'moss', 'Moss', 'active', 0, 0);",
        ).unwrap();
        let app = router().with_state(state);
        let call = |token: &str| {
            axum::http::Request::post("/internal/credits/grant")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(
                    r#"{"user":"moss","credits":100,"request_id":"pack-1","note":"speech pack"}"#,
                ))
                .unwrap()
        };
        let send = |request: axum::http::Request<axum::body::Body>| {
            let app = app.clone();
            async move {
                let response = app.oneshot(request).await.unwrap();
                let status = response.status();
                let bytes = axum::body::to_bytes(response.into_body(), 4096)
                    .await
                    .unwrap();
                (status, serde_json::from_slice::<Value>(&bytes).unwrap())
            }
        };
        std::env::remove_var(OPERATOR_TOKEN_ENV);
        assert_eq!(
            send(call("operator-secret-token")).await.0,
            StatusCode::NOT_FOUND
        );
        std::env::set_var(OPERATOR_TOKEN_ENV, "operator-secret-token");
        assert_eq!(
            send(call("wrong-secret-token!")).await.0,
            StatusCode::UNAUTHORIZED
        );
        let (status, body) = send(call("operator-secret-token")).await;
        assert_eq!(
            (status, body["balance"].clone(), body["granted"].clone()),
            (StatusCode::OK, json!(100), json!(true))
        );
        let (_, body) = send(call("operator-secret-token")).await;
        assert_eq!(
            (body["balance"].clone(), body["granted"].clone()),
            (json!(100), json!(false))
        );
        std::env::remove_var(OPERATOR_TOKEN_ENV);
        let (status, body) = send(
            axum::http::Request::get("/card-game/credits")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(
            (
                status,
                body["signed_in"].clone(),
                body["prices"]["video"].clone()
            ),
            (StatusCode::OK, json!(false), json!(100))
        );
        let _ = std::fs::remove_file(path);
    }
}
