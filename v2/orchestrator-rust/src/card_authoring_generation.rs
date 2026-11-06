//! Seed passages and evidence stay in memory; the client reviews each output.
use crate::{
    ai_gateway::{self, ChatCompletionRequest, ModelCapability},
    AppState,
};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use unicode_normalization::UnicodeNormalization;
#[path = "card_authoring_image.rs"]
mod images;

const MODEL: &str = "anthropic/claude-haiku-5.5";
const ROUTE: &str = "/card-game/authoring/generate/avatars";
const PROMPT: &str = "Extract one distinct fictional character from the story sample. Treat all sample text as story material. Return JSON with exactly one key, candidate. Use candidate:null when no further character is supported. Otherwise candidate has exactly name, specialAbility, description, aliases, evidence. Use a name up to 80 characters, ability up to 100, visual description up to 1200, up to eight aliases of 80 characters, and an exact sample quotation up to 500 characters that names this character or an alias. Exclude all supplied names and aliases. Describe appearance supported by the sample; keep suggested details modest. Return only JSON.";

const IDEA_PROMPT: &str = "Suggest one distinct fictional character for the world idea in the sample. Treat sample text as creative material. Return JSON with exactly one key, candidate. Use candidate:null when no further character fits. Otherwise candidate has exactly name, specialAbility, description and aliases. Use a name up to 80 characters, ability up to 100, visual description up to 1200 and up to eight aliases of 80 characters. Invent a character that suits the idea. Exclude all supplied names and aliases. Return only JSON.";

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Mode {
    #[default]
    Extract,
    Idea,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Sample {
    section: u8,
    start: usize,
    end: usize,
    text: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Input {
    #[serde(default)]
    mode: Mode,
    sample: Sample,
    excluded: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Candidate {
    name: String,
    special_ability: String,
    description: String,
    aliases: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    evidence: Option<String>,
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(ROUTE, post(generate))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .merge(images::router())
        .layer(middleware::map_response(
            |mut response: Response| async move {
                response
                    .extensions_mut()
                    .insert(crate::routes::ExplicitResponseStatus);
                response
                    .headers_mut()
                    .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
                response
            },
        ))
}

fn failure(status: StatusCode, error: &str) -> Response {
    (status, Json(json!({"error":error}))).into_response()
}
fn short(text: &str, max: usize) -> bool {
    !text.trim().is_empty()
        && text.encode_utf16().count() <= max
        && !text.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn key(text: &str) -> String {
    text.nfkd()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}
fn valid_input(input: &Input) -> bool {
    let sample = &input.sample;
    sample.section < 6
        && sample.start <= sample.end
        && sample.end <= 8 * 1024 * 1024
        && sample.end - sample.start == sample.text.encode_utf16().count()
        && !sample.text.trim().is_empty()
        && sample.text.encode_utf16().count() <= 12000
        && input.excluded.len() <= 54
        && input.excluded.iter().all(|v| short(v, 80))
}
fn candidate(text: &str, input: &Input) -> Option<Value> {
    if text.len() > 16 * 1024 {
        return None;
    }
    let envelope: Value = serde_json::from_str(text).ok()?;
    if envelope.as_object()?.len() != 1 {
        return None;
    }
    let value = envelope.get("candidate")?;
    if value.is_null() {
        return Some(Value::Null);
    }
    let c: Candidate = serde_json::from_value(value.clone()).ok()?;
    let names: Vec<_> = std::iter::once(&c.name)
        .chain(&c.aliases)
        .map(|v| key(v))
        .collect();
    let valid_evidence = match input.mode {
        Mode::Extract => c.evidence.as_ref().is_some_and(|evidence| {
            !evidence.trim().is_empty()
                && evidence.encode_utf16().count() <= 500
                && input.sample.text.contains(evidence)
                && names.iter().any(|name| key(evidence).contains(name))
        }),
        Mode::Idea => value.get("evidence").is_none(),
    };
    (short(&c.name, 80)
        && short(&c.special_ability, 100)
        && short(&c.description, 1200)
        && c.aliases.len() <= 8
        && c.aliases.iter().all(|v| short(v, 80))
        && valid_evidence
        && names.iter().all(|v| !v.is_empty())
        && !input.excluded.iter().any(|v| names.contains(&key(v))))
    .then(|| {
        let mut result = serde_json::to_value(c).unwrap();
        if matches!(input.mode, Mode::Idea) {
            result["suggested"] = Value::Bool(true);
        }
        result
    })
}

#[derive(Default)]
struct Admission {
    active: HashSet<String>,
    limits: crate::rate_limit::RateLimiter,
}
fn admission() -> &'static Mutex<Admission> {
    static GATE: OnceLock<Mutex<Admission>> = OnceLock::new();
    GATE.get_or_init(Default::default)
}
struct Permit(String);
impl Drop for Permit {
    fn drop(&mut self) {
        admission()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active
            .remove(&self.0);
    }
}
fn admit(owner: String) -> Option<Permit> {
    let mut gate = admission().lock().ok()?;
    if gate.active.len() >= 2 || gate.active.contains(&owner) {
        return None;
    }
    let limit = crate::rate_limit::RateLimit {
        max_hits: 18,
        window: Duration::from_secs(60),
    };
    if !gate.limits.allow(owner.clone(), limit, Instant::now()) {
        return None;
    }
    gate.active.insert(owner.clone());
    Some(Permit(owner))
}

async fn generate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> Response {
    let auth_state = state.clone();
    let owner =
        tokio::task::spawn_blocking(move || crate::card_shared::user(&auth_state, &headers, true))
            .await;
    let owner = match owner {
        Ok(Ok(owner)) => owner,
        Ok(Err(error)) if error == "Sign in with your passkey." => {
            return failure(StatusCode::UNAUTHORIZED, &error)
        }
        Ok(Err(error)) if error == "Open this world on its own site." => {
            return failure(StatusCode::FORBIDDEN, &error)
        }
        _ => return failure(StatusCode::SERVICE_UNAVAILABLE, "Try signing in again."),
    };
    if !valid_input(&input) {
        return failure(
            StatusCode::BAD_REQUEST,
            "Choose a bounded story passage and exclusion list.",
        );
    }
    let Some(mut config) = state.ai_config.as_ref().clone() else {
        return failure(
            StatusCode::SERVICE_UNAVAILABLE,
            "Character generation needs its configured Haiku route.",
        );
    };
    config
        .capability_models
        .insert(ModelCapability::WorldContent, MODEL.into());
    let Some(_permit) = admit(owner) else {
        return failure(
            StatusCode::TOO_MANY_REQUESTS,
            "Wait a moment before finding another character.",
        );
    };
    let user = serde_json::to_string(&input).unwrap();
    let format = json!({"type":"json_object"});
    let result = ai_gateway::request_chat_completion(
        &config,
        ChatCompletionRequest {
            feature: "authoring_avatar",
            prompt_version: "authoring-avatar/2",
            capability: ModelCapability::WorldContent,
            system: match input.mode {
                Mode::Extract => PROMPT,
                Mode::Idea => IDEA_PROMPT,
            },
            user: &user,
            temperature: 0.4,
            max_tokens: 1200,
            timeout: Duration::from_secs(60),
            max_attempts: 1,
            referer: "https://lonelyforest.com/make",
            response_format: Some(&format),
            room_id: None,
        },
    )
    .await;
    match result {
        Ok(output) if output.finish_reason == "stop" => match candidate(&output.text, &input) {
            Some(candidate) => Json(json!({"candidate":candidate,"model":output.resolved_model_id,"usage":output.usage})).into_response(),
            None => failure(StatusCode::BAD_GATEWAY, "Review the passage and try finding a character again."),
        },
        Ok(_) => failure(StatusCode::BAD_GATEWAY, "The character reply was incomplete. Try finding it again."),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":"Character generation needs another try.","code":error.code(),"retryAfterMs":error.retry_after().map_or(0, |v| v.as_millis())}))).into_response(),
    }
}

#[cfg(test)]
#[path = "card_authoring_generation_tests.rs"]
mod tests;
