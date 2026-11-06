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
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

type Failure = (StatusCode, &'static str);
const UNAVAILABLE: Failure = (
    StatusCode::SERVICE_UNAVAILABLE,
    "Your packs need another try.",
);
const MISSING: Failure = (StatusCode::NOT_FOUND, "Choose one of your private packs.");

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    schema_version: u8,
    title: String,
    document: String,
    pack: Option<Map<String, Value>>,
    bridge: Option<Map<String, Value>>,
    #[serde(default)]
    assets: Vec<Asset>,
    #[serde(default)]
    sources: Vec<Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    path: String,
    mime: String,
    sha256: String,
    size: u64,
}

impl Draft {
    fn valid(&self) -> bool {
        self.schema_version == 1
            && !self.title.trim().is_empty()
            && self.title.chars().count() <= 80
            && !self.title.chars().any(char::is_control)
            && self.document.len() <= 8 * 1024 * 1024
            && self.assets.len() <= 512
            && self.sources.len() <= 512
            && self.sources.iter().all(Value::is_object)
            && self.assets.iter().enumerate().all(|(i, asset)| {
                asset.path.starts_with("assets/")
                    && asset.path.len() <= 240
                    && !asset.path.contains('\\')
                    && !asset.path.chars().any(char::is_control)
                    && asset.path.split('/').all(|p| !["", ".", ".."].contains(&p))
                    && self.assets[..i].iter().all(|a| a.path != asset.path)
                    && [
                        "image/png",
                        "image/webp",
                        "image/svg+xml",
                        "audio/mpeg",
                        "audio/mp4",
                    ]
                    .contains(&asset.mime.as_str())
                    && asset.sha256.len() == 64
                    && asset
                        .sha256
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                    && asset.size > 0
                    && asset.size <= 16 * 1024 * 1024
            })
            && self.assets.iter().map(|a| a.size).sum::<u64>() <= 256 * 1024 * 1024
    }
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/card-game/authoring/packs", get(list).post(create))
        .route("/card-game/authoring/packs/{id}", get(read))
        .layer(DefaultBodyLimit::max(10 * 1024 * 1024))
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
    Json(input): Json<Draft>,
) -> Response {
    run(state, headers, true, |mut c, owner| {
        if !input.valid() {
            return Err((
                StatusCode::BAD_REQUEST,
                "Check the title, document and file details.",
            ));
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
        let id = crate::random_hex(24);
        let mut draft = serde_json::to_value(input).map_err(|_| UNAVAILABLE)?;
        draft["id"] = json!(id);
        draft["revision"] = json!(1);
        tx.execute(
            "INSERT INTO authoring_packs(id,owner,content) VALUES(?,?,?)",
            params![id, owner, draft.to_string()],
        )
        .map_err(|_| UNAVAILABLE)?;
        tx.commit().map_err(|_| UNAVAILABLE)?;
        Ok(draft)
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
