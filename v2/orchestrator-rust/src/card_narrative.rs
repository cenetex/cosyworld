use crate::ai_gateway::ModelCapability;
use crate::ai_gateway::{request_chat_completion, AiConfig, ChatCompletionRequest};
use crate::rate_limit::{RateLimit, RateLimiter};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    response::{sse::Event, IntoResponse, Response, Sse},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, Semaphore};
use tokio_stream::{wrappers::UnboundedReceiverStream, StreamExt};

#[path = "card_narrative/atmosphere.rs"]
mod atmosphere;
#[path = "card_narrative/browser.rs"]
pub(crate) mod browser;
#[path = "card_narrative/custody.rs"]
mod custody;
#[path = "card_narrative/dream.rs"]
mod dream;
#[path = "card_narrative/expression.rs"]
mod expression;
#[path = "card_narrative/knowledge.rs"]
mod knowledge;
#[path = "card_narrative/observations.rs"]
mod observations;
#[path = "card_narrative/recital.rs"]
pub(crate) mod recital;
#[path = "card_narrative/reflection.rs"]
mod reflection;
#[path = "card_narrative/reflections.rs"]
mod reflections;
#[cfg(test)]
#[path = "card_narrative/voice_eval.rs"]
mod voice_eval;
#[path = "card_narrative/voice_metrics.rs"]
pub(crate) mod voice_metrics;
#[path = "card_narrative/waking.rs"]
mod waking;
use voice_metrics::{tagged, Section};

const PER_MINUTE: RateLimit = RateLimit {
    max_hits: 30,
    window: Duration::from_secs(60),
};
/// One client's share of the hour. Four requests a minute sustained for an
/// hour covers brisk play (one request per card), while at least five clients
/// are needed to drain the shared `PER_HOUR` budget. Without this cap a
/// single client at its `PER_MINUTE` maximum fills `PER_HOUR` in 40 minutes.
const PER_CLIENT_HOUR: RateLimit = RateLimit {
    max_hits: 240,
    window: Duration::from_secs(3600),
};
const PER_HOUR: RateLimit = RateLimit {
    max_hits: 1200,
    window: Duration::from_secs(3600),
};
/// Model requests in flight across all clients.
const TOTAL_CONCURRENCY: usize = 2;
/// Model requests in flight per client. A client's play waits on its own
/// story text, so one is enough, and it leaves the remaining capacity for
/// other players.
const PER_CLIENT_CONCURRENCY: usize = 1;

/// Counts the requests each client currently has in flight.
#[derive(Debug, Default)]
struct InFlight {
    counts: Mutex<BTreeMap<IpAddr, usize>>,
}

/// Releases a client's in-flight slot when the request finishes or its
/// stream closes.
struct InFlightGuard {
    in_flight: Arc<InFlight>,
    client: IpAddr,
}

impl InFlight {
    fn try_enter(self: &Arc<Self>, client: IpAddr, max: usize) -> Option<InFlightGuard> {
        let mut counts = self.counts.lock().ok()?;
        let count = counts.entry(client).or_default();
        if *count >= max {
            return None;
        }
        *count += 1;
        Some(InFlightGuard {
            in_flight: self.clone(),
            client,
        })
    }

    #[cfg(test)]
    fn count(&self, client: IpAddr) -> usize {
        self.counts
            .lock()
            .unwrap()
            .get(&client)
            .copied()
            .unwrap_or(0)
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        let Ok(mut counts) = self.in_flight.counts.lock() else {
            return;
        };
        if let Some(count) = counts.get_mut(&self.client) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&self.client);
            }
        }
    }
}

/// Per-client minute and hour limits, then the shared hourly budget.
fn admit(limits: &mut RateLimiter, client: IpAddr, now: Instant) -> bool {
    limits.allow(format!("card-text:{client}"), PER_MINUTE, now)
        && limits.allow(
            format!("card-text-client-hour:{client}"),
            PER_CLIENT_HOUR,
            now,
        )
        && limits.allow("card-text-hour".into(), PER_HOUR, now)
}

fn base_profiles() -> &'static Value {
    static PROFILES: OnceLock<Value> = OnceLock::new();
    PROFILES.get_or_init(|| {
        let mut profiles: Value =
            serde_json::from_str(include_str!("../../card-game/entity-profiles.json"))
                .expect("embedded entity profiles");
        // World packs mounted on the table add their places and residents. The
        // browser reads the same compiled file, so ids and personas agree.
        let packs: Value = serde_json::from_str(include_str!("../../card-game/packs.json"))
            .expect("embedded card world packs");
        let map = profiles.as_object_mut().expect("profiles");
        let boardy: Value = serde_json::from_str(include_str!("../../card-game/boardyai.json"))
            .expect("BoardyAI guest");
        for pack in packs["packs"]
            .as_array()
            .expect("pack list")
            .iter()
            .chain(std::iter::once(&boardy))
        {
            for (collection, kind) in [
                ("places", "location"),
                ("avatars", "avatar"),
                ("items", "item"),
            ] {
                let Some(entities) = pack[collection].as_object() else {
                    continue;
                };
                for (id, entity) in entities {
                    let mut profile =
                        json!({"kind": kind, "name": entity["name"], "pack": pack["id"]});
                    // An avatar is only its seed sentence; card text is for the table.
                    if kind != "avatar" {
                        profile["persona"] =
                            entity.get("persona").unwrap_or(&entity["text"]).clone();
                    }
                    for field in ["seed", "voice", "idiolect", "expression"] {
                        if let Some(value) = entity.get(field) {
                            profile[field] = value.clone();
                        }
                    }
                    assert!(
                        map.insert(id.clone(), profile).is_none(),
                        "duplicate card profile {id}"
                    );
                }
            }
        }
        let cast: Value = serde_json::from_str(include_str!("../../card-game/shared-cast.json"))
            .expect("shared cast");
        for human in cast["avatars"].as_array().expect("human avatars") {
            if human["id"] == "vale" {
                continue;
            }
            for (entry, kind) in [
                (human, "avatar"),
                (&human["home"], "location"),
                (&human["item"], "item"),
            ] {
                if let Some(id) = entry["id"].as_str() {
                    let mut profile =
                        json!({"kind":kind,"name":entry["name"],"pack":"shared-homes"});
                    if kind == "avatar" {
                        profile["seed"] = entry["seed"].clone();
                    } else {
                        profile["persona"] =
                            json!(entry.get("text").or_else(|| entry.get("effect")));
                    }
                    map.insert(id.into(), profile);
                }
            }
        }
        profiles
    })
}
fn profiles() -> &'static Value {
    base_profiles()
}

fn kind(id: &str, expected: &str) -> bool {
    profiles()[id]["kind"].as_str() == Some(expected)
}
fn bounded(text: &str, limit: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= limit && !text.chars().any(char::is_control)
}

#[derive(Clone)]
struct TextState {
    background: Arc<reflections::Queue>,
    ai: Arc<Option<AiConfig>>,
    character_models: Arc<Result<BTreeMap<String, String>, String>>,
    settings: Arc<Result<VoiceSettings, String>>,
    limits: Arc<Mutex<RateLimiter>>,
    in_flight: Arc<InFlight>,
    capacity: Arc<Semaphore>,
}

pub(super) fn router<S: Clone + Send + Sync + 'static>(ai: Arc<Option<AiConfig>>) -> Router<S> {
    let ai = Arc::new(ai.as_ref().clone().map(|mut config| {
        if let Ok(model) = std::env::var("COSYWORLD_CARD_TEXT_MODEL") {
            if !model.trim().is_empty() {
                config
                    .capability_models
                    .insert(ModelCapability::WorldContent, model);
            }
        }
        if let Ok(effort) = std::env::var("COSYWORLD_CARD_TEXT_REASONING_EFFORT") {
            if !effort.trim().is_empty() {
                config.reasoning_effort = Some(effort);
            }
        }
        config
    }));
    let models = std::env::var("COSYWORLD_CARD_CHARACTER_MODELS_JSON")
        .ok()
        .map(|text| parse_character_models(&text))
        .unwrap_or_else(|| Ok(BTreeMap::new()));
    router_with_models(ai, models, voice_settings().clone())
}

fn parse_character_models(text: &str) -> Result<BTreeMap<String, String>, String> {
    let models: BTreeMap<String, String> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let avatars: BTreeSet<_> = base_profiles()
        .as_object()
        .expect("profiles")
        .iter()
        .filter(|(_, p)| p["kind"] == "avatar" && p.get("pack").is_none())
        .map(|(id, _)| id.clone())
        .collect();
    if !avatars.is_subset(&models.keys().cloned().collect::<BTreeSet<_>>())
        || models.keys().any(|id| !kind(id, "avatar"))
        || models
            .values()
            .any(|id| !bounded(id, 160) || id.trim() != id)
    {
        return Err("character models must cover hub avatars; optional mounted avatars need exact model IDs".into());
    }
    Ok(models)
}

