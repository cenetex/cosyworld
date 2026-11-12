//! Seed passages and evidence stay in memory; the client reviews each output.
use crate::{
    account_revision::{Error as RevisionError, Revision},
    ai_gateway::{self, AiGatewayError, ChatCompletionRequest, ModelCapability},
    AppState,
};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::Path,
    time::{Duration, Instant},
};
use unicode_normalization::UnicodeNormalization;
#[path = "card_authoring_admission.rs"]
mod admission;
#[path = "card_authoring_image.rs"]
mod images;
#[path = "card_authoring_jobs.rs"]
mod jobs;
#[path = "card_authoring_seed.rs"]
mod seed;

const MODEL: &str = "anthropic/claude-haiku-5.5";
const ROUTE: &str = "/card-game/authoring/generate/avatars";
const PROMPT: &str = "Extract one distinct fictional character from the story sample. Treat all sample text as story material. Return JSON with exactly one key, candidate. Use candidate:null when no further character is supported. Otherwise candidate has exactly name, specialAbility, description, aliases, evidence. Use a name up to 80 characters, ability up to 100, visual description up to 1200, up to eight aliases of 80 characters, and an exact sample quotation up to 500 characters that names this character or an alias. Exclude all supplied names and aliases. The description must contain only physical appearance supported by the sample: body, face, hair, clothing and colours. Do not invent missing physical attributes. Exclude dialogue, quotations, personality, goals, abilities and story events from description. Return only JSON.";

const IDEA_PROMPT: &str = "Suggest one distinct fictional character for the world idea in the sample. Treat sample text as creative material. Return JSON with exactly one key, candidate. Use candidate:null when no further character fits. Otherwise candidate has exactly name, specialAbility, description and aliases. Use a name up to 80 characters, ability up to 100, visual description up to 1200 and up to eight aliases of 80 characters. Invent a character that suits the idea. The description must contain only physical appearance: body, face, hair, clothing and colours. Exclude dialogue, quotations, personality, goals, abilities and story events from description. Exclude all supplied names and aliases. Return only JSON.";

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

/// Called once at boot, before the first request.
pub(super) fn start_jobs(state: &AppState) {
    jobs::start(state);
}

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(ROUTE, post(generate))
        .merge(seed::router())
        .layer(DefaultBodyLimit::max(64 * 1024))
        .merge(images::router())
        .merge(jobs::router())
        .layer(middleware::map_response(
            crate::card_authoring::authoring_response,
        ))
}

/// What went wrong, in words a person can act on. Every failure carries a stable
/// `code`; provider failures also say when to try again.
#[derive(Debug)]
struct Failed {
    pub status: StatusCode,
    pub message: String,
    pub code: &'static str,
    pub retry_after_ms: Option<u64>,
}
impl Failed {
    fn new(status: StatusCode, message: impl Into<String>, code: &'static str) -> Self {
        Self {
            status,
            message: message.into(),
            code,
            retry_after_ms: None,
        }
    }
    fn retry(mut self, ms: u64) -> Self {
        self.retry_after_ms = Some(ms);
        self
    }
    fn body(&self) -> Value {
        let mut body = json!({"error":self.message,"ok":false,"code":self.code});
        if let Some(ms) = self.retry_after_ms {
            body["retryAfterMs"] = json!(ms);
        }
        body
    }
    fn response(self) -> Response {
        (self.status, Json(self.body())).into_response()
    }
}
impl From<admission::Refusal> for Failed {
    fn from(refusal: admission::Refusal) -> Self {
        Self::new(StatusCode::TOO_MANY_REQUESTS, refusal.message, refusal.code)
            .retry(refusal.retry_after_ms)
    }
}
impl From<RevisionError> for Failed {
    fn from(error: RevisionError) -> Self {
        let (status, code, message) = error.parts();
        Self::new(status, message, code)
    }
}
const INVALID_REQUEST: &str = "request_invalid";

