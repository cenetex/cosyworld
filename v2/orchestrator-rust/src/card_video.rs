//! Scene videos on the server's OpenRouter key, paid with credits (#1924).
//! Starting a film spends a video's price; a job OpenRouter fails, cancels
//! or lets expire is refunded once. The browser polls by its request id.
//! A player in a shared world films on that world's pool.

use std::path::{Path as FsPath, PathBuf};

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::credits::{self, clips, Payer, Spend, SpendKind};
use crate::{ai_gateway::AiConfig, AppState};

#[path = "card_video/receipts.rs"]
mod receipts;
#[path = "card_video/reservations.rs"]
mod reservations;

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
) -> Result<reqwest::Response, (String, bool)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| (e.to_string(), false))?;
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
        .map_err(|_| {
            (
                "The video provider could not be reached.".to_string(),
                false,
            )
        })?;
    if response.status().is_success() {
        Ok(response)
    } else {
        // Timeout/conflict and server errors may still concern accepted work.
        let rejected = matches!(
            response.status().as_u16(),
            400 | 401 | 402 | 403 | 404 | 413 | 415 | 422 | 429
        );
        Err((
            format!(
                "The video provider answered {}.",
                response.status().as_u16()
            ),
            rejected,
        ))
    }
}

async fn provider_json(
    config: &AiConfig,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    provider(config, path, body)
        .await
        .map_err(|(reason, _)| reason)?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// The signed-in account, its store and the server's AI settings.
// The error is the HTTP reply itself; handlers return it unchanged.
#[allow(clippy::result_large_err)]
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
    )?;
    let pooled = c
        .prepare("SELECT 1 FROM pragma_table_info('credit_video_jobs') WHERE name = 'world_id'")?
        .exists([])?;
    if !pooled {
        c.execute_batch(
            "ALTER TABLE credit_video_jobs ADD COLUMN world_id TEXT NOT NULL DEFAULT ''",
        )?;
    }
    reservations::schema(c)
}

/// Run one store step off the async workers.
#[allow(clippy::result_large_err)]
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
    /// The shared world whose pool pays; absent for the player's own.
    #[serde(default)]
    world: Option<String>,
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
    let world = start.world.clone().unwrap_or_default();
    begin(&path, &config, &user, &world, &start.request_id, &request).await
}

async fn begin(
    path: &FsPath,
    config: &AiConfig,
    user: &str,
    world: &str,
    id: &str,
    request: &Value,
) -> Response {
    let (u, w) = (user.to_owned(), world.to_owned());
    if !world.is_empty()
        && !matches!(
            store(path, move |c| clips::plays_in(c, &w, &u)).await,
            Ok(true)
        )
    {
        return fail(StatusCode::FORBIDDEN, "Join this world to film it.");
    }
    let (u, w, i, body) = (
        user.to_owned(),
        world.to_owned(),
        id.to_owned(),
        request.clone(),
    );
    let spent = match store(path, move |c| reservations::reserve(c, &u, &w, &i, &body)).await {
        Ok(spent) => spent,
        Err(response) => return response,
    };
    match spent {
        reservations::Reservation::Existing(state) => return submission_status(id, &state),
        reservations::Reservation::Conflict => {
            return fail(
                StatusCode::CONFLICT,
                "This request ID cannot be used for these video settings.",
            )
        }
        reservations::Reservation::Insufficient { balance, price } => {
            let reason = if world.is_empty() { "credits" } else { "pool" };
            return reply(
                StatusCode::PAYMENT_REQUIRED,
                json!({"error": "A scene video needs 100 credits.", "reason": reason, "balance": balance, "price": price}),
            );
        }
        reservations::Reservation::Ready => {}
    }
    let (path, config, u, w, i, body) = (
        path.to_owned(),
        config.clone(),
        user.to_owned(),
        world.to_owned(),
        id.to_owned(),
        request.clone(),
    );
    // Keep the receipt write alive when the browser disconnects.
    match tokio::spawn(async move { submit(&path, &config, &u, &w, &i, &body).await }).await {
        Ok(response) => response,
        Err(_) => submission_status(id, "submission_unknown"),
    }
}

