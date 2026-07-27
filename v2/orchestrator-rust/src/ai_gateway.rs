use super::{
    compact_whitespace, AppState, GeneratedPathwayState, GeneratedWaypointState,
    GenerationProvenance, LocationMeta, NaturalPotentialPolicy, PATHWAY_CONTENT_FEATURE,
    PATHWAY_CONTENT_PROMPT_VERSION,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    time::Duration,
};
use tokio::time::{sleep, Instant};

pub(crate) const DEFAULT_OPENROUTER_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const DEFAULT_OPENAI_CHAT_MODEL: &str = "openai/gpt-5.6-luna";
pub(crate) const GENERATION_DEFAULT_MODE_ENV: &str = "COSYWORLD_GENERATION_DEFAULT_MODE";
pub(crate) const GENERATION_FEATURE_MODES_ENV: &str = "COSYWORLD_GENERATION_FEATURE_MODES_JSON";
const IMAGE_POLICY_MAX_TOKENS: u32 = 2_048;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum GenerationMode {
    #[default]
    Off,
    Shadow,
    AutoBounded,
}

impl GenerationMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "off" => Ok(Self::Off),
            "shadow" => Ok(Self::Shadow),
            "auto" | "auto_bounded" => Ok(Self::AutoBounded),
            _ => Err(format!(
                "generation mode must be off, shadow, or auto_bounded; got {value:?}"
            )),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Shadow => "shadow",
            Self::AutoBounded => "auto_bounded",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct GenerationControls {
    default_mode: GenerationMode,
    feature_modes: BTreeMap<String, GenerationMode>,
}

impl GenerationControls {
    pub(crate) fn from_env() -> Result<Self, String> {
        let default_mode = std::env::var(GENERATION_DEFAULT_MODE_ENV).ok();
        let feature_modes = std::env::var(GENERATION_FEATURE_MODES_ENV).ok();
        Self::from_values(default_mode.as_deref(), feature_modes.as_deref())
    }

    pub(crate) fn from_values(
        default_mode: Option<&str>,
        feature_modes_json: Option<&str>,
    ) -> Result<Self, String> {
        let default_mode = default_mode
            .map(GenerationMode::parse)
            .transpose()?
            .unwrap_or_default();
        let raw_modes = match feature_modes_json.map(str::trim) {
            None | Some("") => BTreeMap::new(),
            Some(value) => serde_json::from_str::<BTreeMap<String, String>>(value)
                .map_err(|error| format!("{GENERATION_FEATURE_MODES_ENV} must be a JSON object of feature-to-mode strings: {error}"))?,
        };
        let mut feature_modes = BTreeMap::new();
        for (feature, mode) in raw_modes {
            if feature.is_empty()
                || feature.len() > 64
                || !feature.chars().all(|character| {
                    character.is_ascii_lowercase()
                        || character.is_ascii_digit()
                        || "_.-".contains(character)
                })
            {
                return Err(format!("invalid generation feature id {feature:?}"));
            }
            feature_modes.insert(feature, GenerationMode::parse(&mode)?);
        }
        Ok(Self {
            default_mode,
            feature_modes,
        })
    }

    pub(crate) fn default_mode(&self) -> GenerationMode {
        self.default_mode
    }

    pub(crate) fn mode(&self, feature: &str) -> GenerationMode {
        self.feature_modes
            .get(feature)
            .copied()
            .unwrap_or(self.default_mode)
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct AiConfig {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) vision_model: String,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) vision_reasoning_effort: Option<String>,
}

