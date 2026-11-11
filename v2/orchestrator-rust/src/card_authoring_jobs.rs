//! A maker generation is a server-owned job: one paid request, run once, whose
//! result is kept on the server so a closed tab, a reload or a deploy cannot lose it.
use super::*;
use axum::{extract::Path as UrlPath, routing::get};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const ROUTE: &str = "/card-game/authoring/jobs";
const LISTED: usize = 50;
/// Finished jobs kept per owner; older ones go when a new job is accepted.
const KEPT: usize = 200;
const RETAIN: Duration = Duration::from_secs(7 * 24 * 3600);
const MAX_TEXT_RESULT: usize = 64 * 1024;
const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS authoring_jobs (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
    request_key TEXT, digest TEXT NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    result TEXT, error TEXT);
    CREATE INDEX IF NOT EXISTS authoring_jobs_owner ON authoring_jobs(owner, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS authoring_jobs_request
    ON authoring_jobs(owner, request_key) WHERE request_key IS NOT NULL;";
const INTERRUPTED: &str = "The server restarted while this was running, so it was stopped. It was not run again; start it again if you still want it.";

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(ROUTE, post(create).get(list))
        .route("/card-game/authoring/jobs/{id}", get(read))
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |v| v.as_millis() as i64)
}
fn unavailable() -> Failed {
    Failed::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Your generation jobs need another try.",
        "jobs_unavailable",
    )
}
fn open(state: &AppState) -> Result<Connection, Failed> {
    let path = state.event_store_path.as_deref().ok_or_else(unavailable)?;
    let c = crate::open_event_store(path).map_err(|_| unavailable())?;
    c.execute_batch(SCHEMA).map_err(|_| unavailable())?;
    Ok(c)
}
async fn db<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(Connection) -> Result<T, Failed> + Send + 'static,
) -> Result<T, Failed> {
    let state = state.clone();
    tokio::task::spawn_blocking(move || work(open(&state)?))
        .await
        .unwrap_or_else(|_| Err(unavailable()))
}

/// Run at boot, before the first request. Nothing that was running survives a
/// restart, and a paid call is never started again on its own.
pub(super) fn start(state: &AppState) {
    let Ok(c) = open(state) else { return };
    if let Ok(stopped) = interrupt(&c, now_ms()) {
        if stopped > 0 {
            tracing::warn!(stopped, "stopped generation jobs left running by a restart");
        }
    }
    let _ = prune(&c, now_ms());
    let state = state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(3600));
        loop {
            tick.tick().await;
            let _ = db(&state, |c| prune(&c, now_ms()).map_err(|_| unavailable())).await;
        }
    });
}
fn interrupt(c: &Connection, now: i64) -> rusqlite::Result<usize> {
    let error = json!({"message":INTERRUPTED,"code":"generation_interrupted","retryAfterMs":0});
    c.execute(
        "UPDATE authoring_jobs SET status='failed', updated_at=?, error=?
        WHERE status IN ('queued','running')",
        params![now, error.to_string()],
    )
}
fn prune(c: &Connection, now: i64) -> rusqlite::Result<usize> {
    c.execute(
        "DELETE FROM authoring_jobs WHERE created_at<? AND status IN ('done','failed')",
        [now - RETAIN.as_millis() as i64],
    )
}

fn view(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    let parse = |index| -> rusqlite::Result<Option<Value>> {
        Ok(row
            .get::<_, Option<String>>(index)?
            .and_then(|v| serde_json::from_str(&v).ok()))
    };
    let mut job = json!({"id":row.get::<_, String>(0)?,"kind":row.get::<_, String>(1)?,
        "status":row.get::<_, String>(2)?,"createdAt":row.get::<_, i64>(3)?,"updatedAt":row.get::<_, i64>(4)?});
    for (field, index) in [("result", 5), ("error", 6)] {
        if let Some(value) = parse(index)? {
            job[field] = value;
        }
    }
    Ok(job)
}
const COLUMNS: &str = "id,kind,status,created_at,updated_at,result,error";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    kind: String,
    request: Value,
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Create>,
) -> Response {
    match accept(&state, headers, input).await {
        Ok((status, job)) => (status, Json(job)).into_response(),
        Err(failed) => failed.response(),
    }
}

