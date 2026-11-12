//! Private authoring drafts belong to the signed-in passkey account.
#[path = "card_authoring_assets.rs"]
mod asset_routes;
#[path = "authoring_asset_store.rs"]
mod assets;
#[path = "authoring_create_receipt.rs"]
mod receipts;
use crate::{
    account_revision::{Error as RevisionError, Revision},
    AppState,
};
pub(crate) use asset_routes::{store_generated, StoreError};
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

type Failure = (StatusCode, &'static str, Option<u64>);
#[cfg(test)]
pub(crate) static ASSET_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const UNAVAILABLE: Failure = (
    StatusCode::SERVICE_UNAVAILABLE,
    "Your packs need another try.",
    None,
);
const MISSING: Failure = (
    StatusCode::NOT_FOUND,
    "Choose one of your private packs.",
    None,
);
const INVALID: Failure = (
    StatusCode::BAD_REQUEST,
    "Check the title, document, launch and file details.",
    None,
);

fn revision_error(error: RevisionError) -> Failure {
    let (status, _, message) = error.parts();
    (status, message, None)
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .merge(asset_routes::router())
        .route("/card-game/authoring/packs", get(list).post(create))
        .route("/card-game/authoring/packs/{id}", get(read).put(save))
        .route("/card-game/authoring/packs/{id}/launch", get(read_launch))
        .layer(DefaultBodyLimit::max(
            crate::authoring_draft::MAX_METADATA_BYTES,
        ))
        .layer(middleware::map_response(authoring_response))
}

pub(crate) const REQUEST_FIELDS: &str = "Check the request fields.";

/// Every authoring answer is private and carries its own status. A body the
/// server could not read (axum answers 400, 413, 415 and 422 in plain text) is
/// restated in the `{error, ok:false}` form the rest of the routes use.
pub(crate) async fn authoring_response(mut response: Response) -> Response {
    let plain = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/plain"));
    let message = match response.status().as_u16() {
        400 if plain => "Send valid JSON.",
        413 if plain => "That request is too large.",
        415 if plain => "Send the request as JSON.",
        422 if plain => REQUEST_FIELDS,
        _ => "",
    };
    if !message.is_empty() {
        let body = json!({"error":message,"ok":false,"code":"request_invalid"});
        response = (response.status(), Json(body)).into_response();
    }
    response
        .extensions_mut()
        .insert(crate::routes::ExplicitResponseStatus);
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

/// The `Idempotency-Key` header: absent, or one hyphenated UUID.
pub(crate) fn idempotency_key(headers: &HeaderMap) -> Result<Option<String>, ()> {
    receipts::key(headers).map_err(|_| ())
}

async fn run(
    state: AppState,
    headers: HeaderMap,
    mutation: bool,
    work: impl FnOnce(Connection, Revision) -> Result<Value, Failure> + Send + 'static,
) -> Response {
    let result = tokio::task::spawn_blocking(move || {
        let owner =
            crate::card_shared::revision(&state, &headers, mutation).map_err(|e| match e.as_str() {
                "Sign in with your passkey." => {
                    (StatusCode::UNAUTHORIZED, "Sign in with your passkey.", None)
                }
                "Open this world on its own site." => {
                    (StatusCode::FORBIDDEN, "Open your packs on this site.", None)
                }
                _ => RevisionError::from_message(&e).map(revision_error).unwrap_or(UNAVAILABLE),
            })?;
        receipts::owner(&headers, &owner)?;
        let path = state.event_store_path.as_deref().ok_or(UNAVAILABLE)?;
        let c = crate::open_event_store(path).map_err(|_| UNAVAILABLE)?;
        c.execute_batch(
            "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS authoring_packs (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, content TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS authoring_packs_owner ON authoring_packs(owner);
            CREATE TABLE IF NOT EXISTS authoring_launch (
            id TEXT PRIMARY KEY REFERENCES authoring_packs(id) ON DELETE CASCADE, content TEXT NOT NULL);",
        )
        .map_err(|_| UNAVAILABLE)?;
        receipts::schema(&c)?;
        work(c, owner)
    })
    .await;
    match result.unwrap_or(Err(UNAVAILABLE)) {
        Ok(value) => Json(value).into_response(),
        Err((status, error, revision)) => {
            if let Some(error) = RevisionError::from_message(error) {
                return error.response();
            }
            let mut body = json!({"error":error});
            if let Some(revision) = revision {
                body["revision"] = json!(revision);
            }
            (status, Json(body)).into_response()
        }
    }
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    run(state, headers, false, |c, owner| {
        let mut query = c.prepare("SELECT id, json_extract(content,'$.title'),
            json_extract(content,'$.revision') FROM authoring_packs WHERE owner=? ORDER BY rowid DESC")
            .map_err(|_| UNAVAILABLE)?;
        let packs = query.query_map([owner], |row| Ok(json!({
            "id":row.get::<_, String>(0)?, "title":row.get::<_, String>(1)?,
            "revision":row.get::<_, u64>(2)?
        }))).map_err(|_| UNAVAILABLE)?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(|_| UNAVAILABLE)?;
        Ok(json!({"packs":packs}))
    }).await
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> Response {
    let key = receipts::key(&headers);
    run(state, headers, true, move |mut c, owner| {
        let key = key?;
        let id = crate::random_hex(24);
        let (input, launch) = payload(input, &id, 1)?;
        let launch = launch.unwrap_or(Value::Null);
        validate_launch(&input, &launch)?;
        let digest = receipts::digest(&input, &launch);
        let tx = c
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UNAVAILABLE)?;
        owner.check(&tx).map_err(revision_error)?;
        if let Some(receipt) = receipts::previous(&tx, &owner, key.as_deref(), &digest)? {
            return Ok(receipt);
        }
        receipts::check_assets(&tx, &owner, &input)?;
        let count: u64 = tx
            .query_row(
                "SELECT count(*) FROM authoring_packs WHERE owner=?",
                [&owner],
                |r| r.get(0),
            )
            .map_err(|_| UNAVAILABLE)?;
        if count >= 128 {
            return Err((
                StatusCode::CONFLICT,
                "Continue one of your 128 private packs.",
                None,
            ));
        }
        tx.execute(
            "INSERT INTO authoring_packs(id,owner,content) VALUES(?,?,?)",
            params![id, owner, input.to_string()],
        )
        .map_err(|_| UNAVAILABLE)?;
        write_launch(&tx, &id, &launch)?;
        receipts::remember(&tx, &owner, key.as_deref(), &digest, &input)?;
        tx.commit().map_err(|_| UNAVAILABLE)?;
        Ok(input)
    })
    .await
}

async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    run(state, headers, false, move |c, owner| {
        let content: String = c
            .query_row(
                "SELECT content FROM authoring_packs WHERE id=? AND owner=?",
                params![id, owner],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| UNAVAILABLE)?
            .ok_or(MISSING)?;
        serde_json::from_str(&content).map_err(|_| UNAVAILABLE)
    })
    .await
}

fn payload(mut input: Value, id: &str, revision: u64) -> Result<(Value, Option<Value>), Failure> {
    let object = input.as_object_mut().ok_or(INVALID)?;
    if object.contains_key("id") || object.contains_key("revision") {
        return Err(INVALID);
    }
    let launch = object.remove("launch");
    object.insert("id".into(), json!(id));
    object.insert("revision".into(), json!(revision));
    if !crate::authoring_draft::valid(&input)
        || input["title"].as_str().is_none_or(|v| v.trim().is_empty())
    {
        return Err(INVALID);
    }
    Ok((input, launch))
}

fn validate_launch(draft: &Value, launch: &Value) -> Result<(), Failure> {
    if launch.is_null()
        || (launch.as_object().is_some_and(|v| v.len() == 2)
            && launch["schemaVersion"] == 1
            && launch["place"].as_str().is_some_and(|id| {
                draft["pack"]["places"]
                    .as_object()
                    .is_some_and(|v| v.contains_key(id))
            }))
    {
        Ok(())
    } else {
        Err(INVALID)
    }
}

fn write_launch(c: &Connection, id: &str, launch: &Value) -> Result<(), Failure> {
    if launch.is_null() {
        c.execute("DELETE FROM authoring_launch WHERE id=?", [id])
    } else {
        c.execute(
            "INSERT INTO authoring_launch(id,content) VALUES(?,?)
            ON CONFLICT(id) DO UPDATE SET content=excluded.content",
            params![id, launch.to_string()],
        )
    }
    .map_err(|_| UNAVAILABLE)?;
    Ok(())
}

fn source_and_launch(c: &Connection, owner: &str, id: &str) -> Result<(Value, Value), Failure> {
    let (source, launch): (String, Option<String>) = c.query_row(
        "SELECT p.content,l.content FROM authoring_packs p LEFT JOIN authoring_launch l ON p.id=l.id
        WHERE p.id=? AND p.owner=?", params![id, owner], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional().map_err(|_| UNAVAILABLE)?.ok_or(MISSING)?;
    Ok((
        serde_json::from_str(&source).map_err(|_| UNAVAILABLE)?,
        serde_json::from_str(launch.as_deref().unwrap_or("null")).map_err(|_| UNAVAILABLE)?,
    ))
}

async fn read_launch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    run(state, headers, false, move |c, owner| {
        let (source, launch) = source_and_launch(&c, &owner, &id)?;
        Ok(json!({"revision":source["revision"],"launch":launch}))
    })
    .await
}

async fn save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut input): Json<Value>,
) -> Response {
    run(state, headers, true, move |mut c, owner| {
        let expected = input
            .as_object_mut()
            .ok_or(INVALID)?
            .remove("expectedRevision")
            .and_then(|v| v.as_f64())
            .filter(|v| v.fract() == 0.0 && *v >= 1.0 && *v < 9_007_199_254_740_991.0)
            .ok_or(INVALID)? as u64;
        let tx = c
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UNAVAILABLE)?;
        owner.check(&tx).map_err(revision_error)?;
        let (current, previous_launch) = source_and_launch(&tx, &owner, &id)?;
        let revision = current["revision"].as_u64().ok_or(UNAVAILABLE)?;
        if revision != expected {
            return Err((
                StatusCode::CONFLICT,
                "This draft changed. Open its current version.",
                Some(revision),
            ));
        }
        let (input, launch) = payload(input, &id, revision + 1)?;
        let launch = launch.unwrap_or(previous_launch);
        validate_launch(&input, &launch)?;
        receipts::check_assets(&tx, &owner, &input)?;
        tx.execute(
            "UPDATE authoring_packs SET content=? WHERE id=? AND owner=?",
            params![input.to_string(), id, owner],
        )
        .map_err(|_| UNAVAILABLE)?;
        write_launch(&tx, &id, &launch)?;
        tx.commit().map_err(|_| UNAVAILABLE)?;
        Ok(input)
    })
    .await
}
