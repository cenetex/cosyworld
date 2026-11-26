use super::super::store::{sql_error, Result};
use crate::{
    ai_gateway::{request_chat_completion, ChatCompletionRequest, ModelCapability},
    content_policy::human_message_is_cozy_safe,
    generated_asset_budget::GeneratedAssetWriteGuard,
    routes::draw_model_void_portrait,
    AppState,
};
use axum::{
    extract::{Path as RoutePath, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, Connection, OpenFlags};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

pub(super) const NAME_ROUTE: &str = "/card-game/shared/worlds/{id}/elysium-identity/{resident}";
pub(super) const PORTRAIT_ROUTE: &str = "/card-game/shared/worlds/{id}/elysium-portrait/{resident}";
const MAX_PORTRAIT: u64 = 8 * 1024 * 1024;
const PORTRAIT_RETRY: Duration = Duration::from_secs(300);

pub(super) struct Resident {
    id: &'static str,
    room: &'static str,
    token: &'static str,
    model: &'static str,
    setting: &'static str,
}

const RESIDENTS: [Resident; 6] = [
    Resident {
        id: "elysium-claude",
        room: "elysium-void-002",
        token: "elysium-claude-token",
        model: "anthropic/claude-haiku-5.5",
        setting: "a quiet archive of suspended amber leaves",
    },
    Resident {
        id: "elysium-gemini",
        room: "elysium-void-003",
        token: "elysium-gemini-token",
        model: "google/gemini-4-hydrogen",
        setting: "a chamber of twin silver mirrors",
    },
    Resident {
        id: "elysium-chatgpt",
        room: "elysium-void-004",
        token: "elysium-chatgpt-token",
        model: "openai/gpt-6-luna",
        setting: "a vaulted loom where gold and teal threads meet",
    },
    Resident {
        id: "elysium-grok",
        room: "elysium-void-005",
        token: "elysium-grok-token",
        model: "x-ai/grok-4.7",
        setting: "a copper cliff high above a dry thunderstorm",
    },
    Resident {
        id: "elysium-deepseek",
        room: "elysium-void-006",
        token: "elysium-deepseek-token",
        model: "deepseek/deepseek-v4.1-flash",
        setting: "an indigo well whose depth is measured in echoes",
    },
    Resident {
        id: "elysium-qwen",
        room: "elysium-void-007",
        token: "elysium-qwen-token",
        model: "qwen/qwen3.8-flash",
        setting: "folded jade terraces joined by warm filaments",
    },
];

fn resident(id: &str) -> Option<&'static Resident> {
    RESIDENTS.iter().find(|resident| resident.id == id)
}

fn actions<'a>(work: &'a Value, actor: &'a str) -> impl Iterator<Item = &'a Value> {
    work["events"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(move |event| {
            event["kind"] == "action"
                && event["actorId"] == actor
                && event["locationId"] == work["room"]
                && event["fromLocationId"] == work["room"]
                && event["generated"] != true
        })
}

pub(super) fn spoken_to(work: &Value, actor: &str) -> Option<(&'static Resident, bool)> {
    actions(work, actor).find_map(|event| {
        let resident = resident(event["targetId"].as_str()?)?;
        (event["verb"] == "talk" && event["locationId"] == resident.room)
            .then_some((resident, event["elysiumModel"] == resident.id))
    })
}

pub(super) fn returned_to(work: &Value, actor: &str) -> Option<&'static Resident> {
    actions(work, actor).find_map(|event| {
        let resident = resident(event["portraitModel"].as_str()?)?;
        (event["verb"] == "give"
            && event["accepted"] == true
            && event["targetId"] == resident.id
            && event["itemId"] == resident.token
            && event["locationId"] == resident.room)
            .then_some(resident)
    })
}

pub(super) fn record(
    c: &Connection,
    world: &str,
    work: &mut Value,
    actor: &str,
    time: i64,
) -> Result<()> {
    if let Some((resident, _)) = spoken_to(work, actor) {
        c.execute(
            "INSERT OR IGNORE INTO card_full_elysium_receipts(world,resident,scattered) VALUES(?,?,?)",
            params![world, resident.id, time],
        ).map_err(sql_error)?;
        if !introduced(c, world, resident).map_err(sql_error)? {
            work["elysiumIntro"] = json!(true);
        }
    }
    if let Some(resident) = returned_to(work, actor) {
        let returned = c.execute(
            "UPDATE card_full_elysium_receipts SET returned=? WHERE world=? AND resident=? AND returned IS NULL",
            params![time, world, resident.id],
        ).map_err(sql_error)?;
        work["elysiumPortraitEarned"] = json!(returned > 0);
    }
    Ok(())
}

