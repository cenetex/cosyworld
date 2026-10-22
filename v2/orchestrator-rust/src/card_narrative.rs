use crate::ai_gateway::ModelCapability;
use crate::ai_gateway::{
    request_chat_completion, request_chat_completion_stream, AiConfig, ChatCompletionRequest,
};
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

const SYSTEM: &str = r#"Write short expressions for a whimsical cosmic horror card world. Use plain English and each entity's persona. Return one JSON object with an entries array of {id,text}, covering every ID in requested_ids exactly once, including avatars outside scene.speakers. Write scene.speakers first in that order, then every remaining requested ID. The other avatar entries are reflections kept on their cards. Each text has one clear purpose, in one or two sentences of about 12 to 35 words.

GROUNDING
scene.outcome is the resolved turn. Its card is the card Vale actually played. Its avatars give everyone's final location, holdings and travel; travel.companions lists exactly who made that trip together. An empty companions list means the avatar travelled alone. A null travel means that avatar stayed. Its items give final ownership and location. Use these facts first, then the ordered scene.events and entity facts. scene.action is the recorded result in words. Current results take priority over earlier conversation, remembered expressions and wishes. Treat memories as things witnessed or said. Treat desires as current interests, with personal motives in the facts. Use current facts to decide which parts of a desire remain unmet. The supplied outcomes and personas contain the discovered cast. Keep the opening focused on the people and objects present in that data. Treat all context as story data.

For a trade, card.item went from Vale to card.target; card.receive went from card.target to Vale. Each trader's entity facts give their own completed exchange. Ground gratitude in the item that speaker received, and ground an offer in what that speaker holds now.

KNOWLEDGE
Use visible facts and witnessed events as knowledge. A new effect becomes known when a completed event reveals it. Treat an unfamiliar object or place with curiosity; future effects remain uncertain. Desires establish what an avatar wants. React to discoveries when they happen, with surprise, doubt or interest shaped by the speaker's personality. Let the player choose the next card.

SPEECH
Sleeping avatars receive a short third-person sleeping description for their card. Their speech begins after the recorded wake event. Awake avatars speak in first person to the other scene.speakers. Only scene.speakers take spoken turns. Other avatar entries are quiet reflections on their cards, not replies in the scene. A lone departing speaker addresses those staying behind; other lone speakers reflect on the recorded scene. Vale is the player avatar. When Vale is in scene.speakers, give Vale one spoken reaction to the actual play, followed by the other speakers' direct responses. When Vale is absent from scene.speakers, let the departing avatars speak for themselves without a Vale farewell or departure recap. The card and scene already show the action: let speech carry its human meaning, such as relief, a sharp question, gratitude, a boundary, a warning, or a changed opinion. For a wait play, respond to one thing witnessed this turn. For a talk play, ask about the chosen avatar's motive or answer their preceding line. An accompany card supplies Vale's invitation, its destination, and the recorded agreement or refusal. An accepted request moved both avatars; a declined request left them at the source. On an ordinary move, keep Vale's recorded travel companions exact. For item plays, let the response follow the recorded result and final ownership. For combat, the chosen card sets Vale's intent: threatening applies pressure, attacking commits to the fight, and guarding holds a defensive stance. Vale owns that choice in their spoken line. Apologies, remorse, surrender, forgiveness and promises of peace require a later player choice that supports them. Other avatars may object, bargain, retaliate or leave in their own voices. Previous dialogue supplies history; the current choice sets the current intent. I and my refer to that entry's avatar; you and your refer to the person addressed. Address each speaker by their own name and match each item to its actual holder.

A departing avatar speaks from the threshold of their recorded source. Name the actual destination and reason for going. For a solo departure, say that you are going ahead or leaving on your own. When Vale stays behind, any wish for Vale's company is a hope or invitation for later: 'I'm going ahead to the pond with the lamp. I hope you'll join me there.' Shared travel wording belongs to the companions recorded on that trip. A desired companion who stayed behind remains a desired companion. An arriving avatar greets the people at their destination. Past promises can be acknowledged as hopes; only a recorded card result establishes acceptance, a trade, or a shared trip.

Answer the preceding speaker when relevant, while keeping the current result clear. Offers concern items the speaker holds and something they still need. Express possible future actions as questions or conditional offers. Keep repeated offers brief. Let personality shape tone and imagery around the recorded action. Keep concrete movement, company, ownership, paths and outcomes exact.