async fn accept(
    state: &AppState,
    headers: HeaderMap,
    input: Create,
) -> Result<(StatusCode, Value), Failed> {
    let invalid = |message| Failed::new(StatusCode::BAD_REQUEST, message, INVALID_REQUEST);
    let owner = owner(state, headers.clone(), true).await?;
    let key = crate::card_authoring::idempotency_key(&headers)
        .map_err(|_| invalid("Send the Idempotency-Key as one UUID."))?;
    if !["image", "seed", "avatars"].contains(&input.kind.as_str()) {
        return Err(invalid("Choose image, seed or avatars."));
    }
    let digest = key.as_ref().map(|_| {
        format!(
            "{:x}",
            Sha256::digest(format!("{}{}", input.kind, input.request))
        )
    });
    if let (Some(key), Some(digest)) = (&key, &digest) {
        let (owner, key, digest) = (owner.clone(), key.clone(), digest.clone());
        if let Some(job) = db(state, move |c| earlier(&c, &owner, &key, &digest)).await? {
            return Ok((StatusCode::OK, job));
        }
    }
    if input.kind != "image" && input.request.to_string().len() > 64 * 1024 {
        return Err(Failed::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "That request is too large.",
            INVALID_REQUEST,
        ));
    }
    let run = prepare(state, &input.kind, input.request).await?;
    let permit =
        admission::admit(scope(state), run.pool(), &owner, Instant::now()).map_err(Failed::from)?;
    let id = crate::random_hex(16);
    let now = now_ms();
    let twin = {
        let (id, owner, kind, key, digest) = (
            id.clone(),
            owner.clone(),
            input.kind.clone(),
            key.clone(),
            digest.clone().unwrap_or_default(),
        );
        db(state, move |c| {
            let added = c.execute(
                "INSERT INTO authoring_jobs(id,owner,kind,request_key,digest,status,created_at,updated_at)
                VALUES(?,?,?,?,?,'queued',?,?)",
                params![id, owner, kind, key, digest, now, now],
            );
            match added {
                Ok(_) => {}
                // A twin request with the same key won the race: answer with its job.
                Err(rusqlite::Error::SqliteFailure(e, _))
                    if e.code == rusqlite::ErrorCode::ConstraintViolation && key.is_some() =>
                {
                    let key = key.unwrap_or_default();
                    return earlier(&c, &owner, &key, &digest)?
                        .map(Some)
                        .ok_or_else(unavailable);
                }
                Err(_) => return Err(unavailable()),
            }
            c.execute(
                "DELETE FROM authoring_jobs WHERE owner=?1 AND status IN ('done','failed') AND id NOT IN
                (SELECT id FROM authoring_jobs WHERE owner=?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2)",
                params![owner, KEPT as i64],
            )
            .map_err(|_| unavailable())?;
            Ok(None)
        })
        .await?
    };
    if let Some(job) = twin {
        return Ok((StatusCode::OK, job)); // the permit drops unused
    }
    tokio::spawn(execute(state.clone(), owner, id.clone(), run, permit));
    Ok((
        StatusCode::ACCEPTED,
        json!({"id":id,"kind":input.kind,"status":"queued","createdAt":now}),
    ))
}

/// The job an earlier request with this key started; a different request under the same key is refused.
fn earlier(c: &Connection, owner: &str, key: &str, digest: &str) -> Result<Option<Value>, Failed> {
    let found: Option<(Value, String)> = c
        .query_row(
            &format!("SELECT {COLUMNS},digest FROM authoring_jobs WHERE owner=? AND request_key=?"),
            params![owner, key],
            |row| Ok((view(row)?, row.get(7)?)),
        )
        .optional()
        .map_err(|_| unavailable())?;
    match found {
        Some((job, saved)) if saved == digest => Ok(Some(job)),
        Some(_) => Err(Failed::new(
            StatusCode::CONFLICT,
            "That Idempotency-Key already started a different request.",
            "idempotency_conflict",
        )),
        None => Ok(None),
    }
}