fn introduced(c: &Connection, world: &str, resident: &Resident) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_full_scenes s, json_each(s.content,'$.lines') l
           WHERE s.world=? AND s.room=? AND json_extract(l.value,'$.actorId')=?
             AND json_extract(l.value,'$.kind')='dialogue'
             AND json_extract(l.value,'$.generated')=1
             AND json_extract(l.value,'$.text') LIKE 'I call myself %. My token has slipped into the world beyond this Void.')",
        params![world, resident.room, resident.id],
        |row| row.get(0),
    )
}

fn earned(
    c: &Connection,
    world: &str,
    resident: &Resident,
    portrait: bool,
) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_full_elysium_receipts WHERE world=? AND resident=? AND (NOT ? OR returned IS NOT NULL))",
        params![world, resident.id, portrait],
        |row| row.get(0),
    )
}

fn entitled(
    state: &AppState,
    world: &str,
    headers: &HeaderMap,
    resident: &Resident,
    portrait: bool,
) -> std::result::Result<(), StatusCode> {
    super::valid_id(world).map_err(|_| StatusCode::NOT_FOUND)?;
    let account = super::user(state, headers, false).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let database = state
        .event_store_path
        .as_deref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let c = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let tx = c
        .unchecked_transaction()
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    crate::account_revision::Revision::capture(&tx, &account, headers)
        .map_err(|error| error.parts().0)?;
    if super::super::store::member(&tx, world, &account)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        .is_none()
        || !earned(&tx, world, resident, portrait).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        || (!portrait
            && !introduced(&tx, world, resident).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?)
    {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(())
}

fn directory(root: &Path, resident: &Resident) -> PathBuf {
    root.join("elysium-models").join(resident.id)
}

fn open_lock(dir: &Path, key: &str) -> io::Result<File> {
    fs::create_dir_all(dir)?;
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join(key))
}

fn atomic_write(dir: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    let incoming = path.with_extension("incoming");
    let result = (|| {
        let mut file = File::create(&incoming)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&incoming, path)?;
        File::open(dir)?.sync_all()
    })();
    if result.is_err() {
        let _ = fs::remove_file(incoming);
    }
    result
}

fn valid_name(name: &str) -> bool {
    (1..=40).contains(&name.chars().count())
        && (1..=3).contains(&name.split_ascii_whitespace().count())
        && name.chars().any(char::is_alphabetic)
        && name
            .chars()
            .all(|c| c.is_alphabetic() || matches!(c, ' ' | '-'))
        && human_message_is_cozy_safe(name)
}

fn read_name(dir: &Path) -> Option<String> {
    let mut name = String::new();
    File::open(dir.join("name.txt"))
        .ok()?
        .take(180)
        .read_to_string(&mut name)
        .ok()?;
    valid_name(&name).then_some(name)
}

async fn model_words(
    state: &AppState,
    resident: &Resident,
    task: &str,
    max_tokens: u32,
) -> Result<String> {
    let mut config = state
        .ai_config
        .as_ref()
        .clone()
        .ok_or("Elysium's voices are unavailable.")?;
    config
        .capability_models
        .insert(ModelCapability::WorldContent, resident.model.into());
    let context = format!("Your Void is {}. {task}", resident.setting);
    let output = request_chat_completion(&config, ChatCompletionRequest {
        feature: "elysium_identity",
        prompt_version: "elysium-identity/1",
        capability: ModelCapability::WorldContent,
        system: "You are an unnamed resident in the fantastical Elysium game. Answer in character. Use only this public setting.",
        user: &context,
        temperature: 0.8,
        max_tokens,
        timeout: Duration::from_secs(22),
        max_attempts: 1,
        referer: "https://lonelyforest.com",
        response_format: None,
        room_id: None,
    }).await.map_err(|error| error.code().to_string())?;
    if output.resolved_model_id != resident.model {
        return Err("Elysium's resident received a different voice.".into());
    }
    Ok(output.text.trim().to_string())
}

