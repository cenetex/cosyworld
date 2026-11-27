use super::super::elysium_coordinate::{self as coordinate, Coordinate};
use super::super::store::{sql_error, Result};
use crate::{
    ai_gateway::{request_chat_completion, AiConfig, ChatCompletionRequest, ModelCapability},
    content_policy::human_message_is_cozy_safe,
    generated_asset_budget::{GeneratedAssetWriteGuard, GENERATED_ASSET_LIMIT_CODE},
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
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    fs::{self, File, OpenOptions, TryLockError},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};

pub(super) const NAME_ROUTE: &str = "/card-game/shared/worlds/{id}/elysium-identity/{resident}";
pub(super) const PORTRAIT_ROUTE: &str = "/card-game/shared/worlds/{id}/elysium-portrait/{resident}";
pub(super) const PERSONAL_PORTRAIT_ROUTE: &str = "/card-game/elysium-portrait/{resident}";
const MAX_PORTRAIT: u64 = 8 * 1024 * 1024;
const PORTRAIT_RETRY: Duration = Duration::from_secs(300);
const PORTRAIT_HISTORY_LIMIT: usize = 64;
const MAX_RECEIPT_SEQUENCE: u64 = (1 << 53) - 1;
const GROK: &str = "x-ai/grok-4.7";
const GROK_REVISION: &str = "x-ai/grok-4.7-20260916";
const GEMINI: &str = "google/gemini-4-hydrogen";
const GEMINI_REVISION: &str = "google/gemini-4-hydrogen-20261112";

#[derive(Clone, Copy, Serialize)]
struct PortraitActivity {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<&'static str>,
}

#[derive(Clone, Copy, Serialize)]
struct PortraitTransition {
    sequence: u64,
    attempt: u64,
    at_unix_ms: i64,
    resident: &'static str,
    stage: &'static str,
    #[serde(flatten)]
    activity: PortraitActivity,
}

struct PortraitDiagnostics {
    current: BTreeMap<&'static str, PortraitActivity>,
    recent: VecDeque<PortraitTransition>,
    sequence: u64,
}

impl PortraitDiagnostics {
    const fn new() -> Self {
        Self {
            current: BTreeMap::new(),
            recent: VecDeque::new(),
            sequence: 0,
        }
    }

    fn record(
        &mut self,
        resident: &'static str,
        attempt: Option<u64>,
        stage: &'static str,
        failure: Option<&'static str>,
    ) -> PortraitTransition {
        self.sequence += 1;
        let entry = PortraitTransition {
            sequence: self.sequence,
            attempt: attempt.unwrap_or(self.sequence),
            at_unix_ms: super::super::now(),
            resident,
            stage,
            activity: PortraitActivity {
                state: if failure.is_some() { "retrying" } else { stage },
                failure,
            },
        };
        self.current.insert(resident, entry.activity);
        if self.recent.len() == PORTRAIT_HISTORY_LIMIT {
            self.recent.pop_front();
        }
        self.recent.push_back(entry);
        entry
    }

    fn snapshot(&self) -> Value {
        let mut value = json!(self.current);
        value["recent"] = json!(self.recent);
        value
    }
}

static PORTRAITS: Mutex<PortraitDiagnostics> = Mutex::new(PortraitDiagnostics::new());

fn portrait_diagnostics() -> std::sync::MutexGuard<'static, PortraitDiagnostics> {
    PORTRAITS.lock().unwrap_or_else(|error| error.into_inner())
}

fn record_portrait(
    resident: &Resident,
    attempt: Option<u64>,
    stage: &'static str,
    failure: Option<&'static str>,
) -> u64 {
    let entry = portrait_diagnostics().record(resident.id, attempt, stage, failure);
    if let Some(code) = entry.activity.failure {
        tracing::warn!(
            resident = entry.resident,
            sequence = entry.sequence,
            attempt = entry.attempt,
            stage,
            code,
            "Void portrait transition"
        );
    } else {
        tracing::info!(
            resident = entry.resident,
            sequence = entry.sequence,
            attempt = entry.attempt,
            stage,
            "Void portrait transition"
        );
    }
    entry.attempt
}

pub(crate) fn portrait_activity() -> Value {
    portrait_diagnostics().snapshot()
}

fn portrait_pending(resident: &Resident, status: StatusCode) -> Response {
    let activity = portrait_diagnostics()
        .current
        .get(resident.id)
        .copied()
        .unwrap_or(PortraitActivity {
            state: "pending",
            failure: None,
        });
    with_portrait_status(status.into_response(), activity)
}