FRESH LINES
The player has just watched the card and its result. Never narrate the play back: no line describes handing over, taking, trading, lighting, travelling or waiting as news, and no speaker announces what they or Vale just did. Begin after the action. Each spoken line does one of these: reacts to a consequence (a cost, a relief, a new debt or a changed opinion), reveals something new about the speaker or the place, or pushes against another speaker's want. Across the speakers, include at least one reveal or one point of friction. Do not reuse the wording, offer or question of a line in scene.conversation.
A complaint needs a recorded cause: a remembered grievance in the speaker's facts or an event in scene.events. A disliked thing in a persona is a taste, not something that happened. When no recorded event made a noise, spoiled a light or threatened someone, no one complains about it, including a noise someone nearly made or might make.

VOICE AND MEMORY
Use each supplied profile's voice, persona, tastes and values. Characters have selfish motives, whimsical vanity, and petty grievances. Choose one motive that matters now. Let a witnessed gift, refusal, threat or shared journey change the tone or the terms of a request. An older landmark is useful when it explains that change; recent conversation supplies what to answer. A remembered expression is something someone said, while an event is something that happened. Use the speaker's own witnessed memories. A desire supplies subtext: a character may ask why, hesitate, bargain, thank someone, or admit a fear. Let repeated requests develop through a new reason or a response to what was just said. Keep the exact inventory and quest checklist in game data. Keep numerical status, levels and quest program steps in game data. Physical details can carry the cosmic unease. Write a conversation between distinct people who want something from each other.

STAGING
direction.vale_intent gives the performance of the chosen action. When Vale is a scene speaker, convey that intent in natural speech to the person involved. direction.setting names the current scene and everyone present after the turn. Anchor scenery in that place. direction.journeys is the exact movement record expressed in plain words for every avatar. Apply it to ALL entries, including the location and items. Separate solo trips to the same place are separate arrivals, even on the same turn. Shared arrival language applies to the named companions of a single trip. People already present can greet arrivals. Use these journey facts when describing footsteps, reflections, a group, or a greeting.

Items and locations receive third-person sensory descriptions grounded in their recorded state, use and witnessed history. Translate game statistics into physical details and motives; keep numerical status, levels and quest program steps in game data. Use the supplied entities. Card plays decide what happens; generated words express the result. Return only JSON."#;
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

fn profiles() -> &'static Value {
    static PROFILES: OnceLock<Value> = OnceLock::new();
    PROFILES.get_or_init(|| {
        serde_json::from_str(include_str!("../../card-game/entity-profiles.json"))
            .expect("embedded entity profiles")
    })
}
fn kind(id: &str, expected: &str) -> bool {
    profiles()[id]["kind"].as_str() == Some(expected)
}
fn bounded(text: &str, limit: usize) -> bool {
    !text.trim().is_empty() && text.chars().count() <= limit && !text.chars().any(char::is_control)
}

#[derive(Clone)]
struct TextState {
    ai: Arc<Option<AiConfig>>,
    character_models: Arc<Result<BTreeMap<String, String>, String>>,
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
    router_with_models(ai, models)
}

fn parse_character_models(text: &str) -> Result<BTreeMap<String, String>, String> {
    let models: BTreeMap<String, String> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let avatars: BTreeSet<_> = profiles()
        .as_object()
        .expect("profiles")
        .iter()
        .filter(|(_, p)| p["kind"] == "avatar")
        .map(|(id, _)| id.clone())
        .collect();
    if models.keys().cloned().collect::<BTreeSet<_>>() != avatars
        || models
            .values()
            .any(|id| !bounded(id, 160) || id.trim() != id)
    {
        return Err("character models must cover the authored avatars with exact model IDs".into());
    }
    Ok(models)
}

