use crate::{
    generated_asset_budget::GeneratedAssetWriteGuard, routes::draw_void_portrait, AppState,
};
use axum::{
    extract::{Path as RoutePath, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub(super) const ROUTE: &str = "/card-game/shared/worlds/{id}/elysium-portrait";
const REWARD: &str = "elysium-gold-spiral";
const DIRECTORY: &str = "elysium-void-001";
const LEASE: &str = ".elysium-void-001.lock";
const INCOMING: &str = ".elysium-void-001.incoming";
const RETRY_AFTER: Duration = Duration::from_secs(300);
const MAX_BYTES: u64 = 8 * 1024 * 1024;

pub(super) fn eligible(world: &Value) -> bool {
    world["opened"][REWARD]
        .as_array()
        .is_some_and(|people| !people.is_empty())
}

pub(super) fn returned(database: &Connection, id: &str) -> rusqlite::Result<bool> {
    database.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_full_plays p, json_each(p.narrative,'$.events') e
          WHERE p.world=? AND p.room='elysium-void-001' AND json_extract(e.value,'$.kind')='action'
            AND json_extract(e.value,'$.actorId')=json_extract(p.command,'$.actor')
            AND json_extract(e.value,'$.locationId')=p.room
            AND json_extract(e.value,'$.verb')='drop'
            AND json_extract(e.value,'$.itemId')='elysium-keystone'
            AND coalesce(json_extract(e.value,'$.generated'),0)=0)",
        [id],
        |row| row.get(0),
    )
}

fn portrait_path(root: &Path) -> io::Result<Option<PathBuf>> {
    let entries = match fs::read_dir(root.join(DIRECTORY)) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let sha = name.to_str().and_then(|name| name.strip_suffix(".png"));
        if sha.is_some_and(|sha| {
            sha.len() == 64
                && sha
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) && entry.file_type()?.is_file()
        {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn claim(root: &Path, now: SystemTime) -> io::Result<Option<File>> {
    fs::create_dir_all(root)?;
    if !fs::symlink_metadata(root)?.is_dir() {
        return Err(io::Error::other("generated asset root must be a directory"));
    }
    let mut lease = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(LEASE))?;
    match lease.try_lock() {
        Ok(()) => (),
        Err(TryLockError::WouldBlock) => return Ok(None),
        Err(TryLockError::Error(error)) => return Err(error),
    }
    let clock = lease.metadata()?;
    if portrait_path(root)?.is_some()
        || (clock.len() > 0
            && now.duration_since(clock.modified()?).unwrap_or_default() < RETRY_AFTER)
    {
        return Ok(None);
    }
    lease.write_all(b"1")?;
    lease.sync_data()?;
    Ok(Some(lease))
}

fn publish(root: &Path, bytes: &[u8], _lease: File) -> io::Result<()> {
    let incoming = root.join(INCOMING);
    if let Err(error) = fs::remove_file(&incoming) {
        if error.kind() != io::ErrorKind::NotFound {
            return Err(error);
        }
    }
    let _budget =
        GeneratedAssetWriteGuard::acquire(root, bytes.len() as u64).map_err(io::Error::other)?;
    let directory = root.join(DIRECTORY);
    fs::create_dir_all(&directory)?;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&incoming)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&incoming, directory.join(format!("{}.png", sha(bytes))))?;
        File::open(directory)?.sync_all()?;
        File::open(root)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(incoming);
    }
    result
}

pub(super) fn draw(state: AppState) {
    if state.ai_config.is_some() {
        tokio::spawn(async move {
            if let Err(error) = draw_pending(&state).await {
                tracing::warn!(%error, "Elysium portrait is still pending");
            }
        });
    }
}

async fn draw_pending(state: &AppState) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let root = state.generated_asset_dir.clone();
    let lease = tokio::task::spawn_blocking(move || claim(&root, SystemTime::now())).await??;
    if let Some(lease) = lease {
        let bytes = draw_void_portrait(state).await.map_err(io::Error::other)?;
        let root = state.generated_asset_dir.clone();
        tokio::task::spawn_blocking(move || publish(&root, &bytes, lease)).await??;
    }
    Ok(())
}

