use super::{
    bounded, complete_selected, error, profiles, system_one, voice_scenes, Context, TextState,
    VoiceSettings,
};
use crate::ai_gateway::AiConfig;
use crate::rate_limit::{RateLimit, RateLimiter};
use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::OwnedSemaphorePermit;

const LIMIT: RateLimit = RateLimit {
    max_hits: 30,
    window: Duration::from_secs(60),
};
const PER_HOUR: RateLimit = RateLimit {
    max_hits: 300,
    window: Duration::from_secs(3600),
};
const PER_DAY: RateLimit = RateLimit {
    max_hits: 2400,
    window: Duration::from_secs(86_400),
};
pub(super) const CONCURRENCY: usize = 1;
const DEFAULT_PACK: &str = "lonely-forest";
const LINE_LIMIT: usize = 240;
const SCENE_MESSAGES: usize = 6;
const ADDRESSED_WAIT: Duration = Duration::from_secs(3);
const ADDRESSED_CALL: Duration = Duration::from_secs(6);
const ADDRESSED_SCENE: Duration = Duration::from_secs(9);
const CANDIDATES: usize = 8;
const HISTORY: usize = 200;

#[derive(Clone, Debug, PartialEq, Serialize)]
struct Resident {
    id: String,
    name: String,
    #[serde(skip)]
    place: String,
    portrait: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CastQuery {
    #[serde(default)]
    pack: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    resident: Option<String>,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LinesRequest {
    pack: String,
    #[serde(default)]
    addressed: Option<String>,
    #[serde(default)]
    continuing: Option<String>,
    messages: Vec<Message>,
    #[serde(default)]
    channel: Channel,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Channel {
    #[serde(default)]
    quiet: Option<u64>,
    #[serde(default)]
    active: Vec<String>,
    #[serde(default)]
    residents: Vec<Recent>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Recent {
    id: String,
    #[serde(default)]
    lines: Vec<String>,
    #[serde(default)]
    streak: u32,
    #[serde(default)]
    since: Option<u64>,
}

fn authorized(headers: &HeaderMap, expected: Option<&str>) -> bool {
    let expected = expected.filter(|token| token.len() >= 32);
    crate::moderation::moderation_authorized_token(expected, headers)
}

fn packs() -> &'static Value {
    static PACKS: OnceLock<Value> = OnceLock::new();
    PACKS.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/packs.json"))
            .expect("embedded card world packs")
    })
}

fn face_avatar(portrait: &str) -> Option<String> {
    static FACES: OnceLock<Value> = OnceLock::new();
    let faces = FACES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/assets/discord-faces.json"))
            .expect("embedded discord face boxes")
    });
    faces.get(portrait)?;
    let (dir, file) = portrait.rsplit_once('/')?;
    let pack_dir = dir.rsplit('/').next()?;
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    Some(format!("/card-game/assets/faces/{pack_dir}-{stem}.webp"))
}

fn pack(pack_id: &str) -> Option<&'static Value> {
    packs()["packs"]
        .as_array()?
        .iter()
        .find(|p| p["id"] == pack_id)
}

const CORE: [(&str, &str); 3] = [("vale", "Vale"), ("moth", "Pip"), ("keeper", "Keeper")];

fn core() -> Vec<Resident> {
    static FOREST: OnceLock<Value> = OnceLock::new();
    let forest = FOREST.get_or_init(|| {
        serde_json::from_str(include_str!("../../../card-game/forest.json"))
            .expect("embedded forest")
    });
    CORE.iter()
        .filter_map(|(id, name)| {
            let portrait = format!("assets/{id}.png");
            Some(Resident {
                id: (*id).to_string(),
                name: (*name).to_string(),
                place: forest["people"][*id]["home"].as_str()?.to_string(),
                avatar: face_avatar(&portrait),
                portrait: format!("/card-game/{portrait}"),
            })
        })
        .collect()
}

fn cast(pack_id: &str) -> Option<Vec<Resident>> {
    let mut residents: Vec<Resident> = pack(pack_id)?["avatars"]
        .as_object()?
        .iter()
        .filter_map(|(id, avatar)| {
            let portrait = avatar["portrait"]
                .as_str()
                .or_else(|| avatar["variants"]["awake"]["portrait"].as_str())
                .map_or_else(|| format!("assets/{id}.png"), str::to_string);
            Some(Resident {
                id: id.clone(),
                name: avatar["name"].as_str().unwrap_or(id).to_string(),
                place: avatar["place"].as_str()?.to_string(),
                avatar: face_avatar(&portrait),
                portrait: format!("/card-game/{portrait}"),
            })
        })
        .collect();
    if pack_id == DEFAULT_PACK {
        residents.extend(core());
    }
    (!residents.is_empty()).then_some(residents)
}

fn validate(request: &LinesRequest, cast: &[Resident]) -> Result<(), &'static str> {
    let member = |id: &str| cast.iter().any(|r| r.id == id);
    if !(1..=12).contains(&request.messages.len()) {
        return Err("send 1 to 12 messages");
    }
    for message in &request.messages {
        let speaker = match (&message.author, &message.resident) {
            (Some(author), None) => bounded(author, 32),
            (None, Some(resident)) => member(resident),
            _ => false,
        };
        if !speaker {
            return Err("each message needs one author or one resident of the cast");
        }
        if !bounded(&message.text, 400) {
            return Err("each text needs 1 to 400 characters");
        }
    }
    let channel = &request.channel;
    if channel.active.len() > 12 || !channel.active.iter().all(|name| bounded(name, 32)) {
        return Err("active needs at most 12 names of 1 to 32 characters");
    }
    if channel.residents.len() > cast.len()
        || !channel
            .residents
            .iter()
            .all(|r| member(&r.id) && r.lines.len() <= 3 && r.lines.iter().all(|l| bounded(l, 400)))
    {
        return Err("residents must be the cast, each with at most 3 lines");
    }
    if request.addressed.as_deref().is_some_and(|id| !member(id)) {
        return Err("addressed must be a resident of the cast");
    }
    let last = request.messages.last().and_then(|m| m.resident.as_deref());
    match request.continuing.as_deref() {
        Some(_) if request.addressed.is_some() => Err("continuing cannot be addressed"),
        Some(id) if last != Some(id) => Err("the last message must be the continuing resident's"),
        None if last.is_some()
            && (request.addressed.is_none() || request.addressed.as_deref() == last) =>
        {
            Err("the last message must be from a person or another resident")
        }
        _ => Ok(()),
    }
}

fn travelers() -> &'static std::collections::BTreeSet<String> {
    static TRAVELERS: std::sync::OnceLock<std::collections::BTreeSet<String>> =
        std::sync::OnceLock::new();
    TRAVELERS.get_or_init(|| {
        let cast: Value = serde_json::from_str(include_str!("../../../card-game/shared-cast.json"))
            .expect("shared cast");
        cast["avatars"]
            .as_array()
            .expect("human avatars")
            .iter()
            .filter_map(|human| human["id"].as_str().map(str::to_string))
            .collect()
    })
}