impl AiConfig {
    pub(crate) fn from_env() -> Option<Self> {
        let api_key = std::env::var("COSYWORLD_AI_API_KEY")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
            .or_else(|| std::env::var("OPENAI_API_KEY").ok())
            .filter(|key| !key.trim().is_empty());

        let using_openrouter = std::env::var("OPENROUTER_API_KEY").is_ok()
            || std::env::var("COSYWORLD_AI_PROVIDER")
                .map(|provider| provider.eq_ignore_ascii_case("openrouter"))
                .unwrap_or(false);
        let base_url = std::env::var("COSYWORLD_AI_BASE_URL").unwrap_or_else(|_| {
            if using_openrouter {
                "https://openrouter.ai/api/v1".to_string()
            } else {
                "https://api.openai.com/v1".to_string()
            }
        });
        let base_url = base_url.trim_end_matches('/').to_string();
        let api_key = match api_key {
            Some(key) => key,
            None if local_ai_base_url(&base_url) => "local-ai".to_string(),
            None => return None,
        };
        let model = std::env::var("COSYWORLD_AI_MODEL")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_CHAT_MODEL").ok())
            .or_else(|| std::env::var("OPENAI_MODEL").ok())
            .unwrap_or_else(|| {
                if using_openrouter {
                    DEFAULT_OPENROUTER_CHAT_MODEL.to_string()
                } else {
                    DEFAULT_OPENAI_CHAT_MODEL.to_string()
                }
            });
        let vision_model = std::env::var("COSYWORLD_AI_VISION_MODEL")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_VISION_MODEL").ok())
            .or_else(|| std::env::var("OPENAI_VISION_MODEL").ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| model.clone());
        let reasoning_effort = using_openrouter
            .then(|| std::env::var("OPENROUTER_REASONING_EFFORT").ok())
            .flatten()
            .map(|effort| effort.trim().to_ascii_lowercase())
            .filter(|effort| !effort.is_empty());
        let vision_reasoning_effort = std::env::var("COSYWORLD_AI_VISION_REASONING_EFFORT")
            .ok()
            .or_else(|| std::env::var("OPENROUTER_VISION_REASONING_EFFORT").ok())
            .or_else(|| std::env::var("OPENAI_VISION_REASONING_EFFORT").ok())
            .map(|effort| effort.trim().to_ascii_lowercase())
            .filter(|effort| !effort.is_empty())
            .or_else(|| reasoning_effort.clone());

        Some(Self {
            api_key,
            base_url,
            model,
            vision_model,
            reasoning_effort,
            vision_reasoning_effort,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AiFailureKind {
    Unconfigured,
    Client,
    Timeout,
    Transport,
    Provider,
    InvalidResponse,
}

impl AiFailureKind {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Unconfigured => "inference_unconfigured",
            Self::Client => "inference_client_error",
            Self::Timeout => "inference_timeout",
            Self::Transport => "inference_transport_error",
            Self::Provider => "inference_provider_error",
            Self::InvalidResponse => "inference_invalid_response",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AiGatewayError {
    kind: AiFailureKind,
    message: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
}

impl AiGatewayError {
    pub(crate) fn unconfigured(feature: &str) -> Self {
        Self {
            kind: AiFailureKind::Unconfigured,
            message: format!("AI {feature} inference is not configured"),
            attempts: 0,
            latency: Duration::ZERO,
        }
    }

    pub(crate) fn invalid_response(message: impl Into<String>) -> Self {
        Self {
            kind: AiFailureKind::InvalidResponse,
            message: message.into(),
            attempts: 1,
            latency: Duration::ZERO,
        }
    }

    pub(crate) fn code(&self) -> &'static str {
        self.kind.code()
    }
}

impl fmt::Display for AiGatewayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} (code={}, attempts={}, latency_ms={})",
            self.message,
            self.code(),
            self.attempts,
            self.latency.as_millis()
        )
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ChatCompletionRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) system: &'a str,
    pub(crate) user: &'a str,
    pub(crate) temperature: f64,
    pub(crate) max_tokens: u32,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
    pub(crate) response_format: Option<&'a Value>,
}

#[derive(Clone, Debug)]
pub(crate) struct AiCompletion {
    pub(crate) text: String,
    pub(crate) attempts: u8,
    pub(crate) latency: Duration,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ImagePolicyRequest<'a> {
    pub(crate) feature: &'static str,
    pub(crate) image_url: &'a str,
    pub(crate) policy: &'a str,
    pub(crate) timeout: Duration,
    pub(crate) max_attempts: u8,
    pub(crate) referer: &'a str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ImagePolicyDecision {
    pub(crate) allowed: bool,
    pub(crate) violations: Vec<String>,
    pub(crate) summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImagePolicyDecision {
    allowed: bool,
    violations: Vec<String>,
    summary: String,
}

pub(crate) async fn request_chat_completion(
    config: &AiConfig,
    request: ChatCompletionRequest<'_>,
) -> Result<AiCompletion, AiGatewayError> {
    request_completion(
        config,
        request.feature,
        request.system,
        Value::String(request.user.to_string()),
        Some(request.temperature),
        request.max_tokens,
        request.timeout,
        request.max_attempts,
        request.referer,
        request.response_format,
        &config.model,
        config.reasoning_effort.as_deref(),
    )
    .await
}

pub(crate) async fn request_image_policy_decision(
    config: &AiConfig,
    request: ImagePolicyRequest<'_>,
) -> Result<ImagePolicyDecision, AiGatewayError> {
    let response_format = json!({
        "type": "json_schema",
        "json_schema": {
            "name": "cosyworld_image_policy",
            "strict": true,
            "schema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "allowed": { "type": "boolean" },
                    "violations": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "person",
                                "character",
                                "creature",
                                "text",
                                "logo",
                                "watermark"
                            ]
                        }
                    },
                    "summary": { "type": "string", "maxLength": 240 }
                },
                "required": ["allowed", "violations", "summary"]
            }
        }
    });
    let user_content = json!([
        {
            "type": "text",
            "text": format!(
                "Review this generated image against the following publication policy. Reject only clearly visible listed violations; do not invent a catch-all violation or infer one from style alone. Policy: {}",
                request.policy
            )
        },
        {
            "type": "image_url",
            "image_url": { "url": request.image_url }
        }
    ]);
    let completion = request_completion(
        config,
        request.feature,
        "You are a strict image publication gate. Inspect only visible pixels. Return the required JSON and no prose.",
        user_content,
        None,
        IMAGE_POLICY_MAX_TOKENS,
        request.timeout,
        request.max_attempts,
        request.referer,
        Some(&response_format),
        &config.vision_model,
        config.vision_reasoning_effort.as_deref(),
    )
    .await?;
    parse_image_policy_decision(&completion.text).map_err(|message| AiGatewayError {
        kind: AiFailureKind::InvalidResponse,
        message,
        attempts: completion.attempts,
        latency: completion.latency,
    })
}