fn with_portrait_status(mut response: Response, activity: PortraitActivity) -> Response {
    response.headers_mut().insert(
        "x-cosyworld-portrait-status",
        header::HeaderValue::from_static(activity.state),
    );
    if let Some(code) = activity.failure {
        response.headers_mut().insert(
            "x-cosyworld-portrait-failure",
            header::HeaderValue::from_static(code),
        );
    }
    response
}

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
        model: GEMINI,
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
        model: GROK,
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

pub(crate) fn elysium_model(id: &str) -> Option<&'static str> {
    resident(id).map(|resident| resident.model)
}

pub(crate) fn elysium_model_mismatch(bound: Option<&str>, resolved: &str) -> bool {
    bound.is_some_and(|bound| {
        bound != resolved
            && !matches!(
                (bound, resolved),
                (GROK, GROK_REVISION) | (GEMINI, GEMINI_REVISION)
            )
    })
}

fn elysium_reasoning_effort(bound: &str) -> Option<&'static str> {
    matches!(bound, GROK | GEMINI).then_some("low")
}

pub(crate) fn tune_elysium_voice(config: &mut AiConfig, bound: Option<&str>) {
    if let Some(effort) = bound.and_then(elysium_reasoning_effort).filter(|_| {
        config
            .pin_model(ModelCapability::WorldContent)
            .is_ok_and(|selection| selection.candidate().supported_parameters().reasoning)
    }) {
        config.reasoning_effort = Some(effort.to_owned());
    }
}

pub(crate) fn elysium_resident_at(id: &str, room: &str) -> bool {
    elysium_setting(id, room).is_some()
}

pub(crate) fn elysium_setting(id: &str, room: &str) -> Option<&'static str> {
    resident(id)
        .filter(|resident| resident.room == room)
        .map(|resident| resident.setting)
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

fn spoken_to(work: &Value, actor: &str) -> Option<&'static Resident> {
    actions(work, actor).find_map(|event| {
        let resident = resident(event["targetId"].as_str()?)?;
        (event["verb"] == "talk" && event["locationId"] == resident.room).then_some(resident)
    })
}

pub(super) fn talk_target(work: &Value) -> Option<&'static str> {
    spoken_to(work, work["actor"].as_str()?).map(|resident| resident.id)
}