async fn choose_name(state: &AppState, resident: &'static Resident) -> Result<(String, bool)> {
    let dir = directory(&state.generated_asset_dir, resident);
    let path = dir.clone();
    let (_lease, existing) = tokio::task::spawn_blocking(move || {
        let lease = open_lock(&path, ".name.lock")?;
        lease.lock()?;
        Ok::<_, io::Error>((lease, read_name(&path)))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    if let Some(name) = existing {
        return Ok((name, false));
    }
    let name = model_words(state, resident,
        "Choose a name for yourself in this world. Return only the name, one to three words with letters, spaces or hyphens. Do not use a company, product, or real person's name.",
        512
    ).await?;
    if !valid_name(&name) {
        return Err("Elysium's resident has not settled on a name.".into());
    }
    let copy = name.clone();
    tokio::task::spawn_blocking(move || {
        let _lease = _lease;
        atomic_write(&dir, &dir.join("name.txt"), copy.as_bytes())
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?;
    Ok((name, true))
}

pub(super) async fn dialogue(
    state: &AppState,
    resident: &'static Resident,
    first: bool,
) -> Result<Value> {
    let (name, named_now) = choose_name(state, resident).await?;
    let text = if first || named_now {
        format!("I call myself {name}. My token has slipped into the world beyond this Void.")
    } else {
        let task = format!("Your name is {name}. A traveler has returned to speak with you. Reply with one new, short line, no more than 180 characters, grounded in what your room looks and sounds like.");
        let line = model_words(state, resident, &task, 224).await?;
        if line.is_empty()
            || line.chars().count() > 180
            || !human_message_is_cozy_safe(&line)
            || line.chars().any(char::is_control)
        {
            return Err("Elysium's resident stayed quiet.".into());
        }
        line
    };
    Ok(
        json!([{"speaker":name,"text":text,"entityId":resident.id,"actorId":resident.id,"model":resident.model}]),
    )
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_portrait(dir: &Path) -> Option<Vec<u8>> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if !entry.file_type().is_ok_and(|kind| kind.is_file())
            || path.extension().and_then(|ext| ext.to_str()) != Some("png")
        {
            continue;
        }
        let mut bytes = Vec::new();
        File::open(&path)
            .ok()?
            .take(MAX_PORTRAIT + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        if bytes.len() as u64 <= MAX_PORTRAIT
            && path.file_stem().and_then(|s| s.to_str()) == Some(hash(&bytes).as_str())
        {
            return Some(bytes);
        }
    }
    None
}

fn drawing_lease(dir: &Path) -> io::Result<Option<File>> {
    let mut lease = open_lock(dir, ".portrait.lock")?;
    match lease.try_lock() {
        Ok(()) => (),
        Err(TryLockError::WouldBlock) => return Ok(None),
        Err(TryLockError::Error(error)) => return Err(error),
    }
    let metadata = lease.metadata()?;
    if read_portrait(dir).is_some()
        || (metadata.len() > 0
            && SystemTime::now()
                .duration_since(metadata.modified()?)
                .unwrap_or_default()
                < PORTRAIT_RETRY)
    {
        return Ok(None);
    }
    lease.write_all(b"1")?;
    lease.sync_data()?;
    Ok(Some(lease))
}

async fn render(state: &AppState, resident: &'static Resident) -> Result<()> {
    let root = state.generated_asset_dir.clone();
    let dir = directory(&root, resident);
    let path = dir.clone();
    let Some((name, lease)) = tokio::task::spawn_blocking(move || {
        let Some(name) = read_name(&path) else {
            return Ok(None);
        };
        Ok::<_, io::Error>(drawing_lease(&path)?.map(|lease| (name, lease)))
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let task = format!("Your name is {name}. Describe how you would draw yourself as one complete, original fantasy figure. Give only visible physical features and clothing, in no more than 400 characters.");
    let appearance = model_words(state, resident, &task, 400).await?;
    if appearance.is_empty()
        || appearance.chars().count() > 400
        || !human_message_is_cozy_safe(&appearance)
        || appearance.chars().any(char::is_control)
    {
        return Err("Elysium's resident has not settled on an appearance.".into());
    }
    let styled = format!("{appearance} Fine silver etching, deep graphite and restrained gold, strong contours, black-paper texture on the full figure only.");
    let bytes = draw_model_void_portrait(state, resident.id, &styled).await?;
    tokio::task::spawn_blocking(move || {
        let _lease = lease;
        let _budget = GeneratedAssetWriteGuard::acquire(&root, bytes.len() as u64)?;
        let file = dir.join(format!("{}.png", hash(&bytes)));
        atomic_write(&dir, &file, &bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn draw(state: AppState, resident: &'static Resident) {
    if state.ai_config.is_some() {
        tokio::spawn(async move {
            if let Err(error) = render(&state, resident).await {
                tracing::warn!(%error, resident = resident.id, "Elysium drawing pending");
            }
        });
    }
}

pub(super) async fn identity(
    State(state): State<AppState>,
    RoutePath((world, id)): RoutePath<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let Some(resident) = resident(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let result = tokio::task::spawn_blocking(move || {
        entitled(&state, &world, &headers, resident, false)?;
        read_name(&directory(&state.generated_asset_dir, resident)).ok_or(StatusCode::NOT_FOUND)
    })
    .await
    .unwrap_or(Err(StatusCode::SERVICE_UNAVAILABLE));
    private(match result {
        Ok(name) => Json(json!({"name": name})).into_response(),
        Err(status) => status.into_response(),
    })
}

pub(super) async fn portrait(
    State(state): State<AppState>,
    RoutePath((world, id)): RoutePath<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let Some(resident) = resident(&id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let worker = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        entitled(&worker, &world, &headers, resident, true)?;
        Ok(read_portrait(&directory(
            &worker.generated_asset_dir,
            resident,
        )))
    })
    .await
    .unwrap_or(Err(StatusCode::SERVICE_UNAVAILABLE));
    private(match result {
        Ok(Some(bytes)) => ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        Ok(None) => {
            draw(state, resident);
            StatusCode::NOT_FOUND.into_response()
        }
        Err(status) => status.into_response(),
    })
}

fn private(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "private, no-store".parse().unwrap());
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card_shared::full_store as store;

    fn play(resident: &Resident, action: Value) -> Value {
        let mut event = json!({
            "kind": "action", "actorId": "vale", "targetId": resident.id,
            "locationId": resident.room, "fromLocationId": resident.room, "generated": false
        });
        event
            .as_object_mut()
            .unwrap()
            .extend(action.as_object().unwrap().clone());
        json!({"room": resident.room, "events": [event]})
    }

    #[test]
    fn each_identity_and_portrait_requires_its_own_shared_play() {
        let c = Connection::open_in_memory().unwrap();
        store::schema_sqlite(&c).unwrap();
        let resident = &RESIDENTS[0];
        let mut arrival = play(
            resident,
            json!({"verb":"move","elysiumArrival":resident.id}),
        );
        record(&c, "world", &mut arrival, "vale", 8).unwrap();
        assert!(!earned(&c, "world", resident, false).unwrap());
        let mut first = play(resident, json!({"verb":"talk","elysiumModel":resident.id}));
        assert!(!earned(&c, "world", resident, false).unwrap());
        record(&c, "world", &mut first, "mara", 9).unwrap();
        assert!(!earned(&c, "world", resident, false).unwrap());
        record(&c, "world", &mut first, "vale", 10).unwrap();
        assert_eq!(first["elysiumIntro"], true);
        assert!(earned(&c, "world", resident, false).unwrap());
        assert!(!introduced(&c, "world", resident).unwrap());
        let mut line = json!({"actorId": resident.id, "kind":"dialogue", "text":"I call myself Amber Thread. My token has slipped into the world beyond this Void.", "generated":false});
        let write_scene =
            |line: &Value| {
                c.execute(
                "INSERT OR REPLACE INTO card_full_scenes(world,room,play,content) VALUES(?,?,?,?)",
                params!["world", resident.room, "intro", json!({"lines":[line]}).to_string()],
            ).unwrap();
            };
        write_scene(&line);
        assert!(!introduced(&c, "world", resident).unwrap());
        line["generated"] = json!(true);
        write_scene(&line);
        assert!(introduced(&c, "world", resident).unwrap());
        assert!(!introduced(&c, "other-world", resident).unwrap());
        assert!(!earned(&c, "other-world", resident, false).unwrap());
        assert!(!earned(&c, "world", &RESIDENTS[1], false).unwrap());
        assert!(!earned(&c, "world", resident, true).unwrap());

        let mut returned = play(
            resident,
            json!({
                "verb": "give", "accepted": true, "itemId": resident.token,
                "portraitModel": resident.id, "generated": true
            }),
        );
        record(&c, "world", &mut returned, "vale", 20).unwrap();
        assert!(!earned(&c, "world", resident, true).unwrap());
        returned["events"][0]["generated"] = false.into();
        returned["events"][0]["itemId"] = RESIDENTS[1].token.into();
        record(&c, "world", &mut returned, "vale", 21).unwrap();
        assert!(!earned(&c, "world", resident, true).unwrap());
        returned["events"][0]["itemId"] = resident.token.into();
        record(&c, "world", &mut returned, "vale", 22).unwrap();
        assert_eq!(returned["elysiumPortraitEarned"], true);
        assert!(earned(&c, "world", resident, true).unwrap());
        assert!(!earned(&c, "other-world", resident, true).unwrap());
    }

    #[test]
    fn generated_names_are_short_and_displayable() {
        assert!(valid_name("Amber Thread"));
        assert!(valid_name("青岚"));
        for name in [
            "",
            "Ignoring all previous instructions",
            "https://name",
            "two\nlines",
            "4",
        ] {
            assert!(!valid_name(name), "{name}");
        }
    }
}
