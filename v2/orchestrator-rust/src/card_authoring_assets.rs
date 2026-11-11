//! Owner-only uploads become ready only after the immutable file is durable.
use super::assets::{Error, PrivateAssetStore};
use crate::AppState;
use axum::{
    body::{to_bytes, Body, Bytes},
    extract::{Path, Request, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde_json::json;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    time::Duration,
};

const MAX_FILE: usize = 16 * 1024 * 1024;
const ASSETS_TABLE: &str = "CREATE TABLE IF NOT EXISTS authoring_assets (
    owner TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
    touched_at INTEGER NOT NULL, PRIMARY KEY(owner,sha256));";
type Failure = (StatusCode, &'static str);
const UNAVAILABLE: Failure = (StatusCode::SERVICE_UNAVAILABLE, "Try this file again.");
const MISSING: Failure = (StatusCode::NOT_FOUND, "Choose one of your private files.");
const INVALID: Failure = (StatusCode::BAD_REQUEST, "Check the file and digest.");

pub(super) fn router() -> Router<AppState> {
    // The parent adds no-store and ExplicitResponseStatus to every response.
    Router::new().route(
        "/card-game/authoring/assets/{sha256}",
        get(serve).put(serve),
    )
}

fn active() -> &'static Mutex<HashSet<String>> {
    static OWNERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    OWNERS.get_or_init(Default::default)
}
struct Permit(String);
impl Drop for Permit {
    fn drop(&mut self) {
        active()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}
fn admit(owner: &str) -> Result<Permit, Failure> {
    let mut active = active().lock().map_err(|_| UNAVAILABLE)?;
    if active.len() >= 2 || !active.insert(owner.into()) {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Wait for the current file transfer.",
        ));
    }
    Ok(Permit(owner.into()))
}
fn storage(error: Error) -> Failure {
    match error {
        Error::Invalid => INVALID,
        Error::Capacity => (
            StatusCode::INSUFFICIENT_STORAGE,
            "Your file storage is full.",
        ),
        Error::Unavailable => UNAVAILABLE,
    }
}
async fn owner(state: AppState, headers: HeaderMap, mutation: bool) -> Result<String, Failure> {
    tokio::task::spawn_blocking(move || {
        let owner =
            crate::card_shared::user(&state, &headers, mutation).map_err(
                |message| match message.as_str() {
                    "Sign in with your passkey." => {
                        (StatusCode::UNAUTHORIZED, "Sign in with your passkey.")
                    }
                    "Open this world on its own site." => {
                        (StatusCode::FORBIDDEN, "Open your files on this site.")
                    }
                    _ => UNAVAILABLE,
                },
            )?;
        super::receipts::owner(&headers, &owner)
            .map_err(|(status, message, _)| (status, message))?;
        Ok(owner)
    })
    .await
    .map_err(|_| UNAVAILABLE)?
}

/// Reference commits and future cleanup take SQLite first, then the file guard.
fn commit(
    c: &mut rusqlite::Connection,
    state: &AppState,
    owner: &str,
    digest: &str,
    bytes: &[u8],
) -> Result<u64, Failure> {
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| UNAVAILABLE)?;
    let store = PrivateAssetStore::new(&state.generated_asset_dir, owner).map_err(storage)?;
    let receipt = store.put(digest, bytes).map_err(storage)?;
    tx.execute(
        "INSERT INTO authoring_assets(owner,sha256,size,touched_at) VALUES(?,?,?,unixepoch())
        ON CONFLICT(owner,sha256) DO UPDATE SET size=excluded.size,touched_at=excluded.touched_at",
        params![owner, receipt.sha256, receipt.size],
    )
    .map_err(|_| UNAVAILABLE)?;
    tx.commit().map_err(|_| UNAVAILABLE)?;
    Ok(receipt.size)
}

