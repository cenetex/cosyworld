//! Speech packs bought through Stripe Checkout (#1924). A signed-in passkey
//! starts a Checkout session for one pack; Stripe's signed
//! `checkout.session.completed` webhook grants its credits once, keyed by
//! the session id. Everything stays off until all three settings are set.
use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::Response,
    routing::post,
    Router,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{grant, open, reply};
use crate::AppState;

pub(crate) const SECRET_KEY_ENV: &str = "COSYWORLD_STRIPE_SECRET_KEY";
pub(crate) const PRICE_ENV: &str = "COSYWORLD_STRIPE_PRICE_SPEECH_PACK";
pub(crate) const WEBHOOK_SECRET_ENV: &str = "COSYWORLD_STRIPE_WEBHOOK_SECRET";
pub(crate) const WEBHOOK_PATH: &str = "/internal/credits/stripe-webhook";
const PACK: i64 = 100;
const TOLERANCE_SECS: i64 = 300;

struct Settings {
    secret_key: String,
    price: String,
    webhook_secret: String,
}

fn settings() -> Option<Settings> {
    let var = |name| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
    Some(Settings {
        secret_key: var(SECRET_KEY_ENV)?,
        price: var(PRICE_ENV)?,
        webhook_secret: var(WEBHOOK_SECRET_ENV)?,
    })
}

/// Whether the "Get a speech pack" button can buy one here.
pub(crate) fn enabled() -> bool {
    settings().is_some()
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/card-game/credits/checkout", post(checkout))
        .route(WEBHOOK_PATH, post(webhook))
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let pad = |byte: u8| block.iter().map(|b| b ^ byte).collect::<Vec<u8>>();
    let inner = Sha256::new()
        .chain_update(pad(0x36))
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(pad(0x5c))
        .chain_update(inner)
        .finalize()
        .into()
}

/// Stripe's `Stripe-Signature`: `t=<unix>,v1=<hex hmac of "t.body">`.
fn verified(secret: &str, signature: &str, body: &[u8], now: i64) -> bool {
    let mut t = None;
    let mut signatures = Vec::new();
    for part in signature.split(',') {
        match part.trim().split_once('=') {
            Some(("t", v)) => t = v.parse::<i64>().ok(),
            Some(("v1", v)) => signatures.push(v.to_ascii_lowercase()),
            _ => {}
        }
    }
    let Some(t) = t.filter(|t| (now - t).abs() <= TOLERANCE_SECS) else {
        return false;
    };
    let mut signed = format!("{t}.").into_bytes();
    signed.extend_from_slice(body);
    let expected: String = hmac_sha256(secret.as_bytes(), &signed)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    // Compare every byte so the time taken says nothing about the match.
    signatures.iter().any(|s| {
        s.len() == expected.len()
            && s.bytes()
                .zip(expected.bytes())
                .fold(0, |d, (a, b)| d | (a ^ b))
                == 0
    })
}

fn form(pairs: &[(&str, &str)]) -> String {
    let encode = |v: &str| -> String {
        v.bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (b as char).to_string()
                }
                _ => format!("%{b:02X}"),
            })
            .collect()
    };
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// The page's own origin, where Checkout returns the player.
fn origin(headers: &HeaderMap) -> Option<String> {
    let origin = headers.get(header::ORIGIN)?.to_str().ok()?;
    let local = origin.starts_with("http://127.0.0.1:") || origin.starts_with("http://localhost:");
    (origin.starts_with("https://") || local).then(|| origin.trim_end_matches('/').to_owned())
}

async fn checkout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(settings) = settings() else {
        return reply(StatusCode::NOT_FOUND, json!({"error": "Not found."}));
    };
    let Some(user) = state
        .account_auth
        .authenticated_user_id(&headers)
        .ok()
        .flatten()
    else {
        return reply(
            StatusCode::UNAUTHORIZED,
            json!({"error": "Sign in with your passkey to buy a speech pack.", "reason": "signed_out"}),
        );
    };
    let Some(origin) = origin(&headers) else {
        return reply(
            StatusCode::FORBIDDEN,
            json!({"error": "Open the card game on this site."}),
        );
    };
    let body = form(&[
        ("mode", "payment"),
        ("line_items[0][price]", &settings.price),
        ("line_items[0][quantity]", "1"),
        ("client_reference_id", &user),
        ("metadata[credits]", &PACK.to_string()),
        ("success_url", &format!("{origin}/?credits=bought")),
        ("cancel_url", &format!("{origin}/")),
    ]);
    let session = async {
        reqwest::Client::new()
            .post("https://api.stripe.com/v1/checkout/sessions")
            .bearer_auth(&settings.secret_key)
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await
    }
    .await;
    match session
        .ok()
        .and_then(|s| s["url"].as_str().map(str::to_owned))
    {
        Some(url) => reply(StatusCode::OK, json!({"url": url})),
        None => reply(
            StatusCode::BAD_GATEWAY,
            json!({"error": "Checkout needs another moment."}),
        ),
    }
}

