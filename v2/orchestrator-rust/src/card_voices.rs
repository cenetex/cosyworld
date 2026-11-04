//! Spoken card lines on the server's OpenRouter key. A signed-in passkey
//! hears them free; the per-account rate limit and the server's daily voice
//! budget bound the provider calls. In a shared world only a committed scene
//! line is spoken, and the world keeps its clip (`clips`) so every player
//! hears the same audio.

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

use crate::{ai_gateway::AiConfig, AppState};

#[path = "card_voices/authority.rs"]
pub(super) mod authority;
#[path = "card_voices/clips.rs"]
mod clips;

const VOICES: &str = include_str!("../../card-game/voices.json");
const MAX_TEXT: usize = 1200;
const MAX_AUDIO: usize = 2 * 1024 * 1024;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/card-game/speech", post(speech))
}

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Line {
    #[serde(default)]
    speaker: String,
    #[serde(default)]
    text: String,
    /// The shared world the line was said in; absent for the player's own.
    #[serde(default)]
    world: Option<String>,
    /// A committed shared scene and its zero-based line position.
    play: Option<String>,
    line: Option<usize>,
}

#[derive(Debug, PartialEq)]
enum Failure {
    Unknown,
    Outsider,
    Provider(String),
    Store(String),
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

/// A shared world's clip key: the cast revision, speaker and words.
fn clip_id(cast: &Value, speaker: &str, text: &str) -> String {
    let digest =
        Sha256::digest(json!([cast["revision"], cast["model"], speaker, text]).to_string());
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

/// Run one store step off the async workers.
async fn store<T: Send + 'static>(
    path: &Path,
    step: impl FnOnce(&mut rusqlite::Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, Failure> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut c = crate::canonical_journal::open_event_store(&path).map_err(|e| e.to_string())?;
        step(&mut c).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| Failure::Store(e.to_string()))?
    .map_err(Failure::Store)
}

/// Speak one line. A shared world's line must be a committed scene line of
/// a world the account plays in; its clip is kept for the other players.
async fn speak(
    path: &Path,
    config: &AiConfig,
    user: &str,
    line: &Line,
) -> Result<Vec<u8>, Failure> {
    let cast: Value = serde_json::from_str(VOICES).map_err(|e| Failure::Store(e.to_string()))?;
    let world = line.world.clone().unwrap_or_default();
    let (speaker, words) = if world.is_empty() {
        (line.speaker.clone(), line.text.clone())
    } else {
        let (w, u) = (world.clone(), user.to_owned());
        let play = line.play.clone().ok_or(Failure::Unknown)?;
        let index = line.line.ok_or(Failure::Unknown)?;
        store(path, move |c| {
            if !clips::plays_in(c, &w, &u)? {
                return Ok(Err(Failure::Outsider));
            }
            Ok(authority::line(c, &w, &play, index)?.ok_or(Failure::Unknown))
        })
        .await??
    };
    let text = words.trim();
    if text.is_empty() || text.len() > MAX_TEXT {
        return Err(Failure::Unknown);
    }
    let body = payload(&cast, &speaker, text).ok_or(Failure::Unknown)?;
    if world.is_empty() {
        return synthesize(config, &body).await.map_err(Failure::Provider);
    }
    let id = clip_id(&cast, &speaker, text);
    let (w, i) = (world.clone(), id.clone());
    if let Some(audio) = store(path, move |c| clips::clip(c, &w, &i)).await? {
        return Ok(audio);
    }
    let audio = synthesize(config, &body).await.map_err(Failure::Provider)?;
    let kept = audio.clone();
    store(path, move |c| clips::keep(c, &world, &id, &kept)).await?;
    Ok(audio)
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
        Err(Failure::Outsider) => reply(
            StatusCode::FORBIDDEN,
            json!({"error": "Join this world to hear its voices."}),
        ),
        Err(Failure::Provider(reason)) => reply(
            StatusCode::BAD_GATEWAY,
            json!({"error": "This voice needs another try.", "detail": reason}),
        ),
        Err(Failure::Store(reason)) => {
            tracing::warn!(%reason, "card voice store unavailable");
            reply(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({"error": "Voices need another moment."}),
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

    fn open(path: &Path) -> rusqlite::Connection {
        crate::canonical_journal::open_event_store(path).unwrap()
    }

    #[tokio::test]
    async fn a_signed_in_line_is_spoken_free_and_a_failed_voice_is_reported() {
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
            world: None,
            ..Default::default()
        };
        assert!(speak(&path, &config, "u1", &line("vale", "A fair trade."))
            .await
            .is_ok());
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
        assert_eq!(
            speak(&path, &config, "u1", &line("echo", "bong")).await,
            Err(Failure::Unknown)
        );
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn a_world_voices_only_its_committed_lines_and_every_player_hears_one_clip() {
        let path =
            std::env::temp_dir().join(format!("cosyworld-clips-{}.sqlite", crate::random_hex(8)));
        let c = open(&path);
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT, seen INTEGER);
             CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
             INSERT INTO card_members VALUES ('w1', 0, 'u1', 0);
             INSERT INTO card_members VALUES ('w2', 0, 'u1', 0);
             INSERT INTO card_bindings VALUES ('w1', 1, 'u2');",
        )
        .unwrap();
        authority::seed(&c, "Again?");
        let (fail, seen) = (
            Arc::new(AtomicBool::new(false)),
            Arc::new(Mutex::new(Vec::new())),
        );
        let config = provider(fail.clone(), seen.clone()).await;
        let line = |text: &str| Line {
            speaker: "vale".into(),
            text: text.into(),
            world: Some("w1".into()),
            play: Some("play-1".into()),
            line: Some(usize::from(text == "Again?")),
        };
        // Missing references, another world's play, and indices outside the
        // recorded exchange never reach the cache or provider.
        for body in [
            json!({"world":"w1","speaker":"vale","text":"Uncommitted words."}),
            json!({"world":"w1","play":"missing","line":0}),
            json!({"world":"w2","play":"play-1","line":0}),
            json!({"world":"w1","play":"play-1"}),
            json!({"world":"w1","play":"play-1","line":2}),
        ] {
            assert_eq!(
                speak(&path, &config, "u1", &serde_json::from_value(body).unwrap()).await,
                Err(Failure::Unknown)
            );
        }
        assert!(
            serde_json::from_value::<Line>(json!({"world":"w1","play":"play-1","line":-1}))
                .is_err()
        );
        assert!(seen.lock().unwrap().is_empty());
        assert_eq!(
            speak(&path, &config, "u3", &line("Hello.")).await,
            Err(Failure::Outsider),
            "only a world's players hear its voices"
        );
        let mut forged = line("Hello.");
        forged.speaker = "mara".into();
        forged.text = "Words the world never said.".into();
        let first = speak(&path, &config, "u1", &forged).await.unwrap();
        assert_eq!(
            seen.lock().unwrap()[0],
            payload(&serde_json::from_str(VOICES).unwrap(), "vale", "Hello.").unwrap()
        );
        let second = speak(&path, &config, "u2", &line("Hello.")).await.unwrap();
        assert_eq!(first, second);
        assert_eq!(seen.lock().unwrap().len(), 1, "the clip is made once");
        // A kept clip still needs a current member and a completed scene.
        c.execute("DELETE FROM card_bindings", []).unwrap();
        assert_eq!(
            speak(&path, &config, "u2", &line("Hello.")).await,
            Err(Failure::Outsider)
        );
        for status in ["waiting", "working", "failed", "cancelled"] {
            c.execute("UPDATE card_full_plays SET status=?", [status])
                .unwrap();
            assert_eq!(
                speak(&path, &config, "u1", &line("Hello.")).await,
                Err(Failure::Unknown)
            );
        }
        c.execute("UPDATE card_full_plays SET status='done'", [])
            .unwrap();
        assert!(speak(&path, &config, "u1", &line("Hello.")).await.is_ok());
        assert_eq!(seen.lock().unwrap().len(), 1);
        fail.store(true, Ordering::SeqCst);
        assert!(matches!(
            speak(&path, &config, "u1", &line("Again?")).await,
            Err(Failure::Provider(_))
        ));
        c.execute("DELETE FROM card_full_scenes", []).unwrap();
        assert_eq!(
            speak(&path, &config, "u1", &line("Hello.")).await,
            Err(Failure::Unknown),
            "deleted lines cannot return kept clips"
        );
        let _ = std::fs::remove_file(&path);
    }
}