/// How a server-made file was refused.
#[derive(Debug, Eq, PartialEq)]
pub(crate) enum StoreError {
    Full,
    Unavailable,
}
/// Keep bytes the server made (a finished image) as the owner's private file.
pub(crate) fn store_generated(
    state: &AppState,
    owner: &str,
    digest: &str,
    bytes: &[u8],
) -> Result<u64, StoreError> {
    let path = state
        .event_store_path
        .as_deref()
        .ok_or(StoreError::Unavailable)?;
    let mut c = crate::open_event_store(path).map_err(|_| StoreError::Unavailable)?;
    c.execute_batch(ASSETS_TABLE)
        .map_err(|_| StoreError::Unavailable)?;
    commit(&mut c, state, owner, digest, bytes).map_err(|(status, _)| {
        if status == StatusCode::INSUFFICIENT_STORAGE {
            StoreError::Full
        } else {
            StoreError::Unavailable
        }
    })
}

async fn serve(
    State(state): State<AppState>,
    Path(digest): Path<String>,
    request: Request,
) -> Response {
    match transfer(state, digest, request).await {
        Ok(response) => response,
        Err((status, error)) => (status, Json(json!({"error":error}))).into_response(),
    }
}
async fn transfer(state: AppState, digest: String, request: Request) -> Result<Response, Failure> {
    let mutation = request.method() == Method::PUT;
    let owner = owner(state.clone(), request.headers().clone(), mutation).await?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|v| v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
    {
        return Err(INVALID);
    }
    let permit = admit(&owner)?;
    let upload = if mutation {
        if request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            != Some("application/octet-stream")
        {
            return Err((StatusCode::UNSUPPORTED_MEDIA_TYPE, "Send the file bytes."));
        }
        Some(
            tokio::time::timeout(
                Duration::from_secs(120),
                to_bytes(request.into_body(), MAX_FILE),
            )
            .await
            .map_err(|_| (StatusCode::REQUEST_TIMEOUT, "Try this file transfer again."))?
            .map_err(|_| (StatusCode::PAYLOAD_TOO_LARGE, "Choose a file up to 16 MiB."))?,
        )
    } else {
        None
    };
    let response_digest = digest.clone();
    // Keep admission in the worker if a browser disconnects during a durable write.
    let (bytes, size, permit) = tokio::task::spawn_blocking(move || {
        let path = state.event_store_path.as_deref().ok_or(UNAVAILABLE)?;
        let mut c = crate::open_event_store(path).map_err(|_| UNAVAILABLE)?;
        c.execute_batch(ASSETS_TABLE).map_err(|_| UNAVAILABLE)?;
        let (bytes, size) = if let Some(bytes) = upload {
            (None, commit(&mut c, &state, &owner, &digest, &bytes)?)
        } else {
            let size: u64 = c
                .query_row(
                    "SELECT size FROM authoring_assets WHERE owner=? AND sha256=?",
                    params![owner, digest],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| UNAVAILABLE)?
                .ok_or(MISSING)?;
            let store =
                PrivateAssetStore::new(&state.generated_asset_dir, &owner).map_err(storage)?;
            let bytes = store.read(&digest).map_err(storage)?.ok_or(UNAVAILABLE)?;
            if bytes.len() as u64 != size {
                return Err(UNAVAILABLE);
            }
            (Some(bytes), size)
        };
        Ok((bytes, size, permit))
    })
    .await
    .map_err(|_| UNAVAILABLE)??;
    let Some(bytes) = bytes else {
        return Ok(Json(json!({"sha256":response_digest,"size":size})).into_response());
    };
    // Bound slow reads too: the permit lives with the response body until it drains.
    let stream =
        futures_util::stream::unfold((bytes, 0, permit), |(bytes, offset, permit)| async move {
            if offset == bytes.len() {
                return None;
            }
            let end = (offset + 64 * 1024).min(bytes.len());
            let chunk = Bytes::copy_from_slice(&bytes[offset..end]);
            Some((Ok::<_, std::io::Error>(chunk), (bytes, end, permit)))
        });
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_DISPOSITION, "attachment".to_string()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
            (header::CONTENT_LENGTH, size.to_string()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}

#[cfg(test)]
#[path = "card_authoring_assets_tests.rs"]
mod tests;
