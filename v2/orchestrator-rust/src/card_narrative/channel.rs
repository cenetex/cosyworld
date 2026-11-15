use super::{
    bounded, complete_selected, error, profiles, seed_sentence, voice_scenes, Context, TextState,
};
use crate::ai_gateway::{
    request_chat_completion, AiConfig, ChatCompletionRequest, ModelCapability,
};
use crate::rate_limit::RateLimit;
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
use serde_json::{json, Value};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

const LIMIT: RateLimit = RateLimit {
    max_hits: 30,
    window: Duration::from_secs(60),
};
const DEFAULT_PACK: &str = "lonely-forest";
const LINE_LIMIT: usize = 240;
const SCENE_MESSAGES: usize = 6;

#[derive(Clone, Debug, PartialEq, Serialize)]
struct Resident {
    id: String,
    name: String,
    #[serde(skip)]
    place: String,
    portrait: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CastQuery {
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
struct LinesRequest {
    pack: String,
    #[serde(default)]
    addressed: Option<String>,
    messages: Vec<Message>,
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

fn pack(pack_id: &str) -> Option<&'static Value> {
    packs()["packs"]
        .as_array()?
        .iter()
        .find(|p| p["id"] == pack_id)
}

fn cast(pack_id: &str) -> Option<Vec<Resident>> {
    let residents: Vec<Resident> = pack(pack_id)?["avatars"]
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
                portrait: format!("/card-game/{portrait}"),
            })
        })
        .collect();
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
    if request.addressed.as_deref().is_some_and(|id| !member(id)) {
        return Err("addressed must be a resident of the cast");
    }
    if request
        .messages
        .last()
        .is_some_and(|m| m.resident.is_some())
    {
        return Err("the last message must be from a person");
    }
    Ok(())
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
    let taken = profiles()
        .as_object()
        .expect("profiles")
        .iter()
        .any(|(id, profile)| {
            id.to_lowercase() == lower
                || profile["name"]
                    .as_str()
                    .is_some_and(|name| name.to_lowercase() == lower)
        });
    if clean.is_empty() || taken {
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

fn forest(pack_id: &str, cast: &[Resident]) -> String {
    let name = pack(pack_id)
        .and_then(|p| p["name"].as_str())
        .unwrap_or("forest");
    let opening = match name.strip_prefix("The ") {
        Some(rest) => format!("I am the {rest}."),
        None => format!("I am the {name}."),
    };
    std::iter::once(opening)
        .chain(cast.iter().map(|r| {
            let seed = seed_sentence(&r.id);
            let seed = seed.trim_end_matches('.');
            if seed.contains(',') {
                format!("{seed}, lives in me.")
            } else {
                format!("{seed} lives in me.")
            }
        }))
        .collect::<Vec<_>>()
        .join(" ")
}

async fn pick(config: &AiConfig, cast: &[Resident], request: &LinesRequest) -> Option<String> {
    if let Some(id) = request.addressed.as_ref() {
        return cast.iter().any(|r| &r.id == id).then(|| id.clone());
    }
    let mut choices: Vec<&str> = cast.iter().map(|r| r.id.as_str()).collect();
    choices.push("none");
    let format = json!({
        "type": "json_schema",
        "json_schema": {
            "name": "discord_speaker",
            "strict": true,
            "schema": {
                "type": "object",
                "properties": {"who": {"type": "string", "enum": choices}},
                "required": ["who"],
                "additionalProperties": false
            }
        }
    });
    let system = forest(&request.pack, cast);
    let user = request
        .messages
        .iter()
        .map(|m| format!("{}: {}", speaker(m, cast), m.text))
        .collect::<Vec<_>>()
        .join("\n");
    let completion = request_chat_completion(
        config,
        ChatCompletionRequest {
            feature: "discord_intent",
            prompt_version: "discord-intent-v1",
            capability: ModelCapability::IntentJson,
            system: &system,
            user: &user,
            temperature: 0.0,
            max_tokens: 16,
            timeout: Duration::from_secs(6),
            max_attempts: 1,
            referer: crate::ai_gateway::OPENROUTER_APP_REFERER,
            response_format: Some(&format),
            room_id: None,
        },
    )
    .await;
    let completion = match completion {
        Ok(completion) => completion,
        Err(failure) => {
            tracing::info!(
                feature = "discord",
                reason = "intent",
                failure = failure.code(),
                "discord line silent"
            );
            return None;
        }
    };
    let answer: Value = serde_json::from_str(completion.text.trim()).ok()?;
    let who = answer["who"].as_str()?;
    cast.iter().any(|r| r.id == who).then(|| who.to_string())
}

fn scene(resident: &Resident, messages: &[Message]) -> Option<Context> {
    let start = messages.len().saturating_sub(SCENE_MESSAGES);
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
            {"id": &resident.id, "facts": [], "desire": null, "memories": [], "previous": null},
            {"id": &resident.place, "facts": [], "desire": null, "memories": [], "previous": null}
        ],
        "conversation": conversation
    }))
    .ok()?;
    context.acting_avatar = Some(resident.id.clone());
    Some(context)
}