fn parse_image_policy_decision(value: &str) -> Result<ImagePolicyDecision, String> {
    let raw: RawImagePolicyDecision = serde_json::from_str(value.trim())
        .map_err(|error| format!("image policy response was not valid strict JSON: {error}"))?;
    let summary = raw.summary.split_whitespace().collect::<Vec<_>>().join(" ");
    if summary.is_empty()
        || summary.chars().count() > 240
        || summary
            .chars()
            .any(|character| character.is_control() && !character.is_whitespace())
    {
        return Err("image policy response had an invalid summary".to_string());
    }
    const ALLOWED_VIOLATIONS: &[&str] = &[
        "person",
        "character",
        "creature",
        "text",
        "logo",
        "watermark",
    ];
    if raw
        .violations
        .iter()
        .any(|violation| !ALLOWED_VIOLATIONS.contains(&violation.as_str()))
    {
        return Err("image policy response named an unknown violation".to_string());
    }
    if raw.allowed != raw.violations.is_empty() {
        return Err("image policy response contradicted its violation list".to_string());
    }
    Ok(ImagePolicyDecision {
        allowed: raw.allowed,
        violations: raw.violations,
        summary,
    })
}

#[allow(clippy::too_many_arguments)]
async fn request_completion(
    config: &AiConfig,
    feature: &'static str,
    system: &str,
    user_content: Value,
    temperature: Option<f64>,
    max_tokens: u32,
    timeout: Duration,
    max_attempts: u8,
    referer: &str,
    response_format: Option<&Value>,
    model: &str,
    reasoning_effort: Option<&str>,
) -> Result<AiCompletion, AiGatewayError> {
    let started_at = Instant::now();
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| AiGatewayError {
            kind: AiFailureKind::Client,
            message: format!("{feature} client setup failed: {error}"),
            attempts: 0,
            latency: started_at.elapsed(),
        })?;
    let url = format!("{}/chat/completions", config.base_url);
    let max_attempts = max_attempts.max(1);

    for attempt in 1..=max_attempts {
        let mut payload = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user_content }
            ],
            "max_tokens": max_tokens
        });
        if let Some(temperature) = temperature {
            payload["temperature"] = json!(temperature);
        }
        if let Some(response_format) = response_format {
            payload["response_format"] = response_format.clone();
            if response_format.get("type").and_then(Value::as_str) == Some("json_schema")
                && config.base_url.contains("openrouter.ai")
            {
                payload["provider"] = json!({ "require_parameters": true });
            }
        }
        if let Some(reasoning_effort) = reasoning_effort {
            payload["reasoning"] = json!({ "effort": reasoning_effort });
        }
        let response = client
            .post(&url)
            .bearer_auth(&config.api_key)
            .header("HTTP-Referer", referer)
            .header("X-OpenRouter-Title", "CosyWorld v2")
            .header("X-Title", "CosyWorld v2")
            .json(&payload)
            .send()
            .await;

        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let kind = if error.is_timeout() {
                    AiFailureKind::Timeout
                } else {
                    AiFailureKind::Transport
                };
                let retryable = error.is_timeout() || error.is_connect();
                if retryable && attempt < max_attempts {
                    sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(AiGatewayError {
                    kind,
                    message: format!("{feature} request failed: {error}"),
                    attempts: attempt,
                    latency: started_at.elapsed(),
                });
            }
        };

        let status = response.status();
        if !status.is_success() {
            let retryable = status.as_u16() == 429 || status.is_server_error();
            if retryable && attempt < max_attempts {
                sleep(retry_delay(attempt)).await;
                continue;
            }
            let detail = provider_error_detail(response).await;
            return Err(AiGatewayError {
                kind: AiFailureKind::Provider,
                message: format!(
                    "{feature} provider returned HTTP {status}{}",
                    detail
                        .as_deref()
                        .map(|detail| format!(": {detail}"))
                        .unwrap_or_default()
                ),
                attempts: attempt,
                latency: started_at.elapsed(),
            });
        }

        let body: serde_json::Value = response.json().await.map_err(|error| AiGatewayError {
            kind: AiFailureKind::InvalidResponse,
            message: format!("{feature} response was not valid JSON: {error}"),
            attempts: attempt,
            latency: started_at.elapsed(),
        })?;
        let text = body
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(|content| content.as_str())
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| AiGatewayError {
                kind: AiFailureKind::InvalidResponse,
                message: format!("{feature} response did not include message content"),
                attempts: attempt,
                latency: started_at.elapsed(),
            })?;

        tracing::info!(
            feature,
            provider = ai_provider_name(Some(config)),
            model,
            attempts = attempt,
            latency_ms = started_at.elapsed().as_millis() as u64,
            "CosyWorld AI inference completed"
        );
        return Ok(AiCompletion {
            text,
            attempts: attempt,
            latency: started_at.elapsed(),
        });
    }

    unreachable!("the bounded AI attempt loop always returns")
}

