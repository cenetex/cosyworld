use super::{
    bounded, complete_selected, error, kind, name, profiles, system_one, voice_scenes, Context,
    TextState, VoiceSettings,
};
use crate::ai_gateway::{
    request_chat_completion, AiConfig, ChatCompletionRequest, ModelCapability,
};
use crate::rate_limit::{RateLimit, RateLimiter};
use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use cosyworld_orchestrator::card_assets;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};
use tokio::sync::OwnedSemaphorePermit;
#[path = "channel_cast.rs"]
mod cast_scope;
#[path = "channel_ways.rs"]
mod ways;
use cast_scope::{
    cast, chosen_names, guild_talked, joined, knows_listener, room_cast, CORE, LISTENER,
};
#[cfg(test)]
use cast_scope::{face_avatar, recent, resident, TALKED};

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
const SCENE_MESSAGES: usize = 12;
const ADDRESSED_WAIT: Duration = Duration::from_secs(3);
const ADDRESSED_CALL: Duration = Duration::from_secs(6);
const ADDRESSED_SCENE: Duration = Duration::from_secs(9);
const CANDIDATES: usize = 8;
const PEOPLE: usize = 12;
const HISTORY: usize = 200;
const SHARES: &str = "[shares an image]";
const IMAGE_HOSTS: [&str; 2] = ["cdn.discordapp.com", "media.discordapp.net"];
const IMAGES_PER_MESSAGE: usize = 2;
const IMAGES_PER_REQUEST: usize = 4;
const REPLIES_PER_MESSAGE: usize = 2;

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
    #[serde(default)]
    guild: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    resident: Option<String>,
    #[serde(default)]
    text: String,
    #[serde(default)]
    images: Vec<String>,
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
    #[serde(default)]
    notes: Option<Notes>,
    #[serde(default)]
    guild: Option<String>,
    #[serde(skip)]
    view: Option<Value>,
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
        serde_json::from_str(card_assets::text("card-game/packs.json"))
            .expect("embedded card world packs")
    })
}

fn pack(pack_id: &str) -> Option<&'static Value> {
    packs()["packs"]
        .as_array()?
        .iter()
        .find(|p| p["id"] == pack_id)
}

fn forest_data() -> &'static Value {
    static FOREST: OnceLock<Value> = OnceLock::new();
    FOREST.get_or_init(|| {
        serde_json::from_str(card_assets::text("card-game/forest.json")).expect("embedded forest")
    })
}

struct Atlas {
    places: Map<String, Value>,
    items: Vec<(String, String)>,
}

fn atlas(pack_id: &str) -> Atlas {
    let forest = forest_data();
    let world = pack(pack_id);
    let mut places = Map::new();
    for list in [Some(&forest["places"]), world.map(|p| &p["places"])]
        .into_iter()
        .flatten()
    {
        for (id, place) in list.as_object().into_iter().flatten() {
            let paths = place["exits"].as_array().cloned().unwrap_or_default();
            places.insert(
                id.clone(),
                json!({"name": place["name"],
                    "text": place.get("text").or_else(|| place.get("persona")).unwrap_or(&place["seed"]),
                    "paths": paths}),
            );
        }
    }
    let routes = ways::routes(world);
    for (from, to) in routes.filter_map(|r| Some((r["from"].as_str()?, r["to"].as_str()?))) {
        if let Some(paths) = places.get_mut(from).and_then(|p| p["paths"].as_array_mut()) {
            if !paths.contains(&json!(to)) {
                paths.push(json!(to));
            }
        }
    }
    let mut items: Vec<(String, String)> = world
        .and_then(|p| p["items"].as_object())
        .into_iter()
        .flatten()
        .filter_map(|(id, item)| Some((id.clone(), item["holder"].as_str()?.to_string())))
        .collect();
    for id in forest["things"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, _)| id)
    {
        if let Some(holder) = forest["initialState"]["items"][id]["holder"].as_str() {
            items.push((id.clone(), holder.to_string()));
        }
    }
    Atlas { places, items }
}

impl Atlas {
    fn name(&self, id: &str) -> String {
        let place = self.places.get(id).or_else(|| mounted(id));
        let place = place.and_then(|p| p["name"].as_str());
        place.unwrap_or(id).to_string()
    }

    fn paths(&self, id: &str) -> Vec<String> {
        let paths = self.places.get(id).and_then(|p| p["paths"].as_array());
        paths
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|to| self.name(to))
            .collect()
    }

    fn held(&self, id: &str) -> Vec<String> {
        let held = self.items.iter().filter(|(_, holder)| holder == id);
        held.map(|(item, _)| item.clone()).collect()
    }
}

async fn live(guild: Option<String>, residents: Vec<String>) -> Option<Value> {
    let guild = guild?;
    let read = move || crate::card_shared::guild_view(&guild, &residents);
    tokio::task::spawn_blocking(read).await.ok().flatten()
}

fn standing<'a>(resident: &'a Resident, view: Option<&'a Value>) -> &'a str {
    view.and_then(|seen| seen["place"].as_str())
        .filter(|place| kind(place, "location"))
        .unwrap_or(&resident.place)
}

fn mounted(id: &str) -> Option<&'static Value> {
    let all = packs()["packs"].as_array()?;
    all.iter().find_map(|p| p["places"].get(id))
}

fn strings(ids: &Value) -> Vec<String> {
    let all = ids.as_array().into_iter().flatten();
    all.filter_map(Value::as_str).map(str::to_string).collect()
}

fn talk(resident: &Resident, pack_id: &str, view: Option<&Value>) -> (Vec<String>, Value) {
    let at = standing(resident, view).to_string();
    let start = atlas(pack_id);
    let (holds, here, ground) = match view {
        Some(seen) => (
            strings(&seen["holds"]),
            strings(&seen["here"]),
            strings(&seen["items"]),
        ),
        None => (start.held(&resident.id), Vec::new(), start.held(&at)),
    };
    let facts = view
        .into_iter()
        .flat_map(|seen| [&seen["own"], &seen["known"]]);
    let facts = facts
        .flat_map(strings)
        .filter(|f| bounded(f, 240))
        .collect();
    let avatar = |id: &str, holding: &[String]| json!({"id": id, "location": &at, "holding": holding, "travel": null});
    let mut avatars = vec![avatar(&resident.id, &holds)];
    avatars.extend(
        here.iter()
            .filter(|id| kind(id, "avatar"))
            .map(|id| avatar(id, &[])),
    );
    let item = |id: &String, holder: &str| json!({"id": id, "holder": holder, "location": &at});
    let held = holds.iter().map(|id| item(id, &resident.id));
    let items: Vec<Value> = held.chain(ground.iter().map(|id| item(id, &at))).collect();
    let card = json!({"kind": "talk", "target": &resident.id, "item": null,
        "receive": null, "destination": null, "accepted": null});
    (
        facts,
        json!({"card": card, "avatars": avatars, "items": items}),
    )
}

