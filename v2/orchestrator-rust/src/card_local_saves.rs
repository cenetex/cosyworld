//! Atomic local save files with a previous copy and revision checks.
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
struct Store {
    root: PathBuf,
    lock: Arc<Mutex<()>>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct Saved {
    revision: u64,
    save: Option<String>,
}

#[derive(Deserialize)]
struct Update {
    revision: u64,
    save: String,
}

pub(super) fn router(root: PathBuf) -> Router {
    Router::new()
        .route("/card-game/local/saves/{slot}", get(load).put(save))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(Store {
            root,
            lock: Arc::new(Mutex::new(())),
        })
}

fn path(store: &Store, slot: &str) -> Result<PathBuf, String> {
    if slot.is_empty()
        || slot.len() > 160
        || !slot
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
    {
        return Err("Choose a saved table.".into());
    }
    Ok(store
        .root
        .join(format!("{:x}.json", Sha256::digest(slot.as_bytes()))))
}

fn read(path: &std::path::Path) -> Result<Saved, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "The saved file needs recovery.".into())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Saved::default()),
        Err(_) => Err("The save folder needs another try.".into()),
    }
}

async fn load(State(store): State<Store>, Path(slot): Path<String>) -> Response {
    match tokio::task::spawn_blocking(move || {
        let _guard = store.lock.lock().map_err(|_| "The save folder is busy.")?;
        read(&path(&store, &slot)?)
    })
    .await
    {
        Ok(Ok(saved)) => Json(saved).into_response(),
        _ => failure(),
    }
}

async fn save(
    State(store): State<Store>,
    Path(slot): Path<String>,
    Json(input): Json<Update>,
) -> Response {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&input.save) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !value.is_object() || value["schema"].as_u64().is_none() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match tokio::task::spawn_blocking(move || write(&store, &slot, input)).await {
        Ok(Ok((status, saved))) => (status, Json(saved)).into_response(),
        _ => failure(),
    }
}

fn write(store: &Store, slot: &str, input: Update) -> Result<(StatusCode, Saved), String> {
    let _guard = store.lock.lock().map_err(|_| "The save folder is busy.")?;
    let path = path(store, slot)?;
    let current = read(&path)?;
    if current.save.as_deref() == Some(&input.save) {
        return Ok((StatusCode::OK, current));
    }
    if input.revision != current.revision {
        return Ok((StatusCode::CONFLICT, current));
    }
    let saved = Saved {
        revision: current
            .revision
            .checked_add(1)
            .ok_or("The save needs a new slot.")?,
        save: Some(input.save),
    };
    fs::create_dir_all(&store.root).map_err(|_| "The save folder needs another try.")?;
    let bytes = serde_json::to_vec(&saved).map_err(|_| "The save needs another try.")?;
    let temporary = path.with_extension("pending");
    let mut file =
        fs::File::create(&temporary).map_err(|_| "The save folder needs another try.")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "The save needs another try.")?;
    if path.exists() {
        fs::copy(&path, path.with_extension("previous.json"))
            .map_err(|_| "The previous save needs another try.")?;
    }
    fs::rename(&temporary, &path).map_err(|_| "The save needs another try.")?;
    Ok((StatusCode::OK, saved))
}

fn failure() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error":"The local save needs another try. Keep this window open."})),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn files_survive_a_new_router_and_reject_stale_writers() {
        let root = std::env::temp_dir().join(format!("cosy-local-save-{}", rand::random::<u64>()));
        let slot = "/card-game/local/saves/cosyworld.reflected-shore.v1";
        let update = |revision, turn| {
            Request::builder()
                .uri(slot)
                .method("PUT")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"revision":revision,"save":json!({"schema":7,"turn":turn}).to_string()})
                        .to_string(),
                ))
                .unwrap()
        };
        let first = router(root.clone()).oneshot(update(0, 1)).await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        let second = router(root.clone()).oneshot(update(1, 2)).await.unwrap();
        assert_eq!(second.status(), StatusCode::OK);
        let stale = router(root.clone()).oneshot(update(0, 3)).await.unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
        let response = router(root.clone())
            .oneshot(Request::builder().uri(slot).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let saved: Saved =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&saved.save.unwrap()).unwrap()["turn"],
            2
        );
        let previous = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .find(|e| e.file_name().to_string_lossy().ends_with("previous.json"))
            .unwrap();
        let old: Saved = serde_json::from_slice(&fs::read(previous.path()).unwrap()).unwrap();
        assert_eq!(old.revision, 1);
        fs::remove_dir_all(root).unwrap();
    }
}