async fn provider_error_detail(response: reqwest::Response) -> Option<String> {
    if response
        .content_length()
        .is_some_and(|length| length > 64 * 1024)
    {
        return Some("provider error body exceeded the diagnostic limit".to_string());
    }
    let body = response.text().await.ok()?;
    let value = serde_json::from_str::<Value>(&body).ok()?;
    let message = value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/error/code").and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))?;
    let summary = message
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|character| !character.is_control())
        .take(320)
        .collect::<String>();
    if summary.is_empty() {
        None
    } else if summary.contains("data:image") || summary.contains("Bearer ") {
        Some("provider rejected the request; sensitive echoed input was redacted".to_string())
    } else {
        Some(summary)
    }
}

fn retry_delay(attempt: u8) -> Duration {
    Duration::from_millis(150 * u64::from(attempt))
}

pub(crate) fn local_ai_base_url(base_url: &str) -> bool {
    base_url.starts_with("http://127.0.0.1:")
        || base_url.starts_with("http://localhost:")
        || base_url.starts_with("http://[::1]:")
}

pub(crate) fn ai_provider_name(config: Option<&AiConfig>) -> &'static str {
    let Some(config) = config else {
        return "unconfigured";
    };
    if config.base_url.contains("openrouter.ai") {
        "openrouter"
    } else if config.base_url.contains("api.openai.com") {
        "openai"
    } else {
        "openai_compatible"
    }
}

pub(crate) fn ai_model_name(config: Option<&AiConfig>) -> String {
    config
        .map(|config| config.model.clone())
        .unwrap_or_else(|| "none".to_string())
}

pub(super) struct PathwayContentPromptContext {
    pub(super) prompt: String,
    pub(super) origin_name: String,
    pub(super) destination_name: String,
    pub(super) occupied_names: BTreeSet<String>,
}

fn ecosystem_labels(meta: &LocationMeta) -> Vec<&'static str> {
    meta.natural_potentials
        .iter()
        .filter(|potential| potential.policy != NaturalPotentialPolicy::Impossible)
        .map(|potential| potential.resource_kind.label())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn ecosystem_label_subset<'a>(labels: &'a [&'static str], accepted: &[&str]) -> Vec<&'a str> {
    labels
        .iter()
        .copied()
        .filter(|label| accepted.iter().any(|needle| label.contains(needle)))
        .collect()
}

fn pathway_ecosystem_context(meta: &LocationMeta) -> String {
    let environment = serde_json::to_value(&meta.environment).unwrap_or_else(|_| json!({}));
    let list = |key: &str| {
        environment
            .get(key)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "none authored".to_string())
    };
    let labels = ecosystem_labels(meta);
    let vegetation = ecosystem_label_subset(&labels, &["woodland", "herb", "soil"]);
    let fauna = ecosystem_label_subset(&labels, &["fish"]);
    let joined_or_none = |values: &[&str]| {
        if values.is_empty() {
            "none authored".to_string()
        } else {
            values.join(", ")
        }
    };
    format!(
        "biome: {biome}; terrain: {terrain}; climate: {climate}; landforms: {landforms}; geology: {geology}; hydrology: {hydrology}; vegetation cues: {vegetation}; fauna cues: {fauna}; ecosystem/resource cues: {ecosystem}",
        biome = meta.biome,
        terrain = if meta.terrain.is_empty() {
            "none authored".to_string()
        } else {
            meta.terrain.join(", ")
        },
        climate = environment
            .get("climate")
            .and_then(Value::as_str)
            .unwrap_or("unknown"),
        landforms = list("landforms"),
        geology = list("geology"),
        hydrology = list("hydrology"),
        vegetation = joined_or_none(&vegetation),
        fauna = joined_or_none(&fauna),
        ecosystem = joined_or_none(&labels),
    )
}

struct PathwayRoutePromptContext<'a> {
    route_id: &'a str,
    route_version: u64,
    origin_name: &'a str,
    destination_name: &'a str,
    direction: &'a str,
    origin_meta: &'a LocationMeta,
    destination_meta: &'a LocationMeta,
}