async fn execute(state: AppState, owner: String, id: String, run: Run, permit: admission::Permit) {
    // Held while the provider works and the result is stored, whoever is still listening.
    let _ = settle(&state, &id, "running", None, None).await;
    // Its own task, so a panic inside a provider call still ends in a recorded failure.
    let done = tokio::spawn(run.execute()).await.unwrap_or_else(|_| {
        Err(Failed::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Generation stopped unexpectedly. Try again.",
            "generation_interrupted",
        ))
    });
    let finished = match done {
        Ok(Done::Json(value)) if value.to_string().len() > MAX_TEXT_RESULT => Err(Failed::new(
            StatusCode::BAD_GATEWAY,
            "The reply was too large to keep. Try again.",
            "generation_invalid_output",
        )),
        Ok(Done::Json(value)) => Ok(value),
        Ok(Done::Image(drawn)) => keep(&state, &owner, drawn).await,
        Err(failed) => Err(failed),
    };
    drop(permit); // free the slot before the job reads as finished
    let (status, result, error) = match finished {
        Ok(value) => ("done", Some(value), None),
        Err(failed) => {
            let error = json!({"message":failed.message,"code":failed.code,
                "retryAfterMs":failed.retry_after_ms.unwrap_or(0)});
            ("failed", None, Some(error))
        }
    };
    if settle(&state, &id, status, result, error).await.is_err() {
        tracing::warn!(job = %id, "could not record a finished generation job");
    }
}

/// The paid picture becomes the owner's private file before the job reports done.
async fn keep(state: &AppState, owner: &str, drawn: images::Drawn) -> Result<Value, Failed> {
    let (sha256, size) = (drawn.sha256(), drawn.bytes.len());
    let (state, owner, digest) = (state.clone(), owner.to_string(), sha256.clone());
    let stored = tokio::task::spawn_blocking(move || {
        crate::card_authoring::store_generated(&state, &owner, &digest, &drawn.bytes).map(|_| drawn)
    })
    .await;
    match stored {
        Ok(Ok(drawn)) => Ok(json!({"image":{"sha256":sha256,"size":size,"mime":"image/png"},
            "basis":drawn.basis,"model":images::MODEL,"usage":drawn.usage})),
        Ok(Err(crate::card_authoring::StoreError::Full)) => Err(Failed::new(
            StatusCode::INSUFFICIENT_STORAGE,
            "The image was made but your file storage is full, so it was not kept. Make room, then generate again.",
            "authoring_storage_full",
        )),
        _ => Err(Failed::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "The image was made but could not be saved. Try generating it again.",
            "authoring_storage_unavailable",
        )),
    }
}

async fn settle(
    state: &AppState,
    id: &str,
    status: &'static str,
    result: Option<Value>,
    error: Option<Value>,
) -> Result<(), Failed> {
    let id = id.to_string();
    db(state, move |c| {
        c.execute(
            "UPDATE authoring_jobs SET status=?, updated_at=?, result=?, error=?
            WHERE id=? AND status IN ('queued','running')",
            params![
                status,
                now_ms(),
                result.map(|v| v.to_string()),
                error.map(|v| v.to_string()),
                id
            ],
        )
        .map(|_| ())
        .map_err(|_| unavailable())
    })
    .await
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    reply(&state, headers, None).await
}
async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    UrlPath(id): UrlPath<String>,
) -> Response {
    reply(&state, headers, Some(id)).await
}
async fn reply(state: &AppState, headers: HeaderMap, id: Option<String>) -> Response {
    let owner = match owner(state, headers, false).await {
        Ok(owner) => owner,
        Err(failed) => return failed.response(),
    };
    let found = db(state, move |c| {
        if let Some(id) = id {
            return c
                .query_row(
                    &format!("SELECT {COLUMNS} FROM authoring_jobs WHERE id=? AND owner=?"),
                    params![id, owner],
                    view,
                )
                .optional()
                .map_err(|_| unavailable())?
                .map(|job| json!(job))
                .ok_or_else(|| {
                    Failed::new(
                        StatusCode::NOT_FOUND,
                        "Choose one of your generation jobs.",
                        "job_not_found",
                    )
                });
        }
        let mut query = c
            .prepare(&format!(
                "SELECT {COLUMNS} FROM authoring_jobs WHERE owner=? ORDER BY created_at DESC, rowid DESC LIMIT ?"
            ))
            .map_err(|_| unavailable())?;
        let jobs = query
            .query_map(params![owner, LISTED as i64], view)
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
            .map_err(|_| unavailable())?;
        Ok(json!({"jobs":jobs}))
    })
    .await;
    match found {
        Ok(body) => Json(body).into_response(),
        Err(failed) => failed.response(),
    }
}

#[cfg(test)]
#[path = "card_authoring_jobs_tests.rs"]
mod tests;