fn world(pack_id: &str, cast: &[Resident]) -> Value {
    let world = atlas(pack_id);
    let places: Vec<Value> = world
        .places
        .iter()
        .map(|(id, place)| {
            let items: Vec<String> = world.held(id).iter().map(|item| name(item)).collect();
            json!({"name": place["name"], "text": place["text"], "paths": world.paths(id), "items": items})
        })
        .collect();
    let homes: Map<String, Value> = cast
        .iter()
        .map(|r| (r.name.clone(), json!(world.name(&r.place))))
        .collect();
    json!({"places": places, "homes": homes})
}

fn discord_image(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|parsed| {
        url.len() <= 2048
            && parsed.scheme() == "https"
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.port().is_none()
            && parsed
                .host_str()
                .is_some_and(|host| IMAGE_HOSTS.contains(&host))
    })
}

fn shown(text: &str, images: &[String]) -> Option<String> {
    if images.len() > IMAGES_PER_MESSAGE || !images.iter().all(|url| discord_image(url)) {
        return None;
    }
    match (images.is_empty(), text.is_empty()) {
        (true, _) => bounded(text, 400).then(|| text.to_string()),
        (false, true) => Some(SHARES.into()),
        (false, false) => bounded(text, 400).then(|| format!("{text} {SHARES}")),
    }
}

fn pictures(messages: &[Message]) -> usize {
    messages.iter().map(|m| m.images.len()).sum()
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
        if shown(&message.text, &message.images).is_none() {
            return Err("each text needs 1 to 400 characters or 1 to 2 Discord images");
        }
    }
    if pictures(&request.messages) > IMAGES_PER_REQUEST {
        return Err("send at most 4 images");
    }
    if request.notes.as_ref().is_some_and(|notes| !sound(notes)) {
        return Err("notes must be bounded");
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
    let last = request.messages.last().and_then(|m| m.resident.as_deref());
    match (request.addressed.as_deref(), request.continuing.as_deref()) {
        (Some(id), None) if member(id) => Ok(()),
        (None, Some(id)) if last == Some(id) => Ok(()),
        (None, Some(_)) => Err("the last message must be the continuing resident's"),
        _ => Err("addressed or continuing must be one resident of the cast"),
    }
}

fn shared_cast() -> &'static Value {
    static SHARED: OnceLock<Value> = OnceLock::new();
    SHARED.get_or_init(|| {
        serde_json::from_str(card_assets::text("card-game/shared-cast.json")).expect("shared cast")
    })
}