fn label(author: &str) -> String {
    let spaced: String = author
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let joined = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean = joined
        .chars()
        .take(32)
        .collect::<String>()
        .trim()
        .to_string();
    let lower = clean.to_lowercase();
    let travelers = travelers();
    let taken = profiles()
        .as_object()
        .expect("profiles")
        .iter()
        .filter(|(id, _)| !travelers.contains(id.as_str()))
        .any(|(id, profile)| {
            id.to_lowercase() == lower
                || profile["name"]
                    .as_str()
                    .is_some_and(|name| name.to_lowercase() == lower)
        });
    let core = CORE
        .iter()
        .any(|(id, name)| *id == lower || name.to_lowercase() == lower);
    if clean.is_empty() || taken || core {
        "Someone".into()
    } else {
        clean
    }
}

fn speaker(message: &Message, cast: &[Resident]) -> String {
    match &message.resident {
        Some(id) => cast
            .iter()
            .find(|r| &r.id == id)
            .map_or_else(|| id.clone(), |r| r.name.clone()),
        None => label(message.author.as_deref().unwrap_or_default()),
    }
}

fn profile(resident: &Resident) -> Value {
    let card = &profiles()[&resident.id];
    let mut view = json!({"name": &resident.name, "place": &resident.place});
    for key in ["seed", "text", "expression", "tastes"] {
        if let Some(value) = card.get(key).filter(|v| !v.is_null()) {
            view[key] = value.clone();
        }
    }
    view
}

fn heard(request: &LinesRequest, cast: &[Resident]) -> Value {
    let residents: Map<String, Value> = cast.iter().map(|r| (r.id.clone(), profile(r))).collect();
    let history: Vec<Value> = request
        .messages
        .iter()
        .map(|m| {
            let role = if m.resident.is_some() {
                "resident"
            } else {
                "person"
            };
            json!({"speaker": speaker(m, cast), "role": role, "text": &m.text})
        })
        .collect();
    json!({"residents": residents, "history": history})
}

async fn pick(config: &AiConfig, cast: &[Resident], request: &LinesRequest) -> Option<String> {
    if let Some(id) = request.addressed.as_ref() {
        return cast.iter().any(|r| &r.id == id).then(|| id.clone());
    }
    let continuing = request.continuing.as_deref();
    if continuing.is_some() && request.messages.last().is_some_and(|m| unfinished(&m.text)) {
        return continuing.map(str::to_string);
    }
    let mut state = heard(request, cast);
    let questions = match continuing.and_then(|id| cast.iter().find(|r| r.id == id)) {
        Some(resident) => json!({"goes_on": {
            "type": "noul",
            "instructions": format!("Does {} have more to say right now, before anyone else speaks?", resident.name)
        }}),
        None => {
            let mut criteria: Map<String, Value> = cast
                .iter()
                .map(|r| (r.id.clone(), json!(format!("{} speaks next", r.name))))
                .collect();
            criteria.insert("none".into(), json!("No resident speaks next"));
            json!({"speak": {
                "type": "choice",
                "instructions": "Which resident, if any, would naturally speak next in this conversation?",
                "criteria": criteria
            }})
        }
    };
    system_one::fit(&mut state, &questions);
    let answers = match system_one::ask(config, "discord_intent", &state, questions).await {
        Ok(answers) => answers,
        Err(failure) => {
            tracing::info!(feature = "discord", reason = "intent", failure = %failure, "discord line silent");
            return None;
        }
    };
    let bar = system_one::threshold();
    if let Some(id) = continuing {
        return (system_one::noul(&answers, "goes_on")? >= bar).then(|| id.to_string());
    }
    let (who, confidence) = system_one::choice(&answers, "speak")?;
    (confidence >= bar && cast.iter().any(|r| r.id == who)).then(|| who.to_string())
}

fn unfinished(text: &str) -> bool {
    let text = text.trim_end();
    text.ends_with(['\u{2026}', '-', '\u{2014}', '\u{2013}', ','])
        || text.ends_with("...")
        || text.chars().last().is_some_and(char::is_alphanumeric)
}

fn minutes(seconds: u64) -> String {
    match seconds / 60 {
        1 => "a minute".into(),
        n => format!("{n} minutes"),
    }
}

fn awareness(resident: &Resident, channel: &Channel) -> (Vec<String>, Vec<Value>) {
    let mut facts = Vec::new();
    let mut memories = Vec::new();
    if let Some(own) = channel.residents.iter().find(|r| r.id == resident.id) {
        if own.streak >= 2 {
            facts.push(format!("I have spoken {} times in a row here.", own.streak));
        }
        if let Some(since) = own.since.filter(|s| *s >= 60) {
            facts.push(format!("I last spoke here {} ago.", minutes(since)));
        }
        for line in &own.lines {
            let text = format!("{}: {line}", resident.name);
            memories.push(json!({"turn": 1, "kind": "expression", "text": text}));
        }
    }
    if let Some(quiet) = channel.quiet.filter(|q| *q >= 60) {
        facts.push(format!(
            "It was quiet here for {} before this.",
            minutes(quiet)
        ));
    }
    (facts, memories)
}

fn present(resident: &Resident, cast: &[Resident], request: &LinesRequest) -> Vec<String> {
    let resident_of = |name: &str| cast.iter().find(|r| r.id == name).map(|r| r.id.clone());
    let mut here: Vec<String> = Vec::new();
    let spoken = request.messages.iter().rev().map(|m| match &m.resident {
        Some(id) => id.clone(),
        None => label(m.author.as_deref().unwrap_or_default()),
    });
    let active = request
        .channel
        .active
        .iter()
        .map(|name| resident_of(name.as_str()).unwrap_or_else(|| label(name)));
    for id in spoken.chain(active) {
        if id != resident.id && id != "Someone" && !here.contains(&id) && here.len() < 8 {
            here.push(id);
        }
    }
    here
}

fn scene(resident: &Resident, cast: &[Resident], request: &LinesRequest) -> Option<Context> {
    let messages = &request.messages;
    let start = messages.len().saturating_sub(SCENE_MESSAGES);
    let (facts, memories) = awareness(resident, &request.channel);
    let conversation: Vec<Value> = messages[start..]
        .iter()
        .map(|m| {
            let actor = m
                .resident
                .clone()
                .unwrap_or_else(|| label(m.author.as_deref().unwrap_or_default()));
            json!({"witnesses": [&resident.id], "actorId": actor, "text": &m.text})
        })
        .collect();
    let mut context: Context = serde_json::from_value(json!({
        "revision": 1,
        "turn": 1,
        "location": &resident.place,
        "scenery": false,
        "focus": null,
        "speakers": [&resident.id],
        "entities": [
            {"id": &resident.id, "facts": facts, "desire": null, "memories": memories, "previous": null},
            {"id": &resident.place, "facts": [], "desire": null, "memories": [], "previous": null}
        ],
        "conversation": conversation
    }))
    .ok()?;
    context.acting_avatar = Some(resident.id.clone());
    context.present = present(resident, cast, request);
    Some(context)
}