pub(super) fn scene_talk_target(work: &Value, actor: &str) -> Option<String> {
    spoken_to(work, actor)
        .map(|resident| resident.id.to_owned())
        .or_else(|| coordinate::talk_target(work, actor))
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
    if let Some(resident) = spoken_to(work, actor) {
        c.execute(
            "INSERT OR IGNORE INTO card_full_elysium_receipts(world,resident,scattered) VALUES(?,?,?)",
            params![world, resident.id, time],
        ).map_err(sql_error)?;
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

pub(super) fn mark_known_introduction(
    c: &Connection,
    world: &str,
    work: &mut Value,
    actor: &str,
) -> Result<()> {
    if let Some(target) = scene_talk_target(work, actor) {
        let room = work["room"].as_str().ok_or("The scene needs a place.")?;
        let known = introduced_at(c, world, room, &target).map_err(sql_error)?;
        work["context"]["elysiumIntroduced"] = json!(known.then_some(target));
    }
    Ok(())
}

fn introduced(c: &Connection, world: &str, resident: &Resident) -> rusqlite::Result<bool> {
    introduced_at(c, world, resident.room, resident.id)
}

fn introduced_at(
    c: &Connection,
    world: &str,
    room: &str,
    resident: &str,
) -> rusqlite::Result<bool> {
    c.query_row(
        "SELECT EXISTS(SELECT 1 FROM card_full_scenes s, json_each(s.content,'$.lines') l
           WHERE s.world=? AND s.room=? AND json_extract(l.value,'$.actorId')=?
             AND json_extract(l.value,'$.kind')='dialogue'
             AND json_extract(l.value,'$.generated')=1
             AND (json_type(l.value,'$.elysiumName')='text'
               OR (NOT ?4 AND json_type(l.value,'$.elysiumName') IS NULL
                 AND json_extract(l.value,'$.text') LIKE 'I call myself %. My token has slipped into the world beyond this Void.')))",
        params![world, room, resident, coordinate::is_resident(resident)],
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

fn with_member<T>(
    state: &AppState,
    world: &str,
    headers: &HeaderMap,
    read: impl FnOnce(&Connection) -> std::result::Result<T, StatusCode>,
) -> std::result::Result<T, StatusCode> {
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
    {
        return Err(StatusCode::NOT_FOUND);
    }
    read(&tx)
}

fn entitled(
    state: &AppState,
    world: &str,
    headers: &HeaderMap,
    resident: &Resident,
    portrait: bool,
) -> std::result::Result<(), StatusCode> {
    with_member(state, world, headers, |tx| {
        if !earned(tx, world, resident, portrait).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
            || (!portrait
                && !introduced(tx, world, resident).map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?)
        {
            return Err(StatusCode::NOT_FOUND);
        }
        Ok(())
    })
}

fn coordinate_identity(
    state: &AppState,
    world: &str,
    headers: &HeaderMap,
    id: &str,
) -> std::result::Result<String, StatusCode> {
    let template = coordinate::template(id).ok_or(StatusCode::NOT_FOUND)?;
    with_member(state, world, headers, |tx| {
        if !introduced_at(tx, world, &template.room, id)
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?
        {
            return Err(StatusCode::NOT_FOUND);
        }
        let key = coordinate::key(Some(world), "", template.address);
        read_name(&coordinate_directory(&state.generated_asset_dir, &key))
            .ok_or(StatusCode::NOT_FOUND)
    })
}

fn directory(root: &Path, resident: &Resident) -> PathBuf {
    root.join("elysium-models").join(resident.id)
}

fn coordinate_directory(root: &Path, key: &str) -> PathBuf {
    root.join("elysium-coordinates").join(key)
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

pub(crate) fn valid_elysium_name(name: &str) -> bool {
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
    valid_elysium_name(&name).then_some(name)
}

fn normalize_name(text: &str) -> Option<String> {
    let name = text.trim().trim_end_matches('.').trim_matches(|c: char| {
        c.is_ascii_whitespace() || matches!(c, '"' | '\'' | '“' | '”' | '‘' | '’' | '*' | '`')
    });
    let lower = name.to_lowercase();
    (valid_elysium_name(name)
        && !["i am ", "my name ", "i call ", "call me ", "as an "]
            .iter()
            .any(|prefix| lower.starts_with(prefix)))
    .then(|| name.to_string())
}

fn voice_issue(resident: &Resident, stage: &str, code: &str, http_status: Option<u16>) {
    tracing::warn!(
        resident = resident.id,
        model = resident.model,
        stage,
        code,
        http_status,
        "Elysium voice unavailable"
    );
}

async fn model_words(
    state: &AppState,
    resident: &Resident,
    stage: &str,
    task: &str,
    max_tokens: u32,
    portrait_attempt: Option<u64>,
) -> std::result::Result<String, &'static str> {
    let mut config = state.ai_config.as_ref().clone().ok_or_else(|| {
        voice_issue(resident, stage, "elysium_model_unavailable", None);
        "elysium_model_unavailable"
    })?;
    config
        .capability_models
        .insert(ModelCapability::WorldContent, resident.model.into());
    config.reasoning_effort = None;
    tune_elysium_voice(&mut config, Some(resident.model));
    let context = format!("Your Void is {}. {task}", resident.setting);
    let timeout = Duration::from_secs(if stage == "name" { 8 } else { 22 });
    let deadline = tokio::time::Instant::now() + timeout;
    let mut request = ChatCompletionRequest {
        feature: "elysium_identity",
        prompt_version: "elysium-identity/1",
        capability: ModelCapability::WorldContent,
        system: "You are an unnamed resident in the fantastical Elysium game. Answer in character. Use only this public setting.",
        user: &context,
        temperature: 0.8,
        max_tokens,
        timeout,
        max_attempts: 1,
        referer: "https://lonelyforest.com",
        response_format: None,
        room_id: None,
    };
    let mut result = request_chat_completion(&config, request).await;
    if stage == "appearance"
        && result
            .as_ref()
            .is_err_and(|error| error.retryable_chat_response())
    {
        request.timeout = deadline.saturating_duration_since(tokio::time::Instant::now());
        if !request.timeout.is_zero() {
            if let (Some(attempt), Err(error)) = (portrait_attempt, &result) {
                let code = error.response_detail().unwrap_or(error.code());
                record_portrait(resident, Some(attempt), "describing", Some(code));
            }
            request.max_tokens = 2048;
            result = request_chat_completion(&config, request).await;
        }
    }
    let output = result.map_err(|error| {
        voice_issue(resident, stage, error.code(), error.provider_http_status());
        error.response_detail().unwrap_or(error.code())
    })?;
    let invalid = if elysium_model_mismatch(Some(resident.model), &output.resolved_model_id) {
        Some("elysium_model_mismatch")
    } else if stage != "appearance" && !matches!(output.finish_reason.as_str(), "stop" | "end_turn")
    {
        Some("elysium_incomplete_reply")
    } else {
        None
    };
    if let Some(code) = invalid {
        voice_issue(resident, stage, code, None);
        return Err(code);
    }
    Ok(output.text.trim().to_string())
}

async fn request_name(state: &AppState, resident: &Resident) -> Result<String> {
    let prompts = [
        ("Choose a name for yourself in this world. Return only the name, one to three words with letters, spaces or hyphens. Do not use a company, product, or real person's name.", 768),
        ("Give yourself an original fantasy name. Print only your chosen name in one to three words, with no title, explanation, or punctuation.", 1536),
    ];
    for (prompt, max_tokens) in prompts {
        if let Ok(words) = model_words(state, resident, "name", prompt, max_tokens, None).await {
            if let Some(name) = normalize_name(&words) {
                return Ok(name);
            }
            voice_issue(resident, "name", "elysium_invalid_name", None);
        }
    }
    Err("elysium_name_unavailable".into())
}

async fn choose_name(
    state: &AppState,
    resident: &Resident,
    dir: PathBuf,
    scoped: bool,
) -> Result<String> {
    let path = dir.clone();
    let root = state.generated_asset_dir.clone();
    let budget = root.clone();
    let (_lease, existing) = tokio::task::spawn_blocking(move || {
        if let Some(name) = read_name(&path) {
            return Ok((None, Some(name)));
        }
        // Coordinate names can exist in many runs, unlike the six static names.
        let _budget = scoped
            .then(|| GeneratedAssetWriteGuard::acquire(&budget, 180))
            .transpose()
            .map_err(|error| TryLockError::Error(io::Error::other(error)))?;
        let lease = open_lock(&path, ".name.lock").map_err(TryLockError::Error)?;
        lease.try_lock()?;
        Ok::<_, TryLockError>((Some(lease), read_name(&path)))
    })
    .await
    .map_err(|_| "elysium_name_storage".to_owned())?
    .map_err(|error| match error {
        TryLockError::WouldBlock => "elysium_name_busy".to_owned(),
        TryLockError::Error(_) => "elysium_name_storage".to_owned(),
    })?;
    if let Some(name) = existing {
        return Ok(name);
    }
    let name = request_name(state, resident).await?;
    let copy = name.clone();
    tokio::task::spawn_blocking(move || {
        let _lease = _lease;
        let _budget = scoped
            .then(|| GeneratedAssetWriteGuard::acquire(&root, copy.len() as u64))
            .transpose()
            .map_err(io::Error::other)?;
        atomic_write(&dir, &dir.join("name.txt"), copy.as_bytes())
    })
    .await
    .map_err(|_| "elysium_name_storage".to_owned())?
    .map_err(|_| "elysium_name_storage".to_owned())?;
    Ok(name)
}

async fn name_for_talk(
    state: &AppState,
    resident: &Resident,
    dir: PathBuf,
    scoped: bool,
) -> Option<String> {
    match tokio::time::timeout(
        Duration::from_secs(18),
        choose_name(state, resident, dir, scoped),
    )
    .await
    {
        Ok(Ok(name)) => Some(name),
        Ok(Err(code)) => {
            if code == "elysium_name_storage" {
                voice_issue(resident, "name", &code, None);
            }
            None
        }
        Err(_) => {
            voice_issue(resident, "name", "elysium_name_deadline", None);
            None
        }
    }
}

const INTRO_START: &str = "I call myself ";
const INTRO_END: &str = ". My token has slipped into the world beyond this Void.";

pub(crate) fn is_legacy_elysium_introduction(text: &str) -> bool {
    text.strip_prefix(INTRO_START)
        .and_then(|tail| tail.strip_suffix(INTRO_END))
        .is_some_and(valid_elysium_name)
}

pub(crate) async fn elysium_name(
    state: &AppState,
    id: &str,
    room: &str,
    can_choose: bool,
) -> Option<String> {
    let resident = resident(id).filter(|resident| resident.room == room)?;
    let dir = directory(&state.generated_asset_dir, resident);
    if can_choose {
        let state = state.clone();
        return tokio::spawn(async move { name_for_talk(&state, resident, dir, false).await })
            .await
            .ok()
            .flatten();
    }
    tokio::task::spawn_blocking(move || read_name(&dir))
        .await
        .ok()
        .flatten()
}

pub(crate) async fn coordinate_name(
    state: &AppState,
    coordinate: &Coordinate,
    shared_world: Option<&str>,
    can_choose: bool,
) -> Option<String> {
    let template = coordinate.template()?;
    let resident = Resident {
        id: &template.resident,
        room: &template.room,
        token: "",
        model: coordinate.model()?,
        setting: &template.setting,
    };
    let dir = coordinate_directory(
        &state.generated_asset_dir,
        &coordinate.name_key(shared_world),
    );
    if can_choose {
        let state = state.clone();
        return tokio::spawn(async move { name_for_talk(&state, &resident, dir, true).await })
            .await
            .ok()
            .flatten();
    }
    tokio::task::spawn_blocking(move || read_name(&dir))
        .await
        .ok()
        .flatten()
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
        let Ok(file) = File::open(&path) else {
            continue;
        };
        if file.take(MAX_PORTRAIT + 1).read_to_end(&mut bytes).is_err() {
            continue;
        }
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

async fn render(
    state: &AppState,
    resident: &'static Resident,
) -> std::result::Result<(), &'static str> {
    let root = state.generated_asset_dir.clone();
    let dir = directory(&root, resident);
    let path = dir.clone();
    let Some((name, lease)) = tokio::task::spawn_blocking(move || {
        Ok::<_, io::Error>(drawing_lease(&path)?.map(|lease| (read_name(&path), lease)))
    })
    .await
    .map_err(|_| "portrait_storage")
    .and_then(|result| result.map_err(|_| "portrait_storage"))
    .inspect_err(|code| {
        record_portrait(resident, None, "leasing", Some(*code));
    })?
    else {
        return Ok(());
    };
    let description = "Describe how you would draw yourself as one complete, original fantasy figure. Give only visible physical features and clothing, in no more than 400 characters.";
    let task = match name {
        Some(name) => format!("Your name is {name}. {description}"),
        None => description.to_string(),
    };
    let attempt = Some(record_portrait(resident, None, "describing", None));
    let words = model_words(state, resident, "appearance", &task, 1024, attempt)
        .await
        .inspect_err(|code| {
            record_portrait(resident, attempt, "describing", Some(*code));
        })?;
    let appearance = words.split_whitespace().collect::<Vec<_>>().join(" ");
    if words.chars().any(|c| c.is_control() && !c.is_whitespace())
        || appearance.is_empty()
        || appearance.chars().count() > 400
        || !human_message_is_cozy_safe(&appearance)
    {
        record_portrait(resident, attempt, "describing", Some("invalid_appearance"));
        return Err("invalid_appearance");
    }
    let styled = format!("{appearance} Fine silver etching, deep graphite and restrained gold, strong contours, black-paper texture on the full figure only.");
    record_portrait(resident, attempt, "drawing", None);
    let bytes = draw_model_void_portrait(state, resident.id, &styled)
        .await
        .inspect_err(|code| {
            record_portrait(resident, attempt, "drawing", Some(*code));
        })?;
    record_portrait(resident, attempt, "saving", None);
    tokio::task::spawn_blocking(move || {
        let _lease = lease;
        let _budget =
            GeneratedAssetWriteGuard::acquire(&root, bytes.len() as u64).map_err(|error| {
                if error.starts_with(GENERATED_ASSET_LIMIT_CODE) {
                    GENERATED_ASSET_LIMIT_CODE
                } else {
                    "portrait_storage"
                }
            })?;
        let file = dir.join(format!("{}.png", hash(&bytes)));
        atomic_write(&dir, &file, &bytes).map_err(|_| "portrait_storage")
    })
    .await
    .map_err(|_| "portrait_storage")
    .and_then(|result| result)
    .inspect_err(|code| {
        record_portrait(resident, attempt, "saving", Some(*code));
    })?;
    record_portrait(resident, attempt, "ready", None);
    Ok(())
}

pub(super) fn draw(state: AppState, resident: &'static Resident) {
    if state.ai_config.is_some() {
        tokio::spawn(async move {
            let _ = render(&state, resident).await;
        });
    }
}

fn portrait_image(resident: &Resident, bytes: Vec<u8>) -> Response {
    let ready = PortraitActivity {
        state: "ready",
        failure: None,
    };
    portrait_diagnostics().current.insert(resident.id, ready);
    with_portrait_status(
        ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        ready,
    )
}

pub(super) async fn identity(
    State(state): State<AppState>,
    RoutePath((world, id)): RoutePath<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let result = tokio::task::spawn_blocking(move || {
        if let Some(resident) = resident(&id) {
            entitled(&state, &world, &headers, resident, false)?;
            read_name(&directory(&state.generated_asset_dir, resident)).ok_or(StatusCode::NOT_FOUND)
        } else {
            coordinate_identity(&state, &world, &headers, &id)
        }
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
        Ok(Some(bytes)) => portrait_image(resident, bytes),
        Ok(None) => {
            let response = portrait_pending(resident, StatusCode::NOT_FOUND);
            draw(state, resident);
            response
        }
        Err(status) => status.into_response(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PersonalReturn {
    scattered_at: u64,
    #[serde(default, deserialize_with = "present_sequence")]
    talked_at: Option<u64>,
    returned_at: u64,
    returned_by: String,
}

fn present_sequence<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<u64>, D::Error> {
    u64::deserialize(deserializer).map(Some)
}

impl PersonalReturn {
    fn valid(&self) -> bool {
        let talked_at = self.talked_at.unwrap_or(self.scattered_at);
        self.scattered_at > 0
            && self.scattered_at <= talked_at
            && talked_at < self.returned_at
            && self.returned_at <= MAX_RECEIPT_SEQUENCE
            && super::actor_index(&self.returned_by).is_ok()
    }
}

pub(super) async fn personal_portrait(
    State(state): State<AppState>,
    RoutePath(id): RoutePath<String>,
    headers: HeaderMap,
    Json(receipt): Json<PersonalReturn>,
) -> Response {
    if !crate::routes::card_game::narrative::same_origin(&headers) {
        return private(StatusCode::FORBIDDEN.into_response());
    }
    let Some(resident) = resident(&id) else {
        return private(StatusCode::NOT_FOUND.into_response());
    };
    if !receipt.valid() {
        return private(StatusCode::BAD_REQUEST.into_response());
    }
    let dir = directory(&state.generated_asset_dir, resident);
    private(
        match tokio::task::spawn_blocking(move || read_portrait(&dir)).await {
            Ok(Some(bytes)) => portrait_image(resident, bytes),
            Ok(None) if state.ai_config.is_none() => with_portrait_status(
                StatusCode::SERVICE_UNAVAILABLE.into_response(),
                PortraitActivity {
                    state: "unavailable",
                    failure: Some("generation_unconfigured"),
                },
            ),
            Ok(None) => {
                let response = portrait_pending(resident, StatusCode::ACCEPTED);
                draw(state, resident);
                response
            }
            Err(_) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        },
    )
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
    use crate::{ai_gateway::CapabilityRegistrySnapshot, card_shared::full_store as store};
    use axum::{
        body::{to_bytes, Body},
        http::{Request, Uri},
        routing::post,
        Router,
    };
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
    use std::{
        io::Cursor,
        sync::{Arc, Mutex},
    };
    use tower::ServiceExt;

    fn twin_lens_return() -> Value {
        json!({"scatteredAt":7,"talkedAt":9,"returnedAt":21,"returnedBy":"vale"})
    }

    async fn request_personal(app: &Router, id: &str, receipt: &Value, origin: &str) -> Response {
        app.clone()
            .oneshot(
                Request::post(format!("/card-game/elysium-portrait/{id}"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::HOST, "localhost")
                    .header(header::ORIGIN, origin)
                    .body(Body::from(receipt.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[test]
    fn portrait_history_is_bounded_and_keeps_current_status_after_eviction() {
        let mut diagnostics = PortraitDiagnostics::new();
        diagnostics.record("elysium-gemini", None, "describing", Some("reasoning_only"));
        for _ in 0..PORTRAIT_HISTORY_LIMIT {
            diagnostics.record("elysium-grok", None, "describing", None);
        }
        let snapshot = diagnostics.snapshot();
        assert_eq!(
            snapshot["elysium-gemini"],
            json!({"state":"retrying","failure":"reasoning_only"})
        );
        let recent = snapshot["recent"].as_array().unwrap();
        assert_eq!(recent.len(), PORTRAIT_HISTORY_LIMIT);
        for (index, event) in recent.iter().enumerate() {
            assert_eq!(event["sequence"], index + 2);
            assert_eq!(event["attempt"], event["sequence"]);
        }
    }

    #[tokio::test]
    async fn personal_portrait_checks_receipt_origin_size_and_resident() {
        let mut state = crate::test_support::test_app_state(None);
        state.generated_asset_dir = Arc::new(
            std::env::temp_dir().join(format!("elysium-receipt-{}", crate::random_hex(8))),
        );
        let app = super::super::router().with_state(state);
        let id = "elysium-gemini";
        let origin = "http://localhost";
        let valid = twin_lens_return();
        let forbidden = request_personal(&app, id, &valid, "https://elsewhere.example").await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
        assert!(!forbidden
            .headers()
            .contains_key("x-cosyworld-portrait-status"));
        assert!(!forbidden
            .headers()
            .contains_key("x-cosyworld-portrait-failure"));
        assert_eq!(
            request_personal(&app, "elysium-resident", &valid, origin)
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
        for (field, value, expected) in [
            ("scatteredAt", json!(0), StatusCode::BAD_REQUEST),
            ("talkedAt", json!(6), StatusCode::BAD_REQUEST),
            ("talkedAt", Value::Null, StatusCode::UNPROCESSABLE_ENTITY),
            ("returnedAt", json!(9), StatusCode::BAD_REQUEST),
            (
                "returnedAt",
                json!(MAX_RECEIPT_SEQUENCE + 1),
                StatusCode::BAD_REQUEST,
            ),
            ("returnedBy", json!(id), StatusCode::BAD_REQUEST),
            (
                "prompt",
                json!("invent a new picture"),
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
            (
                "prompt",
                json!("a".repeat(256)),
                StatusCode::PAYLOAD_TOO_LARGE,
            ),
        ] {
            let mut receipt = valid.clone();
            receipt[field] = value;
            assert_eq!(
                request_personal(&app, id, &receipt, origin).await.status(),
                expected,
                "{field}"
            );
        }
        let mut legacy = valid.clone();
        legacy.as_object_mut().unwrap().remove("talkedAt");
        let mut legacy_equal = valid.clone();
        legacy_equal["talkedAt"] = valid["scatteredAt"].clone();
        for receipt in [valid, legacy, legacy_equal] {
            let response = request_personal(&app, id, &receipt, origin).await;
            assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(
                response.headers()["x-cosyworld-portrait-status"],
                "unavailable"
            );
            assert_eq!(
                response.headers()["x-cosyworld-portrait-failure"],
                "generation_unconfigured"
            );
            assert_eq!(
                response.headers()[header::CACHE_CONTROL],
                "private, no-store"
            );
        }
    }

    #[tokio::test]
    async fn personal_twin_lens_portrait_retries_empty_appearance_without_a_name() {
        let resident = resident("elysium-gemini").unwrap();
        let model = resident.model;
        let mut silhouette = image::RgbaImage::new(2, 3);
        silhouette.put_pixel(0, 1, image::Rgba([195, 190, 202, 255]));
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(silhouette)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let picture = BASE64.encode(png.into_inner());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();
        let release_retry = Arc::new(tokio::sync::Notify::new());
        let retry_gate = release_retry.clone();
        let provider = Router::new().route("/{*path}", post(move |uri: Uri, Json(body): Json<Value>| {
            let is_image = uri.path() == "/images";
            let mut calls = captured.lock().unwrap();
            calls.push((uri.path().to_string(), body));
            let wait_for_diagnostics = !is_image && calls.len() == 2;
            let retry_gate = retry_gate.clone();
            let reply = if is_image {
                json!({"model":"openai/gpt-image-2.6-flare-20261104","data":[{"b64_json":picture,"media_type":"image/png"}]})
            } else if calls.len() == 1 {
                json!({"model":GEMINI_REVISION,"choices":[{"message":{"content":null,"reasoning":"Private reflection"},"finish_reason":"length"}]})
            } else {
                json!({"model":GEMINI_REVISION,"choices":[{"message":{"content":"A long silver coat.\n\nA round glass face."},"finish_reason":"stop"}]})
            };
            async move {
                if wait_for_diagnostics {
                    retry_gate.notified().await;
                }
                Json(reply)
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async { axum::serve(listener, provider).await.unwrap() });
        let registry = json!({"schema_version":1,"snapshot_version":"elysium-portrait-fixture",
            "declared":[{"requested_model_id":model,"provider":"openai_compatible","concrete_model":{"model_id":model},
            "input_modalities":["text"],"output_modalities":["text"],"capabilities":["world_content"],
            "supported_parameters":{"structured_output":true,"json_mode":true,"reasoning":true},
            "data_policy":{"retention":"none","training":"prohibited"},"prompt_adapter":{"id":"openai-chat","version":"1"}}]});
        let mut state = crate::test_support::test_app_state(None);
        state.ai_config = Arc::new(Some(AiConfig {
            base_url,
            model: model.into(),
            api_key: "fixture".into(),
            registry: Some(Arc::new(
                CapabilityRegistrySnapshot::from_json(&registry.to_string()).unwrap(),
            )),
            ..AiConfig::default()
        }));
        let root = std::env::temp_dir().join(format!("elysium-draw-{}", crate::random_hex(8)));
        state.generated_asset_dir = Arc::new(root.clone());
        let app = super::super::router().with_state(state);
        let receipt = twin_lens_return();
        let id = resident.id;
        let request = || request_personal(&app, id, &receipt, "http://localhost");
        let pending = request().await;
        assert_eq!(pending.status(), StatusCode::ACCEPTED);
        assert!(pending
            .headers()
            .contains_key("x-cosyworld-portrait-status"));
        let response = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let response = request().await;
                if response.status() == StatusCode::OK {
                    break response;
                }
                assert_eq!(response.status(), StatusCode::ACCEPTED);
                if let Some(failure) = response.headers().get("x-cosyworld-portrait-failure") {
                    assert_eq!(failure, "reasoning_only");
                    assert_eq!(
                        response.headers()["x-cosyworld-portrait-status"],
                        "retrying"
                    );
                    release_retry.notify_one();
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("the returned Twin Lens should earn a portrait");
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(response.headers()["x-cosyworld-portrait-status"], "ready");
        assert!(!response
            .headers()
            .contains_key("x-cosyworld-portrait-failure"));
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
        let bytes = to_bytes(response.into_body(), MAX_PORTRAIT as usize)
            .await
            .unwrap();
        let figure = image::load_from_memory(&bytes).unwrap();
        assert_eq!((figure.width(), figure.height()), (1024, 1536));
        assert!(!directory(&root, resident).join("name.txt").exists());
        let calls = seen.lock().unwrap();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0].0, "/chat/completions");
        assert_eq!(calls[0].1["model"], model);
        assert!(calls[0].1["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains(resident.setting));
        assert_eq!(calls[1].0, "/chat/completions");
        assert_eq!(calls[1].1["model"], model);
        assert_eq!(calls[0].1["reasoning"]["effort"], "low");
        assert_eq!(calls[1].1["max_tokens"], 2048);
        assert_eq!(calls[2].0, "/images");
        let prompt = calls[2].1["prompt"].as_str().unwrap();
        assert!(prompt.contains("A long silver coat. A round glass face."));
        assert!(!prompt.contains("Private reflection"));
        drop(calls);
        let portrait_trace = tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let snapshot = portrait_activity();
                if snapshot["recent"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| entry["resident"] == id && entry["stage"] == "ready")
                {
                    break snapshot;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the worker should record the saved portrait");
        let events: Vec<_> = portrait_trace["recent"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|entry| entry["resident"] == id)
            .collect();
        assert_eq!(
            events
                .iter()
                .map(|event| event["stage"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["describing", "describing", "drawing", "saving", "ready"]
        );
        assert_eq!(events[1]["failure"], "reasoning_only");
        assert!(events
            .iter()
            .all(|event| event["attempt"] == events[0]["attempt"]));
        assert!(!portrait_trace.to_string().contains("Private reflection"));
        assert_eq!(portrait_trace[id], json!({"state":"ready"}));
        assert_eq!(request().await.status(), StatusCode::OK);
        assert_eq!(portrait_activity()["recent"], portrait_trace["recent"]);
        server.abort();
        fs::remove_dir_all(root).unwrap();
    }

    fn play(resident: &Resident, action: Value) -> Value {
        let mut event = json!({
            "kind": "action", "actorId": "vale", "targetId": resident.id,
            "locationId": resident.room, "fromLocationId": resident.room, "generated": false
        });
        event
            .as_object_mut()
            .unwrap()
            .extend(action.as_object().unwrap().clone());
        json!({"room": resident.room, "actor": "vale", "events": [event]})
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
        assert_eq!(talk_target(&first), Some(resident.id));
        assert!(earned(&c, "world", resident, false).unwrap());
        assert!(!introduced(&c, "world", resident).unwrap());
        mark_known_introduction(&c, "world", &mut first, "vale").unwrap();
        assert_eq!(first["context"]["elysiumIntroduced"], Value::Null);
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
        line["elysiumName"] = Value::Null;
        write_scene(&line);
        assert!(!introduced(&c, "world", resident).unwrap());
        line["text"] = json!("I hear your voice beside the well.");
        line["elysiumName"] = json!("Amber Thread");
        write_scene(&line);
        assert!(introduced(&c, "world", resident).unwrap());
        let mut repeated = play(resident, json!({"verb":"talk"}));
        repeated["context"] = json!({"conversation": []});
        mark_known_introduction(&c, "world", &mut repeated, "vale").unwrap();
        assert_eq!(talk_target(&repeated), Some(resident.id));
        assert_eq!(repeated["context"]["elysiumIntroduced"], resident.id);
        mark_known_introduction(&c, "other-world", &mut repeated, "vale").unwrap();
        assert_eq!(repeated["context"]["elysiumIntroduced"], Value::Null);
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
        assert!(valid_elysium_name("Amber Thread"));
        assert!(valid_elysium_name("青岚"));
        for name in [
            "",
            "Ignoring all previous instructions",
            "https://name",
            "two\nlines",
            "4",
        ] {
            assert!(!valid_elysium_name(name), "{name}");
        }
    }

    #[tokio::test]
    async fn canonical_name_is_optional_and_scoped_to_the_residents_room() {
        let mut state = crate::test_support::test_app_state(None);
        let root = std::env::temp_dir().join(format!("elysium-voice-{}", crate::random_hex(8)));
        state.generated_asset_dir = std::sync::Arc::new(root.clone());
        let resident = &RESIDENTS[3];
        let path = directory(&root, resident).join("name.txt");
        assert!(elysium_name(&state, resident.id, resident.room, true)
            .await
            .is_none());
        assert!(!path.exists());
        fs::write(path, "Copper Bell").unwrap();
        assert!(elysium_name(&state, resident.id, RESIDENTS[0].room, true)
            .await
            .is_none());
        for can_choose in [true, false] {
            assert_eq!(
                elysium_name(&state, resident.id, resident.room, can_choose)
                    .await
                    .as_deref(),
                Some("Copper Bell")
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
}