fn generated_pathway_content_prompt(
    pathway: &GeneratedPathwayState,
    route: &PathwayRoutePromptContext<'_>,
) -> String {
    let waypoint_context = pathway
        .waypoints
        .iter()
        .enumerate()
        .map(|(index, waypoint)| {
            format!(
                "{step}. segment index/count: {step}/{segments}; fallback name: {fallback}; {ecology}",
                step = index + 1,
                segments = pathway.distance.max(1),
                fallback = waypoint.name,
                ecology = pathway_ecosystem_context(&waypoint.meta),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Create {count} distinct hidden waypoint identities for successive segments of one cozy storybook route. They are generated together now but players encounter them one at a time through Scout.\nCanonical route ID: {route_id}\nCanonical route version: {route_version}\nRoute endpoints: origin {origin_name}; destination {destination_name}\nTravel direction: {direction}, from {origin_name} toward {destination_name}.\nNearby authored origin description: {origin_description}\nNearby authored origin persona: {origin_persona}\nOrigin ecology: {origin_ecology}\nNearby authored destination description: {destination_description}\nNearby authored destination persona: {destination_persona}\nDestination ecology: {destination_ecology}\n{waypoint_context}\nFor each waypoint return: name (evocative proper place name, 2-5 words); title (1-6 words); description (one concrete physical sentence); persona (one sentence describing how the place behaves, never dialogue); visual_detail (physical landscape details only). Preserve order. Ground every field in the supplied direction, endpoint descriptions, biome, terrain, climate, hydrology, vegetation, fauna, and ecosystem cues. You may name and describe a waypoint, but you must not choose or change topology, route identity, endpoints, directionality, ownership, route version, segment count, access, or rules. Do not introduce named people, items, quests, rewards, danger outcomes, magic powers, or unsupported ecological facts. Names must use only ASCII letters, spaces, hyphens, or apostrophes, and must not use numbers, Pathway, Segment, either route endpoint, or duplicates.",
        count = pathway.waypoints.len(),
        route_id = route.route_id,
        route_version = route.route_version,
        direction = route.direction,
        origin_name = route.origin_name,
        destination_name = route.destination_name,
        origin_description = route.origin_meta.description,
        origin_persona = route.origin_meta.persona,
        origin_ecology = pathway_ecosystem_context(route.origin_meta),
        destination_description = route.destination_meta.description,
        destination_persona = route.destination_meta.persona,
        destination_ecology = pathway_ecosystem_context(route.destination_meta),
    )
}

pub(super) async fn pathway_content_generation_context(
    state: &AppState,
    pathway: &GeneratedPathwayState,
) -> PathwayContentPromptContext {
    let runtime = state.inner.lock().await;
    let origin_name = runtime
        .location_name(pathway.origin_location_id)
        .unwrap_or_else(|| "one known place".to_string());
    let destination_name = runtime
        .location_name(pathway.destination_location_id)
        .unwrap_or_else(|| "another known place".to_string());
    let direction = runtime
        .exit_direction(pathway.origin_location_id, pathway.destination_location_id)
        .unwrap_or_else(|| "endpoint-to-endpoint".to_string());
    let origin_meta = runtime.location_meta_for(pathway.origin_location_id);
    let destination_meta = runtime.location_meta_for(pathway.destination_location_id);
    let occupied_names = runtime
        .generated_pathways
        .values()
        .filter(|existing| existing.id != pathway.id)
        .flat_map(|existing| existing.waypoints.iter())
        .map(|waypoint| waypoint.name.to_ascii_lowercase())
        .chain(
            runtime
                .locations
                .iter()
                .filter(|(location_id, _)| {
                    !pathway
                        .waypoints
                        .iter()
                        .any(|waypoint| waypoint.id == **location_id)
                })
                .map(|(_, name)| name.to_ascii_lowercase()),
        )
        .collect();
    let route_id = if pathway.source_route_id.is_empty() {
        pathway.id.as_str()
    } else {
        pathway.source_route_id.as_str()
    };
    let route_version = pathway.source_route_version.max(1);
    let prompt = generated_pathway_content_prompt(
        pathway,
        &PathwayRoutePromptContext {
            route_id,
            route_version,
            origin_name: &origin_name,
            destination_name: &destination_name,
            direction: &direction,
            origin_meta: &origin_meta,
            destination_meta: &destination_meta,
        },
    );
    PathwayContentPromptContext {
        prompt,
        origin_name,
        destination_name,
        occupied_names,
    }
}

pub(super) fn sanitize_generated_pathway_name(value: &str) -> Option<String> {
    let name = compact_whitespace(value.trim().trim_matches('"'));
    let word_count = name.split_whitespace().count();
    let char_count = name.chars().count();
    let lower = name.to_ascii_lowercase();
    if !(2..=5).contains(&word_count)
        || !(4..=40).contains(&char_count)
        || lower.contains("pathway")
        || lower.contains("stretch")
        || generated_label_contains_authority_language(&lower)
        || !name
            .chars()
            .all(|character| character.is_ascii_alphabetic() || " -'".contains(character))
    {
        return None;
    }
    Some(name)
}

fn generated_label_contains_authority_language(value: &str) -> bool {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|token| {
            matches!(
                token,
                "access"
                    | "award"
                    | "awards"
                    | "clock"
                    | "damage"
                    | "health"
                    | "inventory"
                    | "item"
                    | "items"
                    | "orb"
                    | "orbs"
                    | "quest"
                    | "quests"
                    | "reward"
                    | "rewards"
                    | "unlock"
                    | "unlocks"
                    | "wallet"
            )
        })
}

fn sanitize_generated_content_text(
    value: &str,
    min_chars: usize,
    max_chars: usize,
) -> Option<String> {
    let text = compact_whitespace(value.trim().trim_matches('"'));
    let char_count = text.chars().count();
    let lowered = format!(" {} ", text.to_ascii_lowercase());
    if !(min_chars..=max_chars).contains(&char_count)
        || text.chars().any(char::is_control)
        || text.chars().any(|character| "{}<>\"".contains(character))
        || [
            " http://",
            " https://",
            " ignore previous",
            " system prompt",
            " developer message",
            " assistant message",
            " ai model",
            " policy",
            " wallet",
            " orb ",
            " orbs ",
            " item ",
            " items ",
            " inventory ",
            " reward",
            " award",
            " damage",
            " health ",
            " hit point",
            " level up",
            " grants ",
            " gives you ",
            " unlock",
            " access gate",
            " allows entry",
            " opens access",
            " locked until",
            " quest",
            " clock",
        ]
        .iter()
        .any(|needle| lowered.contains(needle))
    {
        return None;
    }
    Some(text)
}

pub(super) fn sanitize_generated_pathway_title(value: &str) -> Option<String> {
    let title = compact_whitespace(value.trim().trim_matches('"'));
    let word_count = title.split_whitespace().count();
    if !(1..=6).contains(&word_count)
        || !(4..=48).contains(&title.chars().count())
        || title.to_ascii_lowercase().contains("pathway to")
        || generated_label_contains_authority_language(&title.to_ascii_lowercase())
        || !title
            .chars()
            .all(|character| character.is_ascii_alphabetic() || " -'".contains(character))
    {
        return None;
    }
    Some(title)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct GeneratedWaypointContentProposal {
    pub(super) name: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) persona: String,
    pub(super) visual_detail: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GeneratedPathwayContentProposal {
    waypoints: Vec<GeneratedWaypointContentProposal>,
}

pub(super) fn parse_generated_pathway_content(
    text: &str,
    expected: usize,
) -> Option<Vec<GeneratedWaypointContentProposal>> {
    let cleaned = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let json_text = if cleaned.starts_with('{') {
        cleaned
    } else {
        let start = cleaned.find('{')?;
        let end = cleaned.rfind('}')?;
        cleaned.get(start..=end)?
    };
    let proposal: GeneratedPathwayContentProposal = serde_json::from_str(json_text).ok()?;
    if proposal.waypoints.len() != expected {
        return None;
    }
    let waypoints = proposal
        .waypoints
        .into_iter()
        .map(|waypoint| {
            Some(GeneratedWaypointContentProposal {
                name: sanitize_generated_pathway_name(&waypoint.name)?,
                title: sanitize_generated_pathway_title(&waypoint.title)?,
                description: sanitize_generated_content_text(&waypoint.description, 24, 240)?,
                persona: sanitize_generated_content_text(&waypoint.persona, 20, 180)?,
                visual_detail: sanitize_generated_content_text(&waypoint.visual_detail, 12, 180)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let unique = waypoints
        .iter()
        .map(|waypoint| waypoint.name.to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    (unique.len() == waypoints.len()).then_some(waypoints)
}

pub(super) fn generated_pathway_name_avoids_anchors(name: &str, anchors: &[&str]) -> bool {
    let name = compact_whitespace(name).to_ascii_lowercase();
    anchors.iter().all(|anchor| {
        let anchor = compact_whitespace(anchor).to_ascii_lowercase();
        anchor.is_empty() || !name.contains(&anchor)
    })
}

pub(super) fn apply_generated_waypoint_content(
    waypoint: &mut GeneratedWaypointState,
    content: GeneratedWaypointContentProposal,
) {
    waypoint.name = content.name.clone();
    waypoint.meta.title = content.title;
    waypoint.meta.description = content.description;
    waypoint.meta.persona = content.persona;
    waypoint.meta.art_prompt = Some(format!(
        "cozy storybook landscape, {detail}, {name}, {biome}, terrain of {terrain}, no people, no characters, no creatures, no text, no logo, no watermark",
        detail = content.visual_detail,
        name = content.name,
        biome = waypoint.meta.biome,
        terrain = waypoint.meta.terrain.join(", "),
    ));
}

pub(super) fn set_pathway_generation_provenance(
    pathway: &mut GeneratedPathwayState,
    mode: GenerationMode,
    config: Option<&AiConfig>,
    source: &str,
    attempts: u8,
) {
    pathway.generation = GenerationProvenance {
        source: source.to_string(),
        feature: PATHWAY_CONTENT_FEATURE.to_string(),
        policy_mode: mode.as_str().to_string(),
        prompt_version: PATHWAY_CONTENT_PROMPT_VERSION.to_string(),
        provider: ai_provider_name(config).to_string(),
        model: ai_model_name(config),
        attempts,
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RuntimeWorld;
    use axum::{http::StatusCode, response::IntoResponse, routing::post, Json, Router};
    use base64::Engine;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use tokio::net::TcpListener;

    #[test]
    fn pathway_prompt_carries_route_direction_ecology_and_authored_context() {
        let runtime = RuntimeWorld::seeded();
        let pathway = runtime
            .generated_pathway(5000, 700, 712, 2)
            .expect("Bethlehem-to-Jerusalem route");
        let origin_meta = runtime.location_meta_for(700);
        let destination_meta = runtime.location_meta_for(712);
        let prompt = generated_pathway_content_prompt(
            &pathway,
            &PathwayRoutePromptContext {
                route_id: "route://cosyworld.the-holy-land/authored/bethlehem|jerusalem",
                route_version: 3,
                origin_name: "Bethlehem",
                destination_name: "Jerusalem",
                direction: "north",
                origin_meta: &origin_meta,
                destination_meta: &destination_meta,
            },
        );

        assert!(prompt.contains("Canonical route ID: route://cosyworld.the-holy-land"));
        assert!(prompt.contains("Canonical route version: 3"));
        assert!(prompt.contains("Route endpoints: origin Bethlehem; destination Jerusalem"));
        assert!(prompt.contains("Travel direction: north, from Bethlehem toward Jerusalem"));
        assert!(prompt.contains(&origin_meta.description));
        assert!(prompt.contains(&destination_meta.description));
        assert!(prompt.contains("segment index/count: 1/2"));
        for field in [
            "biome:",
            "terrain:",
            "climate:",
            "hydrology:",
            "vegetation cues:",
            "fauna cues:",
            "ecosystem/resource cues:",
        ] {
            assert!(prompt.contains(field), "missing {field} from {prompt}");
        }
        assert!(prompt.contains("must not choose or change topology"));
    }

    #[test]
    fn provider_names_follow_the_configured_endpoint() {
        let config = |base_url: &str| AiConfig {
            api_key: "test".to_string(),
            base_url: base_url.to_string(),
            model: "test-model".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: None,
            vision_reasoning_effort: None,
        };
        assert_eq!(
            ai_provider_name(Some(&config("https://openrouter.ai/api/v1"))),
            "openrouter"
        );
        assert_eq!(
            ai_provider_name(Some(&config("https://api.openai.com/v1"))),
            "openai"
        );
        assert_eq!(
            ai_provider_name(Some(&config("http://127.0.0.1:8080/v1"))),
            "openai_compatible"
        );
        assert_eq!(ai_provider_name(None), "unconfigured");
    }

    #[test]
    fn local_sidecars_are_keyless_but_remote_endpoints_are_not() {
        assert!(local_ai_base_url("http://127.0.0.1:8080/v1"));
        assert!(local_ai_base_url("http://localhost:8080/v1"));
        assert!(!local_ai_base_url("https://openrouter.ai/api/v1"));
        assert!(!local_ai_base_url("https://api.openai.com/v1"));
    }

    #[test]
    fn gateway_errors_have_stable_telemetry_codes() {
        assert_eq!(
            AiGatewayError::unconfigured("dialogue").code(),
            "inference_unconfigured"
        );
        assert_eq!(
            AiGatewayError::invalid_response("bad response").code(),
            "inference_invalid_response"
        );
    }

    #[test]
    fn generation_controls_are_feature_scoped_and_fail_closed_on_bad_configuration() {
        assert_eq!(
            GenerationControls::default().default_mode(),
            GenerationMode::Off,
            "unreviewed generation features must default off"
        );
        let controls = GenerationControls::from_values(
            Some("shadow"),
            Some(r#"{"pathway_content":"auto_bounded","room.memory":"off"}"#),
        )
        .expect("valid generation controls");
        assert_eq!(controls.default_mode(), GenerationMode::Shadow);
        assert_eq!(
            controls.mode("pathway_content"),
            GenerationMode::AutoBounded
        );
        assert_eq!(controls.mode("room.memory"), GenerationMode::Off);
        assert_eq!(controls.mode("dialogue_avatar"), GenerationMode::Shadow);
        assert!(GenerationControls::from_values(Some("unbounded"), None).is_err());
        assert!(GenerationControls::from_values(None, Some(r#"{"Bad Feature":"off"}"#)).is_err());
    }

    #[tokio::test]
    async fn gateway_retries_transient_provider_failures_once() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let structured_format_seen = Arc::new(AtomicBool::new(false));
        let reasoning_none_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let attempts = attempts.clone();
                let structured_format_seen = structured_format_seen.clone();
                let reasoning_none_seen = reasoning_none_seen.clone();
                move |Json(body): Json<Value>| {
                    let attempts = attempts.clone();
                    let structured_format_seen = structured_format_seen.clone();
                    let reasoning_none_seen = reasoning_none_seen.clone();
                    async move {
                        if body
                            .pointer("/response_format/json_schema/name")
                            .and_then(Value::as_str)
                            == Some("retry_test_schema")
                        {
                            structured_format_seen.store(true, Ordering::SeqCst);
                        }
                        if body.pointer("/reasoning/effort").and_then(Value::as_str) == Some("none")
                        {
                            reasoning_none_seen.store(true, Ordering::SeqCst);
                        }
                        if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                            return (StatusCode::BAD_GATEWAY, "try again").into_response();
                        }
                        Json(json!({
                            "choices": [{ "message": { "content": "The kettle behaves." } }]
                        }))
                        .into_response()
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind AI gateway retry test server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "test-model".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: Some("none".to_string()),
            vision_reasoning_effort: Some("low".to_string()),
        };
        let response_format = json!({
            "type": "json_schema",
            "json_schema": {
                "name": "retry_test_schema",
                "strict": true,
                "schema": { "type": "object" }
            }
        });

        let completion = request_chat_completion(
            &config,
            ChatCompletionRequest {
                feature: "retry_test",
                system: "system",
                user: "user",
                temperature: 0.0,
                max_tokens: 20,
                timeout: Duration::from_secs(2),
                max_attempts: 2,
                referer: "http://127.0.0.1",
                response_format: Some(&response_format),
            },
        )
        .await
        .expect("transient provider failure should retry");

        assert_eq!(completion.text, "The kettle behaves.");
        assert_eq!(completion.attempts, 2);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert!(structured_format_seen.load(Ordering::SeqCst));
        assert!(reasoning_none_seen.load(Ordering::SeqCst));
        server.abort();
    }

    #[tokio::test]
    async fn visible_person_fixture_fails_the_pathway_image_policy() {
        let request_seen = Arc::new(AtomicBool::new(false));
        let app = Router::new().route(
            "/chat/completions",
            post({
                let request_seen = request_seen.clone();
                move |Json(body): Json<Value>| {
                    let request_seen = request_seen.clone();
                    async move {
                        let image_url = body
                            .pointer("/messages/1/content/1/image_url/url")
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        let correct_request = body.get("model").and_then(Value::as_str)
                            == Some("test-vision-model")
                            && body.get("temperature").is_none()
                            && body.get("max_tokens").and_then(Value::as_u64)
                                == Some(u64::from(IMAGE_POLICY_MAX_TOKENS))
                            && body.pointer("/reasoning/effort").and_then(Value::as_str)
                                == Some("low")
                            && body
                                .pointer("/response_format/json_schema/name")
                                .and_then(Value::as_str)
                                == Some("cosyworld_image_policy")
                            && image_url.starts_with("data:image/svg+xml;base64,");
                        request_seen.store(correct_request, Ordering::SeqCst);
                        Json(json!({
                            "choices": [{
                                "message": {
                                    "content": r#"{"allowed":false,"violations":["person"],"summary":"A standing human figure is visible beside the path."}"#
                                }
                            }]
                        }))
                    }
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image policy test server");
        let addr = listener.local_addr().expect("image policy test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let fixture = include_bytes!("test-fixtures/pathway-visible-person.svg");
        let image_url = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(fixture)
        );
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "test-model".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: None,
            vision_reasoning_effort: Some("low".to_string()),
        };

        let decision = request_image_policy_decision(
            &config,
            ImagePolicyRequest {
                feature: "media.pathway_policy",
                image_url: &image_url,
                policy: "Landscape only; no people, characters, or creatures.",
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect("fixture review should return a strict decision");

        assert!(!decision.allowed);
        assert_eq!(decision.violations, vec!["person"]);
        assert!(request_seen.load(Ordering::SeqCst));
        server.abort();
    }

    #[tokio::test]
    async fn provider_4xx_includes_safe_image_policy_diagnostics() {
        let app = Router::new().route(
            "/chat/completions",
            post(|| async {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": {
                            "code": "unsupported_capability",
                            "message": "test-vision-model does not support image_url with json_schema"
                        }
                    })),
                )
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind image policy diagnostic server");
        let addr = listener.local_addr().expect("AI gateway test address");
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let config = AiConfig {
            api_key: "test".to_string(),
            base_url: format!("http://{addr}"),
            model: "test-model".to_string(),
            vision_model: "test-vision-model".to_string(),
            reasoning_effort: None,
            vision_reasoning_effort: None,
        };

        let error = request_image_policy_decision(
            &config,
            ImagePolicyRequest {
                feature: "media.location_image_policy",
                image_url: "data:image/png;base64,dGVzdA==",
                policy: "Landscape only.",
                timeout: Duration::from_secs(2),
                max_attempts: 1,
                referer: "http://127.0.0.1",
            },
        )
        .await
        .expect_err("provider capability mismatch must fail closed");
        let message = error.to_string();

        assert!(message.contains("HTTP 400 Bad Request"));
        assert!(message.contains("does not support image_url with json_schema"));
        assert!(!message.contains("dGVzdA=="));
        server.abort();
    }

    #[test]
    fn image_policy_decision_fails_closed_on_contradictory_json() {
        assert!(parse_image_policy_decision(
            r#"{"allowed":true,"violations":["person"],"summary":"A person is visible."}"#
        )
        .is_err());
        assert!(parse_image_policy_decision(
            r#"{"allowed":false,"violations":[],"summary":"Nothing visible."}"#
        )
        .is_err());
        assert!(parse_image_policy_decision(
            r#"{"allowed":false,"violations":["other"],"summary":"An unspecified concern."}"#
        )
        .is_err());
    }
}