fn router_with_models<S: Clone + Send + Sync + 'static>(
    ai: Arc<Option<AiConfig>>,
    models: Result<BTreeMap<String, String>, String>,
    settings: Result<VoiceSettings, String>,
) -> Router<S> {
    Router::new()
        .route("/card-game/text", post(generate))
        .route("/card-game/reflections", post(reflections::generate))
        .route("/card-game/text/prepare", post(browser::prepare_route))
        .route("/card-game/text/complete", post(browser::complete_route))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(TextState {
            ai,
            character_models: Arc::new(models),
            settings: Arc::new(settings),
            limits: Arc::new(Mutex::new(RateLimiter::default())),
            in_flight: Arc::new(InFlight::default()),
            capacity: Arc::new(Semaphore::new(TOTAL_CONCURRENCY)),
            background: Arc::new(reflections::Queue::default()),
        })
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Desire {
    items: Vec<String>,
    location: Option<String>,
    avatars: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Memory {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    seq: Option<u64>,
    turn: u64,
    kind: String,
    text: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entity {
    id: String,
    facts: Vec<String>,
    #[serde(default)]
    poem: Option<recital::Poem>,
    desire: Option<Desire>,
    memories: Vec<Memory>,
    previous: Option<String>,
    #[serde(default)]
    inner_life: Option<InnerLife>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hope: Option<Hope>,
}

/// The avatar's rule-owned hope, in their own words.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Hope {
    wish: String,
    next: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct InnerLife {
    #[serde(default)]
    persona: Option<String>,
    #[serde(default)]
    thoughts: Vec<InnerMoment>,
    #[serde(default)]
    dreams: Vec<InnerMoment>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct InnerMoment {
    turn: u64,
    text: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Reflection {
    thought: String,
    persona: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dream: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    models: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    evidence: Vec<u64>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct SpokenLine {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    witnesses: Option<Vec<String>>,
    actor_id: String,
    text: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CardOutcome {
    kind: String,
    target: Option<String>,
    item: Option<String>,
    receive: Option<String>,
    destination: Option<String>,
    accepted: Option<bool>,
    /// The player's want met by this play: an item, a place or a person.
    #[serde(default, rename = "wantMet", skip_serializing_if = "Option::is_none")]
    want_met: Option<WantMet>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct WantMet {
    kind: String,
    target: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Travel {
    from: String,
    to: String,
    companions: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AvatarOutcome {
    id: String,
    location: String,
    holding: Vec<String>,
    travel: Option<Travel>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ItemOutcome {
    id: String,
    holder: String,
    location: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TurnOutcome {
    card: CardOutcome,
    avatars: Vec<AvatarOutcome>,
    items: Vec<ItemOutcome>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    observations: Vec<observations::Observation>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Context {
    #[serde(skip)]
    acting_avatar: Option<String>,
    revision: u64,
    turn: u64,
    location: String,
    #[serde(default = "atmosphere::legacy_scenery")]
    scenery: bool,
    focus: Option<String>,
    speakers: Vec<String>,
    /// The avatar who chose to wait this turn; only they may reflect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    resting: Option<String>,
    /// "long" when the resting avatar wakes from a long rest at a sanctuary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rest: Option<String>,
    #[serde(default)]
    action: Option<String>,
    entities: Vec<Entity>,
    #[serde(default)]
    events: Vec<String>,
    #[serde(default)]
    conversation: Vec<SpokenLine>,
    #[serde(default)]
    outcome: Option<TurnOutcome>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    disclosures: Vec<knowledge::Disclosure>,
    /// A new game's first line: the player's avatar wakes knowing only what
    /// its player has uncovered (waking.rs).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    waking: bool,
    /// The speaker's own card or place, while its player has not uncovered it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    covered: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reflection: Option<Reflection>,
}
fn valid(context: &Context) -> bool {
    let ids: BTreeSet<_> = context.entities.iter().map(|e| e.id.as_str()).collect();
    context.turn <= context.revision
        && context.revision <= 9_007_199_254_740_991
        && context
            .action
            .as_ref()
            .is_none_or(|text| bounded(text, 650))
        && kind(&context.location, "location")
        && ids.contains(context.location.as_str())
        && (1..=8).contains(&context.entities.len())
        && ids.len() == context.entities.len()
        && context.covered.iter().all(|id| ids.contains(id.as_str()))
        && context.outcome.as_ref().is_none_or(valid_outcome)
        && observations::valid(context)
        && knowledge::valid(context)
        && context.events.len() <= 8
        && context.events.iter().all(|text| bounded(text, 650))
        && context.conversation.len() <= 4
        && context.conversation.iter().all(|line| {
            kind(&line.actor_id, "avatar")
                && bounded(&line.text, 400)
                && line
                    .witnesses
                    .as_ref()
                    .is_none_or(|ids| ids.len() <= 64 && ids.iter().all(|id| kind(id, "avatar")))
        })
        && (1..=3).contains(&context.speakers.len())
        && context.speakers.iter().collect::<BTreeSet<_>>().len() == context.speakers.len()
        && context
            .speakers
            .iter()
            .all(|id| kind(id, "avatar") && ids.contains(id.as_str()))
        && context
            .focus
            .as_ref()
            .is_none_or(|id| kind(id, "item") && ids.contains(id.as_str()))
        && context
            .resting
            .as_ref()
            .is_none_or(|id| context.speakers.first() == Some(id))
        && context
            .rest
            .as_deref()
            .is_none_or(|rest| rest == "long" && context.resting.is_some())
        && context.entities.iter().all(|e| {
            profiles().get(&e.id).is_some()
                && recital::valid(&e.id, e.poem.as_ref(), context.turn)
                && e.facts.len() <= 16
                && e.facts.iter().all(|s| bounded(s, 240))
                && e.previous.as_ref().is_none_or(|s| bounded(s, 400))
                && e.hope.as_ref().is_none_or(|hope| {
                    kind(&e.id, "avatar") && bounded(&hope.wish, 240) && bounded(&hope.next, 240)
                })
                && e.inner_life.as_ref().is_none_or(|life| {
                    kind(&e.id, "avatar")
                        && life.persona.as_ref().is_none_or(|text| bounded(text, 600))
                        && [&life.thoughts, &life.dreams].iter().all(|moments| {
                            moments.len() <= 4
                                && moments.iter().enumerate().all(|(index, m)| {
                                    m.turn <= context.turn
                                        && bounded(&m.text, 400)
                                        && (index == 0 || moments[index - 1].turn < m.turn)
                                })
                        })
                })
                && e.memories.len() <= 8
                && e.memories.iter().all(|m| {
                    m.turn <= context.turn
                        && m.seq
                            .is_none_or(|seq| seq > 0 && seq <= 9_007_199_254_740_991)
                        && ["event", "expression"].contains(&m.kind.as_str())
                        && bounded(&m.text, 650)
                })
                && if kind(&e.id, "avatar") {
                    e.desire.as_ref().is_some_and(|d| {
                        d.items.len() <= 3
                            && d.avatars.len() <= 2
                            && d.items.iter().all(|id| kind(id, "item"))
                            && d.avatars.iter().all(|id| kind(id, "avatar") && id != &e.id)
                            && d.location.as_ref().is_none_or(|id| kind(id, "location"))
                    })
                } else {
                    e.desire.is_none()
                }
        })
}

fn valid_outcome(outcome: &TurnOutcome) -> bool {
    let card = &outcome.card;
    let avatars: BTreeSet<_> = outcome.avatars.iter().map(|a| a.id.as_str()).collect();
    let items: BTreeSet<_> = outcome.items.iter().map(|i| i.id.as_str()).collect();
    matches!(
        card.kind.as_str(),
        "arrive"
            | "wait"
            | "move"
            | "course"
            | "accompany"
            | "talk"
            | "ask"
            | "take"
            | "drop"
            | "give"
            | "trade"
            | "light"
            | "snuff"
            | "ring"
            | "cover"
            | "threaten"
            | "guard"
            | "attack"
            | "choose"
    ) && card
        .target
        .as_ref()
        .is_none_or(|id| profiles().get(id).is_some())
        && card.item.as_ref().is_none_or(|id| kind(id, "item"))
        && card.receive.as_ref().is_none_or(|id| kind(id, "item"))
        && card
            .destination
            .as_ref()
            .is_none_or(|id| kind(id, "location"))
        && if card.kind == "accompany" {
            card.accepted.is_some()
                && card.destination.is_some()
                && card
                    .target
                    .as_ref()
                    .is_some_and(|id| kind(id, "avatar") && id != "vale")
        } else if card.kind == "ask" {
            card.destination.is_none()
                && card
                    .target
                    .as_ref()
                    .is_some_and(|id| kind(id, "avatar") && id != "vale")
                && card.item.is_some()
        } else if matches!(card.kind.as_str(), "give" | "trade") {
            // Every offer carries its recorded answer. A refusal moves
            // nothing, and the cast says why.
            card.destination.is_none()
        } else {
            card.accepted.is_none() && card.destination.is_none()
        }
        && card
            .want_met
            .as_ref()
            .is_none_or(|want| match want.kind.as_str() {
                "item" => kind(&want.target, "item"),
                "place" => kind(&want.target, "location"),
                "person" => kind(&want.target, "avatar"),
                _ => false,
            })
        && avatars.contains("vale")
        && (1..=8).contains(&outcome.avatars.len())
        && avatars.len() == outcome.avatars.len()
        && avatars.iter().all(|id| kind(id, "avatar"))
        && outcome.items.len() <= 24
        && items.len() == outcome.items.len()
        && items.iter().all(|id| kind(id, "item"))
        && outcome.items.iter().all(|item| {
            profiles().get(&item.holder).is_some()
                && item.holder != item.id
                && kind(&item.location, "location")
        })
        && outcome.avatars.iter().all(|avatar| {
            kind(&avatar.location, "location")
                && avatar.holding.len() <= 4
                && avatar.holding.iter().collect::<BTreeSet<_>>().len() == avatar.holding.len()
                && avatar.holding.iter().all(|id| kind(id, "item"))
                && avatar.travel.as_ref().is_none_or(|travel| {
                    kind(&travel.from, "location")
                        && travel.to == avatar.location
                        && travel.from != travel.to
                        && travel.companions.len() <= 2
                        && travel.companions.iter().collect::<BTreeSet<_>>().len()
                            == travel.companions.len()
                        && travel.companions.iter().all(|id| {
                            id != &avatar.id
                                && outcome.avatars.iter().any(|other| {
                                    &other.id == id
                                        && other.travel.as_ref().is_some_and(|trip| {
                                            trip.from == travel.from
                                                && trip.to == travel.to
                                                && trip.companions.contains(&avatar.id)
                                        })
                                })
                        })
                })
        })
}

// Restate the resolved action and each trip for every voice, including places.
// The model can then keep a character's style while following the player's play.
fn error(status: StatusCode, message: &str) -> Response {
    (
        status,
        [("cache-control", "no-store"), ("retry-after", "10")],
        Json(json!({"error": message})),
    )
        .into_response()
}
fn same_origin(headers: &HeaderMap) -> bool {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
    {
        return false;
    }
    headers.get("origin").is_none_or(|origin| {
        let origin = origin.to_str().unwrap_or("");
        let host = headers
            .get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        !host.is_empty()
            && ["https://", "http://"]
                .iter()
                .any(|prefix| origin.strip_prefix(prefix) == Some(host))
    })
}
async fn generate(
    State(state): State<TextState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(context): Json<Context>,
) -> Response {
    if !same_origin(&headers) {
        return error(StatusCode::FORBIDDEN, "Open the card game on this site.");
    }
    if !valid(&context) {
        return error(
            StatusCode::BAD_REQUEST,
            "Use the current scene and its saved memories.",
        );
    }
    let Some(config) = state.ai.as_ref().as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Story generation is waiting for its model connection.",
        );
    };
    let Ok(character_models) = state.character_models.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Character voices are waiting for their model settings.",
        );
    };
    let Ok(settings) = state.settings.as_ref() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Character voices are waiting for valid timing settings.",
        );
    };
    // `peer` is already the derived client address (see
    // `rate_limit::client_addr`). Check this client's own limits before
    // touching shared capacity, so one client can neither hold every permit
    // nor spend the shared budget while another client waits.
    let client = peer.ip();
    let Some(_client_slot) = state.in_flight.try_enter(client, PER_CLIENT_CONCURRENCY) else {
        return error(
            StatusCode::TOO_MANY_REQUESTS,
            "Your last story is still being written.",
        );
    };
    {
        let Ok(mut limits) = state.limits.lock() else {
            return error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The story service is restarting.",
            );
        };
        if !admit(&mut limits, client, Instant::now()) {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "The story service is taking a short break.",
            );
        }
    }
    let Ok(_permit) = state.capacity.clone().try_acquire_owned() else {
        return error(StatusCode::TOO_MANY_REQUESTS, "The story service is busy.");
    };
    // Only an admitted scene replaces queued reflections: a refused request
    // must not cancel work for this or any other client.
    state
        .background
        .cancel
        .send_modify(|generation| *generation += 1);
    if headers
        .get("accept")
        .is_some_and(|value| value == "text/event-stream")
    {
        let config = config.clone();
        let character_models = character_models.clone();
        let settings = settings.clone();
        let (sender, receiver) = mpsc::unbounded_channel::<Event>();
        tokio::spawn(async move {
            let _permit = _permit;
            let _client_slot = _client_slot;
            let deltas = sender.clone();
            let emit = |text: &str| {
                deltas
                    .send(Event::default().data(json!({"type":"delta","text":text}).to_string()))
                    .is_ok()
            };
            tokio::select! {
                _ = sender.closed() => {},
                result = complete(&config, &context, &character_models, &settings, Some(&emit)) => {
                    let event = match result {
                        Ok(mut value) => { value["type"] = json!("complete"); value },
                        Err(_) => json!({"type":"error","message":"Story text will try again with your next play"}),
                    };
                    let _ = sender.send(Event::default().data(event.to_string()));
                }
            }
        });
        return (
            [
                ("cache-control", "no-store, no-transform"),
                ("x-accel-buffering", "no"),
            ],
            Sse::new(UnboundedReceiverStream::new(receiver).map(Ok::<_, std::convert::Infallible>)),
        )
            .into_response();
    }
    match complete(config, &context, character_models, settings, None).await {
        Ok(value) => ([("cache-control", "no-store")], Json(value)).into_response(),
        Err(response) => response,
    }
}

/// One scene: a separate plain-text call for each voiced entity, plus private
/// reflection calls when an avatar is due one. The simulation chooses who
/// is voiced and what each one is aware of; this validator decides what is
/// published. Prompts carry only the entity's own words and awareness.
///
/// Every voice stands on its own. An entity whose words fail twice, or that
/// is still waiting when the scene deadline passes, stays silent and is listed
/// under `omitted`; the others are published. The scene fails only when none
/// of its speakers (or, with no speakers, none of its voices) has words, so
/// the browser retries once and otherwise keeps its last scene. Nothing is
/// invented.
async fn complete(
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<Value, Response> {
    complete_selected(
        config,
        context,
        character_models,
        settings,
        &voiced(context),
        !settings.defer_reflections,
        on_delta,
    )
    .await
}

async fn complete_selected(
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    voiced: &[String],
    reflections: bool,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<Value, Response> {
    for model in [&settings.reflection_model, &settings.escalation_model]
        .into_iter()
        .flatten()
    {
        if let Err(failure) =
            tier_config(config, Some(model)).pin_model(ModelCapability::WorldContent)
        {
            tracing::warn!(feature = "card_voice", model, %failure, "card voice tier needs an eligible model");
            return Err(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Character voice tiers are waiting for eligible model settings.",
            ));
        }
    }
    let deadline = tokio::time::Instant::now() + settings.scene_timeout;
    let calls: Vec<_> = voiced.iter().map(|id| (id.clone(), Part::Line)).collect();
    let jobs = calls.into_iter().map(|(id, part)| async move {
        let result = speak(
            config,
            context,
            character_models,
            settings,
            deadline,
            &id,
            part,
        )
        .await;
        (id, part, result)
    });
    let mut results = futures_util::StreamExt::buffer_unordered(
        futures_util::stream::iter(jobs),
        settings.parallel.max(1),
    );
    let mut lines: BTreeMap<String, (String, String)> = BTreeMap::new();
    let collected = tokio::time::timeout_at(deadline, async {
        while let Some((id, part, result)) = futures_util::StreamExt::next(&mut results).await {
            match (part, result) {
                (Part::Line, Ok((text, model))) => {
                    if context.speakers.contains(&id) {
                        if let Some(emit) = on_delta {
                            if !emit(&format!("{}\n", json!({"id": id, "text": text}))) {
                                return Err(error(
                                    StatusCode::SERVICE_UNAVAILABLE,
                                    "The scene has closed.",
                                ));
                            }
                        }
                    }
                    lines.insert(id, (text, model));
                }
                (Part::Line, Err(())) => {}
                _ => {}
            }
        }
        Ok(())
    })
    .await;
    // Past the scene deadline, what has been validated is published and the
    // rest stay silent; dropping the stream cancels their provider requests.
    drop(results);
    if let Ok(Err(response)) = collected {
        return Err(response);
    }
    let mut private = BTreeMap::new();
    if reflections {
        let reflection_ids: Vec<String> = voiced
            .iter()
            .filter(|id| lines.contains_key(*id))
            .cloned()
            .collect();
        let jobs = reflection_ids.into_iter().map(|id| async move {
            let value =
                reflection::generate(config, context, character_models, settings, deadline, &id)
                    .await;
            (id, value)
        });
        let mut results = futures_util::StreamExt::buffer_unordered(
            futures_util::stream::iter(jobs),
            settings.parallel.max(1),
        );
        let _ = tokio::time::timeout_at(deadline, async {
            while let Some((id, value)) = futures_util::StreamExt::next(&mut results).await {
                if let Some(value) = value {
                    private.insert(id, value);
                }
            }
        })
        .await;
    }
    let mut entries = Vec::new();
    for id in voiced {
        let Some((text, model)) = lines.remove(id) else {
            continue;
        };
        let reflection = private.remove(id);
        entries.push(Entry {
            id: id.clone(),
            text,
            model: Some(model),
            reflection,
        });
    }
    // Someone the scene needed has to have words, or there is nothing to
    // publish and the browser's one retry is the right answer.
    let needed: &[String] = if context.speakers.is_empty() {
        voiced
    } else {
        &context.speakers
    };
    if !entries.iter().any(|entry| needed.contains(&entry.id)) {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "A character's words need another try.",
        ));
    }
    let omitted: Vec<_> = context
        .entities
        .iter()
        .filter(|e| !entries.iter().any(|entry| entry.id == e.id))
        .map(|e| e.id.clone())
        .collect();
    let models: BTreeSet<_> = entries.iter().filter_map(|e| e.model.as_deref()).collect();
    let model = if models.len() == 1 {
        models
            .into_iter()
            .next()
            .unwrap_or("card-voices-v1")
            .to_string()
    } else {
        "card-voices-v1".to_string()
    };
    Ok(json!({"revision":context.revision,"entries":entries,"omitted":omitted,"model":model}))
}

/// Generate only the voices chosen by the authenticated shared scene.
pub(crate) async fn shared_lines(
    config: &AiConfig,
    scene: &Value,
    ids: &[String],
    models: &BTreeMap<String, String>,
) -> Result<Value, String> {
    let mut context: Context = serde_json::from_value(scene.clone())
        .map_err(|_| "The saved scene needs another moment.")?;
    if ids.is_empty()
        || (!context.scenery && ids.contains(&context.location))
        || ids
            .iter()
            .any(|id| !context.entities.iter().any(|e| &e.id == id))
        || !observations::valid(&context)
        || context
            .entities
            .iter()
            .any(|entity| !recital::valid(&entity.id, entity.poem.as_ref(), context.turn))
    {
        return Err("The saved scene needs its requested voices.".into());
    }
    context.acting_avatar = ids.first().cloned();
    context.speakers = ids
        .iter()
        .filter(|id| kind(id, "avatar"))
        .cloned()
        .collect();
    let mut settings = voice_settings()
        .as_ref()
        .map_err(|_| "The story service needs its voice settings.")?
        .clone();
    settings.line_limit = 240;
    let value = complete_selected(config, &context, models, &settings, ids, true, None)
        .await
        .map_err(|_| "The play is saved. Its words need another moment.")?;
    // Shared scenes require the acting avatar's line. A replying avatar whose
    // words do not come stays silent ("…" on the table), as atmosphere may.
    if ids
        .first()
        .filter(|id| kind(id, "avatar"))
        .is_some_and(|id| {
            !value["entries"]
                .as_array()
                .is_some_and(|entries| entries.iter().any(|e| e["id"] == *id))
        })
    {
        return Err("The play is saved. Its words need another moment.".into());
    }
    Ok(value)
}

/// What one call asks an entity to say or keep privately.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Part {
    Line,
    Thought,
    Persona,
    Dream,
}

impl Part {
    /// Character and sentence limits applied after the model answers.
    fn limits(self) -> (usize, usize) {
        match self {
            Part::Line | Part::Thought => (400, 2),
            Part::Dream => (400, 3),
            Part::Persona => (600, 4),
        }
    }
}

/// How the card voices reach their models. `hosted` keeps the deployed
/// deadlines and runs calls side by side; `local` gives on-device models room
/// and runs one call at a time. Both regenerate a rejected reply once, and
/// both leave a voice that still fails silent rather than failing the scene.
#[derive(Clone, Debug, PartialEq)]
struct VoiceSettings {
    call_timeout: Duration,
    scene_timeout: Duration,
    parallel: usize,
    attempts: u8,
    line_limit: usize,
    reflection_model: Option<String>,
    escalation_model: Option<String>,
    defer_reflections: bool,
}

impl VoiceSettings {
    fn hosted() -> Self {
        Self {
            call_timeout: Duration::from_secs(12),
            scene_timeout: Duration::from_secs(22),
            parallel: 8,
            attempts: 2,
            line_limit: 400,
            reflection_model: None,
            escalation_model: None,
            defer_reflections: false,
        }
    }

    fn local() -> Self {
        Self {
            call_timeout: Duration::from_secs(90),
            scene_timeout: Duration::from_secs(240),
            parallel: 1,
            attempts: 2,
            line_limit: 400,
            reflection_model: None,
            escalation_model: None,
            defer_reflections: true,
        }
    }

    fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let mut settings = match get("COSYWORLD_CARD_TEXT_PROFILE").as_deref().map(str::trim) {
            None | Some("") | Some("hosted") => Self::hosted(),
            Some("local") => Self::local(),
            Some(other) => {
                return Err(format!(
                    "COSYWORLD_CARD_TEXT_PROFILE must be hosted or local, not {other}"
                ))
            }
        };
        let number = |name: &str, max: u64| -> Result<Option<u64>, String> {
            get(name)
                .filter(|value| !value.trim().is_empty())
                .map(|value| {
                    value
                        .trim()
                        .parse::<u64>()
                        .ok()
                        .filter(|n| (1..=max).contains(n))
                        .ok_or_else(|| format!("{name} must be a whole number from 1 to {max}"))
                })
                .transpose()
        };
        if let Some(secs) = number("COSYWORLD_CARD_TEXT_CALL_TIMEOUT_SECS", 600)? {
            settings.call_timeout = Duration::from_secs(secs);
        }
        if let Some(secs) = number("COSYWORLD_CARD_TEXT_SCENE_TIMEOUT_SECS", 1800)? {
            settings.scene_timeout = Duration::from_secs(secs);
        }
        if let Some(parallel) = number("COSYWORLD_CARD_TEXT_PARALLEL", 16)? {
            settings.parallel = parallel as usize;
        }
        if let Some(attempts) = number("COSYWORLD_CARD_TEXT_ATTEMPTS", 3)? {
            settings.attempts = attempts as u8;
        }
        // A tier is an exact model ID, bounded like the character map's.
        let model = |name: &str| -> Result<Option<String>, String> {
            get(name)
                .filter(|value| !value.trim().is_empty())
                .map(|value| {
                    (bounded(&value, 160) && value.trim() == value)
                        .then_some(value)
                        .ok_or_else(|| {
                            format!("{name} must be an exact model ID of at most 160 characters")
                        })
                })
                .transpose()
        };
        settings.reflection_model = model("COSYWORLD_CARD_REFLECTION_MODEL")?;
        settings.escalation_model = model("COSYWORLD_CARD_ESCALATION_MODEL")?;
        if settings.call_timeout > settings.scene_timeout {
            return Err(
                "COSYWORLD_CARD_TEXT_CALL_TIMEOUT_SECS must not exceed the scene timeout".into(),
            );
        }
        Ok(settings)
    }

    /// The browser's budget for one scene, including its own single retry.
    fn client_budget(&self) -> Duration {
        (self.scene_timeout + Duration::from_secs(8)).max(Duration::from_secs(30))
    }
}

fn voice_settings() -> &'static Result<VoiceSettings, String> {
    static SETTINGS: OnceLock<Result<VoiceSettings, String>> = OnceLock::new();
    SETTINGS.get_or_init(|| VoiceSettings::from_lookup(|name| std::env::var(name).ok()))
}

/// The browser's scene budget in milliseconds, served in the card table page.
pub(super) fn client_budget_ms() -> u128 {
    voice_settings()
        .as_ref()
        .unwrap_or(&VoiceSettings::hosted())
        .client_budget()
        .as_millis()
}

const THOUGHT_GAP: u64 = 6;
const DREAM_GAP: u64 = 24;
const THOUGHTS_PER_DREAM: usize = 2;

/// Mirrors `reflectionDue` in the card rules: only the avatar who waited
/// thinks, after something new happened to them. A dream also needs two
/// thoughts since the last dream.
fn reflection_due(context: &Context, entity: &Entity) -> (bool, bool) {
    if !kind(&entity.id, "avatar")
        || context.turn == 0
        || context.resting.as_deref() != Some(entity.id.as_str())
    {
        return (false, false);
    }
    // Waking from a long rest always brings a thought and a dream.
    if context.rest.as_deref() == Some("long") {
        return (true, true);
    }
    let life = entity.inner_life.as_ref();
    let last = life.and_then(|l| l.thoughts.last()).map(|m| m.turn);
    let changed = entity
        .memories
        .iter()
        .any(|m| m.kind == "event" && last.is_none_or(|turn| m.turn > turn));
    let reflect =
        changed && last.is_none_or(|turn| context.turn >= turn.saturating_add(THOUGHT_GAP));
    let dreamt = life.and_then(|l| l.dreams.last()).map(|m| m.turn);
    let settled = life.map_or(0, |l| {
        l.thoughts
            .iter()
            .filter(|m| dreamt.is_none_or(|turn| m.turn > turn))
            .count()
    });
    let dream = reflect
        && settled >= THOUGHTS_PER_DREAM
        && dreamt.is_none_or(|turn| context.turn >= turn.saturating_add(DREAM_GAP));
    (reflect, dream)
}

/// The speakers, then the place, then the item in play. Everyone else keeps
/// the words already on their card.
fn voiced(context: &Context) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for id in context
        .speakers
        .iter()
        .chain(context.scenery.then_some(&context.location))
        .chain(context.focus.iter())
    {
        if !ids.contains(id) && context.entities.iter().any(|e| &e.id == id) {
            ids.push(id.clone());
        }
    }
    ids
}

fn entity<'a>(context: &'a Context, id: &str) -> &'a Entity {
    context
        .entities
        .iter()
        .find(|e| e.id == id)
        .expect("voiced entities come from the scene")
}

fn name(id: &str) -> String {
    profiles()[id]["name"].as_str().unwrap_or(id).to_string()
}

fn names(ids: &[String]) -> String {
    ids.iter()
        .map(|id| name(id))
        .collect::<Vec<_>>()
        .join(" and ")
}

/// An avatar's one seed sentence, such as "Vale, the Lamplighter." (#1673).
/// Everything else it knows about itself comes from events and its inner life.
fn seed_sentence(id: &str) -> String {
    profiles()[id]["seed"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{}.", name(id)))
}

/// The entity's own first-person words, with the persona its reflections grew.
fn idiolect(entity: &Entity, part: Part) -> String {
    if kind(&entity.id, "location") {
        return atmosphere::voice(&entity.id);
    }
    if part == Part::Dream {
        return String::new();
    }
    let profile = &profiles()[&entity.id];
    let mut text = if kind(&entity.id, "avatar") {
        let seed = seed_sentence(&entity.id);
        // "The Swede, ..." reads as "I am the Swede, ...".
        match ["The ", "A ", "An "].iter().find(|a| seed.starts_with(**a)) {
            Some(article) => format!("I am {}{}", article.to_lowercase(), &seed[article.len()..]),
            None => format!("I am {seed}"),
        }
    } else {
        profile["idiolect"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                format!(
                    "I am {}.\n{}\n{}",
                    name(&entity.id),
                    profile["persona"].as_str().unwrap_or_default(),
                    profile["voice"].as_str().unwrap_or_default()
                )
            })
    };
    if let Some(persona) = entity
        .inner_life
        .as_ref()
        .and_then(|l| l.persona.as_deref())
    {
        text.push_str("\n\n");
        text.push_str(persona);
    }
    text.push_str("\n\n");
    text.push_str(&expression::direction(
        if part == Part::Line {
            expression::mode(profile)
        } else {
            expression::Mode::Speech
        },
        &name(&entity.id),
    ));
    text
}

/// Every entity this scene knows of: those present, their belongings, their
/// trips and their wants. A reply that names anyone else is rejected.
fn known(context: &Context) -> BTreeSet<String> {
    let mut ids: BTreeSet<String> = context.entities.iter().map(|e| e.id.clone()).collect();
    ids.insert(context.location.clone());
    for line in &context.conversation {
        ids.insert(line.actor_id.clone());
    }
    for e in &context.entities {
        if let Some(poem) = &e.poem {
            ids.extend(
                poem.stanzas
                    .iter()
                    .filter_map(|stanza| stanza.author_id.clone()),
            );
        }
        if let Some(desire) = &e.desire {
            ids.extend(desire.items.iter().cloned());
            ids.extend(desire.avatars.iter().cloned());
            ids.extend(desire.location.iter().cloned());
        }
    }
    if let Some(outcome) = &context.outcome {
        for avatar in &outcome.avatars {
            ids.insert(avatar.id.clone());
            ids.insert(avatar.location.clone());
            ids.extend(avatar.holding.iter().cloned());
            if let Some(trip) = &avatar.travel {
                ids.insert(trip.from.clone());
                ids.insert(trip.to.clone());
            }
        }
        for item in &outcome.items {
            ids.insert(item.id.clone());
            ids.insert(item.location.clone());
        }
        let card = &outcome.card;
        ids.extend(
            [&card.target, &card.item, &card.receive, &card.destination]
                .into_iter()
                .flatten()
                .cloned(),
        );
    }
    let text = [
        context.action.iter().collect::<Vec<_>>(),
        context.events.iter().collect(),
    ]
    .concat()
    .into_iter()
    .chain(context.entities.iter().flat_map(|e| e.facts.iter()))
    .chain(context.disclosures.iter().map(|d| &d.text))
    .map(String::as_str)
    .collect::<Vec<_>>()
    .join(" ");
    for (id, profile) in profiles().as_object().expect("profiles") {
        if profile["name"]
            .as_str()
            .is_some_and(|name| mentions(&text, name))
        {
            ids.insert(id.clone());
        }
    }
    ids
}