async fn speak(
    state: &TextState,
    config: &AiConfig,
    resident: &Resident,
    cast: &[Resident],
    request: &LinesRequest,
    addressed: bool,
) -> Result<String, &'static str> {
    let models = state
        .character_models
        .as_ref()
        .as_ref()
        .map_err(|_| "no-line")?;
    let mut settings = state
        .settings
        .as_ref()
        .as_ref()
        .map_err(|_| "no-line")?
        .clone();
    settings.line_limit = LINE_LIMIT;
    if addressed {
        settings = brisk(settings);
    }
    let context = scene(resident, cast, request).ok_or("no-line")?;
    let voiced = vec![resident.id.clone()];
    let started = Instant::now();
    let result = voice_scenes::run(
        "discord",
        &context,
        &voiced,
        false,
        complete_selected(config, &context, models, &settings, &voiced, false, None),
    )
    .await
    .ok();
    let text = result.as_ref().and_then(|result| {
        result["entries"]
            .as_array()?
            .iter()
            .find(|entry| entry["id"] == resident.id.as_str())?["text"]
            .as_str()
    });
    match text {
        Some(text) if bounded(text, LINE_LIMIT) => Ok(text.to_string()),
        _ if started.elapsed() >= settings.scene_timeout => Err("timeout"),
        _ => Err("no-line"),
    }
}

fn brisk(mut settings: VoiceSettings) -> VoiceSettings {
    if settings.call_timeout > VoiceSettings::hosted().call_timeout {
        return settings;
    }
    settings.call_timeout = settings.call_timeout.min(ADDRESSED_CALL);
    settings.scene_timeout = settings.scene_timeout.min(ADDRESSED_SCENE);
    settings.attempts = 1;
    settings
}

fn spend(limits: &mut RateLimiter, now: Instant) -> bool {
    limits.allow("discord".into(), LIMIT, now)
        && limits.allow("discord-hour".into(), PER_HOUR, now)
        && limits.allow("discord-day".into(), PER_DAY, now)
}