fn ready_bytes(state: &AppState, id: &str, headers: &HeaderMap) -> Result<Vec<u8>, StatusCode> {
    super::valid_id(id).map_err(|_| StatusCode::NOT_FOUND)?;
    let account = super::user(state, headers, false).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let database = state
        .event_store_path
        .as_deref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let connection = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let snapshot = connection
        .unchecked_transaction()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    crate::account_revision::Revision::capture(&snapshot, &account, headers)
        .map_err(|error| error.parts().0)?;
    let member = super::super::store::member(&snapshot, id, &account)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if member.is_none() || !returned(&snapshot, id).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)? {
        return Err(StatusCode::NOT_FOUND);
    }
    drop(snapshot);
    let path = portrait_path(&state.generated_asset_dir)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .ok_or(StatusCode::NOT_FOUND)?;
    let mut bytes = Vec::new();
    File::open(&path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    if bytes.len() as u64 > MAX_BYTES
        || path.file_stem().and_then(|v| v.to_str()) != Some(&sha(&bytes))
    {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }
    Ok(bytes)
}

pub(super) async fn portrait(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<String>,
    headers: HeaderMap,
) -> Response {
    let result = tokio::task::spawn_blocking(move || ready_bytes(&state, &id, &headers)).await;
    let mut response = match result {
        Ok(Ok(bytes)) => ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        Ok(Err(status)) => status.into_response(),
        Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    response
}

#[cfg(test)]
mod tests {
    use super::super::{db, now, store, take_work, World};
    use super::*;
    use rusqlite::params;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn committed_return_readies_one_portrait_for_the_returning_world() {
        let root = std::env::temp_dir().join(format!("elysium-portrait-{}", crate::random_hex(8)));
        fs::create_dir(&root).unwrap();
        let mut state = crate::test_app_state(Some(root.join("world.sqlite")));
        state.generated_asset_dir = Arc::new(root.join("generated"));
        let c = db(&state).unwrap();
        let (world, imported) = ("a".repeat(48), "b".repeat(48));
        c.execute("INSERT INTO auth_users(id,username,display_name,status,created_at_unix,updated_at_unix) VALUES('owner','owner','owner','active',0,0)", []).unwrap();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            state.account_auth.test_session("owner").parse().unwrap(),
        );
        store::schema(&c).unwrap();
        let mut save = World::seeded(None, Some(17)).unwrap();
        save.game.as_object_mut().unwrap().remove("opening");
        save.game["actors"]["vale"]["place"] = json!("elysium-void-001");
        save.game["items"]["elysium-keystone"]["holder"] = json!("vale");
        for (id, opened) in [(&world, Value::Null), (&imported, json!(["vale"]))] {
            super::super::super::store::create(&c, id, "owner", now()).unwrap();
            c.execute(
                "INSERT INTO card_members(world,actor,user,seen) VALUES(?,0,'owner',?)",
                params![id, now()],
            )
            .unwrap();
            let mut initial = save.clone();
            if !opened.is_null() {
                initial.game["opened"][REWARD] = opened;
            }
            store::seed(&c, id, &initial, "portrait test", now()).unwrap();
        }
        for op in ["claim", "enter"] {
            store::commit(
                &c,
                &world,
                &mut save,
                json!({"op":op,"actor":"vale"}),
                now(),
            )
            .unwrap();
        }
        store::enqueue(
            &c,
            &world,
            "owner",
            &save,
            0,
            store::PlayRequest {
                action: json!("drop:vale:elysium-keystone:elysium-void-001"),
                key: "fixture-elysium-play",
                revealed: None,
                surface: "browser",
            },
            now(),
        )
        .unwrap();
        assert!(
            take_work(&state, &world)
                .unwrap()
                .unwrap()
                .portrait_eligible
        );
        assert_eq!(
            ready_bytes(&state, &world, &headers),
            Err(StatusCode::NOT_FOUND)
        );
        assert!(!state.generated_asset_dir.exists());

        let lease = claim(&state.generated_asset_dir, SystemTime::now())
            .unwrap()
            .unwrap();
        let next = SystemTime::now() + RETRY_AFTER + Duration::from_secs(1);
        assert!(claim(&state.generated_asset_dir, next).unwrap().is_none());
        drop(lease);
        assert!(claim(&state.generated_asset_dir, SystemTime::now())
            .unwrap()
            .is_none());
        let lease = claim(&state.generated_asset_dir, next).unwrap().unwrap();
        let figure = b"test portrait";
        publish(&state.generated_asset_dir, figure, lease).unwrap();
        assert!(claim(&state.generated_asset_dir, next).unwrap().is_none());
        assert_eq!(
            ready_bytes(&state, &imported, &headers),
            Err(StatusCode::NOT_FOUND)
        );
        c.execute("DELETE FROM card_full_checkpoints WHERE world=?", [&world])
            .unwrap();
        assert_eq!(ready_bytes(&state, &world, &headers).unwrap(), figure);
        drop((state, c));
        fs::remove_dir_all(root).unwrap();
    }
}
