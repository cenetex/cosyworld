//! Spoken card lines on the server's OpenRouter key, paid with credits
//! (#1924). A line spends one credit before the provider call and is
//! refunded when the call fails. Its request id is the account, cast
//! revision, speaker and words, so a line already bought never costs again.

use std::{
    path::Path,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::credits::{self, Spend, SpendKind};
use crate::{ai_gateway::AiConfig, AppState};

const VOICES: &str = include_str!("../../card-game/voices.json");
const MAX_TEXT: usize = 1200;
const MAX_AUDIO: usize = 2 * 1024 * 1024;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/card-game/speech", post(speech))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    speaker: String,
    text: String,
}

#[derive(Debug, PartialEq)]
enum Failure {
    Unknown,
    Credits { balance: i64, price: i64 },
    Provider(String),
    Store(String),
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn request_id(user: &str, cast: &Value, speaker: &str, text: &str) -> String {
    let digest =
        Sha256::digest(json!([user, cast["revision"], cast["model"], speaker, text]).to_string());
    format!("tts:{}", hex(&digest))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The OpenRouter speech body for one character line, with its reference.
fn payload(cast: &Value, speaker: &str, text: &str) -> Option<Value> {
    let voice = cast["voices"].get(speaker)?;
    let (_, reference) = cosyworld_orchestrator::card_assets::get(voice["file"].as_str()?)?;
    let reference = base64::engine::general_purpose::STANDARD.encode(reference);
    Some(json!({
        "model": cast["model"],
        "input": text,
        "instructions": voice["direction"],
        "speed": voice.get("speed").cloned().unwrap_or(json!(1)),
        "response_format": "mp3",
        "input_references": [
            {"type": "input_audio", "input_audio": {"data": format!("data:audio/mpeg;base64,{reference}")}},
            {"type": "text", "text": voice["transcript"]},
        ],
    }))
}

async fn synthesize(config: &AiConfig, body: &Value) -> Result<Vec<u8>, String> {
    let _budget = crate::ai_gateway::enforce_server_paid_daily_limit(config, "card_voice")
        .await
        .map_err(|_| "The server voice budget is spent for today.".to_string())?;
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!("{}/audio/speech", config.base_url))
        .bearer_auth(&config.api_key)
        .header("HTTP-Referer", crate::ai_gateway::OPENROUTER_APP_REFERER)
        .header(
            "X-OpenRouter-Title",
            crate::ai_gateway::OPENROUTER_APP_TITLE,
        )
        .json(body)
        .send()
        .await
        .map_err(|_| "The voice provider could not be reached.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The voice provider answered {}.",
            response.status().as_u16()
        ));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_AUDIO {
        return Err("The voice provider sent no usable audio.".into());
    }
    Ok(bytes.to_vec())
}

/// Spend, speak, and refund the spend if the provider failed.
async fn speak(
    path: &Path,
    config: &AiConfig,
    user: &str,
    line: &Line,
) -> Result<Vec<u8>, Failure> {
    let cast: Value = serde_json::from_str(VOICES).map_err(|e| Failure::Store(e.to_string()))?;
    let text = line.text.trim();
    if text.is_empty() || text.len() > MAX_TEXT {
        return Err(Failure::Unknown);
    }
    let body = payload(&cast, &line.speaker, text).ok_or(Failure::Unknown)?;
    let id = request_id(user, &cast, &line.speaker, text);
    let store = |f: fn(&mut rusqlite::Connection, &str, &str) -> rusqlite::Result<Spend>| {
        let (path, user, id) = (path.to_owned(), user.to_owned(), id.clone());
        tokio::task::spawn_blocking(move || {
            let mut c = credits::open(&path).map_err(|e| e.to_string())?;
            f(&mut c, &user, &id).map_err(|e| e.to_string())
        })
    };
    let spent = store(|c, u, id| credits::spend(c, u, SpendKind::Tts, id))
        .await
        .map_err(|e| Failure::Store(e.to_string()))?
        .map_err(Failure::Store)?;
    if let Spend::Insufficient { balance, price } = spent {
        return Err(Failure::Credits { balance, price });
    }
    match synthesize(config, &body).await {
        Ok(audio) => Ok(audio),
        Err(reason) => {
            let refunded = store(|c, u, id| {
                credits::refund(c, u, SpendKind::Tts, id, "voice provider failed")
                    .map(|_| Spend::Spent { balance: 0 })
            })
            .await;
            if !matches!(refunded, Ok(Ok(_))) {
                tracing::error!(user, request_id = %id, "card voice refund failed");
            }
            Err(Failure::Provider(reason))
        }
    }
}

fn admit(user: &str) -> bool {
    use crate::rate_limit::{RateLimit, RateLimiter};
    static LIMITS: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    LIMITS
        .get_or_init(|| Mutex::new(RateLimiter::default()))
        .lock()
        .is_ok_and(|mut limits| {
            limits.allow(
                format!("voice:{user}"),
                RateLimit {
                    max_hits: 30,
                    window: Duration::from_secs(60),
                },
                Instant::now(),
            )
        })
}