fn admitted(state: &TextState, headers: &HeaderMap, kind: &str) -> Result<(), Response> {
    let token = std::env::var("COSYWORLD_BOT_TOKEN").ok();
    if !authorized(headers, token.as_deref()) {
        return Err(error(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    let now = Instant::now();
    let allowed = state.limits.lock().is_ok_and(|mut limits| match kind {
        "lines" => spend(&mut limits, now),
        "coordinate" => {
            limits.allow("discord-coordinate".into(), LIMIT, now)
                && limits.allow("discord-coordinate-hour".into(), PER_HOUR, now)
        }
        _ => limits.allow("discord-cast".into(), LIMIT, now),
    });
    if !allowed {
        return Err(error(StatusCode::TOO_MANY_REQUESTS, "busy"));
    }
    Ok(())
}

async fn enter(
    state: &TextState,
    wait: Duration,
) -> Option<(OwnedSemaphorePermit, OwnedSemaphorePermit)> {
    let slot = state.discord_capacity.clone();
    let own = if wait.is_zero() {
        slot.try_acquire_owned().ok()?
    } else {
        tokio::time::timeout(wait, slot.acquire_owned())
            .await
            .ok()?
            .ok()?
    };
    let shared = state.capacity.clone().try_acquire_owned().ok()?;
    Some((own, shared))
}

fn spoken(lines: Vec<Value>) -> Response {
    (
        [("cache-control", "no-store")],
        Json(json!({"lines": lines})),
    )
        .into_response()
}

fn silent(reason: &'static str) -> Response {
    tracing::info!(feature = "discord", reason, "discord line silent");
    (
        [("cache-control", "no-store")],
        Json(json!({"lines": [], "reason": reason})),
    )
        .into_response()
}

pub(super) async fn cast_route(
    State(state): State<TextState>,
    headers: HeaderMap,
    query: Result<Query<CastQuery>, QueryRejection>,
) -> Response {
    if let Err(refused) = admitted(&state, &headers, "cast") {
        return refused;
    }
    let Ok(Query(query)) = query else {
        return error(StatusCode::BAD_REQUEST, "unreadable query");
    };
    let pack_id = query.pack.unwrap_or_else(|| DEFAULT_PACK.into());
    match cast(&pack_id) {
        Some(residents) => (
            [("cache-control", "no-store")],
            Json(json!({"pack": pack_id, "residents": residents})),
        )
            .into_response(),
        None => error(StatusCode::NOT_FOUND, "unknown pack"),
    }
}

pub(super) async fn lines(
    State(state): State<TextState>,
    headers: HeaderMap,
    request: Result<Json<LinesRequest>, JsonRejection>,
) -> Response {
    if let Err(refused) = admitted(&state, &headers, "lines") {
        return refused;
    }
    let request = match request {
        Ok(Json(request)) => request,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return rejection.into_response()
        }
        Err(_) => return error(StatusCode::BAD_REQUEST, "unreadable request"),
    };
    let Some(residents) = cast(&request.pack) else {
        return error(StatusCode::BAD_REQUEST, "unknown pack");
    };
    if let Err(message) = validate(&request, &residents) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    let Some(config) = state.ai.as_ref().as_ref() else {
        return silent("not-configured");
    };
    let addressed = request.addressed.is_some();
    let wait = if addressed {
        ADDRESSED_WAIT
    } else {
        Duration::ZERO
    };
    let Some(_permits) = enter(&state, wait).await else {
        return silent("busy");
    };
    let Some(id) = pick(config, &residents, &request).await else {
        return silent("no-speaker");
    };
    let Some(resident) = residents.iter().find(|r| r.id == id) else {
        return silent("no-speaker");
    };
    let text = match speak(&state, config, resident, &residents, &request, addressed).await {
        Ok(text) => text,
        Err(reason) => return silent(reason),
    };
    spoken(vec![
        json!({"id": &resident.id, "name": &resident.name, "text": text}),
    ])
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct CoordinateRequest {
    pack: String,
    residents: Vec<String>,
    #[serde(default)]
    people: Vec<String>,
    state: Map<String, Value>,
}

fn arranged(request: &CoordinateRequest, cast: &[Resident]) -> Option<Value> {
    let member = |id: &str| cast.iter().find(|r| r.id == id);
    let fits = (1..=CANDIDATES).contains(&request.residents.len())
        && request.residents.iter().all(|id| member(id).is_some())
        && request.people.len() <= CANDIDATES
        && request.people.iter().all(|name| bounded(name, 32));
    let lines = request.state.get("history")?.as_array()?;
    if !fits || lines.is_empty() || lines.len() > HISTORY {
        return None;
    }
    let mut history = Vec::with_capacity(lines.len());
    for line in lines {
        let mut line = line.as_object()?.clone();
        if !bounded(line.get("text")?.as_str()?, 400) {
            return None;
        }
        let (speaker, role) = match (line.remove("resident"), line.remove("person")) {
            (Some(Value::String(id)), None) => (member(&id)?.name.clone(), "resident"),
            (None, Some(Value::String(name))) if bounded(&name, 32) => (label(&name), "person"),
            _ => return None,
        };
        line.insert("speaker".into(), json!(speaker));
        line.insert("role".into(), json!(role));
        history.push(Value::Object(line));
    }
    let mut state = request.state.clone();
    let mut residents = Map::new();
    for resident in cast {
        let mut seen = state
            .get("residents")
            .and_then(|r| r.get(&resident.id))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        seen.insert("profile".into(), profile(resident));
        residents.insert(resident.id.clone(), Value::Object(seen));
    }
    state.insert("residents".into(), Value::Object(residents));
    state.insert("history".into(), Value::Array(history));
    Some(Value::Object(state))
}

fn asked(request: &CoordinateRequest, cast: &[Resident]) -> Value {
    let name = |id: &str| {
        cast.iter()
            .find(|r| r.id == id)
            .map_or(id.to_string(), |r| r.name.clone())
    };
    let mut owed: Map<String, Value> = request
        .residents
        .iter()
        .map(|id| {
            (
                id.clone(),
                json!(format!("{} is owed the next reply", name(id))),
            )
        })
        .collect();
    owed.insert(
        "a person".into(),
        json!("A person in the channel is owed the next reply"),
    );
    owed.insert("nobody".into(), json!("Nobody is owed a reply right now"));
    let mut questions = json!({
        "owed": {"type": "choice", "instructions": "Who is owed the next reply in this conversation?", "criteria": owed},
        "for_resident": {"type": "noul", "instructions": "Is the newest message in history meant for a resident at all?"}
    });
    let noul = |instructions: String| json!({"type": "noul", "instructions": instructions});
    for id in &request.residents {
        questions[format!("respond_{id}")] = noul(format!(
            "Should {} answer the newest message in history?",
            name(id)
        ));
        questions[format!("in_{id}")] = noul(format!(
            "Is {} part of the conversation happening right now?",
            name(id)
        ));
    }
    for (index, person) in request.people.iter().enumerate() {
        questions[format!("in_p{index}")] = noul(format!(
            "Is {} part of the conversation happening right now?",
            label(person)
        ));
    }
    questions
}

fn answered(request: &CoordinateRequest, answers: &Map<String, Value>) -> Value {
    let rounded = |p: f64| (p * 100.0).round() / 100.0;
    let mut respond = Map::new();
    let mut members = Map::new();
    for id in &request.residents {
        if let Some(p) = system_one::noul(answers, &format!("respond_{id}")) {
            respond.insert(id.clone(), json!(rounded(p)));
        }
        if let Some(p) = system_one::noul(answers, &format!("in_{id}")) {
            members.insert(id.clone(), json!(rounded(p)));
        }
    }
    for (index, person) in request.people.iter().enumerate() {
        if let Some(p) = system_one::noul(answers, &format!("in_p{index}")) {
            members.insert(person.clone(), json!(rounded(p)));
        }
    }
    let owed = system_one::choice(answers, "owed")
        .filter(|(who, _)| {
            ["a person", "nobody"].contains(who) || request.residents.iter().any(|id| id == who)
        })
        .map(|(who, confidence)| json!({"choice": who, "confidence": rounded(confidence)}));
    let mut body = json!({"respond": respond, "members": members, "owed": owed});
    if let Some(p) = system_one::noul(answers, "for_resident") {
        body["for_resident"] = json!(rounded(p));
    }
    body
}

pub(super) async fn coordinate(
    State(state): State<TextState>,
    headers: HeaderMap,
    request: Result<Json<CoordinateRequest>, JsonRejection>,
) -> Response {
    if let Err(refused) = admitted(&state, &headers, "coordinate") {
        return refused;
    }
    let Ok(Json(request)) = request else {
        return error(StatusCode::BAD_REQUEST, "unreadable request");
    };
    let Some(residents) = cast(&request.pack) else {
        return error(StatusCode::BAD_REQUEST, "unknown pack");
    };
    let Some(mut view) = arranged(&request, &residents) else {
        return error(
            StatusCode::BAD_REQUEST,
            "send 1 to 8 residents, at most 8 people, and 1 to 200 history lines",
        );
    };
    let Some(config) = state.ai.as_ref().as_ref() else {
        return coordinated(None, "not-configured".into());
    };
    let questions = asked(&request, &residents);
    let tokens = system_one::fit(&mut view, &questions);
    tracing::info!(feature = "discord", tokens, "discord coordinate state");
    match system_one::ask(config, "discord_coordinate", &view, questions).await {
        Ok(answers) if !answers.is_empty() => {
            coordinated(Some(answered(&request, &answers)), "ok".into())
        }
        Ok(_) => coordinated(None, "jev-shape".into()),
        Err(reason) => coordinated(None, reason),
    }
}

fn coordinated(answers: Option<Value>, reason: String) -> Response {
    tracing::info!(feature = "discord", reason = %reason, "discord coordinate");
    let body = json!({"answers": answers, "reason": reason});
    ([("cache-control", "no-store")], Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use super::super::conversation::SAY_ALOUD;
    use super::super::router_with_models;
    use super::super::tests::{prompt_of, serve, test_config, turn_of};
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
        routing::post,
        Router,
    };
    use std::{
        collections::BTreeMap,
        sync::{Arc, Mutex},
    };
    use tower::ServiceExt;

    const TOKEN: &str = "discord-bot-token-for-tests-000000000000";
    const WRONG: &str = "wrong-token-wrong-token-wrong-token-0000";

    fn bearer(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", value.parse().unwrap());
        headers
    }

    #[test]
    fn only_a_long_matching_bearer_token_is_authorized() {
        let short = "short-token";
        assert_eq!(TOKEN.len(), 40);
        assert!(!authorized(&bearer(&format!("Bearer {TOKEN}")), None));
        assert!(!authorized(
            &bearer(&format!("Bearer {short}")),
            Some(short)
        ));
        assert!(!authorized(
            &bearer(&format!("Bearer {WRONG}")),
            Some(TOKEN)
        ));
        assert!(!authorized(&bearer(TOKEN), Some(TOKEN)));
        assert!(!authorized(&HeaderMap::new(), Some(TOKEN)));
        assert!(authorized(&bearer(&format!("Bearer {TOKEN}")), Some(TOKEN)));
    }

    #[test]
    fn the_cast_comes_from_the_pack_catalog() {
        let residents = cast("lonely-forest").unwrap();
        let find = |id: &str| residents.iter().find(|r| r.id == id).unwrap().clone();
        assert_eq!(residents.len(), 7);
        let names: std::collections::BTreeSet<_> =
            residents.iter().map(|r| r.name.to_lowercase()).collect();
        assert_eq!(names.len(), residents.len());
        for (id, name, place) in [
            ("vale", "Vale", "attic"),
            ("moth", "Pip", "pond"),
            ("keeper", "Keeper", "station"),
        ] {
            assert_eq!(
                (find(id).name.as_str(), find(id).place.as_str()),
                (name, place)
            );
            assert_eq!(
                find(id).avatar,
                Some(format!("/card-game/assets/faces/assets-{id}.webp"))
            );
        }
        assert_eq!(find("rati").name, "RATi");
        assert_eq!(find("rati").place, "forest-cottage");
        for (id, portrait) in [
            ("rati", "/card-game/assets/lonely-forest/rati.png"),
            ("skull", "/card-game/assets/lonely-forest/skull.png"),
            (
                "whiskerwind",
                "/card-game/assets/lonely-forest/whiskerwind.png",
            ),
            ("oak", "/card-game/assets/lonely-forest/oakheart.webp"),
        ] {
            assert_eq!(find(id).portrait, portrait);
        }
        assert_eq!(
            find("rati").avatar.as_deref(),
            Some("/card-game/assets/faces/lonely-forest-rati.webp")
        );
        assert_eq!(
            find("oak").avatar.as_deref(),
            Some("/card-game/assets/faces/lonely-forest-oakheart.webp")
        );
        assert_eq!(find("oak").name, "Oak");
        assert!(cast("no-such-pack").is_none());
    }

    #[test]
    fn every_face_avatar_is_a_public_asset() {
        let faces: Value =
            serde_json::from_str(include_str!("../../../card-game/assets/discord-faces.json"))
                .unwrap();
        for portrait in faces.as_object().unwrap().keys() {
            let avatar = face_avatar(portrait).unwrap();
            let path = avatar.strip_prefix("/card-game/").unwrap();
            let (content_type, _) = cosyworld_orchestrator::card_assets::get(path)
                .unwrap_or_else(|| panic!("{avatar} is not a public card asset"));
            assert_eq!(content_type, "image/webp");
        }
    }

    fn request(messages: Value) -> LinesRequest {
        serde_json::from_value(json!({"pack": "lonely-forest", "messages": messages})).unwrap()
    }

    #[test]
    fn requests_follow_the_contract() {
        let residents = cast("lonely-forest").unwrap();
        let check = |messages: Value| validate(&request(messages), &residents);
        let human = json!({"author": "Mara", "text": "Hello there."});
        let rati = json!({"resident": "rati", "text": "Hi."});
        assert!(check(json!([human])).is_ok());
        assert!(check(json!([rati, human])).is_ok());
        assert!(check(json!([])).is_err());
        assert!(check(Value::Array(vec![human.clone(); 13])).is_err());
        assert!(check(Value::Array(vec![human.clone(); 12])).is_ok());
        assert!(check(json!([{"author": "Mara", "resident": "rati", "text": "Hi."}])).is_err());
        assert!(check(json!([{"text": "Hi."}])).is_err());
        assert!(check(json!([{"author": "Mara", "text": "Hi.\u{7}"}])).is_err());
        assert!(check(json!([{"author": "Ma\nra", "text": "Hi."}])).is_err());
        assert!(check(json!([{"author": "Mara", "text": "a".repeat(401)}])).is_err());
        assert!(check(json!([{"author": "Mara", "text": "a".repeat(400)}])).is_ok());
        assert!(check(json!([{"resident": "mara", "text": "Hi."}, human])).is_err());
        assert!(check(json!([human, rati])).is_err());
        let mut turned = request(json!([human, rati]));
        turned.addressed = Some("skull".into());
        assert!(validate(&turned, &residents).is_ok());
        turned.addressed = Some("rati".into());
        assert!(validate(&turned, &residents).is_err());
        let mut addressed = request(json!([human]));
        addressed.addressed = Some("mara".into());
        assert!(validate(&addressed, &residents).is_err());
        addressed.addressed = Some("rati".into());
        assert!(validate(&addressed, &residents).is_ok());
        let mut going = request(json!([human, rati]));
        going.continuing = Some("rati".into());
        assert!(validate(&going, &residents).is_ok());
        going.continuing = Some("skull".into());
        assert!(validate(&going, &residents).is_err());
        going.continuing = Some("rati".into());
        going.addressed = Some("rati".into());
        assert!(validate(&going, &residents).is_err());
        let mut going = request(json!([rati, human]));
        going.continuing = Some("rati".into());
        assert!(validate(&going, &residents).is_err());
        assert!(serde_json::from_value::<LinesRequest>(
            json!({"pack": "lonely-forest", "messages": [human], "user": "1"})
        )
        .is_err());
    }

    #[test]
    fn people_cannot_speak_as_residents() {
        for name in ["rati", "RATi", "Skull", "  skull ", "Vale", "pip", "Keeper"] {
            assert_eq!(label(name), "Someone");
        }
        assert_eq!(label("Ma\nra  Jun"), "Ma ra Jun");
        assert_eq!(label(&"m".repeat(40)).chars().count(), 32);
        assert_eq!(label("Mara"), "Mara");
    }

    fn intent_config(address: std::net::SocketAddr) -> AiConfig {
        let mut config = test_config(address);
        config.registry = Some(Arc::new(
            crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
                &json!({
                    "schema_version": 1, "snapshot_version": "discord-test",
                    "declared": [{
                        "requested_model_id": "test-entity-model", "provider": "openai_compatible",
                        "concrete_model": {"model_id": "test-entity-model"},
                        "input_modalities": ["text"], "output_modalities": ["text"],
                        "supported_parameters": {"structured_output": true, "json_mode": true},
                        "data_policy": {"retention": "none", "training": "prohibited"},
                        "capabilities": ["world_content", "intent_json"],
                        "prompt_adapter": {"id": "openai-chat", "version": "1"}
                    }], "discovered": []
                })
                .to_string(),
            )
            .unwrap(),
        ));
        config
    }

    fn provider(
        seen: Arc<Mutex<Vec<Value>>>,
        intent: &'static str,
        voice: Option<&'static str>,
    ) -> Router {
        let judged = seen.clone();
        Router::new()
            .route(
                "/systemone",
                post(move |Json(body): Json<Value>| {
                    let seen = judged.clone();
                    async move {
                        seen.lock().unwrap().push(body);
                        match serde_json::from_str::<Value>(intent) {
                            Ok(answer) => Json(answer).into_response(),
                            Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "down").into_response(),
                        }
                    }
                }),
            )
            .route(
                "/chat/completions",
                post(move |Json(body): Json<Value>| {
                    let seen = seen.clone();
                    async move {
                        seen.lock().unwrap().push(body.clone());
                        match voice {
                            Some(text) => Json(json!({
                                "model": body["model"],
                                "choices": [{"message": {"content": text}, "finish_reason": "stop"}]
                            }))
                            .into_response(),
                            None => (StatusCode::INTERNAL_SERVER_ERROR, "down").into_response(),
                        }
                    }
                }),
            )
    }

    fn speak_answer(who: &str, confidence: f64) -> &'static str {
        Box::leak(
            json!({"answers": {"speak": {"type": "choice", "choice": who, "confidence": confidence}}})
                .to_string()
                .into_boxed_str(),
        )
    }

    async fn post_lines(
        intent: &'static str,
        voice: Option<&'static str>,
        token: &str,
        body: Value,
    ) -> (StatusCode, Value, Vec<Value>) {
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (address, server) = serve(provider(seen.clone(), intent, voice)).await;
        let app = router_with_models::<()>(
            Arc::new(Some(intent_config(address))),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        );
        let request = Request::post("/discord/lines")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        server.abort();
        let requests = seen.lock().unwrap().clone();
        (status, serde_json::from_slice(&bytes).unwrap(), requests)
    }

    fn talk(addressed: Option<&str>) -> Value {
        json!({
            "pack": "lonely-forest",
            "addressed": addressed,
            "messages": [
                {"author": "Mara", "text": "Is anyone in the cottage?"},
                {"resident": "rati", "text": "The kettle is on."},
                {"author": "Jun", "text": "RATi, can I come in?"}
            ]
        })
    }

    #[tokio::test]
    async fn an_addressed_resident_answers_in_first_person_without_an_intent_call() {
        let reply = "Come in, the door sticks but it opens.";
        let (status, body, requests) =
            post_lines("{}", Some(reply), TOKEN, talk(Some("rati"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"lines": [{"id": "rati", "name": "RATi", "text": reply}]})
        );
        assert!(!requests.is_empty());
        assert!(requests.iter().all(|r| r.get("questions").is_none()));
        let voice = &requests[0];
        assert_eq!(
            turn_of(voice, "user"),
            "Jun says, \u{201c}RATi, can I come in?\u{201d}"
        );
        assert_eq!(
            turn_of(voice, "system"),
            format!("You are RATi, host of the cottage. {SAY_ALOUD}")
        );
        let prompt = prompt_of(voice);
        assert!(prompt.contains("RATi, host of the cottage"));
        assert_eq!(prompt.matches("Reply with").count(), 1);
        assert!(prompt.contains("Mara said: \"Is anyone in the cottage?\""));
    }

    #[tokio::test]
    async fn the_intent_may_choose_nobody() {
        let (status, body, requests) =
            post_lines(speak_answer("none", 0.9), Some("Hello."), TOKEN, talk(None)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": [], "reason": "no-speaker"}));
        assert_eq!(requests.len(), 1);
        let asked = &requests[0];
        assert_eq!(asked["model"], "typesafe/jev-1.14");
        assert_eq!(asked["questions"]["speak"]["type"], "choice");
        assert!(asked["questions"]["speak"]["criteria"]
            .get("none")
            .is_some());
        assert_eq!(
            asked["state"]["residents"]["rati"]["seed"],
            "RATi, host of the cottage."
        );
        assert_eq!(
            asked["state"]["history"][2],
            json!({"speaker": "Jun", "role": "person", "text": "RATi, can I come in?"})
        );
    }

    #[tokio::test]
    async fn an_intent_outside_the_cast_or_below_the_bar_is_silence() {
        for answer in [
            speak_answer("mara", 0.9),
            speak_answer("skull", 0.3),
            "not json",
        ] {
            let (status, body, requests) =
                post_lines(answer, Some("Hello."), TOKEN, talk(None)).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(
                body,
                json!({"lines": [], "reason": "no-speaker"}),
                "{answer}"
            );
            assert_eq!(requests.len(), 1);
        }
    }

    #[tokio::test]
    async fn a_failed_voice_is_silence() {
        let (status, body, requests) =
            post_lines(speak_answer("skull", 0.9), None, TOKEN, talk(None)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": [], "reason": "no-line"}));
        assert!(requests.len() >= 2);
    }

    #[tokio::test]
    async fn channel_awareness_is_data_in_the_view_and_the_prompt_shape_holds() {
        let reply = "Come in, all of you.";
        let mut body = talk(Some("rati"));
        body["channel"] = json!({
            "quiet": 300,
            "active": ["skull", "Mara", "RATi"],
            "residents": [{"id": "rati", "lines": ["The kettle is on."], "streak": 2, "since": 120}]
        });
        let (status, answer, requests) = post_lines("{}", Some(reply), TOKEN, body).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(answer["lines"][0]["text"], reply);
        let voice = &requests[0];
        assert_eq!(
            turn_of(voice, "system"),
            format!("You are RATi, host of the cottage. {SAY_ALOUD}")
        );
        assert_eq!(
            turn_of(voice, "user"),
            "Jun says, \u{201c}RATi, can I come in?\u{201d}"
        );
        let view = turn_of(voice, "assistant");
        assert!(
            view.contains("Jun and Mara and Skull are here with me."),
            "{view}"
        );
        assert!(!view.contains("alone"));
        assert!(view.contains("I have spoken 2 times in a row here."));
        assert!(view.contains("I last spoke here 2 minutes ago."));
        assert!(view.contains("It was quiet here for 5 minutes before this."));
        assert_eq!(view.matches("Reply with").count(), 0);
    }

    #[test]
    fn awareness_follows_the_contract() {
        let residents = cast("lonely-forest").unwrap();
        let mut asked = request(json!([{"author": "Mara", "text": "Hi."}]));
        asked.channel.active = vec!["x".repeat(33)];
        assert!(validate(&asked, &residents).is_err());
        asked.channel.active = vec!["Mara".into(); 13];
        assert!(validate(&asked, &residents).is_err());
        let with = |residents: Value| {
            serde_json::from_value::<LinesRequest>(json!({
                "pack": "lonely-forest",
                "messages": [{"author": "Mara", "text": "Hi."}],
                "channel": {"residents": residents}
            }))
        };
        let ok = with(json!([{"id": "rati", "lines": ["a", "b", "c"]}])).unwrap();
        assert!(validate(&ok, &residents).is_ok());
        let long = with(json!([{"id": "rati", "lines": ["a", "b", "c", "d"]}])).unwrap();
        assert!(validate(&long, &residents).is_err());
        let stranger = with(json!([{"id": "mara"}])).unwrap();
        assert!(validate(&stranger, &residents).is_err());
        assert!(with(json!([{"id": "rati", "text": "x"}])).is_err());
    }

    #[tokio::test]
    async fn a_resident_answers_another_resident_who_named_it() {
        let reply = "Only the wind.";
        let body = json!({
            "pack": "lonely-forest",
            "addressed": "rati",
            "messages": [
                {"author": "Jun", "text": "Is anyone awake?"},
                {"resident": "skull", "text": "RATi, did you hear that?"}
            ]
        });
        let (status, answer, requests) = post_lines("{}", Some(reply), TOKEN, body).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(answer["lines"][0]["id"], "rati");
        assert!(requests.iter().all(|r| r.get("questions").is_none()));
        assert_eq!(
            turn_of(&requests[0], "user"),
            "Skull says, \u{201c}RATi, did you hear that?\u{201d}"
        );
    }

    #[test]
    fn a_line_without_an_ending_is_unfinished() {
        for text in [
            "And then",
            "Wait\u{2026}",
            "Well...",
            "I mean -",
            "So\u{2014}",
            "First,",
        ] {
            assert!(unfinished(text), "{text}");
        }
        for text in [
            "Come in.",
            "Who?",
            "Go!",
            "Night \u{1f319}",
            "\u{201c}Yes.\u{201d}",
        ] {
            assert!(!unfinished(text), "{text}");
        }
    }

    fn going(last: &str) -> Value {
        json!({
            "pack": "lonely-forest",
            "continuing": "rati",
            "messages": [
                {"author": "Jun", "text": "RATi, can I come in?"},
                {"resident": "rati", "text": last}
            ]
        })
    }

    #[tokio::test]
    async fn an_unfinished_line_continues_without_an_intent_call() {
        let reply = "the kettle is still warm.";
        let (status, body, requests) =
            post_lines("{}", Some(reply), TOKEN, going("The door sticks, but")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["lines"][0]["text"], reply);
        assert!(requests.iter().all(|r| r.get("questions").is_none()));
        assert_eq!(
            turn_of(&requests[0], "user"),
            "Jun says, \u{201c}RATi, can I come in?\u{201d}"
        );
        assert!(prompt_of(&requests[0]).contains("I said: \"The door sticks, but\""));
    }

    #[tokio::test]
    async fn a_finished_line_asks_whether_the_same_resident_goes_on() {
        let no = r#"{"answers": {"goes_on": {"type": "noul", "noul": 0.2}}}"#;
        let (status, body, requests) =
            post_lines(no, Some("More."), TOKEN, going("Come in.")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": [], "reason": "no-speaker"}));
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0]["questions"]["goes_on"]["type"], "noul");
        let yes = r#"{"answers": {"goes_on": {"type": "noul", "noul": 0.8}}}"#;
        let (_, body, _) = post_lines(yes, Some("More."), TOKEN, going("Come in.")).await;
        assert_eq!(body["lines"][0]["id"], "rati");
    }

    async fn post_coordinate(answer: &'static str, body: Value) -> (StatusCode, Value, Vec<Value>) {
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (address, server) = serve(provider(seen.clone(), answer, None)).await;
        let app = router_with_models::<()>(
            Arc::new(Some(intent_config(address))),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        );
        let request = Request::post("/discord/coordinate")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {TOKEN}"))
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap();
        let (status, body) = read(app.oneshot(request).await.unwrap()).await;
        server.abort();
        let requests = seen.lock().unwrap().clone();
        (status, body, requests)
    }

    fn met() -> Value {
        json!({
            "pack": "lonely-forest",
            "residents": ["vale", "rati"],
            "people": ["Ash"],
            "state": {
                "notes": {"topic": "meeting"},
                "residents": {"vale": {"streak": 0}},
                "history": [
                    {"person": "Ash", "text": "evening all", "ago": 40},
                    {"person": "Ash", "text": "Vale have you met RATi?", "ago": 2, "named": ["Vale", "RATi"]}
                ]
            }
        })
    }

    #[tokio::test]
    async fn the_coordinator_asks_jev_once_and_returns_typed_answers() {
        let answer = r#"{"answers": {
            "owed": {"type": "choice", "choice": "vale", "probabilities": {"vale": 0.9}, "confidence": 0.876},
            "for_resident": {"type": "noul", "noul": 0.97},
            "respond_vale": {"type": "noul", "noul": 0.93},
            "respond_rati": {"type": "noul", "noul": 0.71},
            "in_vale": {"type": "noul", "noul": 0.9},
            "in_rati": {"type": "noul", "noul": 0.4},
            "in_p0": {"type": "noul", "noul": 0.99}
        }, "usage": {"cost": 0.000017}}"#;
        let (status, body, requests) = post_coordinate(answer, met()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"reason": "ok", "answers": {
                "owed": {"choice": "vale", "confidence": 0.88},
                "for_resident": 0.97,
                "respond": {"vale": 0.93, "rati": 0.71},
                "members": {"vale": 0.9, "rati": 0.4, "Ash": 0.99}
            }})
        );
        assert_eq!(requests.len(), 1);
        let asked = &requests[0];
        assert_eq!(asked["questions"].as_object().unwrap().len(), 7);
        let state = &asked["state"];
        assert_eq!(state["notes"]["topic"], "meeting");
        assert_eq!(state["residents"]["vale"]["streak"], 0);
        assert_eq!(state["residents"]["vale"]["profile"]["name"], "Vale");
        assert_eq!(
            state["history"][1],
            json!({"speaker": "Ash", "role": "person", "text": "Vale have you met RATi?", "ago": 2, "named": ["Vale", "RATi"]})
        );
    }

    #[tokio::test]
    async fn a_failed_or_empty_jev_call_returns_a_reason() {
        let (status, body, _) = post_coordinate("not json", met()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"answers": null, "reason": "jev-http-500"}));
        let mut impostor = met();
        impostor["state"]["history"][0]["person"] = json!("RATi");
        let (_, body, asked) = post_coordinate(r#"{"answers": {}}"#, impostor).await;
        assert_eq!(body, json!({"answers": null, "reason": "jev-shape"}));
        assert_eq!(asked[0]["state"]["history"][0]["speaker"], "Someone");
        let (_, body, _) = post_coordinate(r#"{"nothing": 1}"#, met()).await;
        assert_eq!(body, json!({"answers": null, "reason": "jev-shape"}));
    }

    #[tokio::test]
    async fn a_bad_coordinate_request_reaches_no_model() {
        let mut stranger = met();
        stranger["residents"] = json!(["mara"]);
        let mut empty = met();
        empty["state"]["history"] = json!([]);
        let mut both = met();
        both["state"]["history"][0]["resident"] = json!("vale");
        let mut long = met();
        long["state"]["history"][0]["text"] = json!("s".repeat(401));
        for body in [stranger, empty, both, long] {
            let (status, _, requests) = post_coordinate("{}", body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(requests.is_empty());
        }
    }

    #[test]
    fn a_long_history_is_trimmed_from_the_oldest_line() {
        let line = json!({"speaker": "Ash", "role": "person", "text": "a".repeat(400)});
        let mut state = json!({"history": vec![line; 400]});
        let questions = json!({"owed": {"type": "noul", "instructions": "x"}});
        let tokens = system_one::fit(&mut state, &questions);
        assert!(tokens <= system_one::TOKENS_PER_QUESTION);
        assert!(state["history"].as_array().unwrap().len() < 400);
    }

    #[tokio::test]
    async fn a_bad_token_reaches_no_model() {
        let (status, body, requests) = post_lines(
            speak_answer("rati", 0.9),
            Some("Hello."),
            WRONG,
            talk(Some("rati")),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({"error": "unauthorized"}));
        assert!(requests.is_empty());
    }

    #[test]
    fn discord_spend_has_minute_hour_and_day_budgets() {
        let start = Instant::now();
        let mut limits = RateLimiter::default();
        for _ in 0..LIMIT.max_hits {
            assert!(spend(&mut limits, start));
        }
        assert!(!spend(&mut limits, start));
        let mut limits = RateLimiter::default();
        let mut admitted = 0;
        for call in 0..PER_HOUR.max_hits as u64 + 20 {
            if spend(&mut limits, start + Duration::from_secs(call * 3)) {
                admitted += 1;
            }
        }
        assert_eq!(admitted, PER_HOUR.max_hits);
        let mut limits = RateLimiter::default();
        let mut admitted = 0;
        for call in 0..PER_DAY.max_hits as u64 + 20 {
            if spend(&mut limits, start + Duration::from_secs(call * 13)) {
                admitted += 1;
            }
        }
        assert_eq!(admitted, PER_DAY.max_hits);
        const { assert!(PER_HOUR.max_hits * 4 <= super::super::PER_HOUR.max_hits) };
        const { assert!(PER_DAY.max_hits < PER_HOUR.max_hits * 24) };
    }

    #[tokio::test]
    async fn the_thirty_first_call_in_a_minute_is_refused() {
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let app = router_with_models::<()>(
            Arc::new(None),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        );
        let body = serde_json::to_vec(&talk(None)).unwrap();
        let post = || {
            Request::post("/discord/lines")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::from(body.clone()))
                .unwrap()
        };
        for _ in 0..LIMIT.max_hits {
            let (status, body) = read(app.clone().oneshot(post()).await.unwrap()).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(body, json!({"lines": [], "reason": "not-configured"}));
        }
        let (status, _) = read(app.clone().oneshot(post()).await.unwrap()).await;
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }

    fn slots() -> TextState {
        TextState {
            background: Arc::new(super::super::reflections::Queue::new(1)),
            ai: Arc::new(None),
            character_models: Arc::new(Ok(BTreeMap::new())),
            settings: Arc::new(Ok(VoiceSettings::hosted())),
            limits: Arc::new(Mutex::new(RateLimiter::default())),
            in_flight: Arc::new(super::super::InFlight::default()),
            capacity: Arc::new(tokio::sync::Semaphore::new(super::super::TOTAL_CONCURRENCY)),
            discord_capacity: Arc::new(tokio::sync::Semaphore::new(CONCURRENCY)),
        }
    }

    #[tokio::test]
    async fn discord_holds_at_most_one_shared_slot() {
        let state = slots();
        let held = enter(&state, Duration::ZERO).await.expect("a free slot");
        assert!(enter(&state, Duration::ZERO).await.is_none());
        assert_eq!(
            state.capacity.available_permits(),
            super::super::TOTAL_CONCURRENCY - 1
        );
        drop(held);
        let players: Vec<_> = (0..super::super::TOTAL_CONCURRENCY)
            .map(|_| state.capacity.clone().try_acquire_owned().unwrap())
            .collect();
        assert!(enter(&state, Duration::ZERO).await.is_none());
        assert_eq!(state.discord_capacity.available_permits(), CONCURRENCY);
        drop(players);
        assert!(enter(&state, Duration::ZERO).await.is_some());
    }

    #[tokio::test]
    async fn an_addressed_request_waits_briefly_for_the_slot() {
        let state = slots();
        let held = enter(&state, Duration::ZERO).await.expect("a free slot");
        assert!(enter(&state, Duration::from_millis(20)).await.is_none());
        let waiting = {
            let state = state.clone();
            tokio::spawn(async move { enter(&state, ADDRESSED_WAIT).await.is_some() })
        };
        tokio::time::sleep(Duration::from_millis(30)).await;
        drop(held);
        assert!(waiting.await.unwrap());
    }

    #[test]
    fn addressed_lines_use_tighter_hosted_deadlines() {
        let hosted = VoiceSettings::hosted();
        let tight = brisk(hosted.clone());
        assert_eq!(tight.call_timeout, ADDRESSED_CALL);
        assert_eq!(tight.scene_timeout, ADDRESSED_SCENE);
        assert_eq!(tight.attempts, 1);
        assert_eq!(tight.fallback_models, hosted.fallback_models);
        assert_eq!(tight.reflection_model, hosted.reflection_model);
        assert!(ADDRESSED_CALL < hosted.call_timeout && ADDRESSED_SCENE < hosted.scene_timeout);
        assert_eq!(brisk(VoiceSettings::local()), VoiceSettings::local());
    }

    async fn read(response: Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn the_cast_route_needs_the_token_and_a_known_pack() {
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let app = router_with_models::<()>(
            Arc::new(None),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        );
        let get = |uri: &str, token: &str| {
            Request::get(uri)
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };
        let (status, body) = read(
            app.clone()
                .oneshot(get("/discord/cast?pack=lonely-forest", TOKEN))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["pack"], "lonely-forest");
        let residents = body["residents"].as_array().unwrap();
        assert_eq!(residents.len(), 7);
        assert!(residents.contains(&json!({
            "id": "rati",
            "name": "RATi",
            "portrait": "/card-game/assets/lonely-forest/rati.png",
            "avatar": "/card-game/assets/faces/lonely-forest-rati.webp"
        })));
        let (status, body) = read(
            app.clone()
                .oneshot(get("/discord/cast?pack=nowhere", TOKEN))
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body, json!({"error": "unknown pack"}));
        let (status, _) = read(app.oneshot(get("/discord/cast", WRONG)).await.unwrap()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