/// The call's transcript: a third-person scene line, the entity's own
/// first-person awareness, lines in its voice, recent table talk, and its
/// name as the cue. Other characters' private memories never appear here.
fn transcript(context: &Context, entity: &Entity, part: Part) -> String {
    transcript_sections(context, entity, part)
        .iter()
        .map(|(_, line)| line.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The transcript's lines, each tagged with the prompt section it belongs to
/// so voice metrics can measure where a prompt's tokens go.
fn transcript_sections(context: &Context, entity: &Entity, part: Part) -> Vec<(Section, String)> {
    if kind(&entity.id, "location") {
        return vec![(Section::Now, atmosphere::transcript(context, entity))];
    }
    if part == Part::Dream {
        return vec![(Section::Now, dream::transcript(context, entity))];
    }
    if waking::applies(context, &entity.id, part) {
        return vec![(Section::Now, waking::transcript(context, entity))];
    }
    let id = entity.id.as_str();
    let own = name(id);
    let avatar = kind(id, "avatar");
    let mut scene = name(&context.location);
    let mut lines: Vec<(Section, String)> = Vec::new();
    let company = |companions: &[String]| {
        if companions.is_empty() {
            " on my own".to_string()
        } else {
            format!(" with {}", names(companions))
        }
    };
    let theirs = |companions: &[String]| {
        if companions.is_empty() {
            ", alone".to_string()
        } else {
            format!(", with {}", names(companions))
        }
    };
    if let Some(outcome) = &context.outcome {
        let present: Vec<_> = outcome
            .avatars
            .iter()
            .filter(|a| a.location == context.location)
            .map(|a| name(&a.id))
            .collect();
        let ground: Vec<_> = outcome
            .items
            .iter()
            .filter(|i| i.holder == context.location)
            .map(|i| name(&i.id))
            .collect();
        if !present.is_empty() {
            scene.push_str(&format!(". Present: {}", present.join(", ")));
        }
        if !ground.is_empty() {
            scene.push_str(&format!(". On the ground: {}", ground.join(", ")));
        }
        for other in &outcome.avatars {
            let trip = other.travel.as_ref();
            if other.id == id {
                lines.push((
                    Section::Now,
                    match trip {
                        Some(t) if t.from == context.location => format!(
                            "I'm leaving {} for {}{}.",
                            name(&t.from),
                            name(&t.to),
                            company(&t.companions)
                        ),
                        Some(t) => format!(
                            "I've just come to {} from {}{}.",
                            name(&t.to),
                            name(&t.from),
                            company(&t.companions)
                        ),
                        None => format!("I'm at {}.", name(&other.location)),
                    },
                ));
                continue;
            }
            match trip {
                Some(t) if t.from == context.location && t.to != context.location => lines.push((
                    Section::Now,
                    format!(
                        "{} is leaving for {}{}.",
                        name(&other.id),
                        name(&t.to),
                        theirs(&t.companions)
                    ),
                )),
                Some(t) if t.to == context.location => lines.push((
                    Section::Now,
                    format!(
                        "{} has just come from {}{}.",
                        name(&other.id),
                        name(&t.from),
                        theirs(&t.companions)
                    ),
                )),
                _ => {}
            }
        }
        let card = &outcome.card;
        let stance = match card.kind.as_str() {
            "threaten" => Some("threatening"),
            "attack" => Some("attacking"),
            "guard" => Some("guarding against"),
            _ => None,
        };
        // The play itself, once, in the present for the two it joins.
        if let ("give", Some(item), Some(target)) =
            (card.kind.as_str(), card.item.as_deref(), card.target.as_deref())
        {
            let actor = context.acting_avatar.as_deref().unwrap_or("vale");
            if card.accepted != Some(false) && id == actor {
                lines.push((Section::Now, format!("I'm handing {} {}.", name(target), name(item))));
            } else if card.accepted != Some(false) && id == target {
                lines.push((Section::Now, format!("{} is handing me {}.", name(actor), name(item))));
            }
        }
        if let (Some(stance), Some(target)) = (stance, card.target.as_deref()) {
            let actor = context.acting_avatar.as_deref().unwrap_or("vale");
            if id == actor {
                lines.push((Section::Now, format!("I'm {stance} {}.", name(target))));
            } else if id == target {
                lines.push((Section::Now, format!("{} is {stance} me.", name(actor))));
            }
        }
    }
    lines.extend(tagged(Section::Directions, custody::facts(context, id)));
    scene.push('.');
    if let Some(action) = &context.action {
        lines.push((Section::Now, format!("Just now: {action}")));
    }
    lines.extend(tagged(
        Section::Now,
        context
            .events
            .iter()
            .filter(|event| context.action.as_ref() != Some(event))
            .cloned(),
    ));
    // The resolved turn above already covers this entity's own trip.
    let restated = |fact: &String| {
        context.outcome.is_some()
            && (fact.starts_with("Just arrived from ") || fact.starts_with("Leaving "))
    };
    lines.extend(tagged(
        Section::Facts,
        entity.facts.iter().filter(|f| !restated(f)).cloned(),
    ));
    if part == Part::Line {
        lines.extend(tagged(
            Section::Directions,
            knowledge::directions(context, id),
        ));
    }
    for fact in observations::facts(context)
        .as_array()
        .into_iter()
        .flatten()
    {
        if let Some(text) = fact["fact"].as_str() {
            lines.push((Section::Directions, text.to_string()));
        }
    }
    // Spoken lines are not replayed to a speaker (#1537): the voice comes
    // from the authored idiolect, and `repeat` reads the
    // speaker's own recent lines server-side. Reflection still sees them.
    for memory in &entity.memories {
        let text = memory.text.strip_prefix("World: ").unwrap_or(&memory.text);
        lines.push(match memory.kind.as_str() {
            // Now, not a log (#1537): a line sees this beat, not past deeds
            // in the present tense ("Vale gives the Lamp to Pip").
            _ if part == Part::Line => continue,
            "expression" => (Section::Earlier, format!("Earlier: {text}")),
            _ => (Section::Memories, format!("I remember: {text}")),
        });
    }
    // A thought colours speech for a few turns; a dream only on waking.
    // Reflection itself sees every kept thought.
    if let Some(life) = &entity.inner_life {
        let fresh = |m: &&InnerMoment, turns: u64| {
            part != Part::Line || context.turn <= m.turn.saturating_add(turns)
        };
        if let Some(thought) = life.thoughts.last().filter(|m| fresh(m, THOUGHT_GAP)) {
            lines.push((Section::Inner, format!("On my mind: {}", thought.text)));
        }
        if let Some(dream) = life.dreams.last().filter(|m| fresh(m, 2)) {
            lines.push((Section::Inner, format!("I dreamed: {}", dream.text)));
        }
    }
    if part != Part::Line {
        if let Some(hope) = &entity.hope {
            lines.push((
                Section::Inner,
                format!("What I hope for: {} {}", hope.wish, hope.next),
            ));
        }
    }
    if avatar && part == Part::Line {
        if let Some(listener) = listener(context, id) {
            lines.push((
                Section::Now,
                format!("I'm talking with {}.", name(&listener)),
            ));
        } else if leaving(context, id) {
            lines.push((Section::Now, "I'm saying goodbye to those staying.".into()));
        }
    }
    if let Some(poem) = &entity.poem {
        lines.extend(tagged(Section::Facts, recital::prompt_lines(poem)));
    }
    // No authored sample lines (#1537): the voice comes from the idiolect
    // and the world, never from example utterances.
    let mut out: Vec<(Section, String)> = tagged(
        Section::Now,
        ["Current scene:".to_string(), scene, String::new()],
    )
    .collect();
    if lines.is_empty() {
        out.push((Section::Now, String::new()));
    }
    out.extend(lines);
    out.push((Section::Now, String::new()));
    if part == Part::Line {
        if let Some(line) = answered(context, entity) {
            out.push((
                Section::Conversation,
                format!("{}: {}", name(&line.actor_id), line.text),
            ));
        }
    } else {
        for line in context
            .conversation
            .iter()
            .filter(|line| witnessed(entity, line))
        {
            out.push((
                Section::Conversation,
                format!("{}: {}", name(&line.actor_id), line.text),
            ));
        }
    }
    out.push((Section::Now, cue(&own, part)));
    out
}

/// Whether the entity heard a table line.
fn witnessed(entity: &Entity, line: &SpokenLine) -> bool {
    line.witnesses.as_ref().map_or_else(
        || {
            entity.memories.iter().any(|m| {
                m.kind == "expression"
                    && m.text == format!("{}: {}", name(&line.actor_id), line.text)
            })
        },
        |ids| ids.contains(&entity.id),
    )
}

/// The one past line a speaker answers: the acting avatar's latest line
/// it heard, when this turn's Talk is aimed at it.
fn answered<'a>(context: &'a Context, entity: &Entity) -> Option<&'a SpokenLine> {
    let actor = context.acting_avatar.as_deref().unwrap_or("vale");
    let card = &context.outcome.as_ref()?.card;
    if card.kind != "talk" || card.target.as_deref() != Some(&entity.id) || entity.id == actor {
        return None;
    }
    context
        .conversation
        .iter()
        .rev()
        .find(|line| line.actor_id == actor && witnessed(entity, line))
}

/// The speaker's last three spoken lines, read from its memories, its
/// previous reply and the table lines it spoke. None of them is sent.
fn recent_own_lines(context: &Context, entity: &Entity) -> Vec<String> {
    let own = format!("{}: ", name(&entity.id));
    let mut lines: Vec<String> = Vec::new();
    let spoken = entity
        .memories
        .iter()
        .filter(|m| m.kind == "expression")
        .filter_map(|m| m.text.strip_prefix(&own).map(str::to_string))
        .chain(
            context
                .conversation
                .iter()
                .filter(|line| line.actor_id == entity.id)
                .map(|line| line.text.clone()),
        )
        .chain(entity.previous.clone());
    for line in spoken {
        lines.retain(|kept| *kept != line);
        lines.push(line);
    }
    let start = lines.len().saturating_sub(3);
    lines.split_off(start)
}

/// A rejected reply gets fresh wording grounded in the scene.
fn attempt_transcript(context: &Context, entity: &Entity, part: Part, attempt: u8) -> String {
    let prompt = transcript(context, entity, part);
    if attempt == 0
        || kind(&entity.id, "location")
        || part == Part::Dream
        || waking::applies(context, &entity.id, part)
    {
        return prompt;
    }
    let current = prompt
        .split_once("Current scene:\n")
        .map_or(prompt.as_str(), |(_, scene)| scene);
    format!("My next words are fresh and describe this moment.\n\nCurrent scene:\n{current}")
}

/// The transcript tag the reply continues from.
fn cue(own: &str, part: Part) -> String {
    match part {
        Part::Line => format!("{own}:"),
        Part::Thought => format!("{own}, to myself:"),
        Part::Persona => format!("{own}, who I am now:"),
        Part::Dream => format!("{own}, last night's dream:"),
    }
}

/// Who a speaker addresses: Vale answers the first other speaker; everyone
/// else answers Vale when Vale speaks, or the first other speaker.
fn listener(context: &Context, id: &str) -> Option<String> {
    if !context.speakers.iter().any(|s| s == id) {
        return None;
    }
    let others: Vec<_> = context.speakers.iter().filter(|s| *s != id).collect();
    let actor = context.acting_avatar.as_deref().unwrap_or("vale");
    if id != actor && others.iter().any(|s| *s == actor) {
        Some(actor.to_string())
    } else {
        others.first().map(|s| s.to_string())
    }
}

fn leaving(context: &Context, id: &str) -> bool {
    context.outcome.as_ref().is_some_and(|o| {
        o.avatars.iter().any(|a| {
            a.id == id
                && a.travel
                    .as_ref()
                    .is_some_and(|t| t.from == context.location && t.to != context.location)
        })
    })
}

/// Select a configured tier through the same registry and policy as every
/// world-content request.
fn tier_config(config: &AiConfig, model: Option<&str>) -> AiConfig {
    let mut config = config.clone();
    if let Some(model) = model {
        config
            .capability_models
            .insert(ModelCapability::WorldContent, model.into());
        config.reasoning_effort = config
            .pin_model(ModelCapability::WorldContent)
            .ok()
            .filter(|selection| selection.candidate().supported_parameters().reasoning)
            .map(|_| "none".to_string());
    }
    config
}

/// Reserve time for an escalation before running the voice's own attempts.
/// The timeout includes gateway readiness and queue waits as well as HTTP.
async fn voice_attempts<T, F, Fut>(
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    escalate: bool,
    mut request: F,
) -> Result<T, ()>
where
    F: FnMut(bool, u8, Duration) -> Fut,
    Fut: std::future::Future<Output = Result<T, ()>>,
{
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    let reserve = if escalate {
        settings.call_timeout.min(remaining / 2)
    } else {
        Duration::ZERO
    };
    let own_deadline = deadline - reserve;
    let own_attempts = settings.attempts.max(1);
    for attempt in 0..own_attempts + u8::from(escalate) {
        let escalation = attempt == own_attempts;
        let until = if escalation { deadline } else { own_deadline };
        let now = tokio::time::Instant::now();
        let remaining = until.saturating_duration_since(now);
        let budget = if escalate && !escalation {
            remaining / u32::from(own_attempts - attempt)
        } else {
            remaining
        }
        .min(settings.call_timeout);
        if budget.is_zero() {
            continue;
        }
        if let Ok(Ok(result)) =
            tokio::time::timeout_at(now + budget, request(escalation, attempt, budget)).await
        {
            return Ok(result);
        }
    }
    Err(())
}

/// Generate a validated part on its selected model, then use the optional
/// escalation model once when the earlier attempts need more help.
async fn speak(
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    settings: &VoiceSettings,
    deadline: tokio::time::Instant,
    id: &str,
    part: Part,
) -> Result<(String, String), ()> {
    let entity = entity(context, id);
    let own_model = (part == Part::Persona)
        .then_some(settings.reflection_model.as_deref())
        .flatten()
        .or_else(|| character_models.get(id).map(String::as_str));
    let own = tier_config(config, own_model);
    let selected = own
        .pin_model(ModelCapability::WorldContent)
        .map_err(|_| ())?;
    let escalation = settings
        .escalation_model
        .as_deref()
        .map(|model| tier_config(config, Some(model)))
        .filter(|candidate| {
            candidate
                .pin_model(ModelCapability::WorldContent)
                .is_ok_and(|other| {
                    selected.requested_model_id() != other.requested_model_id()
                        && match (
                            selected.candidate().concrete_model(),
                            other.candidate().concrete_model(),
                        ) {
                            (Some(left), Some(right)) => left != right,
                            _ => true,
                        }
                })
        });
    let system = waking::system(context, entity, part);
    let mut check = Check::new(context, entity, part);
    if part == Part::Line {
        check.limit = settings.line_limit;
        if kind(id, "location") {
            check.limit = check.limit.min(180);
            // A narrator place may notice, reason and break off.
            check.sentences = if atmosphere::narrator(id) { 3 } else { 1 };
        }
    }
    // A reply that only missed its fact is kept. If no later attempt tells
    // the fact, the speaker still speaks and the fact stays for another Talk.
    let untold = std::sync::Mutex::new(None);
    let call = voice_metrics::Call::new(
        id,
        part,
        voice_metrics::Budget::measure(&system, context, entity, part),
    );
    let spoken = voice_attempts(
        settings,
        deadline,
        escalation.is_some(),
        |escalated, attempt, timeout| {
            let config = if escalated {
                escalation.as_ref().unwrap()
            } else {
                &own
            };
            let system = &system;
            let user = attempt_transcript(context, entity, part, attempt);
            let check = &check;
            let untold = &untold;
            let call = &call;
            call.attempt();
            async move {
                let request = ChatCompletionRequest {
                    feature: "card_voice",
                    prompt_version: "card-voice-v3",
                    capability: ModelCapability::WorldContent,
                    system,
                    user: &user,
                    temperature: if part == Part::Dream {
                        1.2
                    } else {
                        1.0 - 0.1 * f64::from(attempt)
                    },
                    max_tokens: if part == Part::Persona { 160 } else { 96 },
                    timeout,
                    max_attempts: 1,
                    referer: "https://cosyworld.fly.dev",
                    response_format: None,
                    room_id: None,
                };
                let completion =
                    request_chat_completion(config, request)
                        .await
                        .map_err(|error| {
                            call.reject("provider");
                            tracing::info!(
                                feature = "card_voice",
                                entity = id,
                                attempt = attempt + 1,
                                escalated,
                                reason = "provider",
                                failure = error.code(),
                                "card voice rejected"
                            );
                        })?;
                let finished = matches!(completion.finish_reason.as_str(), "stop" | "end_turn");
                check
                    .clean(&completion.text, finished)
                    .map(|text| (text.clone(), completion.resolved_model_id.clone()))
                    .map_err(|reason| {
                        call.reject(reason);
                        tracing::info!(
                            feature = "card_voice",
                            entity = id,
                            attempt = attempt + 1,
                            escalated,
                            reason,
                            excerpt = %excerpt(&completion.text),
                            "card voice rejected"
                        );
                        if reason == "knowledge_fact" {
                            if let Ok(text) = check.untold(&completion.text, finished) {
                                let mut kept = untold.lock().expect("untold reply");
                                kept.get_or_insert((text, completion.resolved_model_id));
                            }
                        }
                    })
            }
        },
    )
    .await;
    if spoken.is_ok() {
        call.finish(voice_metrics::Outcome::Spoken);
    }
    spoken.or_else(|()| {
        let Some(kept) = untold.into_inner().expect("untold reply") else {
            call.finish(voice_metrics::Outcome::Silent);
            return Err(());
        };
        call.finish(voice_metrics::Outcome::Untold);
        tracing::info!(
            feature = "card_voice",
            entity = id,
            reason = "knowledge_fact",
            "card voice spoke without its fact"
        );
        Ok(kept)
    })
}

/// A bounded, single-line excerpt of a rejected reply for the log. Long
/// unbroken runs, which could be keys or encoded data, are not copied.
fn excerpt(text: &str) -> String {
    let words: Vec<_> = text
        .split_whitespace()
        .map(|word| {
            if word.chars().count() > 24 {
                "[…]"
            } else {
                word
            }
        })
        .collect();
    let line = words.join(" ");
    let mut short: String = line.chars().filter(|c| !c.is_control()).take(80).collect();
    if line.chars().count() > 80 {
        short.push('…');
    }
    short
}

/// Phrases that belong to an assistant, not to anyone at this table. The
/// second group was collected from forty small models answering the real
/// transcript on 2026-10-23: a model that analyses the scene instead of
/// speaking in it opens with these.
const ASSISTANT_SPEAK: &[&str] = &[
    "as an ai",
    "language model",
    "i'm here to help",
    "i am here to help",
    "how can i assist",
    "certainly!",
    "i cannot",
    "i can't help",
    "prompt",
    "the user",
    "roleplay",
    "role-play",
    "in character",
    "it seems",
    "it appears",
    "it looks like you",
    "here is the",
    "here's the",
    "here is a",
    "here's a",
    "let's break",
    "let's analy",
    "let's build on",
    "let's flesh",
    "let's solidif",
    "let's navigate",
    "let's dive",
    "let's continue",
    "let's play this out",
    "okay, let",
    "okay, this",
    "continue the",
    "continue this",
    "scenario",
    "narrative",
    "continuation",
    "breakdown",
    "text-based",
    "choose-your-own",
    "short story",
    "what do you do?",
    "to do next",
    "or something else?",
    "dialogue scene",
    "i'd be delighted",
    "i'll do my best",
    "i can help",
    "i can provide",
    "i'll provide",
    "this scene",
    "the scene",
    "your character",
    "your objective",
    "in this setting",
    "sure thing",
    "of course!",
];

/// What a reply is checked against before it is published.
struct Check<'a> {
    expression: expression::Mode,
    context: &'a Context,
    entity: &'a Entity,
    part: Part,
    limit: usize,
    sentences: usize,
    known: BTreeSet<String>,
    /// The transcript's own lines (scene, awareness, recent talk), minus the
    /// entity's authored lines and cue. A reply that repeats a run of them,
    /// or one of their labels ("I remember:", "Holding:"), is a read-back of
    /// the brief, not speech.
    brief: Vec<String>,
    labels: Vec<String>,
    /// The speaker's last three lines, from memory; never in the prompt.
    recent: Vec<String>,
    /// The line this reply answers, when there is one.
    answered: Option<String>,
}

