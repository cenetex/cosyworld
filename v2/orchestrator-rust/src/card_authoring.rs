//! Private authoring drafts belong to the signed-in passkey account.
use crate::AppState;
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

type Failure = (StatusCode, &'static str);
const UNAVAILABLE: Failure = (
    StatusCode::SERVICE_UNAVAILABLE,
    "Your packs need another try.",
);
const MISSING: Failure = (StatusCode::NOT_FOUND, "Choose one of your private packs.");

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/card-game/authoring/packs", get(list).post(create))
        .route("/card-game/authoring/packs/{id}", get(read))
        .layer(DefaultBodyLimit::max(
            crate::authoring_draft::MAX_METADATA_BYTES,
        ))
        .layer(middleware::map_response(
            |mut response: Response| async move {
                response
                    .extensions_mut()
                    .insert(crate::routes::ExplicitResponseStatus);
                response
                    .headers_mut()
                    .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
                response
            },
        ))
}

async fn run(
    state: AppState,
    headers: HeaderMap,
    mutation: bool,
    work: impl FnOnce(Connection, String) -> Result<Value, Failure> + Send + 'static,
) -> Response {
    let result = tokio::task::spawn_blocking(move || {
        let owner =
            crate::card_shared::user(&state, &headers, mutation).map_err(|e| match e.as_str() {
                "Sign in with your passkey." => {
                    (StatusCode::UNAUTHORIZED, "Sign in with your passkey.")
                }
                "Open this world on its own site." => {
                    (StatusCode::FORBIDDEN, "Open your packs on this site.")
                }
                _ => UNAVAILABLE,
            })?;
        let path = state.event_store_path.as_deref().ok_or(UNAVAILABLE)?;
        let c = crate::open_event_store(path).map_err(|_| UNAVAILABLE)?;
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS authoring_packs (
            id TEXT PRIMARY KEY, owner TEXT NOT NULL, content TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS authoring_packs_owner ON authoring_packs(owner);",
        )
        .map_err(|_| UNAVAILABLE)?;
        work(c, owner)
    })
    .await;
    match result.unwrap_or(Err(UNAVAILABLE)) {
        Ok(value) => Json(value).into_response(),
        Err((status, error)) => (status, Json(json!({"error":error}))).into_response(),
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
    Json(mut input): Json<Value>,
) -> Response {
    run(state, headers, true, |mut c, owner| {
        let invalid = (
            StatusCode::BAD_REQUEST,
            "Check the title, document and file details.",
        );
        let object = input.as_object_mut().ok_or(invalid)?;
        if object.contains_key("id") || object.contains_key("revision") {
            return Err(invalid);
        }
        let id = crate::random_hex(24);
        object.insert("id".into(), json!(id));
        object.insert("revision".into(), json!(1));
        if !crate::authoring_draft::valid(&input)
            || input["title"]
                .as_str()
                .is_none_or(|title| title.trim().is_empty())
        {
            return Err(invalid);
        }
        let tx = c
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| UNAVAILABLE)?;
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
            ));
        }
        tx.execute(
            "INSERT INTO authoring_packs(id,owner,content) VALUES(?,?,?)",
            params![id, owner, input.to_string()],
        )
        .map_err(|_| UNAVAILABLE)?;
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
