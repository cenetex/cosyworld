//! Services used by the local card table and desktop app.
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

#[path = "card_local_saves.rs"]
mod saves;

#[derive(Clone)]
pub(crate) struct Config {
    pub(crate) address: SocketAddr,
    pub(crate) speech_url: String,
    pub(crate) speech_token: String,
    pub(crate) voice_model: String,
    pub(crate) data_dir: PathBuf,
    pub(crate) model: String,
}

impl Config {
    pub(crate) fn from_env() -> Result<Option<Self>, String> {
        if std::env::var("COSYWORLD_LOCAL_APP").as_deref() != Ok("1") {
            return Ok(None);
        }
        let address: SocketAddr = std::env::var("COSYWORLD_V2_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:3110".into())
            .parse()
            .map_err(|_| "Choose a local address for CosyWorld.")?;
        if !address.ip().is_loopback() {
            return Err("The local app needs a loopback address.".into());
        }
        let speech_url = std::env::var("COSYWORLD_CHATTERBOX_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:3111".into());
        loopback_url(&speech_url)?;
        let speech_token = std::env::var("COSYWORLD_CHATTERBOX_TOKEN")
            .ok()
            .filter(|token| token.len() >= 32)
            .ok_or("Start the local app with its launcher to connect the voices.")?;
        let data_dir = std::env::var_os("COSYWORLD_LOCAL_DATA_DIR")
            .map(PathBuf::from)
            .ok_or("Choose a folder for the local app's saves and audio.")?;
        let model = std::env::var("COSYWORLD_AI_MODEL").unwrap_or_else(|_| "gemma3:4b".into());
        Ok(Some(Self {
            address,
            speech_url,
            speech_token,
            voice_model: std::env::var("COSYWORLD_CHATTERBOX_MODEL")
                .unwrap_or_else(|_| "turbo".into()),
            data_dir,
            model,
        }))
    }
}

fn loopback_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Choose a local service URL.")?;
    if url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        && url.username().is_empty()
        && url.password().is_none()
    {
        Ok(())
    } else {
        Err("Local services need an HTTP loopback URL.".into())
    }
}

pub(crate) async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let mut ai = crate::ai_gateway::AiConfig::from_env()
        .map_err(std::io::Error::other)?
        .ok_or("Choose a dialogue model in the local launcher.")?;
    if ai.base_url == "embedded://llama" {
        #[cfg(feature = "embedded-llama")]
        crate::ai_gateway::llama::start()
            .await
            .map_err(std::io::Error::other)?;
        #[cfg(not(feature = "embedded-llama"))]
        return Err("Build the game helper with --features embedded-llama.".into());
    } else {
        loopback_url(&ai.base_url).map_err(std::io::Error::other)?;
    }
    ai.api_key = "local-ai".into();
    std::fs::create_dir_all(&config.data_dir)?;
    let listener = tokio::net::TcpListener::bind(config.address).await?;
    let state = Arc::new(config);
    let app = super::router::<()>()
        .merge(super::narrative::router(Arc::new(Some(ai))))
        .merge(api(state.clone()))
        .merge(saves::router(state.data_dir.join("saves")))
        .layer(middleware::from_fn_with_state(state, local_origin));
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}

fn api(state: Arc<Config>) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(json!({"ok":true})) }))
        .route(
            "/meta",
            get(|| async {
                let mut meta =
                    serde_json::to_value(super::metadata::GameMetadata::for_primary(true)).unwrap();
                meta["service"] = json!("cosyworld-local");
                meta["version"] = json!(env!("CARGO_PKG_VERSION"));
                meta["card_game"]["play_modes"] = json!(["local"]);
                Json(meta)
            }),
        )
        .route("/card-game/local", get(settings))
        .route("/card-game/local/speech", post(speech))
        .layer(DefaultBodyLimit::max(8 * 1024))
        .with_state(state)
}

// The browser and local API share one origin. Check Host as well as Origin so
// another web page cannot use DNS rebinding to reach local files or inference.
async fn local_origin(State(config): State<Arc<Config>>, request: Request, next: Next) -> Response {
    let host = config.address.to_string();
    let origin = format!("http://{host}");
    let headers = request.headers();
    if headers.get(header::HOST).and_then(|v| v.to_str().ok()) != Some(host.as_str())
        || headers
            .get(header::ORIGIN)
            .is_some_and(|v| v.as_bytes() != origin.as_bytes())
        || headers
            .get("sec-fetch-site")
            .is_some_and(|v| v == "cross-site")
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut response = next.run(request).await;
    if !response.headers().contains_key(header::CACHE_CONTROL) {
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    }
    response
}