fn submission_status(id: &str, state: &str) -> Response {
    reply(
        StatusCode::OK,
        json!({"request_id": id, "status": state,
        "refunded": state == "rejected" || state == "failed",
        "error": if state == "submission_unknown" { "The provider may have accepted this video. Do not submit it again; its receipt needs review." } else { "" }}),
    )
}

async fn submit(
    path: &FsPath,
    config: &AiConfig,
    user: &str,
    world: &str,
    id: &str,
    request: &Value,
) -> Response {
    let budget = crate::ai_gateway::enforce_server_paid_daily_limit(config, "card_video").await;
    if budget.is_err() {
        let (u, w, i) = (user.to_owned(), world.to_owned(), id.to_owned());
        return match store(path, move |c| {
            reservations::finish(
                c,
                &u,
                &w,
                &i,
                "failed",
                "",
                "Server video budget unavailable",
            )
        })
        .await
        {
            Ok(changed) => submission_status(id, if changed { "failed" } else { "processing" }),
            Err(response) => response,
        };
    }
    let (u, w, i) = (user.to_owned(), world.to_owned(), id.to_owned());
    match store(path, move |c| reservations::claim(c, &u, &w, &i)).await {
        Ok(true) => {}
        Ok(false) => return submission_status(id, "processing"),
        Err(response) => return response,
    }
    let submitted = match provider(config, "videos", Some(request)).await {
        Ok(response) => response
            .json::<Value>()
            .await
            .map_err(|e| (e.to_string(), false)),
        Err(error) => Err(error),
    };
    let job = submitted.and_then(|job| {
        job["id"]
            .as_str()
            .filter(|j| !j.is_empty() && j.len() <= 200)
            .map(str::to_owned)
            .ok_or_else(|| ("The video provider sent no job.".to_string(), false))
    });
    let (u, w, i) = (user.to_owned(), world.to_owned(), id.to_owned());
    let (status, job, detail) = match job {
        Ok(job) => ("submitted", job, String::new()),
        Err((reason, rejected)) => (
            if rejected {
                "rejected"
            } else {
                "submission_unknown"
            },
            String::new(),
            reason,
        ),
    };
    match store(path, move |c| {
        reservations::finish(c, &u, &w, &i, status, &job, &detail)
    })
    .await
    {
        Ok(_) => submission_status(id, status),
        Err(response) => response,
    }
}

#[derive(Default, Deserialize)]
struct Scope {
    #[serde(default)]
    world: String,
}

async fn lookup(
    path: &FsPath,
    user: &str,
    world: &str,
    id: &str,
) -> Result<Option<(String, String, String, String)>, Response> {
    let (u, w, i) = (user.to_owned(), world.to_owned(), id.to_owned());
    store(path, move |c| {
        let found = reservations::get(c, &u, &w, &i)?;
        if let Some((_, world, _, _)) = &found {
            if !world.is_empty() && !clips::plays_in(c, world, &u)? {
                return Ok(None);
            }
        }
        Ok(found)
    })
    .await
}