async fn speech(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(line): Json<Line>,
) -> Response {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
    {
        return reply(
            StatusCode::FORBIDDEN,
            json!({"error": "Open the card game on this site."}),
        );
    }
    let Some(user) = state
        .account_auth
        .authenticated_user_id(&headers)
        .ok()
        .flatten()
    else {
        return reply(
            StatusCode::UNAUTHORIZED,
            json!({"error": "Sign in with your passkey to hear voices.", "reason": "signed_out"}),
        );
    };
    let (Some(path), Some(config)) = (
        state.event_store_path.clone(),
        state.ai_config.as_ref().clone(),
    ) else {
        return reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "Voices are not available on this server."}),
        );
    };
    if !admit(&user) {
        return reply(
            StatusCode::TOO_MANY_REQUESTS,
            json!({"error": "Give the voices a moment."}),
        );
    }
    match speak(&path, &config, &user, &line).await {
        Ok(audio) => (
            [
                (header::CONTENT_TYPE, "audio/mpeg"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            audio,
        )
            .into_response(),
        Err(Failure::Unknown) => reply(
            StatusCode::BAD_REQUEST,
            json!({"error": "Choose a current character line."}),
        ),
        Err(Failure::Credits { balance, price }) => reply(
            StatusCode::PAYMENT_REQUIRED,
            json!({"error": "Out of credits for voices.", "reason": "credits", "balance": balance, "price": price}),
        ),
        Err(Failure::Provider(reason)) => reply(
            StatusCode::BAD_GATEWAY,
            json!({"error": "This voice needs another try.", "detail": reason}),
        ),
        Err(Failure::Store(reason)) => {
            tracing::warn!(%reason, "card voice credits unavailable");
            reply(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"error": "Credits need another moment."}),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    async fn provider(fail: Arc<AtomicBool>, seen: Arc<Mutex<Vec<Value>>>) -> AiConfig {
        let app = Router::new().route(
            "/audio/speech",
            post(move |Json(body): Json<Value>| {
                let (fail, seen) = (fail.clone(), seen.clone());
                async move {
                    seen.lock().unwrap().push(body);
                    if fail.load(Ordering::SeqCst) {
                        StatusCode::SERVICE_UNAVAILABLE.into_response()
                    } else {
                        (
                            [(header::CONTENT_TYPE, "audio/mpeg")],
                            vec![255u8, 251, 144],
                        )
                            .into_response()
                    }
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        AiConfig {
            api_key: "test-secret".into(),
            base_url: format!("http://{address}"),
            ..AiConfig::default()
        }
    }

    #[tokio::test]
    async fn a_line_spends_one_credit_once_and_a_failed_voice_is_refunded() {
        let path =
            std::env::temp_dir().join(format!("cosyworld-voices-{}.sqlite", crate::random_hex(8)));
        let (fail, seen) = (
            Arc::new(AtomicBool::new(false)),
            Arc::new(Mutex::new(Vec::new())),
        );
        let config = provider(fail.clone(), seen.clone()).await;
        let line = |speaker: &str, text: &str| Line {
            speaker: speaker.into(),
            text: text.into(),
        };
        let balance = || credits::balance(&credits::open(&path).unwrap(), "u1").unwrap();
        // No credits: nothing reaches the provider.
        assert_eq!(
            speak(&path, &config, "u1", &line("vale", "A fair trade.")).await,
            Err(Failure::Credits {
                balance: 0,
                price: 1
            })
        );
        assert!(seen.lock().unwrap().is_empty());
        credits::grant(&mut credits::open(&path).unwrap(), "u1", 2, "pack", "test").unwrap();
        assert!(speak(&path, &config, "u1", &line("vale", "A fair trade."))
            .await
            .is_ok());
        assert!(speak(&path, &config, "u1", &line("vale", "A fair trade."))
            .await
            .is_ok());
        assert_eq!(balance(), 1, "the same line is bought once");
        let body = seen.lock().unwrap()[0].clone();
        assert_eq!(
            (body["model"].as_str(), body["input"].as_str()),
            (Some("fish-audio/drama-3"), Some("A fair trade."))
        );
        assert!(body["input_references"][0]["input_audio"]["data"]
            .as_str()
            .unwrap()
            .starts_with("data:audio/mpeg;base64,"));
        fail.store(true, Ordering::SeqCst);
        assert!(matches!(
            speak(&path, &config, "u1", &line("mara", "Hello.")).await,
            Err(Failure::Provider(_))
        ));
        assert_eq!(balance(), 1, "a failed voice is refunded");
        assert_eq!(
            speak(&path, &config, "u1", &line("echo", "bong")).await,
            Err(Failure::Unknown)
        );
        let _ = std::fs::remove_file(&path);
    }
}