async fn settings(State(config): State<Arc<Config>>) -> Json<serde_json::Value> {
    Json(json!({
        "schema":1, "dialogueModel":config.model, "voiceModel":config.voice_model,
        "voiceRevision":format!("{:x}", Sha256::digest(config.speech_token.as_bytes())),
        "voiceTimeoutMs":120000, "backups":true
    }))
}

#[derive(Deserialize)]
struct Speech {
    speaker: String,
    text: String,
}

async fn speech(State(config): State<Arc<Config>>, Json(input): Json<Speech>) -> Response {
    let cast: serde_json::Value =
        serde_json::from_str(include_str!("../../card-game/voices.json")).unwrap();
    if cast["voices"].get(&input.speaker).is_none()
        || input.text.trim().is_empty()
        || input.text.chars().count() > 1200
        || input.text.chars().any(char::is_control)
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(115))
        .build()
    {
        Ok(client) => client,
        Err(_) => return voice_error(),
    };
    let result = client
        .post(format!(
            "{}/speech",
            config.speech_url.trim_end_matches('/')
        ))
        .bearer_auth(&config.speech_token)
        .json(&json!({"speaker":input.speaker,"text":input.text}))
        .send()
        .await;
    let Ok(mut result) = result else {
        return voice_error();
    };
    if !result.status().is_success()
        || result
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            != Some("audio/wav")
    {
        return voice_error();
    }
    let mut audio = Vec::new();
    loop {
        let chunk = match result.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => return voice_error(),
        };
        if audio.len() + chunk.len() > 8 * 1024 * 1024 {
            return voice_error();
        }
        audio.extend_from_slice(&chunk);
    }
    if audio.len() < 44 || &audio[..4] != b"RIFF" || &audio[8..12] != b"WAVE" {
        return voice_error();
    }
    ([(header::CONTENT_TYPE, "audio/wav")], Body::from(audio)).into_response()
}

fn voice_error() -> Response {
    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"The local voice needs another try. Check Chatterbox in the local app."}))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    fn config() -> Arc<Config> {
        Arc::new(Config {
            address: "127.0.0.1:3110".parse().unwrap(),
            speech_url: "http://127.0.0.1:3111".into(),
            speech_token: "x".repeat(32),
            voice_model: "turbo".into(),
            data_dir: std::env::temp_dir(),
            model: "gemma3:4b".into(),
        })
    }

    #[tokio::test]
    async fn local_api_checks_the_browser_origin_and_host() {
        let state = config();
        let app = api(state.clone()).layer(middleware::from_fn_with_state(state, local_origin));
        for (host, origin, expected) in [
            ("127.0.0.1:3110", "http://127.0.0.1:3110", StatusCode::OK),
            (
                "evil.example:3110",
                "http://evil.example:3110",
                StatusCode::FORBIDDEN,
            ),
            (
                "127.0.0.1:3110",
                "https://evil.example",
                StatusCode::FORBIDDEN,
            ),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/card-game/local")
                        .header("host", host)
                        .header("origin", origin)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
        }
    }

    #[test]
    fn service_urls_use_loopback() {
        assert!(loopback_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(loopback_url("https://example.com").is_err());
        assert!(loopback_url("http://127.0.0.1.evil.example:1234").is_err());
    }

    #[tokio::test]
    async fn local_assets_keep_the_web_bytes_and_cache_policy() {
        let state = config();
        let app = super::super::router::<()>()
            .merge(api(state.clone()))
            .layer(middleware::from_fn_with_state(state, local_origin));
        let path = "forest.json";
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/card-game/{path}"))
                    .header("host", "127.0.0.1:3110")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "public, no-cache"
        );
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            &bytes[..],
            cosyworld_orchestrator::card_assets::get(path).unwrap().1
        );
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/meta")
                    .header("host", "127.0.0.1:3110")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let local: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let web =
            serde_json::to_value(super::super::metadata::GameMetadata::for_primary(true)).unwrap();
        for field in [
            "assets_sha256",
            "shared_rules_version",
            "catalogs",
            "source_root",
        ] {
            assert_eq!(local["card_game"][field], web["card_game"][field]);
        }
        assert_eq!(local["version"], env!("CARGO_PKG_VERSION"));
    }
}