async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(scope): Query<Scope>,
) -> Response {
    let (user, path, config) = match context(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    poll(&path, &config, &user, &scope.world, &id).await
}

async fn poll(path: &FsPath, config: &AiConfig, user: &str, world: &str, id: &str) -> Response {
    let Ok(Some((job, world, state, detail))) = lookup(path, user, world, id).await else {
        return fail(StatusCode::NOT_FOUND, "Film the current scene again.");
    };
    if receipts::terminal(&state) {
        return reply(
            StatusCode::OK,
            json!({"status": state, "error": detail, "refunded": false}),
        );
    }
    if job.is_empty() {
        return submission_status(
            id,
            if state == "reserved" || state == "submitting" {
                "processing"
            } else {
                &state
            },
        );
    }
    reply(
        StatusCode::OK,
        receipts::observe(path, config, user, &world, id, &job).await,
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
    Query(scope): Query<Scope>,
) -> Response {
    let (user, path, config) = match context(&state, &headers) {
        Ok(context) => context,
        Err(response) => return response,
    };
    let Ok(Some((job, _, state, _))) = lookup(&path, &user, &scope.world, &id).await else {
        return fail(StatusCode::NOT_FOUND, "Film the current scene again.");
    };
    if state != "completed" || job.is_empty() {
        return fail(
            StatusCode::CONFLICT,
            "This video needs confirmed completion before download.",
        );
    }
    let bytes = match provider(
        &config,
        &format!("videos/{}/content?index=0", urlencode(&job)),
        None,
    )
    .await
    {
        Ok(response) => response.bytes().await.map_err(|e| e.to_string()),
        Err((reason, _)) => Err(reason),
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

    pub(super) async fn stub(
        job_status: Arc<Mutex<&'static str>>,
        submits: Arc<Mutex<Vec<Value>>>,
    ) -> AiConfig {
        let app = Router::new()
            .route(
                "/videos",
                post(move |Json(body): Json<Value>| async move {
                    submits.lock().unwrap().push(body);
                    Json(json!({"id": format!("job/{}", submits.lock().unwrap().len()), "status": "pending"}))
                }),
            )
            .route(
                "/videos/{job}",
                get(move |Path(job): Path<String>| async move {
                    assert!(job.starts_with("job/"));
                    let status = *job_status.lock().unwrap();
                    Json(json!({"id": if status == "mismatched" { "another-job" } else { &job }, "status": if status == "mismatched" { "failed" } else { status }, "error": {"message": "content rejected"}}))
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

    pub(super) async fn read(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn shared_routes_reserve_once_across_disconnect_and_unknown_acceptance() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        use sha2::{Digest, Sha256};
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::sync::{Notify, Semaphore};
        use tower::ServiceExt;
        let path = std::env::temp_dir().join(format!(
            "video-reservations-{}.sqlite",
            crate::random_hex(8)
        ));
        let count = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Semaphore::new(0));
        let (n, arrive, gate) = (count.clone(), entered.clone(), release.clone());
        let provider = Router::new()
            .route(
                "/videos",
                post(move |Json(body): Json<Value>| {
                    let (n, arrive, gate) = (n.clone(), arrive.clone(), gate.clone());
                    async move {
                        n.fetch_add(1, Ordering::SeqCst);
                        arrive.notify_one();
                        gate.acquire().await.unwrap().forget();
                        if body["prompt"] == "rejected" {
                            return (
                                StatusCode::BAD_REQUEST,
                                Json(json!({"error": "unsupported duration"})),
                            );
                        }
                        (
                            StatusCode::ACCEPTED,
                            Json(if body["prompt"] == "lost receipt" {
                                json!({"status": "pending"})
                            } else if body["prompt"] == "terminal failure" {
                                json!({"id": "job-failed"})
                            } else {
                                json!({"id": "job-one"})
                            }),
                        )
                    }
                }),
            )
            .route(
                "/videos/{id}",
                get(|Path(id): Path<String>| async move {
                    Json(json!({"status": if id == "job-failed" { "failed" } else { "completed" }, "id": id}))
                }),
            )
            .route("/videos/{id}/content", get(|| async { "video bytes" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let config = AiConfig {
            api_key: "test-secret".into(),
            base_url: format!("http://{}", listener.local_addr().unwrap()),
            ..AiConfig::default()
        };
        let server = tokio::spawn(async move { axum::serve(listener, provider).await.unwrap() });
        let mut state =
            crate::test_support::test_app_state(crate::RuntimeWorld::seeded(), Some(path.clone()));
        state.ai_config = Arc::new(Some(config));
        let mut c = credits::open(&path).unwrap();
        for user in ["u1", "u2", "outsider"] {
            c.execute(
                "INSERT INTO auth_users VALUES (?1, ?1, ?1, 'active', 0, 0)",
                [user],
            )
            .unwrap();
            let hash = URL_SAFE_NO_PAD.encode(Sha256::digest(user.as_bytes()));
            c.execute(
                "INSERT INTO auth_sessions VALUES (?1, ?2, 0, 0, 0, 9999999999, NULL)",
                params![hash, user],
            )
            .unwrap();
        }
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT, seen INTEGER);
            CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
            INSERT INTO card_members VALUES ('w1', 0, 'u1', 0), ('w1', 1, 'u2', 0);",
        )
        .unwrap();
        credits::grant(&mut c, "u1", 400, "pack", "").unwrap();
        credits::pool::commit(&mut c, "u1", "w1", 300, "pool").unwrap();
        jobs(&c).unwrap();
        let body = json!({"model": MODEL, "prompt": "scene", "duration": 5});
        assert!(matches!(
            reservations::reserve(&mut c, "u1", "w1", "film-once", &body).unwrap(),
            reservations::Reservation::Ready
        ));
        drop(c); // Recover the durable reservation after interruption before submit.
        let c = credits::open(&path).unwrap();
        let app = router().with_state(state);
        let request = |user: &str, id: &str, prompt: &str| {
            axum::http::Request::post("/card-game/video")
            .header(header::COOKIE, format!("cosyworld_session={user}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(json!({"request_id": id, "world": "w1", "prompt": prompt, "options": {"duration": 5}}).to_string())).unwrap()
        };
        let fetch = |user: &str, id: &str, suffix: &str| {
            axum::http::Request::get(format!("/card-game/video/{id}{suffix}?world=w1"))
                .header(header::COOKIE, format!("cosyworld_session={user}"))
                .body(axum::body::Body::empty())
                .unwrap()
        };
        let first = tokio::spawn(app.clone().oneshot(request("u1", "film-once", "scene")));
        tokio::time::timeout(std::time::Duration::from_secs(5), entered.notified())
            .await
            .unwrap();
        assert!(!reservations::finish(
            &mut credits::open(&path).unwrap(),
            "u1",
            "w1",
            "film-once",
            "failed",
            "",
            "competing budget failure"
        )
        .unwrap());
        assert_eq!(
            read(
                app.clone()
                    .oneshot(request("u2", "film-once", "scene"))
                    .await
                    .unwrap()
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            read(
                app.clone()
                    .oneshot(request("u2", "film-once", "changed"))
                    .await
                    .unwrap()
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(credits::balance(&c, Payer::of("w1", "u2")).unwrap(), 200);
        first.abort(); // A disconnected browser cannot cancel the durable receipt write.
        release.add_permits(10);
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                if read(
                    app.clone()
                        .oneshot(fetch("u2", "film-once", ""))
                        .await
                        .unwrap(),
                )
                .await
                .1["status"]
                    == "completed"
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            app.clone()
                .oneshot(fetch("u2", "film-once", "/content"))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            app.clone()
                .oneshot(fetch("outsider", "film-once", ""))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        for _ in 0..2 {
            assert_eq!(
                read(
                    app.clone()
                        .oneshot(request("u2", "film-lost", "lost receipt"))
                        .await
                        .unwrap()
                )
                .await
                .1["status"],
                "submission_unknown"
            );
        }
        assert_eq!(
            count.load(Ordering::SeqCst),
            2,
            "unknown acceptance must not submit again"
        );
        assert_eq!(
            credits::balance(&credits::open(&path).unwrap(), Payer::of("w1", "u1")).unwrap(),
            100
        );
        for _ in 0..2 {
            let (_, reply) = read(
                app.clone()
                    .oneshot(request("u2", "film-rejected", "rejected"))
                    .await
                    .unwrap(),
            )
            .await;
            assert_eq!(
                (reply["status"].as_str(), reply["refunded"].as_bool()),
                (Some("rejected"), Some(true))
            );
        }
        assert_eq!(
            count.load(Ordering::SeqCst),
            3,
            "definite rejection is terminal, not resubmitted"
        );
        assert_eq!(
            credits::balance(&c, Payer::of("w1", "u1")).unwrap(),
            100,
            "definite rejection refunds once"
        );
        assert_eq!(
            credits::balance(&c, "u1").unwrap(),
            100,
            "the pool alone pays"
        );
        app.clone()
            .oneshot(request("u2", "film-terminal", "terminal failure"))
            .await
            .unwrap();
        assert_eq!(
            app.clone()
                .oneshot(fetch("u2", "film-terminal", "/content"))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            read(
                app.clone()
                    .oneshot(fetch("u2", "film-terminal", ""))
                    .await
                    .unwrap()
            )
            .await
            .1["status"],
            "failed"
        );
        assert_eq!(
            app.clone()
                .oneshot(fetch("u2", "film-terminal", "/content"))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
        assert_eq!(
            credits::balance(&c, Payer::of("w1", "u1")).unwrap(),
            100,
            "failed film stays refunded even when provider has bytes"
        );
        c.execute(
            "INSERT INTO credit_video_jobs VALUES ('u1', 'legacy-read', 'job-one', 0, 'w1')",
            [],
        )
        .unwrap();
        let legacy = |suffix: &str| {
            axum::http::Request::get(format!("/card-game/video/legacy-read{suffix}"))
                .header(header::COOKIE, "cosyworld_session=u1")
                .body(axum::body::Body::empty())
                .unwrap()
        };
        assert_eq!(
            app.clone().oneshot(legacy("")).await.unwrap().status(),
            StatusCode::OK
        );
        c.execute("DELETE FROM card_members WHERE user = 'u1'", [])
            .unwrap();
        c.execute("DELETE FROM card_bindings WHERE user = 'u1'", [])
            .unwrap();
        for suffix in ["", "/content"] {
            assert_eq!(
                app.clone().oneshot(legacy(suffix)).await.unwrap().status(),
                StatusCode::NOT_FOUND,
                "an omitted world cannot bypass revoked legacy membership"
            );
        }
        server.abort();
        let _ = std::fs::remove_file(path);
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
            world: None,
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

        let (status, reply) =
            read(begin(&path, &config, "u1", "", "film-0001", &request).await).await;
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
                read(begin(&path, &config, "u1", "", "film-0001", &request).await).await;
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
            read(poll(&path, &config, "u1", "", "film-0001").await)
                .await
                .1["status"],
            "processing"
        );
        assert_eq!(
            read(poll(&path, &config, "u2", "", "film-0001").await)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        *job_status.lock().unwrap() = "mismatched";
        assert_eq!(
            read(poll(&path, &config, "u1", "", "film-0001").await)
                .await
                .1["status"],
            "processing"
        );
        assert_eq!(
            balance(),
            50,
            "a mismatched provider receipt cannot refund this film"
        );
        *job_status.lock().unwrap() = "failed";
        let (_, reply) = read(poll(&path, &config, "u1", "", "film-0001").await).await;
        assert_eq!(
            (reply["status"].as_str(), reply["refunded"].as_bool()),
            (Some("failed"), Some(true))
        );
        let (_, reply) = read(poll(&path, &config, "u1", "", "film-0001").await).await;
        assert_eq!(
            (reply["refunded"].as_bool(), balance()),
            (Some(false), 150),
            "refunded once"
        );
        *job_status.lock().unwrap() = "completed";
        assert_eq!(
            read(poll(&path, &config, "u1", "", "film-0001").await)
                .await
                .1["status"],
            "failed",
            "terminal receipts cannot be overwritten"
        );

        // In a shared world the pool pays and takes the refund.
        let mut c = credits::open(&path).unwrap();
        c.execute_batch(
            "CREATE TABLE card_members(world TEXT, actor INTEGER, user TEXT, seen INTEGER);
             CREATE TABLE card_bindings(world TEXT, actor INTEGER, user TEXT);
             INSERT INTO card_members VALUES ('w1', 0, 'u1', 0);",
        )
        .unwrap();
        credits::pool::commit(&mut c, "u1", "w1", 100, "c-1").unwrap();
        let film = |user: &'static str| begin(&path, &config, user, "w1", "film-0002", &request);
        assert_eq!(read(film("u2").await).await.0, StatusCode::FORBIDDEN);
        *job_status.lock().unwrap() = "pending";
        assert_eq!(read(film("u1").await).await.0, StatusCode::OK);
        let pool = || {
            let world = Payer::World {
                world: "w1",
                by: "",
            };
            credits::balance(&credits::open(&path).unwrap(), world).unwrap()
        };
        assert_eq!((pool(), balance()), (0, 50));
        *job_status.lock().unwrap() = "failed";
        poll(&path, &config, "u1", "w1", "film-0002").await;
        assert_eq!((pool(), balance()), (100, 50));
        let _ = std::fs::remove_file(&path);
    }
}