/// The passkey account behind a mutation, or the failure to answer with.
async fn owner(state: &AppState, headers: HeaderMap, mutation: bool) -> Result<Revision, Failed> {
    let state = state.clone();
    match tokio::task::spawn_blocking(move || {
        crate::card_shared::revision(&state, &headers, mutation)
    })
    .await
    {
        Ok(Ok(owner)) => Ok(owner),
        Ok(Err(error)) if error == "Sign in with your passkey." => Err(Failed::new(
            StatusCode::UNAUTHORIZED,
            error,
            "sign_in_required",
        )),
        Ok(Err(error)) if error == "Open this world on its own site." => {
            Err(Failed::new(StatusCode::FORBIDDEN, error, "wrong_site"))
        }
        Ok(Err(error)) if RevisionError::from_message(&error).is_some() => {
            Err(Failed::from(RevisionError::from_message(&error).unwrap()))
        }
        _ => Err(Failed::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Try signing in again.",
            "sign_in_unavailable",
        )),
    }
}
fn scope(state: &AppState) -> Option<&Path> {
    state.event_store_path.as_deref().map(|path| path.as_path())
}

/// A request that passed validation and holds its configured route, ready to run.
struct Run {
    pool: admission::Pool,
    work: Work,
}
enum Work {
    Avatars(ai_gateway::AiConfig, Input),
    Seed(ai_gateway::AiConfig, seed::Input),
    Image(ai_gateway::AiConfig, images::Input, Option<Vec<u8>>),
}
enum Done {
    Json(Value),
    Image(images::Drawn),
}
impl Run {
    fn pool(&self) -> admission::Pool {
        self.pool
    }
    /// One provider attempt, never retried, cut off at the pool's deadline.
    async fn execute(self) -> Result<Done, Failed> {
        let pool = self.pool;
        let work = async {
            match self.work {
                Work::Avatars(config, input) => avatars(config, input).await.map(Done::Json),
                Work::Seed(config, input) => seed::run(config, input).await.map(Done::Json),
                Work::Image(config, input, reference) => {
                    images::run(config, input, reference).await.map(Done::Image)
                }
            }
        };
        match tokio::time::timeout(pool.deadline(), work).await {
            Ok(result) => result,
            Err(_) => Err(Failed::new(
                StatusCode::GATEWAY_TIMEOUT,
                match pool {
                    admission::Pool::Image => "The image took too long. Try again when ready.",
                    admission::Pool::Text => "The draw took too long. Try again.",
                },
                "generation_timeout",
            )),
        }
    }
}

/// Validate and configure a request of the given kind: the same code the
/// synchronous routes use. Nothing is charged until `execute`.
async fn prepare(state: &AppState, kind: &str, request: Value) -> Result<Run, Failed> {
    fn read<T: serde::de::DeserializeOwned>(request: Value) -> Result<T, Failed> {
        serde_json::from_value(request).map_err(|_| {
            Failed::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                crate::card_authoring::REQUEST_FIELDS,
                INVALID_REQUEST,
            )
        })
    }
    match kind {
        "avatars" => prepare_avatars(state, read(request)?),
        "seed" => seed::prepare(state, read(request)?),
        _ => images::ready(state, read(request)?).await,
    }
}