impl<'a> Check<'a> {
    fn new(context: &'a Context, entity: &'a Entity, part: Part) -> Self {
        let (limit, sentences) = part.limits();
        let own = name(&entity.id);
        let brief: Vec<String> = transcript(context, entity, part)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with(&format!("{own}:")))
            .map(str::to_string)
            .collect();
        let labels = brief
            .iter()
            .flat_map(|line| line.split(". "))
            .filter_map(|sentence| sentence.split_once(':'))
            .map(|(head, _)| head.trim())
            .filter(|head| !head.is_empty() && head.split_whitespace().count() <= 4)
            .map(|head| format!("{head}:"))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        Self {
            expression: if part == Part::Line {
                expression::mode(&profiles()[&entity.id])
            } else {
                expression::Mode::Speech
            },
            context,
            entity,
            part,
            limit,
            sentences,
            known: known(context),
            brief,
            labels,
            recent: recent_own_lines(context, entity),
            answered: (part == Part::Line)
                .then(|| answered(context, entity).map(|line| line.text.clone()))
                .flatten(),
        }
    }

    /// Reduce a plain reply to the words themselves, then reject it when it
    /// breaks shape, speaks as an assistant, names someone the scene does not
    /// know, copies an example, or repeats the play or a recent line.
    fn clean(&self, raw: &str, finished: bool) -> Result<String, &'static str> {
        self.checked(raw, finished, true)
    }

    /// The same checks without the fact. A reply that passes them may still
    /// be spoken, but it teaches nothing: the game counts a fact only when
    /// its own check finds the sentence in the published line.
    fn untold(&self, raw: &str, finished: bool) -> Result<String, &'static str> {
        self.checked(raw, finished, false)
    }

    fn checked(&self, raw: &str, finished: bool, tell: bool) -> Result<String, &'static str> {
        let own = name(&self.entity.id);
        if self.expression != expression::Mode::Speech {
            let text = expression::clean(self.expression, raw, &own, self.limit, finished)?;
            if !observations::consistent(&text, self.context) {
                return Err("observable_state");
            }
            if !custody::consistent(&text, self.context, &self.entity.id) {
                return Err("custody");
            }
            if self.entity.previous.as_deref() == Some(text.as_str()) {
                return Err("repeat");
            }
            for (id, profile) in profiles().as_object().expect("profiles") {
                if profile["name"]
                    .as_str()
                    .is_some_and(|name| mentions(&text, name))
                    && !self.known.contains(id)
                {
                    return Err("unknown entity");
                }
            }
            return Ok(text);
        }
        let mut lines = raw.trim().lines().map(str::trim).filter(|l| !l.is_empty());
        let line = lines.next().ok_or("empty")?;
        let cut_line = lines.next().is_some();
        let mut text = line.split_whitespace().collect::<Vec<_>>().join(" ");
        // Stage directions such as *shrugs* or (quietly) are not speech. A
        // word or two emphasised in the middle of a sentence (*click*), or a
        // span glued to a word (the *pond*'s edge), is speech, so it keeps
        // its words rather than leaving a hole.
        for (open, close) in [('*', '*'), ('(', ')'), ('[', ']')] {
            let mut from = 0;
            while let Some(start) = text[from..].find(open).map(|at| at + from) {
                let inner_start = start + open.len_utf8();
                let Some(len) = text[inner_start..].find(close) else {
                    break;
                };
                let end = inner_start + len + close.len_utf8();
                let inner = text[inner_start..inner_start + len].trim().to_string();
                let glued = |c: char| c.is_alphanumeric() || c == '\'' || c == '\u{2019}';
                let emphasis = !inner.is_empty()
                    && (text[..start].chars().next_back().is_some_and(glued)
                        || text[end..].chars().next().is_some_and(glued)
                        || (open == '*'
                            && start > 0
                            && end < text.len()
                            && inner.split_whitespace().count() <= 2));
                if emphasis {
                    text.replace_range(start..end, &inner);
                    from = start + inner.len();
                } else {
                    text.replace_range(start..end, "");
                    from = start;
                }
            }
        }
        text = text.replace(['*', '_', '#'], "");
        text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        loop {
            let trimmed = text.trim_start();
            let label = trimmed.split_once(':').filter(|(head, _)| {
                let head = head.trim();
                head.len() <= own.len() + 24
                    && (head.starts_with(&own)
                        || head.eq_ignore_ascii_case(&self.entity.id)
                        || head.eq_ignore_ascii_case("me"))
            });
            match label {
                Some((_, rest)) => text = rest.to_string(),
                None => break,
            }
        }
        // A second speaker tag ends this entity's turn.
        for profile in profiles().as_object().expect("profiles").values() {
            if let Some(other) = profile["name"].as_str().filter(|n| *n != own) {
                if let Some(at) = text.find(&format!("{other}:")) {
                    text.truncate(at);
                }
            }
        }
        let quotes: &[char] = &[
            '"', '\'', '\u{201c}', '\u{201d}', '\u{2018}', '\u{2019}', ' ',
        ];
        let text = text.trim().trim_matches(quotes);
        let mut kept = String::new();
        let mut count = 0;
        let mut chars = text.char_indices().peekable();
        let mut start = 0;
        while let Some((i, c)) = chars.next() {
            if matches!(c, '.' | '!' | '?' | '\u{2026}') {
                let next = chars.peek().map(|(_, n)| *n);
                if next.is_none_or(|n| n.is_whitespace() || quotes.contains(&n)) {
                    let end = i + c.len_utf8();
                    let sentence = text[start..end].trim().trim_matches(quotes);
                    if !sentence.is_empty() {
                        if kept.chars().count() + sentence.chars().count() + 1 > self.limit {
                            break;
                        }
                        if !kept.is_empty() {
                            kept.push(' ');
                        }
                        kept.push_str(sentence);
                        count += 1;
                    }
                    start = end;
                    if count == self.sentences {
                        break;
                    }
                }
            }
        }
        // A finished, single-line imperative can stand without punctuation.
        // A continuation mark or a cut line needs a fresh complete reply.
        let continuation = text.ends_with([',', ':', ';', '-', '–', '—', '‐', '‑']);
        if kept.is_empty()
            && finished
            && !cut_line
            && !continuation
            && text.split_whitespace().count() >= 2
        {
            kept = text.trim_matches(quotes).to_string();
        }
        if kind(&self.entity.id, "location") && !atmosphere::consistent(&kept, &self.entity.id) {
            return Err("atmosphere");
        }
        if !bounded(&kept, self.limit) {
            return Err("shape");
        }
        if tell
            && self.part == Part::Line
            && !knowledge::delivered(self.context, &self.entity.id, &kept)
        {
            return Err("knowledge_fact");
        }
        if !observations::consistent(&kept, self.context) {
            return Err("observable_state");
        }
        if !custody::consistent(&kept, self.context, &self.entity.id) {
            return Err("custody");
        }
        if !recital::consistent(&kept, &self.entity.id, self.entity.poem.as_ref()) {
            return Err("story_outcome");
        }
        let lower = kept.to_lowercase();
        if ASSISTANT_SPEAK.iter().any(|phrase| lower.contains(phrase)) {
            return Err("assistant");
        }
        for (id, profile) in profiles().as_object().expect("profiles") {
            let named = profile["name"].as_str().is_some_and(|n| mentions(&kept, n));
            if named && !self.known.contains(id) {
                return Err("unknown entity");
            }
        }
        let normal = |s: &str| {
            s.chars()
                .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                .flat_map(char::to_lowercase)
                .collect::<String>()
        };
        let words = |s: &str| {
            normal(s)
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        };
        let freely_spoken = if self.part == Part::Line {
            knowledge::other_words(self.context, &self.entity.id, &kept)
        } else {
            kept.clone()
        };
        let key = words(&kept).concat();
        let sharing = freely_spoken != kept;
        let repeats = key.is_empty()
            || self
                .context
                .action
                .as_deref()
                .is_some_and(|a| words(a).concat() == key)
            || self
                .entity
                .previous
                .as_deref()
                .is_some_and(|p| words(p).concat() == key)
            || self
                .recent
                .iter()
                .chain(self.answered.iter())
                .any(|line| words(line).concat() == key);
        if repeats && !sharing {
            return Err("repeat");
        }
        // A character speaks as "I"; a line that names its speaker in the
        // third person ("Vale's eyes flick to Pip") is narration.
        if kind(&self.entity.id, "avatar") && mentions(&freely_spoken, &own) {
            return Err("self-narration");
        }
        // The stage shows the play; a line that narrates the speaker's own
        // deed ("I give the Lamp to Pip.") is a stage direction.
        if kind(&self.entity.id, "avatar") && stage_action(&kept) {
            return Err("stage action");
        }
        // A line wrapped in its own dialogue tag (`hit you back," I say,
        // keeping my hand…`) leaves a stray quote or tags its speaker.
        let marks = kept.matches(['"', '\u{201c}', '\u{201d}']).count();
        if kind(&self.entity.id, "avatar")
            && (marks % 2 == 1 || [",\" I ", ",\u{201d} I "].iter().any(|t| kept.contains(t)))
        {
            return Err("narration tag");
        }
        let spoken = words(&freely_spoken);
        if self.labels.iter().any(|label| kept.contains(label))
            || self.brief.iter().any(|line| {
                let brief = words(line);
                spoken
                    .windows(6)
                    .any(|run| brief.windows(6).any(|other| other == run))
            })
        {
            return Err("echoed brief");
        }
        Ok(kept)
    }
}

/// Whether a sentence narrates the speaker's own present deed with an item:
/// "I give the Lamp to Pip." "I take the Bell." "I give you my word" speaks.
fn stage_action(text: &str) -> bool {
    text.split_inclusive(['.', '!', '?', ';'])
        .map(|s| s.trim().to_lowercase())
        .any(|s| {
            ["give", "hand", "pass", "take", "offer", "drop", "put"]
                .iter()
                .any(|verb| s.starts_with(&format!("i {verb} the ")))
        })
}

