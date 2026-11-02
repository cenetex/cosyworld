//! Scene videos on the server's OpenRouter key, paid with credits (#1924).
//! Starting a film spends a video's price; a job OpenRouter fails, cancels
//! or lets expire is refunded once. The browser polls by its request id.

use std::path::{Path as FsPath, PathBuf};

use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::credits::{self, Spend, SpendKind};
use crate::{ai_gateway::AiConfig, AppState};

/// TBC Mischief 1, the camera's default film model.
const MODEL: &str = "tbc/mischief-1";
const MAX_VIDEO: usize = 100 * 1024 * 1024;

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/card-game/video/model", get(model))
        .route("/card-game/video/{id}", get(status))
        .route("/card-game/video/{id}/content", get(content))
        .route(
            "/card-game/video",
            post(start).layer(DefaultBodyLimit::max(3 * 1024 * 1024)),
        )
}

fn reply(status: StatusCode, body: Value) -> Response {
    (status, [(header::CACHE_CONTROL, "no-store")], Json(body)).into_response()
}

fn fail(status: StatusCode, message: &str) -> Response {
    reply(status, json!({"error": message}))
}

async fn provider(
    config: &AiConfig,
    path: &str,
    body: Option<&Value>,
) -> Result<reqwest::Response, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/{path}", config.base_url);
    let request = match body {
        Some(body) => client.post(url).json(body),
        None => client.get(url),
    };
    let response = request
        .bearer_auth(&config.api_key)
        .header("HTTP-Referer", crate::ai_gateway::OPENROUTER_APP_REFERER)
        .header(
            "X-OpenRouter-Title",
            crate::ai_gateway::OPENROUTER_APP_TITLE,
        )
        .send()
        .await
        .map_err(|_| "The video provider could not be reached.".to_string())?;
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(format!(
            "The video provider answered {}.",
            response.status().as_u16()
        ))
    }
}

async fn provider_json(
    config: &AiConfig,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    provider(config, path, body)
        .await?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// The signed-in account, its store and the server's AI settings.
fn context(state: &AppState, headers: &HeaderMap) -> Result<(String, PathBuf, AiConfig), Response> {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
    {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "Open the card game on this site.",
        ));
    }
    let user = state.account_auth.authenticated_user_id(headers).ok().flatten().ok_or_else(|| {
        reply(StatusCode::UNAUTHORIZED, json!({"error": "Sign in with your passkey to make a scene video.", "reason": "signed_out"}))
    })?;
    match (
        state.event_store_path.clone(),
        state.ai_config.as_ref().clone(),
    ) {
        (Some(path), Some(config)) => Ok((user, path.as_ref().clone(), config)),
        _ => Err(fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "Scene videos are not available on this server.",
        )),
    }
}

fn jobs(c: &rusqlite::Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS credit_video_jobs (
            user_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            job_id TEXT NOT NULL,
            created_at_unix INTEGER NOT NULL,
            PRIMARY KEY (user_id, request_id)
        );",
    )
}

/// Run one store step off the async workers.
async fn store<T: Send + 'static>(
    path: &FsPath,
    step: impl FnOnce(&mut rusqlite::Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, Response> {
    let path = path.to_owned();
    let result = tokio::task::spawn_blocking(move || {
        let mut c = credits::open(&path).map_err(|e| e.to_string())?;
        jobs(&c).map_err(|e| e.to_string())?;
        step(&mut c).map_err(|e| e.to_string())
    })
    .await;
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(reason)) => {
            tracing::warn!(%reason, "scene video credits unavailable");
            Err(fail(
                StatusCode::SERVICE_UNAVAILABLE,
                "Credits need another moment.",
            ))
        }
        Err(_) => Err(fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "Credits need another moment.",
        )),
    }
}

fn job_of(c: &mut rusqlite::Connection, user: &str, id: &str) -> rusqlite::Result<Option<String>> {
    c.query_row(
        "SELECT job_id FROM credit_video_jobs WHERE user_id = ?1 AND request_id = ?2",
        params![user, id],
        |row| row.get(0),
    )
    .optional()
}

fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// The film model's catalog entry, for the clip length and frame options.
async fn model(State(state): State<AppState>) -> Response {
    let Some(config) = state.ai_config.as_ref().clone() else {
        return fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "Scene videos are not available on this server.",
        );
    };
    match provider_json(&config, "videos/models", None).await {
        Ok(catalog) => match catalog["data"]
            .as_array()
            .and_then(|m| m.iter().find(|m| m["id"] == MODEL))
        {
            Some(entry) => reply(StatusCode::OK, entry.clone()),
            None => fail(
                StatusCode::BAD_GATEWAY,
                "The film model is not available right now.",
            ),
        },
        Err(reason) => fail(StatusCode::BAD_GATEWAY, &reason),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Start {
    request_id: String,
    prompt: String,
    options: Map<String, Value>,
}

/// The provider body: the fixed model, the prompt and the clip options the
/// browser chose from the model's catalog entry.
fn body(start: &Start) -> Option<Value> {
    const OPTIONS: [&str; 5] = [
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio",
        "frame_images",
    ];
    if start.prompt.trim().is_empty() || start.prompt.len() > 8000 {
        return None;
    }
    let mut body = Map::new();
    for (key, value) in &start.options {
        if !OPTIONS.contains(&key.as_str()) {
            return None;
        }
        body.insert(key.clone(), value.clone());
    }
    body.insert("model".into(), json!(MODEL));
    body.insert("prompt".into(), json!(start.prompt));
    Some(Value::Object(body))
}

async fn start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(start): Json<Start>,
) -> Response {
    let (user, path, config) = match context(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    let Some(request) = body(&start).filter(|_| valid_id(&start.request_id)) else {
        return fail(StatusCode::BAD_REQUEST, "Film the current scene again.");
    };
    begin(&path, &config, &user, &start.request_id, &request).await
}

async fn begin(
    path: &FsPath,
    config: &AiConfig,
    user: &str,
    id: &str,
    request: &Value,
) -> Response {
    let (u, i) = (user.to_owned(), id.to_owned());
    let spent = match store(path, move |c| {
        if job_of(c, &u, &i)?.is_some() {
            return Ok(None);
        }
        credits::spend(c, &u, SpendKind::Video, &i).map(Some)
    })
    .await
    {
        Ok(spent) => spent,
        Err(response) => return response,
    };
    match spent {
        None => {
            return reply(
                StatusCode::OK,
                json!({"request_id": id, "status": "submitted"}),
            )
        }
        Some(Spend::Insufficient { balance, price }) => {
            return reply(
                StatusCode::PAYMENT_REQUIRED,
                json!({"error": "A scene video needs 100 credits.", "reason": "credits", "balance": balance, "price": price}),
            )
        }
        Some(_) => {}
    }
    let submitted =
        match crate::ai_gateway::enforce_server_paid_daily_limit(config, "card_video").await {
            Ok(_budget) => provider_json(config, "videos", Some(request)).await,
            Err(_) => Err("The server video budget is spent for today.".into()),
        };
    let job = submitted.and_then(|job| {
        job["id"]
            .as_str()
            .filter(|j| !j.is_empty() && j.len() <= 200)
            .map(str::to_owned)
            .ok_or_else(|| "The video provider sent no job.".to_string())
    });
    let (u, i) = (user.to_owned(), id.to_owned());
    match job {
        Ok(job) => match store(path, move |c| {
            c.execute(
                "INSERT INTO credit_video_jobs (user_id, request_id, job_id, created_at_unix) VALUES (?1, ?2, ?3, ?4)",
                params![u, i, job, crate::util::now_unix_secs() as i64],
            )
        })
        .await
        {
            Ok(_) => reply(StatusCode::OK, json!({"request_id": id, "status": "submitted"})),
            Err(response) => response,
        },
        Err(reason) => {
            let note = reason.clone();
            let _ = store(path, move |c| credits::refund(c, &u, SpendKind::Video, &i, &note)).await;
            reply(StatusCode::BAD_GATEWAY, json!({"error": "The video needs a fresh request.", "detail": reason}))
        }
    }
}

async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let (user, path, config) = match context(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    poll(&path, &config, &user, &id).await
}

async fn poll(path: &FsPath, config: &AiConfig, user: &str, id: &str) -> Response {
    let (u, i) = (user.to_owned(), id.to_owned());
    let Ok(Some(job)) = store(path, move |c| job_of(c, &u, &i)).await else {
        return fail(StatusCode::NOT_FOUND, "Film the current scene again.");
    };
    let job_status = match provider_json(config, &format!("videos/{}", urlencode(&job)), None).await
    {
        Ok(job) => job,
        Err(reason) => {
            return reply(
                StatusCode::OK,
                json!({"status": "processing", "detail": reason}),
            )
        }
    };
    let status = job_status["status"]
        .as_str()
        .unwrap_or("processing")
        .to_owned();
    if ["failed", "cancelled", "expired"].contains(&status.as_str()) {
        let reason = job_status["error"]["message"]
            .as_str()
            .or(job_status["error"].as_str())
            .unwrap_or("")
            .to_owned();
        let (u, i, note) = (
            user.to_owned(),
            id.to_owned(),
            format!("video {status}: {reason}"),
        );
        let refunded = store(path, move |c| {
            credits::refund(c, &u, SpendKind::Video, &i, &note)
        })
        .await;
        return reply(
            StatusCode::OK,
            json!({"status": status, "error": reason, "refunded": matches!(refunded, Ok(true))}),
        );
    }
    reply(
        StatusCode::OK,
        json!({"status": if status == "completed" { "completed" } else { "processing" }}),
    )
}

fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

async fn content(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let (user, path, config) = match context(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    let Ok(Some(job)) = store(&path, move |c| job_of(c, &user, &id)).await else {
        return fail(StatusCode::NOT_FOUND, "Film the current scene again.");
    };
    let bytes = match provider(
        &config,
        &format!("videos/{}/content?index=0", urlencode(&job)),
        None,
    )
    .await
    {
        Ok(response) => response.bytes().await.map_err(|e| e.to_string()),
        Err(reason) => Err(reason),
    };
    match bytes {
        Ok(bytes) if !bytes.is_empty() && bytes.len() <= MAX_VIDEO => (
            [
                (header::CONTENT_TYPE, "video/mp4"),
                (header::CACHE_CONTROL, "private, no-store"),
            ],
            bytes,
        )
            .into_response(),
        _ => fail(StatusCode::BAD_GATEWAY, "The video needs another moment."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    async fn stub(
        job_status: Arc<Mutex<&'static str>>,
        submits: Arc<Mutex<Vec<Value>>>,
    ) -> AiConfig {
        let app = Router::new()
            .route(
                "/videos",
                post(move |Json(body): Json<Value>| async move {
                    submits.lock().unwrap().push(body);
                    Json(json!({"id": "job/1", "status": "pending"}))
                }),
            )
            .route(
                "/videos/{job}",
                get(move |Path(job): Path<String>| async move {
                    assert_eq!(job, "job/1");
                    let status = *job_status.lock().unwrap();
                    Json(json!({"status": status, "error": {"message": "content rejected"}}))
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

    async fn read(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn a_scene_video_spends_once_and_a_failed_job_is_refunded_once() {
        let path =
            std::env::temp_dir().join(format!("cosyworld-video-{}.sqlite", crate::random_hex(8)));
        let (job_status, submits) = (
            Arc::new(Mutex::new("pending")),
            Arc::new(Mutex::new(Vec::new())),
        );
        let config = stub(job_status.clone(), submits.clone()).await;
        let start = Start {
            request_id: "film-0001".into(),
            prompt: "Vale: \"Hello.\"".into(),
            options: serde_json::from_value(json!({"duration": 5, "aspect_ratio": "16:9"}))
                .unwrap(),
        };
        let request = body(&start).unwrap();
        assert_eq!(
            (request["model"].as_str(), request["duration"].as_i64()),
            (Some(MODEL), Some(5))
        );
        let mut sneaky = Start {
            options: Map::new(),
            ..start
        };
        sneaky
            .options
            .insert("model".into(), json!("expensive/model"));
        assert!(body(&sneaky).is_none(), "the browser cannot pick the model");
        let balance = || credits::balance(&credits::open(&path).unwrap(), "u1").unwrap();

        let (status, reply) = read(begin(&path, &config, "u1", "film-0001", &request).await).await;
        assert_eq!(
            (status, reply["balance"].as_i64()),
            (StatusCode::PAYMENT_REQUIRED, Some(0))
        );
        assert!(submits.lock().unwrap().is_empty());

        credits::grant(
            &mut credits::open(&path).unwrap(),
            "u1",
            150,
            "pack",
            "test",
        )
        .unwrap();
        for _ in 0..2 {
            let (status, reply) =
                read(begin(&path, &config, "u1", "film-0001", &request).await).await;
            assert_eq!(
                (status, reply["status"].as_str()),
                (StatusCode::OK, Some("submitted"))
            );
        }
        assert_eq!(
            (submits.lock().unwrap().len(), balance()),
            (1, 50),
            "one submit, one charge"
        );
        assert_eq!(
            read(poll(&path, &config, "u1", "film-0001").await).await.1["status"],
            "processing"
        );
        assert_eq!(
            read(poll(&path, &config, "u2", "film-0001").await).await.0,
            StatusCode::NOT_FOUND
        );
        *job_status.lock().unwrap() = "failed";
        let (_, reply) = read(poll(&path, &config, "u1", "film-0001").await).await;
        assert_eq!(
            (reply["status"].as_str(), reply["refunded"].as_bool()),
            (Some("failed"), Some(true))
        );
        let (_, reply) = read(poll(&path, &config, "u1", "film-0001").await).await;
        assert_eq!(
            (reply["refunded"].as_bool(), balance()),
            (Some(false), 150),
            "refunded once"
        );
        let _ = std::fs::remove_file(&path);
    }
}