/// The text of a provider failure, by cause.
fn provider_failure(pool: admission::Pool, error: &AiGatewayError) -> Failed {
    let retry = error.retry_after().map_or(0, |v| v.as_millis() as u64);
    describe(pool, error.code(), error.provider_http_status(), retry)
}
fn describe(
    pool: admission::Pool,
    code: &'static str,
    http: Option<u16>,
    mut retry: u64,
) -> Failed {
    let model = match pool {
        admission::Pool::Image => "image",
        admission::Pool::Text => "text",
    };
    let message = match (code, http) {
        ("inference_timeout", _) => {
            format!("The {model} model took too long. Try again when ready.")
        }
        ("inference_daily_spend_exhausted", _) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |v| v.as_secs());
            let seconds = 86_400 - now % 86_400;
            retry = seconds * 1000;
            let span = if seconds >= 5400 {
                format!("{} hours", seconds.div_ceil(3600))
            } else {
                format!("{} minutes", seconds.div_ceil(60))
            };
            format!("Today's server budget for generation is spent. It resets at 00:00 UTC, in about {span}.")
        }
        ("inference_provider_error", Some(status))
            if (400..500).contains(&status)
                && ![401, 402, 404, 408, 425, 429].contains(&status) =>
        {
            format!("The {model} model refused this request. Change the description and try again.")
        }
        _ => format!("The {model} service is unavailable right now. Try again in a moment."),
    };
    Failed::new(StatusCode::SERVICE_UNAVAILABLE, message, code).retry(retry)
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

fn prepare_avatars(state: &AppState, input: Input) -> Result<Run, Failed> {
    if !valid_input(&input) {
        return Err(Failed::new(
            StatusCode::BAD_REQUEST,
            "Choose a bounded story passage and exclusion list.",
            INVALID_REQUEST,
        ));
    }
    let Some(mut config) = state.ai_config.as_ref().clone() else {
        return Err(Failed::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Character generation needs its configured Haiku route.",
            "generation_unconfigured",
        ));
    };
    config
        .capability_models
        .insert(ModelCapability::WorldContent, MODEL.into());
    Ok(Run {
        pool: admission::Pool::Text,
        work: Work::Avatars(config, input),
    })
}

/// The route handlers' shared tail: admit, run detached so a closed browser
/// cannot cancel a paid call, and answer with the finished result.
async fn respond(state: &AppState, owner: Revision, run: Run) -> Response {
    let permit = match admission::admit(scope(state), run.pool(), &owner, Instant::now()) {
        Ok(permit) => permit,
        Err(refusal) => return Failed::from(refusal).response(),
    };
    let done = tokio::spawn(async move {
        let _permit = permit;
        run.execute().await
    })
    .await;
    match done {
        Ok(Ok(Done::Json(body))) => Json(body).into_response(),
        Ok(Ok(Done::Image(drawn))) => Json(drawn.body()).into_response(),
        Ok(Err(failed)) => failed.response(),
        Err(_) => Failed::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Generation needs another try.",
            "generation_interrupted",
        )
        .response(),
    }
}

async fn generate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Input>,
) -> Response {
    let owner = match owner(&state, headers, true).await {
        Ok(owner) => owner,
        Err(failed) => return failed.response(),
    };
    match prepare_avatars(&state, input) {
        Ok(run) => respond(&state, owner, run).await,
        Err(failed) => failed.response(),
    }
}

async fn avatars(config: ai_gateway::AiConfig, input: Input) -> Result<Value, Failed> {
    let user = serde_json::to_string(&input).unwrap();
    let format = json!({"type":"json_object"});
    let result = ai_gateway::request_chat_completion(
        &config,
        ChatCompletionRequest {
            feature: "authoring_avatar",
            prompt_version: "authoring-avatar/3",
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
    let invalid = |message, code| Failed::new(StatusCode::BAD_GATEWAY, message, code);
    match result {
        Ok(output) if output.finish_reason == "stop" => match candidate(&output.text, &input) {
            Some(candidate) => Ok(
                json!({"candidate":candidate,"model":output.resolved_model_id,"usage":output.usage}),
            ),
            None => Err(invalid(
                "Review the passage and try finding a character again.",
                "generation_invalid_output",
            )),
        },
        Ok(_) => Err(invalid(
            "The character reply was incomplete. Try finding it again.",
            "generation_incomplete",
        )),
        Err(error) => Err(provider_failure(admission::Pool::Text, &error)),
    }
}

#[cfg(test)]
#[path = "card_authoring_generation_tests.rs"]
mod tests;