fn travelers() -> &'static std::collections::BTreeSet<String> {
    static TRAVELERS: std::sync::OnceLock<std::collections::BTreeSet<String>> =
        std::sync::OnceLock::new();
    TRAVELERS.get_or_init(|| {
        shared_cast()["avatars"]
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

fn thread(notes: &Notes) -> Vec<String> {
    let cut = |text: String| text.chars().take(240).collect::<String>();
    vec![
        format!(
            "We have been talking about {}.",
            notes.topic.trim().trim_end_matches('.')
        ),
        cut(format!("So far here: {}", notes.summary.trim())),
    ]
}

fn present(resident: &Resident, cast: &[Resident], request: &LinesRequest) -> Vec<String> {
    let heard = |id: &str| cast_scope::heard_as(id, resident, cast);
    let spoken = request.messages.iter().rev().map(|m| match &m.resident {
        Some(id) => heard(id),
        None => label(m.author.as_deref().unwrap_or_default()),
    });
    let active = request.channel.active.iter().map(|name| heard(name));
    let mut here: Vec<String> = Vec::new();
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
    let (mut facts, mut memories) = awareness(resident, &request.channel);
    memories.retain(|memory| {
        !messages[start..].iter().any(|m| {
            m.resident.as_ref() == Some(&resident.id)
                && memory["text"].as_str() == Some(&format!("{}: {}", resident.name, m.text))
        })
    });
    if let Some(notes) = &request.notes {
        facts.extend(thread(notes));
    }
    let view = request.view.as_ref();
    let (own, outcome) = talk(resident, &request.pack, view);
    facts.extend(own.into_iter().chain(cast_scope::chosen_fact(resident)));
    let at = standing(resident, view);
    for line in view
        .and_then(|seen| seen["lines"].as_array())
        .into_iter()
        .flatten()
    {
        let speaker = cast_scope::called(line["speaker"].as_str().unwrap_or("Someone"), cast);
        let said = format!("{speaker}: {}", line["text"].as_str().unwrap_or("…"));
        let text: String = said.chars().take(400).collect();
        memories.push(json!({"turn": 1, "kind": "event", "text": text}));
    }
    let conversation: Vec<Value> = messages[start..]
        .iter()
        .map(|m| {
            let actor = m.resident.as_deref().map_or_else(
                || label(m.author.as_deref().unwrap_or_default()),
                |id| cast_scope::heard_as(id, resident, cast),
            );
            let text = shown(&m.text, &m.images).unwrap_or_default();
            json!({"witnesses": [&resident.id], "actorId": actor, "text": text})
        })
        .collect();
    let mut context: Context = serde_json::from_value(json!({
        "revision": 1,
        "turn": 1,
        "location": at,
        "scenery": false,
        "focus": null,
        "speakers": [&resident.id],
        "entities": [
            {"id": &resident.id, "facts": facts, "desire": null, "memories": memories, "previous": null},
            {"id": at, "facts": [], "desire": null, "memories": [], "previous": null}
        ],
        "conversation": conversation,
        "outcome": outcome
    }))
    .ok()?;
    let mut others = context.conversation.iter().rev().map(|line| &line.actor_id);
    let answered = others.find(|actor| **actor != resident.id).cloned();
    context.acting_avatar = Some(answered.unwrap_or_else(|| "Someone".into()));
    context.channel = true;
    context.present = present(resident, cast, request);
    context.images = messages[start..]
        .iter()
        .flat_map(|m| m.images.iter().cloned())
        .collect();
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
    settings
}

fn spend(limits: &mut RateLimiter, now: Instant) -> bool {
    limits.allow("discord".into(), LIMIT, now)
        && limits.allow("discord-hour".into(), PER_HOUR, now)
        && limits.allow("discord-day".into(), PER_DAY, now)
}

fn admission_error(state: &TextState, headers: &HeaderMap, kind: &str) -> Option<Response> {
    let token = std::env::var("COSYWORLD_BOT_TOKEN").ok();
    if !authorized(headers, token.as_deref()) {
        return Some(error(StatusCode::UNAUTHORIZED, "unauthorized"));
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
    (!allowed).then(|| error(StatusCode::TOO_MANY_REQUESTS, "busy"))
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
    app: Option<Extension<crate::AppState>>,
    headers: HeaderMap,
    query: Result<Query<CastQuery>, QueryRejection>,
) -> Response {
    if let Some(refused) = admission_error(&state, &headers, "cast") {
        return refused;
    }
    let Ok(Query(query)) = query else {
        return error(StatusCode::BAD_REQUEST, "unreadable query");
    };
    let pack_id = query.pack.unwrap_or_else(|| DEFAULT_PACK.into());
    match room_cast(&pack_id, query.guild).await {
        Some((mut residents, _)) => {
            chosen_names(app.as_deref(), &mut residents).await;
            (
                [("cache-control", "no-store")],
                Json(json!({"pack": pack_id, "residents": residents})),
            )
                .into_response()
        }
        None => error(StatusCode::NOT_FOUND, "unknown pack"),
    }
}

pub(super) async fn lines(
    State(state): State<TextState>,
    app: Option<Extension<crate::AppState>>,
    headers: HeaderMap,
    request: Result<Json<LinesRequest>, JsonRejection>,
) -> Response {
    if let Some(refused) = admission_error(&state, &headers, "lines") {
        return refused;
    }
    let mut request = match request {
        Ok(Json(request)) => request,
        Err(rejection) if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE => {
            return rejection.into_response()
        }
        Err(_) => return error(StatusCode::BAD_REQUEST, "unreadable request"),
    };
    let Some(residents) = cast(&request.pack) else {
        return error(StatusCode::BAD_REQUEST, "unknown pack");
    };
    let named = [&request.addressed, &request.continuing]
        .into_iter()
        .flatten()
        .cloned();
    let spoke = request.messages.iter().filter_map(|m| m.resident.clone());
    let recalled = request.channel.residents.iter().map(|r| r.id.clone());
    let ids = named.chain(spoke).chain(recalled);
    let listener_known = ids.clone().any(|id| id == LISTENER)
        && guild_talked(request.guild.clone())
            .await
            .as_deref()
            .is_some_and(knows_listener);
    let mut residents = joined(residents, ids, listener_known);
    chosen_names(app.as_deref(), &mut residents).await;
    if let Err(message) = validate(&request, &residents) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    let replies = request.messages.iter().rev();
    if replies.take_while(|m| m.resident.is_some()).count() >= REPLIES_PER_MESSAGE {
        return silent("enough");
    }
    let Some(config) = state.ai.as_ref().as_ref() else {
        return silent("not-configured");
    };
    let Some(_permits) = enter(&state, ADDRESSED_WAIT).await else {
        return silent("busy");
    };
    let Some(resident) = residents
        .iter()
        .find(|r| request.addressed.as_ref().or(request.continuing.as_ref()) == Some(&r.id))
    else {
        return silent("no-speaker");
    };
    let seen = live(request.guild.clone(), vec![resident.id.clone()]).await;
    request.view = seen.and_then(|mut all| all.get_mut(&resident.id).map(Value::take));
    let text = match speak(&state, config, resident, &residents, &request, true).await {
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
    state: Map<String, Value>,
    #[serde(default)]
    guild: Option<String>,
    #[serde(skip)]
    live: Option<Value>,
}

fn arranged(request: &CoordinateRequest, cast: &[Resident]) -> Option<Value> {
    let member = |id: &str| cast.iter().find(|r| r.id == id);
    let fits = (1..=CANDIDATES).contains(&request.residents.len())
        && request.residents.iter().all(|id| member(id).is_some());
    let lines = request.state.get("history")?.as_array()?;
    if !fits || lines.is_empty() || lines.len() > HISTORY {
        return None;
    }
    let mut history = Vec::with_capacity(lines.len());
    let mut images = 0;
    for line in lines {
        let mut line = line.as_object()?.clone();
        let seen: Vec<String> = match line.remove("images") {
            Some(value) => serde_json::from_value(value).ok()?,
            None => Vec::new(),
        };
        images += seen.len();
        let text = shown(line.get("text")?.as_str()?, &seen)?;
        line.insert("text".into(), json!(text));
        let (speaker, role) = match (line.remove("resident"), line.remove("person")) {
            (Some(Value::String(id)), None) => (member(&id)?.name.clone(), "resident"),
            (None, Some(Value::String(name))) if bounded(&name, 32) => (label(&name), "person"),
            _ => return None,
        };
        line.insert("speaker".into(), json!(speaker));
        line.insert("role".into(), json!(role));
        history.push(Value::Object(line));
    }
    if images > IMAGES_PER_REQUEST {
        return None;
    }
    let mut state = request.state.clone();
    state.remove("previous");
    if let Some(last) = history.last() {
        state.insert(
            "last".into(),
            json!({"speaker": last["speaker"], "role": last["role"], "text": last["text"]}),
        );
    }
    if let Some(at) = history.iter().rposition(|l| l["role"] == "person") {
        let replied = history[at + 1..].iter().any(|l| l["role"] == "resident");
        state.insert("answered".into(), json!(replied));
    }
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
    let mut seen = world(&request.pack, cast);
    if let Some(live) = &request.live {
        let now = cast.iter().filter_map(|r| {
            let place = &profiles()[live[&r.id]["place"].as_str()?]["name"];
            Some((r.name.clone(), place.clone()))
        });
        seen["now"] = Value::Object(now.collect());
    }
    state.insert("world".into(), seen);
    Some(Value::Object(state))
}

fn people(request: &CoordinateRequest) -> Vec<String> {
    let lines = request.state.get("history").and_then(Value::as_array);
    let mut seen: Vec<String> = Vec::new();
    for line in lines.into_iter().flatten().rev() {
        let Some(name) = line.get("person").and_then(Value::as_str) else {
            continue;
        };
        let name = label(name);
        if seen.len() < PEOPLE && !seen.contains(&name) {
            seen.push(name);
        }
    }
    seen
}

fn asked(request: &CoordinateRequest, cast: &[Resident]) -> Value {
    let mut criteria: Map<String, Value> = cast
        .iter()
        .filter(|r| request.residents.contains(&r.id))
        .map(|r| {
            (
                r.id.clone(),
                json!(format!(
                    "{} speaks next: addressed, asked, or has a natural reply",
                    r.name
                )),
            )
        })
        .collect();
    for name in people(request) {
        criteria.insert(
            format!("person:{name}"),
            json!(format!(
                "{name}, a person, speaks next: still mid-thought, or the people talk among themselves"
            )),
        );
    }
    criteria.insert(
        "person:other".into(),
        json!("Someone else, a person not listed, speaks next"),
    );
    criteria.insert(
        "none".into(),
        json!("Nobody speaks next: nothing waits for an answer"),
    );
    json!({"next": {"type": "choice", "instructions": "Who speaks next in this chat?", "criteria": criteria}})
}

fn answered(request: &CoordinateRequest, answers: &Map<String, Value>) -> Option<Value> {
    let rounded = |p: f64| (p * 100.0).round() / 100.0;
    let (choice, confidence) = system_one::choice(answers, "next")?;
    let resident = |id: &str| request.residents.iter().any(|r| r == id);
    let odds = answers["next"]["probabilities"].as_object()?;
    let kept = |id: &str| resident(id) || id == "none";
    let chance = |id: &str| odds.get(id).and_then(Value::as_f64);
    let probabilities: Map<String, Value> = odds
        .keys()
        .filter(|id| kept(id.as_str()))
        .filter_map(|id| Some((id.clone(), json!(rounded(chance(id.as_str())?)))))
        .collect();
    let people: f64 = odds
        .keys()
        .filter(|id| !kept(id.as_str()))
        .filter_map(|id| chance(id.as_str()))
        .sum::<f64>()
        .min(1.0);
    let nobody = chance("none").unwrap_or(0.0);
    let best = request
        .residents
        .iter()
        .filter_map(|id| Some((id.as_str(), chance(id.as_str())?)))
        .max_by(|a, b| a.1.total_cmp(&b.1));
    let (choice, confidence) = match best {
        _ if kept(choice) => (choice, confidence),
        Some((id, p)) if p >= nobody => (id, p),
        _ => ("none", nobody),
    };
    let next = json!({"choice": choice, "confidence": rounded(confidence),
        "probabilities": probabilities, "people": rounded(people)});
    Some(json!({"next": next}))
}

pub(super) async fn coordinate(
    State(state): State<TextState>,
    app: Option<Extension<crate::AppState>>,
    headers: HeaderMap,
    request: Result<Json<CoordinateRequest>, JsonRejection>,
) -> Response {
    if let Some(refused) = admission_error(&state, &headers, "coordinate") {
        return refused;
    }
    let Ok(Json(mut request)) = request else {
        return error(StatusCode::BAD_REQUEST, "unreadable request");
    };
    let Some((residents, listener_known)) = room_cast(&request.pack, request.guild.clone()).await
    else {
        return error(StatusCode::BAD_REQUEST, "unknown pack");
    };
    let history = request.state.get("history").and_then(Value::as_array);
    let spoke = history
        .into_iter()
        .flatten()
        .filter_map(|l| l["resident"].as_str());
    let spoke: Vec<String> = spoke.map(str::to_string).collect();
    let residents = joined(
        residents,
        request.residents.iter().cloned().chain(spoke),
        listener_known,
    );
    let mut residents = residents;
    chosen_names(app.as_deref(), &mut residents).await;
    let ids = residents.iter().map(|r| r.id.clone()).collect();
    request.live = live(request.guild.clone(), ids).await;
    let Some(mut view) = arranged(&request, &residents) else {
        return error(
            StatusCode::BAD_REQUEST,
            "send 1 to 8 residents and 1 to 200 history lines",
        );
    };
    let Some(config) = state.ai.as_ref().as_ref() else {
        return coordinated(None, "not-configured".into());
    };
    let questions = asked(&request, &residents);
    let tokens = system_one::fit(&mut view, &questions);
    tracing::info!(feature = "discord", tokens, "discord coordinate state");
    match system_one::ask(config, "discord_coordinate", &view, questions).await {
        Ok(answers) => match answered(&request, &answers) {
            Some(answers) => coordinated(Some(answers), "ok".into()),
            None => coordinated(None, "jev-shape".into()),
        },
        Err(reason) => coordinated(None, reason),
    }
}

fn coordinated(answers: Option<Value>, reason: String) -> Response {
    tracing::info!(feature = "discord", reason = %reason, "discord coordinate");
    let body = json!({"answers": answers, "reason": reason});
    ([("cache-control", "no-store")], Json(body)).into_response()
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Notes {
    topic: String,
    goal: String,
    summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NotesRequest {
    pack: String,
    messages: Vec<Message>,
    #[serde(default)]
    notes: Option<Notes>,
}

fn sound(notes: &Notes) -> bool {
    bounded(&notes.topic, 40) && bounded(&notes.goal, 120) && bounded(&notes.summary, 300)
}

fn notes_model() -> String {
    std::env::var("COSYWORLD_DISCORD_NOTES_MODEL")
        .ok()
        .filter(|model| !model.trim().is_empty())
        .unwrap_or_else(|| "google/gemma-4-26b-a4b-it".into())
}

pub(super) async fn notes(
    State(state): State<TextState>,
    app: Option<Extension<crate::AppState>>,
    headers: HeaderMap,
    request: Result<Json<NotesRequest>, JsonRejection>,
) -> Response {
    if let Some(refused) = admission_error(&state, &headers, "coordinate") {
        return refused;
    }
    let Ok(Json(request)) = request else {
        return error(StatusCode::BAD_REQUEST, "unreadable request");
    };
    let Some(residents) = cast(&request.pack) else {
        return error(StatusCode::BAD_REQUEST, "unknown pack");
    };
    let spoke = request.messages.iter().filter_map(|m| m.resident.clone());
    let history_only_so_listener_known = true;
    let mut residents = joined(residents, spoke, history_only_so_listener_known);
    chosen_names(app.as_deref(), &mut residents).await;
    let fits = (1..=12).contains(&request.messages.len())
        && request.notes.as_ref().is_none_or(sound)
        && pictures(&request.messages) <= IMAGES_PER_REQUEST
        && request.messages.iter().all(|m| {
            shown(&m.text, &m.images).is_some()
                && match (&m.author, &m.resident) {
                    (Some(author), None) => bounded(author, 32),
                    (None, Some(id)) => residents.iter().any(|r| &r.id == id),
                    _ => false,
                }
        });
    if !fits {
        return error(
            StatusCode::BAD_REQUEST,
            "send 1 to 12 messages and bounded notes",
        );
    }
    let Some(config) = state.ai.as_ref().as_ref() else {
        return noted(None, "not-configured");
    };
    let mut cheap = config.clone();
    cheap
        .capability_models
        .insert(ModelCapability::WorldContent, notes_model());
    if cheap.pin_model(ModelCapability::WorldContent).is_err() {
        return noted(None, "no-model");
    }
    let before = request.notes.as_ref().map_or(String::new(), |n| {
        format!(
            "Earlier notes: {} / {} / {}\n\n",
            n.topic, n.goal, n.summary
        )
    });
    let lines = request
        .messages
        .iter()
        .map(|m| {
            let text = shown(&m.text, &m.images).unwrap_or_default();
            format!("{}: {text}", speaker(m, &residents))
        })
        .collect::<Vec<_>>()
        .join("\n");
    let text = json!({"type": "string"});
    let format = json!({
        "type": "json_schema",
        "json_schema": {
            "name": "discord_notes",
            "strict": true,
            "schema": {
                "type": "object",
                "properties": {"topic": text, "goal": text, "summary": text},
                "required": ["topic", "goal", "summary"],
                "additionalProperties": false
            }
        }
    });
    let completion = request_chat_completion(
        &cheap,
        ChatCompletionRequest {
            feature: "discord_notes",
            prompt_version: "discord-notes-v1",
            capability: ModelCapability::WorldContent,
            system: "Keep short notes on a chat: topic in a few words (at most 40 characters), what the people want (at most 120), and a summary (at most 300).",
            user: &format!("{before}{lines}"),
            temperature: 0.0,
            max_tokens: 200,
            timeout: Duration::from_secs(8),
            max_attempts: 1,
            referer: crate::ai_gateway::OPENROUTER_APP_REFERER,
            response_format: Some(&format),
            room_id: None,
        },
    )
    .await;
    match completion {
        Ok(done) => match serde_json::from_str::<Notes>(done.text.trim()) {
            Ok(notes) if sound(&notes) => noted(Some(notes), "ok"),
            _ => noted(None, "schema"),
        },
        Err(_) => noted(None, "model"),
    }
}

fn noted(notes: Option<Notes>, reason: &'static str) -> Response {
    tracing::info!(feature = "discord", reason, "discord notes");
    (
        [("cache-control", "no-store")],
        Json(json!({"notes": notes, "reason": reason})),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::super::conversation::{FOLLOW_UP, SAY_ALOUD};
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
    fn a_server_world_brings_the_characters_talked_to_most_recently() {
        let fixed = cast("lonely-forest").unwrap();
        let ids = |list: &[Resident]| list.iter().map(|r| r.id.clone()).collect::<Vec<_>>();
        let talked = ["greek-antigone", "rue", "keeper"].map(String::from);
        let three = recent(fixed.clone(), &talked);
        assert_eq!(ids(&three), talked);
        assert_eq!(three[0].name, "Antigone");
        assert_eq!(
            three[0].portrait,
            "/card-game/assets/greek-drama/chthonic-antigone.png"
        );
        assert_eq!(
            three[0].avatar.as_deref(),
            Some("/card-game/assets/faces/greek-drama-chthonic-antigone.webp")
        );
        assert_eq!(
            (three[1].name.as_str(), three[1].portrait.as_str()),
            ("Rue", "/card-game/assets/shared/characters/rue.png")
        );
        let vale = &recent(fixed.clone(), &["vale".into(), "greek-elder".into()])[0];
        assert_eq!(
            (vale.name.as_str(), vale.portrait.as_str()),
            ("Vale", "/card-game/assets/vale.png")
        );
        let many: Vec<String> = pack("greek-drama").unwrap()["avatars"]
            .as_object()
            .unwrap()
            .keys()
            .take(TALKED + 2)
            .cloned()
            .collect();
        let capped = recent(fixed.clone(), &many);
        assert_eq!(ids(&capped), many[..TALKED]);
        let few = recent(fixed.clone(), &["keeper".into(), "nobody".into()]);
        assert_eq!(few[0].id, "keeper");
        assert_eq!(few.len(), fixed.len());
        assert!(fixed
            .iter()
            .all(|r| few.iter().filter(|f| f.id == r.id).count() == 1));
        assert_eq!(recent(fixed.clone(), &[]), fixed);
    }

    #[test]
    fn a_character_from_any_pack_may_speak_in_the_room() {
        let ids = ["greek-antigone", "nobody", "keeper", "mara"].map(String::from);
        let all = joined(cast("lonely-forest").unwrap(), ids, false);
        assert_eq!(all.len(), 9);
        assert_eq!(all[7].id, "greek-antigone");
        assert_eq!(all[8].name, "Mara");
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

    #[test]
    fn every_character_who_may_speak_in_the_room_has_a_face() {
        let travellers = shared_cast()["avatars"].as_array().unwrap().iter();
        let packs = packs()["packs"].as_array().unwrap().iter();
        let ids = travellers
            .filter_map(|human| human["id"].as_str().map(str::to_string))
            .chain(packs.flat_map(|p| p["avatars"].as_object().unwrap().keys().cloned()));
        for id in ids {
            if let Some(found) = resident(&id) {
                assert!(found.avatar.is_some(), "{id} has no Discord face");
            }
        }
    }

    fn request(messages: Value) -> LinesRequest {
        serde_json::from_value(
            json!({"pack": "lonely-forest", "addressed": "rati", "messages": messages}),
        )
        .unwrap()
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
        assert!(check(json!([human, rati])).is_ok());
        let mut addressed = request(json!([human]));
        addressed.addressed = Some("mara".into());
        assert!(validate(&addressed, &residents).is_err());
        addressed.addressed = None;
        assert!(validate(&addressed, &residents).is_err());
        let mut going = request(json!([human, rati]));
        going.addressed = None;
        going.continuing = Some("rati".into());
        assert!(validate(&going, &residents).is_ok());
        going.continuing = Some("skull".into());
        assert!(validate(&going, &residents).is_err());
        going.continuing = Some("rati".into());
        going.addressed = Some("rati".into());
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
        seeing_config(address, json!(["text"]))
    }

    fn seeing_config(address: std::net::SocketAddr, inputs: Value) -> AiConfig {
        let mut config = test_config(address);
        config.registry = Some(Arc::new(
            crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
                &json!({
                    "schema_version": 1, "snapshot_version": "discord-test",
                    "declared": [{
                        "requested_model_id": "test-entity-model", "provider": "openai_compatible",
                        "concrete_model": {"model_id": "test-entity-model"},
                        "input_modalities": inputs, "output_modalities": ["text"],
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

    async fn post_lines(
        intent: &'static str,
        voice: Option<&'static str>,
        token: &str,
        body: Value,
    ) -> (StatusCode, Value, Vec<Value>) {
        post_lines_to(json!(["text"]), intent, voice, token, body).await
    }

    async fn post_lines_to(
        inputs: Value,
        intent: &'static str,
        voice: Option<&'static str>,
        token: &str,
        body: Value,
    ) -> (StatusCode, Value, Vec<Value>) {
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (address, server) = serve(provider(seen.clone(), intent, voice)).await;
        let app = router_with_models::<()>(
            Arc::new(Some(seeing_config(address, inputs))),
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
        let turns: Vec<_> = voice["messages"].as_array().unwrap().iter().collect();
        let roles: Vec<_> = turns.iter().map(|t| t["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["system", "user", "assistant", "user"]);
        let opening = format!("You are RATi, host of the cottage. {SAY_ALOUD}");
        assert_eq!(turn_of(voice, "system"), opening);
        let heard = "Jun says, \u{201c}RATi, can I come in?\u{201d}";
        assert_eq!(turn_of(voice, "user"), heard);
        let view = turn_of(voice, "assistant");
        let said = "Mara said: \"Is anyone in the cottage?\" I said: \"The kettle is on.\"";
        assert!(
            view.contains(said) && view.contains("I'm talking with Jun."),
            "{view}"
        );
        assert_eq!(prompt_of(voice).matches("Reply with").count(), 1);
    }

    #[tokio::test]
    async fn a_resident_whose_own_line_is_newest_is_asked_to_add_to_it() {
        let reply = "Mind the step, it creaks.";
        let own = "Come in, the door sticks.";
        let mut body = json!({
            "pack": "lonely-forest",
            "messages": [
                {"author": "Jun", "text": "RATi, can I come in?"},
                {"resident": "rati", "text": own}
            ]
        });
        body["continuing"] = json!("rati");
        body["channel"] = json!({"residents": [{"id": "rati", "lines": [own]}]});
        let (status, answer, requests) = post_lines("{}", Some(reply), TOKEN, body).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            answer,
            json!({"lines": [{"id": "rati", "name": "RATi", "text": reply}]})
        );
        assert_eq!(turn_of(&requests[0], "user"), FOLLOW_UP);
        let view = turn_of(&requests[0], "assistant");
        let said = format!("Jun said: \"RATi, can I come in?\" I said: \"{own}\"");
        assert!(view.contains(&said), "{view}");
    }

    #[tokio::test]
    async fn a_failed_voice_is_silence() {
        let (status, body, requests) = post_lines("{}", None, TOKEN, talk(Some("skull"))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": [], "reason": "no-line"}));
        assert!(!requests.is_empty());
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
        body["notes"] = json!({"topic": "the corridor.", "goal": "Jun wants in.", "summary": "Jun asked about the corridor."});
        let (status, answer, requests) = post_lines("{}", Some(reply), TOKEN, body).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(answer["lines"][0]["text"], reply);
        let voice = &requests[0];
        let view = turn_of(voice, "assistant");
        for line in [
            "Jun and Mara and Skull are here with me.",
            "I have spoken 2 times in a row here.",
            "I last spoke here 2 minutes ago.",
            "It was quiet here for 5 minutes before this.",
            "We have been talking about the corridor.",
            "So far here: Jun asked about the corridor.",
        ] {
            assert!(view.contains(line), "{line}: {view}");
        }
        assert!(!view.contains("alone"));
        let card = pack("lonely-forest").unwrap()["avatars"]["rati"]["text"].as_str();
        let card = card.unwrap_or("Home:");
        for authored in [card, "Home:", "Likes:", "Sore:", "Paths from home"] {
            assert!(!prompt_of(voice).contains(authored), "{authored}");
        }
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
                "addressed": "rati",
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
    async fn a_resident_answers_another_resident_who_named_it_and_two_replies_are_enough() {
        let reply = "Only the wind.";
        let mut body = json!({
            "pack": "lonely-forest",
            "addressed": "rati",
            "messages": [
                {"author": "Jun", "text": "Is anyone awake?"},
                {"resident": "skull", "text": "RATi, did you hear that?"}
            ]
        });
        let (status, answer, requests) = post_lines("{}", Some(reply), TOKEN, body.clone()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(answer["lines"][0]["id"], "rati");
        assert!(requests.iter().all(|r| r.get("questions").is_none()));
        let heard = "Skull says, \u{201c}RATi, did you hear that?\u{201d}";
        assert_eq!(turn_of(&requests[0], "user"), heard);
        assert!(turn_of(&requests[0], "assistant").contains("Jun said: \"Is anyone awake?\""));
        let line = json!({"resident": "vale", "text": "Only the owls."});
        body["messages"].as_array_mut().unwrap().push(line);
        let (_, enough, asked) = post_lines("{}", Some(reply), TOKEN, body).await;
        assert_eq!(enough, json!({"lines": [], "reason": "enough"}));
        assert!(asked.is_empty());
    }

    const PICTURE: &str = "https://cdn.discordapp.com/attachments/1/2/pond.png?ex=1&is=2&hm=3";

    fn shared(text: &str) -> Value {
        json!({
            "pack": "lonely-forest",
            "addressed": "rati",
            "messages": [
                {"author": "Mara", "text": "Is anyone in the cottage?"},
                {"author": "Jun", "text": text, "images": [PICTURE]}
            ]
        })
    }

    #[test]
    fn images_come_only_from_discord_and_stay_few() {
        let residents = cast("lonely-forest").unwrap();
        let check = |messages: Value| validate(&request(messages), &residents);
        let with = |images: Value| json!([{"author": "Mara", "text": "", "images": images}]);
        assert!(check(with(json!([PICTURE]))).is_ok());
        assert!(check(with(json!([
            "https://media.discordapp.net/attachments/1/2/a.webp"
        ])))
        .is_ok());
        assert!(check(with(json!([PICTURE, PICTURE]))).is_ok());
        assert!(check(with(json!([PICTURE, PICTURE, PICTURE]))).is_err());
        assert!(check(with(json!([
            "http://cdn.discordapp.com/attachments/1/2/a.png"
        ])))
        .is_err());
        assert!(check(with(json!(["https://example.com/a.png"]))).is_err());
        assert!(check(with(json!(["https://cdn.discordapp.com.evil.net/a.png"]))).is_err());
        assert!(check(with(json!(["https://cdn.discordapp.com:8443/a.png"]))).is_err());
        assert!(check(with(json!(["data:image/png;base64,AAAA"]))).is_err());
        assert!(check(json!([{"author": "Mara", "text": ""}])).is_err());
        let two = json!({"author": "Mara", "text": "Look.", "images": [PICTURE, PICTURE]});
        assert!(check(json!([two, two])).is_ok());
        assert!(
            check(json!([two, two, {"author": "Jun", "text": "", "images": [PICTURE]}])).is_err()
        );
        assert_eq!(shown("", &[PICTURE.into()]).as_deref(), Some(SHARES));
        assert_eq!(
            shown("Look.", &[PICTURE.into()]).as_deref(),
            Some("Look. [shares an image]")
        );
    }

    #[tokio::test]
    async fn a_seeing_model_gets_the_image_in_the_user_turn() {
        let reply = "That is the pond at dusk.";
        let (status, body, requests) = post_lines_to(
            json!(["text", "image"]),
            "{}",
            Some(reply),
            TOKEN,
            shared(""),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["lines"][0]["text"], reply);
        let voice = &requests[0];
        let user = voice["messages"].as_array().unwrap().last().unwrap();
        assert_eq!(user["role"], "user");
        assert_eq!(
            user["content"],
            json!([
                {"type": "text", "text": "Jun says, \u{201c}[shares an image]\u{201d}"},
                {"type": "image_url", "image_url": {"url": PICTURE}}
            ])
        );
        assert!(!turn_of(voice, "system").contains("image"));
        assert!(!turn_of(voice, "assistant").contains("discordapp"));
        assert!(!body.to_string().contains("discordapp"));
    }

    #[tokio::test]
    async fn a_blind_model_gets_a_placeholder_and_no_link() {
        let reply = "Oh, what have you brought?";
        let (status, body, requests) =
            post_lines("{}", Some(reply), TOKEN, shared("Look at this")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["lines"][0]["text"], reply);
        let voice = &requests[0];
        let heard = "Jun says, \u{201c}Look at this [shares an image]\u{201d}";
        assert_eq!(turn_of(voice, "user"), heard);
        assert!(!voice.to_string().contains("discordapp"));
        assert!(!body.to_string().contains("discordapp"));
    }

    #[tokio::test]
    async fn jev_reads_a_placeholder_never_the_link() {
        let answer = r#"{"answers": {"next": {"type": "choice", "choice": "vale",
            "probabilities": {"vale": 0.8, "none": 0.2}, "confidence": 0.8}}}"#;
        let mut body = met();
        body["state"]["history"][1] =
            json!({"person": "Ash", "text": "", "images": [PICTURE], "ago": 2});
        let (status, _, asked) = post_coordinate(answer, body.clone()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(asked[0]["state"]["history"][1]["text"], SHARES);
        assert!(!asked[0].to_string().contains("discordapp"));
        body["state"]["history"][0] =
            json!({"person": "Ash", "text": "", "images": [PICTURE, PICTURE, PICTURE]});
        let (status, _, asked) = post_coordinate(answer, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(asked.is_empty());
        body["state"]["history"][0] =
            json!({"person": "Ash", "text": "", "images": [PICTURE, PICTURE]});
        body["state"]["history"][1]["images"] = json!([PICTURE, PICTURE]);
        body["state"]["history"].as_array_mut().unwrap().push(
            json!({"person": "Ash", "text": "", "images": ["http://cdn.discordapp.com/a.png"]}),
        );
        let (status, _, _) = post_coordinate(answer, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
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
    async fn the_coordinator_asks_who_speaks_next() {
        let answer = r#"{"answers": {"next": {"type": "choice", "choice": "vale",
            "probabilities": {"vale": 0.876, "rati": 0.1, "none": 0, "mara": 0.0}, "confidence": 0.8}},
            "usage": {"cost": 0.000017}}"#;
        let (status, body, requests) = post_coordinate(answer, met()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            json!({"reason": "ok", "answers": {"next": {"choice": "vale", "confidence": 0.8,
                "probabilities": {"vale": 0.88, "rati": 0.1, "none": 0.0}, "people": 0.0}}})
        );
        assert_eq!(requests.len(), 1);
        let asked = &requests[0];
        assert_eq!(asked["questions"].as_object().unwrap().len(), 1);
        let criteria = asked["questions"]["next"]["criteria"].as_object().unwrap();
        assert_eq!(
            criteria.keys().collect::<Vec<_>>(),
            ["none", "person:Ash", "person:other", "rati", "vale"]
        );
        assert_eq!(
            criteria["person:Ash"],
            "Ash, a person, speaks next: still mid-thought, or the people talk among themselves"
        );
        assert_eq!(
            criteria["none"],
            "Nobody speaks next: nothing waits for an answer"
        );
        let state = &asked["state"];
        assert_eq!(state["notes"]["topic"], "meeting");
        assert_eq!(state["residents"]["vale"]["streak"], 0);
        assert_eq!(state["residents"]["vale"]["profile"]["name"], "Vale");
        assert_eq!(state["world"]["homes"]["RATi"], "Cosy Cottage");
        assert_eq!(
            state["history"][1],
            json!({"speaker": "Ash", "role": "person", "text": "Vale have you met RATi?", "ago": 2, "named": ["Vale", "RATi"]})
        );
        assert_eq!(
            state["last"],
            json!({"speaker": "Ash", "role": "person", "text": "Vale have you met RATi?"})
        );
        assert_eq!(state["answered"], false);
        let mut replied = met();
        replied["state"]["previous"] = json!({"next": {"choice": "vale"}});
        replied["state"]["history"]
            .as_array_mut()
            .unwrap()
            .push(json!({"resident": "vale", "text": "Not yet.", "ago": 1}));
        let (_, _, asked) = post_coordinate(answer, replied).await;
        let state = &asked[0]["state"];
        assert_eq!(
            state["last"],
            json!({"speaker": "Vale", "role": "resident", "text": "Not yet."})
        );
        assert_eq!(state["answered"], true);
        assert!(state.get("previous").is_none());
        let (_, body, _) = post_coordinate(
            r#"{"answers": {"next": {"type": "choice", "choice": "mara", "probabilities": {}, "confidence": 0.9}}}"#,
            met(),
        )
        .await;
        assert_eq!(
            body,
            json!({"reason": "ok", "answers": {"next": {"choice": "none", "confidence": 0.0,
                "probabilities": {}, "people": 0.0}}})
        );
    }

    #[tokio::test]
    async fn people_who_may_speak_next_are_counted_apart_from_none() {
        let answer = r#"{"answers": {"next": {"type": "choice", "choice": "person:ratimics",
            "probabilities": {"person:ratimics": 0.55, "person:Ash": 0.13, "rati": 0.2, "vale": 0.02,
            "none": 0.05, "person:other": 0.05}, "confidence": 0.55}}}"#;
        let mut body = met();
        let history = body["state"]["history"].as_array_mut().unwrap();
        history.push(json!({"resident": "rati", "text": "Hello.", "ago": 1}));
        history.push(json!({"person": "ratimics", "text": "hold on, let me think", "ago": 0}));
        let (_, apart, asked) = post_coordinate(answer, body.clone()).await;
        let criteria = asked[0]["questions"]["next"]["criteria"]
            .as_object()
            .unwrap();
        assert_eq!(
            criteria.keys().collect::<Vec<_>>(),
            [
                "none",
                "person:Ash",
                "person:other",
                "person:ratimics",
                "rati",
                "vale"
            ]
        );
        assert!(criteria["rati"].as_str().unwrap().starts_with("RATi "));
        assert!(criteria["person:ratimics"]
            .as_str()
            .unwrap()
            .starts_with("ratimics, a person, "));
        assert_eq!(asked[0]["state"]["history"][3]["speaker"], "ratimics");
        assert_eq!(
            apart,
            json!({"reason": "ok", "answers": {"next": {"choice": "rati", "confidence": 0.2,
                "probabilities": {"rati": 0.2, "vale": 0.02, "none": 0.05}, "people": 0.73}}})
        );
        let unlisted = r#"{"answers": {"next": {"type": "choice", "choice": "person:other",
            "probabilities": {"person:other": 0.7, "rati": 0.05, "none": 0.25}, "confidence": 0.7}}}"#;
        let (_, answer, _) = post_coordinate(unlisted, body).await;
        assert_eq!(
            answer,
            json!({"reason": "ok", "answers": {"next": {"choice": "none", "confidence": 0.25,
                "probabilities": {"rati": 0.05, "none": 0.25}, "people": 0.7}}})
        );
    }

    #[test]
    fn the_twelve_most_recent_people_are_choices_once() {
        let mut body = met();
        let mut names: Vec<String> = (1..=13).map(|n| format!("Guest {n}")).collect();
        names.extend(["Guest 13".to_string(), "RATi".to_string()]);
        body["state"]["history"] = names
            .iter()
            .map(|name| json!({"person": name, "text": "hi"}))
            .collect();
        let request: CoordinateRequest = serde_json::from_value(body).unwrap();
        let named = people(&request);
        assert_eq!(named.len(), 12);
        assert_eq!(named[..3], ["Someone", "Guest 13", "Guest 12"]);
        assert_eq!(named[11], "Guest 3");
        let criteria = asked(&request, &cast("lonely-forest").unwrap());
        assert_eq!(criteria["next"]["criteria"].as_object().unwrap().len(), 16);
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
        stranger["residents"] = json!(["nobody"]);
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
    fn a_discord_message_is_a_talk_with_the_resident_in_its_world() {
        let residents = cast("lonely-forest").unwrap();
        let vale = residents.iter().find(|r| r.id == "vale").unwrap();
        let read = "I read this just now in The Burial Decree, by Creon: No one may bury him.";
        let heard = "Pip told me this just now at Black pond: The keeper wants the Bell.";
        let seen = json!({"place": "pond", "here": ["moth"], "holds": ["lamp"], "items": ["bell"],
            "lines": [{"speaker": "Pip", "text": "The pond is still."}], "known": [read, heard]});
        let mut asked = request(json!([{"author": "Mara", "text": "Hello there."}]));
        let told = |asked: &LinesRequest| {
            let context = scene(vale, &residents, asked).unwrap();
            let part = super::super::Part::Line;
            (
                context.location.clone(),
                super::super::transcript(&context, &context.entities[0], part),
            )
        };
        let (home, alone) = told(&asked);
        assert_eq!(home, "attic");
        assert!(alone.contains("I'm talking with Mara."), "{alone}");
        asked.view = Some(seen);
        let (at, view) = told(&asked);
        assert_eq!(at, "pond");
        for line in [
            "I'm carrying the Lamp.",
            "The Bell is on the ground here.",
            read,
            heard,
        ] {
            assert!(view.contains(line), "{line}: {view}");
        }
        assert!(view.contains("Pip and Mara are here with me."), "{view}");
        let card = forest_data()["people"]["vale"]["text"]
            .as_str()
            .unwrap_or("Home:");
        for authored in [card, "Home:", "Paths from home", "Items here:"] {
            assert!(!view.contains(authored), "{authored}: {view}");
        }
        asked.view = Some(json!({"place": "greek-colonus", "holds": [], "lines": []}));
        let (colonus, view) = told(&asked);
        assert_eq!(colonus, "greek-colonus");
        assert!(
            view.contains("I'm at Colonus Grove.") && !view.contains("Oedipus"),
            "{view}"
        );
    }

    #[test]
    fn a_resident_tells_the_model_its_own_want_and_nothing_when_it_has_none() {
        let residents = cast("lonely-forest").unwrap();
        let vale = residents.iter().find(|r| r.id == "vale").unwrap();
        let mut asked = request(json!([{"author": "Mara", "text": "What do you want?"}]));
        let told = |asked: &LinesRequest| {
            let context = scene(vale, &residents, asked).unwrap();
            super::super::transcript(&context, &context.entities[0], super::super::Part::Line)
        };
        let seen = |own: Value| json!({"place": "pond", "here": ["moth"], "lines": [], "own": own});
        let favour = "Owes a favour to Pip; willing to share a spare or take a detour with them.";
        asked.view = Some(seen(json!(["I want the Lamp.", favour])));
        let wants = told(&asked);
        assert!(wants.contains("I want the Lamp."), "{wants}");
        assert!(wants.contains("I owe Pip a favour;"), "{wants}");
        asked.view = Some(seen(json!([])));
        assert!(!told(&asked).contains("I want"));
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
    async fn notes_come_from_the_cheap_model_and_a_bad_shape_is_dropped() {
        std::env::set_var("COSYWORLD_DISCORD_NOTES_MODEL", "test-entity-model");
        let post_notes = |answer: &'static str, body: Value| async move {
            let seen = Arc::new(Mutex::new(Vec::new()));
            let (address, server) = serve(provider(seen.clone(), "{}", Some(answer))).await;
            let app = router_with_models::<()>(
                Arc::new(Some(intent_config(address))),
                Ok(BTreeMap::new()),
                Ok(VoiceSettings::hosted()),
            );
            let request = Request::post("/discord/notes")
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap();
            let (status, body) = read(app.oneshot(request).await.unwrap()).await;
            server.abort();
            let requests = seen.lock().unwrap().clone();
            (status, body, requests)
        };
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let chat = json!({"pack": "lonely-forest", "messages": [
            {"author": "Ash", "text": "what about gin"},
            {"resident": "rati", "text": "Gin is for later."}
        ]});
        let good =
            r#"{"topic":"gin","goal":"get RATi to pour gin","summary":"Ash asks RATi for gin."}"#;
        let (status, body, requests) = post_notes(good, chat.clone()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["notes"]["topic"], "gin", "{body}");
        assert_eq!(requests[0]["model"], "test-entity-model");
        assert!(turn_of(&requests[0], "user").ends_with("RATi: Gin is for later."));
        for bad in [r#"{"topic":"","goal":"g","summary":"s"}"#, "not json"] {
            let (_, body, _) = post_notes(bad, chat.clone()).await;
            assert_eq!(body, json!({"notes": null, "reason": "schema"}));
        }
        let mut long = chat.clone();
        long["notes"] = json!({"topic": "t", "goal": "g", "summary": "s".repeat(301)});
        let (status, _, requests) = post_notes(good, long).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(requests.is_empty());
    }

    #[tokio::test]
    async fn a_bad_token_reaches_no_model() {
        let (status, body, requests) =
            post_lines("{}", Some("Hello."), WRONG, talk(Some("rati"))).await;
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
        let body = serde_json::to_vec(&talk(Some("rati"))).unwrap();
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
    async fn a_void_resident_is_called_by_its_chosen_name() {
        std::env::set_var("COSYWORLD_BOT_TOKEN", TOKEN);
        let mut state = crate::test_support::test_app_state(None);
        let root = std::env::temp_dir().join(format!("discord-names-{}", crate::random_hex(8)));
        let dir = root.join("elysium-models").join("elysium-claude");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("name.txt"), "Quill Ashby").unwrap();
        state.generated_asset_dir = Arc::new(root.clone());
        let app = router_with_models::<()>(
            Arc::new(None),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        )
        .layer(Extension(state));
        let request = Request::get("/discord/cast?pack=elysium")
            .header("authorization", format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let (status, body) = read(app.oneshot(request).await.unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        let name = |id: &str| {
            body["residents"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["id"] == id)
                .map(|r| r["name"].clone())
        };
        assert_eq!(name("elysium-claude"), Some(json!("Quill Ashby")));
        assert_eq!(name("elysium-gemini"), Some(json!("Resident of Void 003")));
        let _ = std::fs::remove_dir_all(root);
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
        let guild = "/discord/cast?pack=lonely-forest&guild=100000000000000009";
        let (status, body) = read(app.clone().oneshot(get(guild, TOKEN)).await.unwrap()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["residents"].as_array().unwrap().len(), 7);
        let (status, _) = read(app.oneshot(get("/discord/cast", WRONG)).await.unwrap()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