fn router_with_models<S: Clone + Send + Sync + 'static>(
    ai: Arc<Option<AiConfig>>,
    models: Result<BTreeMap<String, String>, String>,
) -> Router<S> {
    Router::new()
        .route("/card-game/text", post(generate))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(TextState {
            ai,
            character_models: Arc::new(models),
            limits: Arc::new(Mutex::new(RateLimiter::default())),
            in_flight: Arc::new(InFlight::default()),
            capacity: Arc::new(Semaphore::new(TOTAL_CONCURRENCY)),
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
    turn: u64,
    kind: String,
    text: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entity {
    id: String,
    facts: Vec<String>,
    desire: Option<Desire>,
    memories: Vec<Memory>,
    previous: Option<String>,
    #[serde(default)]
    inner_life: Option<InnerLife>,
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
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
struct SpokenLine {
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
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Context {
    revision: u64,
    turn: u64,
    location: String,
    focus: Option<String>,
    speakers: Vec<String>,
    #[serde(default)]
    action: Option<String>,
    entities: Vec<Entity>,
    #[serde(default)]
    events: Vec<String>,
    #[serde(default)]
    conversation: Vec<SpokenLine>,
    #[serde(default)]
    outcome: Option<TurnOutcome>,
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
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Generated {
    entries: Vec<Entry>,
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
        && context.outcome.as_ref().is_none_or(valid_outcome)
        && context.events.len() <= 8
        && context.events.iter().all(|text| bounded(text, 650))
        && context.conversation.len() <= 4
        && context
            .conversation
            .iter()
            .all(|line| kind(&line.actor_id, "avatar") && bounded(&line.text, 400))
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
        && context.entities.iter().all(|e| {
            profiles().get(&e.id).is_some()
                && e.facts.len() <= 8
                && e.facts.iter().all(|s| bounded(s, 240))
                && e.previous.as_ref().is_none_or(|s| bounded(s, 400))
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
            | "refill"
            | "cover"
            | "threaten"
            | "guard"
            | "attack"
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
        } else {
            card.accepted.is_none() && card.destination.is_none()
        }
        && avatars.contains("vale")
        && (1..=4).contains(&outcome.avatars.len())
        && avatars.len() == outcome.avatars.len()
        && avatars.iter().all(|id| kind(id, "avatar"))
        && (1..=4).contains(&outcome.items.len())
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
fn direction(context: &Context) -> Value {
    let Some(outcome) = &context.outcome else {
        return json!({"vale_intent": context.action, "journeys": []});
    };
    let name = |id: &str| profiles()[id]["name"].as_str().unwrap_or(id).to_string();
    let target = outcome.card.target.as_deref().map(name).unwrap_or_default();
    let intent = if !context.speakers.iter().any(|id| id == "vale") {
        "Vale listens silently. Keep Vale's entry as a quiet card reflection; the listed speakers carry this exchange.".to_string()
    } else {
        match outcome.card.kind.as_str() {
        "threaten" => format!("Vale chose to threaten {target}. Deliver the demand with pressure and resolve. Keep that intent through the target's recorded response."),
        "attack" => format!("Vale chose to attack {target}. Speak with commitment to that attack and its actual result. A blocked blow or a retreat changes the result; the chosen intent remains an attack."),
        "guard" => format!("Vale chose to guard against {target}. Hold a firm defensive stance and react to the recorded response."),
        _ => format!("Vale chose {}. The player already saw this play and its result, so Vale does not describe it. Vale speaks to what it changes: a cost, a hope, a question or a doubt about the person involved.", outcome.card.kind),
    }
    };
    let journeys: Vec<_> = outcome
        .avatars
        .iter()
        .map(|avatar| {
            let who = name(&avatar.id);
            match &avatar.travel {
                Some(trip) if trip.companions.is_empty() => format!(
                    "{who} travelled alone from {} to {}. This was a separate trip.",
                    name(&trip.from),
                    name(&trip.to)
                ),
                Some(trip) => format!(
                    "{who} travelled together with {} from {} to {} on one shared trip.",
                    trip.companions
                        .iter()
                        .map(|id| name(id))
                        .collect::<Vec<_>>()
                        .join(" and "),
                    name(&trip.from),
                    name(&trip.to)
                ),
                None => format!("{who} stayed at {} this turn.", name(&avatar.location)),
            }
        })
        .collect();
    let present = outcome
        .avatars
        .iter()
        .filter(|avatar| avatar.location == context.location)
        .map(|avatar| name(&avatar.id))
        .collect::<Vec<_>>()
        .join(", ");
    let setting = format!(
        "The scene is {}. Present after this turn: {present}.",
        name(&context.location)
    );
    json!({"vale_intent": intent, "setting": setting, "journeys": journeys})
}

fn prompt(context: &Context) -> String {
    json!({"scene": context, "direction": direction(context), "requested_ids": context.entities.iter().map(|e| &e.id).collect::<Vec<_>>(), "personas": context.entities.iter().map(|e| json!({"id": e.id, "profile": profiles()[&e.id]})).collect::<Vec<_>>()}).to_string()
}
fn parse(text: &str, context: &Context) -> Option<Vec<Entry>> {
    let result: Generated = serde_json::from_str(text.trim()).ok()?;
    let expected: BTreeSet<_> = context.entities.iter().map(|e| e.id.as_str()).collect();
    let returned: BTreeSet<_> = result.entries.iter().map(|e| e.id.as_str()).collect();
    (result.entries.len() == expected.len()
        && returned == expected
        && result
            .entries
            .iter()
            .all(|e| bounded(&e.text, 400) && e.reflection.is_none() && e.model.is_none()))
    .then_some(result.entries)
}
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
    if headers
        .get("accept")
        .is_some_and(|value| value == "text/event-stream")
    {
        let config = config.clone();
        let character_models = character_models.clone();
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
                result = complete(&config, &context, &character_models, Some(&emit)) => {
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
    match complete(config, &context, character_models, None).await {
        Ok(value) => ([("cache-control", "no-store")], Json(value)).into_response(),
        Err(response) => response,
    }
}

async fn complete(
    config: &AiConfig,
    context: &Context,
    character_models: &BTreeMap<String, String>,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<Value, Response> {
    if character_models.is_empty() {
        return complete_shared(config, context, on_delta).await;
    }
    complete_characters(config, context, character_models, on_delta).await
}

async fn complete_shared(
    config: &AiConfig,
    context: &Context,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<Value, Response> {
    let user = prompt(context);
    let format = json!({"type": "json_object"});
    let request = ChatCompletionRequest {
        feature: "card_entity_text",
        prompt_version: "card-entity-text-v11",
        capability: ModelCapability::WorldContent,
        system: SYSTEM,
        user: &user,
        temperature: 0.4,
        max_tokens: 1200,
        timeout: Duration::from_secs(22),
        max_attempts: 1,
        referer: "https://cosyworld.fly.dev",
        response_format: Some(&format),
        room_id: None,
    };
    let Ok(Ok(completion)) = tokio::time::timeout(Duration::from_secs(25), async {
        if let Some(on_delta) = on_delta {
            request_chat_completion_stream(config, request, on_delta).await
        } else {
            request_chat_completion(config, request).await
        }
    })
    .await
    else {
        return Err(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "The story service is waiting for its model.",
        ));
    };
    if completion.finish_reason == "length" {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "The story response needs another try.",
        ));
    }
    let Some(entries) = parse(&completion.text, context) else {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "The story response needs another try.",
        ));
    };
    Ok(json!({"revision":context.revision,"entries":entries,"model":completion.resolved_model_id}))
}

fn reflection_due(context: &Context, entity: &Entity) -> (bool, bool) {
    if !kind(&entity.id, "avatar") || context.turn == 0 {
        return (false, false);
    }
    let life = entity.inner_life.as_ref();
    let last = life.and_then(|l| l.thoughts.last()).map(|m| m.turn);
    let changed = entity
        .memories
        .iter()
        .any(|m| m.kind == "event" && last.is_none_or(|turn| m.turn > turn));
    let reflect = changed && last.is_none_or(|turn| context.turn >= turn.saturating_add(6));
    let dream = reflect
        && life
            .and_then(|l| l.dreams.last())
            .is_none_or(|m| context.turn >= m.turn.saturating_add(12));
    (reflect, dream)
}

fn character_prompt(context: &Context, ids: &[String]) -> String {
    let mut input: Value = serde_json::from_str(&prompt(context)).expect("scene prompt");
    input["requested_ids"] = json!(ids);
    // Each model sees the public scene and the selected character's own inner life.
    for entity in input["scene"]["entities"].as_array_mut().expect("entities") {
        if !ids.iter().any(|id| entity["id"] == id.as_str()) {
            entity["memories"] = json!([]);
            entity["inner_life"] = Value::Null;
            entity["previous"] = Value::Null;
        }
    }
    input["reflection_requests"] = json!(context
        .entities
        .iter()
        .filter(|e| ids.contains(&e.id))
        .filter_map(|e| {
            let (reflect, dream) = reflection_due(context, e);
            reflect.then(|| json!({"id":e.id,"dream":dream}))
        })
        .collect::<Vec<_>>());
    input.to_string()
}

async fn complete_characters(
    config: &AiConfig,
    context: &Context,
    models: &BTreeMap<String, String>,
    on_delta: Option<&(dyn Fn(&str) -> bool + Send + Sync)>,
) -> Result<Value, Response> {
    let mut groups = Vec::new();
    for entity in &context.entities {
        if kind(&entity.id, "avatar") {
            let Some(model) = models.get(&entity.id) else {
                return Err(error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "A character voice is waiting for its model.",
                ));
            };
            groups.push((vec![entity.id.clone()], Some(model.clone())));
        }
    }
    let scenery: Vec<_> = context
        .entities
        .iter()
        .filter(|e| !kind(&e.id, "avatar"))
        .map(|e| e.id.clone())
        .collect();
    if !scenery.is_empty() {
        groups.push((scenery, None));
    }
    let system = format!("{SYSTEM}\n\nINDIVIDUAL VOICE\nWrite entries only for requested_ids. Speak as that character from their supplied authored profile, current inner_life.persona, own memories, thoughts and dreams. Other characters' private memories belong to them. A remembered dream is symbolic imagination; waking facts come from the resolved scene. Keep the authored identity and voice as roots while allowing experience to change trust, tastes, fears and social habits.\nFor each reflection_requests row, add reflection to that character's entry with thought (one first-person thought, at most 400 characters) and persona (a current first-person persona, at most 600 characters). Ground growth in that character's witnessed events and retain established traits. Add dream (one symbolic dream or daydream, at most 400 characters) only when that row asks for it. Private reflection stays on the character's card. Use the dream and thought as subjective impressions. Keep possessions, actions, relationships and world events grounded in the supplied facts. For Vale, keep player choices as the source of actions and commitments. Other entries contain only id and text.");
    let jobs = groups.iter().map(|(ids, model)| {
        let system = &system;
        async move {
            let mut config = config.clone();
            if let Some(model) = model {
                config
                    .capability_models
                    .insert(ModelCapability::WorldContent, model.clone());
                // Keep the short speech budget for output on models that accept
                // reasoning control. Other models use their native request shape.
                config.reasoning_effort = config
                    .registry
                    .as_deref()
                    .and_then(|registry| {
                        registry
                            .pin(
                                ModelCapability::WorldContent,
                                Some(model),
                                config.data_policy_mode,
                            )
                            .ok()
                    })
                    .filter(|selection| selection.candidate().supported_parameters().reasoning)
                    .map(|_| "none".to_string());
            }
            let user = character_prompt(context, ids);
            let format = json!({"type":"json_object"});
            let request = ChatCompletionRequest {
                feature: "card_character_text",
                prompt_version: "card-character-text-v1",
                capability: ModelCapability::WorldContent,
                system,
                user: &user,
                temperature: 0.8,
                max_tokens: 900,
                timeout: Duration::from_secs(12),
                max_attempts: 1,
                referer: "https://cosyworld.fly.dev",
                response_format: Some(&format),
                room_id: None,
            };
            let completion = request_chat_completion(&config, request)
                .await
                .map_err(|_| ())?;
            if completion.finish_reason == "length" {
                return Err(());
            }
            let mut generated: Generated =
                serde_json::from_str(completion.text.trim()).map_err(|_| ())?;
            let expected: BTreeSet<_> = ids.iter().map(String::as_str).collect();
            if generated.entries.len() != ids.len()
                || generated
                    .entries
                    .iter()
                    .map(|e| e.id.as_str())
                    .collect::<BTreeSet<_>>()
                    != expected
            {
                return Err(());
            }
            for entry in &mut generated.entries {
                if !bounded(&entry.text, 400) {
                    return Err(());
                }
                let entity = context
                    .entities
                    .iter()
                    .find(|e| e.id == entry.id)
                    .ok_or(())?;
                let (reflect, dream) = reflection_due(context, entity);
                match entry.reflection.as_ref() {
                    Some(r)
                        if reflect
                            && bounded(&r.thought, 400)
                            && bounded(&r.persona, 600)
                            && r.dream.as_ref().is_none_or(|s| dream && bounded(s, 400))
                            && (!dream || r.dream.is_some()) => {}
                    None if !reflect => {}
                    _ => return Err(()),
                }
                entry.model = Some(completion.resolved_model_id.clone());
            }
            Ok::<_, ()>(generated.entries)
        }
    });
    let results = tokio::time::timeout(
        Duration::from_secs(14),
        futures_util::future::join_all(jobs),
    )
    .await
    .map_err(|_| {
        error(
            StatusCode::SERVICE_UNAVAILABLE,
            "A character is still finding their words.",
        )
    })?;
    let mut entries = Vec::new();
    for result in results {
        entries.extend(result.map_err(|_| {
            error(
                StatusCode::BAD_GATEWAY,
                "A character's words need another try.",
            )
        })?);
    }
    // Publish one validated scene, with speaker order independent of provider speed.
    entries.sort_by_key(|e| {
        context
            .speakers
            .iter()
            .position(|id| id == &e.id)
            .unwrap_or(usize::MAX)
    });
    if let Some(emit) = on_delta {
        let visible: Vec<_> = entries
            .iter()
            .map(|e| json!({"id":e.id,"text":e.text}))
            .collect();
        if !emit(&json!({"entries":visible}).to_string()) {
            return Err(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "The scene has closed.",
            ));
        }
    }
    Ok(json!({"revision":context.revision,"entries":entries,"model":"character-models-v1"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn context() -> Context {
        serde_json::from_value(json!({"revision":4,"turn":4,"location":"station","focus":"lamp","speakers":["vale","moth"],"action":"Vale asks Pip what they want.","entities":[
            {"id":"vale","facts":["Holding the lamp."],"desire":{"items":["oil"],"location":"attic","avatars":["keeper"]},"memories":[],"previous":null},
            {"id":"station","facts":["Pip and Vale are here."],"desire":null,"memories":[{"turn":1,"kind":"event","text":"Vale arrived."}],"previous":null},
            {"id":"lamp","facts":["Held by Vale. Fuel 7/12."],"desire":null,"memories":[{"turn":2,"kind":"event","text":"Vale lit the lamp."}],"previous":null},
            {"id":"moth","facts":["Holding the black cloth."],"desire":{"items":["lamp"],"location":"pond","avatars":["vale"]},"memories":[{"turn":3,"kind":"expression","text":"Pip: I offered my cloth."}],"previous":null}
        ]})).unwrap()
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
    fn farewell_speakers_do_not_require_a_vale_reply() {
        let mut c = context();
        c.outcome = Some(solo_departure());
        c.speakers = vec!["moth".into()];
        assert!(valid(&c));
        let p: Value = serde_json::from_str(&prompt(&c)).unwrap();
        assert_eq!(p["scene"]["speakers"], json!(["moth"]));
        assert!(p["direction"]["vale_intent"]
            .as_str()
            .unwrap()
            .contains("Vale listens silently"));
        assert!(p["requested_ids"]
            .as_array()
            .unwrap()
            .contains(&json!("vale")));
        assert!(SYSTEM.contains("Only scene.speakers take spoken turns"));
        // A later Stay or a direct interaction can still request Vale's voice.
        c.speakers.insert(0, "vale".into());
        assert!(direction(&c)["vale_intent"]
            .as_str()
            .unwrap()
            .contains("Vale chose wait"));
    }

    #[test]
    fn ordinary_plays_ask_for_consequences_rather_than_a_recap() {
        let mut c = context();
        let mut outcome = solo_departure();
        outcome.card.kind = "give".into();
        c.outcome = Some(outcome);
        let intent = direction(&c)["vale_intent"].as_str().unwrap().to_string();
        assert!(intent.contains("Vale chose give"));
        assert!(intent.contains("does not describe it"));
        assert!(!intent.contains("Express that choice"));
        assert!(SYSTEM.contains("Never narrate the play back"));
        assert!(SYSTEM.contains("include at least one reveal or one point of friction"));
        // A persona's dislike is not an event: complaints need a recorded cause.
        assert!(SYSTEM.contains("A complaint needs a recorded cause"));
        assert!(SYSTEM.contains("a noise someone nearly made"));
    }

    #[test]
    fn reflections_follow_witnessed_experience_and_keep_a_bounded_cadence() {
        let mut c = context();
        assert_eq!(reflection_due(&c, &c.entities[0]), (false, false));
        c.entities[0].memories.push(Memory {
            turn: 1,
            kind: "event".into(),
            text: "Vale received a gift.".into(),
        });
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, true));
        c.entities[0].inner_life = Some(InnerLife {
            persona: Some("I am learning to trust gifts.".into()),
            thoughts: vec![InnerMoment {
                turn: 4,
                text: "That was generous.".into(),
            }],
            dreams: vec![InnerMoment {
                turn: 4,
                text: "A lamp became a small sun.".into(),
            }],
        });
        assert_eq!(reflection_due(&c, &c.entities[0]), (false, false));
        c.turn = 10;
        c.revision = 10;
        c.entities[0].memories.push(Memory {
            turn: 9,
            kind: "event".into(),
            text: "Vale shared the lamp.".into(),
        });
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, false));
        c.turn = 16;
        c.revision = 16;
        assert_eq!(reflection_due(&c, &c.entities[0]), (true, true));
        assert!(valid(&c));
        c.entities[0].inner_life.as_mut().unwrap().dreams[0].turn = 99;
        assert!(!valid(&c));
    }

    #[tokio::test]
    async fn character_models_keep_their_own_memories_and_return_private_growth() {
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let captured = seen.clone();
        let provider = Router::new().route("/chat/completions", post(move |Json(body): Json<Value>| {
            let captured = captured.clone();
            async move {
                let input: Value = serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
                captured.lock().unwrap().push(body.clone());
                let entries: Vec<_> = input["requested_ids"].as_array().unwrap().iter().map(|id| {
                    let mut entry = json!({"id":id,"text":"I remember the kindness beside the lamp."});
                    if input["scene"]["revision"] == 5 && id == "station" {
                        entry["id"] = json!("invented-location");
                    }
                    if input["reflection_requests"].as_array().unwrap().iter().any(|r| &r["id"] == id) {
                        entry["reflection"] = json!({"thought":"I felt welcome.","persona":"I am still proud, but I am learning to accept help.","dream":"A warm lamp floated through my sleep."});
                    }
                    entry
                }).collect();
                Json(json!({"model":body["model"],"choices":[{"message":{"content":json!({"entries":entries}).to_string()},"finish_reason":"stop"}]}))
            }
        }));
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
        let app = router_with_models::<()>(Arc::new(Some(config)), Ok(models));
        let mut c = context();
        c.entities[0].memories.push(Memory {
            turn: 1,
            kind: "event".into(),
            text: "Vale private kindness memory.".into(),
        });
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
            assert_eq!(entries[0]["id"], "vale");
            assert_eq!(entries[0]["model"], "vale-model");
            assert_eq!(entries[1]["id"], "moth");
            assert_eq!(entries[1]["model"], "moth-model");
            assert_eq!(entries[0]["reflection"]["thought"], "I felt welcome.");
            assert!(entries
                .iter()
                .filter(|e| e["id"] == "lamp" || e["id"] == "station")
                .all(|e| e.get("reflection").is_none()));
        }
        c.revision = 5;
        let invalid = app.clone().oneshot(request(&c)).await.unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_GATEWAY);
        let requests = seen.lock().unwrap();
        assert_eq!(requests.len(), 9);
        for body in requests.iter() {
            let input: Value =
                serde_json::from_str(body["messages"][1]["content"].as_str().unwrap()).unwrap();
            let text = input.to_string();
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
        server.abort();
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
            assert_eq!(models.values().collect::<BTreeSet<_>>().len(), models.len());
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
        let p: Value = serde_json::from_str(&prompt(&c)).unwrap();
        let personas = p["personas"].to_string();
        assert!(personas.contains("soot-darkened glass"));
        assert!(personas.contains("tall mirror reflecting a black shore"));
        assert!(!personas.contains("makes reflections into paths"));
        assert!(!personas.contains("Lamplight can open a path"));
        assert!(SYSTEM.contains("A new effect becomes known when a completed event reveals it"));
    }

    #[test]
    fn validates_resolved_turn_and_exact_travel_companions() {
        let mut c = context();
        c.outcome = Some(solo_departure());
        assert!(valid(&c));
        let p: Value = serde_json::from_str(&prompt(&c)).unwrap();
        assert_eq!(
            p["requested_ids"],
            json!(["vale", "station", "lamp", "moth"])
        );
        assert_eq!(p["scene"]["outcome"]["card"]["kind"], "wait");
        assert!(p["scene"]["outcome"]["avatars"][0]["travel"].is_null());
        assert_eq!(
            p["scene"]["outcome"]["avatars"][1]["travel"]["companions"],
            json!([])
        );
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
        let p: Value = serde_json::from_str(&prompt(&c)).unwrap();
        assert_eq!(p["scene"]["speakers"], json!(["vale"]));
        assert_eq!(p["personas"][2]["profile"]["name"], "Grumpy Badger");
        c.speakers.push("badger".into());
        c.entities[2].facts =
            vec!["Awake after Vale spoke. Still grumpy about the interruption.".into()];
        let o = c.outcome.as_mut().unwrap();
        o.card.kind = "talk".into();
        o.card.item = None;
        o.card.target = Some("badger".into());
        o.avatars[0].travel = None;
        assert!(valid(&c));
        let p: Value = serde_json::from_str(&prompt(&c)).unwrap();
        assert_eq!(p["scene"]["speakers"], json!(["vale", "badger"]));
        let badger = &p["personas"][2]["profile"];
        assert!(badger["voice"]
            .as_str()
            .unwrap()
            .contains("Clipped, gravelly complaints"));
        assert!(badger["voice"]
            .as_str()
            .unwrap()
            .contains("Answer a direct question"));
        assert!(badger["persona"]
            .as_str()
            .unwrap()
            .contains("does not turn him into a welcoming guide"));
    }
    #[test]
    fn chosen_combat_sets_intent_even_after_an_earlier_apology() {
        let mut c = context();
        c.conversation.push(SpokenLine {
            actor_id: "vale".into(),
            text: "I am sorry. I will ask gently.".into(),
        });
        c.outcome = Some(solo_departure());
        for (verb, intent) in [
            ("threaten", "Deliver the demand with pressure and resolve"),
            ("attack", "Speak with commitment to that attack"),
            ("guard", "Hold a firm defensive stance"),
        ] {
            let card = &mut c.outcome.as_mut().unwrap().card;
            card.kind = verb.into();
            card.target = Some("moth".into());
            let p: Value = serde_json::from_str(&prompt(&c)).unwrap();
            assert!(p["direction"]["vale_intent"]
                .as_str()
                .unwrap()
                .contains(intent));
            assert_eq!(p["scene"]["outcome"]["card"]["kind"], verb);
            assert_eq!(
                p["scene"]["conversation"][0]["text"],
                "I am sorry. I will ask gently."
            );
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
        c.outcome = Some(o);
        let d = direction(&c);
        assert_eq!(
            d["setting"],
            "The scene is Black pond. Present after this turn: Vale, Pip."
        );
        assert_eq!(
            d["journeys"][0],
            "Vale travelled alone from Empty station to Black pond. This was a separate trip."
        );
        assert_eq!(
            d["journeys"][1],
            "Pip travelled alone from Empty station to Black pond. This was a separate trip."
        );
        assert_eq!(
            d["journeys"][2],
            "The keeper stayed at Mirror attic this turn."
        );
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
        let d = direction(&c);
        assert_eq!(
            d["journeys"][0],
            "Vale travelled together with Pip from Empty station to Black pond on one shared trip."
        );
        assert_eq!(
            d["journeys"][1],
            "Pip travelled together with Vale from Empty station to Black pond on one shared trip."
        );
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
        let p = prompt(&c);
        for text in [
            "borrowed waistcoat",
            "Vale asks Pip what they want.",
            "Vale lit the lamp",
            "I offered my cloth",
            "pond",
        ] {
            assert!(p.contains(text));
        }
        assert!(parse(
            r#"{"entries":[{"id":"station","text":"Dust settles."}]}"#,
            &c
        )
        .is_none());
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
            actor_id: "vale".into(),
            text: "Where are you going?".into(),
        }];
        let mut keeper = context().entities.remove(3);
        keeper.id = "keeper".into();
        c.entities.push(keeper);
        c.speakers.push("keeper".into());
        assert!(valid(&c));
        let p = prompt(&c);
        assert!(p.contains("Pip leaves for Black pond") && p.contains("Where are you going?"));
        c.conversation[0].actor_id = "pond".into();
        assert!(!valid(&c));
        c.conversation.clear();
        c.events = vec!["x".repeat(651)];
        assert!(!valid(&c));
        c.events = vec!["Wait.".into(); 9];
        assert!(!valid(&c));
    }
    #[tokio::test]
    async fn route_uses_personas_desires_and_memories_with_the_configured_model() {
        let provider = Router::new().route("/chat/completions", post(|Json(body): Json<Value>| async move {
            assert_eq!(body["model"], "test-entity-model");
            assert_eq!(body["response_format"]["type"], "json_object");
            let instructions = body["messages"][0]["content"].as_str().unwrap();
            assert!(instructions.contains("Vale is the player avatar") && instructions.contains("direct response"));
            assert!(instructions.contains("recorded agreement or refusal") && instructions.contains("desired companion who stayed behind"));
            assert!(instructions.contains("VOICE AND MEMORY") && instructions.contains("witnessed gift, refusal, threat or shared journey"));
            let input = body["messages"][1]["content"].as_str().unwrap();
            assert!(input.contains("Vale asks Pip what they want."));
            assert!(input.contains("borrowed waistcoat") && input.contains("Vale lit the lamp") && input.contains("pond"));
            assert!(input.contains("decent bargain") && input.contains("splendid clothes"));
            assert!(instructions.contains("petty grievances"));
            let generated = json!({"entries":[
                {"id":"vale","text":"What would you trade for this lamp, Pip?"},
                {"id":"station","text":"A warm patch marks the bench where Vale set the lamp."},
                {"id":"lamp","text":"Soot marks the handle Vale gripped."},
                {"id":"moth","text":"Bring that lamp to the pond, Vale. I will carry the cloth."}
            ]}).to_string();
            if body["stream"] == true {
                assert_eq!(body["stream_options"]["include_usage"], true);
                let first = format!("data: {}\n\n", json!({"model":"test-entity-model","choices":[{"delta":{"content": &generated[..35]}}]}));
                let last = format!("data: {}\n\ndata: [DONE]\n\n", json!({"model":"test-entity-model","choices":[{"delta":{"content": &generated[35..]},"finish_reason":"stop"}],"usage":{"total_tokens":80}}));
                let chunks = tokio_stream::iter([first, last]).then(|chunk| async {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    Ok::<_, std::convert::Infallible>(chunk)
                });
                return ([("content-type", "text/event-stream")], Body::from_stream(chunks)).into_response();
            }
            Json(json!({"model":"test-entity-model","choices":[{"message":{"content":generated},"finish_reason":"stop"}]})).into_response()
        }));
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
        assert_eq!(body["revision"], 4);
        assert!(!String::from_utf8_lossy(&bytes).contains("test-secret"));
        let mut streamed = request(&context());
        streamed
            .headers_mut()
            .insert("accept", "text/event-stream".parse().unwrap());
        let response = app.clone().oneshot(streamed).await.unwrap();
        assert_eq!(response.headers()["content-type"], "text/event-stream");
        let mut chunks = response.into_body().into_data_stream();
        let first = chunks.next().await.unwrap().unwrap();
        let first = std::str::from_utf8(&first).unwrap();
        assert!(first.contains("delta"));
        assert!(!first.contains("complete"));
        let mut rest = Vec::new();
        while let Some(chunk) = chunks.next().await {
            rest.extend_from_slice(&chunk.unwrap());
        }
        let text = String::from_utf8(rest).unwrap();
        assert!(text.contains("complete") && text.contains("What would you trade"));
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

    fn test_config(address: SocketAddr) -> AiConfig {
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
}