async fn speak(
    state: &TextState,
    config: &AiConfig,
    resident: &Resident,
    messages: &[Message],
) -> Option<String> {
    let models = state.character_models.as_ref().as_ref().ok()?;
    let mut settings = state.settings.as_ref().as_ref().ok()?.clone();
    settings.line_limit = LINE_LIMIT;
    let context = scene(resident, messages)?;
    let voiced = vec![resident.id.clone()];
    let result = voice_scenes::run(
        "discord",
        &context,
        &voiced,
        false,
        complete_selected(config, &context, models, &settings, &voiced, false, None),
    )
    .await
    .ok()?;
    let text = result["entries"]
        .as_array()?
        .iter()
        .find(|entry| entry["id"] == resident.id.as_str())?["text"]
        .as_str()?;
    bounded(text, LINE_LIMIT).then(|| text.to_string())
}

fn admitted(state: &TextState, headers: &HeaderMap) -> Result<(), Response> {
    let token = std::env::var("COSYWORLD_BOT_TOKEN").ok();
    if !authorized(headers, token.as_deref()) {
        return Err(error(StatusCode::UNAUTHORIZED, "unauthorized"));
    }
    let allowed = state
        .limits
        .lock()
        .is_ok_and(|mut limits| limits.allow("discord".into(), LIMIT, Instant::now()));
    if !allowed {
        return Err(error(StatusCode::TOO_MANY_REQUESTS, "busy"));
    }
    Ok(())
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
    spoken(Vec::new())
}

pub(super) async fn cast_route(
    State(state): State<TextState>,
    headers: HeaderMap,
    query: Result<Query<CastQuery>, QueryRejection>,
) -> Response {
    if let Err(refused) = admitted(&state, &headers) {
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
    if let Err(refused) = admitted(&state, &headers) {
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
        return silent("unavailable");
    };
    let Ok(_permit) = state.capacity.clone().try_acquire_owned() else {
        return silent("busy");
    };
    let Some(id) = pick(config, &residents, &request).await else {
        return silent("no_speaker");
    };
    let Some(resident) = residents.iter().find(|r| r.id == id) else {
        return silent("no_speaker");
    };
    let Some(text) = speak(&state, config, resident, &request.messages).await else {
        return silent("no_line");
    };
    spoken(vec![
        json!({"id": &resident.id, "name": &resident.name, "text": text}),
    ])
}

#[cfg(test)]
mod tests {
    use super::super::conversation::SAY_ALOUD;
    use super::super::tests::{prompt_of, serve, test_config, turn_of};
    use super::super::{router_with_models, VoiceSettings};
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
        assert_eq!(residents.len(), 4);
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
        assert_eq!(find("oak").name, "Oak");
        assert!(cast("no-such-pack").is_none());
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
        assert!(check(json!([{"resident": "vale", "text": "Hi."}, human])).is_err());
        assert!(check(json!([human, rati])).is_err());
        let mut addressed = request(json!([human]));
        addressed.addressed = Some("vale".into());
        assert!(validate(&addressed, &residents).is_err());
        addressed.addressed = Some("rati".into());
        assert!(validate(&addressed, &residents).is_ok());
        assert!(serde_json::from_value::<LinesRequest>(
            json!({"pack": "lonely-forest", "messages": [human], "user": "1"})
        )
        .is_err());
    }

    #[test]
    fn people_cannot_speak_as_residents() {
        for name in ["rati", "RATi", "Skull", "  skull "] {
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
        Router::new().route(
            "/chat/completions",
            post(move |Json(body): Json<Value>| {
                let seen = seen.clone();
                async move {
                    let asks_intent = body.get("response_format").is_some();
                    seen.lock().unwrap().push(body.clone());
                    let text = if asks_intent { Some(intent) } else { voice };
                    match text {
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
        assert!(requests.iter().all(|r| r.get("response_format").is_none()));
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
            post_lines(r#"{"who":"none"}"#, Some("Hello."), TOKEN, talk(None)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": []}));
        assert_eq!(requests.len(), 1);
        let system = turn_of(&requests[0], "system");
        assert!(system.starts_with("I am the Lonely Forest."));
        assert!(system.contains("RATi, host of the cottage, lives in me."));
        assert!(turn_of(&requests[0], "user").ends_with("Jun: RATi, can I come in?"));
    }

    #[tokio::test]
    async fn an_intent_outside_the_cast_is_silence() {
        let (status, body, requests) =
            post_lines(r#"{"who":"vale"}"#, Some("Hello."), TOKEN, talk(None)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": []}));
        assert_eq!(requests.len(), 1);
    }

    #[tokio::test]
    async fn a_failed_voice_is_silence() {
        let (status, body, requests) =
            post_lines(r#"{"who":"skull"}"#, None, TOKEN, talk(None)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, json!({"lines": []}));
        assert!(requests.len() >= 2);
    }

    #[tokio::test]
    async fn a_bad_token_reaches_no_model() {
        let (status, body, requests) = post_lines(
            r#"{"who":"rati"}"#,
            Some("Hello."),
            WRONG,
            talk(Some("rati")),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({"error": "unauthorized"}));
        assert!(requests.is_empty());
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
        assert_eq!(residents.len(), 4);
        assert!(residents.contains(&json!({
            "id": "rati",
            "name": "RATi",
            "portrait": "/card-game/assets/lonely-forest/rati.png"
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