/// Whether `text` names `name` as a whole word.
fn mentions(text: &str, name: &str) -> bool {
    text.match_indices(name).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + name.len()..].chars().next();
        !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    /// Vale chose Wait: due a first thought, not yet a dream.
    pub(super) fn resting(c: &mut Context) {
        c.resting = Some("vale".into());
    }

    /// Vale waited with two thoughts settled since any dream, so a thought
    /// and a dream are both due. Earlier events count as new since then.
    pub(super) fn dream_due(c: &mut Context) {
        resting(c);
        c.turn = c.turn.max(20);
        c.revision = c.revision.max(c.turn);
        let vale = &mut c.entities[0];
        for m in vale.memories.iter_mut().filter(|m| m.kind == "event") {
            m.turn = m.turn.max(12);
        }
        vale.inner_life
            .get_or_insert_with(InnerLife::default)
            .thoughts = vec![
            InnerMoment {
                turn: 2,
                text: "The road is long.".into(),
            },
            InnerMoment {
                turn: 9,
                text: "Someone kept a light on.".into(),
            },
        ];
    }

    pub(super) fn context() -> Context {
        serde_json::from_value(json!({"revision":4,"turn":4,"location":"station","focus":"lamp","speakers":["vale","moth"],"action":"Vale asks Pip what they want.","entities":[
            {"id":"vale","facts":["Holding the lamp."],"desire":{"items":["oil"],"location":"attic","avatars":["keeper"]},"memories":[],"previous":null},
            {"id":"station","facts":["Pip and Vale are here."],"desire":null,"memories":[{"turn":1,"kind":"event","text":"Vale arrived."}],"previous":null},
            {"id":"lamp","facts":["Held by Vale. Fuel 7/12."],"desire":null,"memories":[{"turn":2,"kind":"event","text":"Vale lit the lamp."}],"previous":null},
            {"id":"moth","facts":["Holding the black cloth."],"desire":{"items":["lamp"],"location":"pond","avatars":["vale"]},"memories":[{"turn":3,"kind":"expression","text":"Pip: I offered my cloth."}],"previous":null}
        ]})).unwrap()
    }
    #[tokio::test]
    async fn browser_chat_prepares_authored_prompts_and_checks_replies_without_provider_keys() {
        let scene = serde_json::to_value(context()).unwrap();
        let prepared = browser::prepare(&scene, None, None).unwrap();
        let call = prepared["calls"]
            .as_array()
            .unwrap()
            .iter()
            .find(|call| call["id"] == "vale" && call["part"] == "line")
            .unwrap();
        assert!(call["request"]["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("Vale"));
        // Player-funded dialogue uses the player's OpenRouter routing settings.
        for call in prepared["calls"].as_array().unwrap() {
            assert!(call["request"].get("provider").is_none());
        }
        let shared = browser::prepare(&scene, Some(&["moth".into()]), None).unwrap();
        let shared_calls = shared["calls"].as_array().unwrap();
        assert_eq!(shared_calls.len(), 1);
        assert_eq!(shared_calls[0]["id"], "moth");
        assert!(shared_calls[0]["request"].get("provider").is_none());
        assert!(!prepared.to_string().contains("api_key"));
        let answers = |text: &str| {
            serde_json::from_value(json!([
                {"id":"vale","part":"line","text":text,"finish":"stop"}
            ]))
            .unwrap()
        };
        assert_eq!(
            browser::complete(&scene, None, answers("I hear you.")).unwrap()["entries"][0]["text"],
            "I hear you."
        );
        assert!(browser::complete(&scene, None, answers("As an AI, I can help.")).is_err());
        assert!(browser::complete(&scene, None, answers("I hear you,")).is_err());
        let app = router_with_models::<()>(
            Arc::new(None),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        );
        let mut req = request(&context());
        *req.uri_mut() = "/card-game/text/prepare".parse().unwrap();
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::OK
        );
        let mut req = request(&context());
        *req.uri_mut() = "/card-game/text/prepare".parse().unwrap();
        req.headers_mut()
            .insert("sec-fetch-site", "cross-site".parse().unwrap());
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    fn solo_departure() -> TurnOutcome {
        serde_json::from_value(json!({
            "card":{"kind":"wait","target":null,"item":null,"receive":null,"destination":null,"accepted":null},
            "avatars":[
                {"id":"vale","location":"station","holding":[],"travel":null},
                {"id":"moth","location":"pond","holding":["lamp","cloth"],"travel":{"from":"station","to":"pond","companions":[]}},
                {"id":"keeper","location":"attic","holding":["oil","bell"],"travel":null}
            ],
            "items":[
                {"id":"lamp","holder":"moth","location":"pond"},
                {"id":"cloth","holder":"moth","location":"pond"},
                {"id":"oil","holder":"keeper","location":"attic"},
                {"id":"bell","holder":"keeper","location":"attic"}
            ]
        })).unwrap()
    }
    #[test]
    fn new_game_opening_asks_vale_alone_with_no_action() {
        // The browser's fresh attic context (narrativeContext at turn 0).
        let c: Context = serde_json::from_str(r#"{"revision":0,"turn":0,"outcome":{"card":{"kind":"arrive","target":null,"item":null,"receive":null,"destination":null,"accepted":null},"avatars":[{"id":"vale","location":"attic","holding":["lamp"],"travel":null}],"items":[{"id":"lamp","holder":"vale","location":"attic"}],"observations":[{"id":"lamp-flame","value":false},{"id":"lamp-cover","value":false}]},"location":"attic","scenery":true,"focus":null,"speakers":["vale"],"resting":null,"action":null,"events":["Vale stands alone in Mirror attic, holding an unlit lamp. A tall mirror reflects a black shore."],"conversation":[],"entities":[{"id":"attic","poem":null,"facts":["A tall mirror reflects a black shore. Dust gathers along its frame. The mirror holds the room and its window.","Paths visible now: none.","At the dialogue scene: Vale. Items here: Lamp."],"desire":null,"memories":[{"seq":1,"turn":0,"kind":"event","text":"World: Vale stands alone in Mirror attic, holding an unlit lamp. A tall mirror reflects a black shore."}],"previous":null},{"id":"vale","poem":null,"facts":["What I want most now: First light. A little warmth might wake this empty room.","Holding: Lamp.","Location now: Mirror attic. Company now: alone.","Still hoped for: Lamp alight.","Already holds the wanted Lamp.","Wants to be at Mirror attic; currently at Mirror attic.","At the dialogue scene: Vale. Items here: Lamp."],"desire":{"items":["lamp"],"location":"attic","avatars":[]},"memories":[{"seq":1,"turn":0,"kind":"event","text":"World: Vale stands alone in Mirror attic, holding an unlit lamp. A tall mirror reflects a black shore."}],"previous":null,"inner_life":null,"hope":null},{"id":"lamp","poem":null,"facts":["Held by or resting at: Vale.","Has oil; unlit; uncovered.","At the dialogue scene: Vale. Items here: Lamp."],"desire":null,"memories":[{"seq":1,"turn":0,"kind":"event","text":"World: Vale stands alone in Mirror attic, holding an unlit lamp. A tall mirror reflects a black shore."}],"previous":null}]}"#).unwrap();
        assert_eq!(c.turn, 0);
        assert!(c.action.is_none());
        assert_eq!(c.speakers, ["vale"]);
        assert!(valid(&c));
        let vale = c.entities.iter().find(|e| e.id == "vale").unwrap();
        assert!(transcript(&c, vale, Part::Line).ends_with("\nVale:"));
    }
    #[test]
    fn farewell_speakers_do_not_require_a_vale_reply() {
        let mut c = context();
        c.outcome = Some(solo_departure());
        c.speakers = vec!["moth".into()];
        assert!(valid(&c));
        // Vale listens: only the speaker, the place and the item in play are voiced.
        assert_eq!(voiced(&c), ["moth", "station", "lamp"]);
        let pip = transcript(&c, &c.entities[3], Part::Line);
        assert!(pip.contains("I'm leaving Empty station for Black pond on my own."));
        assert!(pip.contains("I'm saying goodbye to those staying."));
        assert!(pip.ends_with("\nPip:"));
        // A later Stay or a direct interaction can still request Vale's voice.
        c.speakers.insert(0, "vale".into());
        assert_eq!(voiced(&c)[..2], ["vale", "moth"]);
        assert!(transcript(&c, &c.entities[3], Part::Line).contains("I'm talking with Vale."));
        let vale = transcript(&c, &c.entities[0], Part::Line);
        assert!(vale.contains("Pip is leaving for Black pond, alone."));
        assert!(vale.contains("I'm talking with Pip."));
        assert!(vale.ends_with("\nVale:"));
    }

    /// Sentence-initial words that would turn a prompt into an instruction.
    const IMPERATIVES: &[&str] = &[
        "Write", "Return", "Use", "Keep", "Describe", "Speak", "Give", "Let", "Make", "Avoid",
        "Never", "Always", "Do", "Don't", "Answer", "Respond", "Treat", "Include", "Say", "Greet",
        "Ask", "Remember", "Stay", "Be",
    ];

    fn assert_no_instructions(text: &str) {
        for marker in ["you are", "You are", "JSON", "must ", "should "] {
            assert!(!text.contains(marker), "{marker:?} in {text}");
        }
        for sentence in text.split(['\n', '.', '!', '?', ':']) {
            let first = sentence.split_whitespace().next().unwrap_or("");
            assert!(
                !IMPERATIVES.contains(&first),
                "{first:?} opens {sentence:?}"
            );
        }
    }

    #[test]
    fn prompts_hold_only_first_person_idiolect_and_transcript() {
        for (id, profile) in profiles().as_object().unwrap() {
            // An avatar is one seed sentence: no persona, voice or idiolect.
            if profile["kind"] == "avatar" {
                let seed = profile["seed"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{id} seed"));
                assert!(bounded(seed, 120) && seed.ends_with('.'), "{id}");
                for gone in ["persona", "voice", "idiolect", "lines"] {
                    assert!(profile.get(gone).is_none(), "{id} {gone}");
                }
            }
            let Some(words) = profile["idiolect"].as_str() else {
                continue;
            };
            assert!(bounded(words, 400), "{id}");
            assert!(words.contains("I'm") || words.contains("I am") || words.contains("me"));
            assert_no_instructions(words);
        }
        let mut c = context();
        c.outcome = Some(solo_departure());
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 1,
            kind: "event".into(),
            text: "Vale received a gift.".into(),
        });
        for id in voiced(&c) {
            let e = entity(&c, &id);
            for part in [Part::Line, Part::Thought, Part::Persona, Part::Dream] {
                assert_no_instructions(&idiolect(e, part));
                assert_no_instructions(&transcript(&c, e, part));
                // Each call stays well inside a small model's context.
                let tokens = (idiolect(e, part).len() + transcript(&c, e, part).len()) / 4;
                assert!(tokens <= 1_100, "{id}: {tokens} tokens");
            }
        }
    }

    #[test]
    fn plain_replies_keep_the_words_and_drop_labels_quotes_and_directions() {
        let mut c = context();
        c.conversation.push(SpokenLine {
            witnesses: Some(vec!["vale".into(), "moth".into(), "keeper".into()]),
            actor_id: "moth".into(),
            text: "Bring that lamp to the pond.".into(),
        });
        c.entities[3].previous = Some("My sleeves are dry.".into());
        c.entities[3].memories.push(Memory {
            seq: None,
            turn: 2,
            kind: "event".into(),
            text: "The keeper polished the brass bell twice.".into(),
        });
        let pip = &c.entities[3];
        let check = Check::new(&c, pip, Part::Line);
        let clean = |raw: &str| check.clean(raw, true);
        let line = "Hold it higher, then. The light reaches my sleeves.";
        for raw in [
            line.to_string(),
            format!("Pip: {line}"),
            format!("\"{line}\""),
            format!("*shifts a little* {line}"),
            format!("{line} And another thing. And on."),
            format!("**Pip:** {line}\n\nI hope that helps!"),
            format!("{line}\nVale: Sure."),
            format!("{line} Vale: Sure."),
            format!("Pip, to myself: \u{201c}{line}\u{201d}"),
        ] {
            assert_eq!(clean(&raw).as_deref(), Ok(line), "{raw}");
        }
        assert_eq!(clean("Hold it higher").as_deref(), Ok("Hold it higher"));
        assert!(check.clean("Hold it higher", false).is_err());
        for (raw, reason) in [
            ("", "empty"),
            ("   ", "empty"),
            ("Vale asks Pip what they want.", "repeat"),
            ("\"Bring that lamp to the pond!\"", "repeat"),
            ("My sleeves are dry.", "repeat"),
            ("Line one.\u{7}", "shape"),
            ("As an AI, I love lamps.", "assistant"),
            ("Certainly! Here is Pip's line.", "assistant"),
            // Badger is nowhere in this scene, so no one can mention him.
            ("Grumpy Badger would hate this noise.", "unknown entity"),
        ] {
            assert_eq!(clean(raw), Err(reason), "{raw}");
        }
        assert_eq!(clean(&format!("{}.", "a".repeat(400))), Err("shape"));
        // Known names pass as whole words; a word that contains one is not a name.
        assert!(clean("The keeper will want that oil.").is_ok());
        assert!(!mentions("Pipes rattle.", "Pip") && mentions("Pip's lamp.", "Pip"));
        // Observed on OpenRouter, 2026-10-23: analysis instead of speech,
        // third-person narration of oneself, and read-backs of the brief.
        for (raw, reason) in [
            ("It seems like you're creating a short story.", "assistant"),
            // The unfinished colon is rejected before its assistant wording.
            ("Here is the completion for Pip's dialogue:", "shape"),
            (
                "Okay, let's break down what Pip might say next.",
                "assistant",
            ),
            ("What do you do? You could speak with Vale.", "assistant"),
            ("What do you want the lamp to do next?", "assistant"),
            (
                "Pip adjusts the borrowed waistcoat and smiles.",
                "self-narration",
            ),
            ("I remember: the lamp moved.", "echoed brief"),
            (
                "Yes, the keeper polished the brass bell twice.",
                "echoed brief",
            ),
            // Observed on .dev, 2026-10-31: a first-person dialogue tag.
            (
                "\"You hit me and I hit back,\" I say, keeping my hand near the door.",
                "narration tag",
            ),
            ("\"Stay,\" I say, \"and listen.\"", "narration tag"),
            // Observed on .dev, 2026-11-01: an earlier give told as this beat.
            ("I give the Lamp to Pip. I'll keep the course steady.", "stage action"),
            ("Fine. I take the bell.", "stage action"),
        ] {
            assert_eq!(clean(raw), Err(reason), "{raw}");
        }
        // A word emphasised mid-sentence keeps its word; directions still go.
        assert_eq!(
            clean("The rhythmic *click* of boots reaches my sleeves."),
            Ok("The rhythmic click of boots reaches my sleeves.".into())
        );
        assert_eq!(clean("Fine. *walks away slowly*"), Ok("Fine.".into()));
        assert_eq!(
            clean("At the *black still pond*'s edge, I wait."),
            Ok("At the black still pond's edge, I wait.".into())
        );
        assert_eq!(clean("The"), Err("shape"));
        assert_eq!(
            clean("Yes. *She folds the cloth and looks away.* No."),
            Ok("Yes. No.".into())
        );
    }

    #[test]
    fn expression_checks_keep_movement_and_emoji_in_their_authored_form() {
        let c = context();
        let pip = &c.entities[3];
        let mut check = Check::new(&c, pip, Part::Line);
        check.expression = expression::Mode::Movement;
        assert_eq!(
            check.clean("Pip tilts his head toward the lamp.", true),
            Ok("Pip tilts his head toward the lamp.".into())
        );
        assert_eq!(check.clean("I will help you.", true), Err("expression"));
        check.expression = expression::Mode::Emoji;
        assert_eq!(check.clean("🌳 👀", true), Ok("🌳👀".into()));
        assert_eq!(check.clean("A tree 🌳", true), Err("expression"));
        assert_eq!(check.clean("🌳👀", false), Err("expression"));
    }

    #[test]
    fn unfinished_speech_shapes_retry_while_complete_words_keep_their_voice() {
        let c = bard_context();
        let check = Check::new(&c, &c.entities[3], Part::Line);
        for raw in [
            "I want the story,",
            "I want the story:",
            "I want the story;",
            "I want the story-",
            "I want the story–",
            "I want the story—",
            "“I want the story,”",
            "I want the story,\nand a patient ear.",
            "Hold it higher\nVale: I will.",
        ] {
            assert_eq!(check.clean(raw, true), Err("shape"), "{raw:?}");
        }
        for raw in [
            "Hold it higher",
            "I hear a hard choice in those lines.",
            EARNED_VERSE,
        ] {
            assert_eq!(check.clean(raw, true), Ok(raw.into()));
        }
        assert_eq!(check.clean("Hold it higher", false), Err("shape"));
        assert_eq!(
            check.clean("I hear you.\nVale: I will.", true),
            Ok("I hear you.".into())
        );
    }

    #[tokio::test]
    async fn provider_fragments_retry_before_local_or_shared_publication() {
        for (raw, finish, shared, retry) in [
            ("I want the story,", Some("stop"), false, true),
            (
                "I want the story,\nand a patient ear.",
                Some("stop"),
                true,
                true,
            ),
            ("Hold it higher", None, false, true),
            ("Hold it higher", Some("unknown"), true, true),
            ("Hold it higher", Some("stop"), false, false),
            ("Hold it higher", Some("end_turn"), true, false),
        ] {
            let tries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let count = tries.clone();
            let provider = Router::new().route("/chat/completions", post(move |Json(body): Json<Value>| {
                let attempt = count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                async move {
                    let mut choice = json!({"message":{"content":if attempt == 0 { raw } else { EARNED_VERSE }}});
                    if let Some(reason) = if attempt == 0 { finish } else { Some("stop") } {
                        choice["finish_reason"] = json!(reason);
                    }
                    Json(json!({"model":body["model"],"choices":[choice]}))
                }
            }));
            let (address, server) = serve(provider).await;
            let c = bard_context();
            let ids = vec!["greek-rhapsode".into()];
            let published = Mutex::new(Vec::new());
            let emit = |text: &str| {
                published.lock().unwrap().push(text.to_string());
                true
            };
            let result = if shared {
                shared_lines(
                    &test_config(address),
                    &serde_json::to_value(&c).unwrap(),
                    &ids,
                    &BTreeMap::new(),
                )
                .await
                .unwrap()
            } else {
                complete_selected(
                    &test_config(address),
                    &c,
                    &BTreeMap::new(),
                    &VoiceSettings::hosted(),
                    &ids,
                    false,
                    Some(&emit),
                )
                .await
                .unwrap()
            };
            let expected = if retry { EARNED_VERSE } else { raw };
            assert_eq!(result["entries"][0]["text"], expected, "{raw:?} {finish:?}");
            assert_eq!(
                tries.load(std::sync::atomic::Ordering::SeqCst),
                if retry { 2 } else { 1 }
            );
            if !shared {
                let output = published.lock().unwrap().join(" ");
                assert!(output.contains(expected));
                if retry {
                    assert!(!output.contains(raw));
                }
            }
            server.abort();
        }
    }

    #[test]
    fn waking_from_a_long_rest_brings_a_thought_and_a_dream() {
        let mut c = context();
        c.turn = 24;
        c.revision = 24;
        c.rest = Some("long".into());
        // A long rest belongs to the avatar who waited.
        assert!(!valid(&c));
        c.resting = Some(c.entities[0].id.clone());
        assert!(valid(&c));
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, true));
        c.rest = Some("short".into());
        assert!(!valid(&c));
    }

    #[test]
    fn reflections_follow_witnessed_experience_and_keep_a_bounded_cadence() {
        let mut c = context();
        let vale = c.entities[0].id.clone();
        assert_eq!(reflection_due(&c, &c.entities[0]), (false, false));
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 1,
            kind: "event".into(),
            text: "Vale received a gift.".into(),
        });
        // Something happened, but only a Wait turns the avatar inward.
        assert_eq!(reflection_due(&c, &c.entities[0]), (false, false));
        c.resting = Some(vale.clone());
        assert!(valid(&c));
        // A first thought never arrives with a dream: two must settle first.
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, false));
        c.entities[0].inner_life = Some(InnerLife {
            persona: Some("I am learning to trust gifts.".into()),
            thoughts: vec![InnerMoment {
                turn: 1,
                text: "That was generous.".into(),
            }],
            dreams: vec![],
        });
        assert_eq!(reflection_due(&c, &c.entities[0]), (false, false));
        c.turn = 7;
        c.revision = 7;
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 6,
            kind: "event".into(),
            text: "Vale shared the lamp.".into(),
        });
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, false));
        let life = c.entities[0].inner_life.as_mut().unwrap();
        life.thoughts.push(InnerMoment {
            turn: 7,
            text: "Sharing felt easy.".into(),
        });
        c.turn = 13;
        c.revision = 13;
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 12,
            kind: "event".into(),
            text: "Vale crossed the pond.".into(),
        });
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, true));
        // After a dream, two more thoughts and a long night must pass.
        let life = c.entities[0].inner_life.as_mut().unwrap();
        life.dreams.push(InnerMoment {
            turn: 13,
            text: "A lamp became a small sun.".into(),
        });
        life.thoughts.push(InnerMoment {
            turn: 13,
            text: "The water held still.".into(),
        });
        c.turn = 19;
        c.revision = 19;
        c.entities[0].memories.last_mut().unwrap().turn = 18;
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, false));
        c.entities[0]
            .inner_life
            .as_mut()
            .unwrap()
            .thoughts
            .push(InnerMoment {
                turn: 19,
                text: "Again the pond.".into(),
            });
        c.turn = 25;
        c.revision = 25;
        c.entities[0].memories.last_mut().unwrap().turn = 24;
        // Two thoughts since the dream, but the night is not over yet.
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, false));
        c.entities[0]
            .inner_life
            .as_mut()
            .unwrap()
            .thoughts
            .push(InnerMoment {
                turn: 25,
                text: "The lamp again.".into(),
            });
        // Saves keep the four newest thoughts.
        c.entities[0]
            .inner_life
            .as_mut()
            .unwrap()
            .thoughts
            .remove(0);
        c.turn = 37;
        c.revision = 37;
        c.entities[0].memories.last_mut().unwrap().turn = 36;
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, true));
        // Another avatar's Wait does not make Vale think.
        c.resting = Some("moth".into());
        assert_eq!(reflection_due(&c, &c.entities[0]), (false, false));
        c.resting = Some(vale);
        assert!(valid(&c));
        c.entities[0].inner_life.as_mut().unwrap().dreams[0].turn = 99;
        assert!(!valid(&c));
    }

    /// A provider that answers each stem with plain text and records requests.
    const EARNED_VERSE: &str = "I told her I would turn away. Her brother waited by the wall.";
    const POEM_FACT: &str = "My poem Before the Burial holds deeds by Vale.";

    fn bard_context() -> Context {
        let mut value = serde_json::to_value(context()).unwrap();
        value["speakers"] = json!(["vale", "greek-rhapsode"]);
        value["outcome"] = serde_json::to_value(solo_departure()).unwrap();
        value["outcome"]["card"]["kind"] = json!("talk");
        value["outcome"]["card"]["target"] = json!("greek-rhapsode");
        value["entities"][3]["id"] = json!("greek-rhapsode");
        value["entities"][3]["facts"] = json!([]);
        value["entities"][3]["poem"] = json!({
            "title":"Before the Burial",
            "stanzas":[{"id":"greek-report-plan","turn":1,"authorId":"vale","authorName":"Vale"}]
        });
        value["entities"][3]["memories"] = json!([]);
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn poem_context_names_its_travellers_without_couplet_text() {
        let c = bard_context();
        let check = Check::new(&c, &c.entities[3], Part::Line);
        assert!(!idiolect(&c.entities[3], Part::Line).contains("sing an earned couplet"));
        for words in [
            EARNED_VERSE,
            "I hear a hard choice in those lines.",
            "I wonder how she will remember that refusal.",
        ] {
            assert_eq!(check.clean(words, true), Ok(words.into()));
        }
        assert_eq!(
            check.clean(
                "I laid her brother in the earth. The king's words crossed the wind.",
                true
            ),
            Err("story_outcome")
        );
        let retry = attempt_transcript(&c, &c.entities[3], Part::Line, 1);
        assert!(retry.starts_with("My next words are fresh"));
        assert!(retry.contains(POEM_FACT));
        assert!(!retry.contains("Her brother waited by the wall."));
        assert!(recital::valid(
            "greek-rhapsode",
            c.entities[3].poem.as_ref(),
            c.turn
        ));
        let mut altered = bard_context();
        altered.entities[3].poem.as_mut().unwrap().stanzas[0].id = "greek-invented-deed".into();
        assert!(!recital::valid(
            "greek-rhapsode",
            altered.entities[3].poem.as_ref(),
            altered.turn
        ));
    }

    #[test]
    fn authored_claims_follow_earned_burial_permission_and_report() {
        let packs: Value =
            serde_json::from_str(include_str!("../../card-game/packs.json")).unwrap();
        let recital = &packs["packs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pack| pack["id"] == "greek-drama")
            .unwrap()["recital"];
        for (choice, buried, permitted) in [
            ("greek-perform-burial", true, false),
            ("greek-petition-burial", false, true),
            ("greek-perform-permitted-burial", true, true),
            ("greek-report-plan", false, false),
        ] {
            let mut c = bard_context();
            c.entities[3].poem = Some(
                serde_json::from_value(json!({
                    "title":recital["title"], "stanzas":[{"id":choice,"turn":1,
                        "authorId":"vale","authorName":"Vale"}]
                }))
                .unwrap(),
            );
            assert!(valid(&c));
            let check = Check::new(&c, &c.entities[3], Part::Line);
            assert_eq!(
                check.clean("I buried her brother.", true).is_ok(),
                buried,
                "{choice}"
            );
            assert_eq!(
                check
                    .clean("The king gave permission for this one grave.", true)
                    .is_ok(),
                permitted,
                "{choice}"
            );
            assert!(check
                .clean("I wonder what that choice will mean tomorrow.", true)
                .is_ok());
        }
    }

    #[test]
    fn full_poem_context_names_every_traveller_and_no_couplet() {
        let packs: Value =
            serde_json::from_str(include_str!("../../card-game/packs.json")).unwrap();
        let recital = &packs["packs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|pack| pack["id"] == "greek-drama")
            .unwrap()["recital"];
        let verses = recital["verses"].as_array().unwrap();
        let names = ["Vale", "Mara", "an earlier traveler"];
        let stanzas: Vec<_> = verses
            .iter()
            .enumerate()
            .map(|(i, verse)| {
                let name = names[i % 3];
                json!({"id":verse["choice"],"turn":i+1,"authorId":null,"authorName":name})
            })
            .collect();
        let poem: recital::Poem =
            serde_json::from_value(json!({"title":recital["title"],"stanzas":stanzas})).unwrap();
        assert!(recital::valid("greek-rhapsode", Some(&poem), 100));
        let prompt = recital::prompt_lines(&poem);
        assert_eq!(
            prompt,
            ["My poem Before the Burial holds deeds by Vale, Mara, an earlier traveler."]
        );
        let lore: Value = serde_json::from_str(include_str!(
            "../../content/greek-drama/lore/bard-couplets.json"
        ))
        .unwrap();
        for verse in lore["verses"].as_object().unwrap().values() {
            for line in verse["lines"].as_array().unwrap() {
                assert!(!prompt[0].contains(line.as_str().unwrap()));
            }
        }
    }

    #[tokio::test]
    async fn bard_comments_freely_on_the_full_poem_in_plain_and_shared_speech() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let tries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = tries.clone();
        let bard_stem = format!("{}:", name("greek-rhapsode"));
        let target = bard_stem.clone();
        let provider = plain_provider(seen.clone(), move |_, stem| {
            if stem == target {
                if count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                    "As an AI, I can explain this poem.".into()
                } else {
                    "I hear a hard choice in those lines.".into()
                }
            } else {
                "I hear you.".into()
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let c = bard_context();
        let ids = vec!["vale".into(), "greek-rhapsode".into()];
        let published = Mutex::new(Vec::new());
        let emit = |text: &str| {
            published.lock().unwrap().push(text.to_string());
            true
        };
        let result = complete_selected(
            &test_config(address),
            &c,
            &BTreeMap::new(),
            &VoiceSettings::hosted(),
            &ids,
            false,
            Some(&emit),
        )
        .await
        .unwrap();
        assert_eq!(result["entries"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["entries"][1]["text"],
            "I hear a hard choice in those lines."
        );
        let output = published.lock().unwrap().join(" ");
        assert!(!output.contains("As an AI"));
        assert!(output.contains("I hear a hard choice"));
        assert_eq!(tries.load(std::sync::atomic::Ordering::SeqCst), 2);
        let shared = shared_lines(
            &test_config(address),
            &serde_json::to_value(&c).unwrap(),
            &ids,
            &BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(shared["entries"].as_array().unwrap().len(), 2);
        assert_eq!(shared["entries"][0]["id"], "vale");
        assert_eq!(
            shared["entries"][1]["text"],
            "I hear a hard choice in those lines."
        );
        let requests = seen.lock().unwrap();
        let bard: Vec<_> = requests
            .iter()
            .filter(|r| {
                r["messages"][1]["content"]
                    .as_str()
                    .unwrap()
                    .ends_with(&bard_stem)
            })
            .collect();
        assert_eq!(bard.len(), 3);
        assert!(bard.iter().all(
            |r| r["temperature"].as_f64().unwrap() > 0.0 && r.get("response_format").is_none()
        ));
        assert!(bard[1]["messages"][1]["content"]
            .as_str()
            .unwrap()
            .starts_with("My next words are fresh"));
        assert!(bard.iter().all(|request| request["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains(POEM_FACT)));
        server.abort();
    }

    #[tokio::test]
    async fn a_speaker_who_never_says_the_fact_still_speaks_untold() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let tries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = tries.clone();
        let provider = plain_provider(seen.clone(), move |_, stem| {
            if stem == "Vale:" {
                count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                "I want to sit by the pond.".into()
            } else {
                "I hear you.".into()
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let mut c = context();
        c.disclosures = serde_json::from_value(json!([{"factId":"event:3","speaker":"vale",
            "listener":"moth","text":"Vale takes the Lamp.","eventSeq":4}]))
        .unwrap();
        assert!(valid(&c));
        let ids = vec!["vale".to_string()];
        let result = complete_selected(
            &test_config(address),
            &c,
            &BTreeMap::new(),
            &VoiceSettings::hosted(),
            &ids,
            false,
            None,
        )
        .await
        .unwrap();
        // Every attempt missed the fact; the last kept reply is spoken and
        // the game, which finds no fact in it, keeps the fact for later.
        assert!(tries.load(std::sync::atomic::Ordering::SeqCst) > 1);
        assert_eq!(result["entries"][0]["id"], "vale");
        assert_eq!(result["entries"][0]["text"], "I want to sit by the pond.");
        let prompt = seen.lock().unwrap()[0]["messages"][1]["content"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(prompt.contains("I took the Lamp."), "{prompt}");
        server.abort();
    }

    #[tokio::test]
    async fn repeated_talk_accepts_fresh_bard_words_locally_and_shared() {
        // Repeating an old verse is an ordinary repeat now; fresh words pass.
        const FRESH: &str = "I hear a hard choice in those lines.";
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |_, stem| {
            if stem == format!("{}:", name("greek-rhapsode")) {
                FRESH.into()
            } else {
                "I am listening again.".into()
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let mut value = serde_json::to_value(bard_context()).unwrap();
        value["entities"][3]["previous"] = json!(EARNED_VERSE);
        value["entities"][3]["memories"] =
            json!([{ "turn":1, "kind":"expression", "text":format!("The Bard: {EARNED_VERSE}") }]);
        value["conversation"] = json!([{"actorId":"greek-rhapsode","text":EARNED_VERSE}]);
        let c: Context = serde_json::from_value(value).unwrap();
        let ids = vec!["vale".into(), "greek-rhapsode".into()];
        let published = Mutex::new(Vec::new());
        let emit = |text: &str| {
            published.lock().unwrap().push(text.to_string());
            true
        };
        let local = complete_selected(
            &test_config(address),
            &c,
            &BTreeMap::new(),
            &VoiceSettings::hosted(),
            &ids,
            false,
            Some(&emit),
        )
        .await
        .unwrap();
        assert_eq!(local["entries"][1]["text"], FRESH);
        assert!(published.lock().unwrap().join(" ").contains(FRESH));
        let shared = shared_lines(
            &test_config(address),
            &serde_json::to_value(&c).unwrap(),
            &ids,
            &BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(shared["entries"][1]["text"], FRESH);
        assert_eq!(seen.lock().unwrap().len(), 4);
        server.abort();
    }

    fn bell_context() -> Context {
        let mut c = context();
        c.speakers = vec!["vale".into(), "keeper".into()];
        c.action = Some("Vale gives the Bell to The keeper.".into());
        c.entities[0].facts.clear();
        c.entities[3].id = "keeper".into();
        c.entities[3].facts.clear();
        c.entities[3].memories.clear();
        c.entities[3].desire = None;
        let mut outcome = solo_departure();
        outcome.card.kind = "give".into();
        outcome.card.item = Some("bell".into());
        outcome.card.target = Some("keeper".into());
        outcome.avatars[2].travel = Some(Travel {
            from: "station".into(),
            to: "attic".into(),
            companions: vec![],
        });
        c.outcome = Some(outcome);
        c
    }

    #[test]
    fn custody_claims_follow_final_holder_and_each_speakers_listener() {
        let mut c = bell_context();
        let words = "The bell is yours to keep now, Vale.";
        let keeper = Check::new(&c, &c.entities[3], Part::Line);
        assert_eq!(keeper.clean(words, true), Err("custody"));
        assert_eq!(
            keeper.clean("The bell is mine now.", true),
            Ok("The bell is mine now.".into())
        );
        assert!(custody::consistent(
            "I remember when the bell was yours.",
            &c,
            "keeper"
        ));
        assert!(custody::consistent("The bell is yours?", &c, "keeper"));
        assert!(custody::consistent(
            "The bell is yours to keep now.",
            &c,
            "vale"
        ));
        let prompt = transcript(&c, &c.entities[3], Part::Line);
        assert!(prompt.contains("I received Bell from Vale."));
        assert!(prompt.contains("Final custody: Bell — The keeper. Location: Mirror attic."));
        assert!(prompt.contains("I'm leaving Empty station for Mirror attic"));
        let outcome = c.outcome.as_mut().unwrap();
        outcome
            .items
            .iter_mut()
            .find(|item| item.id == "bell")
            .unwrap()
            .holder = "vale".into();
        outcome
            .items
            .iter_mut()
            .find(|item| item.id == "bell")
            .unwrap()
            .location = "station".into();
        outcome.avatars[2].holding.retain(|item| item != "bell");
        outcome.avatars[0].holding.push("bell".into());
        c.events
            .push("The keeper gives the Bell back to Vale before leaving.".into());
        assert_eq!(
            Check::new(&c, &c.entities[3], Part::Line).clean(words, true),
            Ok(words.into())
        );
        assert!(!custody::consistent("The bell is mine now.", &c, "keeper"));
    }

    #[tokio::test]
    async fn reversed_gift_perspective_is_repaired_before_local_or_shared_publication() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let tries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = tries.clone();
        let provider = plain_provider(seen.clone(), move |_, stem| {
            if stem == "The keeper:" {
                if count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                    "The bell is yours to keep now, Vale.".into()
                } else {
                    "I will keep it safe, Vale.".into()
                }
            } else {
                "I am glad you have it.".into()
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let c = bell_context();
        let ids = vec!["vale".into(), "keeper".into()];
        let published = Mutex::new(Vec::new());
        let emit = |text: &str| {
            published.lock().unwrap().push(text.to_string());
            true
        };
        let local = complete_selected(
            &test_config(address),
            &c,
            &BTreeMap::new(),
            &VoiceSettings::hosted(),
            &ids,
            false,
            Some(&emit),
        )
        .await
        .unwrap();
        assert_eq!(local["entries"][1]["text"], "I will keep it safe, Vale.");
        assert!(!published
            .lock()
            .unwrap()
            .join(" ")
            .contains("yours to keep"));
        tries.store(0, std::sync::atomic::Ordering::SeqCst);
        let shared = shared_lines(
            &test_config(address),
            &serde_json::to_value(&c).unwrap(),
            &ids,
            &BTreeMap::new(),
        )
        .await
        .unwrap();
        assert_eq!(shared["entries"][1]["text"], "I will keep it safe, Vale.");
        assert_eq!(tries.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert!(seen
            .lock()
            .unwrap()
            .iter()
            .all(|request| request["messages"][1]["content"]
                .as_str()
                .unwrap()
                .contains("Final custody: Bell — The keeper. Location: Mirror attic.")));
        server.abort();
    }

    #[tokio::test]
    async fn bard_escalation_keeps_poem_context_and_accepts_fresh_words() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let bard_stem = format!("{}:", name("greek-rhapsode"));
        let target = bard_stem.clone();
        let provider = plain_provider(seen.clone(), move |body, stem| {
            if stem == target {
                if body["model"] == "escalation-model" {
                    "I carry her choice beside the sea, and let the night remember.".into()
                } else {
                    "As an AI, I can explain the poem.".into()
                }
            } else {
                "I hear you.".into()
            }
        });
        let (address, server) = serve(provider).await;
        let config = tiered_config(address, &[("escalation-model", false)]);
        let settings = VoiceSettings {
            attempts: 1,
            escalation_model: Some("escalation-model".into()),
            ..VoiceSettings::hosted()
        };
        let c = bard_context();
        let published = Mutex::new(Vec::new());
        let emit = |text: &str| {
            published.lock().unwrap().push(text.to_string());
            true
        };
        let result = complete_selected(
            &config,
            &c,
            &BTreeMap::new(),
            &settings,
            &["vale".into(), "greek-rhapsode".into()],
            false,
            Some(&emit),
        )
        .await
        .unwrap();
        assert_eq!(
            result["entries"][1]["text"],
            "I carry her choice beside the sea, and let the night remember."
        );
        let output = published.lock().unwrap().join(" ");
        assert!(output.contains("I carry her choice beside the sea"));
        assert!(!output.contains("As an AI"));
        let requests = seen.lock().unwrap();
        assert_eq!(
            models_for(&requests, &bard_stem),
            ["test-entity-model", "escalation-model"]
        );
        let bard: Vec<_> = requests
            .iter()
            .filter(|request| stem_of(request) == bard_stem)
            .collect();
        assert!(bard
            .iter()
            .all(|request| request["temperature"].as_f64().unwrap() > 0.0));
        let prompts: Vec<_> = bard
            .iter()
            .map(|request| request["messages"][1]["content"].as_str().unwrap())
            .collect();
        assert!(prompts.iter().all(|prompt| prompt.contains(POEM_FACT)));
        assert_eq!(
            prompts[0].split_once("Current scene:").unwrap().1,
            prompts[1].split_once("Current scene:").unwrap().1
        );
        server.abort();
    }

    pub(super) fn plain_provider(
        seen: Arc<Mutex<Vec<Value>>>,
        reply: impl Fn(&Value, &str) -> String + Clone + Send + Sync + 'static,
    ) -> Router {
        Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let seen = seen.clone();
                let reply = reply.clone();
                async move {
                    seen.lock().unwrap().push(body.clone());
                    // A raw dream sends its user turn without a system voice.
                    let user = body["messages"].as_array().unwrap().last().unwrap()["content"]
                        .as_str()
                        .unwrap();
                    let stem = user.lines().last().unwrap().to_string();
                    let text = reply(&body, &stem);
                    Json(json!({"model":body["model"],"choices":[{"message":{"content":text},"finish_reason":"stop"}]}))
                }
            }),
        )
    }

    fn stem_reply(stem: &str) -> String {
        if stem.ends_with(", to myself:") {
            "I felt welcome.".into()
        } else if stem.ends_with(", who I am now:") {
            "I am still proud, but I am learning to accept help.".into()
        } else if stem.ends_with(", last night's dream:") {
            "A warm lamp floated through my sleep.".into()
        } else if ["Empty station:", "Lamp:", "Black pond:"].contains(&stem) {
            "Dust settles where the lamp stood.".into()
        } else {
            "I remember the kindness beside the lamp.".into()
        }
    }

    #[test]
    fn explicit_scenery_choices_keep_legacy_contexts_and_actor_voices() {
        let mut c = context();
        assert!(c.scenery);
        assert!(voiced(&c).contains(&c.location));
        c.scenery = false;
        assert!(valid(&c));
        assert_eq!(voiced(&c), vec!["vale", "moth", "lamp"]);
        let saved = serde_json::to_value(&c).unwrap();
        let retry: Context = serde_json::from_value(saved.clone()).unwrap();
        assert_eq!(voiced(&retry), voiced(&c));
        let mut invalid = saved;
        invalid["scenery"] = json!("sometimes");
        assert!(serde_json::from_value::<Context>(invalid).is_err());
    }

    #[tokio::test]
    async fn quiet_scene_api_retries_request_only_actor_lines() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |_, stem| stem_reply(stem));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let app = router_with_models::<()>(
            Arc::new(Some(test_config(address))),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::hosted()),
        );
        let mut c = context();
        c.scenery = false;
        c.focus = None;
        for _ in 0..2 {
            let response = app.clone().oneshot(request(&c)).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
            let result: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(result["entries"].as_array().unwrap().len(), 2);
            assert_eq!(result["omitted"], json!(["station", "lamp"]));
        }
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 4);
        assert!(requests.iter().all(|body| {
            let cue = body["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap()
                .lines()
                .last()
                .unwrap();
            ["Vale:", "Pip:"].contains(&cue)
        }));
        server.abort();
    }

    #[tokio::test]
    async fn character_models_keep_their_own_memories_and_return_private_growth() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |body, stem| {
            let user = body["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap();
            if user.contains("Fail this place") && stem == "Empty station:" {
                return String::new();
            }
            stem_reply(stem)
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let mut config = test_config(address);
        let models: BTreeMap<String, String> = [
            ("vale", "vale-model"),
            ("moth", "moth-model"),
            ("keeper", "keeper-model"),
            ("badger", "badger-model"),
        ]
        .into_iter()
        .map(|(id, m)| (id.into(), m.into()))
        .collect();
        let declared: Vec<_> = models.values().map(String::as_str).chain(["test-entity-model"]).map(|id| json!({
            "requested_model_id":id,"provider":"openrouter","concrete_model":{"model_id":id},
            "input_modalities":["text"],"output_modalities":["text"],"supported_parameters":{"json_mode":true,"structured_output":true},
            "capabilities":["world_content"],"prompt_adapter":{"id":"openai-chat","version":"1"}
        })).collect();
        config.registry = Some(Arc::new(crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
            &json!({"schema_version":1,"snapshot_version":"character-test","declared":declared,"discovered":[]}).to_string()).unwrap()));
        let app = router_with_models::<()>(
            Arc::new(Some(config)),
            Ok(models),
            Ok(VoiceSettings::hosted()),
        );
        let mut c = context();
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 1,
            kind: "event".into(),
            text: "Vale private kindness memory.".into(),
        });
        dream_due(&mut c);
        c.entities[3].inner_life = Some(InnerLife {
            persona: Some("Moth private persona sentinel.".into()),
            thoughts: vec![],
            dreams: vec![],
        });
        for _ in 0..2 {
            let response = app.clone().oneshot(request(&c)).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
            let result: Value = serde_json::from_slice(&bytes).unwrap();
            let entries = result["entries"].as_array().unwrap();
            assert_eq!(entries.len(), 4);
            assert_eq!(result["omitted"], json!([]));
            assert_eq!(entries[0]["id"], "vale");
            assert_eq!(entries[0]["model"], "vale-model");
            assert_eq!(entries[1]["id"], "moth");
            assert_eq!(entries[1]["model"], "moth-model");
            assert!(entries[2]["model"].is_string());
            assert_eq!(entries[0]["reflection"]["thought"], "I felt welcome.");
            assert_eq!(
                entries[0]["reflection"]["dream"],
                "A warm lamp floated through my sleep."
            );
            assert!(entries[1].get("reflection").is_none());
            assert!(entries
                .iter()
                .filter(|e| e["id"] == "lamp" || e["id"] == "station")
                .all(|e| e.get("reflection").is_none()));
        }
        // Each scene: four lines, then Vale's thought, persona and dream.
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 14);
        for body in &requests {
            assert!(body.get("response_format").is_none());
            let text = body["messages"].to_string();
            if body["model"] == "vale-model" {
                assert!(text.contains("Vale private kindness memory"));
                assert!(!text.contains("Moth private persona sentinel"));
            } else if body["model"] == "moth-model" {
                assert!(text.contains("Moth private persona sentinel"));
                assert!(!text.contains("Vale private kindness memory"));
            } else {
                assert!(!text.contains("Moth private persona sentinel"));
                assert!(!text.contains("Vale private kindness memory"));
            }
        }
        // A place that fails twice stays silent; the speakers are still published.
        c.entities[1].facts.push("Fail this place.".into());
        let partial = app.clone().oneshot(request(&c)).await.unwrap();
        assert_eq!(partial.status(), StatusCode::OK);
        let bytes = to_bytes(partial.into_body(), 64 * 1024).await.unwrap();
        let result: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(result["omitted"], json!(["station"]));
        assert_eq!(result["entries"].as_array().unwrap().len(), 3);
        server.abort();
    }

    #[tokio::test]
    async fn local_profile_retries_runs_one_call_at_a_time_and_leaves_failed_scenery_out() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let in_flight = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let most = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (now, peak) = (in_flight.clone(), most.clone());
        let captured = seen.clone();
        let provider = Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let (now, peak, captured) = (now.clone(), peak.clone(), captured.clone());
                async move {
                    use std::sync::atomic::Ordering::SeqCst;
                    let count = now.fetch_add(1, SeqCst) + 1;
                    peak.fetch_max(count, SeqCst);
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    let tries = {
                        let mut seen = captured.lock().unwrap();
                        seen.push(body.clone());
                        seen.iter().filter(|b| {
                            b["messages"][1]["content"].as_str().and_then(|text| text.lines().last())
                                == body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().and_then(|text| text.lines().last())
                        }).count()
                    };
                    now.fetch_sub(1, SeqCst);
                    let user = body["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap();
                    let stem = user.lines().last().unwrap();
                    let mute = (user.contains("Mute speaker")
                        && (stem == "Vale:" || stem == "Pip:"))
                        || (stem == "Empty station:" && user.contains("Paths visible"));
                    let text = if mute {
                        String::new()
                    } else if stem == "Vale:" && tries == 1 {
                        "Vale:".into()
                    } else {
                        stem_reply(stem)
                    };
                    Json(json!({"model":body["model"],"choices":[{"message":{"content":text},"finish_reason":"stop"}]}))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let app = router_with_models::<()>(
            Arc::new(Some(test_config(address))),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings::local()),
        );
        let mut c = context();
        c.entities[1]
            .facts
            .push("Paths visible now: Black pond.".into());
        let response = app.clone().oneshot(request(&c)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let result: Value = serde_json::from_slice(&bytes).unwrap();
        let ids: Vec<_> = result["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["vale", "moth", "lamp"]);
        assert_eq!(result["omitted"], json!(["station"]));
        assert_eq!(result["model"], "test-entity-model");
        // Vale's first, empty reply was retried; the place had two tries.
        assert_eq!(seen.lock().unwrap().len(), 6);
        assert_eq!(most.load(std::sync::atomic::Ordering::SeqCst), 1);
        // A speaker without valid words stays silent while the other speaks.
        c.entities[0].facts.push("Mute speaker.".into());
        let quiet = app.clone().oneshot(request(&c)).await.unwrap();
        assert_eq!(quiet.status(), StatusCode::OK);
        let bytes = to_bytes(quiet.into_body(), 64 * 1024).await.unwrap();
        let result: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(result["omitted"], json!(["vale", "station"]));
        // With no speaker's words at all the scene fails; nothing is invented.
        c.entities[3].facts.push("Mute speaker.".into());
        let failed = app.oneshot(request(&c)).await.unwrap();
        assert_eq!(failed.status(), StatusCode::BAD_GATEWAY);
        server.abort();
    }

    #[test]
    fn voice_settings_come_from_the_profile_and_validated_overrides() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| value.to_string())
            }
        };
        let hosted = VoiceSettings::from_lookup(env(&[])).unwrap();
        assert_eq!(hosted, VoiceSettings::hosted());
        assert_eq!(hosted.client_budget(), Duration::from_secs(30));
        let local =
            VoiceSettings::from_lookup(env(&[("COSYWORLD_CARD_TEXT_PROFILE", "local")])).unwrap();
        assert_eq!(local, VoiceSettings::local());
        assert!(local.parallel == 1 && local.attempts == 2 && hosted.attempts == 2);
        assert_eq!(local.client_budget(), Duration::from_secs(248));
        let tuned = VoiceSettings::from_lookup(env(&[
            ("COSYWORLD_CARD_TEXT_PROFILE", "local"),
            ("COSYWORLD_CARD_TEXT_CALL_TIMEOUT_SECS", "30"),
            ("COSYWORLD_CARD_TEXT_SCENE_TIMEOUT_SECS", "120"),
            ("COSYWORLD_CARD_TEXT_PARALLEL", "2"),
            ("COSYWORLD_CARD_TEXT_ATTEMPTS", "1"),
        ]))
        .unwrap();
        assert_eq!(
            (
                tuned.call_timeout,
                tuned.scene_timeout,
                tuned.parallel,
                tuned.attempts
            ),
            (Duration::from_secs(30), Duration::from_secs(120), 2, 1)
        );
        for bad in [
            &[("COSYWORLD_CARD_TEXT_PROFILE", "fast")][..],
            &[("COSYWORLD_CARD_TEXT_PARALLEL", "0")],
            &[("COSYWORLD_CARD_TEXT_ATTEMPTS", "lots")],
            &[("COSYWORLD_CARD_TEXT_CALL_TIMEOUT_SECS", "30")],
        ] {
            let pairs: &'static [(&'static str, &'static str)] = bad;
            assert!(VoiceSettings::from_lookup(env(pairs)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn both_deployments_pin_every_card_character_to_an_eligible_model() {
        let mut maps = Vec::new();
        for file in [
            include_str!("../../../fly.toml"),
            include_str!("../../../fly.lonelyforest.toml"),
        ] {
            let field = |name: &str| {
                file.lines()
                    .find_map(|line| {
                        line.trim()
                            .strip_prefix(&format!("{name} = '"))
                            .and_then(|value| value.strip_suffix('\''))
                    })
                    .expect("deployment JSON field")
            };
            let models =
                parse_character_models(field("COSYWORLD_CARD_CHARACTER_MODELS_JSON")).unwrap();
            let registry = crate::ai_gateway::CapabilityRegistrySnapshot::from_json(field(
                "COSYWORLD_AI_REGISTRY_JSON",
            ))
            .unwrap();
            for model in models.values() {
                let pinned = registry
                    .pin(
                        ModelCapability::WorldContent,
                        Some(model),
                        crate::ai_gateway::DataPolicyMode::Production,
                    )
                    .unwrap();
                assert_eq!(pinned.requested_model_id(), model);
                // Reasoning-first endpoints answer with effort none and
                // never receive a temperature they would reject.
                if ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"].contains(&model.as_str()) {
                    let parameters = pinned.candidate().supported_parameters();
                    assert!(parameters.reasoning, "{model}");
                    assert!(!parameters.accepts_temperature(), "{model}");
                }
            }
            maps.push(models);
        }
        assert_eq!(maps[0], maps[1]);
    }

    #[test]
    fn character_model_config_covers_every_avatar_with_exact_ids() {
        assert!(parse_character_models(r#"{"vale":"one"}"#).is_err());
        assert!(parse_character_models(
            r#"{"vale":"one","moth":"two","keeper":"three","badger":"four"}"#
        )
        .is_ok());
    }

    #[test]
    fn profiles_supply_visible_details_and_discoveries_come_from_events() {
        let mut c = context();
        c.location = "attic".into();
        c.entities[1].id = "attic".into();
        let attic = idiolect(&c.entities[1], Part::Line);
        assert!(attic.contains("atmospheric caption"));
        assert!(transcript(&c, &c.entities[1], Part::Line)
            .contains("tall mirror reflecting a black shore"));
        assert!(idiolect(&c.entities[2], Part::Line).contains("soot-dark"));
        let all = profiles().to_string();
        assert!(!all.contains("makes reflections into paths"));
        assert!(!all.contains("Lamplight can open a path"));
        assert!(!transcript(&c, &c.entities[1], Part::Line).contains("Vale arrived"));
    }

    #[test]
    fn validates_resolved_turn_and_exact_travel_companions() {
        let mut c = context();
        c.outcome = Some(solo_departure());
        assert!(valid(&c));
        let vale = transcript(&c, &c.entities[0], Part::Line);
        assert!(vale.contains("I'm at Empty station."));
        assert!(vale.contains("Pip is leaving for Black pond, alone."));
        assert!(!vale.contains("The keeper"));
        let o = c.outcome.as_mut().unwrap();
        o.avatars[1]
            .travel
            .as_mut()
            .unwrap()
            .companions
            .push("vale".into());
        assert!(!valid(&c));
        let o = c.outcome.as_mut().unwrap();
        o.avatars[0].location = "pond".into();
        o.avatars[0].travel = Some(Travel {
            from: "station".into(),
            to: "pond".into(),
            companions: vec!["moth".into()],
        });
        o.card.kind = "accompany".into();
        o.card.target = Some("moth".into());
        o.card.destination = Some("pond".into());
        o.card.accepted = Some(true);
        assert!(valid(&c));
        let vale = transcript(&c, &c.entities[0], Part::Line);
        assert!(vale.contains("I'm leaving Empty station for Black pond with Pip."));
        assert!(vale.contains("Pip is leaving for Black pond, with Vale."));
        c.outcome.as_mut().unwrap().avatars[1]
            .travel
            .as_mut()
            .unwrap()
            .to = "attic".into();
        assert!(!valid(&c));
        c.outcome = Some(solo_departure());
        c.outcome
            .as_mut()
            .unwrap()
            .avatars
            .push(solo_departure().avatars.remove(0));
        assert!(!valid(&c));
        c.outcome = Some(solo_departure());
        c.outcome.as_mut().unwrap().items[0].holder = "invented-person".into();
        assert!(!valid(&c));
        c.outcome = Some(solo_departure());
        c.outcome.as_mut().unwrap().card.kind = "invented-action".into();
        assert!(!valid(&c));
    }
    #[test]
    fn accepts_steam_clock_crossing_and_badgers_wake() {
        let mut c = context();
        c.location = "clearing".into();
        c.focus = None;
        c.speakers = vec!["vale".into()];
        c.entities.retain(|e| e.id == "vale");
        c.entities.push(
            serde_json::from_value(json!({
                "id":"clearing","facts":["The reflected path leads to Black pond."],
                "desire":null,"memories":[],"previous":null
            }))
            .unwrap(),
        );
        c.entities.push(
            serde_json::from_value(json!({
                "id":"badger","facts":["Asleep on warm moss."],
                "desire":{"items":[],"location":"clearing","avatars":[]},
                "memories":[],"previous":null
            }))
            .unwrap(),
        );
        let mut o = solo_departure();
        o.card.kind = "ring".into();
        o.card.item = Some("bell".into());
        o.avatars[0].location = "clearing".into();
        o.avatars[0].holding = vec!["bell".into()];
        o.avatars[0].travel = Some(Travel {
            from: "pond".into(),
            to: "clearing".into(),
            companions: vec![],
        });
        o.avatars[2].holding.retain(|id| id != "bell");
        o.items[3].holder = "vale".into();
        o.items[3].location = "clearing".into();
        o.avatars.push(AvatarOutcome {
            id: "badger".into(),
            location: "clearing".into(),
            holding: vec![],
            travel: None,
        });
        c.outcome = Some(o);
        assert!(valid(&c));
        assert_eq!(voiced(&c), ["vale", "clearing"]);
        let badger = transcript(&c, &c.entities[2], Part::Line);
        assert!(badger.contains("Asleep on warm moss."));
        assert!(badger.contains("Vale has just come from Black pond, alone."));
        c.speakers.push("badger".into());
        c.entities[2].facts =
            vec!["Awake after Vale spoke. Still grumpy about the interruption.".into()];
        let o = c.outcome.as_mut().unwrap();
        o.card.kind = "talk".into();
        o.card.item = None;
        o.card.target = Some("badger".into());
        o.avatars[0].travel = None;
        assert!(valid(&c));
        assert_eq!(voiced(&c), ["vale", "badger", "clearing"]);
        let badger = &c.entities[2];
        assert!(idiolect(badger, Part::Line)
            .starts_with("I am Grumpy Badger, a badger of the clearing."));
        let heard = transcript(&c, badger, Part::Line);
        assert!(heard.contains("Awake after Vale spoke. Still grumpy about the interruption."));
        assert!(heard.contains("I'm talking with Vale."));
        assert!(heard.ends_with("\nGrumpy Badger:"));
        assert!(
            transcript(&c, &c.entities[0], Part::Line).contains("I'm talking with Grumpy Badger.")
        );
    }
    #[test]
    fn chosen_combat_sets_intent_even_after_an_earlier_apology() {
        let mut c = context();
        c.conversation.push(SpokenLine {
            witnesses: Some(vec!["vale".into(), "moth".into(), "keeper".into()]),
            actor_id: "vale".into(),
            text: "I am sorry. I will ask gently.".into(),
        });
        c.outcome = Some(solo_departure());
        for (verb, mine, theirs) in [
            (
                "threaten",
                "I'm threatening Pip.",
                "Vale is threatening me.",
            ),
            ("attack", "I'm attacking Pip.", "Vale is attacking me."),
            (
                "guard",
                "I'm guarding against Pip.",
                "Vale is guarding against me.",
            ),
        ] {
            let card = &mut c.outcome.as_mut().unwrap().card;
            card.kind = verb.into();
            card.target = Some("moth".into());
            // The earlier apology is not replayed; the chosen stance stands.
            let vale = transcript(&c, &c.entities[0], Part::Line);
            assert!(vale.contains(mine));
            assert!(!vale.contains("I am sorry"));
            let pip = transcript(&c, &c.entities[3], Part::Line);
            assert!(pip.contains(theirs));
            assert!(!pip.contains("I am sorry"));
        }
    }

    #[test]
    fn separates_coincident_arrivals_from_shared_trips_for_every_voice() {
        let mut c = context();
        let mut o = solo_departure();
        o.avatars[0].location = "pond".into();
        o.avatars[0].travel = Some(Travel {
            from: "station".into(),
            to: "pond".into(),
            companions: vec![],
        });
        o.card.kind = "move".into();
        o.card.target = Some("pond".into());
        c.location = "pond".into();
        c.entities[1].id = "pond".into();
        c.outcome = Some(o);
        let vale = transcript(&c, &c.entities[0], Part::Line);
        assert!(vale.contains("I've just come to Black pond from Empty station on my own."));
        assert!(vale.contains("Pip has just come from Empty station, alone."));
        assert!(!vale.contains("The keeper"));
        let pond = transcript(&c, &c.entities[1], Part::Line);
        assert!(!pond.contains("Vale has just come"));
        assert!(pond.contains("Current scene:\nBlack pond."));
        assert!(pond.ends_with("\nBlack pond:"));
        let o = c.outcome.as_mut().unwrap();
        o.avatars[0]
            .travel
            .as_mut()
            .unwrap()
            .companions
            .push("moth".into());
        o.avatars[1]
            .travel
            .as_mut()
            .unwrap()
            .companions
            .push("vale".into());
        let vale = transcript(&c, &c.entities[0], Part::Line);
        assert!(vale.contains("I've just come to Black pond from Empty station with Pip."));
        assert!(vale.contains("Pip has just come from Empty station, with Vale."));
    }

    #[test]
    fn accepts_the_discovered_cast_at_each_opening_stage() {
        let mut o = solo_departure();
        o.avatars.retain(|a| a.id == "vale");
        o.avatars[0].location = "attic".into();
        o.items.retain(|i| i.id == "lamp");
        o.items[0].holder = "vale".into();
        o.items[0].location = "attic".into();
        assert!(valid_outcome(&o));
        o.avatars.push(solo_departure().avatars.remove(1));
        assert!(valid_outcome(&o));
        o.avatars.push(solo_departure().avatars.remove(0));
        assert!(!valid_outcome(&o));
    }

    #[test]
    fn accepts_resolved_answers_from_personal_interests() {
        let mut o = solo_departure();
        o.card.kind = "ask".into();
        o.card.target = Some("moth".into());
        o.card.item = Some("lamp".into());
        for answer in [None, Some(false), Some(true)] {
            o.card.accepted = answer;
            assert!(valid_outcome(&o));
        }
        o.card.destination = Some("pond".into());
        assert!(!valid_outcome(&o));
    }

    #[test]
    fn accepts_recorded_answers_to_give_and_trade() {
        // Every Give and Trade records its answer; a refusal is a real outcome.
        for (verb, receive) in [("give", None), ("trade", Some("oil"))] {
            let mut o = solo_departure();
            o.card.kind = verb.into();
            o.card.target = Some("keeper".into());
            o.card.item = Some("lamp".into());
            o.card.receive = receive.map(Into::into);
            for answer in [None, Some(false), Some(true)] {
                o.card.accepted = answer;
                assert!(valid_outcome(&o), "{verb} {answer:?}");
            }
            o.card.destination = Some("pond".into());
            assert!(!valid_outcome(&o), "{verb} with a destination");
        }
        // A refused gift is never told to either side as received.
        let mut c = bell_context();
        c.outcome.as_mut().unwrap().card.accepted = Some(false);
        assert!(!custody::facts(&c, "keeper")
            .iter()
            .any(|fact| fact.starts_with("I received")));
        assert!(!custody::facts(&c, "vale")
            .iter()
            .any(|fact| fact.starts_with("I gave")));
        c.outcome.as_mut().unwrap().card.accepted = Some(true);
        assert!(custody::facts(&c, "keeper")
            .iter()
            .any(|fact| fact.starts_with("I received")));
    }

    fn request(context: &Context) -> Request<Body> {
        let mut request = Request::post("/card-game/text")
            .header("content-type", "application/json")
            .header("host", "localhost")
            .header("origin", "http://localhost")
            .body(Body::from(serde_json::to_vec(context).unwrap()))
            .unwrap();
        request
            .extensions_mut()
            .insert(ConnectInfo("127.0.0.1:1234".parse::<SocketAddr>().unwrap()));
        request
    }
    #[test]
    fn validates_entity_memory_and_model_output() {
        let mut c = context();
        assert!(valid(&c));
        let vale = transcript(&c, &c.entities[0], Part::Line);
        assert!(vale.contains("Just now: Vale asks Pip what they want."));
        assert!(vale.contains("Holding the lamp."));
        // Past deeds stay out of a line (#1537); reflection still reads them.
        assert!(!transcript(&c, &c.entities[2], Part::Line).contains("I remember:"));
        assert!(transcript(&c, &c.entities[2], Part::Thought)
            .contains("I remember: Vale lit the lamp."));
        // Spoken lines stay out of speech; reflection still reads them.
        let pip = transcript(&c, &c.entities[3], Part::Line);
        assert!(!pip.contains("I offered my cloth."));
        assert!(transcript(&c, &c.entities[3], Part::Thought)
            .contains("Earlier: Pip: I offered my cloth."));
        assert!(idiolect(&c.entities[3], Part::Line).starts_with("I am Pip, a moth.\n"));
        c.action = Some("x".repeat(651));
        assert!(!valid(&c));
        c = context();
        c.entities[1].memories[0].turn = 5;
        assert!(!valid(&c));
        c = context();
        c.entities[0].facts.push("x".repeat(241));
        assert!(!valid(&c));
        c = context();
        c.entities[0].id = "arbitrary-prompt".into();
        assert!(!valid(&c));
    }
    #[test]
    fn validates_ordered_scene_events_and_recent_conversation() {
        let mut c = context();
        c.events = vec!["Pip leaves for Black pond.".into()];
        c.conversation = vec![SpokenLine {
            witnesses: Some(vec!["vale".into(), "moth".into(), "keeper".into()]),
            actor_id: "vale".into(),
            text: "Where are you going?".into(),
        }];
        let mut keeper = context().entities.remove(3);
        keeper.id = "keeper".into();
        c.entities.push(keeper);
        c.speakers.push("keeper".into());
        assert!(valid(&c));
        let keeper = transcript(&c, &c.entities[4], Part::Line);
        assert!(keeper.contains("Pip leaves for Black pond.\n"));
        assert!(!keeper.contains("Where are you going?"));
        assert!(keeper.contains("I'm talking with Vale."));
        c.conversation[0].actor_id = "pond".into();
        assert!(!valid(&c));
        c.conversation.clear();
        c.events = vec!["x".repeat(651)];
        assert!(!valid(&c));
        c.events = vec!["Wait.".into(); 9];
        assert!(!valid(&c));
    }
    #[tokio::test]
    async fn route_accepts_a_met_want_and_checks_its_target() {
        let provider = plain_provider(Arc::new(Mutex::new(Vec::new())), |_, stem| stem_reply(stem));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let app = router::<()>(Arc::new(Some(test_config(address))));
        let mut c = context();
        let mut outcome = serde_json::to_value(solo_departure()).unwrap();
        outcome["card"]["wantMet"] = json!({"kind":"place","target":"station"});
        c.outcome = Some(serde_json::from_value(outcome).unwrap());
        assert!(valid(&c));
        let response = app.clone().oneshot(request(&c)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        c.outcome
            .as_mut()
            .unwrap()
            .card
            .want_met
            .as_mut()
            .unwrap()
            .kind = "item".into();
        assert_eq!(
            app.clone().oneshot(request(&c)).await.unwrap().status(),
            StatusCode::BAD_REQUEST
        );
        server.abort();
    }

    #[tokio::test]
    async fn route_uses_personas_desires_and_memories_with_the_configured_model() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |body, stem| {
            assert_eq!(body["model"], "test-entity-model");
            assert!(body.get("response_format").is_none());
            let system = body["messages"][0]["content"].as_str().unwrap();
            let user = body["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap();
            if stem == "Empty station:" {
                assert!(system.contains("atmospheric caption"));
                assert!(!user.contains("Just now:"));
                assert!(!user.contains("I remember:"));
            } else {
                assert!(user.contains("Just now: Vale asks Pip what they want."));
            }
            match stem {
                "Vale:" => {
                    // An avatar's system voice is its seed sentence (#1673).
                    assert!(system.starts_with("I am Vale, the Lamplighter."));
                    assert!(user.contains("Holding the lamp."));
                    "Vale: What would you trade for this lamp, Pip?".into()
                }
                "Pip:" => {
                    assert!(system.starts_with("I am Pip, a moth."));
                    "\"Bring that lamp to the pond, Vale. I will carry the cloth.\"".into()
                }
                _ => stem_reply(stem),
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let app = router::<()>(Arc::new(Some(test_config(address))));
        let response = app.clone().oneshot(request(&context())).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["entries"].as_array().unwrap().len(), 4);
        assert_eq!(
            body["entries"][0]["text"],
            "What would you trade for this lamp, Pip?"
        );
        assert_eq!(
            body["entries"][1]["text"],
            "Bring that lamp to the pond, Vale. I will carry the cloth."
        );
        assert_eq!(body["revision"], 4);
        assert_eq!(body["model"], "test-entity-model");
        assert!(!String::from_utf8_lossy(&bytes).contains("test-secret"));
        assert_eq!(seen.lock().unwrap().len(), 4);
        let mut streamed = request(&context());
        streamed
            .headers_mut()
            .insert("accept", "text/event-stream".parse().unwrap());
        let response = app.clone().oneshot(streamed).await.unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let mut chunks = response.into_body().into_data_stream();
        let first = chunks.next().await.unwrap().unwrap();
        let first = std::str::from_utf8(&first).unwrap();
        assert!(first.contains("delta") && first.contains("What would you trade"));
        assert!(!first.contains("complete"));
        let mut rest = Vec::new();
        while let Some(chunk) = chunks.next().await {
            rest.extend_from_slice(&chunk.unwrap());
        }
        let text = String::from_utf8(rest).unwrap();
        assert!(text.contains("complete") && text.contains("I will carry the cloth"));
        assert!(!text.contains("test-secret"));
        for _ in 2..30 {
            assert_eq!(
                app.clone()
                    .oneshot(request(&context()))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        }
        assert_eq!(
            app.clone()
                .oneshot(request(&context()))
                .await
                .unwrap()
                .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        let mut oversized = request(&context());
        *oversized.body_mut() = Body::from("x".repeat(64 * 1024 + 1));
        assert_eq!(
            app.clone().oneshot(oversized).await.unwrap().status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        let mut cross = request(&context());
        cross
            .headers_mut()
            .insert("origin", "https://elsewhere.example".parse().unwrap());
        assert_eq!(
            app.oneshot(cross).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        server.abort();
    }
    #[tokio::test]
    async fn unavailable_model_returns_a_clear_retry_response() {
        let response = router::<()>(Arc::new(None))
            .oneshot(request(&context()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn one_client_cannot_spend_the_shared_hour_alone() {
        let mut limits = RateLimiter::default();
        let greedy: IpAddr = "203.0.113.1".parse().unwrap();
        let start = Instant::now();
        // The greedy client stays under its per-minute limit the whole time.
        let mut admitted = 0;
        for request in 0..PER_HOUR.max_hits as u64 {
            if admit(
                &mut limits,
                greedy,
                start + Duration::from_secs(request * 2),
            ) {
                admitted += 1;
            }
        }
        assert_eq!(admitted, PER_CLIENT_HOUR.max_hits);
        const { assert!(PER_CLIENT_HOUR.max_hits * 5 <= PER_HOUR.max_hits) };
        // Another client still has the shared budget.
        let later = start + Duration::from_secs(PER_HOUR.max_hits as u64 * 2);
        for offset in 0..PER_MINUTE.max_hits as u64 {
            assert!(admit(
                &mut limits,
                "198.51.100.7".parse().unwrap(),
                later + Duration::from_secs(offset)
            ));
        }
        // The greedy client recovers once its own hour rolls over.
        assert!(admit(
            &mut limits,
            greedy,
            start + Duration::from_secs(3600 + 1)
        ));
    }

    #[test]
    fn in_flight_slots_are_per_client_and_released_on_drop() {
        let in_flight = Arc::new(InFlight::default());
        let a: IpAddr = "203.0.113.1".parse().unwrap();
        let b: IpAddr = "203.0.113.2".parse().unwrap();
        let first = in_flight.try_enter(a, 1).expect("first slot");
        assert!(in_flight.try_enter(a, 1).is_none());
        let other = in_flight.try_enter(b, 1).expect("other client slot");
        assert_eq!(in_flight.count(a), 1);
        drop(first);
        assert_eq!(in_flight.count(a), 0);
        assert!(in_flight.counts.lock().unwrap().get(&a).is_none());
        let _again = in_flight.try_enter(a, 1).expect("released slot");
        drop(other);
        assert_eq!(in_flight.count(b), 0);
    }

    pub(super) fn test_config(address: SocketAddr) -> AiConfig {
        AiConfig {
            api_key: "test-secret".into(),
            base_url: format!("http://{address}"),
            model: "unused-voice-model".into(),
            registry: Some(Arc::new(crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
                &json!({
                    "schema_version": 1, "snapshot_version": "card-world-text-test",
                    "declared": [{
                        "requested_model_id": "test-entity-model", "provider": "openai_compatible",
                        "concrete_model": {"model_id": "test-entity-model"},
                        "input_modalities": ["text"], "output_modalities": ["text"],
                        "supported_parameters": {"structured_output": true, "json_mode": true},
                        "data_policy": {"retention": "none", "training": "prohibited"},
                        "capabilities": ["world_content"],
                        "prompt_adapter": {"id": "openai-chat", "version": "1"}
                    }], "discovered": []
                }).to_string()
            ).unwrap())),
            ..AiConfig::default()
        }
    }

    fn request_from(context: &Context, client: &str) -> Request<Body> {
        let mut request = request(context);
        request
            .extensions_mut()
            .insert(ConnectInfo(client.parse::<SocketAddr>().unwrap()));
        request
            .headers_mut()
            .insert("accept", "text/event-stream".parse().unwrap());
        request
    }

    async fn error_text(response: Response) -> String {
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        serde_json::from_slice::<Value>(&bytes).unwrap()["error"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[tokio::test]
    async fn one_client_cannot_hold_every_story_slot() {
        // A model that never answers keeps each accepted stream in flight.
        let provider = Router::new().route(
            "/chat/completions",
            post(|| async {
                tokio::time::sleep(Duration::from_secs(60)).await;
                StatusCode::OK
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let app = router::<()>(Arc::new(Some(test_config(address))));

        let held = app
            .clone()
            .oneshot(request_from(&context(), "203.0.113.1:5000"))
            .await
            .unwrap();
        assert_eq!(held.status(), StatusCode::OK);
        let second = app
            .clone()
            .oneshot(request_from(&context(), "203.0.113.1:5001"))
            .await
            .unwrap();
        assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            error_text(second).await,
            "Your last story is still being written."
        );
        // The second shared slot is still open for a different client.
        let other = app
            .clone()
            .oneshot(request_from(&context(), "198.51.100.7:5000"))
            .await
            .unwrap();
        assert_eq!(other.status(), StatusCode::OK);
        let third = app
            .clone()
            .oneshot(request_from(&context(), "192.0.2.9:5000"))
            .await
            .unwrap();
        assert_eq!(third.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(error_text(third).await, "The story service is busy.");

        // Closing the held stream releases that client's slot.
        drop(held);
        let mut released = false;
        for _ in 0..100 {
            let retry = app
                .clone()
                .oneshot(request_from(&context(), "203.0.113.1:5002"))
                .await
                .unwrap();
            if retry.status() == StatusCode::OK {
                released = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(released);
        drop(other);
        server.abort();
    }

    #[tokio::test]
    async fn ready_public_lines_survive_a_slow_first_voice() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let capture = seen.clone();
        let provider = Router::new().route("/chat/completions", post(move |Json(body): Json<Value>| {
            let seen = capture.clone();
            async move {
                let stem = body["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().lines().last().unwrap().to_string();
                seen.lock().unwrap().push(stem.clone());
                if stem == "Vale:" || stem.contains("to myself") { tokio::time::sleep(Duration::from_millis(500)).await; }
                Json(json!({"model":body["model"],"choices":[{"message":{"content":stem_reply(&stem)},"finish_reason":"stop"}]}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let mut c = context();
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 1,
            kind: "event".into(),
            text: "A friend visited.".into(),
        });
        let settings = VoiceSettings {
            call_timeout: Duration::from_millis(700),
            scene_timeout: Duration::from_millis(150),
            parallel: 4,
            ..VoiceSettings::hosted()
        };
        let result = complete(&test_config(address), &c, &BTreeMap::new(), &settings, None)
            .await
            .unwrap();
        assert_eq!(result["omitted"], json!(["vale"]));
        assert_eq!(result["entries"][0]["id"], "moth");
        let requested = seen.lock().unwrap();
        let mut first_public = requested[..4].to_vec();
        first_public.sort();
        assert_eq!(first_public, ["Empty station:", "Lamp:", "Pip:", "Vale:"]);
        server.abort();
    }

    #[tokio::test]
    async fn observable_claims_are_checked_and_retried_as_plain_speech() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let tries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = tries.clone();
        let provider = plain_provider(seen.clone(), move |_, stem| {
            if stem == "Vale:" && count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                "The lamp burns now.".into()
            } else {
                stem_reply(stem)
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let mut c = context();
        c.entities[2].facts = vec!["Has oil; unlit; uncovered.".into()];
        let check = Check::new(&c, &c.entities[0], Part::Line);
        assert_eq!(
            check.clean("The lamp burns now.", true),
            Err("observable_state")
        );
        let result = complete(
            &test_config(address),
            &c,
            &BTreeMap::new(),
            &VoiceSettings::hosted(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(tries.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert_ne!(result["entries"][0]["text"], "The lamp burns now.");
        assert!(transcript(&c, &c.entities[0], Part::Line).contains("unlit"));
        let requests = seen.lock().unwrap();
        let vale: Vec<_> = requests
            .iter()
            .filter_map(|request| request["messages"][1]["content"].as_str())
            .filter(|text| text.ends_with("Vale:"))
            .collect();
        assert!(vale[0].starts_with("Current scene:"));
        assert!(vale[1].starts_with("My next words are fresh"));
        assert!(vale[1].contains("unlit"));
        server.abort();
    }

    #[tokio::test]
    async fn current_pack_and_shared_human_voices_use_the_same_route() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |_, stem| stem_reply(stem));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        let mut models = parse_character_models(r#"{"vale":"vale-model","moth":"moth-model","keeper":"keeper-model","badger":"badger-model"}"#).unwrap();
        for model in models.values_mut() {
            *model = "test-entity-model".into();
        }
        let mut c = context();
        c.location = "greek-courtyard".into();
        c.entities[1].id = c.location.clone();
        c.entities[3].id = "greek-baker".into();
        c.speakers[1] = "greek-baker".into();
        assert!(idiolect(&c.entities[3], Part::Line).starts_with("I am Dione the Baker."));
        assert!(valid(&c));
        let result = complete(
            &test_config(address),
            &c,
            &models,
            &VoiceSettings::hosted(),
            None,
        )
        .await
        .unwrap();
        let baker = result["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == "greek-baker")
            .unwrap();
        assert_eq!(baker["model"], "test-entity-model");
        c = context();
        c.entities[0].id = "mara".into();
        assert!(idiolect(&c.entities[0], Part::Line).starts_with("I am Mara, the Understudy."));
        c.speakers[0] = "mara".into();
        seen.lock().unwrap().clear();
        let result = shared_lines(
            &test_config(address),
            &serde_json::to_value(&c).unwrap(),
            &["mara".into(), "moth".into()],
            &models,
        )
        .await
        .unwrap();
        assert_eq!(result["entries"].as_array().unwrap().len(), 2);
        assert_eq!(result["entries"][0]["id"], "mara");
        assert_eq!(result["entries"][1]["id"], "moth");
        assert_eq!(seen.lock().unwrap().len(), 2);
        for request in seen.lock().unwrap().iter() {
            let user = request["messages"][1]["content"].as_str().unwrap();
            assert!(user.ends_with("Mara:") || user.ends_with("Pip:"));
        }
        server.abort();
    }
    /// Serves a mock provider on a loopback port.
    pub(super) async fn serve(provider: Router) -> (SocketAddr, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, provider).await.unwrap();
        });
        (address, server)
    }

    fn cast_models() -> BTreeMap<String, String> {
        [
            ("vale", "vale-model"),
            ("moth", "moth-model"),
            ("keeper", "keeper-model"),
            ("badger", "badger-model"),
        ]
        .into_iter()
        .map(|(id, m)| (id.into(), m.into()))
        .collect()
    }

    /// A test configuration whose registry declares the cast models, the
    /// entity model and the given tier models for world content; `true`
    /// marks a tier model that thinks by default. The table's own
    /// world-content model is pinned as `COSYWORLD_CARD_TEXT_MODEL` pins it.
    fn tiered_config(address: SocketAddr, tiers: &[(&str, bool)]) -> AiConfig {
        let mut config = test_config(address);
        config
            .capability_models
            .insert(ModelCapability::WorldContent, "test-entity-model".into());
        let declared: Vec<_> = cast_models()
            .into_values()
            .chain(["test-entity-model".to_string()])
            .map(|id| (id, false))
            .chain(tiers.iter().map(|(id, reasoning)| (id.to_string(), *reasoning)))
            .map(|(id, reasoning)| json!({
                "requested_model_id":id,"provider":"openrouter","concrete_model":{"model_id":id},
                "input_modalities":["text"],"output_modalities":["text"],
                "supported_parameters":{"json_mode":true,"structured_output":true,"reasoning":reasoning},
                "capabilities":["world_content"],"prompt_adapter":{"id":"openai-chat","version":"1"}
            }))
            .collect();
        config.registry = Some(Arc::new(
            crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
                &json!({"schema_version":1,"snapshot_version":"tier-test","declared":declared,"discovered":[]})
                    .to_string(),
            )
            .unwrap(),
        ));
        config
    }

    async fn scene(app: &Router, context: &Context) -> (StatusCode, Value) {
        let response = app.clone().oneshot(request(context)).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 64 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    /// The cue a captured request ends with, such as `Pip:`.
    fn stem_of(body: &Value) -> String {
        body["messages"].as_array().unwrap().last().unwrap()["content"]
            .as_str()
            .unwrap()
            .lines()
            .last()
            .unwrap()
            .to_string()
    }

    fn models_for(requests: &[Value], stem: &str) -> Vec<String> {
        requests
            .iter()
            .filter(|body| stem_of(body) == stem)
            .map(|body| body["model"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn personas_run_on_the_reflection_model_while_lines_keep_their_own() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |body, stem| {
            let user = body["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap();
            if stem.ends_with(", who I am now:")
                && user.contains("Mute persona")
                && body["model"] != "escalation-model"
            {
                return String::new();
            }
            stem_reply(stem)
        });
        let (address, server) = serve(provider).await;
        let config = Arc::new(Some(tiered_config(
            address,
            &[("reflection-model", true), ("escalation-model", false)],
        )));
        let reflective = VoiceSettings {
            reflection_model: Some("reflection-model".into()),
            ..VoiceSettings::hosted()
        };
        let mut c = context();
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 1,
            kind: "event".into(),
            text: "Vale received a gift.".into(),
        });
        dream_due(&mut c);
        let persona = "I am still proud, but I am learning to accept help.";
        // With a character map and without one, only the persona moves.
        for (models, line_model) in [
            (cast_models(), "vale-model"),
            (BTreeMap::new(), "test-entity-model"),
        ] {
            seen.lock().unwrap().clear();
            let app = router_with_models::<()>(config.clone(), Ok(models), Ok(reflective.clone()));
            let (status, result) = scene(&app, &c).await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(result["entries"][0]["id"], "vale");
            assert_eq!(result["entries"][0]["model"], line_model);
            assert_eq!(result["entries"][0]["reflection"]["persona"], persona);
            assert_eq!(
                result["entries"][0]["reflection"]["thought"],
                "I felt welcome."
            );
            let requests = seen.lock().unwrap().clone();
            assert_eq!(requests.len(), 7);
            assert_eq!(models_for(&requests, "Vale:"), [line_model]);
            assert_eq!(models_for(&requests, "Vale, to myself:"), [line_model]);
            assert_eq!(
                models_for(&requests, "Vale, last night's dream:"),
                [line_model]
            );
            assert_eq!(
                models_for(&requests, "Vale, who I am now:"),
                ["reflection-model"]
            );
            for body in &requests {
                // The reflection model thinks by default; the route turns
                // that off there and leaves the other requests as they were.
                if body["model"] == "reflection-model" {
                    assert_eq!(body["reasoning"]["effort"], "none");
                } else {
                    assert!(body.get("reasoning").is_none(), "{}", stem_of(body));
                }
            }
        }
        // A persona that already ran on the escalation model is not sent
        // there again: two attempts, then silence for the reflection alone.
        c.entities[0].facts.push("Mute persona.".into());
        let same = VoiceSettings {
            escalation_model: Some("reflection-model".into()),
            ..reflective.clone()
        };
        seen.lock().unwrap().clear();
        let app = router_with_models::<()>(config.clone(), Ok(cast_models()), Ok(same));
        let (status, result) = scene(&app, &c).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["entries"][0]["model"], "vale-model");
        assert!(result["entries"][0].get("reflection").is_none());
        assert_eq!(result["omitted"], json!([]));
        // The dream runs beside the persona, so it is asked for either way.
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 8);
        assert_eq!(
            models_for(&requests, "Vale, who I am now:"),
            ["reflection-model", "reflection-model"]
        );
        // A different escalation model gets the persona's one more attempt.
        let bigger = VoiceSettings {
            escalation_model: Some("escalation-model".into()),
            ..reflective
        };
        seen.lock().unwrap().clear();
        let app = router_with_models::<()>(config, Ok(cast_models()), Ok(bigger));
        let (status, result) = scene(&app, &c).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["entries"][0]["model"], "vale-model");
        assert_eq!(result["entries"][0]["reflection"]["persona"], persona);
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 9);
        assert_eq!(
            models_for(&requests, "Vale, who I am now:"),
            ["reflection-model", "reflection-model", "escalation-model"]
        );
        server.abort();
    }

    #[tokio::test]
    async fn escalation_gives_a_failed_line_one_cooler_attempt_on_the_bigger_model() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |body, stem| {
            if stem == "Pip:" && body["model"] != "escalation-model" {
                return String::new();
            }
            stem_reply(stem)
        });
        let (address, server) = serve(provider).await;
        let app = router_with_models::<()>(
            Arc::new(Some(tiered_config(address, &[("escalation-model", false)]))),
            Ok(cast_models()),
            Ok(VoiceSettings {
                escalation_model: Some("escalation-model".into()),
                ..VoiceSettings::hosted()
            }),
        );
        let (status, result) = scene(&app, &context()).await;
        assert_eq!(status, StatusCode::OK);
        let entries = result["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(result["omitted"], json!([]));
        assert_eq!(entries[0]["model"], "vale-model");
        assert_eq!(entries[1]["id"], "moth");
        assert_eq!(entries[1]["model"], "escalation-model");
        assert_eq!(
            entries[1]["text"],
            "I remember the kindness beside the lamp."
        );
        // Mixed models leave the scene under the shared label.
        assert_eq!(result["model"], "card-voices-v1");
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 6);
        let prompts: Vec<_> = requests
            .iter()
            .filter(|body| stem_of(body) == "Pip:")
            .map(|body| {
                body["messages"].as_array().unwrap().last().unwrap()["content"]
                    .as_str()
                    .unwrap()
            })
            .collect();
        assert!(prompts[0].starts_with("Current scene:"));
        let facts = prompts[0].split_once("Current scene:\n").unwrap().1;
        for retry in &prompts[1..] {
            assert!(retry.starts_with("My next words are fresh"));
            assert_eq!(retry.split_once("Current scene:\n").unwrap().1, facts);
            assert!(retry.ends_with("Pip:"));
        }
        let pip: Vec<_> = requests
            .iter()
            .filter(|body| stem_of(body) == "Pip:")
            .map(|body| {
                (
                    body["model"].as_str().unwrap().to_string(),
                    body["temperature"].as_f64().unwrap(),
                )
            })
            .collect();
        assert_eq!(pip.len(), 3);
        for ((model, temperature), (expected, cooled)) in pip.iter().zip([
            ("moth-model", 1.0),
            ("moth-model", 0.9),
            ("escalation-model", 0.8),
        ]) {
            assert_eq!(model, expected);
            assert!(
                (temperature - cooled).abs() < 1e-9,
                "{model}: {temperature}"
            );
        }
        server.abort();
    }

    #[tokio::test]
    async fn escalation_that_also_fails_leaves_the_voice_silent_and_publishes_the_rest() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |_, stem| {
            if stem == "Empty station:" {
                String::new()
            } else {
                stem_reply(stem)
            }
        });
        let (address, server) = serve(provider).await;
        let config = tiered_config(address, &[("escalation-model", false)]);
        let settings = VoiceSettings {
            escalation_model: Some("escalation-model".into()),
            ..VoiceSettings::hosted()
        };
        let app = router_with_models::<()>(
            Arc::new(Some(config.clone())),
            Ok(cast_models()),
            Ok(settings.clone()),
        );
        let (status, result) = scene(&app, &context()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["omitted"], json!(["station"]));
        let ids: Vec<_> = result["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["vale", "moth", "lamp"]);
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 6);
        assert_eq!(
            models_for(&requests, "Empty station:"),
            ["test-entity-model", "test-entity-model", "escalation-model"]
        );
        // When the table's own world-content model is the escalation model,
        // scenery that fails on it is not sent there a third time.
        let mut pinned = config;
        pinned
            .capability_models
            .insert(ModelCapability::WorldContent, "escalation-model".into());
        seen.lock().unwrap().clear();
        let app = router_with_models::<()>(Arc::new(Some(pinned)), Ok(cast_models()), Ok(settings));
        let (status, result) = scene(&app, &context()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(result["omitted"], json!(["station"]));
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), 5);
        assert_eq!(
            models_for(&requests, "Empty station:"),
            ["escalation-model", "escalation-model"]
        );
        server.abort();
    }

    #[test]
    fn voice_tiers_take_exact_model_ids_or_stay_unset() {
        let lookup = |pairs: Vec<(&'static str, String)>| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| value.clone())
            }
        };
        let blank = VoiceSettings::from_lookup(lookup(vec![
            ("COSYWORLD_CARD_REFLECTION_MODEL", "   ".into()),
            ("COSYWORLD_CARD_ESCALATION_MODEL", String::new()),
        ]))
        .unwrap();
        assert_eq!(blank, VoiceSettings::hosted());
        let tiered = VoiceSettings::from_lookup(lookup(vec![
            ("COSYWORLD_CARD_TEXT_PROFILE", "local".into()),
            (
                "COSYWORLD_CARD_REFLECTION_MODEL",
                "openai/gpt-6-luna".into(),
            ),
            (
                "COSYWORLD_CARD_ESCALATION_MODEL",
                "google/gemma-4-31b-it".into(),
            ),
        ]))
        .unwrap();
        assert_eq!(
            tiered.reflection_model.as_deref(),
            Some("openai/gpt-6-luna")
        );
        assert_eq!(
            tiered.escalation_model.as_deref(),
            Some("google/gemma-4-31b-it")
        );
        assert_eq!(
            VoiceSettings {
                reflection_model: None,
                escalation_model: None,
                ..tiered
            },
            VoiceSettings::local()
        );
        for name in [
            "COSYWORLD_CARD_REFLECTION_MODEL",
            "COSYWORLD_CARD_ESCALATION_MODEL",
        ] {
            for bad in [
                " openai/gpt-6-luna".to_string(),
                "openai/gpt-6-luna ".into(),
                "openai/gpt-6-luna\n".into(),
                "a".repeat(161),
                "openai/gpt\u{7}6-luna".into(),
            ] {
                let error = VoiceSettings::from_lookup(lookup(vec![(name, bad.clone())]))
                    .expect_err(&format!("{name}={bad:?}"));
                assert!(error.starts_with(name), "{error}");
            }
        }
    }
    #[tokio::test(start_paused = true)]
    async fn slow_attempts_leave_time_for_escalation_inside_the_scene() {
        let settings = VoiceSettings::hosted();
        let started = tokio::time::Instant::now();
        let deadline = started + settings.scene_timeout;
        let mut seen = Vec::new();
        let result = voice_attempts(&settings, deadline, true, |escalated, attempt, budget| {
            seen.push((
                escalated,
                attempt,
                tokio::time::Instant::now() - started,
                budget,
            ));
            async move {
                if escalated {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    Ok("recovered")
                } else {
                    // Includes a gateway future waiting for readiness or a slot.
                    std::future::pending::<Result<&str, ()>>().await
                }
            }
        })
        .await;
        assert_eq!(result, Ok("recovered"));
        assert_eq!(seen.len(), 3);
        assert_eq!(
            seen[0],
            (false, 0, Duration::ZERO, Duration::from_millis(5500))
        );
        assert!(seen[1].2 >= Duration::from_millis(5500));
        assert!(seen[2].0);
        assert!(seen[2].2 >= Duration::from_secs(11));
        assert!(tokio::time::Instant::now() < deadline);
    }

    #[tokio::test(start_paused = true)]
    async fn queued_voice_shares_the_original_scene_deadline() {
        let settings = VoiceSettings::hosted();
        let started = tokio::time::Instant::now();
        let deadline = started + settings.scene_timeout;
        tokio::time::sleep(Duration::from_secs(14)).await;
        let mut seen = Vec::new();
        let result = voice_attempts(&settings, deadline, true, |escalated, _, budget| {
            seen.push((escalated, tokio::time::Instant::now() - started, budget));
            async move {
                if escalated {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    Ok(())
                } else {
                    std::future::pending::<Result<(), ()>>().await
                }
            }
        })
        .await;
        assert_eq!(result, Ok(()));
        assert_eq!(seen.len(), 3);
        assert!(seen[0].2 <= Duration::from_secs(2));
        assert!(seen[2].0);
        assert!(seen[2].1 >= Duration::from_secs(18));
        assert!(tokio::time::Instant::now() < deadline);
    }

    #[tokio::test(start_paused = true)]
    async fn exhausted_scene_cancels_escalation_and_starts_no_later_calls() {
        let settings = VoiceSettings::hosted();
        let deadline = tokio::time::Instant::now() + settings.scene_timeout;
        let mut seen = 0;
        let result = voice_attempts(&settings, deadline, true, |_, _, _| {
            seen += 1;
            std::future::pending::<Result<(), ()>>()
        })
        .await;
        assert_eq!(result, Err(()));
        assert_eq!(seen, 3);
        assert!(tokio::time::Instant::now() >= deadline);
        let result = voice_attempts(&settings, deadline, true, |_, _, _| {
            panic!("expired scenes have no request budget");
            #[allow(unreachable_code)]
            std::future::ready(Ok::<(), ()>(()))
        })
        .await;
        assert_eq!(result, Err(()));
    }

    #[tokio::test]
    async fn default_model_and_equal_concrete_models_skip_escalation() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let (address, server) = serve(plain_provider(seen.clone(), |_, _| String::new())).await;
        for explicit in [false, true] {
            let mut config = tiered_config(address, &[]);
            config.model = "test-entity-model".into();
            if !explicit {
                config.capability_models.clear();
            }
            let settings = VoiceSettings {
                escalation_model: Some("test-entity-model".into()),
                ..VoiceSettings::hosted()
            };
            seen.lock().unwrap().clear();
            let app =
                router_with_models::<()>(Arc::new(Some(config)), Ok(BTreeMap::new()), Ok(settings));
            let (status, _) = scene(&app, &context()).await;
            assert_eq!(status, StatusCode::BAD_GATEWAY);
            assert_eq!(models_for(&seen.lock().unwrap(), "Vale:").len(), 2);
        }
        // Two exact registry IDs can refer to one concrete model.
        let mut config = tiered_config(address, &[]);
        config.registry = Some(Arc::new(crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
            &json!({"schema_version":1,"snapshot_version":"same-concrete-test","declared":
                (["test-entity-model", "alternate-name"].map(|id| json!({
                    "requested_model_id":id,"provider":"openrouter",
                    "concrete_model":{"model_id":"test-entity-model"},
                    "supported_parameters":{"json_mode":true,"structured_output":true},
                    "input_modalities":["text"],"output_modalities":["text"],
                    "capabilities":["world_content"],"prompt_adapter":{"id":"openai-chat","version":"1"}
                }))), "discovered":[]}).to_string()).unwrap()));
        seen.lock().unwrap().clear();
        let app = router_with_models::<()>(
            Arc::new(Some(config)),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings {
                escalation_model: Some("alternate-name".into()),
                ..VoiceSettings::hosted()
            }),
        );
        let (status, _) = scene(&app, &context()).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY);
        assert_eq!(
            models_for(&seen.lock().unwrap(), "Vale:"),
            ["test-entity-model", "test-entity-model"]
        );
        server.abort();
    }

    #[tokio::test]
    async fn unqualified_tiers_and_selected_models_fail_before_provider_calls() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let (address, server) =
            serve(plain_provider(seen.clone(), |_, stem| stem_reply(stem))).await;
        for reflection in [false, true] {
            let settings = VoiceSettings {
                reflection_model: reflection.then(|| "missing-model".into()),
                escalation_model: (!reflection).then(|| "missing-model".into()),
                ..VoiceSettings::hosted()
            };
            let app = router_with_models::<()>(
                Arc::new(Some(tiered_config(address, &[]))),
                Ok(cast_models()),
                Ok(settings),
            );
            assert_eq!(
                scene(&app, &context()).await.0,
                StatusCode::SERVICE_UNAVAILABLE
            );
        }
        let mut voice_only = test_config(address);
        voice_only.registry = Some(Arc::new(
            crate::ai_gateway::CapabilityRegistrySnapshot::from_json(
                &json!({"schema_version":1,"snapshot_version":"voice-only-test","declared":[{
                "requested_model_id":"voice-only","provider":"openrouter",
                "concrete_model":{"model_id":"voice-only"},
                "input_modalities":["text"],"output_modalities":["text"],
                "capabilities":["voice"],"prompt_adapter":{"id":"openai-chat","version":"1"}
            }],"discovered":[]})
                .to_string(),
            )
            .unwrap(),
        ));
        let app = router_with_models::<()>(
            Arc::new(Some(voice_only)),
            Ok(cast_models()),
            Ok(VoiceSettings {
                escalation_model: Some("voice-only".into()),
                ..VoiceSettings::hosted()
            }),
        );
        assert_eq!(
            scene(&app, &context()).await.0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        let mut config = tiered_config(address, &[("escalation-model", false)]);
        config
            .capability_models
            .insert(ModelCapability::WorldContent, "missing-model".into());
        let app = router_with_models::<()>(
            Arc::new(Some(config)),
            Ok(BTreeMap::new()),
            Ok(VoiceSettings {
                escalation_model: Some("escalation-model".into()),
                ..VoiceSettings::hosted()
            }),
        );
        assert_eq!(scene(&app, &context()).await.0, StatusCode::BAD_GATEWAY);
        assert!(seen.lock().unwrap().is_empty());
        server.abort();
    }
    #[test]
    fn later_arrivals_only_hear_lines_they_witnessed() {
        let mut c = context();
        c.outcome = Some(solo_departure());
        let card = &mut c.outcome.as_mut().unwrap().card;
        card.kind = "talk".into();
        card.target = Some("moth".into());
        c.conversation = vec![SpokenLine {
            actor_id: "vale".into(),
            text: "A secret between us.".into(),
            witnesses: Some(vec!["vale".into()]),
        }];
        let moth = c.entities.iter().find(|e| e.id == "moth").unwrap();
        assert!(!transcript(&c, moth, Part::Line).contains("A secret between us."));
        c.conversation[0].witnesses = Some(vec!["vale".into(), "moth".into()]);
        let moth = c.entities.iter().find(|e| e.id == "moth").unwrap();
        assert!(transcript(&c, moth, Part::Line).contains("\nVale: A secret between us.\nPip:"));
        c.conversation[0].witnesses = None;
        let moth = c.entities.iter().find(|e| e.id == "moth").unwrap();
        assert!(!transcript(&c, moth, Part::Line).contains("A secret between us."));
    }

    /// #1537: speech prompts show the present, not a transcript. Only the
    /// line a Talk answers is kept, and repeats are caught from memory.
    #[test]
    fn speech_prompts_keep_only_the_answered_line_and_repeats_come_from_memory() {
        let mut c = context();
        c.outcome = Some(solo_departure());
        let card = &mut c.outcome.as_mut().unwrap().card;
        card.kind = "talk".into();
        card.target = Some("moth".into());
        let all = vec!["vale".to_string(), "moth".into(), "keeper".into()];
        let said = |actor: &str, text: &str| SpokenLine {
            witnesses: Some(all.clone()),
            actor_id: actor.into(),
            text: text.into(),
        };
        c.conversation = vec![
            said("vale", "Where does the pond lead?"),
            said("moth", "Somewhere with better light."),
            said("vale", "Will you show me the far shore?"),
            said("moth", "Only if you bring the lamp."),
        ];
        c.entities[0].memories.push(Memory {
            seq: None,
            turn: 3,
            kind: "expression".into(),
            text: "Vale: I keep my own counsel.".into(),
        });
        c.entities[0].previous = Some("Will you show me the far shore?".into());
        let vale = transcript(&c, &c.entities[0], Part::Line);
        for gone in [
            "Where does the pond lead?",
            "Somewhere with better light.",
            "Will you show me the far shore?",
            "Only if you bring the lamp.",
            "I keep my own counsel.",
            "Earlier:",
        ] {
            assert!(!vale.contains(gone), "{gone}");
        }
        // Pip answers the line Vale's Talk put to them, and nothing older.
        let pip = transcript(&c, &c.entities[3], Part::Line);
        assert!(pip.contains("\nVale: Will you show me the far shore?\nPip:"));
        assert!(!pip.contains("Where does the pond lead?"));
        assert!(!pip.contains("Somewhere with better light."));
        assert!(!pip.contains("Earlier:"));
        // Repeats are still caught from what the speaker said before.
        let check = Check::new(&c, &c.entities[0], Part::Line);
        assert_eq!(
            recent_own_lines(&c, &c.entities[0]),
            vec![
                "I keep my own counsel.".to_string(),
                "Where does the pond lead?".into(),
                "Will you show me the far shore?".into(),
            ]
        );
        for line in [
            "I keep my own counsel.",
            "Where does the pond lead?",
            "Will you show me the far shore?",
        ] {
            assert_eq!(check.clean(line, true), Err("repeat"), "{line}");
        }
        assert_eq!(
            check.clean("I'll bring the lamp, then.", true),
            Ok("I'll bring the lamp, then.".into())
        );
        let check = Check::new(&c, &c.entities[3], Part::Line);
        assert_eq!(
            check.clean("Somewhere with better light.", true),
            Err("repeat")
        );
        // Parroting the answered line is a repeat too.
        assert_eq!(
            check.clean("Will you show me the far shore?", true),
            Err("repeat")
        );
    }

    #[tokio::test]
    async fn shared_reflections_use_the_new_thought_and_keep_evidence_and_models() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let provider = plain_provider(seen.clone(), |_, stem| stem_reply(stem));
        let (address, server) = serve(provider).await;
        let mut c = context();
        c.entities[0].memories.push(Memory {
            seq: Some(4),
            turn: 1,
            kind: "event".into(),
            text: "The keeper declined my request.".into(),
        });
        resting(&mut c);
        let settings = VoiceSettings {
            reflection_model: Some("reflection-model".into()),
            ..VoiceSettings::hosted()
        };
        let config = tiered_config(address, &[("reflection-model", false)]);
        let result = complete_selected(
            &config,
            &c,
            &cast_models(),
            &settings,
            &["vale".into()],
            true,
            None,
        )
        .await
        .unwrap();
        let growth = &result["entries"][0]["reflection"];
        assert_eq!(growth["evidence"], json!([4]));
        assert_eq!(growth["models"]["thought"], "vale-model");
        assert_eq!(growth["models"]["persona"], "reflection-model");
        let requests = seen.lock().unwrap();
        let revision = requests
            .iter()
            .find(|r| stem_of(r) == "Vale, who I am now:")
            .unwrap();
        assert!(revision["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("On my mind: I felt welcome."));
        server.abort();
    }
}