/// The paying passkey and session id of a paid Checkout, if this is one.
fn paid_session(event: &Value) -> Option<(String, String)> {
    let session = &event["data"]["object"];
    (event["type"] == "checkout.session.completed" && session["payment_status"] == "paid")
        .then_some(())?;
    let id = session["id"].as_str().filter(|id| id.len() <= 255)?;
    let user = session["client_reference_id"]
        .as_str()
        .filter(|u| u.len() <= 128)?;
    Some((user.to_owned(), id.to_owned()))
}

async fn webhook(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(settings) = settings() else {
        return reply(StatusCode::NOT_FOUND, json!({"error": "Not found."}));
    };
    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let now = crate::util::now_unix_secs() as i64;
    if !verified(&settings.webhook_secret, signature, &body, now) {
        return reply(StatusCode::BAD_REQUEST, json!({"error": "Bad signature."}));
    }
    let event: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    // Other events are acknowledged so Stripe stops sending them.
    let Some((user, session)) = paid_session(&event) else {
        return reply(StatusCode::OK, json!({"received": true}));
    };
    let Some(path) = state.event_store_path.clone() else {
        return reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "No event store."}),
        );
    };
    let granted = tokio::task::spawn_blocking(move || -> Result<(i64, bool), String> {
        let mut c = open(&path).map_err(|e| e.to_string())?;
        let note = format!("stripe speech pack {session}");
        let result = grant(&mut c, &user, PACK, &session, &note).map_err(|e| e.to_string())?;
        tracing::info!(user = %user, session = %session, fresh = result.1, "stripe granted credits");
        Ok(result)
    })
    .await;
    match granted {
        Ok(Ok((balance, fresh))) => reply(
            StatusCode::OK,
            json!({"received": true, "granted": fresh, "balance": balance}),
        ),
        // A 5xx makes Stripe retry; the session id keeps the grant single.
        _ => reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "Credits need another moment."}),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 4231 test case 2.
    #[test]
    fn the_hmac_matches_its_reference() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        let hex: String = mac.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    #[test]
    fn a_stripe_signature_is_checked_with_its_timestamp() {
        let body = br#"{"type":"checkout.session.completed"}"#;
        let secret = "whsec_test_fixture";
        let mut signed = b"1700000000.".to_vec();
        signed.extend_from_slice(body);
        let v1: String = hmac_sha256(secret.as_bytes(), &signed)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let header = format!("t=1700000000,v1=deadbeef,v1={v1}");
        assert!(verified(secret, &header, body, 1_700_000_100));
        assert!(!verified(secret, &header, body, 1_700_001_000), "too old");
        assert!(!verified("whsec_other", &header, body, 1_700_000_100));
        assert!(!verified(secret, &header, b"{}", 1_700_000_100));
        assert!(!verified(secret, "v1=abc", body, 1_700_000_100));
    }

    #[test]
    fn only_a_paid_checkout_grants_and_once_per_session() {
        let event = |kind: &str, paid: &str| {
            json!({"type": kind, "data": {"object": {
                "id": "cs_test_1", "payment_status": paid, "client_reference_id": "u1"}}})
        };
        assert_eq!(
            paid_session(&event("checkout.session.completed", "paid")),
            Some(("u1".into(), "cs_test_1".into()))
        );
        assert_eq!(
            paid_session(&event("checkout.session.completed", "unpaid")),
            None
        );
        assert_eq!(paid_session(&event("charge.refunded", "paid")), None);
        let mut c = rusqlite::Connection::open_in_memory().unwrap();
        assert_eq!(
            grant(&mut c, "u1", PACK, "cs_test_1", "stripe").unwrap(),
            (100, true)
        );
        assert_eq!(
            grant(&mut c, "u1", PACK, "cs_test_1", "stripe").unwrap(),
            (100, false)
        );
    }

    #[test]
    fn checkout_returns_to_this_site_only() {
        let mut headers = HeaderMap::new();
        assert_eq!(origin(&headers), None);
        headers.insert(header::ORIGIN, "https://cosyworld.dev".parse().unwrap());
        assert_eq!(origin(&headers).as_deref(), Some("https://cosyworld.dev"));
        headers.insert(header::ORIGIN, "http://evil.example".parse().unwrap());
        assert_eq!(origin(&headers), None);
        assert_eq!(
            form(&[("line_items[0][price]", "price_1 x")]),
            "line_items%5B0%5D%5Bprice%5D=price_1%20x"
        );
    }
}
